# Module inventory

> **Snapshot:** 4 Nov 2026, at commit `f95e9ae`. Index: [PROJECT_MASTER_CONTEXT.md](PROJECT_MASTER_CONTEXT.md). Paths are relative
> to `code/`.

**Status values:**
- **COMPLETE:** built and covered by local tests.
- **PARTIAL:** built with a named gap.
- **PLACEHOLDER:** empty or obsolete.

No `TODO`, `FIXME`, `XXX` or `HACK` comments exist anywhere in `app`, `components`, `lib`, `map`, `supabase`, `scripts`,
`tests` or `.github` (checked 4 Nov 2026).

## Routes (`app/`)

| Route | File | Data | Status |
| --- | --- | --- | --- |
| `/` | `app/(public)/page.tsx` | `loadAllCities()` at build; Hyderabad, Pune and Mumbai hard-coded as "coming soon" | COMPLETE |
| `/bangalore`, `/chennai` | `app/(public)/[city]/page.tsx` (`dynamicParams=false`) | manifest at build; JSON in the browser | COMPLETE |
| `/companies/[slug]`, `/companies/[slug]/jobs` | `app/(public)/companies/[slug]/**` | `loadCompanyPages()` (all four files of every city) | COMPLETE |
| `/suggest` | `app/(public)/suggest/page.tsx` | `submit-feedback` | COMPLETE (only when the build has the feature) |
| 404, robots, sitemap | `app/not-found.tsx`, `app/robots.ts`, `app/sitemap.ts` | `lib/site.ts` | COMPLETE |
| `/admin/**` | `app/admin/{page,companies,companies/edit,offices,offices/edit,jobs,jobs/edit,feeds,sources,import,review,audit}` | Supabase (anon key and session) | COMPLETE locally |
| `/dev/{tokens,basemap,cluster-worker,map-layer,map-lifecycle,explorer-list}` | `app/dev/*/page.dev.tsx` | synthetic fixtures | dev and gate tooling; built only with `DEV_ROUTES=on` |
| `/go/*`, `/api/v1/*` | `app/go/.gitkeep`, `app/api/v1/.gitkeep` | — | **PLACEHOLDER**, left over from the plan before ADR-0006 |
| `/bengaluru` → `/bangalore` | `config/redirects.static` → `_redirects` | — | COMPLETE |

Layouts:
- `app/layout.tsx`: Overpass font; `noindex` unless indexable; pilot banner.
- `app/(public)/layout.tsx`: `SampleDataNotice` while any city's data is synthetic.

## `lib/`

| Folder or file | Responsibility | Key exports | Status |
| --- | --- | --- | --- |
| `lib/filters/schema.ts` | enums, normalisation, filter changes | `CITY_SLUGS`, `COMPANY_TYPES`, `STARTUP_STAGES`, `OWNERSHIP_STATUSES`, `normalizeFilters`, `applyFilterChange`, `toSqlFilters` | COMPLETE |
| `lib/filters/url.ts` | URL ⇄ state | `explorerSearchSchema`, `parseExplorerState`, `serializeExplorerSearch`, `canonicalRewrite`, `historyMode` | COMPLETE |
| `lib/filters/filter.ts` | **the one TypeScript filter** (mirrors SQL `company_filter`) | `prepareIndex`, `filterResult`, `listRows`, `companyFacets`, `companyFilter`, `cityPoints`, `searchCompanies` | COMPLETE |
| `lib/filters/dataset.ts`, `dataset-files.ts` | snapshot schema (zod/mini); version hash and manifest (build-only, `node:crypto`) | `citySnapshotSchema`, `splitSnapshot`, `datasetVersion`, `buildManifest`, `serializeDataset` | COMPLETE |
| `lib/explorer/*` | URL store hook (the Next 16.4 fix), suggestions, filter hash (FNV-1a), labels, the last explorer URL | `useExplorerState`, `buildSuggestions` | COMPLETE; suggestions ignore the active filters |
| `lib/data/*` | build-time city and company loaders (`node:fs`); browser fetchers; logo URLs | `loadAllCities`, `buildCompanyPages`, `fetchCityFiles`, `fetchSearchFile`, `logoUrl` | COMPLETE; `logoHost()` is orphaned |
| `lib/api/*` | build data source and snapshot fetch | `chooseDataSource`, `assertReleaseData`, `fetchCitySnapshot` | COMPLETE |
| `lib/admin/*` | CSV parsing, import rows and evidence, forms, errors, publish messages, audit helpers, URL params | — | COMPLETE. `forms.ts` imports full `zod` (admin bundle only) |
| `lib/supabase/browser.ts` | admin Supabase client (anon key, persisted session) | `supabaseUrl()` | COMPLETE |
| `lib/design/*` | token names and contrast pairs (no values); WCAG maths | — | COMPLETE |
| `lib/{beacon,feedback,links,csp,build-features,company-text,city-art,redirects,segment-files,zod-config,format-date,site,utils}.ts` | beacon, feedback POST, outbound-link rules, CSP builder, feature policy, text and JSON-LD, city SVG, slug redirects, Windows export repair, zod `jitless`, dates, site URL | — | COMPLETE |
| `lib/{audit-gate,release,launch-gate,backup-drill}.ts` | operations logic, unit-tested | — | COMPLETE; deploy-side never run |

