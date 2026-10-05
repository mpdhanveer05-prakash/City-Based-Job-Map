# ADR-0012: The admin workspace, its saves, the audit log, and "Publish now"

- **Status:** Accepted (engineering decision under ADR-0006; the owner is asked about MFA, logo upload, and geocoding, listed below)
- **Date:** 2026-10-05
- **Related tasks / decisions:** P7-01 to P7-04, ADR-0006, docs/security.md ("Admin access"), docs/data-model.md ("Authorization rules"), D-07

## Context

The site is a static export with no server of its own, so the admin workspace is client-rendered and **its JavaScript is public**. Curators need to create and edit companies, offices, and jobs, import lists from CSV, work a review queue, and release changes, with a record of who did what. Roles are editor < reviewer < admin (data-model.md).

## Decision

1. **The UI shows; the database decides.** `/admin` signs in with Supabase Auth (password, no public sign-up) using the public anon key, reads the signed-in user's own `admin_user` row for the role, and hides what the role cannot use. Nothing in the browser is trusted: every read and write is checked by row-level security and by the role checks in Postgres, and each page that hides a control also surfaces the database's refusal in words (`describeError`) when a request goes through anyway. The admin pages are `noindex` and disallowed in `robots.txt`.
2. **Multi-table saves are single function calls.** `admin_save_company` (company, types, sectors), `admin_save_job` (job, cities), and `admin_delete_company` are `SECURITY INVOKER`: each statement runs as the caller, so RLS and the publish-needs-a-reviewer trigger apply as to a direct write. They exist because separate requests are separate transactions, and the startup-stage rule is checked at commit (ADR-0004). Single-table edits (offices, sources, a review decision) are ordinary table writes.
3. **CSV import** is previewed in the browser (`lib/admin/import-rows.ts`: columns, rows, duplicates, errors, warnings) and committed by `import_commit`, which is per-row tolerant (each row in its own sub-transaction), `SECURITY INVOKER`, limited to 2,000 rows, and lands everything as **drafts**. A row for a known domain adds an office to that company. Nothing the browser checks is a boundary: the function checks again, and the tables' constraints and triggers check a third time.
4. **Audit log** (`audit_log`): a trigger records a before and after snapshot of every change to the curated tables, with the actor and their role. It is append-only (a trigger refuses update and delete, even for the owner), readable by reviewers and above, and writable by nothing through the API. The job tables are recorded only for a signed-in admin: the pipeline touches thousands of jobs a day and the Free database is 500 MB. The seed sets `app.skip_audit` so it is not logged.
5. **Releasing is explicit.** An edit is saved at once but reaches visitors only when the site is rebuilt. **Publish now** (reviewer and above) calls the `request-rebuild` Edge Function, deployed with JWT verification **on**. The function calls `publish_now` *as the caller*: the database checks the role, bumps every city's `data_version` (new dataset file URLs), and says whether a build should start now or was requested in the last ten minutes (the debounce of ADR-0006, kept in `site_state`). Only then does the function ask GitHub to run the deploy workflow (`repository_dispatch`, type `rebuild`), with a token only it holds. A debounced press is saved and says when to retry; a failed dispatch says the changes are saved and the nightly build will publish them.
6. **Review queue:** the `review_offices` view (security-invoker) lists offices below building accuracy, unverified, or outside the city boundary, and the suspect jobs are read from `job`. A reviewer accepts a point outside the boundary (`outside_reviewed`), keeps or expires a suspect job; an editor can only mark an office reviewed. The submissions queue arrives with the feedback form (P8-04).
7. **Jobs** need only a title and a link: the `job_defaults` trigger fills `title_norm` and `dedup_hash` (md5 of company, normalised title, and link), and never overwrites a value the pipeline gives.

## Consequences

- An editor's attempt to publish, accept a boundary exception, or decide on a suspect job fails in the database even if the page is altered; the page also disables those controls and says why.
- Real data entry is as slow as the forms: there is no bulk edit beyond the CSV import, and no geocoding (coordinates are typed or imported): D-07 picks the provider. Offices without a precise point stay in the review queue.
- **Not built, and the owner's call:** logo upload to Storage (the `company-logos` bucket and its policies are not created, so `logo_key` is empty until an upload path exists; the `storage` schema is not present in the Postgres-only CI setup, so this needs its own task); MFA for admin accounts (a proposal in security.md; Supabase Auth supports it); a screen to add or remove administrators (an admin inserts `admin_user` rows in the Supabase dashboard).
- The end-to-end admin spec (`npm run test:admin`) needs the full local stack (about 2 GB of memory) and is not in the default `npm run test:e2e` or CI yet; the database and handler tests are.

## Sources (with date checked)

- Supabase JS `onAuthStateChange` and `functions.invoke` behaviour, checked against the installed package (5 Oct 2026); PostgREST embedding and `count: exact`, exercised by the end-to-end spec.
- GitHub REST API "Create a repository dispatch event" (`POST /repos/{owner}/{repo}/dispatches`, 204 on success): known interface, stood in for by a local server in the spec, not called for real.
