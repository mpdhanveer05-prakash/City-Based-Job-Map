# Implementation Plan — Company Map

The implementation sequence is map-first. Each task is small and can be verified on its own. Status values: **Not started · In progress · Blocked · Completed**. Update the status here and log progress in [docs/progress.md](docs/progress.md).

## Dates and assumptions

The architecture plan supplies these **target** dates. They are proposals, not commitments:

| Milestone | Target | Assumptions stated or implied by the source |
| --- | --- | --- |
| Sprint 0 start | 5 Oct 2026 | The team of about 5.5 FTE (product owner 0.5, 2 FE, 1 full-stack, 1 DevOps/data, curator from Sprint 1, designer 0.5) is in place |
| Map validation gate | 6 Nov 2026 | Reference devices agreed in Sprint 0; about 1,500 Bengaluru prototype offices |
| Public launch | 18 Jan 2027 | **Bengaluru only.** Reduced velocity in the Diwali and year-end weeks. Permitted job sources found in the sourcing spike |

**These dates don't cover Chennai.** The launch scope is now Bengaluru + Chennai ([ADR-0002](docs/decisions/0002-launch-scope-two-cities.md)). Chennai's curation, geocoding, and launch gate aren't included in the 18 Jan estimate. Before committing to any launch date, the product owner has to either (a) re-estimate a joint launch, or (b) confirm a staggered launch in which the code ships for both cities and Chennai goes `live` only when its data passes the gate. This is **D-01** in the decision register.

## Phase overview

| Phase | Name | Gate to leave the phase |
| --- | --- | --- |
| 1 | Repository setup and deployment feasibility | A skeleton runs on a Workers preview; the plan-tier evidence is recorded |
| 2 | Map prototype and **performance validation gate** | The gate report is signed off (pass, or an explicitly approved fallback) |
| 3 | Schema, RLS, migrations, sample data | RLS tests pass; seed data for both cities loads |
| 4 | City selection and company explorer | Real API data appears on the map |
| 5 | Search, filters, Grid and List | The three views agree on every filter combination tested |
| 6 | Company details and jobs | Journey AC01–AC07 automated |
| 7 | Admin tools and imports | Admins can CRUD, import, and publish; audit log written |
| 8 | Data refresh, link checks, public feedback | Schedules run on staging; missed-run alert fires in a test |
| 9 | Accessibility, security, performance, release verification | Release checklist in docs/testing.md fully green |
| 10 | Optional enhancements and more cities | Per-feature |

---

## Phase 1 — Repository setup and deployment feasibility

### P1-01 Scaffold the repository
- **Objective:** Create a Next.js App Router + TypeScript + Tailwind + shadcn/ui skeleton with verified scripts.
- **Dependencies:** none
- **Files:** `package.json`, `tsconfig.json`, `app/`, `app/globals.css` (design tokens), `components/ui/`, `eslint` config, `vitest.config.ts`, `playwright.config.ts`, `tests/unit/design-tokens.test.ts`, CLAUDE.md (commands section)
- **Steps:** 1) Use `create-next-app` with the latest Next.js version that `@opennextjs/cloudflare` supports (check its docs on the day). 2) Add Tailwind and initialise shadcn/ui. 3) Add Vitest, Playwright, and @axe-core/playwright. 4) Add the scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `preview`. 5) Create the directory layout from CLAUDE.md. 6) Apply the Milky/Mantis tokens from [docs/design-system.md §8](docs/design-system.md#8-implementation) to the shadcn variables, remove the `.dark` block, and load Overpass through `next/font/google` (check its `tnum` support).
- **Acceptance:** Every script runs locally. CLAUDE.md's Commands table is marked verified, with the date. The design-token contrast test passes, and the default shadcn button renders Mantis with Ink text.
- **Verification:** Run `npm run lint && npm run typecheck && npm test && npm run build` and paste the output into progress.md.
- **Status:** Completed (30 Sep 2026). The app is in `code/`, as the owner asked. The `preview` script moves to P1-02, because it needs OpenNext and wrangler. See progress.md.

### P1-02 Workers deployment feasibility
- **Objective:** Prove that the skeleton builds with OpenNext and runs on a Cloudflare Workers **preview** (not public production).
- **Dependencies:** P1-01
- **Files:** `wrangler.jsonc`, `open-next.config.ts`, `docs/decisions/0003-hosting-plan-tiers.md`
- **Steps:** 1) Add `@opennextjs/cloudflare` and wrangler in `code/`, plus the `preview` script carried over from P1-01. 2) Build, and record the bundle size (uncompressed and gzip). 3) Run `wrangler dev`, then deploy to a preview URL or `workers.dev` (needs authorization). 4) Measure SSR CPU time for a representative page against the Free plan's 10 ms CPU limit. 5) Confirm that no Node Middleware is used (not supported by the adapter as of 30 Sep 2026). 6) Decide whether any ISR is needed. If it isn't, no incremental cache store is required.
- **Acceptance:** ADR-0003 is updated with measured numbers and a recommendation (Free vs Paid, R2 cache or none) and cites its sources.
- **Verification:** A preview URL responds 200. Wrangler output is logged.
- **Status:** Completed (30 Sep 2026). Preview Worker at https://company-map-preview.company-map.workers.dev (approved by the owner). The measurements and recommendation (Workers Paid for staging/production because of CPU time, no R2) are in ADR-0003.

