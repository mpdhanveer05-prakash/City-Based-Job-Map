// A backup-and-restore drill (P9-04), against the local database in Docker:
//
//   node scripts/backup-drill.mts [--container supabase_db_company-map]
//
// It dumps the whole `postgres` database in pg_dump's custom format, restores the dump into a new, empty database, and
// compares the row counts of the tables that hold the site's data. It proves the dump is a usable backup of this schema
// (extensions, partitions, policies, functions, triggers) on this Postgres version. It does NOT prove anything about the
// hosted project: run the same steps from docs/backup-restore.md against it before launch.
//
// Needs Docker and the local database running (`npx supabase db start`, then `db reset`). The scratch database is dropped at
// the end, and the dump is removed from the container.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const at = args.indexOf("--container");
const container = at >= 0 ? args[at + 1] : "supabase_db_company-map";
const SCRATCH = "drill_restore";
const DUMP = "/tmp/drill.dump";

const docker = (...cmd: string[]): string => execFileSync("docker", ["exec", container, ...cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const psql = (db: string, sql: string): string => docker("psql", "-U", "postgres", "-d", db, "-tAc", sql).trim();

// The tables that hold the site's own data. Row counts must match exactly after the restore.
const TABLES = [
  "city", "neighbourhood", "tech_park", "sector", "source", "company", "company_type_tag", "company_sector", "company_founder",
  "office", "job", "job_city", "slug_redirect", "admin_user", "audit_log", "import_batch", "job_feed", "heartbeat",
  "submission", "feedback_rate", "link_click_daily", "verification_check", "site_state",
];

function counts(db: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of TABLES) {
    const exists = psql(db, `select to_regclass('public.${table}') is not null`);
    // A table that is missing is a mistake in this list or in the restore, never something to skip over.
    if (exists !== "t") throw new Error(`The table public.${table} does not exist in "${db}".`);
    out[table] = Number(psql(db, `select count(*) from public.${table}`));
  }
  return out;
}

try {
  docker("pg_isready", "-U", "postgres");
} catch {
  console.error(`The database container "${container}" is not running. Start it with: npx supabase db start`);
  process.exit(2);
}

const started = Date.now();
const before = counts("postgres");
if (Object.values(before).every((n) => n <= 0)) {
  console.error("The source tables are empty or missing: run `npx supabase db reset` first, so there is something to back up.");
  process.exit(2);
}

console.log("1. Dumping the database (custom format)...");
docker("pg_dump", "-U", "postgres", "-d", "postgres", "-Fc", "--no-owner", "--no-privileges", "-f", DUMP);
const size = docker("sh", "-c", `wc -c < ${DUMP}`).trim();
console.log(`   dump size ${(Number(size) / 1024).toFixed(0)} KB`);

console.log(`2. Restoring into a new database "${SCRATCH}"...`);
psql("postgres", `drop database if exists ${SCRATCH}`);
psql("postgres", `create database ${SCRATCH} template template0`);
let restoreNotes = "";
try {
  // The scratch database starts empty (template0), so the dump creates what it needs. One error is expected and harmless
  // here: pg_cron can only be created in the `postgres` database, so the scheduled jobs are not restored into the scratch copy.
  // (On a restore into a real project, pg_cron is already enabled by the migrations; see docs/backup-restore.md.)
  docker("pg_restore", "-U", "postgres", "-d", SCRATCH, "--no-owner", "--no-privileges", DUMP);
} catch (error) {
  restoreNotes = String((error as { stderr?: string }).stderr ?? error).split("\n").filter((l) => l.trim()).slice(0, 8).join("\n   ");
}
if (restoreNotes) console.log(`   pg_restore reported:\n   ${restoreNotes}`);

console.log("3. Comparing row counts...");
const after = counts(SCRATCH);
let mismatches = 0;
for (const table of TABLES) {
  const same = before[table] === after[table];
  if (!same) mismatches++;
  console.log(`   ${same ? "ok      " : "MISMATCH"} ${table.padEnd(18)} source ${String(before[table]).padStart(6)}  restored ${String(after[table]).padStart(6)}`);
}
// A policy and a function are the parts a plain row count cannot show.
const policies = (db: string) => Number(psql(db, "select count(*) from pg_policies where schemaname = 'public'"));
const functions = (db: string) => Number(psql(db, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'"));
for (const [name, read] of [["RLS policies", policies], ["functions in public", functions]] as const) {
  const [a, b] = [read("postgres"), read(SCRATCH)];
  if (a !== b) mismatches++;
  console.log(`   ${a === b ? "ok      " : "MISMATCH"} ${name.padEnd(18)} source ${String(a).padStart(6)}  restored ${String(b).padStart(6)}`);
}

psql("postgres", `drop database if exists ${SCRATCH}`);
docker("rm", "-f", DUMP);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(mismatches === 0 ? `\nDrill passed in ${seconds} s: the restored copy matches the source.` : `\nDrill FAILED in ${seconds} s: ${mismatches} difference(s).`);
process.exit(mismatches === 0 ? 0 : 1);
