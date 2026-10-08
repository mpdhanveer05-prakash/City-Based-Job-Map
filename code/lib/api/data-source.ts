// Where the build gets its city data (P4-02, ADR-0010). Pure, so the rules are unit-tested.
//
// Order, first match wins:
//   1. rest   NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY: a Supabase project's REST API.
//   2. local  LOCAL_DATABASE_URL: a local Postgres, read as the anon role (development only).
//   3. seed   the committed synthetic snapshot, but only when asked for: DATA_SOURCE=seed, or the
//             `--seed-fallback` flag (what `npm run dev` passes). A build never falls back to
//             synthetic data by itself.
//   4. none   nothing to read. The build script fails (a build without data is a broken site).
//
// A release build (RELEASE_BUILD=1, set only by the production deploy) refuses synthetic data from
// any source: see `assertReleaseData`.

/** `process.env`, or a plain record in a test. The names read are in the header comment. */
export type DataSourceEnv = Readonly<Record<string, string | undefined>>;

export type DataSource =
  | { kind: "rest"; url: string; anonKey: string }
  | { kind: "local"; connectionString: string }
  | { kind: "seed" }
  | { kind: "none" };

const isPlaceholder = (value: string | undefined) => !value || value.trim() === "" || value.startsWith("replace-");

export function chooseDataSource(env: DataSourceEnv, options: { seedFallback?: boolean } = {}): DataSource {
  if (!isPlaceholder(env.NEXT_PUBLIC_SUPABASE_URL) && !isPlaceholder(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    return { kind: "rest", url: env.NEXT_PUBLIC_SUPABASE_URL!.trim(), anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim() };
  }
  if (!isPlaceholder(env.LOCAL_DATABASE_URL)) return { kind: "local", connectionString: env.LOCAL_DATABASE_URL!.trim() };
  if (env.DATA_SOURCE === "seed" || options.seedFallback) return { kind: "seed" };
  return { kind: "none" };
}

export function describeDataSource(source: DataSource): string {
  switch (source.kind) {
    case "rest":
      return `Supabase REST (${new URL(source.url).host})`;
    case "local":
      return "the local database as the anon role";
    case "seed":
      return "the committed synthetic snapshot (supabase/seed/snapshots)";
    case "none":
      return "no data source";
  }
}

export const isReleaseBuild = (env: DataSourceEnv): boolean => env.RELEASE_BUILD === "1";

/**
 * A database that scripts/pilot/preview-db.mts made (it has the `pilot_preview.marker` table) holds SIMULATED reviews: a
 * stand-in account marked the pilot's claims reviewed so that the listing rule shows them. Only an explicit local pilot
 * preview build may read it; anything else, a release above all, is refused. Returns why, or null.
 */
export function previewCopyRefusal(env: DataSourceEnv, isPreviewCopy: boolean): string | null {
  if (!isPreviewCopy) return null;
  if (isReleaseBuild(env)) return "this database is a pilot preview copy with simulated reviews: a release build never reads it.";
  if (env.PILOT_PREVIEW !== "1") return "this database is a pilot preview copy with simulated reviews: build it only as a local pilot preview (PILOT_PREVIEW=1).";
  return null;
}

/**
 * PILOT_PREVIEW=1 (scripts/pilot/preview-db.mts) builds unreviewed pilot records from a local scratch copy, for looking at
 * only. Why such a build must stop, or null: never in a release build, and only from a database on this machine.
 */
export function pilotPreviewRefusal(env: DataSourceEnv, source: DataSource): string | null {
  if (env.PILOT_PREVIEW !== "1") return null;
  if (isReleaseBuild(env)) return "RELEASE_BUILD=1 refuses PILOT_PREVIEW=1: the pilot records are unreviewed.";
  let hostname = "";
  try {
    hostname = source.kind === "local" ? new URL(source.connectionString).hostname : "";
  } catch {
    hostname = "";
  }
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    return "PILOT_PREVIEW=1 reads only the local scratch copy. Set LOCAL_DATABASE_URL as scripts/pilot/preview-db.mts prints.";
  }
  return null;
}

/** A release build must not ship sample data. Returns the problem, or null when it is fine. */
export function assertReleaseData(
  env: DataSourceEnv,
  datasets: ReadonlyArray<{ city: string; synthetic: boolean; evidenceIncomplete?: { companies: number; jobs: number } }>,
): string | null {
  if (!isReleaseBuild(env)) return null;
  const bad = datasets.filter((d) => d.synthetic).map((d) => d.city);
  if (bad.length) return `RELEASE_BUILD=1 refuses synthetic sample data (${bad.join(", ")}). Build from a real Supabase project.`;
  // ADR-0022: a record published before evidence existed, or whose evidence went stale, may stay in local and staging
  // data, but never reaches production.
  const thin = datasets.filter((d) => d.evidenceIncomplete && (d.evidenceIncomplete.companies > 0 || d.evidenceIncomplete.jobs > 0));
  return thin.length
    ? `RELEASE_BUILD=1 refuses published records without their required evidence (${thin
        .map((d) => `${d.city}: ${d.evidenceIncomplete!.companies} companies, ${d.evidenceIncomplete!.jobs} jobs`)
        .join("; ")}). Record and review the evidence, or unpublish them.`
    : null;
}
