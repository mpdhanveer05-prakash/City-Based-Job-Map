// P4-01: the TypeScript filter (lib/filters/filter.ts) and the SQL functions return the same results
// over the same data (ADR-0006, docs/testing.md "Filter parity").
//
// For each launch city it takes the SQL snapshot, pushes it through the same split / JSON / merge the
// build uses, and then compares, over a matrix of filters:
//   company_filter   vs companyFilter     the matching company IDs
//   city_points      vs cityPoints        the office points
//   search_companies vs searchCompanies   the list, in order, with its counts
//   company_facets   vs companyFacets     every facet count
// Extra companies with awkward text (accents, Kannada, a final sigma, an emoji, %, _, a backslash, a
// non-breaking space) are inserted inside a transaction that is rolled back, so case folding and
// white-space handling are compared on data the seed does not have.
//
// Needs the seeded local database: `npx supabase db start && npx supabase db reset`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { citySnapshotSchema, mergeDataset, splitSnapshot, type CityDataset } from "@/lib/filters/dataset";
import { cityPoints, companyFacets, companyFilter, prepareIndex, searchCompanies, type FilterIndex } from "@/lib/filters/filter";
import {
  COMPANY_TYPES,
  EMPTY_FILTERS,
  OWNERSHIP_STATUSES,
  STARTUP_STAGES,
  normalizeFilters,
  toSqlFilters,
  type Filters,
} from "@/lib/filters/schema";

const DATABASE_URL = process.env.PARITY_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CITIES = ["bangalore", "chennai"] as const;

let client: Client;
const datasets = new Map<string, { index: FilterIndex; dataset: CityDataset; bytes: Record<string, number> }>();

const TRICKY_COMPANIES: { name: string; slug: string; types: string[]; stage: string | null; address: string; founder?: string; job?: string }[] = [
  { name: "Éclair Labs (synthetic)", slug: "eclair-labs-tricky", types: ["startup"], stage: "seed", address: "12 Çankaya Road", founder: "Zoë Müller", job: "Ingénieur Données" },
  { name: "ÜNAL Works (synthetic)", slug: "unal-works-tricky", types: ["mnc"], stage: null, address: "5 Rue de l’Église" },
  { name: "ಬೆಂಗಳೂರು Systems (synthetic)", slug: "kannada-systems-tricky", types: ["product"], stage: null, address: "ಬೆಂಗಳೂರು ರಸ್ತೆ" },
  { name: "STRAẞE Co (synthetic)", slug: "strasse-co-tricky", types: ["startup", "product"], stage: "series_a", address: "Straße 7" },
  { name: "ΑΣ Sigma (synthetic)", slug: "sigma-tricky", types: ["product"], stage: null, address: "ΟΔΟΣ Σοφίας" },
  { name: "😀 Smile (synthetic)", slug: "smile-tricky", types: ["mnc"], stage: null, address: "Emoji Lane 😀" },
  { name: "Fifty%Off_Co\\ (synthetic)", slug: "fifty-off-tricky", types: ["product"], stage: null, address: "100% Off_Street\\" },
  { name: "Nbsp\u00a0Name (synthetic)", slug: "nbsp-name-tricky", types: ["startup"], stage: "bootstrapped", address: "Non\u00a0Breaking Road" },
  { name: "İstanbul Labs (synthetic)", slug: "istanbul-labs-tricky", types: ["mnc", "product"], stage: null, address: "İnönü Cad." },
  // U+FF5E sorts before the emoji by code point but after it by UTF-16 unit: tells the two orderings apart.
  { name: "～ Fullwidth Works (synthetic)", slug: "fullwidth-tricky", types: ["product"], stage: null, address: "Tilde Row" },
];

