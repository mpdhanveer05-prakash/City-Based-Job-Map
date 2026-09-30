# ADR-0002: Launch scope — Bengaluru and Chennai

- **Status:** Accepted (scope). The dates are open (D-01).
- **Date:** 2026-09-30

## Context
- The architecture plan says the BRD launches Bengaluru and Chennai together, and that the plan itself launches Bengaluru alone (at the owner's earlier request), with Chennai as R2.
- The project owner's current brief (30 Sep 2026) sets **Bengaluru and Chennai as the initial cities**.
- The plan's target dates (gate 6 Nov 2026, launch 18 Jan 2027) are estimated for Bengaluru only.
- The plan also notes the BRD names five cities in the problem statement and eight in the solution. That can't be checked, because the BRD isn't in the repo.

## Decision
Build and test for both cities from the start: both city rows, seeds, routes (`/bangalore`, `/chennai`), and E2E journeys run for both. Each city goes `live` only after passing its own launch gate.

## Consequences
- Chennai needs its own curation, geocoding review, tile coverage check, and coverage target. None of that is in the 18 Jan estimate.
- D-01: the product owner chooses a joint launch (re-estimate) or code for both with a staggered data go-live.
