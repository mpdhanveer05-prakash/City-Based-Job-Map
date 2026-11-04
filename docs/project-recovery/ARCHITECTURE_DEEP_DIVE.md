# Architecture deep dive

> **Snapshot:** 4 Nov 2026, at commit `f95e9ae`. The live state is in [../session-handoff.md](../session-handoff.md). Index:
> [PROJECT_MASTER_CONTEXT.md](PROJECT_MASTER_CONTEXT.md). Paths are relative to `code/` unless they start with `docs/` or
> `.github/`. Line numbers are as of `f95e9ae`.

The summary is [../architecture.md](../architecture.md); the map behaviour is [../map-spec.md](../map-spec.md); the filter
contract is [../filters.md](../filters.md). This file adds how the pieces connect in the code.

## 1. Layers

| Layer | Implementation | Key files |
| --- | --- | --- |
| Pages | App Router. Everything is prerendered (`output: "export"`). `/dev/*` pages are `page.dev.tsx` and exist only with `next dev` or `DEV_ROUTES=on` (`pageExtensions`) | `app/(public)/**`, `next.config.ts:15,23` |
| Explorer state | One Zod-mini URL schema with canonical serialisation. `useExplorerState` is the only reader of the URL | `lib/filters/{schema,url}.ts`, `lib/explorer/use-explorer-state.ts` |
| Filtering | `filterResult(index, filters)` is computed once per render and feeds the map, Grid/List rows, counts and facets | `lib/filters/filter.ts`, `components/explorer/explorer.tsx:89-103` |
| Map engine (no React) | `ExplorerMap` wires basemap, worker, layer, atlas, animator, hit-testing, spider, popup placement and the keyboard mirror | `map/explorer-map.ts`, `map/**` |
| Public data | At build: `city_build_snapshot` over REST (anon), a local Postgres, or the committed seed. In the browser: content-hashed JSON, plus a `current.json` poll | `scripts/build-datasets.mts`, `lib/api/*`, `lib/data/*` |
| Admin | Client-rendered pages using the anon key and the user's session. **Enforcement is entirely SQL** (RLS, RPCs, deferred triggers) | `app/admin/**`, `components/admin/*`, `lib/admin/*`, `lib/supabase/browser.ts` |
| Backend | Postgres (30 migrations), Storage (`company-logos`, `company-logos-pending`), 4 Edge Functions, pg_cron | `supabase/**` |
| Batch | Python: feed sync (Greenhouse, Lever, Ashby, Workable, JSON-LD), link check, evidence checks, monitor | `scripts/pipeline/*.py` |
| Build and deploy | `prebuild` → `next build` → `postbuild`; GitHub Actions → `wrangler deploy` | `package.json`, `scripts/*.mts`, `.github/workflows/*` |

## 2. Build pipeline and dataset versions

1. **`prebuild`** runs four steps:
   - `copy-maplibre.mts` copies MapLibre's runtime modules to `public/maplibre/<ver>/` (MapLibre is unbundled, ADR-0008).
   - `build-datasets.mts --require` picks a data source in this order (`lib/api/data-source.ts`): Supabase REST, then
     `LOCAL_DATABASE_URL`, then the seed, but only if `DATA_SOURCE=seed`; with none of these it fails. It then:
     - validates each snapshot (Zod);
     - refuses an empty city (`scripts/build-datasets.mts:128-130`), a mix of real and synthetic data, and pilot-preview
       copies;
     - under `RELEASE_BUILD=1`, refuses synthetic data or any record with incomplete evidence (`assertReleaseData`);
     - writes `public/data/<city>/<data_version>-<12 hex of SHA-256>/{companies,offices,search,details}.json`,
       `<city>/current.json` and `manifest.json`;
     - regenerates `public/_redirects` from `config/redirects.static` plus the slug redirects.
   - `check-build-config.mts` works out the target (local, staging, staging-synthetic, production), fails if a required
     feature is missing, and writes `public/build-info.json`.
   - It clears `.next/dev`.
2. **`next build`** produces the static export in `out/`.
3. **`postbuild`** runs three checks:
   - `fix-segment-files.mts` repairs the prefetch files that a Windows export nests in folders;
   - `inject-csp.mts` writes a per-page CSP meta tag with inline-script hashes (ADR-0014);
   - `check-static-limits.mts` warns above 15,000 files and fails above 18,000; it also checks 25 MiB per file, redirect
     and header counts, and runs a regex secret scan.
4. **Caching** (`public/_headers`): version folders, `/_next/static/*` and `/maplibre/*` are `immutable`;
   `/data/<city>/current.json` is `no-cache`.
