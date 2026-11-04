# Pending work and roadmap

> **Snapshot:** 4 Nov 2026, at commit `f95e9ae`. Task statuses live in [../../plan.md](../../plan.md) and the next action in
> [../session-handoff.md](../session-handoff.md). Index: [PROJECT_MASTER_CONTEXT.md](PROJECT_MASTER_CONTEXT.md).

**Who acts:**
- **Owner:** decisions, accounts, authorizations.
- **Reviewer:** a named human data curator (never an AI).
- **Dev:** Claude Code or another developer, working locally.

**Priority:**
- **P0:** blocks the Bengaluru launch.
- **P1:** before launch.
- **P2:** after launch.

## 1. Next stages, in order

| Stage | What | Who | Gate to the next stage |
| --- | --- | --- | --- |
| 0 | **RESCUE-1:** export everything from the old laptop ([NEW_MACHINE_SETUP.md](NEW_MACHINE_SETUP.md) Part A) | Owner (or a Claude session there, with go-aheads) | encrypted archive on USB; unpushed work on a pushed `wip/RESCUE-*` branch, or none |
| 1 | **SETUP-1:** re-clone to `C:\dev\City-Based-Job-Map`, tools, `npm ci`, baseline checks (Part B) | Owner (installs) + Dev | baseline recorded in the handoff |
| 2 | **DB-RESTORE:** restore drill + `verify` on the test stack; choose option A or B for the main stack (Part C) | Dev + Owner decision | `verify` passes → the old laptop may be released; handoff names the new pilot-DB owner |
| 3 | Code fixes Dev can do without the owner (section 3) | Dev | each with tests, on its own branch or batch |
| 4 | Path to production ([../session-handoff.md](../session-handoff.md) "Path to production"; [../release-checklist.md](../release-checklist.md)) | mostly Owner | the owner's written deploy authorization |

## 2. Owner and reviewer items (P0 unless marked)

