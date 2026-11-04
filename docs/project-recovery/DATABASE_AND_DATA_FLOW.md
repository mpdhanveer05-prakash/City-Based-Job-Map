# Database and data flow

> **Snapshot:** 4 Nov 2026, at commit `f95e9ae`. Index: [PROJECT_MASTER_CONTEXT.md](PROJECT_MASTER_CONTEXT.md). Paths are relative
> to `code/`. Specs: [../data-model.md](../data-model.md) (partly stale, see PROJECT_HANDOVER §13.8),
> [../curation-guide.md](../curation-guide.md), [../data-pipeline.md](../data-pipeline.md).

## 1. Migration timeline (`supabase/migrations/`, 30 files)

| # | Migration | Adds or changes |
| --- | --- | --- |
| 1 | `20260930181053_extensions` | `postgis`, `pg_trgm` (schema `extensions`) |
| 2 | `20261003090000_core` | Enums and the core tables: city, neighbourhood, tech_park, source, sector, company, company_type_tag, company_sector, company_founder, office, job, job_city. Triggers: city-boundary check, deferred stage check, `search_doc` |
| 3 | `20261003100000_rls` | `admin_user`, `is_admin(min_role)`, public and admin policies, `require_reviewer_to_publish` |
| 4 | `20261003110000_filter_functions` | `parse_filters`, `company_filter`, `city_points`, `search_companies`, `company_facets` |
| 5 | `20261003120000_city_snapshot` | `city_build_snapshot` v1 |
| 6 | `20261005090000_snapshot_boundary` | `company.is_synthetic`; boundary and synthetic count in the snapshot |
| 7 | `20261005100000_clicks_and_slug_redirects` | `slug_redirect`, `link_click_daily`, `record_click` |
| 8 | `20261005110000_admin` | `audit_log` (append-only) on 14 tables; `site_state`, `publish_now`; `import_batch`, `import_commit` v1; `review_offices` |
| 9 | `20261005120000_job_defaults` | `title_norm`, `dedup_hash` |
| 10 | `20261005130000_admin_views` | `admin_offices` |
| 11 | `20261005140000_admin_save` | `admin_save_company`, `admin_save_job`, `admin_delete_company` (INVOKER) |
| 12 | `20261005150000_pipeline` | `pipeline` role (NOLOGIN); `job_feed`; partitioned `verification_check`; two-strike `record_link_check`; heartbeats; `sweep_stale_jobs`, `verification_upkeep`; pg_cron schedules when available |
| 13 | `20261005160000_feedback` | `submission`, `feedback_rate`, `submit_feedback` |
| 14 | `20261006090000_ownership_status` | **Data migration (applied):** public/acquired move from `startup_stage` to `ownership_status` (ADR-0017) |
| 15 | `20261006120000_field_evidence` | `field_evidence`, reports, `publication_approval`, deferred `publication_gate` (ADR-0021) |
| 16 | `20261006130000_import_evidence` | Evidence required per imported field |
| 17 | `20261006150000_evidence_jobs_refresh` | Job evidence, self-review flag, refresh policy and checks, `job.closed_at` (backfill), `published_change_gate`, `*_evidence_complete` (ADR-0022) |
| 18 | `20261006170000_feed_governance` | Feed approval, `job_feed_guard`, `feed_event`, `record_feed_job_evidence` |
| 19 | `20261006190000_feed_review_actions` | `withdraw_job_feed`, `resolve_feed_event` |
| 20 | `20261007090000_reviewed_optional_facts` | Every populated optional fact needs **reviewed** evidence before publication |
| 21 | `20261007100000_admin_mfa` | `is_admin` requires `aal2` |
| 22 | `20261007110000_logo_assets` | `company-logos` bucket (where a storage schema exists), `logo_asset`, `review_logo`, `logo_key_gate` |
| 23 | `20261007120000_logo_permission_evidence` | Terms quote, storage/display/atlas permissions |
| 24 | `20261007130000_logo_pending_bucket` | Private `company-logos-pending` |
| 25 | `20261007140000_admin_session_checks` | `is_admin` also checks a live aal2 `auth.sessions` row and a verified factor |
| 26 | `20261007150000_security_gaps` | SEC-1…4; a company needs a **published** reviewed office; `listed_office`; `pipeline_job_gate`; approve → copy → activate for logos (backfill of `activated_at`) |
| 27 | `20261007160000_logo_sha256` | `activate-logo` server-side SHA-256 (`request_`/`complete_logo_activation`). **The old laptop's main database is at this migration** |
| 28 | `20261008090000_feed_unknown_feed` | *Pending on the old laptop.* `approve_job_feed`/`withdraw_job_feed` now raise on an unknown feed. No data change |
| 29 | `20261008100000_import_keeps_company_evidence` | *Pending.* `import_commit` keeps a row's company evidence as claims. No data change |
| 30 | `20261008110000_create_job_feed` | *Pending.* Nullable `job_feed.created_by`, `created_at`; `create_job_feed` (reviewer, aal2, always unapproved). No data change |

