# Testing and Verification

**Rule:** a test counts as passing only if it was run and its output was recorded. In [progress.md](progress.md), mark each check as *run (pass/fail)*, *not run*, or *not applicable*.

## Layers
| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | URL-state schema, filter reducer (clearing incompatible filters), worker lineage, animator interpolation, atlas packing, hit-test tie-breaks, design-token contrast pairs ([design-system.md §1](design-system.md#contrast-wcag-22-computed-30-sep-2026)) |
| Database | pgTAP via `supabase test db` | RLS for every role and table, the city-boundary trigger, shared-filter consistency across points, list, and facets |
| Route Handlers | Vitest against local Supabase | Zod validation, cache headers, Turnstile rejection, `/go` URL safety |
| E2E journeys | Playwright | AC01–AC10 (IDs from the BRD, whose text isn't in the repo), for both cities |
| Accessibility | @axe-core/playwright + manual pass | Zero serious or critical axe violations (the `color-contrast` rule stays enabled); keyboard-only journey; screen-reader smoke test (NVDA + TalkBack) |
| Map gate | Playwright + real devices | [map-spec.md §10](map-spec.md#10-validation-gate-reproducible) |
| Pipeline | pytest | Parsers, dedup, two-strike expiry, retry/backoff |

## Required consistency tests (confirmed brief)
- Map, Grid, and List return identical company ID sets and counts for a filter matrix that includes overlapping types (Startup+Product), Startup+stage, and search by each of the four kinds.
- Deselecting Startup clears the stages. A URL with a stage but no Startup is normalised.
- A job row's DOM contains only the title and Apply.

## CI (on pull requests)
Lint, typecheck, Vitest, pgTAP (local Supabase in CI), dependency audit, secret scan, and Playwright against a local build. Preview-Worker journeys are added after P1-02.

**Current workflow** (`.github/workflows/ci.yml`, added in P1-04). It runs on pull requests to `main`, on pushes to `main`, and on demand. It uses a read-only token and needs no secrets.

| Job | Steps |
| --- | --- |
| `checks` | `npm ci`, lint, typecheck, Vitest, build, then `npm audit --audit-level=high` (fails on high or critical) |
| `e2e` | Chromium install, then `npm run test:e2e` (Playwright + axe, desktop and Pixel 7). The HTML report is uploaded on failure |
| `secret-scan` | gitleaks 8.30.1 (checksum-verified) over the full git history |

- Actions are pinned to commit SHAs. Dependabot (`.github/dependabot.yml`) bumps them weekly, along with the npm dependencies in `code/`: minor and patch grouped into one PR, majors separate.
- **Not yet in CI:** pgTAP (arrives with P1-03). `npm audit` covers dependencies.
- The repository became public on 30 Sep 2026, so standard GitHub-hosted runners are free. The first run took 1.7 job-minutes in total (checks 0.6, e2e 1.0, secret scan 0.1). GitHub's dependency-review action is now available on the public repository and could be added in a later PR.

## Release checklist
- [ ] All CI checks green on the release commit
- [ ] Map gate re-run on the reference devices with each city's real data
- [ ] axe clean, and the manual accessibility pass recorded
- [ ] RLS tests plus the manual anon-key probe (no unpublished data can be read)
- [ ] Secret scan clean, and no privileged key in the client bundle (grep the build output)
- [ ] Backup restore drill done
- [ ] City launch gate passed for each city going live
- [ ] **Explicit authorization for the production deploy recorded**