async function insertTrickyFixtures(): Promise<void> {
  let n = 0;
  for (const t of TRICKY_COMPANIES) {
    n += 1;
    const lng = 77.5 + n * 0.01;
    await client.query(
      `with c as (
         insert into company (slug, name, domain, website_url, status, startup_stage, source_id, is_synthetic)
         values ($1::text, $2::text, $1::text || '.example', 'https://' || $1::text || '.example', 'published', $3::startup_stage,
                 (select id from source order by id limit 1), true)
         returning id
       ), tags as (
         insert into company_type_tag (company_id, type)
         select c.id, unnest($4::company_type[]) from c
       ), o as (
         insert into office (company_id, city_id, neighbourhood_id, address, geom, accuracy, status)
         select c.id, (select id from city where slug = 'bangalore'),
                (select id from neighbourhood where slug = 'indiranagar'),
                $5::text, ('SRID=4326;POINT(' || $6::text || ' 12.99)')::geography, 'building', 'published'
         from c
       ), f as (
         insert into company_founder (company_id, full_name, source_url, status)
         select c.id, $7::text, 'https://' || $1::text || '.example/about', 'published' from c where $7::text is not null
       ), j as (
         insert into job (company_id, source_id, title, title_norm, apply_url, dedup_hash, status)
         select c.id, (select id from source order by id limit 1), $8::text, lower($8::text), 'https://' || $1::text || '.example/j/1',
                decode(md5($1::text), 'hex'), 'active'
         from c where $8::text is not null
         returning id, company_id
       )
       insert into job_city (job_id, city_id)
       select j.id, (select id from city where slug = 'bangalore') from j`,
      [t.slug, t.name, t.stage, t.types, t.address, lng, t.founder ?? null, t.job ?? null],
    );
  }
}

beforeAll(async () => {
  client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const seeded = await client.query("select count(*)::int as n from company where source_id = 1 and slug like '%-synthetic'");
  if (seeded.rows[0].n < 60) {
    throw new Error("The seed is not loaded. Run `npx supabase db reset` first (see docs/testing.md).");
  }
  await client.query("begin");
  await insertTrickyFixtures();
  // Read as the build does: the anonymous role, through RLS.
  await client.query("set local role anon");

  for (const city of CITIES) {
    const res = await client.query("select city_build_snapshot($1) as s", [city]);
    const snapshot = citySnapshotSchema.parse(res.rows[0].s);
    const files = splitSnapshot(snapshot);
    // Round-trip the three files the browser loads through JSON, as the build and the browser do.
    const bytes: Record<string, number> = {};
    const loaded: Record<string, unknown> = {};
    for (const [name, data] of Object.entries(files)) {
      const text = JSON.stringify(data);
      bytes[name] = Buffer.byteLength(text);
      loaded[name] = JSON.parse(text);
    }
    const dataset = mergeDataset(loaded as unknown as Parameters<typeof mergeDataset>[0]);
    datasets.set(city, { index: prepareIndex(dataset), dataset, bytes });
  }
});

afterAll(async () => {
  if (client) {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
});

// A small seeded generator (mulberry32) so a failing filter can be reproduced.
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vocabulary(dataset: CityDataset): string[] {
  const words = new Set<string>();
  const add = (text: string) => {
    for (const w of text.toLowerCase().split(/[ \t\n\r\f\v]+/)) if (w) words.add(w);
  };
  for (const c of dataset.companies) add(c.name);
  for (const n of dataset.neighbourhoods) add(n.name);
  for (const t of dataset.tech_parks) add(t.name);
  for (const o of dataset.offices) add(o.address);
  for (const s of dataset.search) {
    for (const j of s.jobs) add(j);
    for (const f of s.founders) add(f);
  }
  return [...words].sort();
}

const HANDCRAFTED_QUERIES = [
  "", "   ", "synthetic", "SYNTHETIC", "engineer", "backend engineer", "zzzz", "%", "_", "\\", "100%", "off_",
  "éclair", "ÉCLAIR", "Éclair", "ünal", "ÜNAL", "straße", "STRAẞE", "strasse", "ß", "σ", "ας", "ΑΣ", "Σ",
  "ಬೆಂಗಳೂರು", "ರಸ್ತೆ", "😀", "emoji", "i̇stanbul", "İstanbul", "istanbul", "zoë", "MÜLLER", "ingénieur", "données",
  "nbsp name", "nbsp\u00a0name", "name\u00a0nbsp", "non breaking", "non\u00a0breaking", "road\u00a0non", "synthetic\u00a0works", "name\u0085nbsp", "name\u3000nbsp", "name\ufeffnbsp", "name\u001fnbsp", "name\u2003\u2003nbsp", "tidel", "indiranagar", "embassy village",
  "road", "synthetic road", " leading and trailing ", "a  b", "x".repeat(300),
];

function randomFilters(r: () => number, dataset: CityDataset, words: string[]): Filters {
  // A group is active about a third of the time, and then holds one to three values, so most filters
  // combine two or three groups and a good share of them match something.
  const group = <T>(pool: readonly T[]): T[] => {
    if (r() > 0.35) return [];
    const picked = pool.filter(() => r() < 0.4);
    return picked.length > 0 ? picked : [pool[Math.floor(r() * pool.length)]];
  };
  const pickWord = () => words[Math.floor(r() * words.length)] ?? "x";
  let q = "";
  const mode = r();
  if (mode < 0.2) {
    q = HANDCRAFTED_QUERIES[Math.floor(r() * HANDCRAFTED_QUERIES.length)];
  } else if (mode < 0.4) {
    const n = 1 + Math.floor(r() * 2);
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      let w = pickWord();
      // Cut by code point: halving by UTF-16 unit can split an emoji into a lone surrogate, which is not valid JSON text.
      if (r() < 0.3) w = Array.from(w).slice(0, Math.max(1, Math.ceil(Array.from(w).length / 2))).join("");
      if (r() < 0.2) w = w.toUpperCase();
      parts.push(w);
    }
    q = parts.join(r() < 0.2 ? "   " : " ");
  }
  // Stages are deliberately independent of the types: both sides must treat "stages without Startup" alike.
  return {
    q,
    types: group(COMPANY_TYPES),
    stages: group(STARTUP_STAGES),
    neighbourhoods: group(dataset.neighbourhoods.map((n) => n.slug)),
    tech_parks: group(dataset.tech_parks.map((t) => t.slug)),
    sectors: group(dataset.sectors.map((s) => s.slug)),
    statuses: group(OWNERSHIP_STATUSES),
  };
}