## 2. Final schema (effective after #30)

- **Geography:** `city` (slug, aliases, status draft/beta/live, centre, boundary, `data_version`) → `neighbourhood`, `tech_park`.
- **Company:**
  - columns: unique slug and domain; `status` draft/published/unpublished/merged; `merged_into`; `startup_stage` (7 values,
    startups only, deferred check); `ownership_status` (private/public/acquired, NULL = unknown); `is_synthetic`; `logo_key`;
    `search_doc`;
  - related tables: `company_type_tag` (multi-valued: startup/mnc/product), `company_sector` → `sector`,
    `company_founder` (draft/published, https source).
- **Office:** PostGIS point, `accuracy` (5 levels), `verification` (unverified/auto/reviewed), `outside_reviewed`, status,
  `last_verified_at`. A boundary trigger rejects points outside the city unless accepted.
- **Job:**
  - columns: `external_ref`, `title_norm`, https `apply_url`, `dedup_hash` (unique per company), status
    active/suspect/expired/withdrawn/draft, `consecutive_failures`, `last_checked_at`, `last_ok_at`, `closed_at`;
  - `job_city` (cities and an optional office).
- **Feeds:** `job_feed` (provider, identifier, approval, withdrawal, creator), unique on company + provider + identifier
  (case-sensitive). `feed_event` records inserts, changes, holds, suspect, closed, and decisions.
- **Evidence:** `field_evidence` (exactly one target, field, bound `value`, https source, `verified_at`, recorder, reviewer,
  generated `self_reviewed`; immutable; no API delete), `evidence_refresh_policy`, `evidence_check`, `publication_approval`.
- **Operations:**
  - admin and history: `admin_user`, `audit_log` (append-only), `site_state`, `import_batch`;
  - pipeline: `verification_check` (monthly partitions), `heartbeat`;
  - public input: `submission`, `feedback_rate`, `link_click_daily`;
  - other: `slug_redirect`, `logo_asset`.
- **Views** (security invoker): `admin_offices`, `review_offices`.
- **Storage:** `company-logos` (public; 1 MB; png, jpeg, webp, gif, avif; no SVG), `company-logos-pending` (private).

### Key functions (D = SECURITY DEFINER, I = INVOKER)

