# Progress

Update this after every task: what changed, how it was verified (the commands actually run and their results), what's unverified, blockers, and the next action.

## Current state
- **Current task:** none in progress. Phase 1 is complete (P1-01 to P1-06), and P2-01 to P2-03 are done. P2-04 (logo atlas manager) and P2-05 (animation engine) are next; both depend on P2-03.
- **Next action:** start P2-04. **Owner actions open:** (D-11) restrict the Geoapify key by referrer and decide the basemap capacity path before launch; (ADR-0009) confirm that rotation and tilt are off in the explorer.
- **Blockers:** none for code work. For product decisions, see the decision register (D-01…D-11).

## Log

### 2026-10-01: P2-03 Custom WebGL layer, static rendering (Completed, except the reference-desktop check)
- **Added in `code/map/`:** `layer/company-layer.ts` (the MapLibre custom layer, `attachCompanyLayer`), `layer/geometry.ts` (Mercator, screen projection, culling, sizes, labels), `layer/instances.ts` (scene preparation and per-frame packing), `layer/shaders/marker.ts` (GLSL ES 3.00), `atlas/glyphs.ts`, `atlas/glyph-sheet.ts` (Overpass 800 digits, `k . +`, A–Z), `atlas/fallback.ts` (initial and swatch from a name hash), `fixtures/static-scene.ts`, and marker colours in `theme.ts` (`MarkerTheme`, `parseCssColor`). `createBasemap` gained `lockNorthUp` and a blank-style mode (empty key). New dev page `/dev/map-layer` (static scene, or live clusters through the P2-02 worker). Design and decision: [ADR-0009](decisions/0009-marker-layer-projection.md).
- **What it draws:** clusters (Mantis disc, 2 px Milky halo, Ink count, 36–64 px by log(count)), logos (40 px disc on a swatch or Milky, 2 px Moss ring, Ink initial), and stacks (logo plus Ink badge with Milky numerals). Selection is a 3 px Mantis Deep ring at 1.25×; keyboard focus is a 2 px Ink ring offset 3 px. All of it is one instanced draw call per frame, with positions projected in float64 on the CPU and culled to the viewport plus 20%. No colour is in the code: everything comes from the tokens.
- **Decision needing the owner (ADR-0009):** the layer assumes a north-up, top-down camera, so the explorer turns map rotation and tilt off. A rotated map draws nothing and sets `stats.unsupportedCamera` instead of drawing in the wrong place.
- **Bugs found and fixed on the way:**
  - `formatCount(1950)` gave `1.9k` (binary rounding of 1.95) and `9999` would have given `10.0k`. Found by the unit tests; now computed in integer tenths.
  - MapLibre **removes custom layers on WebGL context loss and does not restore them** (it logs "cannot be restored… re-add it manually"). My first handler was removed along with the layer. `attachCompanyLayer` now re-adds the layer on `webglcontextrestored`.
  - The first e2e run of the context-loss test ran against a **stale server**: an earlier `wrangler dev` kept port 3100, so Playwright reused it and served an old `out/`. If a new test passes or fails oddly, check that no `wrangler`/`workerd` process is left over from a previous run.
- **Verified in this session (from `code/`):**
  - `npm run lint`, `npm run typecheck`: pass. `npm test`: **163 passed** (7 files; 38 new in `tests/unit/marker-layer.test.ts`: Mercator round-trip and zoom-17 precision, the 20% culling boundaries, cluster sizes, count labels, glyph layout, fallback hashing, theme parsing, instance packing and draw order, the frame packer, the static scene, and a scan that finds no hex colour in `map/layer` or `map/atlas`).
  - `npm run build`: pass, 36 files (the dev page is not in production output). `npm audit --audit-level=high`: 0 vulnerabilities.
  - `npm run test:e2e`: **51 passed, 1 skipped** with the Geoapify key (it was 35 + 1), and **41 passed, 11 skipped** with `NEXT_PUBLIC_GEOAPIFY_KEY=` empty, as CI will run it. The 16 new runs (8 tests × desktop and Pixel 7) check: 60 clusters, 400 logos, and 3 stacks drawn in 1 draw call with the 200 far items culled; screen positions within 0.02 px of `map.project()` at zoom 12, 13.37, and 15.8; the cluster disc is Mantis, its halo Milky, logo fills are the sand and lilac swatches or Milky, the ring is Moss, the focus ring Ink, and the selection ring Mantis Deep (all read from the WebGL canvas and compared with the CSS tokens); the count and the initial are drawn in Ink; panning culls and restores items; a rotated map draws nothing; the live worker scenario draws clusters; and the layer recovers from a lost and restored WebGL context.
  - Screenshots reviewed at 1280 × 800 and Pixel 7 (412 × 915 @2.6×), and the live scenario at zoom 12.