const HANDCRAFTED_FILTERS: Partial<Filters>[] = [
  {},
  { types: ["startup"] },
  { types: ["mnc"] },
  { types: ["product"] },
  { types: ["startup", "mnc"] },
  { types: ["startup", "product"] },
  { types: ["startup"], stages: ["seed"] },
  { types: ["startup"], stages: ["seed", "pre_seed", "series_a"] },
  { types: ["mnc", "startup"], stages: ["seed"] },
  { types: ["mnc"], stages: ["seed"] },
  { stages: ["seed"] },
  { types: ["startup"], stages: ["bootstrapped"] },
  // Ownership status (ADR-0017): independent of the type group, and an unknown status never matches.
  { statuses: ["public"] },
  { statuses: ["acquired"] },
  { statuses: ["private", "public"] },
  { statuses: ["public"], types: ["mnc"] },
  { statuses: ["acquired"], types: ["startup"], stages: ["seed"] },
  { statuses: ["private"], sectors: ["fintech"], q: "a" },
  { neighbourhoods: ["indiranagar"] },
  { neighbourhoods: ["indiranagar", "koramangala"], types: ["startup"] },
  { tech_parks: ["embassy-tech-village"] },
  { tech_parks: ["tidel-park"], types: ["mnc"] },
  { sectors: ["fintech"] },
  { sectors: ["fintech", "saas"], types: ["startup"], stages: ["series_a"] },
  { q: "engineer", types: ["startup"] },
  { q: "road", neighbourhoods: ["koramangala"] },
];

type Case = { city: (typeof CITIES)[number]; filters: Filters; label: string };

function buildCases(): Case[] {
  const cases: Case[] = [];
  for (const city of CITIES) {
    const { dataset } = datasets.get(city)!;
    const words = vocabulary(dataset);
    for (const patch of HANDCRAFTED_FILTERS) {
      const filters = { ...EMPTY_FILTERS, ...patch } as Filters;
      cases.push({ city, filters, label: JSON.stringify(patch) });
    }
    for (const q of HANDCRAFTED_QUERIES) {
      cases.push({ city, filters: { ...EMPTY_FILTERS, q }, label: `q=${JSON.stringify(q.slice(0, 40))}` });
    }
    const r = rng(city === "bangalore" ? 20261003 : 20261004);
    for (let i = 0; i < 250; i++) {
      const filters = randomFilters(r, dataset, words);
      cases.push({ city, filters, label: `random #${i} ${JSON.stringify(filters).slice(0, 160)}` });
    }
  }
  return cases;
}

/** What the SQL side is given. Not normalised: the SQL functions must cope with the raw object. */
const sqlJson = (f: Filters) => JSON.stringify(toSqlFilters(f));

