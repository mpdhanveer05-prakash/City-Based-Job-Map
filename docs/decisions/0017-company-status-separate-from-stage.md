# ADR-0017: Company status is a separate field from startup stage

- **Status:** Accepted (owner decision, 6 Oct 2026); implementation is P9-06
- **Date:** 2026-10-06
- **Related tasks / decisions:** resolves D-05. Amends [ADR-0004](0004-company-type-filter-model.md) and data-model.md §2.

## Context
The brief lists "Public" and "Acquired" among the startup stages, and P3-01 built them that way (`startup_stage` enum). But funding stage, ownership status, and company type describe different things. An MNC can be public, and an acquired company may no longer be a startup.

## Decision
- Remove `public` and `acquired` from `startup_stage`. That leaves Pre-seed, Seed, Bootstrapped, Series A, Series B, Series C, and Series C+.
- Add a separate **company status** field (proposed values: `private`, `public`, `acquired`; NULL means unknown). It's backed by evidence (source URL and date), just like the stage.
- The status filter is independent of the type filter, so it isn't tied to Startup. Values inside the group combine with OR, and the group combines with the others by AND (the ADR-0004 rule).
- The change goes into a new migration (applied migrations are never edited). `company_filter`, the TypeScript mirror, the parity matrix, the URL schema, the filter UI, the admin forms, and the synthetic seed all change in step.

## Consequences
- Old URLs carrying `stage=public` or `stage=acquired` are normalised to `status=…`, so shared links keep working.
- The exact value list and labels are a proposal until the owner sees them in the UI.

## Sources (with date checked)
- Owner instructions, 6 Oct 2026.
