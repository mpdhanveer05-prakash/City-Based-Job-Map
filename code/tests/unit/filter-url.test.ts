import { describe, expect, it } from "vitest";
import {
  COMPANY_TYPES,
  EMPTY_FILTERS,
  MAX_QUERY_LENGTH,
  STARTUP_STAGES,
  applyFilterChange,
  filtersSchema,
  isEmptyFilter,
  normalizeFilters,
  normalizeQuery,
  toSqlFilters,
  type Filters,
} from "@/lib/filters/schema";
import {
  defaultExplorerState,
  explorerHref,
  historyMode,
  parseCity,
  parseExplorerSearch,
  parseExplorerState,
  roundCamera,
  serializeExplorerSearch,
  type ExplorerState,
} from "@/lib/filters/url";

const search = (qs: string) => new URLSearchParams(qs);
const state = (patch: Partial<ExplorerState> = {}): ExplorerState => ({
  ...defaultExplorerState("bangalore"),
  ...patch,
});
const filters = (patch: Partial<Filters>): Filters => normalizeFilters({ ...EMPTY_FILTERS, ...patch });

describe("parseCity", () => {
  it("accepts the two launch cities", () => {
    expect(parseCity("bangalore")).toBe("bangalore");
    expect(parseCity("chennai")).toBe("chennai");
  });

  it("rejects everything else, including the alias that _redirects handles", () => {
    expect(parseCity("bengaluru")).toBeNull();
    expect(parseCity("Chennai")).toBeNull();
    expect(parseCity("mumbai")).toBeNull();
    expect(parseCity("")).toBeNull();
    expect(parseCity(null)).toBeNull();
    expect(parseCity(undefined)).toBeNull();
  });

  it("gives no state for an unknown city", () => {
    expect(parseExplorerState("mumbai", search(""))).toBeNull();
    expect(parseExplorerState("chennai", search("view=list"))?.city).toBe("chennai");
  });
});

describe("parseExplorerSearch: defaults and tolerance", () => {
  it("an empty query string is the default state", () => {
    expect(parseExplorerSearch(search(""))).toEqual({
      view: "map",
      filters: EMPTY_FILTERS,
      company: null,
      camera: null,
    });
  });

  it("reads a full URL", () => {
    const s = parseExplorerSearch(
      search(
        "view=list&q=backend%20engineer&type=startup,mnc&stage=seed,series_a&hood=indiranagar&park=etv&sector=fintech&company=amber-forge-synthetic&map=12.9716,77.5946,11.5",
      ),
    );
    expect(s).toEqual({
      view: "list",
      filters: {
        q: "backend engineer",
        types: ["startup", "mnc"],
        stages: ["seed", "series_a"],
        neighbourhoods: ["indiranagar"],
        tech_parks: ["etv"],
        sectors: ["fintech"],
      },
      company: "amber-forge-synthetic",
      camera: { lat: 12.9716, lng: 77.5946, zoom: 11.5 },
    });
  });

  it("drops bad values and keeps the good ones", () => {
    const s = parseExplorerSearch(search("type=bogus,startup,,MNC&view=sideways&hood=Not A Slug,koramangala"));
    expect(s.view).toBe("map");
    expect(s.filters.types).toEqual(["startup", "mnc"]);
    expect(s.filters.neighbourhoods).toEqual(["koramangala"]);
  });

  it("ignores a company that is not a slug", () => {
    expect(parseExplorerSearch(search("company=Not%20A%20Slug")).company).toBeNull();
    expect(parseExplorerSearch(search("company=")).company).toBeNull();
    expect(parseExplorerSearch(search("company=../../etc")).company).toBeNull();
  });

  it("takes the first value when a parameter is repeated, and reads a plain record too", () => {
    expect(parseExplorerSearch(search("view=grid&view=list")).view).toBe("grid");
    expect(parseExplorerSearch({ view: ["list", "grid"], type: "product", q: undefined })).toMatchObject({
      view: "list",
      filters: { types: ["product"] },
    });
  });

  it("is case-insensitive for values and de-duplicates them", () => {
    expect(parseExplorerSearch(search("type=STARTUP,startup,Mnc")).filters.types).toEqual(["startup", "mnc"]);
    expect(parseExplorerSearch(search("sector=saas,fintech,saas")).filters.sectors).toEqual(["fintech", "saas"]);
  });

  it("never throws on junk", () => {
    for (const junk of ["%", "type=%E0%A4%A", "map=,,", "map=1,2", "q=" + "x".repeat(10_000), "&&&===", "view[]=list"]) {
      expect(() => parseExplorerSearch(search(junk))).not.toThrow();
    }
  });
});

