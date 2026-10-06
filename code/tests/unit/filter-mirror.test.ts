import { describe, expect, it } from "vitest";
import {
  citySnapshotSchema,
  mergeDataset,
  splitSnapshot,
  type CitySnapshot,
} from "@/lib/filters/dataset";
import {
  cityPoints,
  companyFacets,
  companyFilter,
  compareCodePoints,
  filterResult,
  prepareIndex,
  searchCompanies,
  searchTokens,
  type FilterIndex,
} from "@/lib/filters/filter";
import { EMPTY_FILTERS, normalizeFilters, type Filters } from "@/lib/filters/schema";

// The same twelve-company story as supabase/tests/database/03_filter.test.sql, so the browser filter
// is held to the rules the database tests state. (The parity test compares the two on real data.)
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const company = (n: number, slug: string, name: string, types: string[], stage: string | null, sectors: string[] = [], ownership: string | null = null) => ({
  id: id(n),
  slug,
  name,
  logo_key: null,
  description: null,
  website_url: `https://${slug}.example`,
  careers_url: null,
  startup_stage: stage,
  ownership_status: ownership,
  last_verified_at: null,
  types,
  sectors,
  founders: [] as string[],
});
const office = (n: number, companyN: number, address: string, neighbourhood: string | null, tech_park: string | null, lng = 77.6, lat = 12.97) => ({
  id: id(1000 + n),
  company_id: id(companyN),
  lng,
  lat,
  accuracy: "building" as const,
  address,
  neighbourhood,
  tech_park,
});
const job = (n: number, companyN: number, title: string, status: "active" | "suspect" = "active") => ({
  id: id(2000 + n),
  company_id: id(companyN),
  title,
  apply_url: `https://c${companyN}.example/${n}`,
  status,
  last_checked_at: null,
});

const companies = [
  { ...company(1, "alpha-labs", "Alpha Labs", ["startup", "product"], "seed", ["fintech"]), founders: ["Asha Rao"] },
  company(2, "bravo-pay", "Bravo Pay", ["startup"], "series_a", ["fintech", "saas"]),
  company(3, "charlie-corp", "Charlie Corp", ["mnc"], null, [], "public"),
  company(4, "delta-products", "Delta Products", ["product"], null),
  company(5, "echo-seed", "Echo Seed", ["startup"], "pre_seed"),
  company(6, "foxtrot-global", "Foxtrot Global", ["mnc", "product"], null, [], "private"),
  company(9, "india-startup", "India Startup", ["startup"], null, [], "acquired"),
  company(11, "kilo-multi", "Kilo Multi", ["mnc"], null),
];
const snapshot: CitySnapshot = citySnapshotSchema.parse({
  version: 1,
  city: { slug: "bangalore", name: "Bengaluru", aliases: [], status: "live", centre: [77.6, 12.97], default_zoom: 11, data_version: 1,
    boundary: { type: "MultiPolygon", coordinates: [[[[77.45, 12.8], [77.8, 12.8], [77.8, 13.15], [77.45, 13.15], [77.45, 12.8]]]] } },
  synthetic_companies: 0,
  slug_redirects: [],
  neighbourhoods: [
    { slug: "indiranagar", name: "Indiranagar" },
    { slug: "koramangala", name: "Koramangala" },
  ],
  tech_parks: [
    { slug: "etv", name: "Embassy Tech Village" },
    { slug: "prestige", name: "Prestige Tech Park" },
  ],
  sectors: [
    { slug: "fintech", name: "Fintech" },
    { slug: "saas", name: "SaaS" },
  ],
  companies,
  offices: [
    office(1, 1, "100 Feet Road", "indiranagar", null),
    office(2, 2, "80 Feet Road", "koramangala", null),
    office(3, 2, "Outer Ring Road", null, "etv"),
    office(4, 3, "Devarabisanahalli", null, "etv"),
    office(5, 4, "Hosur Road", "koramangala", null),
    office(6, 5, "MG Road", null, "prestige"),
    office(7, 6, "Old Airport Road", "indiranagar", null),
    office(8, 9, "Sarjapur Road", "koramangala", null),
    office(9, 11, "CMH Block", "indiranagar", null),
    office(10, 11, "Madiwala", "koramangala", null),
  ],
  jobs: [
    job(1, 1, "Backend Engineer"),
    job(2, 2, "Payments Engineer"),
    job(3, 2, "Risk Analyst", "suspect"),
    job(5, 3, "DevOps Engineer"),
  ],
});

const index: FilterIndex = prepareIndex(mergeDataset(splitSnapshot(snapshot)));
const f = (patch: Partial<Filters> = {}): Filters => normalizeFilters({ ...EMPTY_FILTERS, ...patch });
const slugs = (filters: Filters) =>
  companyFilter(index, filters)
    .map((cid) => companies.find((c) => c.id === cid)!.slug)
    .sort();

