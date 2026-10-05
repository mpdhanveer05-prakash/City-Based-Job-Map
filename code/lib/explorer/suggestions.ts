// The suggestions under the search box (P5-01): a few companies, areas, and job titles that contain what
// has been typed. Pure, so it is unit-tested. It reads the same prepared index as the filter, so a
// suggestion always leads to a non-empty result.
import type { FilterIndex } from "../filters/filter";
import { searchTokens } from "../filters/filter";

export type Suggestion =
  | { kind: "company"; label: string; slug: string }
  | { kind: "neighbourhood"; label: string; slug: string }
  | { kind: "tech_park"; label: string; slug: string }
  | { kind: "job"; label: string };

export const SUGGESTION_LIMITS = { company: 4, area: 3, job: 3 } as const;
export const MIN_SUGGEST_LENGTH = 2;

export const SUGGESTION_KIND_LABELS: Record<Suggestion["kind"], string> = {
  company: "Company",
  neighbourhood: "Neighbourhood",
  tech_park: "Tech park",
  job: "Job",
};

/** Names starting with the text come before names that only contain it; ties keep the data's order. */
function rank<T>(items: readonly T[], name: (t: T) => string, needle: string, limit: number): T[] {
  const starts: T[] = [];
  const contains: T[] = [];
  for (const item of items) {
    const lower = name(item).toLowerCase();
    if (lower.startsWith(needle)) starts.push(item);
    else if (lower.includes(needle)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}

export function buildSuggestions(index: FilterIndex, text: string): Suggestion[] {
  const tokens = searchTokens(text);
  const needle = tokens.join(" ");
  if (needle.length < MIN_SUGGEST_LENGTH) return [];
  const { dataset } = index;

  const companies = rank(dataset.companies, (c) => c.name, needle, SUGGESTION_LIMITS.company).map(
    (c): Suggestion => ({ kind: "company", label: c.name, slug: c.slug }),
  );
  const hoods = rank(dataset.neighbourhoods, (n) => n.name, needle, SUGGESTION_LIMITS.area).map(
    (n): Suggestion => ({ kind: "neighbourhood", label: n.name, slug: n.slug }),
  );
  const parks = rank(dataset.tech_parks, (t) => t.name, needle, SUGGESTION_LIMITS.area).map(
    (t): Suggestion => ({ kind: "tech_park", label: t.name, slug: t.slug }),
  );

  // Job titles: distinct, from the search file (empty until it has loaded).
  const titles = new Map<string, string>();
  for (const entry of dataset.search) for (const title of entry.jobs) if (!titles.has(title.toLowerCase())) titles.set(title.toLowerCase(), title);
  const jobs = rank([...titles.values()], (t) => t, needle, SUGGESTION_LIMITS.job).map((title): Suggestion => ({ kind: "job", label: title }));

  return [...companies, ...hoods.slice(0, 2), ...parks.slice(0, 1), ...jobs];
}