describe("the camera parameter", () => {
  const cam = (v: string) => parseExplorerSearch(search(`map=${v}`)).camera;

  it("parses latitude, longitude, and zoom, rounded to the URL's precision", () => {
    expect(cam("12.971599,77.594566,11.499")).toEqual({ lat: 12.9716, lng: 77.59457, zoom: 11.5 });
  });

  it.each([
    ["too few parts", "12.97,77.59"],
    ["too many parts", "12.97,77.59,11,1"],
    ["not numbers", "a,b,c"],
    ["empty parts (Number('') is 0)", ",,"],
    ["latitude out of range", "91,77,11"],
    ["longitude out of range", "12,181,11"],
    ["negative zoom", "12,77,-1"],
    ["zoom above the maximum", "12,77,23"],
    ["infinity", "Infinity,0,5"],
    ["NaN", "NaN,0,5"],
  ])("rejects %s", (_name, value) => {
    expect(cam(value)).toBeNull();
  });

  it("accepts the limits", () => {
    expect(cam("-90,-180,0")).toEqual({ lat: -90, lng: -180, zoom: 0 });
    expect(cam("90,180,22")).toEqual({ lat: 90, lng: 180, zoom: 22 });
  });
});

describe("stages need Startup (ADR-0004)", () => {
  it("a URL with stages and no types is corrected on load", () => {
    expect(parseExplorerSearch(search("stage=seed")).filters.stages).toEqual([]);
  });

  it("a URL with stages and only MNC is corrected on load", () => {
    expect(parseExplorerSearch(search("type=mnc&stage=seed")).filters.stages).toEqual([]);
  });

  it("stages stay while Startup is selected, with other types", () => {
    expect(parseExplorerSearch(search("type=mnc,startup&stage=seed")).filters).toMatchObject({
      types: ["startup", "mnc"],
      stages: ["seed"],
    });
  });

  it("deselecting Startup clears the stages from the state and from the URL", () => {
    const before = filters({ types: ["startup", "mnc"], stages: ["seed", "series_a"] });
    const after = applyFilterChange(before, { types: ["mnc"] });
    expect(after.stages).toEqual([]);
    expect(serializeExplorerSearch(state({ filters: after }))).toBe("type=mnc");
  });

  it("a stage change that keeps Startup leaves the other groups alone", () => {
    const before = filters({ types: ["startup"], stages: ["seed"], sectors: ["fintech"] });
    const after = applyFilterChange(before, { stages: ["seed", "public"] });
    expect(after.stages).toEqual(["seed", "public"]);
    expect(after.sectors).toEqual(["fintech"]);
  });

  it("selecting a type does not invent stages", () => {
    expect(applyFilterChange(EMPTY_FILTERS, { types: ["startup"] }).stages).toEqual([]);
  });
});