- **Test-suite change:** `playwright.config.ts` now uses 3 workers locally (2 in CI) and a 60 s test timeout. With six workers the suite had become load-sensitive: each map page runs WebGL in software, and unrelated specs (home-page axe, basemap) timed out. Three full runs after the change were stable (51 passed ×2 with the key, 41 passed with none).
- **Not verified:** the manual check on the reference desktop (D-06 hasn't named the devices); frame rate or frame time (nothing measured yet; that is the P2-09 gate); Firefox and Safari; GitHub CI (SwiftShader WebGL2 on the runner is assumed, not seen); real logo images (P2-04; initials stand in); the "WebGL unavailable" notice and List fallback (explorer shell); keyboard and screen-reader access to markers (P2-06 and the explorer).
- **Open for the designer:** the stack badge (a 20 px disc at 40 px logos) is small, and 3-glyph labels such as `99+` are tight; on a phone-width screen 463 markers cannot fit without overlap, which is expected and is what clustering is for. The cluster size curve (`36 + 28 × min(1, ln(count) / ln(1000))`) is a proposal.
- **Next action:** P2-04 (logo atlas manager: pages, LRU, memory budget, real logos over the letter fallback) and P2-05 (animation). Not pushed: local commits are ahead of `origin/main` (P1-05, P2-02, and this task).

### 2026-10-01: P2-02 Clustering worker (Completed)
- **Added in `code/map/worker/`:** `cluster-engine.ts` (the pure engine; Vitest runs it without a Worker), `lineage.ts` (keys, formation level, parent/child lineage), `protocol.ts` (types, `packPointSet`, transfer lists), `worker-api.ts` (the Comlink-exposed object), `cluster.worker.ts` (3 lines), `client.ts` (generation counter, stale-drop, `dispose()`). New dependencies, both approved-stack: `supercluster` 9.1.0 and `comlink` 4.4.2. Supercluster 9 ships its own types, so `@types/supercluster` (installed first) was removed.
- **Protocol (map-spec §2–3):** `load(points, generation)` takes typed arrays (`lngLat`, `officeIds`, `companyIds`) plus `dataVersion` and `filterHash`; `getClusters(bbox, zoom, generation)` returns parallel arrays: keys (`o:<id>` or `c:<dataVersion>:<filterHash>:<id>`), kinds, positions, office counts, **unique-company counts**, company IDs, parent keys, and flattened child keys. Both directions transfer the buffers instead of copying. Settings: radius 60, maxZoom 17, minPoints 2.
- **Deviation from the plan's wording, recorded in map-spec §2:** an item that survives to the next level reports **its own key** as its parent and only child, not null. The animator reads "same key" as no transition. The formation level is read from Supercluster's cluster-ID arithmetic (an internal detail), so a brute-force test guards it.
- **Client rules:** the generation bumps on every `load` and on every change of integer zoom; panning inside one zoom keeps it. `getClusters` resolves to `null` when a newer generation was issued while it was in flight. The client never filters or reads the URL.
- **Verified in this session (from `code/`):**
  - `npm run lint`: pass. `npm run typecheck`: pass. `npm test`: **125 passed** (6 files; 23 new in `tests/unit/cluster-worker.test.ts`).
  - The new tests: children of X at level + 1 report X as parent (all 19 levels); every item's parent lists it as a child; children partition the parent's offices (checked against an independent Supercluster index with `getLeaves`); partial viewports agree with the whole-city answer; unique-company counts equal a brute-force `Set`, and some clusters have fewer companies than offices; key namespace and determinism; the 20-office identical-coordinate group; empty and single-office sets; stale responses in both resolution orders, on `load`, and after `dispose`; and a real Comlink round trip over a `MessageChannel` (arrays are detached after transfer).
  - **Mutation checks** (changed and restored): dropping the `- 1` in the formation level fails 3 lineage tests; disabling the stale check fails 2 client tests; zero viewport padding fails the partial-viewport test.
  - `npm run build`: pass, 36 files (unchanged; the dev page is not in production output). `npm audit --audit-level=high`: 0 vulnerabilities.
  - `npm run test:e2e`: **35 passed, 1 skipped** (it was 29 + 1). The new `/dev/cluster-worker` page starts the real Web Worker from the static export served by `wrangler dev` (Playwright sees the `worker` event with a `/_next/static/` URL), loads Bengaluru S (1,500 offices), and checks: 1,500 offices at levels 0, 9, 12, 15, 18; one city-wide cluster at level 0; 1,500 separate items at level 18; one stale response dropped and the newer one kept; no serious or critical axe violations.
  - **Timings** (Node, Windows laptop, whole-city bbox, not the gate devices): load 6 ms (S), 8 ms (M), 23 ms (L, 15,000 offices). Worst cold `getClusters` on L is 14 ms (with unique-company counting); warm calls are 0–9 ms. These are not gate measurements; they say only that the worker is not the likely bottleneck.
- **Not verified:** the worker on a mid-range phone or in Firefox/Safari (Chromium only); worker start-up cost in the browser; behaviour above the L dataset (15,000 offices); the cost of a 20-company stack through the spider rules (P2-06 owns that).
- **Notes:** the dev page generates its 1,500-office dataset in the browser, so the fixture generator ships in the `/dev` bundle only. Unique-company counts use `getLeaves` per cluster and are cached for one load; if the gate shows this is slow on a phone, a per-cluster set built at load time is the fallback.
- **Next action:** P2-03 (custom WebGL layer, static rendering). Not pushed; local commits are ahead of `origin/main` (P1-05 and this task).

### 2026-10-01: P1-05 Basemap feasibility (Completed)
- **Added in `code/`:** `map/theme.ts` (reads the basemap colours from the CSS tokens), `map/basemap.ts` (loads Geoapify `positron`, re-colours it with `applyBasemapTheme`, adds attribution, counts requests; `loadMapLibre()`), `scripts/copy-maplibre.mts`, the dev page `/dev/basemap`, `tests/unit/basemap.test.ts` (11 tests), and `tests/e2e/basemap.spec.ts` (5 tests × 2 projects). `maplibre-gl` 6.11.2 is a new dependency (an approved-stack library; 0 audit findings at install). Full write-up and sources: [ADR-0008](decisions/0008-basemap.md).
- **Bug found and fixed: MapLibre's worker.** Bundled through Turbopack, MapLibre 6 stopped with "Worker failed to load": it finds `maplibre-gl-worker.mjs` by name, and the worker imports `./maplibre-gl-shared.mjs`, but Turbopack renames both with hashes. The three runtime files are now copied unhashed to `public/maplibre/<version>/` before `dev` and `build`, and loaded at run time.
- **Bug found and fixed: a collapsed map.** MapLibre's unlayered CSS sets `position: relative` on its container, which beat Tailwind's `absolute inset-0`: the container was 0 px high and the canvas 1280 × 300. My first e2e checks passed on that sliver. A wrapper now owns the sizing, and a new test asserts that the canvas fills the viewport.
- **Measured** (cold cache, headless Chromium, one scripted session): 25 tile responses on a Pixel 7 viewport, 48 on 1280 × 800, 75 on 1920 × 1080 (MapLibre counts 31, 60, 87 requests). At 0.25 credits a tile and 3,000 credits a day, that's roughly 240 sessions a day (160 to 480); about 140 a day if style, sprite, and glyph requests are billed at a credit each, which Geoapify's pages don't settle.
- **Findings for the owner (D-11):** (1) **The key is not restricted**: HTTP 200 with a foreign `Referer` and with none. (2) The Free allowance is probably below launch traffic; the choices are in ADR-0008. (3) Geoapify's terms don't mention style changes; its API docs permit them.
- **Verified in this session (from `code/`):**
  - `npm run lint`: pass, no output. `npm run typecheck`: pass. `npm test`: **102 passed** (5 files; 11 new).
  - `npm run build` (production): pass. 36 files, largest `maplibre-gl.mjs` 576 KiB, 3 header rules, no `/dev` output.
  - `npm run test:e2e` (builds with `DEV_ROUTES=on`, serves through `wrangler dev`): **29 passed, 1 skipped** (it was 19 + 1). Basemap checks: attribution links visible, canvas fills the viewport, the most common pixel is exactly Milky and no pixel is green, every layer colour equals a token, and a Bengaluru ↔ Chennai switch has no HTTP error.
  - With `NEXT_PUBLIC_GEOAPIFY_KEY=` empty, the basemap spec skips all 10 cases, as CI will (CI has no key).
  - Screenshots at zoom 13 and 15 reviewed: Milky land, stone parks, blue water, no green, attribution and zoom controls visible.
- **Not verified:** the new CI jobs on GitHub (not pushed); the live staging site (it doesn't have the key yet: the Deploy staging workflow would need a `NEXT_PUBLIC_GEOAPIFY_KEY` secret and env line); billing of non-tile requests; browser-cache savings on repeat visits; Firefox and Safari; Geoapify's referrer setting (needs the owner's login); a screen-reader pass on the attribution.
- **Open for the designer:** labels are Metropolis/Noto Sans, not Overpass; Milky Shade buildings look busy from zoom 13.
- **Next action:** P2-02.

### 2026-10-01: P2-01 Synthetic dataset generator (Completed)
- **Added in `code/`:** `map/fixtures/generate.ts` (a pure, seeded generator; mulberry32), `map/fixtures/hotspots.ts` (density shape per city), `map/fixtures/cli.mts` (`npm run fixtures`, with `-- --manifest` to refresh the hashes), `map/fixtures/manifest.json`, and `tests/unit/synthetic-points.test.ts` (46 tests). `map/fixtures/out/` is git-ignored.
- **What a dataset holds:** `companies` (name, overlapping `types`, `stage` only for startups), `offices` (`id`, `companyId`, `lng`, `lat`), and `groups` (the deliberate co-location cases). Every record has `synthetic: true`. Office keys are `o:<id>` (map-spec §2).
- **Gate datasets** (seed `20260930`): Bengaluru S 1,500, M 5,000, L 15,000 offices, plus Chennai S. Each has 9 Bengaluru (7 Chennai) density hotspots with a 15% uniform background, **50 identical-coordinate groups** (sizes include 2, 8, 9, 20, and 21, so every spider rule in map-spec §7 is hit at its boundary), **a 30-company building** at one point, and 10 near-coincident groups within 5 m. About 15% of offices belong to a company that has more than one office, so counts differ between companies and offices.
- **Hashes** (SHA-256, in `manifest.json`): Bengaluru S `b8d7add3…94cf`, M `7e99db57…e88b`, L `d62f85e9…3775`; Chennai S `26e4897c…ad38`. Sizes: 247 KB, 814 KB, 2.45 MB, 248 KB of JSON.
- **Bug found by the tests and fixed:** near groups placed each office within 3 m of a base point, so two offices could be up to 6 m apart and break the 5 m co-location rule. The radius is now 2.3 m. The manifest was regenerated after the fix.
- **Verified in this session (from `code/`):** `npx vitest run`: **91 passed** (4 files; 46 new). `npm run lint`, `npm run typecheck`, and `npm run build` pass; the build is still 33 files, so nothing from `map/fixtures/` reaches `out/`. `npm run fixtures -- --manifest` generates all four datasets in about 5 s.
- **CI:** [run 36817022946](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/36817022946) on `main` (commit `a359927`) passed all four jobs. Its unit-test step runs the manifest test on Ubuntu, so the four dataset hashes are identical on Linux (Node, V8) and on this Windows machine. The generator uses `Math.log`, `Math.cos`, and `Math.sqrt`, which the JS spec doesn't require to be bit-identical across engines; the 6-decimal rounding covers that, and this run is the evidence.
- **Not verified:** the hashes in other engines (Firefox, Safari). The gate runs in Chrome, so this doesn't block it. The hotspot centres are approximate, for density shaping only; they are not curated locations.
- **Notes:** `npm run fixtures` prints a Node warning that it reparses `generate.ts` as an ES module. It's harmless; adding `"type": "module"` would remove it but changes how every other `.js` file is treated, so it was left alone.

### 2026-10-01: P1-03 Supabase local setup (Completed)
- **Added in `code/`:** the `supabase` CLI 2.118.0 as a dev dependency; `supabase/config.toml`; migration `20260930181053_extensions.sql` (PostGIS and `pg_trgm`, in the `extensions` schema); pgTAP test `supabase/tests/database/00_extensions.test.sql` (4 assertions). `.github/workflows/ci.yml` has a new `database` job (`supabase db start`, then `supabase test db`, with Postgres only, no API, Auth, or Studio).
- **Verified in this session (from `code/`, Docker server 29.4.0):**
  - `npx supabase db start`: started, and applied `20260930181053_extensions.sql`.
  - `npx supabase test db`: `00_extensions.test.sql .. ok`, 4 tests, **Result: PASS**.
  - `select extensions.postgis_version()` in the local database: `3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1`.
  - `npx supabase db reset`: applied cleanly. `supabase test db` passed again after the reset.
  - `npm run lint`: pass. `npm run typecheck`: pass. `npm test`: **45 passed** (3 files).
- **CI:** [run 36816094399](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/36816094399) on `main` (commit `4a7f7f4`) passed all four jobs: lint/types/unit/build/audit, Playwright e2e + axe, **Database migrations + pgTAP**, and the gitleaks secret scan. `npm run build` (33 files), `npm audit` (0 vulnerabilities), and `npm run test:e2e` (19 passed, 1 skipped) also passed locally before the push.
- **Not verified:** `supabase start` (the full stack with API, Auth, and Studio) was not run: only the database is needed until P3, and CI uses `db start` too. `.env.example` already documents the Supabase variables, and I haven't tested them against the full stack.
- **Notes:** `supabase db reset` warns that `supabase/seed.sql` is missing. That is expected until P3-04. The CLI reports v2.119.0 is available; the pin stays at 2.118.0 and Dependabot will propose the bump.

### 2026-09-30: D-10 decided (Option A, with Option B on standby)
- **Decision (owner):** separate `/companies/{slug}/jobs` pages now (about 10 files per company). Option B (jobs as a `#jobs` section of the company page, about 5 files per company) is kept ready as plan task **P6-04**, used only when triggered.
- **Early warning:** `scripts/check-static-limits.mts` now warns (without failing) above **15,000** files, pointing to P6-04. It still fails above 18,000. `checkOutput` accepts custom limits for testing.
- **Verified:** `npm test`: **45 passed** (a new warn-vs-fail test). Lint and `tsc --noEmit` clean.
- **Deploy staging workflow verified (run by the owner, 2026-09-30 18:04 UTC, commit `687cd3e`):** with the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID` added, the workflow ran `npm ci` (0 vulnerabilities), built (39 files), deployed `company-map-staging` version `ebbd8ae8-3e28-4cdc-9dee-4cccaf88fb8d`, and the post-deploy smoke test passed **10/10** (desktop project) against the live URL. The owner also supplied a Geoapify key (stored only in the git-ignored `code/.env.local`; a style request returned HTTP 200) and started Docker Desktop (server 29.4.0).

### 2026-09-30: P1-06 completed on Workers static assets (ADR-0007)
- **Platform change found:** `wrangler pages project create` answered "Delegating to the latest version of Cloudflare Pages, now part of Cloudflare Workers" and failed, with nothing created. Legacy Pages needs `--force`. Cloudflare's Pages docs say "Start new projects with Workers". The owner chose **Workers static assets** (an assets-only Worker), recorded in [ADR-0007](decisions/0007-workers-static-assets.md).
- **Changed:** `wrangler.jsonc` is now an assets-only Worker (`./out`, `404-page`, `env.staging` → `company-map-staging`). The scripts are `preview` = `wrangler dev`, `deploy:staging` = `wrangler deploy --env staging`. Playwright serves through `wrangler dev`. The deploy workflow uses `wrangler deploy --env staging`, and its token needs Workers Scripts: Edit. The basemap ADR is renumbered to 0008. A new decision **D-10** is in the register.
- **Measured (probe build, removed afterwards):** a prerendered page is **5 files** plus 3–4 directories, so a company with separate company and jobs pages is 10 files. The corrected 2-city estimate is about 17,650 files with separate jobs pages, or about 9,650 with jobs on the company page. ADR-0006's "~8,200" is corrected in ADR-0007. Wrangler's "Read N files" includes directories; the upload counts files only.
- **Staging deploy (owner approved):** https://company-map-staging.company-map.workers.dev, version `408ad6a9-a8d2-486a-acf9-58f2620796b2`. 39 files; Worker upload 0.31 KiB (no script).
- **Verified in this session:**
  - Live staging: `/` 200, `/dev/tokens` 200, `/robots.txt` = `Disallow: /`, `/sitemap.xml` 200, unknown path **404**, and `nosniff`, `DENY`, and referrer-policy headers present.
  - `PLAYWRIGHT_BASE_URL=<staging> npx playwright test`: **19 passed, 1 skipped**. `npm run test:e2e` against local `wrangler dev`: 19 passed, 1 skipped.
  - Lint, typecheck, and 44 unit tests pass. The production build is 33 files with no `/dev` output. All three workflow files parse.
- **Not verified:** the Deploy staging workflow on GitHub (it needs the `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets). Production isn't deployed (it needs explicit authorization later).

### 2026-09-30: D-09 resolved (ADR-0006) and P1-06 started
- **Decision:** the owner rejected paid plans and proposed Cloudflare Pages + Next.js static export for staging and production, with the backend moved to Supabase functions. They also chose **static per-city datasets** for the explorer and **direct Apply links + a click beacon**. Recorded in [ADR-0006](decisions/0006-free-tier-static-hosting.md), which supersedes the ADR-0003 recommendation and ADR-0001's hosting/Route Handler items. Free-tier limits were re-checked on the providers' pages today (the table is in ADR-0006).
- **Docs revised:** CLAUDE.md (a new "Free tiers only" section, the filter convention, security, commands), plan.md (Phase 1 gate; P1-03 local-only Supabase; new P1-06; P4-01, P5-01, P5-04, P6-01…03, P7-01/02, P8-04; new P8-05; D-09 resolved; the basemap ADR renumbered to 0007), architecture.md (rewritten), security.md, data-model.md (`city_build_snapshot`, `link_click_daily`), data-pipeline.md, testing.md, map-spec.md §3, and the ADR index. The map specification is otherwise unchanged.
- **P1-06 code (in `code/`):**
  - `output: "export"`. Removed `@opennextjs/cloudflare`, the `esbuild` pin, `open-next.config.ts`, and the Worker config. `wrangler.jsonc` is now a Pages config (`pages_build_output_dir: ./out`).
  - `/dev` pages use the `.dev.tsx` extension, registered only under `next dev` or `DEV_ROUTES=on`, so production output contains no `/dev` files at all. (A `notFound()` gate would have produced a 200 "soft 404" file mentioning "Design tokens".)
  - `app/robots.ts` and `app/sitemap.ts`; `SITE_ENV=staging` gives `Disallow: /` and `noindex, nofollow`. `public/_headers` adds security headers.
  - `scripts/check-static-limits.mts` runs as `postbuild`: file guard 18,000 of 20,000, 25 MiB per file, redirects 2,000 + 100, 100 header rules, and a secret-pattern scan of `out/`.
  - Playwright serves `out/` with `wrangler pages dev`. A new `tests/e2e/static-hosting.spec.ts` covers the real 404 status, headers, immutable assets, and robots/sitemap.
  - `.github/workflows/deploy-staging.yml` (manual + `repository_dispatch: rebuild`) builds for staging, deploys `--branch staging`, and smoke-tests if `STAGING_URL` is set.
  - `prebuild`/`pretypecheck` clear `.next/dev`: stale dev-server route types would otherwise break the production type check, because dev and production have different route sets.
- **Verified in this session (from `code/`):**
  - Lint: pass. Typecheck: pass. `npm test`: **44 passed** (3 files).
  - `npm run build` (production): pass. 33 files; largest 223.8 KiB; 0 redirects; 2 header rules; no `/dev` output; the text "Design tokens" is absent from `out/`.
  - Staging build (`SITE_ENV=staging DEV_ROUTES=on`): 39 files. `/dev/tokens` is present, `robots.txt` is `Disallow: /`, and pages carry `<meta name="robots" content="noindex, nofollow">`.
  - Build time: about 47 s on this laptop, skeleton only.
  - `npm run test:e2e` against `wrangler pages dev out`: **19 passed, 1 skipped** (keyboard focus runs on desktop only).
  - Both workflow YAML files parse.
- **Not done yet (at the time of this entry):** the staging deploy and the workflow secrets. See the P1-06 completion entry above; Pages was replaced by Workers static assets (ADR-0007).

### 2026-09-30: P1-02 Workers deployment feasibility (Completed)
- **Added in `code/`:** `@opennextjs/cloudflare` 1.20.7, `wrangler` 4.144.0 (dev), `wrangler.jsonc` (Worker `company-map-preview`, compat date 2026-09-26, `nodejs_compat`, Workers Logs on, `DEV_ROUTES=on` as a var on this Worker only), `open-next.config.ts` (`staticAssetsIncrementalCache`, no R2), `public/_headers` (immutable `/_next/static`), and the scripts `preview`, `deploy:preview`, and `cf-typegen`. `next.config.ts` calls `initOpenNextCloudflareForDev()`. `.open-next/` and `.wrangler/` are ignored by git, ESLint, and tsc. `playwright.config.ts` accepts `PLAYWRIGHT_BASE_URL`.
- **`/dev/*` now renders per request** (`await connection()` in the layout), so `DEV_ROUTES` is read at runtime. `/dev/tokens` serves as the server-rendering CPU probe.
- **Dependency fix:** `@opennextjs/cloudflare` imports `esbuild` without declaring it. It relies on hoisting, which failed because wrangler and `@opennextjs/aws` use different versions. `esbuild@0.28.1` was added as a dev dependency: it's the version wrangler uses, and it satisfies Vite 8's peer range (0.25.4 conflicted with Vite). `@opennextjs/aws` keeps its own nested 0.25.4.
- **Deploy (approved by the owner in this session):** https://company-map-preview.company-map.workers.dev, version `10af08d4-e2b0-44f6-a2a4-5b1650783ca2`. Wrangler also **registered the account's workers.dev subdomain `company-map`** during the first deploy; it can be changed in the Cloudflare dashboard. The TLS certificate for the new subdomain became valid about 90 s after the deploy.
- **Measured (full table in [ADR-0003](decisions/0003-hosting-plan-tiers.md#measurements-p1-02-30-sep-2026)):** bundle 4,945.58 KiB / 1,036.29 KiB gzip; startup 22 ms. CPU p50: `/` 5 ms, `/dev/tokens` 38 ms (p95 259 ms), 404 11 ms. 63 requests, all `ok`.
- **Verified in this session:**
  - Lint, typecheck, 39 unit tests, and `next build`: pass.
  - `npm run test:e2e` (next start): 11 passed, 1 skipped.
  - The same suite against `wrangler dev` (workerd): 11 passed, 1 skipped.
  - A production `next start` without `DEV_ROUTES`: `/dev/tokens` returns 404.
  - Deployed URLs: `/` 200, `/dev/tokens` 200, 404 for unknown paths.
  - No `middleware`/`proxy` file, no ISR, and no edge runtime in the code.
- **Notes:** OpenNext warns it is "not fully compatible with Windows" and recommends WSL. The Windows build worked, but ADR-0003 recommends building staging and production from Linux CI. This machine's DNS resolves the new hostname through the office domain, so it was tested with `curl --resolve` against Cloudflare's IP.
- **Decision for the owner (D-09):** Workers Paid for staging and production (because of CPU time, not script size); the preview stays on Free.

### 2026-09-30: P1-04 completed
- **CI run:** [36716151218](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/36716151218) on `main`, commit `bf62bdd`, **success**. The jobs `checks` (0.6 min), `e2e` (1.0 min), and `secret-scan` (0.1 min) all passed. The report upload was skipped, as expected (it runs only on failure).
- **Deviation:** acceptance asked for a test PR. The owner made the repository public and asked for a direct merge, so the push-to-`main` run served as the check; it runs the same jobs. The `pull_request` trigger runs for real on the next PR.
- **Repository now public:** the full history was checked. It holds only the planning docs and code, gitleaks reports no leaks, and no BRD file has ever been committed.

### 2026-09-30: P1-04 CI skeleton (work log)
- **Created:** `.github/workflows/ci.yml` (jobs `checks`, `e2e`, `secret-scan`; see [testing.md](testing.md#ci-on-pull-requests)) and `.github/dependabot.yml` (npm in `code/`, plus GitHub Actions, weekly on Mondays IST). Playwright now also writes an HTML report in CI, which is uploaded when a test fails.
- **Pinned versions (resolved 30 Sep 2026 with `git ls-remote`):** actions/checkout v7.0.1 `3d3c42e`, actions/setup-node v7.0.0 `8207627`, actions/upload-artifact v7.0.1 `043fb46`. gitleaks 8.30.1, with the linux_x64 SHA-256 taken from the release checksums file.
- **Verified locally:** both YAML files parse (Python `yaml.safe_load`). `npm audit --audit-level=high`: 0 vulnerabilities. Lint and typecheck: pass. gitleaks 8.30.1 (the Windows build, checksum verified) over the full history: 4 commits, **no leaks found**.
- **Not verified:** the workflow has not run on GitHub yet. Acceptance needs a passing run on a test PR.
- **Decided:** the repository is private (the unauthenticated API returns 404), so GitHub's dependency-review action isn't used (it needs Advanced Security) and `npm audit` covers dependencies. pgTAP joins CI with P1-03.
- **Next action:** push the `p1-04-ci` branch, open a PR to `main`, and record the run link here.

### 2026-09-30: P1-01 Scaffold the repository (Completed)
- **Where:** all application code is in `code/`, as the owner asked. Docs stay at the root. `.env.example` moved to `code/.env.example`.
- **Created:** Next.js **16.3.7** (App Router, TypeScript strict, Turbopack), React 19.2.8, Tailwind v4, and shadcn/ui (radix base, nova preset). Also Vitest 5.0.2, Playwright 1.63.0 (Chromium), and @axe-core/playwright 4.13.0. `@types/node` was bumped to ^24 (Vitest 5 needs 22+; the local runtime is Node 24.14.1) with `engines.node >=24`. The directory layout from CLAUDE.md is in place (`.gitkeep` in empty folders).
- **Version check:** `@opennextjs/cloudflare@1.20.7` has the peer dependency `next >=15.5.26 <16 || >=16.3.6`. Its docs (opennext.js.org/cloudflare, checked 30 Sep 2026) say: "All minor and patch versions of Next.js 16… are supported", and Node Middleware is still unsupported.
- **Design system applied:**
  - `app/globals.css` holds the Milky/Mantis tokens mapped onto the shadcn roles. The Tailwind default colours and type scale are reset, radius is 4 px everywhere, and focus is a 2 px Ink outline.
  - There is no dark mode: `dark:` is bound to a `.dark` class that nothing sets.
  - Overpass is loaded through `next/font`. fontTools confirmed it has a `tnum` feature with proportional default digits, so counts use `tabular-nums`.
  - The button was adapted: 44 px default, Ink on Mantis, underlined Mantis Deep links, white on Danger.
  - There's an on-brand `not-found.tsx` (Next's default 404 follows the OS dark mode) and a Mantis-disc `app/icon.svg`.
- **Review page:** `/dev/tokens` shows the palette, actions, chips, marker previews, type, and a live contrast table. `/dev/*` is served under `next dev`, and in production builds only with `DEV_ROUTES=on`.
- **Dependency checked:** shadcn's init added the npm package `cn@0.4.0`, which replaces `clsx` + `tailwind-merge`. It is published by shadcn (repo shadcn-ui/cn), has no install scripts and no dependencies, and `shadcn` itself depends on it. It was kept. A unit test covers its merge behaviour with our custom colour names.
- **Verified (run in this session, from `code/`):**
  - `npm ci`: pass, 0 vulnerabilities.
  - `npm run lint`: pass, no output.
  - `npm run typecheck` (`next typegen && tsc --noEmit`): pass.
  - `npm test`: 2 files, **39 passed**.
  - `npm run build`: pass. Routes `/`, `/_not-found`, `/dev/tokens`, `/icon.svg`, all static.
  - `npm run test:e2e`: **11 passed, 1 skipped** (keyboard focus runs on desktop only), in the desktop and Pixel 7 projects. It covers Milky/Ink/Overpass on `/`, the Mantis button with Ink text at ≥44 px, the 2 px Ink focus outline, the live contrast table, and zero serious or critical axe violations on `/` and `/dev/tokens`.
  - `npm run dev`: `/` 200, `/dev/tokens` 200, unknown path 404.
  - A production build without `DEV_ROUTES`: `/` 200, `/dev/tokens` **404**.
  - Screenshots at desktop 1280 px and Pixel 7 reviewed: no horizontal scroll, and the tokens render as specified.
- **Fixed during the run:** the first axe pass flagged 2 contrast failures on `/dev/tokens`. Both were bugs in the review page, not in the tokens: a missing `--white` variable, and a 3:1 border pair shown as text. Both are fixed.
- **Not done / deferred:** the `preview` script moves to P1-02 (it needs OpenNext + wrangler). No CI yet (P1-04). No Supabase (P1-03).
- **Unverified:** Geoapify terms for overriding style paint (P1-05). Designer sign-off on the derived tokens and font.
- **Owner inputs needed next:** a Cloudflare account and approval for a preview deploy (P1-02); a Supabase `dev` project with the Supabase CLI and Docker Desktop installed locally (P1-03); a referrer-restricted Geoapify API key (P1-05).

### 2026-09-30: Brand colours and design system documented
- **Changed:** added [design-system.md](design-system.md), with the Milky + Mantis `#59C749` palette, derived tokens, map colours, type (Overpass), layout wireframes, motion, copy, and the shadcn token block. Linked it from CLAUDE.md (new Design section), plan.md (P1-01, P1-05, P2-03, P2-04, P4-02, D-08), map-spec.md (§2, §5, §8), and testing.md.
- **Verified:** WCAG contrast ratios, computed with a Node script this session (for example, Mantis on Milky is 2.12:1, which fails; Ink on Mantis is 5.77:1, which passes). Documentation only: no code, no tests.
- **Confirmed:** Milky is `#FFFDF1` (the brief's `#FFDF1` was a typo). The owner may change the combination after seeing it in the UI.
- **Unverified / open:** designer sign-off on the derived tokens and font, and Geoapify terms for overriding style paint. (Overpass `tnum` was resolved in P1-01.)
- **Next action:** unchanged, P1-01.

### 2026-09-30: Repository instructions and plan prepared
- **Created:** CLAUDE.md, plan.md, README.md, .env.example, .gitignore, and docs/ (architecture, map-spec, data-model, testing, security, data-pipeline, progress, decisions/0001–0005).
- **Sources read:** `Company Map — Architecture & Implementation Plan.md` (the only file in the repo).
- **Missing inputs:** the **BRD isn't in the repository**, so its requirement IDs are cited only through the plan. The plan's embedded diagrams (architecture, map states, delivery timeline) weren't exported and are unavailable.
- **Web checks (2026-09-30):** Cloudflare Workers limits, OpenNext Cloudflare overview and caching, and Supabase billing. See ADR-0003.
- **Verification:** documentation only. No code, no tests run, nothing deployed.
- **Unverified:** every command in CLAUDE.md (there's no package.json yet); Geoapify free allowance; Turnstile and Supabase Cron limits.