describe("filter rules (the same expectations as the pgTAP filter tests)", () => {
  it("no filter returns every company in the dataset once", () => {
    expect(slugs(f())).toEqual(companies.map((c) => c.slug).sort());
  });

  it("types: OR within the group, a multi-tag company once", () => {
    expect(slugs(f({ types: ["startup"] }))).toEqual(["alpha-labs", "bravo-pay", "echo-seed", "india-startup"]);
    expect(slugs(f({ types: ["startup", "mnc"] }))).toEqual([
      "alpha-labs", "bravo-pay", "charlie-corp", "echo-seed", "foxtrot-global", "india-startup", "kilo-multi",
    ]);
    expect(slugs(f({ types: ["product"] }))).toEqual(["alpha-labs", "delta-products", "foxtrot-global"]);
  });

  it("stages are ignored without Startup, and a startup counts only at a selected stage", () => {
    expect(slugs(f({ types: ["startup"], stages: ["seed"] }))).toEqual(["alpha-labs"]);
    expect(slugs(f({ types: ["startup"], stages: ["seed", "pre_seed"] }))).toEqual(["alpha-labs", "echo-seed"]);
    expect(slugs(f({ types: ["startup"], stages: ["bootstrapped"] }))).toEqual([]);
    expect(slugs(f({ types: ["startup"], stages: ["series_a"] }))).toEqual(["bravo-pay"]);
  });

  it("ownership status is its own group: OR within, AND with the others, unknown never matches (ADR-0017)", () => {
    expect(slugs(f({ statuses: ["public"] }))).toEqual(["charlie-corp"]);
    expect(slugs(f({ statuses: ["acquired"] }))).toEqual(["india-startup"]);
    expect(slugs(f({ statuses: ["public", "private"] }))).toEqual(["charlie-corp", "foxtrot-global"]);
    expect(slugs(f({ statuses: ["acquired"], types: ["startup"] }))).toEqual(["india-startup"]);
    expect(slugs(f({ statuses: ["public"], types: ["product"] }))).toEqual([]);
    // Not tied to Startup: selecting a status keeps it when the types change.
    expect(normalizeFilters({ statuses: ["public"], types: ["mnc"] }).statuses).toEqual(["public"]);
  });

  it("MNC + Startup + Seed is every MNC company or the Seed startups (ADR-0004)", () => {
    expect(slugs(f({ types: ["mnc", "startup"], stages: ["seed"] }))).toEqual([
      "alpha-labs", "charlie-corp", "foxtrot-global", "kilo-multi",
    ]);
    expect(slugs(f({ types: ["startup", "product"], stages: ["seed"] }))).toEqual([
      "alpha-labs", "delta-products", "foxtrot-global",
    ]);
  });

  it("the stage check in the mirror works even if stages are passed without Startup", () => {
    // normalizeFilters would clear these; the mirror must still agree with SQL on a raw object.
    const raw: Filters = { ...EMPTY_FILTERS, types: ["mnc"], stages: ["seed"] };
    expect(companyFilter(index, raw).length).toBe(3);
    expect(companyFilter(index, { ...EMPTY_FILTERS, stages: ["seed"] }).length).toBe(companies.length);
  });

  it("locations and sectors: OR within a group, AND across groups", () => {
    expect(slugs(f({ neighbourhoods: ["indiranagar"] }))).toEqual(["alpha-labs", "foxtrot-global", "kilo-multi"]);
    expect(slugs(f({ tech_parks: ["etv"] }))).toEqual(["bravo-pay", "charlie-corp"]);
    expect(slugs(f({ tech_parks: ["prestige"] }))).toEqual(["echo-seed"]);
    expect(slugs(f({ tech_parks: ["etv", "prestige"] }))).toEqual(["bravo-pay", "charlie-corp", "echo-seed"]);
    expect(slugs(f({ sectors: ["fintech"] }))).toEqual(["alpha-labs", "bravo-pay"]);
    expect(slugs(f({ types: ["startup"], tech_parks: ["etv"] }))).toEqual(["bravo-pay"]);
    expect(slugs(f({ neighbourhoods: ["indiranagar"], sectors: ["fintech"] }))).toEqual(["alpha-labs"]);
  });
});

