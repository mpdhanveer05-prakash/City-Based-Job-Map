# Testing and Verification

**Rule:** a test counts as passing only if it was run and its output was recorded. In [progress.md](progress.md), mark each check as *run (pass/fail)*, *not run*, or *not applicable*.

## Test databases: the disposable test stack only (owner, 7 Oct 2026)
**Never reset, test against, or fill the main local database** (project `company-map`, port 54322): it holds the Bengaluru pilot drafts. Every database or admin test runs on the **disposable test stack**, a second Supabase project (`company-map-test`, every port +1000: database 55322, API 55321) built from the same `supabase/` folder:

| Step | Command (from `code/`) |
| --- | --- |
| Start (full stack, for admin e2e and the Storage tests) | `node scripts/test-stack.mts start` |
| Start (Postgres only, as CI) | `node scripts/test-stack.mts start --db-only` |
| Reset it (migrations, seed, marker) before each admin run | `node scripts/test-stack.mts reset` |
| pgTAP | `npm run test:db` |
| Parity | `npm run test:parity` (defaults to port 55322; `TEST_DATABASE_URL` to override) |
| Pipeline pytest | `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres python -m pytest scripts/pipeline/tests` |
| Admin e2e | `npm run test:admin` (reads the test stack's keys; its global setup deletes `admin_user` rows, so it must never see the main database) |
| Stop it and discard its data | `node scripts/test-stack.mts stop` |

Every one of these refuses a database that is on port 54322, lacks the `test_stack.marker` table the test stack's seed creates, or holds real (non-synthetic, non-`.test`) companies (`tests/disposable-db.ts`, `scripts/pipeline/tests/conftest.py`; unit-tested). Never run `npx supabase db reset` or `npx supabase test db` without `--workdir .test-stack`. With little free memory, stop the main stack first with a plain `npx supabase stop` (it keeps its data volume; never `--no-backup`) after a `pg_dump` to `.local-backups/`.

## Layers
| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | URL-state schema, filter reducer (clearing incompatible filters), worker lineage, animator interpolation, atlas packing, hit-test tie-breaks, design-token contrast pairs ([design-system.md §1](design-system.md#contrast-wcag-22-computed-30-sep-2026)) |
| Database | pgTAP via `npm run test:db` (the test stack) | RLS for every role and table, the city-boundary trigger, shared-filter consistency across points, list, and facets, the evidence and publication gates, and the security-gap regressions (`16_security_gaps`: each as the role that could reach it) |
| Edge Functions | Vitest over the handler logic (`tests/unit/*-handler.test.ts`), plus the admin e2e through the real functions served by the test stack | Zod validation, Turnstile rejection, rate limit, `click` counter, `request-rebuild` role check |
| Build output | `scripts/check-static-limits.mts` (runs as `postbuild`) + unit tests | Workers static assets Free limits (≤ 18,000 files as the guard, < 25 MiB per file, ≤ 2,000 static / 100 dynamic redirects, ≤ 100 header rules); outbound URL validation; no secret-looking strings in `out/` |
| E2E journeys | Playwright | AC01–AC10 (IDs from the BRD, whose text isn't in the repo), for both cities |
| Accessibility | @axe-core/playwright + manual pass | Zero serious or critical axe violations (the `color-contrast` rule stays enabled); keyboard-only journey; screen-reader smoke test (NVDA + TalkBack) |
| Map gate | Playwright + real devices | [map-spec.md §10](map-spec.md#10-validation-gate-reproducible) |
| Pipeline | pytest | Parsers, dedup, two-strike expiry, the approved-feed rule (there is no retry/backoff code yet) |
| Admin and Edge Functions, end to end | Playwright against the disposable test stack (`npm run test:admin`) | **As built (P7, P8, P9-02):** sign-in and roles, the forms, CSV import, the review queue, Publish now (through the real `request-rebuild` function and a stand-in for GitHub), the audit log, the public forms (through the real `submit-feedback` function and a stand-in for Cloudflare `siteverify`, with the rate limit), the anonymous-API probe, and no CSP violation on the admin dashboard. Needs the full stack (about 2 GB), so it is **not in CI**; run it before a release, after `node scripts/test-stack.mts reset`. The local Edge runtime is occasionally flaky (`503 name resolution failed`); the one place it matters retries that exact answer |
| CSP | Playwright (`tests/e2e/csp.spec.ts`, in the normal e2e run) | No `securitypolicyviolation` on the key public pages; every page has a policy with no `unsafe-inline` or `unsafe-eval` for scripts and no wildcard; an injected inline script and a foreign script are blocked ([ADR-0014](decisions/0014-content-security-policy.md)) |

## Required consistency tests (confirmed brief)
- Map, Grid, and List return identical company ID sets and counts for a filter matrix that includes overlapping types (Startup+Product), Startup+stage, and search by each of the four kinds.
- **Filter parity (ADR-0006):** the TypeScript filter in `lib/filters/` and SQL `company_filter` return identical company-ID sets for the same matrix, against local Supabase. Built in P4-01: `npm run test:parity` (see [filters.md](filters.md)); CI runs it after the database tests.
- Deselecting Startup clears the stages. A URL with a stage but no Startup is normalised.
- A job row's DOM contains only the title and Apply.

## Deployment smoke suite (DEP-3/4, 9 Oct 2026)
- `tests/smoke/site.spec.ts`, `playwright.smoke.config.ts`. It asks the site what it holds and checks that the pages show it:
  - build-info against the deployment policy, and optionally the commit;
  - each city's pointer, files, sizes, cache headers and counts;
  - the pages' status, CSP and robots;
  - no pilot-preview banner;
  - no sample-data notice outside synthetic staging;
  - the explorer's counts against the manifest;
  - company and jobs pages against the data, with safe links.
- Staging runs it twice: on the exact build served locally before deploying (`scripts/smoke-local.mts`), and on the live
  site afterwards, with a rollback.

## Device tooling
- `playwright.cdp.config.ts`: the Android attach mode of `tests/device-test.ts`, against a local Chromium with a DevTools
  port standing in for the phone.
- `tests/e2e/gate-runner.spec.ts`: the in-page runner's refusal and a short complete run (`?cycles=2`), including the download.

## Full e2e run on a laptop (recorded)
- `node scripts/e2e-full-run.mts [--workers 2]` (from `code/`) runs `npm run test:e2e` (both projects) and keeps its record in
  the git-ignored `.local-test-runs/<time>-<commit>/`:
  - `run.json`: the commit, the tree's state, the settings, and the machine's free memory, CPU load and largest processes at the start;
  - `console.log`;
  - `progress.jsonl`: one line per test as it starts and ends, written as it happens (`tests/reporters/progress-reporter.ts`);
  - `resources.jsonl`: free memory and CPU load each minute;
  - `summary.json` and `summary.md`.
- A run that is cut off keeps every result it reached. `node scripts/e2e-full-run.mts summarize <folder>` re-derives its
  summary, listing the tests that started but never finished.
- It refuses to start while something answers on port 3100 (the config would reuse that server and test an old build), or
  while tracked files differ from the commit (unless `--allow-dirty`). Map-heavy specs stay one at a time (`tests/map-slot.ts`)
  whatever the worker count.
- On a laptop, start it detached, so it outlives the terminal or session that started it, and leave the machine otherwise idle:
  the map specs draw WebGL in software.

## CI (on pull requests)
Lint, typecheck, Vitest, pgTAP (local Supabase in CI), dependency audit, secret scan, and Playwright against a local build. Preview-Worker journeys are added after P1-02.

**Current workflow** (`.github/workflows/ci.yml`, added in P1-04). It runs on pull requests to `main`, on pushes to `main`, and on demand. It uses a read-only token and needs no secrets.

| Job | Steps |
| --- | --- |
| `checks` | `npm ci`, lint, typecheck, Vitest, build, then `npm run audit` (`scripts/audit-gate.mts`, ADR-0019): `npm audit` over **every** dependency fails on any high or critical finding not covered by a current, reviewed entry in `code/security/audit-exceptions.json` (at most 90 days; expired and stale entries also fail). The split audit of [ADR-0015](decisions/0015-dependency-audit-gate.md) was not accepted. |
| `e2e` | Chromium install, then `npm run test:e2e` (Playwright + axe, desktop and Pixel 7). The HTML report is uploaded on failure |
| `database` | `node scripts/test-stack.mts start --db-only`, `npm run test:db` (pgTAP), `npm run test:parity`, `npm run data` against the test stack, pipeline pytest, and `npm run data -- --export-seed` with a diff of the committed seed snapshots |
| `secret-scan` | gitleaks 8.30.1 (checksum-verified) over the full git history |

To run the same Playwright suite against a server that's already running (`wrangler dev`, or a preview Worker URL), set `PLAYWRIGHT_BASE_URL`; the suite's own server (`npm run build && npx wrangler dev`) is then skipped. Tests of a feature that build lacks (`public/build-info.json`: a synthetic staging build has no beacon or forms) are skipped with that reason.

- Actions are pinned to commit SHAs. Dependabot (`.github/dependabot.yml`) bumps them weekly, along with the npm dependencies in `code/`: minor and patch grouped into one PR, majors separate.
- **Not in CI:** the admin e2e and the Storage-backed logo tests (they need the full stack); `15_logo_assets` skips its storage part in CI's Postgres-only database.
- The repository became public on 30 Sep 2026, so standard GitHub-hosted runners are free. The first run took 1.7 job-minutes in total (checks 0.6, e2e 1.0, secret scan 0.1). GitHub's dependency-review action is now available on the public repository and could be added in a later PR.

## Release checklist
The full list, with who does each item and its state, is in [release-checklist.md](release-checklist.md). The short form:

- [ ] All CI checks green on the release commit
- [ ] Map gate re-run on the reference devices with each city's real data
- [ ] axe clean, and the manual accessibility pass recorded
- [ ] RLS tests plus the manual anon-key probe (no unpublished data can be read)
- [ ] Secret scan clean, and no privileged key in the client bundle (grep the build output)
- [ ] Backup restore drill done
- [ ] City launch gate passed for each city going live
- [ ] **Explicit authorization for the production deploy recorded**
