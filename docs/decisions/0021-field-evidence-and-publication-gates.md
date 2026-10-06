# ADR-0021: Evidence for every factual field, and publication gates

- **Status:** Accepted (owner decisions, 6 Oct 2026); implemented locally in P9-07 (6 Oct 2026)
- **Date:** 2026-10-06
- **Related tasks / decisions:** P9-07, [ADR-0016](0016-launch-sequence-and-data-policy.md) (sourcing policy), [ADR-0017](0017-company-status-separate-from-stage.md), [ADR-0012](0012-admin-workspace-and-publishing.md) (reviewer rule). Migrations `20261006120000_field_evidence.sql`, `20261006130000_import_evidence.sql`.

## Context
Before this change there was one `source_id` and one `last_verified_at` per company (the import set neither), a `source_url` without a date on each founder, and a verification flag on each office. Nothing recorded which source supports which fact, or when anyone checked it. The owner decided (6 Oct 2026):

1. Evidence is required for every populated factual field: name, website, office address and location, description, company type, sector, funding stage, ownership status, and founder. Optional fields may stay unknown. Publication needs a verified name, the official website, and at least one verified office in the listed city. Values already stored without support are flagged for review.
2. `verified_at` is the date someone actually checked the source. `reviewed_at`, `reviewed_by`, and the publication approval are recorded separately. Imported dates are claims until reviewed, and are never replaced with today's date.
3. The CSV requires `source_url` and `verified_at` but allows different sources for different fields. A row-level source does not automatically count for every field. Industry maps to sectors, with validation.
4. Evidence is stored against the correct record (company, office, founder, job). Evidence and reviewer information are access-controlled.

## Decision
- **`field_evidence`**: one row per piece of evidence, with exactly one of `company_id`, `office_id`, `founder_id`, `job_id` (cascading deletes). Fields allowed per record: company `name, website, description, types, sectors, startup_stage, ownership_status`; office `address, location`; founder `full_name`; job `title, apply_url`. On insert a trigger copies the field's **current value** into `value`. Evidence therefore supports a value, not a field, and goes stale on its own when the value changes. It also refuses a `verified_at` in the future or before 2000, refuses evidence for an empty field, and forces a signed-in recorder's evidence to start as a claim. Evidence cannot be edited (a correction is a new row) and cannot be deleted through the API. Only a reviewer can set `reviewed_at`/`reviewed_by`, and the database writes them as the reviewer and now.
- **States** (`evidence_report`): `reviewed`, `claimed` (evidence for the current value, not reviewed), `stale` (evidence only for an older value), `missing`.
- **Gates** (deferred constraint triggers, checked at commit, so a save that changes tags and publishes together is judged on its final state):
  - A company becomes `published` only with reviewed evidence for its name and website, at least one non-unpublished office with reviewed address and location evidence, and claimed or reviewed evidence for every other populated factual field.
  - An office needs reviewed address and location evidence.
  - A founder needs reviewed name evidence.
  - Jobs are not gated here: they are verified by the link checks (P8).
  - Each publication and unpublication by a signed-in user is recorded in **`publication_approval`** (who and when).
  - On publication, the company's public "Verified" date becomes the **oldest** `verified_at` among its reviewed core facts. Today's date is never used in its place.
- **Who the gates apply to**: signed-in users, the same scope as the reviewer rule (ADR-0012). The migration owner and the synthetic seed are not gated. The seed's published companies are listed by `evidence_gaps` and on the Review page.
- **Access**: `field_evidence` and `publication_approval` have RLS, and anon has no grant on them. Editors read evidence and record it; reviewers review it. `evidence_report`, `publication_problems`, `evidence_gaps`, and `review_evidence` are not executable by anon. Reviewer identities stay in these tables, never on the public `company` row.
- **CSV**: `source_url` and `verified_at` are required columns. The row source counts only for the fields named in `source_covers`. `<field>_source_url` and `<field>_verified_at` give one field its own source, and both are required together. A filled-in field without evidence is a row error. A per-field source for an empty field is an error; an empty field named in `source_covers` is ignored. `industry` is another name for the sectors column and is validated against the known sectors. A row that adds an office to a listed company needs evidence for the office only. The browser checks all of this for the preview, and `import_commit` checks it again.

## Consequences
- Every company published before this change is flagged until someone records and reviews its evidence. It stays public.
- Publishing now takes more work per company (at least four reviewed facts). That is the point. The admin company page shows each fact's state, the reasons publication is blocked, a form to record evidence, and a review button for reviewers.
- Changing a published company's fact does not unpublish it. The fact's evidence becomes stale and the company appears on the Review page.
- A reviewer can review evidence they recorded themselves. The owner did not ask for a second person; this is a possible future rule.
- Not done: evidence for jobs is storable but has no admin UI or gate. The founder admin page does not exist yet, so founder evidence can only be recorded through the evidence form, which lists existing founders.

## Sources (with date checked)
- Owner instructions, 6 Oct 2026.