describe("search", () => {
  it("matches name, active job title, location, address, and founder", () => {
    expect(slugs(f({ q: "alpha" }))).toEqual(["alpha-labs"]);
    expect(slugs(f({ q: "ALPHA" }))).toEqual(["alpha-labs"]);
    expect(slugs(f({ q: "backend" }))).toEqual(["alpha-labs"]);
    expect(slugs(f({ q: "indiranagar" }))).toEqual(["alpha-labs", "foxtrot-global", "kilo-multi"]);
    expect(slugs(f({ q: "embassy" }))).toEqual(["bravo-pay", "charlie-corp"]);
    expect(slugs(f({ q: "mg road" }))).toEqual(["echo-seed"]);
    expect(slugs(f({ q: "asha" }))).toEqual(["alpha-labs"]);
  });

  it("does not match a suspect job", () => {
    expect(slugs(f({ q: "risk" }))).toEqual([]);
  });

  it("needs every word, and words may match different fields", () => {
    expect(slugs(f({ q: "bravo engineer" }))).toEqual(["bravo-pay"]);
    expect(slugs(f({ q: "alpha payments" }))).toEqual([]);
    expect(slugs(f({ q: "  Backend   Engineer " }))).toEqual(["alpha-labs"]);
  });

  it("treats % and _ as plain text", () => {
    expect(slugs(f({ q: "%" }))).toEqual([]);
    expect(slugs(f({ q: "_" }))).toEqual([]);
  });

  it("a blank search does not constrain", () => {
    expect(slugs(f({ q: "   " }))).toHaveLength(companies.length);
  });

  it("before the search file has loaded, names and locations still match", () => {
    const early = prepareIndex({ ...mergeDataset(splitSnapshot(snapshot)), search: [] });
    expect(companyFilter(early, f({ q: "alpha" }))).toHaveLength(1);
    expect(companyFilter(early, f({ q: "indiranagar" }))).toHaveLength(3);
    expect(companyFilter(early, f({ q: "backend" }))).toHaveLength(0);
  });

  it("splits on the Unicode White_Space set, as the SQL does (not on JavaScript's or PostgreSQL's own \s)", () => {
    expect(searchTokens("  A\tb\nC  ")).toEqual(["a", "b", "c"]);
    expect(searchTokens("a\u00a0b")).toEqual(["a", "b"]); // no-break space
    expect(searchTokens("a\u3000b\u2003c")).toEqual(["a", "b", "c"]); // ideographic and em space
    expect(searchTokens("a\u0085b")).toEqual(["a", "b"]); // next line
    expect(searchTokens("a\ufeffb")).toEqual(["a\ufeffb"]); // BOM: JavaScript says white space, this does not
    expect(searchTokens("a\u001fb")).toEqual(["a\u001fb"]); // control separator: PostgreSQL says white space, this does not
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens(" \t ")).toEqual([]);
  });
});

