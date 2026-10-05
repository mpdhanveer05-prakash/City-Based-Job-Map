// Writes the static per-city datasets the explorer filters in the browser (ADR-0006, P4-01, P4-02).
//
//   node scripts/build-datasets.mts [--out public/data] [--require] [--seed-fallback] [--export-seed]
//
// Reads `city_build_snapshot(city)` once per launch city, validates it, and writes
//   <out>/<city>/<data_version>/{companies,offices,search,details}.json   and   <out>/manifest.json
// Older version folders of a city are removed, so the output holds only the current data.
//
// Where the snapshot comes from is decided by lib/api/data-source.ts (ADR-0010): a Supabase project,
// a local database, or, only when asked, the committed synthetic snapshot in supabase/seed/snapshots.
// `.env.local` is read first, so `npm run build` sees the same settings as `npm run dev`.
//
//   --require        exit 1 when there is no data source (the build uses this: no data, no site)
//   --seed-fallback  allow the committed synthetic snapshot when nothing else is set (`npm run dev`)
//   --export-seed    read the local database and rewrite supabase/seed/snapshots/<city>.json, then stop
//
// Without --require, a missing source is reported and the script exits 0.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchCitySnapshot, parseCitySnapshot } from "../lib/api/snapshot.ts";
import { assertReleaseData, chooseDataSource, describeDataSource } from "../lib/api/data-source.ts";
import { collectRedirects, renderRedirects } from "../lib/redirects.ts";
import { buildManifest, DATASET_FILE_NAMES, serializeDataset, type SerializedDataset } from "../lib/filters/dataset-files.ts";
import type { CitySnapshot } from "../lib/filters/dataset.ts";
import { snapshotIsSynthetic } from "../lib/filters/dataset.ts";
import { CITY_SLUGS } from "../lib/filters/schema.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const outDir = path.resolve(option("--out", "public/data"));
const seedDir = path.resolve("supabase/seed/snapshots");

async function readFromLocalDatabase(connectionString: string, city: string): Promise<unknown> {
  // Dynamic import: `pg` is a development dependency and is not needed for the REST path.
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role anon");
    const result = await client.query("select city_build_snapshot($1) as snapshot", [city]);
    await client.query("rollback");
    return result.rows[0].snapshot;
  } finally {
    await client.end();
  }
}

function readSeedSnapshot(city: string): CitySnapshot {
  const file = path.join(seedDir, `${city}.json`);
  if (!existsSync(file)) {
    throw new Error(`${file} is missing. Run \`npm run data -- --export-seed\` against the seeded local database.`);
  }
  return parseCitySnapshot(JSON.parse(readFileSync(file, "utf8")), city);
}

async function main() {
  const env = process.env;
  const source = chooseDataSource(env, { seedFallback: flag("--seed-fallback") });

  if (flag("--export-seed")) {
    if (source.kind !== "local") {
      console.error("build-datasets: --export-seed reads the local database. Set LOCAL_DATABASE_URL (and nothing that selects Supabase REST).");
      process.exit(1);
    }
    mkdirSync(seedDir, { recursive: true });
    for (const city of CITY_SLUGS) {
      const snapshot = parseCitySnapshot(await readFromLocalDatabase(source.connectionString, city), city);
      if (!snapshotIsSynthetic(snapshot)) {
        throw new Error(`${city}: refusing to export a snapshot that is not entirely synthetic as the committed sample`);
      }
      writeFileSync(path.join(seedDir, `${city}.json`), JSON.stringify(snapshot, null, 1) + "\n");
    }
    console.log(`build-datasets: wrote ${CITY_SLUGS.length} synthetic snapshots to ${path.relative(process.cwd(), seedDir)}`);
    return;
  }

  if (source.kind === "none") {
    const message =
      "build-datasets: no data source. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or LOCAL_DATABASE_URL for a local database, or DATA_SOURCE=seed for the committed synthetic sample.";
    if (flag("--require")) {
      console.error(message);
      process.exit(1);
    }
    console.log(`${message} Skipped.`);
    return;
  }
  console.log(`build-datasets: reading ${describeDataSource(source)}, writing ${path.relative(process.cwd(), outDir) || "."}`);

  const sets: SerializedDataset[] = [];
  for (const city of CITY_SLUGS) {
    const snapshot =
      source.kind === "rest"
        ? await fetchCitySnapshot({ url: source.url, anonKey: source.anonKey }, city)
        : source.kind === "local"
          ? parseCitySnapshot(await readFromLocalDatabase(source.connectionString, city), city)
          : readSeedSnapshot(city);
    if (snapshot.companies.length === 0) {
      throw new Error(`${city} has no published companies: refusing to write an empty dataset`);
    }
    sets.push(serializeDataset(snapshot));
  }

  const releaseProblem = assertReleaseData(
    env,
    sets.map((s) => ({ city: s.city, synthetic: s.synthetic })),
  );
  if (releaseProblem) {
    console.error(`build-datasets: ${releaseProblem}`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  for (const set of sets) {
    const cityDir = path.join(outDir, set.city);
    mkdirSync(cityDir, { recursive: true });
    for (const entry of readdirSync(cityDir)) {
      if (entry !== String(set.dataVersion)) rmSync(path.join(cityDir, entry), { recursive: true, force: true });
    }
    const versionDir = path.join(cityDir, String(set.dataVersion));
    mkdirSync(versionDir, { recursive: true });
    for (const name of DATASET_FILE_NAMES) writeFileSync(path.join(versionDir, `${name}.json`), set.files[name]);
  }
  const manifest = buildManifest(sets);
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest));

  // public/_redirects = the static rules (config/redirects.static) + one rule per old company slug (P6-01).
  const redirects = collectRedirects(sets.map((s) => ({ city: s.city, redirects: s.slugRedirects, currentSlugs: s.slugs })));
  writeFileSync(path.resolve("public/_redirects"), renderRedirects(readFileSync(path.resolve("config/redirects.static"), "utf8"), redirects));
  if (redirects.length > 0) console.log(`build-datasets: ${redirects.length} company slug redirects written to public/_redirects`);

  const rows = Object.entries(manifest.cities).map(([city, c]) => ({
    city,
    version: c.data_version,
    synthetic: c.synthetic,
    companies: c.counts.companies,
    offices: c.counts.offices,
    jobs: c.counts.jobs,
    "companies.json": c.files.companies.bytes,
    "offices.json": c.files.offices.bytes,
    "search.json": c.files.search.bytes,
    "details.json": c.files.details.bytes,
  }));
  console.table(rows);
  const total = rows.reduce((n, r) => n + r["companies.json"] + r["offices.json"] + r["search.json"] + r["details.json"], 0);
  console.log(`build-datasets: wrote ${sets.length * DATASET_FILE_NAMES.length + 1} files, ${total} bytes of data`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