5. **Open tabs:** the explorer re-reads `current.json` when the tab becomes visible (at most every 5 minutes) and on a
   bfcache restore. If the version changed, it offers a reload (`components/explorer/explorer.tsx:289-320`; ADR-0025 part 1).

**Known gap (R13):** step 1 throws if any city in `CITY_SLUGS` has no published companies. A production build with
Bengaluru live and Chennai not yet published is therefore impossible today. `city.status` is parsed but unused. See
[PENDING_WORK_AND_ROADMAP.md](PENDING_WORK_AND_ROADMAP.md), BUILD-CITY.

## 3. Map engine pipeline

```
explorer.tsx ── filterResult ──► offices[] ──► ExplorerMapView (React wrapper)
                                                  │ ExplorerMap.create (map/explorer-map.ts:156-196)
                                                  ├─ checkWebGl2 → createBasemap (loadMapLibre + themed Geoapify, or blank Milky; lockNorthUp)
                                                  ├─ buildGlyphSheet (Overpass 800) → LogoAtlas (2048² pages, LRU, budget)
                                                  ├─ CompanyLayer (CustomLayerInterface; re-added on webglcontextrestored)
                                                  └─ createClusterWorkerClient (module Worker + Comlink)
setOffices ─► packPointSet (Float64 lng/lat, Uint32 ids; transferred) ─► worker.load(generation)
moveend ─► refresh(bbox+20%, zoom) ─► worker: Supercluster(radius 60, maxZoom 17, minPoints 2)
            └─ compact arrays: keys o:<n> / c:<dataVersion>:<filterHash>:<id>, unique-company counts, lineage
client drops stale generations (map/worker/client.ts:56-69)
colocateResponse (5 m stacks) ─► MarkerController.apply ─► CompanyLayer.setTargets ─► Animator
render(): sample animator ─► FramePacker.pack (cull to view+20%, CPU float64 projection, ADR-0009)
          ─► logos requested only for drawn markers ─► one drawArraysInstanced (company-layer.ts:376)
```

| Concern | Behaviour | Where |
| --- | --- | --- |
| Animation | split 280 ms ease-out, merge 220 ms ease-in, pan 120 ms, cross-fade 200 ms (also when more than 250 markers move), reduced motion 100 ms fade; retargets from the current state | `map/animation/animator.ts:127-150`, `easing.ts` |
| Hit-testing | linear scan while animating, KDBush once settled; 44 px touch, 24 px mouse; deterministic overlap order | `map/hit-test/hit-test.ts:27,49-63,116-137`, `interactions.ts` |
| Clusters and stacks | tap a cluster: `getExpansionZoom` → `easeTo`. Tap a stack: spider (circle up to 8, spiral up to 20, list above that) with GeoJSON legs; closes on zoom, Escape or a background tap | `map/explorer-map.ts:430-445`, `map/layer/spider.ts:82-111`, `marker-controller.ts:143-168` |
| Popup | `?company=`; placed right, left, above or below, otherwise pans; bottom sheet below 640 px; "View company" is a plain link | `map/popup-placement.ts:62-80`, `components/explorer/map-popup.tsx:104-108` |
| Keyboard | mirror list of settled markers in reading order; roving tabindex with spatial arrows; Ink focus ring in the shader | `map/a11y-mirror.ts:34-41`, `components/explorer/map-a11y-list.tsx` |
| Failure modes | no WebGL2 → List view plus a notice; 3 tile errors in 10 s → banner with Try again and Show the list | `components/explorer/explorer.tsx:48-59`, `map/fallback.ts:78-126` |
| Cleanup | dispose chain: controller, interactions, worker `terminate`/`releaseProxy`, layer `onRemove`, `map.remove` | `map/explorer-map.ts:295-306` |
| Colours | every colour comes from CSS tokens via `map/theme.ts`; shader uniforms only, no literals | `map/theme.ts`, `map/layer/shaders/marker.ts` |

## 4. End-to-end flows

