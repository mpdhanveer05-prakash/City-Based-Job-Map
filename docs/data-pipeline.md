# Data Pipeline

Based on the plan's [Data sourcing and verification](../Company%20Map%20—%20Architecture%20&%20Implementation%20Plan.md#data-sourcing-and-verification) section. The actual launch sources aren't decided yet (**D-04**).

## Sources (in order of trust) [Plan]
1. Employer ATS public job-board feeds. Built: Greenhouse, Lever, Ashby, and Workable (`scripts/pipeline/feeds.py`). SmartRecruiters is not built. Check each provider's terms before use.
2. schema.org `JobPosting` JSON-LD on the employer's careers pages (provider `jsonld`; the page must be on the company's own domain).
3. Admin CSV imports (companies, offices, founders) with a preview.
4. Visitor suggestions, reviewed before use.

Nothing is ingested without a `source` row recording its permission note. No job aggregators.

Since migration `20261007150000_security_gaps.sql`, the database itself refuses a job the pipeline lists unless it comes from an approved, active feed of a published company, with claimed or reviewed evidence for its title, employer, location, and `apply_url` (the `pipeline_job_gate` trigger).

## Stages
Fetch (identifying user agent, https only, public addresses only, capped body, 20 s timeout, at most 3 redirects: built in `scripts/pipeline/fetch.py`; respecting `robots.txt` and ≤ 1 request/s per host: **Proposal, not built**) → Normalise (title, role family, experience, work mode) → Assign city (aliases and known offices; unresolved goes to review) → Deduplicate → Geocode offices (boundary check, tech-park snap, accuracy label) → Publish (companies and offices only after admin review) → Re-check → Expire.

## Deduplication
- Jobs: `UNIQUE (company_id, dedup_hash)`, where the hash covers company + normalised title + canonical URL.
- Companies: web domain first, then name similarity > 0.8 goes to review. Merges leave a `slug_redirect`.
- Offices: within 5 m of another office of the same company goes to review. [Proposal]

## Retries
- HTTP: 3 attempts with exponential backoff and jitter on 5xx and timeouts. 4xx responses aren't retried except 429 (honour `Retry-After`). [**Proposal, not built**: today a failed request is not retried within a run. `fetch.py` marks 5xx, 429, and network failures as retryable, but nothing retries them; the link check records them as inconclusive and checks the job again next run.]
- Job expiry uses two strikes: first failure → `suspect`, re-check within 6 h, second failure → `expired`. [Plan]
- Jobs are idempotent upserts keyed by `(source_id, external_ref)` or `dedup_hash`. The pipeline does not write an `import_batch` (that table is for admin CSV imports); each run records its heartbeat instead.

## Freshness [Plan, frequencies are proposals]
| Check | Frequency |
| --- | --- |
| Feed sync | every 6 h |
| Link check | every 6 h (each run of `pipeline.yml`, cron `17 */6 * * *`; never-checked and oldest links first, up to 800) |
| Evidence against its source (ADR-0022) | job fields daily; company name, website, and description weekly; tags, stage, status, office, and founder monthly (`evidence_refresh_policy`) |
| Logo | not built |
| Office location | every 90 days and on address change [Proposal, not built; office evidence is re-checked monthly, above] |
| Visitor report | stored immediately by the `submit-feedback` Edge Function for a reviewer; an automatic re-check is not built |

The jobs page shows "Checked N ago" from the oldest `last_ok_at` (last successful check) among the listed jobs, or "Not yet checked" when any listed job has never been confirmed. The page embeds the absolute timestamp and the browser computes "N ago", so it stays correct between builds. Dates are never invented.

## Missed-run detection [Built, P8-03]
- Every scheduled job records a heartbeat when it finishes well (`heartbeat(name, last_ok_at, expected_every, grace)`, `record_heartbeat()`): `feed-sync` and `link-check` every 6 h, `stale-sweep` daily, `partition-upkeep` monthly. Feed sync beats only when at least one feed worked.
- An hourly GitHub Action (`monitor.yml`) calls `missed_heartbeats()` and fails when a job has not finished within its interval plus its grace. The failed run is the alert (GitHub emails the watchers). This covers GitHub Actions schedule delays and schedules disabled in inactive repositories.
- Backstop: the daily pg_cron stale-job sweep (`sweep_stale_jobs`) makes a job nobody has checked for 14 days suspect, and expires a suspect job unchecked for 7 more days.
- Who reads the failure email is not set up yet ([release-checklist.md](release-checklist.md), item 17).

## Where it runs
- Python scripts in `scripts/`, run by GitHub Actions `schedule` + `workflow_dispatch`. They use a least-privilege Postgres role from GitHub secrets.
- Supabase Cron (pg_cron) for SQL-only tasks: the stale sweep and partition upkeep. A report-triggered re-check is not built (no Edge Function for it).
- **After each successful run, the pipeline triggers the site build and deploy** (ADR-0006, P8-05). The static site shows data as of the last build, plus a nightly rebuild.