| ID | Item |
| --- | --- |
| D-04 | Launch coverage per city and the launch-gate thresholds. `lib/launch-gate.ts` has 300/100 companies, 90% and 7 days; the architecture plan has 800/300, 95% and 24 h |
| D-07 | Geocoding provider. Also how ODbL would be met for any OSM-derived point; 44 of the 46 pilot points are OSM locality centroids |
| P9-20 | A **human reviewer** for the 46 Bengaluru drafts (and the BYJU'S decision, plus the 5 unplaced companies) |
| D-06 / P2-09 | The real devices (mid-range Android, iPhone, laptop) and a gate owner for the map performance gate |
| Staging preview | A Cloudflare token (Workers Scripts: Edit) and the account ID as `staging` **environment** secrets; delete the repository-level copies and revoke the old token; a Geoapify key restricted to the staging host (`GEOAPIFY_KEY`); enable Deploy staging |
| ENV-1 | Hosted Supabase staging, then production: sign-ups off, TOTP on, admins created by hand, the Edge Function secrets (`ALLOWED_ORIGINS`, `TURNSTILE_SECRET_KEY`, `FEEDBACK_SALT`, `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPOSITORY`; later `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS`, production `REBUILD_EVENT_TYPE`) |
| PIPE-1 | Which project the pipeline serves; `PIPELINE_DATABASE_URL` as an environment secret |
| P9-10 | Sentry DSN and a Cloudflare Web Analytics token; privacy notice |
| P9-14 | Off-site backup target and schedule |
| P9-15 | officemap.tech DNS on Cloudflare; a Worker custom domain |
| P1 | Logo permitted-use categories (ADR-0024, with legal); ADR-0009 north-up; UX-1 (do "open jobs" include suspect ones?); founders at launch (needs P9-08 and legal); repository visibility; Dependabot merges; spending proposals (ADR-0018) |
| History bundle | Whether to keep `pre-history-cleanup-20261012.bundle` and the `backup/*` branch now that GitHub's history is confirmed clean |

## 3. Dev tasks (new IDs from the 4 Nov analysis, plus existing ones)

| ID | Task | Pri | Notes |
| --- | --- | --- | --- |
| **BUILD-CITY** (R13) | Let a release contain only the cities that are ready: honour `city.status` (build and route only `beta`/`live` cities), keep the empty-dataset refusal for those, and adjust the city page, sitemap, launch gate and smoke tests | **P0** | `code/scripts/build-datasets.mts:120-130` throws on any city with no published companies, so a Bengaluru-only production build is impossible. Changes launch behaviour, so **write an ADR first and get the owner's agreement** |
| **DEPLOY-HARDEN** (R3) | Production deploy: pre-deploy local smoke, record the previous Worker version, automatic rollback of its own deploy, keep the artifact `if: always()`, check the `wrangler deployments status --json` shape before relying on it | P0 | `.github/workflows/deploy-production.yml:102-134`, `code/lib/release.ts:196-207`. Staging and the refresh workflow already have these |
| **WRANGLER-SAFE** (R2) | Make a bare `wrangler deploy` unable to reach production (for example, swap the default name or add a guard script); have `deploy:staging` run `check-deploy-env` | P1 | Proposal; changes deploy configuration → ADR |
| **SCAN-1** (R4) | Postbuild secret patterns: JWT service-role keys (decode the payload role), Cloudflare and GitHub tokens, database URLs that carry a password | P1 | `code/scripts/check-static-limits.mts:24-30` |
| **RLS-2** (R14, R15, part of R20) | Restrict the `logo_asset` insert columns (no pre-set activation fields); reviewer-only `office.verification='reviewed'` and `outside_reviewed`; stop browser-stamped `last_verified_at = now()`; clear feed approval on a `source_id` change | P1 | Demonstrate each as the role first on the test stack (the project's practice), then add a migration and pgTAP |
| **PIPE-2** (R16) | Per-feed commit, or catch deferred-gate failures per feed; heartbeat for `evidence` | P1 | `code/scripts/pipeline/sync.py:64`, `repo.py:96-116`, `cli.py:43-46` |
| **UI-FIX-1** (R19) | "Show on map" in dense clusters; the `?company=` race before `search.json`; spider and list counts by company; worker error handling; stale-404 reload button; focus return to the marker's list entry; tokenise the `rgb(31 58 26)` shadows | P1–P2 | write a failing e2e or unit test first; see [MODULE_INVENTORY.md](MODULE_INVENTORY.md) |
| DOC-1 (extended) | Fix the stale docs: PROJECT_HANDOVER §13 leftovers; the parity `db reset` comments (`code/vitest.parity.config.ts:4`, `code/tests/parity/filter-parity.test.ts:14,94`); the architecture.md function count; README status; the CLAUDE.md Commands table (`npm run gate`, `gate-report`, `test:watch`, `preview-db.mts`); deploy-environments/testing smoke wording; release-checklist items 1, 4, 11 and 13; "wrangler pages" comments | P1 | The comment edits touch `.ts` files: run lint, typecheck and unit |
| P9-08 | Founder correction and removal route, data-policy page, admin handling | P1 (P0 if founders launch) | Needs legal wording |
| Click rate limit | Salted, daily-rotated key, as in `submit-feedback` | P2 | ADR-0011 consequence |
| CI-PILOT | Run `scripts/pilot/tests` in CI; add pip to Dependabot or pin `scripts/requirements.txt` (R9) | P2 | `.github/workflows/ci.yml:116`, `.github/dependabot.yml` |
| P5-05, P4-03 | Row-hover highlight; cluster inherits the selection ring | P2 | — |
| P6-04 | Jobs on the company page | standby | only if the build warns above 15,000 files |

## 4. Risk register

| # | Risk | Sev | Conf | Where |
| --- | --- | --- | --- | --- |
| R1 | Pilot data loss: the only copy is on a laptop that is leaving | High | High | handoff "Only on the Windows laptop" → RESCUE-1 |
| R2 | A bare `npx wrangler deploy` targets the production Worker; `deploy:staging` skips every check | Med (high impact) | High | `code/wrangler.jsonc:6`, `code/package.json:21` |
| R3 | Production deploy: no pre-deploy smoke, no automatic rollback, no artifact on failure; the Worker-version JSON shape is unverified, so a release could end up without a tag | Med | High / Med | `.github/workflows/deploy-production.yml:102-134` |
| R4 | The postbuild secret scan misses several key formats | Med | High | `code/scripts/check-static-limits.mts:24-30` |
| R5 | Comments instruct `db reset` | Med | High | parity files above |
| R6 | Cloudflare secrets and `PIPELINE_DATABASE_URL` at repository level | Med | Med (per handoff) | GitHub settings |
| R7 | Geoapify key public and (last checked) unrestricted | Low–Med | Med | ADR-0008 |
| R8 | No HSTS, COOP or CORP; no CODEOWNERS for the production workflows | Low | High | `code/public/_headers` |
| R9 | Python dependencies unpinned and not watched by Dependabot | Low | High | `code/scripts/requirements.txt` |
| R10 | New npm advisories since 2 Nov | Med | Med | run `npm run audit` first |
| R11 | A real anon key in `.env.local` makes e2e builds read the local stack instead of the seed | Low–Med | Med | `code/playwright.config.ts:49-54` |
| R12 | Admin e2e leaves test TOTP secrets in `%TEMP%`; its GitHub stand-in binds `0.0.0.0:4099` | Low | High | `code/tests/admin/global-setup.ts:148` |
| R13 | The build refuses a Bengaluru-only release | **High (launch)** | High | `code/scripts/build-datasets.mts:120-130` |
| R14 | `logo_asset` insert may allow pre-set activation fields | Low–Med | Med | `code/supabase/migrations/20261007110000_logo_assets.sql:69-70` |
| R15 | Editors can mark offices reviewed or accept them outside the boundary; browser-stamped `last_verified_at` | Low–Med | High | `code/app/admin/review/page.tsx:247,252` |
| R16 | One pipeline gate failure aborts the sync; no heartbeat for `evidence` | Low–Med | Med–High | `code/scripts/pipeline/sync.py:64` |
| R17 | `verify_research.py` overwrites tracked evidence files | Low | High | `code/scripts/pilot/verify_research.py` |
| R18 | The pipeline CLI has no target-database guard; `build_import --import` leaves a stand-in editor | Low | High | `code/scripts/pilot/build_import.py:138-146` |
| R19 | Explorer defects (see UI-FIX-1) | Low–Med | Med–High | `code/map/explorer-map.ts`, `code/components/explorer/explorer.tsx` |
| R20 | Smaller database items (case-sensitive feed duplicates, feed source change, `publish_now` interval, click rate limit, password length 6 locally) | Low | High | [DATABASE_AND_DATA_FLOW.md](DATABASE_AND_DATA_FLOW.md) §6 |

## 5. After launch

Chennai as a separate data release with its own launch gate (DATA-3). Then: the PMTiles evaluation (P9-11), Phase 10 (a
shortlist with Dexie, recently viewed, compare, cluster previews, neighbourhood insights, more cities), and `JobPosting`
markup if job descriptions are ever added.