| Group | Functions |
| --- | --- |
| Identity | `is_admin(min_role)` **D** (aal2, a live session, a verified factor, `admin_user` role); `caller_role`, `caller_is_owner`, `caller_is_pipeline` |
| Public filter and build | `company_filter` **I** (the reference filter); `city_points`, `search_companies`, `company_facets` **I**; `listed_office` **D** (anon); `city_build_snapshot` **I**; `company_evidence_complete`, `job_evidence_complete` **D** (anon, yes or no only) |
| Admin | `admin_save_company`, `admin_save_job`, `admin_delete_company`, `import_commit` (2,000 rows at most; drafts and claims) **I**; `publish_now` **D** (reviewer, 10-minute debounce, bumps `data_version`) |
| Evidence | `review_evidence` **I** (reviewer); `evidence_report`, `job_evidence_report`, `field_evidence_state`, `publication_problems`, `job_publication_problems`, `evidence_gaps`, `refresh_problems` |
| Feeds | `create_job_feed`, `approve_job_feed`, `withdraw_job_feed`, `resolve_feed_event` **D** (reviewer, a note required) |
| Logos | `review_logo` **D**; `request_logo_activation` **D** (reviewer); `complete_logo_activation` **D** (service_role; the request must be under 10 minutes old; both hashes must match the key) |
| Pipeline | `record_link_check` **I**; `record_feed_job_evidence`, `evidence_due`, `record_evidence_check` **D**; `record_heartbeat`, `missed_heartbeats`; `sweep_stale_jobs(14)`, `verification_upkeep` (pg_cron) |
| Public input | `record_click`, `submit_feedback` **D** (service_role only; 5 an hour per salted key) |

### Access (RLS) in short

| Role | Reads | Writes |
| --- | --- | --- |
| anon (and signed-in non-admins) | published companies, offices (in beta or live cities) and active or suspect jobs; sectors; slug redirects | nothing |
| editor | most admin tables | drafts, offices, jobs, evidence **claims**, imports, logo uploads (pending bucket) |
| reviewer | the same, plus the audit log and click counts | review evidence, publish and unpublish, decide offices, jobs, submissions, feeds and logos |
| admin | everything | deletes of published records, reference data, `admin_user`, sources |
| `pipeline` | reference data, companies, offices, sources, feeds | jobs, `job_city`, `feed_event`, link and evidence checks, heartbeats; held to `pipeline_job_gate` (an approved, active feed of a published company, plus claimed evidence) |
| `service_role` | — | claims only, and closing jobs (SEC-4: it cannot publish, review, approve feeds or set logos) |
| owner (`postgres`, `supabase_admin`) | everything | **bypasses the gates** (migrations, seed, pg_cron, SQL editor) |

## 3. Publication rules (as enforced)

- A company becomes `published` only with:
  - reviewed evidence for its name and website;
  - at least one **published** office with reviewed address and location evidence;
  - reviewed evidence for every other populated fact.
- Deferred triggers check this at commit, so a save that changes tags and publishes together is judged on its final state.
- A city lists a company only through `listed_office` (or if the company is synthetic).
- Changing a fact of a public record commits only if the **new** value already has reviewed evidence. This covers tags,
  sectors and job cities too.
- Jobs published by an admin need all four facts reviewed (title, employer, location/work mode, apply URL). Feed jobs
  (ADR-0022 §7) need an approved feed and claimed evidence.
- `RELEASE_BUILD=1` refuses synthetic data and any record whose evidence is incomplete.

## 4. Data lifecycle

| Stage | Where | Who |
| --- | --- | --- |
| Research | `data/pilot/bangalore/research/group-*.json` (143 records) | AI-assisted; **untrusted** |
| Verification | `scripts/pilot/verify_research.py` re-fetches each cited page and checks the quote, name and address on the company's own domain; writes `verification.json` and `candidates.json` (51 candidates) | automated, run by a person |
| Evidence | `build_import.py` (one claim per fact), CSV columns, the admin evidence panel, or the pipeline's `record_feed_job_evidence` | everything starts as a **claim** |
| Import | `build_import.py --import` (local only) or `/admin/import` → `import_commit` | person-triggered; result: drafts |
| Review | `review_evidence`, the Review page queues, `review_logo`, held feed changes | **a human reviewer at aal2** |
| Approval | deferred publication gates; `publication_approval`; `approve_job_feed` with a note | a human act, enforced in the database |
| Publication | status → published (office first, then company); Publish now → `publish_now` → dispatch | person-triggered |
| Snapshot | `build-datasets.mts` → `city_build_snapshot` as anon | automated |
| Refresh | `pipeline.yml` every 6 h (sync, linkcheck 800, evidence 300); pg_cron sweeps; `monitor.yml` hourly | automated. **Never run anywhere: no hosted project** |

