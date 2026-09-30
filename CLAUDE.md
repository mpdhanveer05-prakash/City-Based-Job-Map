# CLAUDE.md — Company Map

Primary instruction file for Claude Code. Keep it short; details live in the linked docs.

## Before you start any work

1. Read [plan.md](plan.md) and [docs/progress.md](docs/progress.md). Work on the task marked **In progress**, or the first **Not started** task whose dependencies are **Completed**.
2. Read the docs the task links to (map work → [docs/map-spec.md](docs/map-spec.md), database → [docs/data-model.md](docs/data-model.md), etc.).
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

**User journey:** city selection → company explorer → company details → company jobs → external application (the employer's site, through the `/go/job/{id}` redirect).

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

## Approved stack

Next.js App Router · React · TypeScript · Tailwind CSS · shadcn/ui · MapLibre GL JS · Supercluster (the only company-point clustering engine; MapLibre's built-in clustering stays off) · Web Worker + Comlink · custom WebGL layer · Geoapify basemap (Protomaps PMTiles on R2 later) · TanStack Query · URL filter state · TanStack Virtual · Dexie.js (later) · Route Handlers + selected Supabase Edge Functions · Supabase Postgres + PostGIS + `pg_trgm` + full-text search · Supabase CLI migrations · Supabase Auth (admins only) · Supabase Storage · Python in GitHub Actions · Supabase Cron · Cloudflare Turnstile (verified on the server) · Cloudflare Workers via `@opennextjs/cloudflare` · Vitest · Playwright · axe-core · GitHub Actions CI.

**Don't add** FastAPI, Celery, Redis, AWS, Kubernetes, or any other service unless an ADR documents a concrete requirement for it. Don't assume Workers Paid, an R2 cache, or Supabase Pro is mandatory. See [ADR-0003](docs/decisions/0003-hosting-plan-tiers.md) for the evidence.

## Repository structure (target, created in task P1-01)

```
app/                 Next.js routes: (public)/, admin/, api/v1/, go/
components/          ui/ (shadcn), explorer/, company/, admin/
lib/                 filters/ (URL state + schema), api/, supabase/ (server|browser clients)
map/                 layer/ (WebGL), worker/ (Supercluster + Comlink), animation/, hit-test/, atlas/
supabase/            migrations/, seed/, functions/, tests/ (SQL/RLS tests)
scripts/             Python pipeline (imports, feed sync, link checks)
tests/               unit/ (Vitest), e2e/ (Playwright), a11y/
docs/                specs, ADRs, progress
```

## Conventions

- TypeScript `strict`. No `any` unless there's a comment justifying it. Validate every external input with Zod at the Route Handler boundary.
- Filter state lives in the URL, parsed by one schema in `lib/filters/`. Components never read `searchParams` directly.
- Search, filter, and count logic lives in Postgres functions. The map points, the Grid/List results, and the facets all call the same SQL filter.
- Schema changes go only through new files in `supabase/migrations/`. Never edit an applied migration.
- Use kebab-case file names and PascalCase component names. Keep map rendering code free of React.
- Keep commits small and scoped to one plan task ID (for example `P2-03: …`).

## Commands

The commands below are **unverified**: no `package.json` exists yet. Task P1-01 verifies them and updates this section.

| Purpose | Command (planned) |
| --- | --- |
| Install | `npm ci` |
| Dev server | `npm run dev` |
| Lint / types | `npm run lint` · `npm run typecheck` |
| Unit tests | `npm test` (Vitest) |
| E2E + a11y | `npm run test:e2e` (Playwright + axe) |
| Workers preview | `npm run preview` (OpenNext build + `wrangler dev`) |
| Local DB | `supabase start` · `supabase db reset` · `supabase test db` |

## Security (see [docs/security.md](docs/security.md))

- **Never commit credentials.** Only `.env.example`, containing placeholders, goes in git.
- **Never expose the Supabase service-role/secret key to the browser.** Nothing prefixed `NEXT_PUBLIC_` may be privileged. Server-only modules import `server-only`.
- Enable RLS on every table in `public`, and test it with the anon and authenticated roles.
- Verify Turnstile on the server before any feedback insert.
- Apply URLs must be `https` and must pass the domain check. Open them with `rel="noopener noreferrer"`.

## Testing, accessibility, and done

- **Never claim tests passed unless you ran them in this session.** Quote the command and the result. List blockers, skipped checks, and unverified assumptions explicitly.
- WCAG 2.2 AA: every map company is also reachable in List view, focus is visible, touch targets are at least 44 px, and `prefers-reduced-motion` is respected.
- A task is **done** when its acceptance criteria are met, its listed tests exist and pass locally (lint, typecheck, and unit at minimum), and `plan.md` and `docs/progress.md` are updated. See [docs/testing.md](docs/testing.md).

## Hard rules

- Don't change the approved scope, stack, or cities silently. Propose the change in an ADR and ask.
- Don't deploy anything publicly (a production Worker, a public DNS record, a public Supabase project) without explicit authorization. Preview deploys only when the task says so.
- Don't invent data: no fake verification dates, logos, founders, or jobs presented as real. Synthetic data must be labelled synthetic.
- Treat target dates as proposals, not commitments.