| # | Flow | Code path | Status |
| --- | --- | --- | --- |
| 1 | Open the site | `app/(public)/page.tsx:9` → `loadAllCities()` (`lib/data/city-data.ts:47-70`) → `CityTile` (boundary SVG; dots only for real data, `components/city/city-tile.tsx:18`) | Implemented |
| 2 | Choose a city | `[city]/page.tsx:30-57` passes the manifest paths → `explorer.tsx:63-66` `useQuery` → `fetchCityFiles` (`lib/data/browser.ts:21-27`; no Zod in the browser, only shape checks). `search.json` loads when search is first used | Implemented |
| 3 | Dataset | §2 above | Implemented; never served from a real deployment of real data |
| 4 | Markers | §3 above | Implemented |
| 5 | Zoom and clusters | §3 above | Implemented. *Reasoned, not reproduced:* "Show on map" flies to z17, where a dense tech park may still cluster, so no popup appears (`map/explorer-map.ts:77,248,409-417`) |
| 6 | Search and filters | `explorerSearchSchema` (`lib/filters/url.ts:109-139`; old `stage=public\|acquired` links move to `status`), `applyFilterChange` (`lib/filters/schema.ts:119,132-134`: stages are dropped without Startup), search debounced 200 ms (`components/explorer/explorer-toolbar.tsx:44`) | Implemented. *Possible race:* a `?company=` that matches only through job or founder text is removed before `search.json` arrives (`explorer.tsx:111-114`) |
| 7 | Map/Grid/List agree | one `filterResult` → map offices, `listRows`, counts, `companyFacets` (`explorer.tsx:89-103,224-242`); `ExplorerMap` never filters | Implemented. The company page's "Open jobs" counts active **and suspect** jobs (`app/(public)/companies/[slug]/page.tsx:113-114`); the explorer counts active only (UX-1) |
| 8 | Select a company | logo tap → `tapLogo` → `?company=` → `syncPopup` → "View company" | Implemented |
| 9 | Company and jobs pages | `buildCompanyPages` (`lib/data/company-data.ts:43-114`) with link checks that fail the build (`lib/links.ts:55,80-92`: https, no credentials or IPs, company domain or a known ATS host); jobs rows are title plus Apply (`jobs/page.tsx:72-81`); freshness from the oldest `last_ok_at` | Implemented |
| 10 | Outbound click | `OutboundLink` (`target=_blank rel="noopener noreferrer"`) → `sendClick` → `sendBeacon` text/plain to `<SUPABASE_URL>/functions/v1/click` → `record_click` (daily counter, no personal data) | Implemented; the function has never been deployed |
| 11 | Feedback | `ReportDisclosure` → `FeedbackForm` (needs the Supabase URL and the Turnstile site key) → Turnstile → `submit-feedback` → `submit_feedback` → `submission` | Implemented. A hosted function answers **503** until `FEEDBACK_SALT`, `CLIENT_IP_HEADER` and `TRUSTED_PROXY_HOPS` are set |
| 12 | Admin edit | page → RPC or table → RLS plus `is_admin` (aal2, a live session, a verified factor) plus deferred gates; audit trigger | Implemented locally |
| 13 | Validate and publish | evidence recorded (as a claim) → `review_evidence` (reviewer) → publication gate at commit → `publication_approval` row | Implemented locally; **no human review has happened yet** |
| 14 | Snapshot and refresh | Publish now → `request-rebuild` → `publish_now` (role check, 10-minute debounce, bumps `data_version`) → `repository_dispatch` (`rebuild` → staging; `refresh-production-data` → option C) | Built; never run |
| 15 | Reaches visitors | deploy workflow → `wrangler deploy` → smoke test → (production) `release/*` tag | Staging ran (the old workflow, synthetic data); production never |

## 5. Environments

| Item | Staging | Production | Production data refresh |
| --- | --- | --- | --- |
| Worker | `company-map-staging` (`--env staging`) | `company-map` (top-level in `wrangler.jsonc`, so a bare `wrangler deploy` targets it) | `company-map` |
| GitHub environment | `staging` | `production` | `production-data` |
| Data | Supabase REST, or the seed with `ALLOW_SYNTHETIC_DATA=true` and no Supabase values | REST only; `RELEASE_BUILD=1` | the same, rebuilt from the newest `release/*` tag's commit |
| Gate | `AUTOMATION_ENABLED` for scheduled and dispatched runs; reviewers; `check-deploy-env staging` | typed phrase; reviewers; `check-deploy-env production`; `audit --release`; launch gate | `PRODUCTION_REFRESH_ENABLED`; release-record check; `refresh-guard` (shrink of 20% or more, baseline) |
| Rollback | automatic, only of its own deploy | **manual** (no pre-deploy smoke, no automatic rollback: R3) | automatic, only of its own deploy |

Details: [../deploy-environments.md](../deploy-environments.md), [../decisions/0025-dataset-versions-and-rebuild-policy.md](../decisions/0025-dataset-versions-and-rebuild-policy.md).

## 6. ADRs: do they still apply, and does the code follow them?

