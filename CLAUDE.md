# CLAUDE.md — Company Map

Primary instruction file for Claude Code. Keep it short; details live in the linked docs.

## Before you start any work

0. **New laptop?** Follow [docs/setup-new-machine.md](docs/setup-new-machine.md) (tools, `npm ci`, local settings, and the shared Claude memory in [docs/claude-memory/](docs/claude-memory/README.md)).
1. Read [plan.md](plan.md) and [docs/progress.md](docs/progress.md). Work on the task marked **In progress**, or the first **Not started** task whose dependencies are **Completed**.
2. Read the docs the task links to (map work → [docs/map-spec.md](docs/map-spec.md), any UI, styling, or copy → [docs/design-system.md](docs/design-system.md), database → [docs/data-model.md](docs/data-model.md), etc.).
3. Check [docs/decisions/](docs/decisions/) for accepted decisions and the open-decision register.

## After each completed task

- Update the task status in `plan.md` and add an entry to `docs/progress.md` (what changed, what was verified and how, what's still unverified, next action).
- Record any significant architecture choice as a new ADR in `docs/decisions/` (copy the template).
- If a task is blocked, set it to **Blocked**, write the blocker in `docs/progress.md`, and stop. Don't work around it silently.

## Authoritative documents

| Document | Status |
| --- | --- |
| BRD (business requirements, IDs MAP01…, DISC…, JOB…, ADM…, NFR…, AC…) | **Not in the repository.** Requirement IDs are cited from the architecture plan. Ask for the BRD before relying on any ID's exact wording. |
| [Architecture & Implementation Plan](Company%20Map%20—%20Architecture%20&%20Implementation%20Plan.md) (30 Sep 2026) | In the repo. It is the source for architecture, but where it conflicts with the rules in this file, **this file wins** (see [ADR-0002](docs/decisions/0002-launch-scope-two-cities.md)). |
| [docs/](docs/) | Specs derived from the two documents above. Every item is marked either *Confirmed* or *Proposal*. |

## Product

This is a map-first company discovery portal. Visitors find companies by where their offices are, look at verified open jobs, and apply on the employer's own site. It is **not** a job-application portal: it stores no applicant data.

**Launch scope (confirmed by the project owner, 30 Sep 2026)**
- Cities: **Bengaluru (`/bangalore`) and Chennai (`/chennai`)**. The architecture plan proposed launching Bengaluru alone and adding Chennai in R2. That conflict is recorded in ADR-0002 and is still open for the launch-date question.
- **No public login.** Supabase Auth is used only by allowlisted administrators.

**User journey:** city selection → company explorer → company details → company jobs → external application (a direct link to the employer's site; a beacon counts the click, [ADR-0006](docs/decisions/0006-free-tier-static-hosting.md)).

**Explorer**
- A full-screen map with an overlay toolbar that holds search, filters, and the Map/Grid/List switch.
- Search covers **job title, company name, location** (neighbourhood, tech park, area), and **founder name**. Founder data isn't in the plan's schema yet; it's a proposal in data-model.md.
- Company-type filter: **Startup, MNC, Product**. These categories **overlap** (a company can be both a Startup and a Product company), so the type is a multi-valued tag, not a single column. Values combine with OR inside the group and AND across groups (proposal, see [ADR-0004](docs/decisions/0004-company-type-filter-model.md)).
- The startup-stage filter is enabled **only while Startup is selected**. Stages: Pre-seed, Seed, Bootstrapped, Series A, Series B, Series C, Series C+, Public, Acquired. Deselecting Startup clears any selected stages from the state and the URL. Whenever a selection changes, clear any filter it makes incompatible.
- **Map, Grid, and List show the same result set and the same counts.** They are produced by one shared SQL filter and one URL state.
- Clicking a company logo on the map opens a popup with **View company**.
- The company details page has **Visit website** and **View jobs**.
- Each company job row contains **only the job title and Apply**.

Map quality is a release requirement. Follow [docs/map-spec.md](docs/map-spec.md). If the prototype fails its gate, **don't silently replace the animated layer with ordinary markers**. Record the failure, set out the fallback trade-offs, and ask.

## Design (see [docs/design-system.md](docs/design-system.md))

- **Brand colours [Confirmed, 30 Sep 2026]:** **Milky `#FFFDF1`** and **Mantis `#59C749`**, used across the entire application (public pages, map, admin). The owner may change the combination once it's seen in the running UI, so keep every colour behind the tokens and a palette swap stays a token-only change.
- **Mantis on Milky is 2.12:1.** Never use Mantis for text, icons, or thin lines on Milky. Mantis is a fill, and text on Mantis is always Ink `#1F3A1A`, never white. Use Mantis Deep `#2F7A24` when green has to be read.
- Use only the tokens in `code/app/globals.css` (Tailwind's default colours are switched off there). No raw hex values in components or shaders, and no other accent hues or gradients. The map layer reads the same CSS variables.
- The basemap carries no green, so Mantis always means companies. One family, Overpass. Sentence case, no all-caps labels. Round shapes mean a company; everything else has a 4 px radius.

## Approved stack

Next.js App Router · React · TypeScript · Tailwind CSS · shadcn/ui · MapLibre GL JS · Supercluster (the only company-point clustering engine; MapLibre's built-in clustering stays off) · Web Worker + Comlink · custom WebGL layer · Geoapify basemap (Protomaps PMTiles on R2 later) · TanStack Query · URL filter state · TanStack Virtual · Dexie.js (later) · Supabase Postgres functions (RPC) + Edge Functions for everything server-side · Supabase Postgres + PostGIS + `pg_trgm` + full-text search · Supabase CLI migrations · Supabase Auth (admins only) · Supabase Storage · Python in GitHub Actions · Supabase Cron · Cloudflare Turnstile (verified in an Edge Function) · Next.js static export (`output: "export"`) served as **Cloudflare Workers static assets** (an assets-only Worker, Free; Cloudflare's successor to Pages, [ADR-0007](docs/decisions/0007-workers-static-assets.md)), deployed with `wrangler deploy` · Vitest · Playwright · axe-core · GitHub Actions CI.

**Don't add** FastAPI, Celery, Redis, AWS, Kubernetes, or any other service unless an ADR documents a concrete requirement for it.

### Free tiers only ([ADR-0006](docs/decisions/0006-free-tier-static-hosting.md), owner decision, 30 Sep 2026)
- **No paid plans.** Anything that would need one (Workers Paid, Supabase Pro, a paid add-on) must be raised with the owner first.
- **Nothing renders on a server at request time.** Every public page is prerendered at build. The Next.js code must not use request-reading Route Handlers, Server Actions, `proxy`, cookies, ISR, `next.config` redirects/rewrites/headers, or default-loader image optimisation (all unsupported by static export). Redirects go in `_redirects`, headers in `public/_headers`.
- **The Next.js app holds no secrets.** Server-side work (Turnstile, feedback, click counting, rebuild requests) runs in Supabase Edge Functions. Reads and admin writes go through RLS-protected tables and RPCs.
- Keep the build within the Workers static assets Free limits: 20,000 files, 25 MiB per file, 2,000 static + 100 dynamic redirects, 100 header rules. `postbuild` enforces this. Each prerendered page costs **5 files**, so budget routes with that in mind (ADR-0007). Company jobs have their own page (D-10 Option A). If the build warns above 15,000 files, switch to Option B (P6-04).
- Supabase Free allows 2 active projects: **staging** and **prod**. Development uses the local stack only.

## Repository structure

All application code lives in **`code/`** (created in P1-01, 30 Sep 2026). The planning documents stay at the repository root. Code paths in the docs (`app/…`, `map/…`, `supabase/…`) are relative to `code/`.

```
code/
  app/               Next.js routes, all prerendered: (public)/, admin/ (client-rendered), dev/ (design + prototype pages)
  components/        ui/ (shadcn), explorer/, company/, admin/
  lib/               design/ (tokens, contrast), filters/ (URL state + schema), api/, supabase/ (server|browser clients)
  map/               layer/ (WebGL), worker/ (Supercluster + Comlink), animation/, hit-test/, atlas/
  supabase/          migrations/, seed/, functions/ (Edge Functions: submit-feedback, click, request-rebuild), tests/ (SQL/RLS tests), created in P1-03
  scripts/           Python pipeline (imports, feed sync, link checks)
  tests/             unit/ (Vitest), e2e/ (Playwright), a11y/ (axe)
docs/                specs, ADRs, progress
```

`code/AGENTS.md` (loaded through `code/CLAUDE.md`) is generated by Next.js. It says to read the Next 16 docs bundled in `code/node_modules/next/dist/docs/` before using an API, because Next 16 differs from older versions. Keep it.

## Conventions

- TypeScript `strict`. No `any` unless there's a comment justifying it. Validate every external input with Zod inside the Edge Function that receives it. Postgres functions check their own arguments.
- Filter state lives in the URL, parsed by one schema in `lib/filters/`. Components never read `searchParams` directly.
- Filter semantics are defined in Postgres (`company_filter`) and mirrored **once** in TypeScript (`lib/filters/`). The build uses SQL to write each city's static dataset. The browser runs the TypeScript filter over that dataset for Map, Grid, List, and every count. A CI parity test proves both give identical company IDs over the filter matrix. Never filter anywhere else.
- Schema changes go only through new files in `supabase/migrations/`. Never edit an applied migration.
- Use kebab-case file names and PascalCase component names. Keep map rendering code free of React.
- Keep commits small and scoped to one plan task ID (for example `P2-03: …`).

## Commands

Run these from `code/`. Requires Node.js 24 or later. The first four rows were **verified on 30 Sep 2026** (P1-01, Windows 11, Node 24.14.1, npm 11.11.0).

| Purpose | Command | Status |
| --- | --- | --- |
| Install | `npm ci`, then `npx playwright install chromium` once | Verified |
| Dev server | `npm run dev` (http://localhost:3000; `/dev/tokens` shows the palette) | Verified |
| Lint / types / build | `npm run lint`, `npm run typecheck`, `npm run build` | Verified |
| Unit tests | `npm test` (Vitest) | Verified |
| Synthetic map data | `npm run fixtures` writes the S/M/L datasets to `map/fixtures/out/`; add `-- --manifest` to refresh `map/fixtures/manifest.json` after an intentional generator change | Verified (P2-01) |
| Build | `npm run build` first writes `public/data/` (it **fails without a data source**: set `DATA_SOURCE=seed` for the committed synthetic sample, [ADR-0010](docs/decisions/0010-build-data-source.md)), then writes the static export to `out/`. `postbuild` fails it on a static-assets Free limit or a secret-looking string. For staging, set `SITE_ENV=staging DEV_ROUTES=on`. `RELEASE_BUILD=1` (production only) refuses synthetic data | Verified (P1-06, P4-02) |
| E2E + a11y | `npm run test:e2e` (Playwright + axe; builds with `DEV_ROUTES=on`, serves `out/` via `wrangler dev` on :3100). For a running site, set `PLAYWRIGHT_BASE_URL` | Verified (P1-06) |
| Local preview | `npm run preview` (serves the existing `out/` as the assets-only Worker on :8788, with `_headers`/`_redirects`/404) | Verified (P1-06) |
| Staging deploy | Build with `SITE_ENV=staging DEV_ROUTES=on NEXT_PUBLIC_SITE_URL=https://company-map-staging.company-map.workers.dev`, then `npm run deploy:staging` (`wrangler deploy --env staging`), or use the **Deploy staging** workflow (Actions → Deploy staging → Run workflow; secrets are set). **Only with the owner's approval** | Verified (P1-06; workflow verified 30 Sep 2026) |
| MapLibre files | `npm run dev` and `npm run build` first run `scripts/copy-maplibre.mts`, which copies MapLibre's three runtime modules to the git-ignored `public/maplibre/<version>/`. MapLibre is loaded from there at run time, not bundled (Turbopack's hashed names break its worker, [ADR-0008](docs/decisions/0008-basemap.md)). Use `loadMapLibre()` in `map/basemap.ts`; don't `import "maplibre-gl"` for values (types only). `/dev/basemap` shows the basemap and needs `NEXT_PUBLIC_GEOAPIFY_KEY` | Verified (P1-05) |
| Filter parity | `npm run test:parity` compares the TypeScript filter with the SQL functions over the seeded local database (run `npx supabase db start`, then `db reset`, first). Not part of `npm test` | Verified (P4-01) |
| City datasets | `npm run data` writes `public/data/` from `city_build_snapshot` (the Supabase URL and anon key, `LOCAL_DATABASE_URL`, or `DATA_SOURCE=seed`; see [docs/filters.md](docs/filters.md)). `npm run data -- --export-seed` rewrites the committed synthetic snapshots after a seed change | Verified (P4-01, P4-02) |
| Edge Functions | `npx supabase start` (full stack, about 2 GB), then `npx supabase functions serve click --no-verify-jwt --env-file <file with ALLOWED_ORIGINS=http://localhost:3100>`; the handler logic is unit-tested without Deno (`tests/unit/click-handler.test.ts`) | Run by hand once (P6-03, 5 Oct 2026) |
| Admin e2e | `npm run test:admin` runs `tests/admin/admin.spec.ts` against the **real local stack** (`npx supabase start -x studio,imgproxy,vector,logflare,realtime,pgadmin-schema-diff,migra,postgres-meta`, about 2 GB). Run `npx supabase db reset` first (the spec changes data and stops at its first failure), and do not run `supabase test db` at the same time. Its global setup starts the Edge Functions and stand-ins for GitHub and Cloudflare `siteverify`; the functions log is written to `%TEMP%/admin-e2e-functions.log`. Not in CI | Verified (P7, P8; 41 passed, 5 Oct 2026) |
| Pipeline tests | From `code/`, `pip install -r scripts/requirements.txt`, then `LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres python -m pytest scripts/pipeline/tests` (database tests skip without the variable). Scheduled runs: `python -m scripts.pipeline.cli sync\|linkcheck\|monitor` with `PIPELINE_DATABASE_URL` | Verified (P8; 69 passed) |
| Backup drill | `node scripts/backup-drill.mts` dumps the local database, restores it into a scratch database, and compares row counts, policies and functions (needs `npx supabase db start` and `db reset`). Runbook: [docs/backup-restore.md](docs/backup-restore.md) | Verified locally (P9-04); not on a hosted project |
| Size budgets | `tests/e2e/budgets.spec.ts` (part of `npm run test:e2e`) reports the explorer's gzipped JavaScript against the plan's 350 KB and fails above a 660 KB ceiling; open decision D-12 | Verified (P9-03): 629 KB measured |
| Launch gate | `node scripts/launch-gate.mts [--city bangalore] [--out docs/launch-gate-report.md]` judges the datasets in `public/data/` against the city thresholds in `lib/launch-gate.ts`; exit 1 on a failing city. A synthetic build always fails | Verified on the synthetic sample (P9-04) |
| Local DB | `npx supabase db start` (Postgres only, as in CI) or `npx supabase start` (full stack), then `npx supabase db reset` and `npx supabase test db`. Needs Docker running | `db start`, `db reset`, and `test db` verified (P1-03, 1 Oct 2026); full `start` not run |

## Security (see [docs/security.md](docs/security.md))

- **Never commit credentials.** Only `.env.example`, containing placeholders, goes in git.
- **Never expose the Supabase service-role/secret key to the browser.** Nothing prefixed `NEXT_PUBLIC_` may be privileged. The static site has no server, so privileged keys exist only as Supabase function secrets and GitHub secrets. The `/admin` JavaScript is public; RLS is the only access control.
- Enable RLS on every table in `public`, and test it with the anon and authenticated roles.
- Verify Turnstile in the `submit-feedback` Edge Function before any feedback insert.
- Apply and website URLs must be `https` and pass the domain check **at build time** (a failing URL fails the build). Open them with `rel="noopener noreferrer"`.

## Testing, accessibility, and done

- **Never claim tests passed unless you ran them in this session.** Quote the command and the result. List blockers, skipped checks, and unverified assumptions explicitly.
- WCAG 2.2 AA: every map company is also reachable in List view, focus is visible, touch targets are at least 44 px, and `prefers-reduced-motion` is respected.
- A task is **done** when its acceptance criteria are met, its listed tests exist and pass locally (lint, typecheck, and unit at minimum), and `plan.md` and `docs/progress.md` are updated. See [docs/testing.md](docs/testing.md).

## Hard rules

- Don't change the approved scope, stack, or cities silently. Propose the change in an ADR and ask.
- Don't deploy anything publicly (the production `company-map` Worker, a public DNS record, a public Supabase project) without explicit authorization. Staging/preview deploys only when the task says so and the owner has approved it.
- Don't invent data: no fake verification dates, logos, founders, or jobs presented as real. Synthetic data must be labelled synthetic.
- Treat target dates as proposals, not commitments.