### P1-03 Supabase project and CLI setup
- **Objective:** Set up the local Supabase stack and link the `dev` project, with PostGIS and `pg_trgm` enabled.
- **Dependencies:** P1-01
- **Files:** `supabase/config.toml`, `supabase/migrations/0000_extensions.sql`, `.env.example`
- **Steps:** Run `supabase init`, then `supabase start`. Write the extensions migration. Document the environment variables.
- **Acceptance:** `supabase db reset` applies cleanly. `select postgis_version()` works.
- **Verification:** Command output in progress.md.
- **Status:** Not started

### P1-04 CI skeleton
- **Objective:** Add a GitHub Actions workflow that runs lint, typecheck, unit tests, and a dependency audit on pull requests.
- **Dependencies:** P1-01
- **Files:** `.github/workflows/ci.yml`, `.github/dependabot.yml`
- **Acceptance:** The workflow passes on a test PR. No secrets are needed for the PR job.
- **Verification:** Link to the CI run.
- **Status:** Completed (30 Sep 2026). [CI run 36716151218](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/36716151218) passed on `main` (commit `bf62bdd`). It ran on the push to `main` rather than on a test PR: no PR was opened, the owner asked for a direct merge, and the push run executes the same jobs. The pull-request trigger itself gets exercised by the next PR.

### P1-05 Basemap feasibility
- **Objective:** Confirm the Geoapify vector style loads in MapLibre with attribution, and estimate credit use.
- **Dependencies:** P1-01
- **Files:** `map/basemap.ts`, `docs/decisions/0006-basemap.md`
- **Steps:** Load the Geoapify style with the key from the environment (a public key restricted by referrer). Count tile requests per typical session. Compare that against the current free allowance, checked and cited on the day. Override the style's paint properties to the basemap palette in [docs/design-system.md §2](docs/design-system.md#2-map-colours) (Milky land, no green parks), and check that Geoapify's terms allow it.
- **Acceptance:** The map renders with visible Geoapify and OpenStreetMap attribution and the design-system basemap colours. The ADR records the estimate, the style-customisation terms, and their sources.
- **Status:** Not started

## Phase 2 — Map prototype and performance validation gate

This phase runs in a standalone prototype route (`/dev/map-prototype`), using synthetic data that is labelled as such. Full behaviour is in [docs/map-spec.md](docs/map-spec.md).

### P2-01 Synthetic dataset generator
- **Objective:** Generate reproducible synthetic point sets: S (1,500 offices), M (5,000), L (15,000), with realistic density hotspots (Manyata, Whitefield/ITPL, ORR, Koramangala, Chennai OMR/Guindy), 50 identical-coordinate groups, and a 30-company single building.
- **Dependencies:** P1-01
- **Files:** `scripts/gen_synthetic_points.py` or `map/fixtures/generate.ts`, `map/fixtures/*.json`
- **Acceptance:** Output is deterministic from a seed. Every record has `synthetic: true`.
- **Verification:** Unit test: same seed gives the same hash.
- **Status:** Not started

