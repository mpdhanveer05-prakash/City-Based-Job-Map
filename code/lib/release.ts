// ADR-0025 option C: the rules of the production data refresh, kept pure so Vitest can test them
// (tests/unit/release.test.ts). scripts/release-tag.mts, release-record.mts, refresh-guard.mts, approved-baseline.mts and
// worker-version.mts run them in .github/workflows/deploy-production.yml and refresh-production-data.yml.
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

/** The release a refresh rebuilds, as verified: its tag, commit, and the deploy-production run that made it. */
export type ReleaseRef = { tag: string; commit: string; runId: string };

/**
 * The counts a person last approved for production, per city: at a release, or at a manual refresh where a person allowed
 * a shrink. Deployed as /data/approved-baseline.json; an automatic refresh carries it forward unchanged, so every refresh
 * is measured against what a person approved, not only against the previous refresh.
 */
export type ApprovedBaseline = {
  version: 1;
  release: ReleaseRef;
  approved: { kind: "release" | "shrink"; runId: string; by: string; at: string };
  cities: Record<string, { companies: number; jobs: number; dataset_version: string }>;
};

export const BASELINE_PATH = "data/approved-baseline.json";

export function baselineFrom(manifest: Manifest, release: ReleaseRef, approved: ApprovedBaseline["approved"]): ApprovedBaseline {
  const cities: ApprovedBaseline["cities"] = {};
  for (const [city, entry] of Object.entries(manifest.cities)) {
    cities[city] = { companies: entry.counts.companies, jobs: entry.counts.jobs, dataset_version: entry.dataset_version };
  }
  return { version: 1, release, approved, cities };
}

/** What the production site serves now, as the refresh read it (null where it could not be read). */
export type DeployedState = { manifest: Manifest | null; baseline: ApprovedBaseline | null; commit: string | null };