| ADR | Decision (short) | Still applies? | Conformance and notes |
| --- | --- | --- | --- |
| [0001](../decisions/0001-stack.md) | Approved stack; no FastAPI, Redis, AWS or K8s | Yes (hosting part superseded by 0006) | Conforms |
| [0002](../decisions/0002-launch-scope-two-cities.md) | Build and test both cities | Yes (dates set by 0016) | Both are built; but see R13 against the staggered go-live |
| [0003](../decisions/0003-hosting-plan-tiers.md) | Hosting tiers measured | **Superseded** by 0006 | The measurements are kept |
| [0004](../decisions/0004-company-type-filter-model.md) | Types as tags: OR within a group, AND across; stage only with Startup | Yes | Conforms (`lib/filters/filter.ts:83-103`, `schema.ts:119`) |
| [0005](../decisions/0005-map-rendering.md) | Custom WebGL layer plus Supercluster worker | Yes, **subject to the P2-09 gate (Blocked)** | Conforms; no silent fallback to DOM markers |
| [0006](../decisions/0006-free-tier-static-hosting.md) | Static export; Supabase backend; static datasets; direct links plus a beacon | Yes (amended by 0007 and 0018) | Conforms. `app/go/` and `app/api/v1/` are empty leftovers. Its "SECURITY INVOKER only" is inaccurate (several admin functions are DEFINER) |
| [0007](../decisions/0007-workers-static-assets.md) | Workers static assets: `company-map`, `company-map-staging` | Yes | Conforms; see R2 |
| [0008](../decisions/0008-basemap.md) | Geoapify Positron, re-coloured; MapLibre unbundled | Yes; D-11 open | Conforms; the key's referrer restriction is still the owner's |
| [0009](../decisions/0009-marker-layer-projection.md) | CPU float64 projection; north-up | Implementation yes; rotation off is **Proposed** | Conforms (`lockNorthUp`) |
| [0010](../decisions/0010-build-data-source.md) | Data source order; synthetic flag; release builds refuse synthetic data | Yes | Conforms. The ADR text is stale: the production workflow exists, and `ALLOW_SYNTHETIC_DATA` replaced "drop `DATA_SOURCE=seed`" |
| [0011](../decisions/0011-click-beacon.md) | text/plain beacon; `click` function; daily counts | Yes; retention is D-07 | Conforms; no rate limit, as the ADR says |
| [0012](../decisions/0012-admin-workspace-and-publishing.md) | The UI shows, the database decides; audit log; Publish now | Yes | Conforms. The text is stale (MFA and logos have since been built) |
| [0013](../decisions/0013-pipeline-and-public-feedback.md) | Pipeline role; two strikes; SSRF-safe fetching; feedback order | Yes | Conforms; never run against a hosted project |
| [0014](../decisions/0014-content-security-policy.md) | CSP meta tag with script hashes | Yes | Conforms (`lib/csp.ts`, `scripts/inject-csp.mts`) |
| [0015](../decisions/0015-dependency-audit-gate.md) | Audit gates production dependencies only | **Not accepted**; superseded by 0019 | — |
| [0016](../decisions/0016-launch-sequence-and-data-policy.md) | Bengaluru first; evidence-based sourcing; founders with a correction route | Yes | **Partial:** R13 blocks a Bengaluru-only build; the P9-08 correction route isn't built |
| [0017](../decisions/0017-company-status-separate-from-stage.md) | `ownership_status` separate from stage | Yes | Conforms |
| [0018](../decisions/0018-spending-policy.md) | Free by default; justified spending by written proposal | Yes | No proposals made yet |
| [0019](../decisions/0019-dependency-vulnerability-exceptions.md) | Exception register (90 days at most), human approvers | Yes | Conforms; both registers are empty |
| [0020](../decisions/0020-monitoring-analytics-and-owner-choices.md) | Sentry and Cloudflare analytics; 650 KB; devices; MFA; backups; officemap.tech | Yes | **Partial:** MFA and the 566 KB explorer are done; P9-10, P9-11, P9-14 and P9-15 are not started |
| [0021](../decisions/0021-field-evidence-and-publication-gates.md) | Evidence per field; publication gates | Yes | Conforms; parts of the text are stale (PROJECT_HANDOVER §13.11) |
| [0022](../decisions/0022-evidence-for-jobs-changes-and-refresh.md) | Job evidence; reviewed changes; refresh; feed automation | Yes | Conforms. It says there is no feed admin page; there is one |
| [0023](../decisions/0023-company-classification-definitions.md) | Startup, MNC, Product definitions | Yes | A curator's judgement; the database records evidence only |
| [0024](../decisions/0024-logo-storage-and-provenance.md) | Logo storage and provenance | **Proposed**; built locally | The categories need the owner; see R14 |
| [0025](../decisions/0025-dataset-versions-and-rebuild-policy.md) | Content-hashed datasets; option C refresh | Yes | Part 1 is built. Option C is built but **never run**; seven hosted checks are outstanding |
| [0026](../decisions/0026-two-laptop-workflow.md) | Two laptops; GitHub as the project memory | The GitHub practices yes; the two-laptop premise is replaced | Amended by [0027](../decisions/0027-one-development-laptop.md) |
