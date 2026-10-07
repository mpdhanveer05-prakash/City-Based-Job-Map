# Backup and restore (P9-04)

The database is the only thing that cannot be rebuilt from the repository: companies, offices, jobs, the audit log, reports, and the administrators' accounts. The site itself is rebuilt from the database, and the previous Worker version is kept by Cloudflare (see [release-checklist.md](release-checklist.md), "Rolling back").

## What is a backup here

| Part | Where it lives | How it is saved |
| --- | --- | --- |
| Tables, functions, policies, triggers in `public` | Postgres | `pg_dump` (below) |
| Administrators' accounts and passwords | Supabase Auth (`auth` schema) | A full-database dump includes `auth.users`. Restoring it to another project moves the accounts with their password hashes |
| Company logos | Supabase Storage: public bucket `company-logos` and private bucket `company-logos-pending` (migrations `20261007110000_logo_assets.sql`, `20261007130000_logo_pending_bucket.sql`; created only where the database has a `storage` schema; [ADR-0024](decisions/0024-logo-storage-and-provenance.md), proposed). Their provenance rows are in `public.logo_asset` | **Not covered.** `pg_dump` saves the `storage.objects` rows, not the files. Back the files up separately (ADR-0020 §6) and keep the originals outside Supabase |
| Schema | `code/supabase/migrations/` in Git | Already versioned. A restore into a new project starts by applying the migrations, then loading the data |
| Secrets | GitHub and Supabase settings | Not in any backup. Keep a note of where each one came from (the owner's password manager) |

As far as I know the Supabase Free plan does not give you downloadable automatic backups; check the current plan terms before relying on any. **Take your own dump** on a schedule the owner chooses (suggestion: weekly, and before any bulk import), and keep the last four somewhere that is not the same account.

## Taking a dump from a hosted project

Use the **direct** connection string from the Supabase dashboard (Settings, Database), with the database password. Run on any machine with the PostgreSQL client tools of the same major version as the project:

```
pg_dump "<connection string>" --format=custom --no-owner --no-privileges --file=company-map-YYYY-MM-DD.dump
```

Store the file encrypted. It contains personal data of the administrators (their email addresses) and the reports visitors sent.

## Restoring into an empty project

1. Create a new Supabase project (or, to try it first, use the disposable test stack: `node scripts/test-stack.mts start`, project `company-map-test`, database port 55322). **Never use the main local database for this** (owner rule, 7 Oct 2026: it is never reset; it holds the pilot drafts).
2. Apply the migrations, so the schema, roles, and extensions are exactly the ones the dump expects: `npx supabase db push` (hosted) or `node scripts/test-stack.mts reset` (the test stack only).
3. Empty the data tables the migrations seeded, then load only the data:
   `pg_restore --data-only --no-owner --disable-triggers --dbname "<connection string>" company-map-YYYY-MM-DD.dump`
   (`--disable-triggers` keeps the audit log from recording the restore as thousands of new edits, and needs the `postgres` role.)
4. Check: sign in as an administrator, open Companies, and compare the counts on the Dashboard with the source.
5. Run `node scripts/launch-gate.mts` against a fresh build to see that the restored data still passes.
6. Update the GitHub environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_PROJECT_REF` (and `OTHER_ENV_SUPABASE_PROJECT_REF` on the other environment; [deploy-environments.md](deploy-environments.md)), the Edge Function secrets, and `PIPELINE_DATABASE_URL`, and redeploy.

Step 3 has not been run against a hosted project, and the exact flags may need adjusting for it (extensions such as PostGIS come with the migrations, not the dump).

## The drill that has been run

`node scripts/backup-drill.mts` dumps the whole local `postgres` database, restores it into a new empty database inside the same container, and compares row counts for the site's tables plus the number of policies and functions. It proves the dump format and this schema (partitions, policies, functions) restore cleanly. One error is expected and harmless in the scratch copy: **pg_cron can only be created in the `postgres` database**, so the scheduled jobs (`stale-sweep`, `partition-upkeep`) are not restored there. On a real restore, pg_cron is already enabled by the migrations; check afterwards with `select jobname, schedule from cron.job` that the two jobs exist, and re-create them from `migrations/20261005150000_pipeline.sql` if not. Result on 5 Oct 2026, local database after `db reset` (seed data): 23 tables with identical row counts, 100 policies and 38 functions in `public` identical, 20 s, dump 471 KB. **It is not the hosted drill the release checklist asks for.**

The drill's preconditions in the script (`npx supabase db start`, then `db reset`, against the main stack's container by default) predate the owner's rule of 7 Oct 2026: **the main local database must never be reset.** Run it only on the disposable test stack (`node scripts/test-stack.mts start --db-only`, then `node scripts/backup-drill.mts --container supabase_db_company-map-test`), or after taking a `pg_dump` backup of the main database to `.local-backups/`. Not yet run that way.

**Known gaps in the drill** (the script is unchanged):
- Its table list (`TABLES` in `scripts/backup-drill.mts`) omits `field_evidence`, `publication_approval`, `evidence_check`, `evidence_refresh_policy`, `feed_event`, and `logo_asset`, all added after it was written, and it compares no `auth` tables (administrators' accounts and MFA factors).
- Storage is not covered: the logo files in `company-logos` and `company-logos-pending` are neither dumped nor compared.

## Who does what

- The owner decides the schedule, the storage place, and who may read the dumps.
- An engineer runs the drill against the hosted staging project once before launch, and again after any migration that changes data layout, and writes the date and result in progress.md.
