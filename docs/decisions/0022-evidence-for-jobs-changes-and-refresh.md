# ADR-0022: Job evidence, reviewed changes to public facts, refresh checks, launch enforcement, and exception approval

- **Status:** Accepted (owner decisions, 6 Oct 2026); implemented locally (6 Oct 2026)
- **Date:** 2026-10-06
- **Related tasks / decisions:** P9-07 follow-ups ([ADR-0021](0021-field-evidence-and-publication-gates.md)), [ADR-0019](0019-dependency-vulnerability-exceptions.md), [ADR-0010](0010-build-data-source.md). Migration `20261006150000_evidence_jobs_refresh.sql`.

## Decision
1. **Jobs.** A published (active or suspect) job needs evidence for its title, employer, location and work arrangement (the cities it is listed in plus `work_mode`), and application URL. An admin publishing a job needs all four reviewed. The pipeline records the evidence when it reads the employer's feed: the job's own posting is the source, and the read date is `verified_at`. New evidence is added only when the value changed, and `job.last_ok_at` stays the last successful check. `job.closed_at` records when a job expired or was withdrawn. The jobs page shows the oldest last successful check among its jobs ("Not yet checked" if any was never confirmed). The company's "Verified" date is labelled as covering company details only.
2. **Changes to public facts pass review first.** For a published company, office, or founder, or an open job, a signed-in user's change to a fact commits only if the new value already has reviewed evidence. This covers types, sectors, and job cities through their own tables. Evidence may therefore be recorded for a **proposed** value before the change. Changes the pipeline makes to a job from its employer's feed are evidenced automatically and are not held for human review. A feed is the employer's own authoritative listing; this exception is recorded here for the owner to confirm.
3. **Self-review** is allowed for reviewers and recorded: `field_evidence.self_reviewed` is a stored generated column, and the admin shows "by the person who recorded it". Editors still cannot review.
4. **Refresh checks.** `evidence_refresh_policy` sets each field's interval (jobs daily, company name, website, and description weekly, the rest monthly) and method (`text` looks for the value on the page; `reachable` only confirms the page answers). `evidence_due` and `record_evidence_check` are for the pipeline role; `python -m scripts.pipeline.cli evidence` runs them in the pipeline workflow. Outcomes are `fetch_failed` (nothing is known; never a change), `value_found`, `value_not_found` (a possible change for a person to confirm), and `reachable`. A check never changes `verified_at`. The Review page lists failed and not-found checks.
5. **Launch enforcement.** The build snapshot carries `evidence_complete` per company and job (`company_evidence_complete`, `job_evidence_complete`: SECURITY DEFINER, yes or no only, published records only). The public files do not carry it. The manifest records the incomplete counts. `RELEASE_BUILD=1` refuses any incomplete published record, as it refuses synthetic data, and the launch gate fails on them. Local and staging data may keep such records.
6. **Exception approval.** Each audit exception has an `approval` record. It is approved only when a named human, not the assessor and not an AI, records `approvedBy` and `approvedOn` between the review and today, and the owner is confirmed. `npm run audit` reports the technical result and the approval separately: CI fails only on the technical result. `npm run audit -- --release` (in the production workflow) fails while any exception is unapproved.

## Consequences
- Every synthetic seed company and job is "evidence incomplete". A release build from them was already refused, and now fails for both reasons.
- Editing a public record takes two steps (evidence, then the change). That is intended.
- The job evidence the pipeline records is a claim. It satisfies the launch rule for jobs (evidence for the current value), but not the admin publication rule (reviewed), which applies to jobs an admin publishes by hand.

## Sources (with date checked)
- Owner instructions, 6 Oct 2026.