### P2-02 Clustering worker (Supercluster + Comlink)
- **Objective:** Move clustering into a Web Worker that returns stable keys and parent lineage, and tags each response with a generation number.
- **Dependencies:** P2-01
- **Files:** `map/worker/cluster.worker.ts`, `map/worker/client.ts`, `map/worker/lineage.ts`
- **Steps:** Build the index (radius 60, maxZoom 17, minPoints 2: proposals from the plan). Expose `load(points, generation)` and `getClusters(bbox, zoom, generation)`. For each item, return a stable key (office ID or a deterministic cluster key) and its ancestor key at the previous and next integer zoom. Add unique-company counts per cluster.
- **Acceptance:** Lineage is consistent (the children of cluster X at z+1 all report X as their parent at z). Responses carry their generation, and the client drops stale ones.
- **Verification:** Vitest over the fixtures: lineage invariants, a stale-response test, company-vs-office count test.
- **Status:** Not started

### P2-03 Custom WebGL layer: static rendering
- **Objective:** Draw clusters and logos as instanced quads in one pass in a MapLibre custom layer.
- **Dependencies:** P2-02
- **Files:** `map/layer/company-layer.ts`, `map/layer/shaders/*`
- **Acceptance:** Renders 60 clusters and 400 logos correctly, with viewport culling (+20% margin). Marker, cluster, stack, and selection colours come from `map/theme.ts` (read from the CSS tokens), as specified in [docs/design-system.md §2](docs/design-system.md#2-map-colours).
- **Verification:** Playwright screenshot of the prototype route. Manual check on the reference desktop.
- **Status:** Not started

### P2-04 Logo atlas manager
- **Objective:** Build multi-page texture atlases at 64 and 128 px (chosen by DPR), with LRU eviction, a GPU memory budget, letter fallbacks, and missing-image handling.
- **Dependencies:** P2-03
- **Files:** `map/atlas/*`
- **Acceptance:** Adds a second atlas page when the first is full. Stays within a configurable memory budget (proposal: 64 MB of textures on mobile). Failed or slow images show letter fallbacks without blocking the render, using the five non-green swatches in design-system.md §2.
- **Verification:** Unit tests for packing and eviction. A throttled-network manual check.
- **Status:** Not started

### P2-05 Animation engine
- **Objective:** Animate position, scale, and opacity for split and merge. Transitions must be reversible and retargetable, and must be cancelled by a newer generation.
- **Dependencies:** P2-02, P2-03
- **Files:** `map/animation/*`
- **Acceptance:** Split 280 ms ease-out and merge 220 ms ease-in (proposals). Zooming again mid-transition retargets from the *current* interpolated state and never jumps back to a start state. A filter change mid-zoom cancels cleanly. No duplicate keys are ever drawn.
- **Verification:** Unit tests on the interpolator with a fake clock. Playwright script that runs 20 rapid zoom cycles and asserts that the set of drawn keys has no duplicates (exposed via a debug hook).
- **Status:** Not started

### P2-06 Hit testing, touch, overlap, and co-location
- **Objective:** Hit test against current animated positions, with 44 px touch targets, a deterministic overlap order, and stack/spider for identical coordinates.
- **Dependencies:** P2-05
- **Files:** `map/hit-test/*`, `map/layer/spider.ts`
- **Acceptance:** A tap during an animation selects what is drawn under the finger. Overlaps resolve by the rule in map-spec.md §6. Stacks of up to 8 open on a circle, 9–20 on a spiral, and more than 20 open a list.
- **Verification:** Unit tests for the tie-break rule. Playwright tap tests on the co-location fixture.
- **Status:** Not started

### P2-07 Popup, keyboard, accessible list, reduced motion, failure modes
- **Objective:** Build the logo popup with View company, a focusable mirror list with a visible focus ring, reduced-motion behaviour, and WebGL-failure and tile-failure fallbacks.
- **Dependencies:** P2-06
- **Files:** `components/explorer/map-popup.tsx`, `components/explorer/map-a11y-list.tsx`, `map/fallback.ts`
- **Acceptance:** Every drawn company can be reached by keyboard. When WebGL is unavailable, the user lands on List view with a notice.
- **Verification:** An axe scan passes on the prototype route. Manual screen-reader smoke test.
- **Status:** Not started

### P2-08 Cleanup and lifecycle
- **Objective:** On unmount or city change, dispose of the worker, GL textures and buffers, and event listeners.
- **Dependencies:** P2-05
- **Acceptance:** Mounting and unmounting 20 times shows no listener growth and a flat heap (within the proposed tolerance in map-spec.md).
- **Verification:** A Playwright script with CDP heap and listener counts.
- **Status:** Not started

### P2-09 Validation gate run and report
- **Objective:** Run the reproducible gate in map-spec.md §10 on the named devices.
- **Dependencies:** P2-02 … P2-08; **D-06** (named reference devices) decided
- **Files:** `docs/map-gate-report.md`
- **Acceptance:** A report with raw numbers for each metric and device, pass or fail against the proposed thresholds, and sign-off by the gate owner. **If it fails:** status becomes Blocked, the options go into an ADR with their trade-offs, and nothing switches to plain markers without approval.
- **Status:** Not started

## Phase 3 — Database schema, authorization policies, migrations, sample data

### P3-01 Core schema migration
- **Dependencies:** P1-03, **D-02** (company-type model), **D-03** (founder data)
- **Files:** `supabase/migrations/*_core.sql`
- **Steps:** Create the tables in [docs/data-model.md](docs/data-model.md): city, neighbourhood, tech_park, company, company_type_tag, startup stage, founder, sector, office, job, job_city, source.
- **Acceptance:** `supabase db reset` succeeds. The city-boundary trigger rejects an out-of-boundary published office.
- **Verification:** pgTAP tests in `supabase/tests/`.
- **Status:** Not started

### P3-02 RLS policies and admin roles
- **Dependencies:** P3-01
- **Acceptance:** anon reads only published companies and offices and active jobs, and writes nothing. Authenticated non-admins get the same access as anon. Admin roles follow their matrix. The service role is never used from the browser.
- **Verification:** pgTAP RLS tests for each role and table.
- **Status:** Not started

### P3-03 Shared filter + search SQL functions
- **Dependencies:** P3-01
- **Objective:** Write one `company_filter(city, filters)` used by `city_points`, `search_companies`, and `company_facets`. Search covers job title, company name, location, and founder name.
- **Acceptance:** For the same filters, the points, list, and facet counts agree (unique companies).
- **Verification:** pgTAP consistency tests across a filter matrix, including Startup+stage and the overlapping types.
- **Status:** Not started

### P3-04 Sample data for Bengaluru and Chennai
- **Dependencies:** P3-01
- **Files:** `supabase/seed/*.sql`
- **Acceptance:** Both city rows exist with boundaries, neighbourhoods, and parks. Sample companies are clearly marked synthetic until real curated data replaces them.
- **Status:** Not started

## Phase 4 — City selection and company explorer

- **P4-01 Public API: cities and points.** `GET /api/v1/cities`, `GET /api/v1/cities/{city}/points` with Zod validation and cache headers. Deps: P3-03. Verify: Vitest handler tests, and a contract test against local Supabase. Status: Not started
- **P4-02 City selection page `/`.** Bengaluru and Chennai cards, each drawn as the city boundary filled with its real office points (design-system.md §5); other cities show Coming soon and aren't clickable. Deps: P4-01. Verify: Playwright AC01. Status: Not started
- **P4-03 Explorer shell.** Full-screen map with an overlay toolbar (search, filters, view switch), wired to the Phase 2 layer and real points; `/bengaluru` redirects to `/bangalore`. Deps: P2-09 (passed or approved), P4-01. Verify: Playwright loads both cities. Status: Not started
- **P4-04 URL state module.** One Zod schema for city, view, q, filters, company, and camera. Back and Forward restore state. Deps: P1-01. Verify: unit round-trip tests, Playwright AC07. Status: Not started

## Phase 5 — Search, filters, Grid and List views

- **P5-01 Search box and suggest API** (job title, company, location, founder). Deps: P3-03, P4-04. Verify: Vitest and Playwright for each search type. Status: Not started
- **P5-02 Company-type filter** (Startup/MNC/Product, multi-select, OR within the group). Deps: P3-03, D-02. Verify: a company tagged with two types appears once. Status: Not started
- **P5-03 Startup-stage filter.** Disabled unless Startup is selected. Deselecting Startup clears the stages from the state and the URL. A URL that contains stages without Startup is normalised on load. Deps: P5-02. Verify: unit tests on the reducer, Playwright. Status: Not started
- **P5-04 Grid and List views** (TanStack Virtual above the proposed 100 rows), sharing the map's query key and counts. Deps: P4-03. Verify: Playwright asserts identical company IDs and counts across Map, Grid, and List for a filter matrix. Status: Not started
- **P5-05 List–map sync and selection** (hovering a row highlights its marker; `?company=`). Deps: P5-04. Status: Not started

## Phase 6 — Company details and company jobs

- **P6-01 Company API + `/companies/{slug}`** with Visit website (via `/go/site/{company}`) and View jobs; old slugs redirect. Deps: P3-03. Verify: Playwright AC05. Status: Not started
- **P6-02 Jobs API + `/companies/{slug}/jobs`.** Each row is **title + Apply only**, with a freshness line and an empty state. Deps: P6-01. Verify: a Playwright check that the row DOM contains only those two elements. Status: Not started
- **P6-03 `/go/job/{id}` redirect.** 302 to the stored URL unchanged; the click is logged with no personal data; https and domain checks. Deps: P6-02. Verify: unit and security tests. Status: Not started

## Phase 7 — Admin tools and data imports

- **P7-01 Admin auth** (Supabase Auth, allowlist, no public sign-up, `/admin` excluded from public bundles). Deps: P3-02. Status: Not started
- **P7-02 CRUD + publish for companies, offices, and jobs,** with an audit log. Deps: P7-01. Status: Not started
- **P7-03 CSV import with preview, validation, duplicate detection, and error summary.** Deps: P7-02. Status: Not started
- **P7-04 Review queues** (geocode below building accuracy, suspect jobs, submissions). Deps: P7-02. Status: Not started

## Phase 8 — Data refresh, link checks, public feedback

- **P8-01 Python feed sync** (ATS feeds, JSON-LD) in GitHub Actions against staging. Deps: P3-01, D-04 (sources). Status: Not started
- **P8-02 Link checker with a two-strike expiry.** Deps: P8-01. Status: Not started
- **P8-03 Supabase Cron sweeps + missed-run detection** (heartbeat table + alert). Deps: P8-01. Status: Not started
- **P8-04 Reports and suggestions forms** with Turnstile verified on the server and rate limits. Deps: P3-02. Status: Not started

## Phase 9 — Accessibility, security, performance, release verification

- **P9-01 WCAG 2.2 AA audit** (axe plus a manual keyboard and screen-reader pass). Status: Not started
- **P9-02 Security review** (CSP, RLS re-test, secret scan, dependency audit). Status: Not started
- **P9-03 Performance budgets with real data on the reference devices** (map gate re-run). Status: Not started
- **P9-04 Backup restore drill; city launch gate for each city.** Status: Not started
- **P9-05 Release checklist** ([docs/testing.md](docs/testing.md) §Release). A production deploy **requires explicit authorization**. Status: Not started

## Phase 10 — Optional enhancements and additional cities

Local shortlist (Dexie), recently viewed, compare, cluster previews, neighbourhood insights, Protomaps PMTiles migration, and further cities (Hyderabad, Pune, Coimbatore, Mumbai, Gurugram+Noida) as data releases. Scope each as tasks when it's picked up. Status: Not started

---

## Open decision register

| ID | Decision | Blocks | Owner |
| --- | --- | --- | --- |
| D-01 | Launch both cities together, or ship the code for both and stagger Chennai's data go-live? Re-baseline dates | P9-05 | Product owner |
| D-02 | Accept the multi-tag company-type model and the definition of "Product" (ADR-0004) | P3-01, P5-02 | Product owner |
| D-03 | Founder data: source, permitted use, and privacy handling for a named individual | P3-01, P5-01 | Product owner + legal |
| D-04 | Launch data sources and the coverage target for each city | P8-01, P9-04 | Product owner |
| D-05 | Is "Public"/"Acquired" a *startup stage* (as the brief lists it) or a separate company status? | P5-03 | Product owner |
| D-06 | Named reference devices, network profile, and the map gate owner | P2-09 | Product owner |
| D-07 | Geocoding provider, error-reporting tool, analytics + privacy notice | P7-04, P9 | Tech lead |
| D-08 | Product name and domain. **Brand colours confirmed 30 Sep 2026** (Milky + Mantis `#59C749`); Milky `#FFFDF1` confirmed the same day. The owner may revisit the combination after seeing it in the UI. Still open: designer sign-off on the derived tokens and font ([design-system.md](docs/design-system.md)) | P9-05 | Product owner |
| D-09 | Workers Free vs Paid, and Supabase Free vs Pro for production. **P1-02 measured:** a server-rendered page uses 38 ms CPU at the median, against a 10 ms Free limit, so ADR-0003 recommends Workers Paid for staging and production. Supabase is still to be measured | Staging deploy, P9-05 | Tech lead + product owner (cost) |