describe("points, list, facets", () => {
  it("points are every office of every matching company, ordered by ID", () => {
    expect(cityPoints(index, f())).toHaveLength(10);
    expect(cityPoints(index, f({ neighbourhoods: ["indiranagar"] }))).toHaveLength(4); // Kilo keeps both offices
    const ids = cityPoints(index, f()).map((o) => o.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("the list is in name order, with counts and paging", () => {
    expect(searchCompanies(index, f()).map((r) => r.slug)).toEqual([
      "alpha-labs", "bravo-pay", "charlie-corp", "delta-products", "echo-seed", "foxtrot-global", "india-startup", "kilo-multi",
    ]);
    expect(searchCompanies(index, f(), 3, 2).map((r) => r.slug)).toEqual(["charlie-corp", "delta-products", "echo-seed"]);
    expect(searchCompanies(index, f(), 0, 0)).toEqual([]);
    expect(searchCompanies(index, f(), -5, -5)).toEqual([]);
    const bravo = searchCompanies(index, f({ q: "bravo" }))[0];
    expect([bravo.office_count, bravo.open_job_count]).toEqual([2, 1]); // the suspect job is not counted
    expect(searchCompanies(index, f({ q: "alpha" }))[0].types).toEqual(["startup", "product"]);
  });

  it("every facet count equals the filter result with that group replaced", () => {
    const base = f({ types: ["startup"], neighbourhoods: ["koramangala"] });
    const facets = companyFacets(index, base);
    expect(facets.find((r) => r.facet === "total")!.company_count).toBe(companyFilter(index, base).length);
    expect(facets.find((r) => r.facet === "type" && r.value === "mnc")!.company_count).toBe(
      companyFilter(index, { ...base, types: ["mnc"], stages: [] }).length,
    );
    expect(facets.find((r) => r.facet === "stage" && r.value === "series_a")!.company_count).toBe(
      companyFilter(index, { ...base, types: ["startup"], stages: ["series_a"] }).length,
    );
    expect(facets.filter((r) => r.facet === "stage")).toHaveLength(7);
    expect(facets.filter((r) => r.facet === "status")).toHaveLength(3);
    expect(facets.find((r) => r.facet === "status" && r.value === "acquired")!.company_count).toBe(
      companyFilter(index, { ...base, statuses: ["acquired"] }).length,
    );
    expect(facets.filter((r) => r.facet === "type")).toHaveLength(3);
  });

  it("selecting Startup does not zero the MNC count", () => {
    const mnc = companyFacets(index, f({ types: ["startup"] })).find((r) => r.facet === "type" && r.value === "mnc")!;
    expect(mnc.company_count).toBe(3);
  });
});

describe("compareCodePoints", () => {
  it("orders by code point, not by UTF-16 unit", () => {
    expect(compareCodePoints("a", "b")).toBe(-1);
    expect(compareCodePoints("b", "a")).toBe(1);
    expect(compareCodePoints("a", "a")).toBe(0);
    expect(compareCodePoints("a", "ab")).toBe(-1);
    // U+FF5E sorts before U+1F600 by code point, but its UTF-16 unit is greater than the surrogate D83D.
    expect(compareCodePoints("～", "\u{1F600}")).toBe(-1);
    expect("～" < "\u{1F600}").toBe(false);
  });
});

describe("the snapshot schema", () => {
  it("rejects a non-https website, an unknown type, and an out-of-range point", () => {
    const bad = (patch: (s: typeof snapshot) => void) => {
      const copy = structuredClone(snapshot);
      patch(copy);
      return citySnapshotSchema.safeParse(copy).success;
    };
    expect(bad(() => {})).toBe(true);
    expect(bad((s) => (s.companies[0].website_url = "http://x.example"))).toBe(false);
    expect(bad((s) => ((s.companies[0].types as string[]) = ["startup", "bogus"]))).toBe(false);
    expect(bad((s) => (s.offices[0].lat = 91))).toBe(false);
    expect(bad((s) => ((s.jobs[0] as { status: string }).status = "expired"))).toBe(false);
  });
});

describe("splitting the snapshot", () => {
  const files = splitSnapshot(snapshot);

  it("keeps summaries small: no description or links in companies.json", () => {
    for (const c of files.companies.companies) {
      expect(Object.keys(c).sort()).toEqual(["id", "logo_key", "name", "open_jobs", "ownership_status", "slug", "sectors", "startup_stage", "types"].sort());
    }
  });

  it("search.json holds active job titles and founders only", () => {
    const alpha = files.search.entries.find((e) => e.company_id === id(1))!;
    expect(alpha).toEqual({ company_id: id(1), jobs: ["Backend Engineer"], founders: ["Asha Rao"] });
    const bravo = files.search.entries.find((e) => e.company_id === id(2))!;
    expect(bravo.jobs).toEqual(["Payments Engineer"]); // not the suspect one
    expect(files.search.entries.find((e) => e.company_id === id(4))).toBeUndefined();
  });

  it("details.json keeps both active and suspect jobs for the company pages", () => {
    expect(files.details.jobs).toHaveLength(4);
    expect(files.details.companies[id(1)].website_url).toBe("https://alpha-labs.example");
  });

  it("is deterministic and survives a JSON round trip", () => {
    const again = JSON.parse(JSON.stringify(splitSnapshot(snapshot)));
    expect(again).toEqual(files);
    const idx = prepareIndex(mergeDataset(again));
    expect(companyFilter(idx, f({ types: ["startup"] }))).toEqual(companyFilter(index, f({ types: ["startup"] })));
  });
});

describe("filterResult: one pass for every view", () => {
  const filters = [
    f(),
    f({ types: ["startup"] }),
    f({ types: ["startup", "mnc"], stages: ["seed"] }),
    f({ q: "payments" }),
    f({ neighbourhoods: ["koramangala"], sectors: ["fintech"] }),
    f({ q: "nothing matches this" }),
  ];

  it("returns the same companies as company_filter and the same offices as city_points", () => {
    for (const filter of filters) {
      const result = filterResult(index, filter);
      expect(result.companies.map((c) => c.id)).toEqual(companyFilter(index, filter));
      expect(result.offices.map((o) => o.id).sort()).toEqual(cityPoints(index, filter).map((o) => o.id));
    }
  });

  it("gives the list the same companies the map has points for", () => {
    for (const filter of filters) {
      const result = filterResult(index, filter);
      const onMap = new Set(result.offices.map((o) => o.company_id));
      const inList = new Set(searchCompanies(index, filter, 1000).map((r) => r.company_id));
      expect(inList).toEqual(new Set(result.companies.map((c) => c.id)));
      for (const id of onMap) expect(inList.has(id)).toBe(true);
    }
  });

  it("counts open jobs from the summary, so they are right before search.json has loaded", () => {
    const withoutSearch = prepareIndex({ ...mergeDataset(splitSnapshot(snapshot)), search: [] });
    const rows = searchCompanies(withoutSearch, f(), 100);
    const bravo = rows.find((r) => r.slug === "bravo-pay")!;
    expect(bravo.open_job_count).toBe(1);
    expect(rows.map((r) => [r.slug, r.open_job_count])).toEqual(
      searchCompanies(index, f(), 100).map((r) => [r.slug, r.open_job_count]),
    );
  });
});