describe("snapshot", () => {
  it("is valid, deterministic, and holds the same companies as company_filter", async () => {
    for (const city of CITIES) {
      const { dataset } = datasets.get(city)!;
      const sql = await client.query("select company_filter($1, '{}') as id", [city]);
      expect(dataset.companies.map((c) => c.id).sort()).toEqual(sql.rows.map((r) => r.id).sort());
      const again = await client.query("select city_build_snapshot($1) = city_build_snapshot($1) as same", [city]);
      expect(again.rows[0].same).toBe(true);
    }
  });

  it("includes the awkward companies in Bengaluru and none in Chennai", () => {
    const names = new Set(datasets.get("bangalore")!.dataset.companies.map((c) => c.slug));
    for (const t of TRICKY_COMPANIES) expect(names.has(t.slug), t.slug).toBe(true);
    const chennai = new Set(datasets.get("chennai")!.dataset.companies.map((c) => c.slug));
    for (const t of TRICKY_COMPANIES) expect(chennai.has(t.slug), t.slug).toBe(false);
  });

  it("records the dataset size", () => {
    const rows = CITIES.map((city) => {
      const { dataset, bytes } = datasets.get(city)!;
      return {
        city,
        companies: dataset.companies.length,
        offices: dataset.offices.length,
        jobs_in_search: dataset.search.reduce((n, s) => n + s.jobs.length, 0),
        ...Object.fromEntries(Object.entries(bytes).map(([k, v]) => [`${k}.json bytes`, v])),
      };
    });
    console.table(rows);
    expect(rows.every((r) => r.companies > 0 && r.offices > 0)).toBe(true);
  });
});

describe("filter parity: SQL and TypeScript return the same results", () => {
  it("company IDs (company_filter vs companyFilter)", async () => {
    const cases = buildCases();
    let nonEmpty = 0;
    for (const c of cases) {
      const { index } = datasets.get(c.city)!;
      const sql = await client.query("select company_filter($1, $2::jsonb) as id", [c.city, sqlJson(c.filters)]);
      const expected = sql.rows.map((r) => r.id as string).sort();
      const actual = companyFilter(index, c.filters).sort();
      expect(actual, `${c.city} ${c.label}`).toEqual(expected);
      if (expected.length > 0) nonEmpty += 1;
    }
    // The matrix must exercise real matches, not only empty results.
    expect(cases.length).toBeGreaterThan(550);
    expect(nonEmpty).toBeGreaterThan(cases.length * 0.4);
  });

  it("office points (city_points vs cityPoints)", async () => {
    for (const c of buildCases()) {
      const { index } = datasets.get(c.city)!;
      const sql = await client.query("select office_id, company_id, lng, lat, accuracy from city_points($1, $2::jsonb)", [
        c.city,
        sqlJson(c.filters),
      ]);
      const expected = sql.rows.map((r) => [r.office_id, r.company_id, r.lng, r.lat, r.accuracy]);
      const actual = cityPoints(index, c.filters).map((o) => [o.id, o.company_id, o.lng, o.lat, o.accuracy]);
      expect(actual, `${c.city} ${c.label}`).toEqual(expected);
    }
  });

  it("the list, in order, with its counts (search_companies vs searchCompanies)", async () => {
    for (const c of buildCases()) {
      const { index } = datasets.get(c.city)!;
      for (const [limit, offset] of [[100000, 0], [7, 3]] as const) {
        const sql = await client.query(
          "select company_id, slug, name, logo_key, types, startup_stage, ownership_status, office_count, open_job_count from search_companies($1, $2::jsonb, $3, $4)",
          [c.city, sqlJson(c.filters), limit, offset],
        );
        const expected = sql.rows.map((r) => ({ ...r }));
        const actual = searchCompanies(index, c.filters, limit, offset).map((r) => ({ ...r }));
        expect(actual, `${c.city} ${c.label} limit ${limit} offset ${offset}`).toEqual(expected);
      }
    }
  });

  it("every facet count (company_facets vs companyFacets)", async () => {
    for (const c of buildCases()) {
      const { index } = datasets.get(c.city)!;
      const sql = await client.query("select facet, value, company_count from company_facets($1, $2::jsonb)", [
        c.city,
        sqlJson(c.filters),
      ]);
      const key = (r: { facet: string; value: string; company_count: number }) => `${r.facet}:${r.value}`;
      const expected = Object.fromEntries(sql.rows.map((r) => [key(r), r.company_count]));
      const actual = Object.fromEntries(companyFacets(index, c.filters).map((r) => [key(r), r.company_count]));
      expect(actual, `${c.city} ${c.label}`).toEqual(expected);
    }
  });

  it("agrees on normalised filters too (the URL path) and on the mirror's own invariants", () => {
    for (const c of buildCases().slice(0, 200)) {
      const { index } = datasets.get(c.city)!;
      const normal = normalizeFilters(c.filters);
      const ids = companyFilter(index, normal);
      expect(new Set(ids).size, c.label).toBe(ids.length); // each company once
      expect(cityPoints(index, normal).map((o) => o.company_id).every((id) => ids.includes(id)), c.label).toBe(true);
      expect(companyFacets(index, normal)[0].company_count, c.label).toBe(ids.length);
    }
  });
});
