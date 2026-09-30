# ADR-0004: Overlapping company types and the startup-stage filter

- **Status:** Proposed (D-02, D-05)
- **Date:** 2026-09-30

## Context
The brief requires Startup, MNC, and Product filters, and notes that the categories overlap. The plan stores a single `company_type` value.

## Decision (proposed)
- Company types become multi-valued tags (`company_type_tag`). Selections combine with **OR within the type group** and **AND with other groups**. Results are always de-duplicated by company.
- `startup_stage` is a nullable single value, allowed only on companies tagged `startup`.
- The stage filter UI is **disabled unless Startup is selected**. When Startup is deselected, the stages are cleared from the state and the URL. The server ignores stage parameters without `type=startup`. If a user picks a stage while only MNC is selected, that can't happen, because the control is disabled.
- Selecting MNC + Startup + Seed returns: all MNC-tagged companies **OR** (Startup-tagged companies at the Seed stage). Confirm this rule (D-02).

## Alternatives
- Mutually exclusive single type: simpler, but misrepresents real companies.
- AND within the type group: too restrictive, and surprising for a checkbox group.

## Consequences
The curation guide has to define each type. Facet counts can add up to more than the total, so the UI shows the unique-company total separately.
