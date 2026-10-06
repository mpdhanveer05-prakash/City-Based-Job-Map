// A pilot-only local data source (P9-20): a scratch copy of the local database holding only the real pilot records, for
// looking at them in the built site before anyone has reviewed them.
//
//   node scripts/pilot/preview-db.mts [--container supabase_db_company-map]
//
// 1. Dumps the local `postgres` database and restores it into a new database, `pilot_preview` (as scripts/backup-drill.mts).
// 2. In that copy only: deletes every synthetic company, and marks the remaining (pilot) companies and their offices
//    published. It does this as the database owner, whom the publication gates do not check (they apply to signed-in
//    administrators), so it records no approval and no review. Nothing in the real database changes.
// 3. Prints the commands to build the site from the copy, with PILOT_PREVIEW=1: every page then carries a banner saying the
//    records are unreviewed candidates, search engines are told not to index it, and RELEASE_BUILD=1 refuses it.
//
// Run `python -m scripts.pilot.build_import --import` against the local database first. Never point a deploy at this build.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const at = args.indexOf("--container");
const container = at >= 0 ? args[at + 1] : "supabase_db_company-map";
const SCRATCH = "pilot_preview";
const DUMP = "/tmp/pilot-preview.dump";

const docker = (...cmd: string[]): string => execFileSync("docker", ["exec", container, ...cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const psql = (db: string, sql: string): string => docker("psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-tAc", sql).trim();

try {
  docker("pg_isready", "-U", "postgres");
} catch {
  console.error(`The database container "${container}" is not running. Start it with: npx supabase db start`);
  process.exit(2);
}

const real = Number(psql("postgres", "select count(*) from company where not is_synthetic"));
if (real === 0) {
  console.error("The local database has no real (non-synthetic) companies. Import the pilot first: python -m scripts.pilot.build_import --import");
  process.exit(2);
}

console.log(`1. Copying the local database into "${SCRATCH}"...`);
docker("pg_dump", "-U", "postgres", "-d", "postgres", "-Fc", "--no-owner", "--no-privileges", "-f", DUMP);
psql("postgres", `drop database if exists ${SCRATCH}`);
psql("postgres", `create database ${SCRATCH} template template0`);
try {
  // pg_cron can only live in the `postgres` database, so its jobs are not restored into the copy (harmless here).
  docker("pg_restore", "-U", "postgres", "-d", SCRATCH, "--no-owner", "--no-privileges", DUMP);
} catch {
  // Checked below by what the copy contains.
}
docker("rm", "-f", DUMP);
// The roles the API and the build use are cluster-wide, but their grants are per database: copy them back.
psql(SCRATCH, "grant usage on schema public, extensions to anon, authenticated; grant select on all tables in schema public to anon, authenticated; grant execute on all functions in schema public to anon, authenticated;");

console.log("2. Keeping only the pilot records, and showing them as if published (in the copy only)...");
// Synthetic companies, and anything the admin e2e left behind (its companies use .test domains).
const removed = psql(SCRATCH, "select count(*) from company where is_synthetic or domain like '%.test'");
// The synthetic rows are many tables deep (jobs, offices, evidence, clicks, ...). This copy is thrown away, so delete them
// with foreign-key triggers off, then remove every row left pointing at a deleted company, office, or job.
psql(
  SCRATCH,
  `set session_replication_role = replica;
   delete from company where is_synthetic or domain like '%.test';
   delete from office o where not exists (select 1 from company c where c.id = o.company_id);
   delete from job j where not exists (select 1 from company c where c.id = j.company_id);
   delete from job_city x where not exists (select 1 from job j where j.id = x.job_id);
   delete from company_type_tag x where not exists (select 1 from company c where c.id = x.company_id);
   delete from company_sector x where not exists (select 1 from company c where c.id = x.company_id);
   delete from company_founder x where not exists (select 1 from company c where c.id = x.company_id);
   delete from slug_redirect x where not exists (select 1 from company c where c.id = x.company_id);
   set session_replication_role = origin;`,
);
const published = psql(
  SCRATCH,
  `with o as (update office set status = 'published' where status = 'draft' returning 1),
        c as (update company set status = 'published' where status = 'draft' and exists (select 1 from office x where x.company_id = company.id) returning 1)
   select (select count(*) from c) || ' companies, ' || (select count(*) from o) || ' offices'`,
);
const counts = psql(SCRATCH, "select string_agg(c.slug || ' ' || (select count(*) from company_filter(c.slug, '{}')), ', ') from city c");
console.log(`   removed ${removed} synthetic companies; marked ${published} as published in the copy`);
console.log(`   companies the build will show, per city: ${counts}`);

const url = `postgresql://postgres:postgres@127.0.0.1:54322/${SCRATCH}`;
console.log(`
3. Build the preview (from code/; it is never for deployment):
   PILOT_PREVIEW=1 SITE_ENV=pilot-preview LOCAL_DATABASE_URL=${url} npm run build
   npm run preview`);
