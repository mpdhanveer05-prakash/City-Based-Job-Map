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

/** A release build must not ship sample data. Returns the problem, or null when it is fine. */
export function assertReleaseData(env: DataSourceEnv, datasets: ReadonlyArray<{ city: string; synthetic: boolean }>): string | null {
  if (!isReleaseBuild(env)) return null;
  const bad = datasets.filter((d) => d.synthetic).map((d) => d.city);
  return bad.length ? `RELEASE_BUILD=1 refuses synthetic sample data (${bad.join(", ")}). Build from a real Supabase project.` : null;
}
