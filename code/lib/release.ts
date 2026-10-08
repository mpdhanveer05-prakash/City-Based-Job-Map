// ADR-0025 option C: the rules of the production data refresh, kept pure so Vitest can test them
// (tests/unit/release.test.ts). scripts/release-tag.mts, scripts/refresh-guard.mts and scripts/worker-version.mts run them
// in .github/workflows/deploy-production.yml and refresh-production-data.yml.
import type { Manifest } from "./filters/dataset-files";

/** `release/<UTC yyyymmdd-hhmm>-<run number>`, created only by deploy-production.yml after a successful release. */
export const RELEASE_TAG = /^release\/\d{8}-\d{4}-\d+$/;
/** The identity deploy-production.yml tags with. The repository ruleset is the real guard; this is a second check. */
export const RELEASE_TAGGER_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
/** Proposal (ADR-0025): a refresh that drops a city's companies or jobs by more than this share waits for a person. */
export const DEFAULT_MAX_DROP = 0.2;

export function releaseTagName(date: Date, runNumber: number): string {
  if (!Number.isInteger(runNumber) || runNumber < 1) throw new Error(`Bad run number: ${runNumber}`);
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`;
  return `release/${day}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}-${runNumber}`;
}

/** One tag as `git for-each-ref` and `git merge-base --is-ancestor` describe it. */
export type TagRecord = {
  name: string;
  /** `tag` for an annotated tag, `commit` for a lightweight one. */
  objectType: string;
  taggerEmail: string;
  /** The commit the tag points at (peeled). */
  commit: string;
  /** ISO 8601 creation date. */
  created: string;
  /** Whether the commit is an ancestor of origin/main. */
  onMain: boolean;
};

export type ReleaseChoice =
  | { kind: "release"; tag: TagRecord }
  | { kind: "none"; reason: string }
  | { kind: "refused"; reason: string };

/**
 * The newest `release/*` tag, if it is one deploy-production.yml made. If the newest is not valid, the refresh is refused:
 * it never falls back to an older tag, because the newest one is what a person last approved (or what someone forged).
 */
export function chooseRelease(tags: readonly TagRecord[]): ReleaseChoice {
  const releases = tags.filter((t) => t.name.startsWith("release/"));
  if (releases.length === 0) return { kind: "none", reason: "No approved release exists yet: nothing to refresh." };
  const newest = [...releases].sort((a, b) => (a.created === b.created ? b.name.localeCompare(a.name) : a.created < b.created ? 1 : -1))[0];
  const problems = [
    !RELEASE_TAG.test(newest.name) && "its name is not release/<yyyymmdd-hhmm>-<run>",
    newest.objectType !== "tag" && "it is not an annotated tag",
    newest.taggerEmail !== RELEASE_TAGGER_EMAIL && `it was not created by the production workflow (tagger ${newest.taggerEmail || "none"})`,
    !/^[0-9a-f]{40}$/.test(newest.commit) && "its commit could not be read",
    !newest.onMain && "its commit is not on main",
  ].filter((x): x is string => typeof x === "string");
  return problems.length
    ? { kind: "refused", reason: `The newest release tag ${newest.name} is refused: ${problems.join("; ")}.` }
    : { kind: "release", tag: newest };
}

export type RefreshDecision = {
  /** Cities whose published folder would change. Empty means there is nothing to deploy. */
  changed: string[];
  /** Any problem stops the refresh before it deploys. */
  problems: string[];
  /** Shrinks that were over the limit but allowed by a person (a manual run's input). */
  allowed: string[];
};

/** Compares the manifest just built with the one the production site serves. */
export function compareManifests(deployed: Manifest | null, next: Manifest, options: { maxDrop?: number; allowShrink?: boolean } = {}): RefreshDecision {
  const maxDrop = options.maxDrop ?? DEFAULT_MAX_DROP;
  const decision: RefreshDecision = { changed: [], problems: [], allowed: [] };
  if (!deployed) {
    decision.problems.push("The production site's manifest could not be read. A refresh needs a release that is already deployed.");
    return decision;
  }
  for (const city of Object.keys(deployed.cities)) {
    if (!next.cities[city]) decision.problems.push(`${city} is live but missing from the new build.`);
  }
  for (const [city, entry] of Object.entries(next.cities)) {
    if (entry.synthetic) decision.problems.push(`${city}: the new build holds synthetic data.`);
    const before = deployed.cities[city];
    if (!before) {
      decision.problems.push(`${city}: a city goes live only through a release, never through a data refresh.`);
      continue;
    }
    if (before.dataset_version !== entry.dataset_version) decision.changed.push(city);
    for (const metric of ["companies", "jobs"] as const) {
      const was = before.counts[metric];
      const now = entry.counts[metric];
      if (was > 0 && now < was * (1 - maxDrop)) {
        const note = `${city}: ${metric} would drop from ${was} to ${now} (more than ${Math.round(maxDrop * 100)}%).`;
        if (options.allowShrink) decision.allowed.push(note);
        else decision.problems.push(`${note} A person must check it, then run the refresh by hand with allow_shrink.`);
      }
    }
  }
  return decision;
}

/**
 * The version serving 100% of traffic, from `wrangler deployments status --json`. The output's shape is read
 * defensively (not yet seen from a real account): anything else is an error, so the refresh stops before deploying.
 */
export function deployedVersionId(statusJson: unknown): string {
  const versions = (statusJson as { versions?: unknown } | null)?.versions;
  if (Array.isArray(versions)) {
    const full = versions.filter((v): v is { version_id: string; percentage: number } =>
      typeof v === "object" && v !== null && typeof (v as { version_id?: unknown }).version_id === "string" && (v as { percentage?: unknown }).percentage === 100,
    );
    if (full.length === 1 && /^[0-9a-f-]{36}$/i.test(full[0].version_id)) return full[0].version_id;
  }
  throw new Error("Could not read the deployed Worker version from `wrangler deployments status --json`.");
}
