import { describe, expect, it } from "vitest";
import { citySnapshotSchema, mergeDataset, splitSnapshot } from "@/lib/filters/dataset";
import { prepareIndex } from "@/lib/filters/filter";
import { EMPTY_FILTERS, normalizeFilters } from "@/lib/filters/schema";
import { hashFilters } from "@/lib/explorer/filter-hash";
import { buildSuggestions, MIN_SUGGEST_LENGTH, SUGGESTION_LIMITS } from "@/lib/explorer/suggestions";
import { companies, jobs, offices, resultSummary } from "@/lib/explorer/labels";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const company = (n: number, name: string) => ({
  id: id(n), slug: name.toLowerCase().replace(/\W+/g, "-"), name, logo_key: null, description: null, website_url: `https://c${n}.example`,
  careers_url: null, startup_stage: null, last_verified_at: null, types: ["startup"], sectors: [], founders: [],
});
const snapshot = citySnapshotSchema.parse({
  version: 1,
  city: { slug: "bangalore", name: "Bengaluru", aliases: [], status: "beta", centre: [77.6, 12.97], default_zoom: 11, data_version: 1,
    boundary: { type: "MultiPolygon", coordinates: [[[[77, 12], [78, 12], [78, 13], [77, 13], [77, 12]]]] } },
  synthetic_companies: 0,
  slug_redirects: [],
  neighbourhoods: [{ slug: "koramangala", name: "Koramangala" }, { slug: "indiranagar", name: "Indiranagar" }],
  tech_parks: [{ slug: "kora-park", name: "Kora Tech Park" }],
  sectors: [],
  companies: [company(1, "Koral Systems"), company(2, "Amber Forge"), company(3, "Kora Labs"), company(4, "Zeta Koral"), company(5, "Amber Mint")],
  offices: [],
  jobs: [
    { id: id(21), company_id: id(1), title: "Backend Engineer", apply_url: "https://c1.example/1", status: "active", last_checked_at: null },
    { id: id(22), company_id: id(2), title: "Backend Engineer", apply_url: "https://c2.example/1", status: "active", last_checked_at: null },
    { id: id(23), company_id: id(2), title: "Site Reliability Engineer", apply_url: "https://c2.example/2", status: "active", last_checked_at: null },
    { id: id(24), company_id: id(3), title: "Hidden Role", apply_url: "https://c3.example/1", status: "suspect", last_checked_at: null },
  ],
});
const files = splitSnapshot(snapshot);
const withSearch = prepareIndex(mergeDataset(files));
const withoutSearch = prepareIndex({ ...mergeDataset(files), search: [] });

describe("buildSuggestions", () => {
  it("offers nothing for fewer than two characters or only white space", () => {
    expect(MIN_SUGGEST_LENGTH).toBe(2);
    expect(buildSuggestions(withSearch, "k")).toEqual([]);
    expect(buildSuggestions(withSearch, "   ")).toEqual([]);
    expect(buildSuggestions(withSearch, "")).toEqual([]);
  });

  it("puts names that start with the text before names that only contain it", () => {
    const names = buildSuggestions(withSearch, "kor")
      .filter((s) => s.kind === "company")
      .map((s) => s.label);
    expect(names).toEqual(["Koral Systems", "Kora Labs", "Zeta Koral"]);
  });

  it("offers companies, then areas, then job titles, each of a kind the box can act on", () => {
    const kinds = buildSuggestions(withSearch, "kor").map((s) => s.kind);
    expect(kinds).toEqual(["company", "company", "company", "neighbourhood", "tech_park"]);
    const jobs = buildSuggestions(withSearch, "engineer");
    expect(jobs.map((s) => s.kind)).toEqual(["job", "job"]);
    expect(jobs.map((s) => s.label)).toEqual(["Backend Engineer", "Site Reliability Engineer"]);
  });

  it("lists a job title once however many companies have it, and never a suspect job's title", () => {
    const titles = buildSuggestions(withSearch, "backend").filter((s) => s.kind === "job");
    expect(titles).toHaveLength(1);
    expect(buildSuggestions(withSearch, "hidden")).toEqual([]);
  });

  it("has no job titles until the search file has loaded", () => {
    expect(buildSuggestions(withoutSearch, "engineer")).toEqual([]);
    expect(buildSuggestions(withoutSearch, "amber").map((s) => s.kind)).toEqual(["company", "company"]);
  });

  it("is case-insensitive, matches several words, and respects the limits", () => {
    expect(buildSuggestions(withSearch, "AMBER FORGE").map((s) => s.label)).toEqual(["Amber Forge"]);
    expect(buildSuggestions(withSearch, "amber").length).toBeLessThanOrEqual(SUGGESTION_LIMITS.company + 3 + SUGGESTION_LIMITS.job);
    expect(buildSuggestions(withSearch, "Amber F").map((s) => s.label)).toEqual(["Amber Forge"]);
  });

  it("every suggested company leads to a non-empty result", () => {
    for (const s of buildSuggestions(withSearch, "ko")) {
      if (s.kind === "company") expect(withSearch.dataset.companies.some((c) => c.slug === s.slug)).toBe(true);
    }
  });
});

describe("hashFilters", () => {
  it("names the empty filter none", () => {
    expect(hashFilters({ ...EMPTY_FILTERS })).toBe("none");
  });

  it("is stable, and different filters give different names", () => {
    const a = normalizeFilters({ types: ["startup"], stages: ["seed"] });
    expect(hashFilters(a)).toBe(hashFilters(normalizeFilters({ types: ["startup"], stages: ["seed"] })));
    const names = new Set([
      hashFilters(a),
      hashFilters(normalizeFilters({ types: ["startup"] })),
      hashFilters(normalizeFilters({ types: ["mnc"] })),
      hashFilters(normalizeFilters({ q: "amber" })),
      hashFilters(normalizeFilters({ q: "Amber" })),
      hashFilters(normalizeFilters({ neighbourhoods: ["koramangala"] })),
    ]);
    expect(names.size).toBe(6);
  });

  it("does not depend on the order values were chosen in", () => {
    expect(hashFilters(normalizeFilters({ types: ["product", "startup"] }))).toBe(hashFilters(normalizeFilters({ types: ["startup", "product"] })));
  });

  it("contains nothing a cluster key cannot hold", () => {
    expect(hashFilters(normalizeFilters({ q: "a:b c" }))).toMatch(/^[0-9a-z]+$/);
  });
});

describe("labels", () => {
  it("writes counts as words, singular and plural (design-system.md §7)", () => {
    expect(companies(1)).toBe("1 company");
    expect(companies(38)).toBe("38 companies");
    expect(offices(1)).toBe("1 office");
    expect(jobs(0)).toBe("0 open jobs");
    expect(jobs(1)).toBe("1 open job");
    expect(resultSummary(38, 41)).toBe("38 companies in 41 offices");
    expect(resultSummary(1, 1)).toBe("1 company in 1 office");
  });
});
