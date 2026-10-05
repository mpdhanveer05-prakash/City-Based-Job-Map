// The city launch gate (P9-04): whether a city's data is good enough to go live. A pure function of the city's dataset files
// (the same ones the site is built from), so the answer is the answer for exactly what visitors would see.
//
// The thresholds are PROPOSALS (docs/data-model.md, the architecture plan's launch criteria): the product owner confirms
// them per city in D-04. A synthetic dataset never passes.
import type { CompaniesFile, DetailsFile, OfficesFile } from "./filters/dataset.ts";

export type GateThresholds = {
  /** Fewest published companies. The plan loads about 300 for Bengaluru; Chennai's number is part of D-01 and D-04. */
  minCompanies: number;
  /** Share of offices at rooftop, building, or campus accuracy (the plan: at least 90%). */
  minPreciseShare: number;
  /** Share of listed jobs checked within the last `freshDays` days (a link checker that runs every six hours should reach all). */
  minFreshJobShare: number;
  freshDays: number;
  /** Most offices allowed outside the city boundary (each one needs an admin's review; the data cannot say which were reviewed). */
  maxOutsideBoundary: number;
};

export const DEFAULT_THRESHOLDS: Record<string, GateThresholds> = {
  bangalore: { minCompanies: 300, minPreciseShare: 0.9, minFreshJobShare: 0.9, freshDays: 7, maxOutsideBoundary: 0 },
  chennai: { minCompanies: 100, minPreciseShare: 0.9, minFreshJobShare: 0.9, freshDays: 7, maxOutsideBoundary: 0 },
};

export type GateCheck = { name: string; pass: boolean; detail: string };
export type GateResult = { city: string; pass: boolean; checks: GateCheck[] };

type Ring = Array<[number, number]>;

/** Ray casting: is the point inside the ring? Edges and vertices are treated as inside. */
export function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // On the edge counts as inside: a point exactly on the boundary line is not an outlier.
    const cross = (lng - xi) * (yj - yi) - (lat - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && lng >= Math.min(xi, xj) && lng <= Math.max(xi, xj) && lat >= Math.min(yi, yj) && lat <= Math.max(yi, yj)) return true;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside a MultiPolygon: inside an outer ring and not inside one of that polygon's holes. */
export function inBoundary(lng: number, lat: number, boundary: { coordinates: unknown[] }): boolean {
  return (boundary.coordinates as Ring[][]).some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function evaluateLaunchGate(
  files: { synthetic: boolean; companies: CompaniesFile; offices: OfficesFile; details: DetailsFile },
  thresholds: GateThresholds,
  now: Date = new Date(),
): GateResult {
  const city = files.companies.city.slug;
  const { companies } = files.companies;
  const { offices } = files.offices;
  const jobs = files.details.jobs;
  const checks: GateCheck[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  add("The data is real, not the synthetic sample", !files.synthetic, files.synthetic ? "Every company here is synthetic sample data." : "No synthetic marker.");
  add("Enough companies", companies.length >= thresholds.minCompanies, `${companies.length} published, ${thresholds.minCompanies} needed.`);

  const precise = offices.filter((o) => ["rooftop", "building", "campus"].includes(o.accuracy)).length;
  const share = offices.length === 0 ? 0 : precise / offices.length;
  add("Locations are precise", share >= thresholds.minPreciseShare, `${pct(share)} of ${offices.length} offices at building or campus accuracy, ${pct(thresholds.minPreciseShare)} needed.`);

  const outside = offices.filter((o) => !inBoundary(o.lng, o.lat, files.companies.city.boundary)).length;
  add("Offices are inside the city", outside <= thresholds.maxOutsideBoundary, `${outside} outside the boundary, ${thresholds.maxOutsideBoundary} allowed.`);

  const withOffice = new Set(offices.map((o) => o.company_id));
  const noOffice = companies.filter((c) => !withOffice.has(c.id)).length;
  add("Every company has an office", noOffice === 0, `${noOffice} companies have no published office.`);

  const cutoff = now.getTime() - thresholds.freshDays * 86_400_000;
  const fresh = jobs.filter((j) => j.last_checked_at && Date.parse(j.last_checked_at) >= cutoff).length;
  const freshShare = jobs.length === 0 ? 1 : fresh / jobs.length;
  add("Job links are fresh", freshShare >= thresholds.minFreshJobShare, `${pct(freshShare)} of ${jobs.length} jobs checked in the last ${thresholds.freshDays} days, ${pct(thresholds.minFreshJobShare)} needed.`);

  return { city, pass: checks.every((c) => c.pass), checks };
}

export function renderGate(results: readonly GateResult[]): string {
  const lines = ["# City launch gate", ""];
  for (const r of results) {
    lines.push(`## ${r.city}: ${r.pass ? "PASS" : "FAIL"}`, "");
    for (const c of r.checks) lines.push(`- ${c.pass ? "pass" : "FAIL"}: ${c.name}. ${c.detail}`);
    lines.push("");
  }
  return lines.join("\n");
}
