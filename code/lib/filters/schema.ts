// The filter object shared by the URL, the browser filter (P4-01), and the SQL reference
// (`company_filter`, docs/filters.md). One definition of the values and one normaliser.
import "../zod-config.ts";
import { z } from "zod";

/** Launch cities (ADR-0002). A city is a path segment (`/bangalore`), never a query parameter. */
export const CITY_SLUGS = ["bangalore", "chennai"] as const;
export type CitySlug = (typeof CITY_SLUGS)[number];

/** Overlapping tags (ADR-0004). The order here is the canonical order. */
export const COMPANY_TYPES = ["startup", "mnc", "product"] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

/** The nine stages in the brief (D-05 is open on whether Public and Acquired belong here). */
export const STARTUP_STAGES = [
  "pre_seed",
  "seed",
  "bootstrapped",
  "series_a",
  "series_b",
  "series_c",
  "series_c_plus",
  "public",
  "acquired",
] as const;
export type StartupStage = (typeof STARTUP_STAGES)[number];

export const VIEWS = ["map", "grid", "list"] as const;
export type View = (typeof VIEWS)[number];

/**
 * White space in search text: the Unicode White_Space property, spelled out as a regular-expression
 * class body. The SQL `parse_filters` uses the same set (neither JavaScript's `\s` nor PostgreSQL's is
 * the same as the other's, see docs/filters.md).
 */
export const WHITESPACE = String.raw`\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
const WHITESPACE_RUN = new RegExp(`[${WHITESPACE}]+`, "g");

/** The longest search text kept. Longer input is cut, not rejected. */
export const MAX_QUERY_LENGTH = 100;

/** A kebab-case slug: how neighbourhoods, tech parks, sectors, and companies are named. */
export const slugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/**
 * The filter, with the same keys as the SQL function's JSON (`tech_parks` is snake_case on
 * purpose, so there is no mapping layer to get wrong). Every list is sorted and has no
 * duplicates once normalised; an empty list means "no constraint".
 */
export type Filters = {
  q: string;
  types: CompanyType[];
  stages: StartupStage[];
  neighbourhoods: string[];
  tech_parks: string[];
  sectors: string[];
};

export const EMPTY_FILTERS: Readonly<Filters> = Object.freeze({
  q: "",
  types: [],
  stages: [],
  neighbourhoods: [],
  tech_parks: [],
  sectors: [],
});

/** Strict schema for an already-normalised filter object (the dataset layer and the tests). */
export const filtersSchema = z.object({
  q: z.string().max(MAX_QUERY_LENGTH),
  types: z.array(z.enum(COMPANY_TYPES)),
  stages: z.array(z.enum(STARTUP_STAGES)),
  neighbourhoods: z.array(slugSchema),
  tech_parks: z.array(slugSchema),
  sectors: z.array(slugSchema),
});

/** Trim, collapse runs of white space, and cut to the maximum length. Case is kept as typed. */
export function normalizeQuery(q: string | null | undefined): string {
  if (!q) return "";
  // Not String.trim(): it also strips U+FEFF, which is not white space here.
  const spaced = q.replace(WHITESPACE_RUN, " ").replace(/^ | $/g, "");
  return spaced.slice(0, MAX_QUERY_LENGTH).replace(/ $/, "");
}

function uniqueSorted<T extends string>(values: readonly T[], order?: readonly T[]): T[] {
  const set = new Set(values);
  if (order) return order.filter((v) => set.has(v));
  return [...set].sort();
}

/**
 * Makes a filter canonical and internally consistent:
 *  - values are lower-cased, de-duplicated, and sorted (types and stages in their canonical order);
 *  - **stages are cleared unless Startup is selected** (ADR-0004, CLAUDE.md: "whenever a selection
 *    changes, clear any filter it makes incompatible");
 *  - the search text is trimmed and its white space collapsed.
 * Values that are not valid are dropped. It never throws.
 */
export function normalizeFilters(input: Partial<Filters>): Filters {
  const slugs = (values: readonly string[] | undefined): string[] =>
    uniqueSorted(
      (values ?? []).map((v) => v.trim().toLowerCase()).filter((v) => slugSchema.safeParse(v).success),
    );
  const pick = <T extends string>(values: readonly string[] | undefined, allowed: readonly T[]): T[] =>
    uniqueSorted(
      (values ?? []).map((v) => v.trim().toLowerCase()).filter((v): v is T => (allowed as readonly string[]).includes(v)),
      allowed,
    );

  const types = pick(input.types, COMPANY_TYPES);
  const stages = types.includes("startup") ? pick(input.stages, STARTUP_STAGES) : [];
  return {
    q: normalizeQuery(input.q),
    types,
    stages,
    neighbourhoods: slugs(input.neighbourhoods),
    tech_parks: slugs(input.tech_parks),
    sectors: slugs(input.sectors),
  };
}

/** Applies a change to a filter and clears whatever the change makes incompatible. */
export function applyFilterChange(filters: Filters, change: Partial<Filters>): Filters {
  return normalizeFilters({ ...filters, ...change });
}

/** True when no group constrains the result. */
export function isEmptyFilter(filters: Filters): boolean {
  return (
    filters.q === "" &&
    filters.types.length === 0 &&
    filters.neighbourhoods.length === 0 &&
    filters.tech_parks.length === 0 &&
    filters.sectors.length === 0 &&
    filters.stages.length === 0
  );
}

/** The JSON the SQL functions take: empty groups are left out. */
export function toSqlFilters(filters: Filters): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (filters.q !== "") out.q = filters.q;
  if (filters.types.length) out.types = [...filters.types];
  if (filters.stages.length) out.stages = [...filters.stages];
  if (filters.neighbourhoods.length) out.neighbourhoods = [...filters.neighbourhoods];
  if (filters.tech_parks.length) out.tech_parks = [...filters.tech_parks];
  if (filters.sectors.length) out.sectors = [...filters.sectors];
  return out;
}
