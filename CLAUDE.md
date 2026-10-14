# CLAUDE.md — Company Map

Primary instruction file for Claude Code. Keep it short; details live in the linked docs.

## Before you start any work

0. **New laptop?** Follow [docs/setup-new-machine.md](docs/setup-new-machine.md) (macOS and Windows: tools, versions, local secrets, test stack, pilot data). Open Claude Code in this repository folder, not its parent, so this file loads.
1. **Sync first** (see "Two laptops" below): `git status`, `git fetch origin`, then read [docs/session-handoff.md](docs/session-handoff.md) (current state, branch claims, next action) and [docs/claude-memory/MEMORY.md](docs/claude-memory/MEMORY.md) (working rules learned in past sessions).
2. Read [plan.md](plan.md) and the newest entries of [docs/progress.md](docs/progress.md). Work on the task marked **In progress**, or the first **Not started** task whose dependencies are **Completed**.
3. Read the docs the task links to (map work → [docs/map-spec.md](docs/map-spec.md), any UI, styling, or copy → [docs/design-system.md](docs/design-system.md), database → [docs/data-model.md](docs/data-model.md), etc.).
4. Check [docs/decisions/](docs/decisions/) for accepted decisions and the open-decision register.

## After each completed task

- Update the task status in `plan.md` and add an entry to `docs/progress.md` (what changed, what was verified and how, what's still unverified, next action).
- Update [docs/session-handoff.md](docs/session-handoff.md) (the **Now** block and one **Handoff log** line), commit it with the work, and push (below).
- Record any significant architecture choice as a new ADR in `docs/decisions/` (copy the template).
- If a task is blocked, set it to **Blocked**, write the blocker in `docs/progress.md`, and stop. Don't work around it silently.

## Two laptops: GitHub is the shared memory

The project is developed on a Windows laptop and a Mac ([ADR-0026](docs/decisions/0026-two-laptop-workflow.md)). GitHub holds the latest code **and** the project context: [docs/session-handoff.md](docs/session-handoff.md), `docs/progress.md`, `plan.md`, `docs/decisions/`, and [docs/claude-memory/](docs/claude-memory/README.md). Claude Code's own memory folder (in the home directory) is per machine: put project knowledge in the tracked files, never only there.

1. **Session start:** `git status` and `git fetch origin`, then read the handoff. If the tree is clean and only behind, `git pull --ff-only`. If there are uncommitted changes, don't pull over them: report them and ask (commit, or `git stash`). If local and remote have diverged, merge (`git pull --no-rebase`); never reset or discard.
2. **Standing push authorization** for ordinary code and documentation: after a coherent batch passes its relevant checks (at least lint, typecheck and unit tests for code; the checks the task names), update the handoff, commit code and context together, and push. Then check CI (`gh run list --branch main --limit 3`; `gh run watch <id>`) and record the result in the next handoff line. Never claim CI passed without seeing it.
3. **Unfinished work is labelled.** If you stop or switch laptops before a batch is done and checked, commit it to `wip/<task-id>-<slug>` (commit subject starting `WIP:`), push that branch, and write in the handoff what works, what doesn't, and what was not run. Never put unvalidated work on `main`.
4. **Before every push:** `git fetch origin` again. If the other laptop pushed, merge it (`git pull --no-rebase`), resolve ordinary conflicts by keeping both sides' intent, rerun the checks, then push. Push only the branch you are on (`git push origin <branch>`). **Never `--force`, `--mirror` or `--all`, and never rebase or amend pushed commits.** A conflict you can't resolve safely: stop and ask.
5. **One laptop per branch.** Before working on a branch, claim it in the handoff's **Branch claims** row and push that. Release the claim when you stop. Branch per task: small batches finished in one sitting go to `main`; anything longer goes to `wip/<task-id>-<slug>`, and is merged into `main` (`git merge --no-ff` or fast-forward) only when done and checked. Delete the WIP branch afterwards. A checked branch the owner wants to review before merging is `task/<task-id>-<slug>` (not WIP); it is merged only on the owner's word. CI runs on pushes to `main` and on pull requests; for any other branch, start it by hand (`gh workflow run ci.yml --ref <branch>`; CI only, never a deploy workflow).
6. **Say what didn't sync.** If a push fails or anything stays local (commits, branches, stashes, untracked files, the database), say exactly what at the end of the session and write it in the handoff.
7. **Push authorization covers only pushing.** It does not authorize deployment, hosted changes (GitHub settings, Supabase, Cloudflare), history rewriting, Dependabot or other dependency merges, or paid services. Never push `backup/*` branches or anything under `.local-*`.

The local database never travels through Git. One laptop owns the pilot database at a time (named in the handoff); moving it is an encrypted backup carried by hand ([setup-new-machine.md §8](docs/setup-new-machine.md#8-the-pilot-data-a-separate-secure-transfer)).

## Authoritative documents

| Document | Status |
| --- | --- |
| BRD (business requirements, IDs MAP01…, DISC…, JOB…, ADM…, NFR…, AC…) | **Not in the repository.** Requirement IDs are cited from the architecture plan. Ask for the BRD before relying on any ID's exact wording. |
| [Architecture & Implementation Plan](Company%20Map%20—%20Architecture%20&%20Implementation%20Plan.md) (30 Sep 2026) | In the repo. It is the source for architecture, but where it conflicts with the rules in this file, **this file wins** (see [ADR-0002](docs/decisions/0002-launch-scope-two-cities.md)). |
| [docs/](docs/) | Specs derived from the two documents above. Every item is marked either *Confirmed* or *Proposal*. |

## Product

This is a map-first company discovery portal. Visitors find companies by where their offices are, look at verified open jobs, and apply on the employer's own site. It is **not** a job-application portal: it stores no applicant data.

**Launch scope (confirmed by the project owner, 30 Sep 2026)**
- Cities: **Bengaluru (`/bangalore`) and Chennai (`/chennai`)**, both built and tested from the start. **Bengaluru goes live first; Chennai is released after it** ([ADR-0016](docs/decisions/0016-launch-sequence-and-data-policy.md)). Domain: **officemap.tech**.
- Data is real and verified with evidence per field; AI may extract and organise but never invents companies, founders, locations, or jobs (ADR-0016).
- **No public login.** Supabase Auth is used only by allowlisted administrators.

**User journey:** city selection → company explorer → company details → company jobs → external application (a direct link to the employer's site; a beacon counts the click, [ADR-0006](docs/decisions/0006-free-tier-static-hosting.md)).

**Explorer**
- A full-screen map with an overlay toolbar that holds search, filters, and the Map/Grid/List switch.
- Search covers **job title, company name, location** (neighbourhood, tech park, area), and **founder name** (`company_founder`, built in P3-01; no founder data is loaded yet, and founders follow ADR-0016).
- Company-type filter: **Startup, MNC, Product**. These categories **overlap** (a company can be both a Startup and a Product company), so the type is a multi-valued tag, not a single column. Values combine with OR inside the group and AND across groups (accepted 3 Oct 2026, [ADR-0004](docs/decisions/0004-company-type-filter-model.md)).
- The startup-stage filter is enabled **only while Startup is selected**. Stages: Pre-seed, Seed, Bootstrapped, Series A, Series B, Series C, Series C+. Public/Acquired are a separate **company status** field ([ADR-0017](docs/decisions/0017-company-status-separate-from-stage.md), P9-06). Deselecting Startup clears any selected stages from the state and the URL. Whenever a selection changes, clear any filter it makes incompatible.
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

### Free by default, static hosting ([ADR-0006](docs/decisions/0006-free-tier-static-hosting.md), amended by [ADR-0018](docs/decisions/0018-spending-policy.md), 6 Oct 2026)
- **Free services where suitable; justified production spending is allowed.** Never buy or upgrade anything without a written proposal (service, plan, monthly cost, requirement met, free alternative considered) approved by the owner. Don't let cost force weaker reliability, map quality, or recovery.
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
| Staging deploy | Build with `SITE_ENV=staging DEV_ROUTES=on NEXT_PUBLIC_SITE_URL=https://company-map-staging.company-map.workers.dev`, then `npm run deploy:staging` (`wrangler deploy --env staging`), or use the **Deploy staging** workflow (Actions → Deploy staging → Run workflow). The workflow is disabled on GitHub (14 Oct 2026) and needs the GitHub `staging` environment and its variables first ([docs/deploy-environments.md](docs/deploy-environments.md)); until then the run stops at its configuration check. **Only with the owner's approval** | Verified (P1-06; workflow verified 30 Sep 2026) |
| MapLibre files | `npm run dev` and `npm run build` first run `scripts/copy-maplibre.mts`, which copies MapLibre's three runtime modules to the git-ignored `public/maplibre/<version>/`. MapLibre is loaded from there at run time, not bundled (Turbopack's hashed names break its worker, [ADR-0008](docs/decisions/0008-basemap.md)). Use `loadMapLibre()` in `map/basemap.ts`; don't `import "maplibre-gl"` for values (types only). `/dev/basemap` shows the basemap and needs `NEXT_PUBLIC_GEOAPIFY_KEY` | Verified (P1-05) |
| Dependency audit | `npm run audit` (`scripts/audit-gate.mts`) reports the TECHNICAL audit (blocks on any high or critical finding not covered by a current entry in `security/audit-exceptions.json`, [ADR-0019](docs/decisions/0019-dependency-vulnerability-exceptions.md)) and, separately, each exception's APPROVAL; CI runs it. `npm run audit -- --release` also fails while any exception lacks a named human approver who is not the assessor ([ADR-0022](docs/decisions/0022-evidence-for-jobs-changes-and-refresh.md)); the production workflow runs it | Verified (6 Oct 2026): technical pass, release fails (exception not approved) |
| Evidence checks | `python -m scripts.pipeline.cli evidence --limit N` checks due evidence against its source (ADR-0022); in the pipeline workflow | Tested (`scripts/pipeline/tests/test_evidence.py`); not run against a hosted project |
| Test stack (**never test against the main local database**) | `node scripts/test-stack.mts start [--db-only]` starts a disposable second stack (`company-map-test`, database :55322, API :55321) built from `supabase/`; `reset` resets it; `stop` discards it. Every database/admin test refuses any database without its marker (`tests/disposable-db.ts`). The main local database holds the pilot drafts: **never `db reset` it**; back it up with `pg_dump` to `.local-backups/` before risky work | Verified (7 Oct 2026) |
| pgTAP | `npm run test:db` (the test stack) | Verified (8 Oct 2026; 18 files, 757 passed) |
| Filter parity | `npm run test:parity` compares the TypeScript filter with the SQL functions over the test stack's seeded database. Not part of `npm test` | Verified (7 Oct 2026; 8 passed) |
| City datasets | `npm run data` writes `public/data/` from `city_build_snapshot` (the Supabase URL and anon key, `LOCAL_DATABASE_URL`, or `DATA_SOURCE=seed`; see [docs/filters.md](docs/filters.md)). `npm run data -- --export-seed` rewrites the committed synthetic snapshots after a seed change | Verified (P4-01, P4-02) |
| Edge Functions | `npx supabase start` (full stack, about 2 GB), then `npx supabase functions serve click --no-verify-jwt --env-file <file with ALLOWED_ORIGINS=http://localhost:3100>`; the handler logic is unit-tested without Deno (`tests/unit/click-handler.test.ts`) | Run by hand once (P6-03, 5 Oct 2026) |
| Admin e2e | `npm run test:admin` runs `tests/admin/admin.spec.ts` against the **disposable test stack** (`node scripts/test-stack.mts start`, the full stack, about 2 GB). Run `node scripts/test-stack.mts reset` first (the spec deletes `admin_user` rows, changes data, and stops at its first failure), and do not run `npm run test:db` at the same time. Its global setup starts the Edge Functions and stand-ins for GitHub and Cloudflare `siteverify`; the functions log is written to `%TEMP%/admin-e2e-functions.log`. Not in CI | Verified (see docs/progress.md for the latest count) |
| Pipeline tests | From `code/`, `pip install -r scripts/requirements.txt`, then `python -m pytest scripts/pilot/tests` (pilot scripts, no network) and `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres python -m pytest scripts/pipeline/tests` (the test stack; database tests skip without the variable and refuse any other database). Scheduled runs: `python -m scripts.pipeline.cli sync\|linkcheck\|monitor` with `PIPELINE_DATABASE_URL` | Verified (7 Oct 2026; 89 passed) |
| Backup drill | `node scripts/backup-drill.mts backup` (main stack, read only: full dump plus every Storage file with its SHA-256), then on a fresh test stack `restore --from <dir>` and `verify --from <dir> [--sign-in <admin>]` (content hashes, grants, policies, visibility, foreign keys, files, logo records, Auth sign-in with MFA). Runbook: [docs/backup-restore.md](docs/backup-restore.md) | Verified locally (8 Oct 2026); not on a hosted project |
| Full e2e, recorded | `node scripts/e2e-full-run.mts --detach [--workers 2]`: the whole e2e suite in a background process, with its console log, per-test progress, resources and summary kept in the git-ignored `.local-test-runs/` (`summarize <folder>` re-derives the summary). On Windows it keeps the machine awake for the run, and the summary flags any suspension. Lid open, mains power, otherwise idle ([docs/testing.md](docs/testing.md)) | Recording, keep-awake and suspension flags verified (9 Oct 2026). **`--detach` not verified:** its first full run was ended by a Ctrl+C from an unknown source; start long runs with PowerShell `Start-Process -WindowStyle Hidden` (macOS: `nohup caffeinate -dims node scripts/e2e-full-run.mts … &`, not verified) until that is explained |
| Size budgets | `tests/e2e/budgets.spec.ts` (part of `npm run test:e2e`): the explorer's gzipped JavaScript against the D-12 target of 650 KB (ADR-0020), failing above a 600 KB ceiling (today's size plus headroom; lower it as the app gets lighter); the plan's 350 KB is reported. The city-selection page has its own 150 KB budget (the scripts its HTML loads; proposal). Client schemas import `zod/mini`, never `zod` (the full entry adds about 100 KB gzipped) | Verified (P9-12, 8 Oct 2026): explorer 566 KB, city selection 134 KB |
| Deployment smoke suite | `EXPECT_DEPLOY_TARGET=<production\|staging\|staging-synthetic> node scripts/smoke-local.mts` serves `out/` and runs `tests/smoke` against it (before a deploy); `PLAYWRIGHT_BASE_URL=<site> EXPECT_DEPLOY_TARGET=… npx playwright test --config playwright.smoke.config.ts` checks a deployed site. Expectations come from the site's own manifest and data | Verified locally (9 Oct 2026): synthetic and real-data staging builds |
| Device tooling | `npx playwright test --config playwright.cdp.config.ts` checks the Android attach mode against a stand-in Chrome; `tests/e2e/gate-runner.spec.ts` (in `npm run test:e2e`) runs the in-page gate runner briefly (`?cycles=2`) | Verified (9 Oct 2026) |
| Launch gate | `node scripts/launch-gate.mts [--city bangalore] [--out docs/launch-gate-report.md]` judges the datasets in `public/data/` against the city thresholds in `lib/launch-gate.ts`; exit 1 on a failing city. A synthetic build always fails | Verified on the synthetic sample (P9-04) |
| Local DB (main) | `npx supabase start -x studio,imgproxy,vector,logflare,realtime,pgadmin-schema-diff,migra,postgres-meta` (the main stack, which holds the pilot drafts). Stop it with plain `npx supabase stop` (keeps its data; never `--no-backup`). **Never `db reset` or `test db` it**; tests use the test stack above. Needs Docker running | Verified |

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
- Every published fact needs evidence; a change to a public fact needs reviewed evidence first; production refuses records without it ([docs/curation-guide.md](docs/curation-guide.md), ADR-0021, ADR-0022). **Exception (ADR-0022):** jobs from an employer feed a reviewer has approved are listed and updated by the pipeline with the evidence it records from that feed; held changes wait for a person.
- OSM licensing and coordinate accuracy are separate: ODbL data may be published when its terms are met (the owner decides); every point must be accurate whatever its source.
- Treat target dates as proposals, not commitments.
