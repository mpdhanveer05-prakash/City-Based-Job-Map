import { describe, expect, it } from "vitest";
import { checkVerifiedDate, rowEvidence, type EvidenceField } from "@/lib/admin/import-evidence";
import { parseCsv } from "@/lib/admin/csv";
import { readImportTable, validateImportRows, type ImportReference } from "@/lib/admin/import-rows";

const TODAY = "2026-10-06";
const run = (cells: Record<string, string>, needed: EvidenceField[], stageMovedToOwnership = false) =>
  rowEvidence({ cells, needed, stageMovedToOwnership, today: TODAY });
const ROW = { source_url: "https://acme.test/about", verified_at: "2026-09-01" };

describe("checkVerifiedDate", () => {
  it("takes a real past date in YYYY-MM-DD, and today", () => {
    expect(checkVerifiedDate("2026-09-01", TODAY)).toBeNull();
    expect(checkVerifiedDate(TODAY, TODAY)).toBeNull();
  });
  it("refuses other forms, impossible dates, the future, and before 2000", () => {
    expect(checkVerifiedDate("01/09/2026", TODAY)).toMatch(/YYYY-MM-DD/);
    expect(checkVerifiedDate("2026-02-30", TODAY)).toMatch(/not a real date/);
    expect(checkVerifiedDate("2026-10-07", TODAY)).toMatch(/future/);
    expect(checkVerifiedDate("1999-12-31", TODAY)).toMatch(/before 2000/);
  });
});

describe("rowEvidence", () => {
  it("needs the row's source_url and verified_at", () => {
    const r = run({ source_covers: "name" }, ["name"]);
    expect(r.errors.join(" ")).toMatch(/source_url is missing/);
    expect(r.errors.join(" ")).toMatch(/verified_at date is missing/);
    expect(run({ source_url: "http://a.test", verified_at: "2026-09-01", source_covers: "name" }, ["name"]).errors.join(" ")).toMatch(/https link/);
  });

  it("does not count the row source for a field it does not list", () => {
    const r = run({ ...ROW, source_covers: "name" }, ["name", "website", "address"]);
    expect(r.evidence).toEqual([{ field: "name", ...ROW }]);
    expect(r.errors).toEqual([
      expect.stringMatching(/no evidence for the website: list it in source_covers, or give website_source_url/),
      expect.stringMatching(/no evidence for the address/),
    ]);
  });

  it("takes a different source per field, which wins over the row source", () => {
    const r = run(
      { ...ROW, source_covers: "name;website;address", address_source_url: "https://maps.acme.test/office", address_verified_at: "2026-08-15",
        location_source_url: "https://maps.acme.test/office", location_verified_at: "2026-08-15" },
      ["name", "website", "address", "location"],
    );
    expect(r.errors).toEqual([]);
    expect(r.evidence).toEqual([
      { field: "name", ...ROW },
      { field: "website", ...ROW },
      { field: "address", source_url: "https://maps.acme.test/office", verified_at: "2026-08-15" },
      { field: "location", source_url: "https://maps.acme.test/office", verified_at: "2026-08-15" },
    ]);
  });

  it("needs both halves of a per-field source, a real date, and a field the row fills in", () => {
    expect(run({ ...ROW, name_source_url: "https://a.test" }, ["name"]).errors.join(" ")).toMatch(/a source but no verified date/);
    expect(run({ ...ROW, name_source_url: "https://a.test", name_verified_at: "2027-01-01" }, ["name"]).errors.join(" ")).toMatch(/future/);
    expect(run({ ...ROW, source_covers: "name", description_source_url: "https://a.test", description_verified_at: "2026-09-01" }, ["name"]).errors)
      .toEqual([expect.stringMatching(/source for the description, but this row leaves it empty/)]);
  });

  it("reads field names in source_covers loosely, and refuses unknown ones", () => {
    expect(run({ ...ROW, source_covers: "Name, Industry; Type | Stage" }, ["name", "sectors", "types", "startup_stage"]).errors).toEqual([]);
    expect(run({ ...ROW, source_covers: "name;headcount" }, ["name"]).errors).toEqual([expect.stringMatching(/"headcount" in source_covers is not a field/)]);
  });

  it("moves evidence for an old-style Public or Acquired stage to the ownership status", () => {
    const r = run({ ...ROW, source_covers: "stage" }, ["ownership_status"], true);
    expect(r.evidence).toEqual([{ field: "ownership_status", ...ROW }]);
  });
});

describe("validateImportRows with evidence", () => {
  const ref: ImportReference = {
    cities: [{ slug: "bangalore", name: "Bengaluru", aliases: [] }],
    neighbourhoods: [],
    techParks: [],
    sectors: [{ slug: "fintech", name: "Fintech" }],
    existingDomains: new Set(["known.test"]),
    existingOffices: new Set(),
  };
  const check = (csv: string) => validateImportRows(readImportTable(parseCsv(csv)).records, ref, TODAY);
  const HEAD = "name,domain,city,address,lat,lng,description,industry,source_url,verified_at,source_covers";

  it("a new company needs evidence for each filled-in fact, and sends it with the row", () => {
    const [ok, missing] = check(
      `${HEAD}\n` +
        "Acme,acme.test,Bengaluru,1 Road,12.9,77.6,Makes things,Fintech,https://acme.test/about,2026-09-01,name;website;description;industry;address;location\n" +
        "Beta,beta.test,Bengaluru,2 Road,12.9,77.6,Makes things,,https://beta.test/about,2026-09-01,name;website;address;location",
    );
    expect(ok.status).toBe("new");
    expect(ok.payload?.sectors).toEqual(["fintech"]);
    expect(ok.payload?.evidence.map((e) => e.field)).toEqual(["name", "website", "description", "sectors", "address", "location"]);
    expect(missing.status).toBe("error");
    expect(missing.errors.join(" ")).toMatch(/no evidence for the description/);
  });

  it("an industry that is not a known sector is refused", () => {
    const [row] = check(`${HEAD}\nAcme,acme.test,Bengaluru,1 Road,12.9,77.6,,Space mining,https://acme.test,2026-09-01,name;website;industry;address;location`);
    expect(row.errors.join(" ")).toMatch(/"Space mining" is not a known sector/);
  });

  it("a row that adds an office to a listed company needs evidence for the office only", () => {
    const [row] = check(`${HEAD}\nKnown,known.test,Bengaluru,3 Road,12.9,77.6,,,https://known.test/offices,2026-09-01,address;location`);
    expect(row.status).toBe("attach");
    expect(row.payload?.evidence.map((e) => e.field)).toEqual(["address", "location"]);
  });
});
