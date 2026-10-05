import { describe, expect, it } from "vitest";
import { CsvError, MAX_CSV_ROWS, parseCsv } from "@/lib/admin/csv";
import { describeError } from "@/lib/admin/errors";
import { readImportTable, rowsToCommit, summariseImport, validateImportRows, type ImportReference } from "@/lib/admin/import-rows";

describe("parseCsv", () => {
  it("reads plain rows, with LF, CRLF, or CR between them", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads quoted cells: commas, doubled quotes, and line breaks inside", () => {
    expect(parseCsv('name,about\n"Acme, Inc.","She said ""hi"""\n"Two\nlines",x')).toEqual([
      ["name", "about"],
      ["Acme, Inc.", 'She said "hi"'],
      ["Two\nlines", "x"],
    ]);
  });

  it("skips a byte-order mark and blank lines, and keeps empty cells", () => {
    expect(parseCsv("﻿a,b\n\n1,\n,2\n\n")).toEqual([["a", "b"], ["1", ""], ["", "2"]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });

  it("keeps a quoted empty cell as a row, and a quote in the middle of a cell as text", () => {
    expect(parseCsv('""\n')).toEqual([[""]]);
    expect(parseCsv('5" pipe,x')).toEqual([['5" pipe', "x"]]);
  });

  it("reports a quote that is never closed, on the line where it opened", () => {
    expect(() => parseCsv('a,b\n1,"never closed\n2,3')).toThrow(CsvError);
    try {
      parseCsv('a\n"open');
    } catch (e) {
      expect((e as CsvError).line).toBe(2);
    }
  });

  it("refuses a file with too many rows", () => {
    const text = "a\n" + "1\n".repeat(MAX_CSV_ROWS + 1);
    expect(() => parseCsv(text)).toThrow(/limited to 2000 rows/);
    expect(parseCsv("a\n" + "1\n".repeat(MAX_CSV_ROWS))).toHaveLength(MAX_CSV_ROWS + 1);
  });

  it("round-trips awkward text exactly", () => {
    const cells = ['plain', 'with, comma', 'with "quote"', 'two\nlines', ' spaced ', 'ಬೆಂಗಳೂರು', ''];
    const encode = (c: string) => `"${c.replace(/"/g, '""')}"`;
    expect(parseCsv(cells.map(encode).join(",") + "\n")).toEqual([cells]);
  });
});

const ref: ImportReference = {
  cities: [
    { slug: "bangalore", name: "Bengaluru", aliases: ["Bangalore", "BLR"] },
    { slug: "chennai", name: "Chennai", aliases: ["Madras"] },
  ],
  neighbourhoods: [
    { city: "bangalore", slug: "koramangala", name: "Koramangala" },
    { city: "chennai", slug: "adyar", name: "Adyar" },
  ],
  techParks: [{ city: "bangalore", slug: "embassy-tech-village", name: "Embassy Tech Village" }],
  sectors: [{ slug: "fintech", name: "Fintech" }, { slug: "e-commerce", name: "E-commerce" }],
  existingDomains: new Set(["known.test"]),
  existingOffices: new Set(["known.test|bangalore|1 old road"]),
};

const HEADER = "name,domain,city,address,lat,lng";
const table = (csv: string) => readImportTable(parseCsv(csv));
const check = (csv: string) => validateImportRows(table(csv).records, ref);

describe("readImportTable", () => {
  it("maps headers, ignoring case, spaces, underscores, and common spreadsheet names", () => {
    const t = table("Company Name,Website,Latitude,Longitude,Domain,City,ADDRESS,Neighborhood,Tech Park,Startup Stage,Type,Sector,Whatever\nA,https://a.test,1,2,a.test,Chennai,x,y,z,seed,startup,fintech,q");
    expect(t.columns).toEqual(["name", "website_url", "lat", "lng", "domain", "city", "address", "neighbourhood", "tech_park", "startup_stage", "types", "sectors", null]);
    expect(t.missingColumns).toEqual([]);
    expect(t.unknownColumns).toEqual(["Whatever"]);
    expect(t.records[0]).toEqual({ line: 2, cells: expect.objectContaining({ name: "A", lat: "1", neighbourhood: "y" }) });
  });

  it("names the required columns a file lacks", () => {
    expect(table("name,domain\nA,a.test").missingColumns).toEqual(["city", "address", "lat", "lng"]);
    expect(readImportTable([]).missingColumns).toHaveLength(6);
  });

  it("numbers lines from the header, which is line 1", () => {
    expect(table(`${HEADER}\nA,a.test,Chennai,x,1,2\nB,b.test,Chennai,y,3,4`).records.map((r) => r.line)).toEqual([2, 3]);
  });

  it("trims cells, and lets the first of two columns with one meaning win", () => {
    const t = table("name,company,domain,city,address,lat,lng\n  A  ,B,a.test,Chennai,x,1,2");
    expect(t.records[0].cells.name).toBe("A");
  });
});

describe("validateImportRows", () => {
  it("accepts a good row as a new company, normalising the city, domain, and lists", () => {
    const [r] = check(`${HEADER},types,startup_stage,sectors,neighbourhood,accuracy\nAcme Pay,https://www.Acme-Pay.test/about,Bangalore,1 First Road,12.95,77.62,Startup; Product,Series C+,E-commerce|Fintech,koramangala,building`);
    expect(r.errors).toEqual([]);
    expect(r.status).toBe("new");
    expect(r.payload).toMatchObject({
      name: "Acme Pay",
      domain: "acme-pay.test",
      website_url: "https://acme-pay.test",
      city: "bangalore",
      types: ["startup", "product"],
      startup_stage: "series_c_plus",
      sectors: ["e-commerce", "fintech"],
      neighbourhood: "koramangala",
      accuracy: "building",
      lat: 12.95,
      lng: 77.62,
    });
  });

  it("reads city names, aliases, and slugs the same way", () => {
    for (const city of ["Bengaluru", "bangalore", "BLR", "BENGALURU"]) {
      expect(check(`${HEADER},types\nA,a.test,${city},x,12.9,77.6,startup`)[0].payload?.city).toBe("bangalore");
    }
    expect(check(`${HEADER},types\nA,a.test,Madras,x,13,80.2,startup`)[0].payload?.city).toBe("chennai");
  });

  it("flags a row for a domain that exists as an attached office, and a repeated address as a duplicate", () => {
    const rows = check(`${HEADER},types\nKnown Co,known.test,Bengaluru,2 New Road,12.9,77.6,mnc\nKnown Co,known.test,Bengaluru,1 OLD Road,12.9,77.6,mnc`);
    expect(rows.map((r) => r.status)).toEqual(["attach", "duplicate-office"]);
    expect(rows[1].warnings.join(" ")).toMatch(/already listed/);
  });

  it("treats the same company twice in one file as one company with two offices, and a repeated office as a duplicate", () => {
    const rows = check(`${HEADER},types\nA,a.test,Chennai,1 Road,13,80.2,startup\nA,a.test,Chennai,2 Road,13,80.2,startup\nA,a.test,Chennai,2 road,13,80.2,startup`);
    expect(rows.map((r) => r.status)).toEqual(["new", "attach", "duplicate-office"]);
  });

  it("explains each kind of error, in words", () => {
    const msgs = (csv: string) => check(csv)[0].errors.join(" | ");
    expect(msgs(`${HEADER}\n,a.test,Chennai,x,1,2`)).toMatch(/name is missing/);
    expect(msgs(`${HEADER}\nA,,Chennai,x,1,2`)).toMatch(/domain is missing/);
    expect(msgs(`${HEADER}\nA,not a domain,Chennai,x,1,2`)).toMatch(/not a valid domain/);
    expect(msgs(`${HEADER}\nA,a.test,Atlantis,x,1,2`)).toMatch(/not a city this site covers \(Bengaluru, Chennai\)/);
    expect(msgs(`${HEADER}\nA,a.test,,x,1,2`)).toMatch(/city is missing/);
    expect(msgs(`${HEADER}\nA,a.test,Chennai,,1,2`)).toMatch(/address is missing/);
    expect(msgs(`${HEADER}\nA,a.test,Chennai,x,north,2`)).toMatch(/must be numbers/);
    expect(msgs(`${HEADER}\nA,a.test,Chennai,x,,2`)).toMatch(/must be numbers/);
    expect(msgs(`${HEADER}\nA,a.test,Chennai,x,123,2`)).toMatch(/out of range/);
    expect(msgs(`${HEADER},types\nA,a.test,Chennai,x,1,2,wizard`)).toMatch(/not a company type/);
    expect(msgs(`${HEADER},types,startup_stage\nA,a.test,Chennai,x,1,2,mnc,seed`)).toMatch(/needs the type startup/);
    expect(msgs(`${HEADER},types,startup_stage\nA,a.test,Chennai,x,1,2,startup,huge`)).toMatch(/not a startup stage/);
    expect(msgs(`${HEADER},sectors\nA,a.test,Chennai,x,1,2,mining`)).toMatch(/not a known sector/);
    expect(msgs(`${HEADER},neighbourhood\nA,a.test,Chennai,x,1,2,Koramangala`)).toMatch(/not a neighbourhood of this city/);
    expect(msgs(`${HEADER},tech_park\nA,a.test,Chennai,x,1,2,Embassy Tech Village`)).toMatch(/not a tech park of this city/);
    expect(msgs(`${HEADER},accuracy\nA,a.test,Chennai,x,1,2,exact`)).toMatch(/not an accuracy/);
  });

  it("applies the outbound-link rules to the website and the careers page", () => {
    const msgs = (extra: string, header: string) => check(`${HEADER},${header}\nA,a.test,Chennai,x,13,80,${extra}`)[0].errors.join(" | ");
    expect(msgs("http://a.test", "website_url")).toMatch(/website must be https/);
    expect(msgs("https://evil.test", "careers_url")).toMatch(/careers page host evil.test is neither a.test/);
    expect(check(`${HEADER},careers_url\nA,a.test,Chennai,x,13,80,https://boards.greenhouse.io/a`)[0].errors).toEqual([]);
    expect(check(`${HEADER},website_url\nA,a.test,Chennai,x,13,80,https://other.test`)[0].warnings.join(" ")).toMatch(/host is not a.test/);
  });

  it("warns, without blocking, about no type, no accuracy, and a point outside India", () => {
    const [r] = check(`${HEADER}\nA,a.test,Chennai,x,80.2,13.0`);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" | ")).toMatch(/No company type/);
    expect(r.warnings.join(" | ")).toMatch(/locality is assumed/);
    expect(r.warnings.join(" | ")).toMatch(/outside India/);
    expect(r.payload?.accuracy).toBe("locality");
  });

  it("never sends a row that has an error, and keeps each row's own problems", () => {
    const rows = check(`${HEADER},types\nGood,good.test,Chennai,x,13,80,startup\n,bad.test,Chennai,x,13,80,startup\nGood2,good2.test,Nowhere,x,13,80,startup`);
    expect(rows.map((r) => r.status)).toEqual(["new", "error", "error"]);
    expect(rows[1].payload).toBeNull();
    expect(rows[2].errors).toHaveLength(1);
  });

  it("caps long text", () => {
    expect(check(`${HEADER},description\nA,a.test,Chennai,x,13,80,${"x".repeat(2001)}`)[0].errors.join()).toMatch(/longer than 2000/);
    expect(check(`${HEADER}\n${"N".repeat(201)},a.test,Chennai,x,13,80`)[0].errors.join()).toMatch(/longer than 200/);
  });

  it("summarises and picks the rows to send, with their file lines", () => {
    const rows = check(`${HEADER},types\nA,a.test,Chennai,1,13,80,startup\nA,a.test,Chennai,2,13,80,startup\nA,a.test,Chennai,2,13,80,startup\n,b.test,Chennai,x,13,80,startup`);
    expect(summariseImport(rows)).toMatchObject({ rows: 4, new: 1, attach: 1, duplicateOffice: 1, errors: 1 });
    const send = rowsToCommit(rows);
    expect(send.lines).toEqual([2, 3]);
    expect(send.rows.map((r) => r.address)).toEqual(["1", "2"]);
  });
});

