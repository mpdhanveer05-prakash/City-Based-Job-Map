# Backup and restore (P9-04)

The database is the only thing that cannot be rebuilt from the repository: companies, offices, jobs, the audit log, reports, and the administrators' accounts. The site itself is rebuilt from the database, and the previous Worker version is kept by Cloudflare (see [release-checklist.md](release-checklist.md), "Rolling back").

## What is a backup here

| Part | Where it lives | How it is saved |
| --- | --- | --- |
| Tables, functions, policies, triggers in `public` | Postgres | `pg_dump` (below) |
| Administrators' accounts and passwords | Supabase Auth (`auth` schema) | A full-database dump includes `auth.users`. Restoring it to another project moves the accounts with their password hashes |
| Company logos | Supabase Storage: public bucket `company-logos` and private bucket `company-logos-pending` (migrations `20261007110000_logo_assets.sql`, `20261007130000_logo_pending_bucket.sql`; created only where the database has a `storage` schema; [ADR-0024](decisions/0024-logo-storage-and-provenance.md), proposed). Their provenance rows are in `public.logo_asset` | `pg_dump` saves only the `storage.objects` rows, so the drill also downloads every file through the Storage API with its SHA-256, and restores and checks it (below). Off-site copies are P9-14 (ADR-0020 §6) |
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

## Protecting the backups

Every dump, including the drill's `database.dump`, holds the administrators' accounts with their **password hashes and
TOTP secrets**, the reports visitors sent, and the unreviewed pilot drafts. So:

- **Never in Git.** `.local-backups/` is in `.gitignore`, and nothing under it is tracked (checked 8 Oct 2026). The drill
  refuses an output folder inside the repository that Git does not ignore.
- **Readable only by the owner's account.** Since 8 Oct 2026, `.local-backups/` grants access only to the owner's Windows
  account and SYSTEM; inherited access was removed. Before that, a `CodexSandboxUsers` group could read it, and so could
  Administrators. To check: `icacls .local-backups`. To undo, if ever needed: `icacls .local-backups /reset /T`.
- **Encrypted before it leaves this laptop.** Never e-mail, upload or sync a dump as it is. Encrypt it first with a
  passphrase kept in the owner's password manager, for example
  `gpg --symmetric --cipher-algo AES256 <file>`, or a 7-Zip archive with AES-256 and encrypted file names. Then copy only
  the encrypted file. Off-site copies (P9-14) follow the same rule, and the passphrase is never stored next to them.
- **Kept short.** Delete local dumps that are no longer needed; keep the latest few.

## The drill (rewritten 8 Oct 2026)

`code/scripts/backup-drill.mts` backs up the database **and** the Storage files, restores them the way a real restore works
(migrations first, then data only), and checks the result part by part. Checks are in `lib/backup-drill.ts`
(unit tests: `tests/unit/backup-drill.test.ts`).

```
node scripts/backup-drill.mts backup --out ../.local-backups/drill-<date>     # main local stack, read only
node scripts/test-stack.mts start                                              # disposable test stack, migrated and seeded
node scripts/backup-drill.mts restore --from ../.local-backups/drill-<date>    # test stack only
DRILL_PASSWORD=... node scripts/backup-drill.mts verify --from ../.local-backups/drill-<date> --sign-in <admin email>
node scripts/test-stack.mts stop                                               # discard it: it now holds a copy of real data
```

- **Backup** (every query in a read-only transaction; the source is never written):
  - a full `pg_dump` (custom format, `--load-via-partition-root`);
  - every file in `company-logos` and `company-logos-pending`, downloaded through the Storage API with its size, type and
    SHA-256;
  - a snapshot: a row count and content hash per table (public; `auth.users`, `auth.identities`, `auth.mfa_factors`
    without their sign-in timestamps), sequences, table and function grants, row-level security, policies, triggers,
    buckets, scheduled jobs, and the rows anon and authenticated can see (measured as those roles).
- **Restore** refuses anything but the disposable test stack, and refuses it while it holds real companies, through the same
  guard as every database test. It also refuses a test stack at another migration. It empties the seeded data
  (`TRUNCATE ... CASCADE`), loads the public data and the three Auth tables with `pg_restore --data-only --disable-triggers`,
  and uploads the files.
  - **Auth on purpose:** accounts, identities and MFA factors. Sessions, refresh tokens and MFA challenges are left out, so
    every administrator signs in again after a restore. Their passwords and TOTP factors still work.
- **Verify** compares every part of the snapshot, then:
  - checks every foreign key for orphans: triggers are off during a data-only load, so Postgres does not check them;
  - checks every file's bytes against the backup, each logo file against the hash its key names, and every
    `logo_asset` row against its files;
  - through the real APIs: anon reads, and with `--sign-in` an administrator signs in, is refused admin data without MFA,
    and reads all of it after a TOTP step-up.

**Run on 8 Oct 2026** (main local stack → test stack; backup `.local-backups/drill-20261008`, git-ignored):
- **Backup:** 32 tables, 1,624 rows; dump 1,038,795 bytes; 5 files (351 bytes).
- **Verify passed, twice in a row:** all 32 tables (content hashes), 13 sequences, 1,459 lines of grants, RLS, policies,
  triggers, buckets and jobs, 60 visibility measures, 61 foreign keys with no orphans, and 5 files plus 3 logo records.
  `reviewer@admin.test` signed in, was refused evidence without MFA, and read all 275 rows after TOTP.
- **Negative control:** on the restored stack, I edited one office address, deleted a sector with triggers off, revoked
  anon's SELECT on `city`, moved a sequence, and replaced a public logo's bytes. Verify failed with 21 problems that named
  each change: the content hash, 20 orphans in `company_sector`, the missing grant and its 8 visibility effects, the
  sequence, and the logo's bytes and key hash.
- **Guard:** a second `restore` into the stack, now holding the 46 real companies, was refused.
- **Main database:** unchanged; stopped with its data kept.

**Not covered yet:**
- **A hosted project.** On a hosted project, `backup` needs the project's connection string and service key instead of the
  local stack. `verify --sign-in` reads the TOTP secret from the database, which a hosted drill would do with the
  administrator's authenticator instead.
- **Off-site storage and the schedule (P9-14).**
- **pg_cron.** The jobs come from the migrations, and the scheduled-jobs check compares them.
- **Edge Function secrets.** They are not in any backup by design (see the table above).

## Who does what

- The owner decides the schedule, the storage place, and who may read the dumps.
- An engineer runs the drill against the hosted staging project once before launch, and again after any migration that changes data layout, and writes the date and result in progress.md.
