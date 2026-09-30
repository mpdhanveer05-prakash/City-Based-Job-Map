# Testing and Verification

**Rule:** a test counts as passing only if it was run and its output was recorded. In [progress.md](progress.md), mark each check as *run (pass/fail)*, *not run*, or *not applicable*.

## Layers
| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | URL-state schema, filter reducer (clearing incompatible filters), worker lineage, animator interpolation, atlas packing, hit-test tie-breaks |
| Database | pgTAP via `supabase test db` | RLS for every role and table, the city-boundary trigger, shared-filter consistency across points, list, and facets |
| Route Handlers | Vitest against local Supabase | Zod validation, cache headers, Turnstile rejection, `/go` URL safety |
| E2E journeys | Playwright | AC01–AC10 (IDs from the BRD, whose text isn't in the repo), for both cities |
| Accessibility | @axe-core/playwright + manual pass | Zero serious or critical axe violations; keyboard-only journey; screen-reader smoke test (NVDA + TalkBack) |
| Map gate | Playwright + real devices | [map-spec.md §10](map-spec.md#10-validation-gate-reproducible) |
| Pipeline | pytest | Parsers, dedup, two-strike expiry, retry/backoff |

## Required consistency tests (confirmed brief)
- Map, Grid, and List return identical company ID sets and counts for a filter matrix that includes overlapping types (Startup+Product), Startup+stage, and search by each of the four kinds.
- Deselecting Startup clears the stages. A URL with a stage but no Startup is normalised.
- A job row's DOM contains only the title and Apply.

## CI (on pull requests)
Lint, typecheck, Vitest, pgTAP (local Supabase in CI), dependency audit, secret scan, and Playwright against a local build. Preview-Worker journeys are added after P1-02.

## Release checklist
- [ ] All CI checks green on the release commit
- [ ] Map gate re-run on the reference devices with each city's real data
- [ ] axe clean, and the manual accessibility pass recorded
- [ ] RLS tests plus the manual anon-key probe (no unpublished data can be read)
- [ ] Secret scan clean, and no privileged key in the client bundle (grep the build output)
- [ ] Backup restore drill done
- [ ] City launch gate passed for each city going live
- [ ] **Explicit authorization for the production deploy recorded**