## `components/`

| Folder | Contents | Status and gaps |
| --- | --- | --- |
| `explorer/` | `explorer.tsx` (shell), `explorer-map-view.tsx`, `explorer-toolbar.tsx`, `filter-controls.tsx` (popover or phone sheet), `filter-group.tsx`, `search-suggestions.tsx`, `company-views.tsx` (List, Grid), `virtual-rows.tsx` (virtualised above 100), `map-popup.tsx`, `map-a11y-list.tsx`, `floating.ts` | COMPLETE. Missing: hovering a list row doesn't highlight its marker (P5-05). The popup shows a letter, never the logo. Focus after closing the popup goes to the first list entry. The stale-data 404 offers "Try again" instead of a reload |
| `company/` | `outbound-link`, `back-to-map`, `company-avatar`, `freshness` | COMPLETE |
| `feedback/` | `feedback-form`, `report-disclosure`, `turnstile` | COMPLETE; no timeout on the submission; no message if Turnstile fails to load |
| `city/` | `city-tile` | COMPLETE |
| `admin/` | `admin-root` (sign-in, MFA, roles), `evidence-panel`, `logo-panel` (its top comment describes the old flow), `company-picker`, `ui`, `use-reference` | COMPLETE locally |
| `ui/` | shadcn `button`, `popover`, `sheet` | COMPLETE. Raw `rgb(31 58 26 / …)` shadows in `popover.tsx:20`, `sheet.tsx:20`, `explorer/floating.ts:2` and `map-popup.tsx:44` bypass the tokens |
| `providers.tsx`, `sample-data-notice.tsx` | TanStack Query (city page only, P9-12); synthetic-data label | COMPLETE |

## `map/` (no React at run time; `explorer-map.ts:10-11` imports two types from `components/`)

