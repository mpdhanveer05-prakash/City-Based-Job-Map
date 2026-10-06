// The single TypeScript mirror of the SQL filter (`company_filter`, `city_points`,
// `search_companies`, `company_facets`; docs/filters.md). Map, Grid, List, and every count run
// through these functions over one city dataset. Nothing else filters anywhere (CLAUDE.md).
//
// A CI parity test (tests/parity) runs this and the SQL functions over the same data and requires
// identical results. When a rule changes, change the SQL, this file, and docs/filters.md together.
import type { CityDataset, CompanySummary, Office } from "./dataset.ts";
import {
  COMPANY_TYPES,
  OWNERSHIP_STATUSES,
  STARTUP_STAGES,
  WHITESPACE,
  type CompanyType,
  type Filters,
  type OwnershipStatus,
  type StartupStage,
} from "./schema.ts";

const EDGE_WHITESPACE = new RegExp(`^[${WHITESPACE}]+|[${WHITESPACE}]+$`, "g");
const WHITESPACE_RUN = new RegExp(`[${WHITESPACE}]+`);

/** What a search matches, per company, all lower case (the same fields as SQL `company_search_fields`). */
type Prepared = {
  company: CompanySummary;
  offices: Office[];
  fields: string[];
  openJobs: number;
};

export type FilterIndex = {
  dataset: CityDataset;
  prepared: Prepared[];
  neighbourhoodNames: Map<string, string>;
  techParkNames: Map<string, string>;
};

/**
 * Builds the lookup the filter uses. Call once when a dataset (or its search file) arrives, not per
 * filter change. Pass the dataset with `search` empty to filter before the search file has loaded:
 * a search then matches only names and locations.
 */
export function prepareIndex(dataset: CityDataset): FilterIndex {
  const neighbourhoodNames = new Map(dataset.neighbourhoods.map((n) => [n.slug, n.name]));
  const techParkNames = new Map(dataset.tech_parks.map((t) => [t.slug, t.name]));

  const officesByCompany = new Map<string, Office[]>();
  for (const o of dataset.offices) {
    const list = officesByCompany.get(o.company_id);
    if (list) list.push(o);
    else officesByCompany.set(o.company_id, [o]);
  }
  const searchByCompany = new Map(dataset.search.map((s) => [s.company_id, s]));

  const prepared = dataset.companies.map((company): Prepared => {
    const offices = officesByCompany.get(company.id) ?? [];
    const extra = searchByCompany.get(company.id);
    const fields = [company.name.toLowerCase()];
    for (const title of extra?.jobs ?? []) fields.push(title.toLowerCase());
    for (const o of offices) {
      if (o.neighbourhood) fields.push((neighbourhoodNames.get(o.neighbourhood) ?? "").toLowerCase());
      if (o.tech_park) fields.push((techParkNames.get(o.tech_park) ?? "").toLowerCase());
      fields.push(o.address.toLowerCase());
    }
    for (const name of extra?.founders ?? []) fields.push(name.toLowerCase());
    return { company, offices, fields, openJobs: company.open_jobs };
  });

  return { dataset, prepared, neighbourhoodNames, techParkNames };
}

/**
 * The words of a search: trimmed, lower-cased, split on the Unicode White_Space set. The SQL does the
 * same with the same spelled-out class; neither engine's own `\s` is used, because they differ.
 */
export function searchTokens(q: string): string[] {
  const trimmed = q.replace(EDGE_WHITESPACE, "").toLowerCase();
  return trimmed === "" ? [] : trimmed.split(WHITESPACE_RUN);
}

function matches(p: Prepared, f: Filters, tokens: string[]): boolean {
  const { company, offices } = p;

  if (f.types.length > 0) {
    const ok = company.types.some(
      (t) =>
        f.types.includes(t) &&
        (t !== "startup" ||
          f.stages.length === 0 ||
          (company.startup_stage !== null && f.stages.includes(company.startup_stage))),
    );
    if (!ok) return false;
  }
  // Independent of the type group (ADR-0017). An unknown status never matches a selection.
  if (f.statuses.length > 0 && (company.ownership_status === null || !f.statuses.includes(company.ownership_status))) {
    return false;
  }
  if (f.neighbourhoods.length > 0 && !offices.some((o) => o.neighbourhood !== null && f.neighbourhoods.includes(o.neighbourhood))) {
    return false;
  }
  if (f.tech_parks.length > 0 && !offices.some((o) => o.tech_park !== null && f.tech_parks.includes(o.tech_park))) {
    return false;
  }
  if (f.sectors.length > 0 && !company.sectors.some((s) => f.sectors.includes(s))) return false;

  // Every word must be inside at least one field.
  for (const token of tokens) {
    if (!p.fields.some((field) => field.includes(token))) return false;
  }
  return true;
}

