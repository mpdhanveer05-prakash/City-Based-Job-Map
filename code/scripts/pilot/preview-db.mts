// A pilot-only local data source (P9-20): a scratch copy of the local database holding only the real pilot records, for
// looking at them in the built site before anyone has reviewed them.
//
//   node scripts/pilot/preview-db.mts [--container supabase_db_company-map]
//
// 1. Dumps the local `postgres` database and restores it into a new database, `pilot_preview` (as scripts/backup-drill.mts).
// 2. In that copy only: deletes every synthetic company, marks the remaining (pilot) companies and their offices
//    published, and marks their evidence reviewed by a named stand-in: SIMULATED reviews, each listed in
//    pilot_preview.simulated_review (the listing rule needs reviewed evidence). It does
//    this as the database owner, whom the publication gates do not check (they apply to signed-in
//    administrators). It records no approval, and the stand-in's "review" exists only in the copy, which is thrown away.
//    Nothing in the real database changes.
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
// Since 20261007150000 a city lists a real company only through an office whose address and location evidence is REVIEWED.
// The pilot's evidence is unreviewed claims, so without this the preview would show no companies at all. In the copy only,
// the claims are marked reviewed by a stand-in account named for what it is; the real database keeps them as claims, and
// every page of this build says the records are unreviewed.
//
// Provenance is kept: every original evidence field (source, date, recorder, note) stays as it was; only reviewed_at and
// reviewed_by are set, and each such row is listed in pilot_preview.simulated_review. The copy is marked
// (pilot_preview.marker), and the build refuses a marked database for anything but a local pilot preview, never a release
// (lib/api/data-source.ts previewCopyRefusal); the preview's manifest then says pilot_preview, which the launch gate, the
// data refresh and the production smoke check refuse.
const PREVIEW_REVIEWER = "00000000-0000-4000-8000-0000000071b0";
const marked = psql(
  SCRATCH,
  `set session_replication_role = replica;
   create schema pilot_preview;
   create table pilot_preview.marker (made_at timestamptz not null default now(), note text not null);
   insert into pilot_preview.marker (note) values ('Pilot preview copy made by scripts/pilot/preview-db.mts. Its reviews are SIMULATED (pilot_preview.simulated_review). Never deploy or release a build of it.');
   create table pilot_preview.simulated_review (evidence_id bigint primary key, simulated_at timestamptz not null default now(),
     note text not null default 'simulated: not reviewed by a person; pilot preview copy only');
   insert into auth.users (id, email, raw_user_meta_data) values ('${PREVIEW_REVIEWER}', 'pilot-preview-stand-in@local.test',
     '{"simulated": true, "purpose": "pilot preview copy only: not a person, not a review"}') on conflict do nothing;
   insert into pilot_preview.simulated_review (evidence_id) select id from field_evidence where reviewed_at is null;
   with r as (update field_evidence set reviewed_at = now(), reviewed_by = '${PREVIEW_REVIEWER}'
              where id in (select evidence_id from pilot_preview.simulated_review) returning 1)
   select count(*) from r;`,
).split("\n").pop();
console.log(`   marked ${marked} unreviewed evidence items as reviewed by the stand-in "pilot-preview-stand-in@local.test": SIMULATED, listed in pilot_preview.simulated_review (in the copy only)`);
const counts = psql(SCRATCH, "select string_agg(c.slug || ' ' || (select count(*) from company_filter(c.slug, '{}')), ', ') from city c");
console.log(`   removed ${removed} synthetic companies; marked ${published} as published in the copy`);
console.log(`   companies the build will show, per city: ${counts}`);

const url = `postgresql://postgres:postgres@127.0.0.1:54322/${SCRATCH}`;
console.log(`
3. Build the preview (from code/; it is never for deployment):
   PILOT_PREVIEW=1 SITE_ENV=pilot-preview LOCAL_DATABASE_URL=${url} npm run build
   npm run preview`);
