# ADR-0013: The data pipeline, its database role, and public reports and suggestions

- **Status:** Accepted (engineering decision under ADR-0006; thresholds and the ATS host list are proposals the owner confirms)
- **Date:** 2026-10-05
- **Related tasks / decisions:** P8-01 to P8-05, ADR-0006, ADR-0011, ADR-0012, D-04 (sources), D-07, docs/security.md ("Pipeline", "Public feedback")

## Context

Job data goes stale: roles close, links break, and a company posts new ones. The plan asks for a feed sync from applicant-tracking systems (ATS), a link checker with a two-strike expiry, scheduled sweeps with missed-run detection, rebuilds after each successful run, and a public way to report a bad job or suggest a company. All of it must run on free tiers (ADR-0006): GitHub Actions for Python, Supabase Cron for in-database work, an Edge Function for anything a visitor can call. The pipeline follows URLs that people typed or imported, so it is an SSRF risk, and the feedback form is an open door for spam, so both need a deliberate design.

## Decision

1. **A separate database login for the pipeline.** A `pipeline` role (`NOLOGIN` in the migration; the owner creates a login that is a member of it and stores the connection string as the repository secret `PIPELINE_DATABASE_URL`). It can read the reference tables, companies, offices, sources and feeds, insert and update jobs (and their cities), insert link checks, update a source's last-run columns and the heartbeat's two columns, and call three functions (`record_link_check`, `record_heartbeat`, `missed_heartbeats`). The stale-job sweep and partition upkeep are callable by the service role only: pg_cron runs them inside Supabase. The login is **never the service-role key**, and it cannot read the audit log, admin users, submissions, or click counters.
2. **Feed rules live in one pure Python module** (`scripts/pipeline/plan.py`), tested without a database: a job in the feed is inserted or refreshed and made active; a live job missing from the feed is `suspect` the first time and `expired` the second (two strikes, so one odd response never hides an open job); **an empty feed when the company has live jobs is not believed** and changes nothing. Adapters exist for Greenhouse, Lever, Ashby, Workable, and JSON-LD on a careers page. A trusted ATS feed publishes at once; an admin can still expire a job by hand.
3. **Fetching is SSRF-safe** (`scripts/pipeline/fetch.py`): https only, no credentials in the URL, the host must resolve to a public address, redirects are re-checked, bodies are capped, every request has a timeout. A DNS-rebinding race remains a residual risk, noted in docs/security.md; the runner holds no secret except the pipeline login.
4. **The link checker** (`linkcheck.py`) checks the oldest-checked apply links first (800 per run), records each result in `verification_check` (a table partitioned by month, with RLS on and no grants, one partition per month created by upkeep), and applies the same two-strike rule through `record_link_check`.
5. **Schedules.** `pipeline.yml` runs every six hours (feeds, then links, then a `repository_dispatch` rebuild request when both succeeded); `monitor.yml` runs hourly and **fails when a heartbeat is overdue**, so a red run and the repository's notification email are the alert; pg_cron runs the stale-job sweep (daily, 02:15 UTC) and the partition upkeep (1st of each month, 03:30 UTC) inside Supabase. If pg_cron is not available (as in the Postgres-only CI database) the migration says so and skips the schedule. A run with no secret fails loudly and says why.
6. **Public feedback** (`submit-feedback` Edge Function, JWT verification off). The order is fixed: origin check, Zod validation of a strict schema (unknown fields refused), **Cloudflare Turnstile verified server-side, including the action and hostname, before anything is stored**, then the rate-limit key and the insert through `submit_feedback` (service role only). A report must point at a published company or a live job; a suggestion needs a name and an https link. The limit is **5 stored submissions an hour per key**, where the key is a salted hash of the connection that changes every day (the raw address is never stored). Nothing a visitor sends is public: reviewers read it as plain text in the admin Review page and resolve or reject it.
7. **No personal data is asked for.** The form has no name, email, or phone field, and says not to include them.

## Consequences

- A broken or hostile feed can at worst expire jobs on a two-strike delay, and an empty response never wipes a company.
- Real coverage depends on D-04 (which sources, and the permission to use each): the adapters exist, but no real board is configured. The `source` table records the permission note for each.
- The alert is GitHub's failed-run email. There is no pager, chat message, or dashboard; the owner chooses an error-reporting tool under D-07.
- The pipeline and monitor workflows, and the `PIPELINE_DATABASE_URL`, `GITHUB_DISPATCH_TOKEN`, `TURNSTILE_SECRET_KEY`, and `FEEDBACK_SALT` secrets, have **not** run against a hosted project, because none exists (ADR-0006: staging and production are created by the owner).
- Local checks: the pipeline's database behaviour is tested by pgTAP (`09_pipeline`, `10_feedback`) and `pytest` against the local database; the Edge Function runs end to end in `npm run test:admin` with a stand-in for Cloudflare's verification.

## Sources (with date checked)

- Cloudflare Turnstile server-side validation (`siteverify` returns `success`, `hostname`, `action`) and its published always-pass test keys: written from the published documentation as known on 5 Oct 2026, **not re-fetched during this task**; the local test uses a stand-in for `siteverify`, so the real endpoint has not been called.
- Greenhouse, Lever, Ashby, and Workable public job endpoints: the adapters are written to the response shapes in the test fixtures (`scripts/pipeline/tests/test_feeds.py`). **No live call has been made to any of them**; check each shape against a real board before the first real sync.