| Module | Responsibility | Status and gaps |
| --- | --- | --- |
| `basemap.ts`, `theme.ts`, `fallback.ts` | `loadMapLibre()`, themed style with retries, `lockNorthUp`; CSS tokens → theme; WebGL2 check, tile-failure monitor | COMPLETE |
| `explorer-map.ts` | the orchestrator: create, `setOffices`, refresh, taps, popup sync, keyboard mirror, dispose | COMPLETE. Gaps: worker failures are silent (no `catch`, no `onerror`); a possible context leak if setup throws after the basemap is created (`:181-192`); `?? 0` puts an unknown company at index 0 (`:210`) |
| `layer/` | `company-layer.ts` (one instanced draw call), `instances.ts` (FramePacker), `geometry.ts` (float64 projection), `colocation.ts` (5 m), `spider.ts`, `marker-controller.ts`, `shaders/marker.ts` (SDF, uniforms only) | COMPLETE. The spider and list size count offices, not companies (`spider.ts:89`, `explorer-map.ts:463`), so a company with co-located offices gives duplicate keys and an inflated count |
| `worker/` | `protocol.ts`, `client.ts` (generations, transferables), `cluster.worker.ts`, `worker-api.ts`, `cluster-engine.ts` (Supercluster), `lineage.ts` | COMPLETE |
| `atlas/` | `logo-atlas.ts`, `slot-allocator.ts` (LRU), `budget.ts`, `logo-loader.ts`, `fallback.ts` (letter and swatch), `glyphs.ts`, `glyph-sheet.ts` | COMPLETE. The `allowedHosts` restriction is not wired; never run with real logos (every seed `logo_key` is null) |
| `animation/` | `animator.ts`, `easing.ts`, `targets.ts` | COMPLETE; `targetsFromResponse` is orphaned |
| `hit-test/` | `hit-test.ts`, `interactions.ts` | COMPLETE |
| `popup-placement.ts`, `a11y-mirror.ts` | popup and sheet placement; keyboard mirror | COMPLETE; `SHEET_EXPANDED` is unused (the 60% sheet isn't wired) |
| `fixtures/` | deterministic S/M/L generator, hotspots, gate filters, CLI, `manifest.json` (SHA-256s) | dev and gate only. Still uses the old `public`/`acquired` stages and the `bengaluru` slug |

## `supabase/`

| Part | Contents | Status |
| --- | --- | --- |
| `migrations/` | 30 files, 30 Sep → 8 Oct 2026 | COMPLETE locally; never applied to a hosted project. See [DATABASE_AND_DATA_FLOW.md](DATABASE_AND_DATA_FLOW.md) |
| `functions/` | `click`, `submit-feedback`, `request-rebuild`, `activate-logo` (each with `deno.json` pinning zod 4.6.5), plus `_shared/*-handler.ts` (pure, unit-tested with Vitest) | COMPLETE locally; never deployed |
| `seed/` | `01_sample_data.sql` (70 synthetic companies, labelled), `snapshots/{bangalore,chennai}.json` (CI checks for drift) | COMPLETE |
| `tests/database/` | 19 pgTAP files, 781 planned assertions | COMPLETE |
| `config.toml` | local stack settings; `verify_jwt=false` for `click` and `submit-feedback` | local only |

## `scripts/`

| Script | Role | Destructive or external? |
| --- | --- | --- |
| `build-datasets.mts` | city datasets, `_redirects`; `--export-seed` rewrites the committed snapshots | writes `public/`; `--export-seed` rewrites tracked files |
| `copy-maplibre`, `check-build-config`, `fix-segment-files`, `inject-csp`, `check-static-limits` | build steps | local files only |
| `audit-gate.mts` | `npm run audit` (`--release`) | network (`npm audit`) |
| `launch-gate.mts`, `gate-report.mts` | city launch gate; map-gate report | read-only |
| `check-deploy-env`, `release-tag`, `release-record`, `refresh-guard`, `approved-baseline`, `worker-version`, `smoke-production.sh` | deploy workflows | GitHub API, live sites |
| `smoke-local.mts` | serves `out/` and runs `tests/smoke` | local server |
| `test-stack.mts` | disposable second Supabase stack (`company-map-test`, :55322/:55321) | resets and discards **only** the test stack |
| `backup-drill.mts` | backup (main stack, read-only), restore (test stack only), verify | restore truncates the test stack |
| `e2e-full-run.mts` | recorded full e2e run in `.local-test-runs/` | keeps the machine awake (Windows) |
| `pipeline/*.py` | `cli.py` (`sync`, `linkcheck`, `evidence`, `monitor`), `feeds.py`, `fetch.py` (SSRF-safe), `plan.py` (pure rules), `sync.py`, `linkcheck.py`, `evidence.py`, `repo.py`, `links.py`, `models.py` | writes to whichever database `PIPELINE_DATABASE_URL` names. Gaps: one deferred-gate failure aborts the whole sync; `evidence` writes no heartbeat |
| `pilot/*.py`, `pilot/preview-db.mts` | `verify_research.py` (re-checks pages; **overwrites tracked** results); `build_import.py` (Nominatim geocoding, `--import` into a local database); a pilot preview copy | network; writes tracked and git-ignored files; local databases |

## `tests/`

| Suite | Command | Needs | Notes |
| --- | --- | --- | --- |
| unit (46 files) | `npm test` / `npx vitest run --maxWorkers=2` | `node_modules` only | — |
| e2e (25 specs) + a11y (2) | `npm run test:e2e` | Chromium; builds with `DATA_SOURCE=seed`, `DEV_ROUTES=on`; `wrangler dev` on :3100 | reuses a running :3100 outside CI |
| admin (1 large spec) | `npm run test:admin` | full test stack, Docker | resets the test stack's users; never on the main database |
| parity | `npm run test:parity` | test stack | rolls back |
| pgTAP (19) | `npm run test:db` | test stack | guarded by `tests/disposable-db.ts` |
| pytest pipeline / pilot | `python -m pytest scripts/pipeline/tests` / `scripts/pilot/tests` | `TEST_DATABASE_URL` for the database tests | the pilot tests are **not in CI** |
| gate, device, smoke | `npm run gate`, `playwright.cdp.config.ts`, `playwright.smoke.config.ts` | Chrome and GPU; a stand-in Chrome; a site URL plus `EXPECT_DEPLOY_TARGET` | the gate config sets no `DATA_SOURCE` |

Every database-touching test refuses port 54322, a database without the `company-map-test` marker, or one that holds real
companies (`tests/disposable-db.ts`, `scripts/pipeline/tests/conftest.py`).
