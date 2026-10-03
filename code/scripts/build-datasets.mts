// Writes the static per-city datasets the explorer filters in the browser (ADR-0006, P4-01).
//
//   node scripts/build-datasets.mts [--out public/data] [--require]
//
// Reads `city_build_snapshot(city)` once per launch city, validates it, and writes
//   <out>/<city>/<data_version>/{companies,offices,search,details}.json   and   <out>/manifest.json
// Older version folders of a city are removed, so the output holds only the current data.
//
// Where the snapshot comes from (first match wins):
//   NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY   a Supabase project, over its REST API,
//                                                              with the public anon key (RLS applies)
//   LOCAL_DATABASE_URL                                         a local Postgres, read as the anon role.
//                                                              Development only: never a hosted database
// With neither, the script says so and exits 0, unless --require is given (then it exits 1).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchCitySnapshot, parseCitySnapshot } from "../lib/api/snapshot.ts";
import { buildManifest, DATASET_FILE_NAMES, serializeDataset, type SerializedDataset } from "../lib/filters/dataset-files.ts";
import { CITY_SLUGS } from "../lib/filters/schema.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const outDir = path.resolve(option("--out", "public/data"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const localDatabaseUrl = process.env.LOCAL_DATABASE_URL;

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

function describeSource(): string | null {
  if (url && anonKey && !anonKey.startsWith("replace-")) return `Supabase REST (${new URL(url).host})`;
  if (localDatabaseUrl) return "local database as the anon role";
  return null;
}

async function main() {
  const source = describeSource();
  if (!source) {
    const message =
      "build-datasets: no data source. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or LOCAL_DATABASE_URL for a local database.";
    if (flag("--require")) {
      console.error(message);
      process.exit(1);
    }
    console.log(`${message} Skipped.`);
    return;
  }
  console.log(`build-datasets: reading ${source}, writing ${path.relative(process.cwd(), outDir) || "."}`);

  const sets: SerializedDataset[] = [];
  for (const city of CITY_SLUGS) {
    const snapshot =
      url && anonKey && !anonKey.startsWith("replace-")
        ? await fetchCitySnapshot({ url, anonKey }, city)
        : parseCitySnapshot(await readFromLocalDatabase(localDatabaseUrl!, city), city);
    if (snapshot.companies.length === 0) {
      throw new Error(`${city} has no published companies: refusing to write an empty dataset`);
    }
    sets.push(serializeDataset(snapshot));
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

  const rows = Object.entries(manifest.cities).map(([city, c]) => ({
    city,
    version: c.data_version,
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