describe("describeError", () => {
  it("passes through the words our triggers and functions raise", () => {
    expect(describeError({ code: "22023", message: "unknown sector \"x\"" })).toBe('Unknown sector "x".');
    expect(describeError({ code: "23514", message: "published office is outside the boundary of city 1 (set outside_reviewed after review)" })).toMatch(
      /^Published office is outside the boundary/,
    );
    expect(describeError({ code: "42501", message: "only a reviewer or admin can create a record in its public state" })).toBe(
      "Only a reviewer or admin can create a record in its public state.",
    );
  });

  it("says plainly when a role is not allowed, and when a value is already used", () => {
    expect(describeError({ code: "42501", message: "new row violates row-level security policy for table \"company\"" })).toBe("Your role does not allow this. Ask a reviewer or an admin.");
    expect(describeError({ code: "23505", message: "duplicate key", details: "Key (domain)=(a.test) already exists." })).toBe("Another record already uses that domain.");
    expect(describeError({ code: "23505", message: "duplicate key" })).toBe("Another record already has that value.");
    // From a function, the detail can be missing; the constraint's name in the message says which column.
    expect(describeError({ code: "23505", message: 'duplicate key value violates unique constraint "company_domain_key"' })).toBe("Another record already uses that domain.");
    expect(describeError({ code: "23505", message: 'duplicate key value violates unique constraint "company_slug_key"' })).toBe("Another record already uses that slug.");
    expect(describeError({ code: "23505", message: 'duplicate key value violates unique constraint "job_city_pkey"' })).toBe("Another record already has that value.");
    expect(describeError({ code: "23503", message: "fk" })).toMatch(/still used by another one/);
  });

  it("handles network failures, expired sessions, and nothing at all", () => {
    expect(describeError({ message: "TypeError: Failed to fetch" })).toMatch(/could not be reached/);
    expect(describeError({ message: "JWT expired" })).toMatch(/Sign in again/);
    expect(describeError(null)).toBe("");
    expect(describeError({})).toBe("Something went wrong.");
  });
});