export type RefreshDecision = {
  /** Cities whose published folder would change. Empty means there is nothing to deploy. */
  changed: string[];
  /** Any problem stops the refresh before it deploys. */
  problems: string[];
  /** Shrinks over the limit that a person allowed (a manual run's input). */
  allowed: string[];
  /** The baseline to deploy with this refresh: the same one, or a new one when a person allowed a shrink. */
  baseline: ApprovedBaseline | null;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const dropped = (was: number, now: number, maxDrop: number) => was > 0 && now < was * (1 - maxDrop);

/**
 * Whether a refresh of `release` may deploy `next`. It stops (problems) unless:
 *  - the site is serving a build of this very release (so a refresh never puts older code over a newer release, or over a
 *    deployment made outside the workflows), and its approved baseline names this release;
 *  - no city is synthetic, missing, or new (a city goes live only through a release);
 *  - no city's companies or jobs fall by more than `maxDrop` against the deployed site (a sudden drop) OR against the
 *    approved baseline (a slow one: several small drops that each pass the first check), down to zero included.
 * A person's manual run may allow the shrinks; the baseline then becomes the new counts, recording who allowed it.
 */
export function evaluateRefresh(
  next: Manifest,
  deployed: DeployedState,
  release: ReleaseRef,
  options: { maxDrop?: number; allowShrink?: { runId: string; by: string; at: string } } = {},
): RefreshDecision {
  const maxDrop = options.maxDrop ?? DEFAULT_MAX_DROP;
  const decision: RefreshDecision = { changed: [], problems: [], allowed: [], baseline: deployed.baseline };
  const live = deployed.manifest;
  if (!live) decision.problems.push("The production site's manifest could not be read. A refresh needs a release that is already deployed.");
  if (deployed.commit !== release.commit) {
    decision.problems.push(
      `The production site was built from ${deployed.commit ?? "an unknown commit"}, not from ${release.tag} (${release.commit}). ` +
        "A newer release may be live without its tag, or something was deployed outside the workflows: a person must check.",
    );
  }
  const base = deployed.baseline;
  if (!base) decision.problems.push(`The production site has no approved baseline (/${BASELINE_PATH}).`);
  else if (base.release.tag !== release.tag || base.release.commit !== release.commit || base.release.runId !== release.runId) {
    const ref = (r: ReleaseRef) => `${r.tag} (${r.commit.slice(0, 12)}, run ${r.runId})`;
    decision.problems.push(`The approved baseline is for ${ref(base.release)}, not for ${ref(release)}.`);
  }
  if (!live || !base) return decision;

  if (next.pilot_preview || live.pilot_preview) decision.problems.push("A pilot preview build (simulated reviews) is never deployed or refreshed.");
  for (const city of Object.keys(live.cities)) if (!next.cities[city]) decision.problems.push(`${city} is live but missing from the new build.`);
  const shrinks: string[] = [];
  for (const [city, entry] of Object.entries(next.cities)) {
    if (entry.synthetic) decision.problems.push(`${city}: the new build holds synthetic data.`);
    const before = live.cities[city];
    const approved = base.cities[city];
    if (!before || !approved) {
      decision.problems.push(`${city}: a city goes live only through a release, never through a data refresh.`);
      continue;
    }
    if (before.dataset_version !== entry.dataset_version) decision.changed.push(city);
    for (const metric of ["companies", "jobs"] as const) {
      const now = entry.counts[metric];
      if (dropped(before.counts[metric], now, maxDrop)) {
        shrinks.push(`${city}: ${metric} would drop from ${before.counts[metric]} to ${now} since the last deployment (more than ${pct(maxDrop)}).`);
      } else if (dropped(approved[metric], now, maxDrop)) {
        shrinks.push(`${city}: ${metric} would be ${now}, down from ${approved[metric]} when a person last approved (${base.approved.kind}, run ${base.approved.runId}): more than ${pct(maxDrop)} in all.`);
      }
    }
  }
  if (shrinks.length && options.allowShrink) {
    decision.allowed.push(...shrinks);
    decision.baseline = baselineFrom(next, release, { kind: "shrink", ...options.allowShrink });
  } else {
    decision.problems.push(...shrinks.map((s) => `${s} A person must check it, then run the refresh by hand with allow_shrink.`));
  }
  return decision;
}

/**
 * The release record: the deploy-production run that a release tag names (its message holds the run's URL), as the GitHub
 * API describes it. A refresh trusts a release only if that run deployed exactly this commit from main, finished with
 * success, and was approved in the `production` environment. The tag's name and tagger are checked too, but never alone.
 */
export function verifyReleaseRecord(input: {
  tag: { name: string; commit: string; message: string };
  repository: string;
  run: unknown;
  approvals: unknown;
}): { runId: string | null; problems: string[] } {
  const runId = /\/actions\/runs\/(\d+)\b/.exec(input.tag.message)?.[1] ?? null;
  if (!runId) return { runId, problems: [`The tag ${input.tag.name} names no deploy-production run.`] };
  const run = (input.run ?? {}) as Record<string, unknown>;
  const repo = (run.repository as { full_name?: string } | undefined)?.full_name;
  const problems = [
    String(run.id) !== runId && `run ${runId} could not be read`,
    run.path !== ".github/workflows/deploy-production.yml" && `run ${runId} is not the production release workflow (${String(run.path)})`,
    repo !== input.repository && `run ${runId} belongs to ${String(repo)}, not ${input.repository}`,
    (run.status !== "completed" || run.conclusion !== "success") && `run ${runId} did not succeed (${String(run.status)}, ${String(run.conclusion)})`,
    run.head_sha !== input.tag.commit && `run ${runId} deployed ${String(run.head_sha)}, not the tag's commit ${input.tag.commit}`,
    run.head_branch !== "main" && `run ${runId} ran on ${String(run.head_branch)}, not main`,
    run.event !== "workflow_dispatch" && `run ${runId} was started by ${String(run.event)}, not by a person`,
  ].filter((x): x is string => typeof x === "string");
  const approvals = Array.isArray(input.approvals) ? (input.approvals as Array<{ state?: string; environments?: Array<{ name?: string }> }>) : [];
  if (!approvals.some((a) => a.state === "approved" && (a.environments ?? []).some((e) => e.name === "production"))) {
    problems.push(`run ${runId} has no reviewer's approval for the production environment`);
  }
  return { runId, problems };
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
