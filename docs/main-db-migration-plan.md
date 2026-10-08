# Bringing the main local database up to date: plan (not applied)

*Prepared 7 Oct 2026; rehearsed on a restored copy 8 Oct 2026. Status: **not applied**. Apply only when the owner says so.*

The **main local database** (Supabase project `company-map`, port 54322, Docker volume `supabase_db_company-map`) holds
the 46 Bengaluru pilot drafts. It must never be reset. It is at migration `20261007140000`. Two newer migrations exist,
tested only on the disposable test stack:

| Migration | What it changes |
| --- | --- |
| `20261007150000_security_gaps.sql` | SEC-1 to SEC-4, a company needs a published reviewed office, listings need reviewed offices, logos approve → copy → activate |
| `20261007160000_logo_sha256.sql` | logo activation by the `activate-logo` function's server-side SHA-256; drops `activate_logo(bigint)` |

## What it would do to the data already there
- **The pilot drafts:** no change to any row. They stay drafts with claimed evidence. Nothing in either migration deletes,
  publishes, or reviews data.
- **Synthetic sample:** still listed (synthetic records are exempt from the reviewed-office listing rule).
- **The admin e2e leftovers** (`E2E Test Co`, `.test`): still published. It is listed only through offices with reviewed
  address and location evidence. Its approved current logo gets `activated_at` (the backfill in `20261007150000`) but no
  `verified_sha256`, because it was activated before the hash check existed.
- **Storage:** the public-bucket insert policy is replaced; existing files are untouched.
- **Saved previews** (`.local-previews/synthetic`, `.local-previews/pilot`) are files built before both migrations and
  before content-versioned datasets. They keep showing exactly what they showed: they do not read the database. Rebuild
  them only if you want a preview of the new rules.

## Procedure (when approved)
Run from `code/`, with Docker running and the main stack started:
`npx supabase start -x studio,imgproxy,vector,logflare,realtime,pgadmin-schema-diff,migra,postgres-meta`.

1. **Back up**: `docker exec supabase_db_company-map pg_dump -U postgres -Fc -d postgres > ../.local-backups/pre-migrate-<date>.dump`,
   then check the dump lists the pilot rows: `docker exec -i supabase_db_company-map pg_restore -l < <dump> | grep -c "TABLE DATA"`.
2. **Record the before state** (values on 8 Oct 2026): pilot drafts (non-synthetic, not `.test`, draft) = 46; their draft
   offices = 46; their evidence (company and office rows) = 262, 0 reviewed; all companies 117, offices 137, jobs 115,
   evidence 275, logo uploads 3; `company_filter('bangalore', '{}')` = 49 (the 48 synthetic companies plus the published
   `E2E Test Co`), `company_filter('chennai', '{}')` = 24; `select max(version) from supabase_migrations.schema_migrations`
   = `20261007140000`.
3. **Rehearse on a copy** (done once on 8 Oct, below; repeat if the database changed since). In the same container:
   - as `supabase_admin`: `create database rehearse_migrate template template0`, then
     `alter database rehearse_migrate owner to postgres`. **The owner matters:** the real database is owned by `postgres`,
     and in a copy owned by `supabase_admin`, `postgres` cannot create in `public` and both migrations stop at their first
     `create`;
   - `pg_restore -U supabase_admin -d rehearse_migrate <dump>`. Expect 19 errors, all `pg_cron` (it can exist only in the
     `postgres` database; neither migration uses it);
   - as `postgres`, the role `migration up` uses: apply each file with `psql -v ON_ERROR_STOP=1 -1 -f`;
   - compare the counts from step 2, then drop the scratch database. Nothing touches `postgres`.
4. **Apply**: `npx supabase migration up` applies only the pending migrations to the local database, each in its own
   transaction. It **does not reset**. Never use `db reset` here.
5. **Verify**: `npx supabase migration list` shows both as applied, the counts from step 2 are unchanged, and
   `company_filter('bangalore', '{}')` still returns 49 and `company_filter('chennai', '{}')` 24.
6. **If something is wrong**:
   - A failed migration rolls back its own transaction and leaves the database as it was: stop and investigate.
   - If it applied but the result is wrong, the dump from step 1 is the way back. Restoring over the main database
     (`pg_restore --clean --if-exists`) has **not been verified**. Rehearse that on a scratch database first. Do not drop
     or recreate the main volume without the owner's explicit approval.

## Rehearsal (8 Oct 2026)
- **Backup:** `.local-backups/pre-migrate-20261008-125054.dump` (1,015,281 bytes, 77 table-data entries), taken with
  only the database container running (`npx supabase db start`).
- **Restore** into `rehearse_migrate`: 19 errors, all `pg_cron`, as expected.
- **First attempt failed safely:** with the copy owned by `supabase_admin`, both files stopped at their first `create`
  ("permission denied for schema public"). Each rolled back, and the counts were unchanged. Cause: the copy's owner, not
  the migrations (the real database is owned by `postgres`). Step 3 now sets the owner.
- **Second attempt:** both files applied with exit 0.
- **Counts after:** identical to step 2 in every column (46, 46, 262, 0; 117, 137, 115, 275, 3; Bengaluru 49, Chennai 24).
- **Spot checks on the copy:**
  - `activate_logo(bigint)` is gone;
  - `request_logo_activation`, `complete_logo_activation`, `logo_key_sha256`, `listed_office`, `caller_role` and
    `pipeline_job_gate` exist;
  - `authenticated` cannot execute `complete_logo_activation`;
  - logo uploads: 3, of which 1 activated (the backfill) and 0 with `verified_sha256`, as predicted above;
  - the `company_logos_publish` storage policy exists.
- **Afterwards:** the scratch database was dropped. The main database was checked unchanged (still `20261007140000`,
  same counts), and the stack was stopped with a plain `npx supabase stop` (data kept).
- **Not rehearsed:** `npx supabase migration up` itself (it would write to the main database), and a `pg_restore --clean`
  over the main database.