describe("serializeExplorerSearch is canonical", () => {
  it("the default state has an empty query string", () => {
    expect(serializeExplorerSearch(state())).toBe("");
    expect(explorerHref(state())).toBe("/bangalore");
  });

  it("omits the default view but writes the others", () => {
    expect(serializeExplorerSearch(state({ view: "map" }))).toBe("");
    expect(serializeExplorerSearch(state({ view: "grid" }))).toBe("view=grid");
    expect(serializeExplorerSearch(state({ view: "list" }))).toBe("view=list");
  });

  it("writes parameters in a fixed order, whatever order the state was built in", () => {
    const s = state({
      view: "list",
      company: "x-co",
      filters: filters({ sectors: ["saas"], q: "go", types: ["mnc", "startup"], neighbourhoods: ["adyar"] }),
    });
    expect(serializeExplorerSearch(s)).toBe("view=list&q=go&type=startup%2Cmnc&hood=adyar&sector=saas&company=x-co");
  });

  it("gives one URL for every ordering of the same selection", () => {
    const a = serializeExplorerSearch(state({ filters: filters({ types: ["product", "startup"] }) }));
    const b = serializeExplorerSearch(state({ filters: filters({ types: ["startup", "product", "startup"] }) }));
    const fromUrl = serializeExplorerSearch(state(parseExplorerSearch(search("type=product,startup"))));
    expect(a).toBe(b);
    expect(a).toBe(fromUrl);
  });

  it("normalises on the way out too: stages without Startup are never written", () => {
    const raw = { ...EMPTY_FILTERS, types: ["mnc"], stages: ["seed"] } as Filters;
    expect(serializeExplorerSearch(state({ filters: raw }))).toBe("type=mnc");
  });

  it("writes the camera to fixed precision", () => {
    expect(serializeExplorerSearch(state({ camera: { lat: 12.9716, lng: 77.5946, zoom: 11 } }))).toBe(
      "map=12.97160%2C77.59460%2C11.00",
    );
  });

  it("builds a link", () => {
    expect(explorerHref(state({ city: "chennai", view: "list", filters: filters({ types: ["startup"] }) }))).toBe(
      "/chennai?view=list&type=startup",
    );
  });
});

describe("search text", () => {
  it("collapses white space, trims, and cuts to the maximum length", () => {
    expect(normalizeQuery("  backend   engineer \n")).toBe("backend engineer");
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery("x".repeat(500))).toHaveLength(MAX_QUERY_LENGTH);
    expect(normalizeQuery("a ".repeat(200)).length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    expect(normalizeQuery("a ".repeat(200)).endsWith(" ")).toBe(false);
  });

  it.each(["c++ & go", "100% remote", "a=b&c=d", "plus+sign", "ಬೆಂಗಳೂರು", "ünï côdé", "tab\there", "quote\"s' <b>"])(
    "survives the URL round trip: %s",
    (q) => {
      const s = state({ filters: filters({ q }) });
      const back = parseExplorerSearch(search(serializeExplorerSearch(s)));
      expect(back.filters.q).toBe(normalizeQuery(q));
    },
  );
});