/** The companies that match, each once, in dataset order (name-slug order from the build). */
export function filterCompanies(index: FilterIndex, filters: Filters): CompanySummary[] {
  const tokens = searchTokens(filters.q);
  return index.prepared.filter((p) => matches(p, filters, tokens)).map((p) => p.company);
}

/**
 * Everything the three views show for one filter, from one pass: the matching companies (each once,
 * in dataset order) and every office of those companies. Map, Grid, List, and every count read this
 * and nothing else, so they cannot disagree.
 */
export type FilterResult = { companies: CompanySummary[]; offices: Office[] };

export function filterResult(index: FilterIndex, filters: Filters): FilterResult {
  const tokens = searchTokens(filters.q);
  const companies: CompanySummary[] = [];
  const offices: Office[] = [];
  for (const p of index.prepared) {
    if (!matches(p, filters, tokens)) continue;
    companies.push(p.company);
    offices.push(...p.offices);
  }
  return { companies, offices };
}

/** The matching company IDs. This is the mirror of `company_filter`. */
export function companyFilter(index: FilterIndex, filters: Filters): string[] {
  return filterCompanies(index, filters).map((c) => c.id);
}

/** Every office of every matching company (mirror of `city_points`), ordered by office ID. */
export function cityPoints(index: FilterIndex, filters: Filters): Office[] {
  const tokens = searchTokens(filters.q);
  const out: Office[] = [];
  for (const p of index.prepared) if (matches(p, filters, tokens)) out.push(...p.offices);
  return out.sort((a, b) => compareCodePoints(a.id, b.id));
}

export type ListRow = {
  company_id: string;
  slug: string;
  name: string;
  logo_key: string | null;
  types: CompanyType[];
  startup_stage: StartupStage | null;
  ownership_status: OwnershipStatus | null;
  office_count: number;
  open_job_count: number;
};

/** Compares by Unicode code point, as PostgreSQL's `collate "C"` does on UTF-8 text. */
export function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/**
 * The list rows for a filter result, in the order of `search_companies`: name (lower-cased, by code point),
 * then ID. Grid and List render exactly these rows, so they hold the same companies as the map's points.
 * `office_count` is the offices in this city; `open_job_count` is active jobs listed in this city.
 */
export function listRows(result: FilterResult): ListRow[] {
  const officeCounts = new Map<string, number>();
  for (const o of result.offices) officeCounts.set(o.company_id, (officeCounts.get(o.company_id) ?? 0) + 1);
  return result.companies
    .map((company) => ({ company, key: company.name.toLowerCase() }))
    .sort((a, b) => compareCodePoints(a.key, b.key) || compareCodePoints(a.company.id, b.company.id))
    .map(({ company }) => ({
      company_id: company.id,
      slug: company.slug,
      name: company.name,
      logo_key: company.logo_key,
      types: company.types,
      startup_stage: company.startup_stage,
      ownership_status: company.ownership_status,
      office_count: officeCounts.get(company.id) ?? 0,
      open_job_count: company.open_jobs,
    }));
}

/** The list (mirror of `search_companies`): `listRows` of the filter result, one page of it. */
export function searchCompanies(index: FilterIndex, filters: Filters, limit = 50, offset = 0): ListRow[] {
  return listRows(filterResult(index, filters)).slice(Math.max(offset, 0), Math.max(offset, 0) + Math.max(limit, 0));
}

export type FacetRow = { facet: "total" | "type" | "stage" | "status" | "neighbourhood" | "tech_park" | "sector"; value: string; company_count: number };

/**
 * Facet counts (mirror of `company_facets`): the size of the filter result with that group's
 * selection replaced by the single value, every other group as it is. See docs/filters.md.
 */
export function companyFacets(index: FilterIndex, filters: Filters): FacetRow[] {
  const count = (f: Filters) => filterCompanies(index, f).length;
  const rows: FacetRow[] = [{ facet: "total", value: "", company_count: count(filters) }];
  for (const t of COMPANY_TYPES) {
    rows.push({ facet: "type", value: t, company_count: count({ ...filters, types: [t], stages: [] }) });
  }
  for (const s of STARTUP_STAGES) {
    rows.push({ facet: "stage", value: s, company_count: count({ ...filters, types: ["startup"], stages: [s] }) });
  }
  for (const s of OWNERSHIP_STATUSES) {
    rows.push({ facet: "status", value: s, company_count: count({ ...filters, statuses: [s] }) });
  }
  for (const n of index.dataset.neighbourhoods) {
    rows.push({ facet: "neighbourhood", value: n.slug, company_count: count({ ...filters, neighbourhoods: [n.slug] }) });
  }
  for (const t of index.dataset.tech_parks) {
    rows.push({ facet: "tech_park", value: t.slug, company_count: count({ ...filters, tech_parks: [t.slug] }) });
  }
  for (const s of index.dataset.sectors) {
    rows.push({ facet: "sector", value: s.slug, company_count: count({ ...filters, sectors: [s.slug] }) });
  }
  return rows;
}
