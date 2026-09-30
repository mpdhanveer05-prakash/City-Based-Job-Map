# Data Pipeline

Based on the plan's [Data sourcing and verification](../Company%20Map%20—%20Architecture%20&%20Implementation%20Plan.md#data-sourcing-and-verification) section. The actual launch sources aren't decided yet (**D-04**).

## Sources (in order of trust) [Plan]
1. Employer ATS public job-board feeds (Greenhouse, Lever, Ashby, SmartRecruiters). Check each provider's terms before use.
2. schema.org `JobPosting` JSON-LD on the employer's careers pages.
3. Admin CSV imports (companies, offices, founders) with a preview.
4. Visitor suggestions, reviewed before use.

Nothing is ingested without a `source` row recording its permission note. No job aggregators.

## Stages
Fetch (identifying user agent, respects `robots.txt`, ≤ 1 request/s per host) → Normalise (title, role family, experience, work mode) → Assign city (aliases and known offices; unresolved goes to review) → Deduplicate → Geocode offices (boundary check, tech-park snap, accuracy label) → Publish (companies and offices only after admin review) → Re-check → Expire.

## Deduplication
- Jobs: `UNIQUE (company_id, dedup_hash)`, where the hash covers company + normalised title + canonical URL.
- Companies: web domain first, then name similarity > 0.8 goes to review. Merges leave a `slug_redirect`.
- Offices: within 5 m of another office of the same company goes to review. [Proposal]

## Retries
- HTTP: 3 attempts with exponential backoff and jitter on 5xx and timeouts. 4xx responses aren't retried except 429 (honour `Retry-After`). [Proposal]
- Job expiry uses two strikes: first failure → `suspect`, re-check within 6 h, second failure → `expired`. [Plan]
- Jobs are idempotent upserts keyed by `(source_id, external_ref)` or `dedup_hash`. Each run writes an `import_batch`.

## Freshness [Plan, frequencies are proposals]
| Check | Frequency |
| --- | --- |
| Feed sync | every 6 h |
| Link check | every 24 h, plus before a job's first publish |
| Website and logo | weekly |
| Office location | every 90 days and on address change |
| Visitor report | immediate (Edge Function) |

The UI shows "Jobs checked N ago" from the oldest `last_checked_at` on the page, or "Not yet verified". Dates are never invented.

## Missed-run detection [Proposal]
- Every scheduled job writes a heartbeat row (`job_run(name, started_at, finished_at, status)`).
- A Supabase Cron check every 30 min alerts when a job's last successful finish is older than 2× its interval, or when it has failed twice in a row. This covers GitHub Actions schedule delays and schedules disabled in inactive repositories.
- Backstop: the Supabase Cron stale-job sweep hides jobs whose `last_ok_at` is older than 72 h (proposal).
- The alert channel is undecided (D-07).

## Where it runs
- Python scripts in `scripts/`, run by GitHub Actions `schedule` + `workflow_dispatch`. They use a least-privilege Postgres role from GitHub secrets.
- Supabase Cron for SQL-only tasks. An Edge Function for report-triggered re-checks.