describe("round trip over generated states", () => {
  // A small seeded generator (mulberry32), so a failure can be reproduced.
  function rng(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SLUGS = ["indiranagar", "koramangala", "adyar", "etv", "tidel-park", "fintech", "saas", "ai-data", "a", "x1-y2"];
  const QUERIES = ["", "backend engineer", "c++ & go", "100% remote", "ಬೆಂಗಳೂರು", "a=b&c=d", "  spaced   out ", "x".repeat(150)];

  function randomState(r: () => number): ExplorerState {
    const some = <T>(pool: readonly T[]): T[] => pool.filter(() => r() < 0.35);
    return {
      city: r() < 0.5 ? "bangalore" : "chennai",
      view: (["map", "grid", "list"] as const)[Math.floor(r() * 3)],
      filters: {
        q: QUERIES[Math.floor(r() * QUERIES.length)],
        types: some(COMPANY_TYPES),
        // Deliberately not tied to the types: the normaliser must repair the combination.
        stages: some(STARTUP_STAGES),
        neighbourhoods: some(SLUGS),
        tech_parks: some(SLUGS),
        sectors: some(SLUGS),
      },
      company: r() < 0.4 ? SLUGS[Math.floor(r() * SLUGS.length)] : null,
      camera:
        r() < 0.5
          ? { lat: (r() - 0.5) * 180, lng: (r() - 0.5) * 360, zoom: r() * 22 }
          : null,
    };
  }

  it("parse(serialize(state)) is the normalised state, for 3,000 random states", () => {
    const r = rng(20261003);
    for (let i = 0; i < 3000; i++) {
      const s = randomState(r);
      const expected = {
        view: s.view,
        filters: normalizeFilters(s.filters),
        company: s.company,
        camera: s.camera ? roundCamera(s.camera) : null,
      };
      const qs = serializeExplorerSearch(s);
      expect(parseExplorerSearch(search(qs)), `state ${i}: ${qs}`).toEqual(expected);
    }
  });

  it("serialising twice gives the same string (idempotent), for 3,000 random states", () => {
    const r = rng(7);
    for (let i = 0; i < 3000; i++) {
      const s = randomState(r);
      const once = serializeExplorerSearch(s);
      const twice = serializeExplorerSearch({ ...s, ...parseExplorerSearch(search(once)) });
      expect(twice, `state ${i}`).toBe(once);
    }
  });

  it("every parsed filter satisfies the strict schema", () => {
    const r = rng(99);
    for (let i = 0; i < 1000; i++) {
      const s = randomState(r);
      const parsed = parseExplorerSearch(search(serializeExplorerSearch(s)));
      expect(filtersSchema.safeParse(parsed.filters).success, `state ${i}`).toBe(true);
    }
  });

  it("never leaves stages without Startup, whatever the input", () => {
    const r = rng(5);
    for (let i = 0; i < 2000; i++) {
      const f = normalizeFilters(randomState(r).filters);
      if (f.stages.length > 0) expect(f.types).toContain("startup");
    }
  });
});

describe("history mode: Back and Forward step through choices, not pans", () => {
  const base = state({ filters: filters({ types: ["startup"] }) });

  it("no change does nothing", () => {
    expect(historyMode(base, { ...base })).toBe("none");
  });

  it("a state that normalises to the same URL is no change", () => {
    const sloppy = state({ filters: { ...base.filters, q: "   ", types: ["startup", "startup"] } });
    expect(historyMode(base, sloppy)).toBe("none");
  });

  it("a camera-only change replaces the current entry", () => {
    expect(historyMode(base, { ...base, camera: { lat: 12.9, lng: 77.5, zoom: 12 } })).toBe("replace");
    const moved = { ...base, camera: { lat: 12.9, lng: 77.5, zoom: 12 } };
    expect(historyMode(moved, { ...moved, camera: { lat: 13, lng: 77.6, zoom: 12.5 } })).toBe("replace");
  });

  it.each([
    ["the view", { view: "list" as const }],
    ["the filters", { filters: filters({ types: ["startup", "mnc"] }) }],
    ["the selected company", { company: "x-co" }],
  ])("a change to %s adds an entry", (_name, patch) => {
    expect(historyMode(base, { ...base, ...patch })).toBe("push");
  });

  it("a camera change together with a filter change adds an entry", () => {
    expect(historyMode(base, { ...base, filters: filters({ types: ["mnc"] }), camera: { lat: 1, lng: 1, zoom: 5 } })).toBe(
      "push",
    );
  });

  it("changing city adds an entry", () => {
    expect(historyMode(base, { ...base, city: "chennai" })).toBe("push");
  });
});

describe("the SQL filter JSON", () => {
  it("leaves out empty groups and uses the SQL key names", () => {
    expect(toSqlFilters(EMPTY_FILTERS)).toEqual({});
    expect(
      toSqlFilters(
        filters({ q: "go", types: ["startup", "mnc"], stages: ["seed"], neighbourhoods: ["a"], tech_parks: ["b"], sectors: ["c"] }),
      ),
    ).toEqual({
      q: "go",
      types: ["startup", "mnc"],
      stages: ["seed"],
      neighbourhoods: ["a"],
      tech_parks: ["b"],
      sectors: ["c"],
    });
  });

  it("only ever uses keys the SQL function accepts (docs/filters.md)", () => {
    const accepted = new Set(["q", "types", "stages", "neighbourhoods", "tech_parks", "sectors"]);
    const full = filters({ q: "x", types: ["startup"], stages: ["seed"], neighbourhoods: ["a"], tech_parks: ["b"], sectors: ["c"] });
    for (const key of Object.keys(toSqlFilters(full))) expect(accepted.has(key)).toBe(true);
  });

  it("knows when a filter is empty", () => {
    expect(isEmptyFilter(EMPTY_FILTERS)).toBe(true);
    expect(isEmptyFilter(filters({ q: "x" }))).toBe(false);
    expect(isEmptyFilter(filters({ sectors: ["saas"] }))).toBe(false);
  });
});