**Pilot status:**
- **Bengaluru:** 143 researched → 51 source-checked candidates (in Git) → 46 drafts, 46 offices, 262 evidence items, 0
  reviewed, 0 published (old laptop's database only). Not imported: Atlassian, BYJU'S (on hold), InMobi, ThoughtSpot,
  Wipro, which couldn't be geocoded. 44 of the 46 points are locality-accurate and OSM-derived (licence unresolved, D-07).
  No startup tags, founders, jobs or logos yet.
- **Chennai:** no pilot data at all.
- **Seed:** 70 synthetic companies, labelled, with `.example` domains (48 published in Bengaluru, 24 in Chennai).

## 5. Destructive commands and their guards

| Command | Effect | Guard |
| --- | --- | --- |
| `npx supabase db reset` (from `code/`) | wipes the main database | **none in code**; docs and memory only |
| `npx supabase test db` (direct) | pgTAP against the main database (each file rolls back) | none; use `npm run test:db` |
| `npx supabase stop --no-backup` | deletes the main volume | none; plain `stop` keeps the data |
| `npm run test:db`, `test:parity`, `test:admin`, pytest | test stack only | `tests/disposable-db.ts`, `scripts/pipeline/tests/conftest.py`: refuse port 54322, a database without the `company-map-test` marker, or one holding real companies |
| `node scripts/test-stack.mts start/reset/stop` | resets and discards `.test-stack` only | separate workdir and project id |
| `backup-drill.mts restore` | truncates the test stack | the same guard, plus a migration-level check |
| `python -m scripts.pipeline.cli …` | writes to the database `PIPELINE_DATABASE_URL` names | refuses only an unset or placeholder URL |
| `build_import.py --import` | drafts plus a persistent stand-in editor | refuses non-local URLs (a substring check) |
| `verify_research.py` | overwrites the tracked `candidates.json` and `verification.json` | none |

## 6. Known database issues (from the 4 Nov analysis)

| ID | Issue | Confidence |
| --- | --- | --- |
| R14 | `logo_asset_insert` checks only `decision is null` (`supabase/migrations/20261007110000_logo_assets.sql:69-70`). An editor may pre-set `activated_at` and `verified_sha256`, which may let an approved key pass `logo_key_gate` without the server-side hash check | Policy verified; the exploit chain is reasoned and needs a pgTAP demonstration |
| R15 | Any editor can set `office.verification='reviewed'` or `outside_reviewed` (the UI hides the latter). The admin stamps `last_verified_at = now()` (`app/admin/review/page.tsx:247`, `app/admin/offices/edit/page.tsx:114`) | High |
| R16 | A deferred `pipeline_job_gate` failure surfaces at `conn.commit()` and aborts the whole sync, skipping later feeds and the heartbeat (`scripts/pipeline/sync.py:64`). The `evidence` command writes no heartbeat (`scripts/pipeline/cli.py:43-46`) | Medium to high |
| R20 | `create_job_feed`'s duplicate check is case-sensitive and unnormalised (`20261008110000_create_job_feed.sql:59`). `job_feed_guard` keeps approval when `source_id` changes. `publish_now(interval)` accepts any debounce from a reviewer. `click` has no rate limit. The local `minimum_password_length` is 6 | High |
| — | The public-bucket insert policy lets a reviewer upload any bytes under an approved key; activation then fails on the hash, but the file is public by URL | High |
| — | No admin UI for founders, merges, slug redirects, `admin_user`, or reference data (SQL only) | High |
