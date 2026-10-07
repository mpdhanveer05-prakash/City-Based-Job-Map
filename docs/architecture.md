# Architecture

This is a summary. The full rationale is in the [architecture plan](../Company%20Map%20—%20Architecture%20&%20Implementation%20Plan.md). Hosting follows **[ADR-0006](decisions/0006-free-tier-static-hosting.md)** and **[ADR-0007](decisions/0007-workers-static-assets.md)** (30 Sep 2026): a static site served as Cloudflare Workers static assets (Cloudflare's successor to Pages), and the backend in Supabase. It replaces the plan's Workers + OpenNext design. The spending rule is amended by **[ADR-0018](decisions/0018-spending-policy.md)** (6 Oct 2026): free by default, and justified production spending only with an owner-approved proposal.

## Components
| Component | Technology | Responsibility |
| --- | --- | --- |
| Web app | Next.js App Router, **static export** (`output: "export"`), served as **Cloudflare Workers static assets** (assets-only Worker, Free) | Prerendered public pages, the explorer (client-side), and the admin workspace (client-rendered). No server code |
| Map client | MapLibre GL JS + custom WebGL layer; Supercluster in a Web Worker (Comlink) | Rendering, clustering, animation, hit testing ([map-spec.md](map-spec.md), unchanged) |
| Explorer data | Static per-city dataset written at build: company summaries, office points, and a lazily loaded search index | Map, Grid, List, and counts, all filtered by one TypeScript mirror of `company_filter` |
| Build + deploy | GitHub Actions: `next build` reads a Supabase snapshot (anon key), then `wrangler deploy` (`--env staging` for staging) | Company pages, datasets, `sitemap.xml`, `_redirects`, and the per-page Content-Security-Policy meta tag (`scripts/inject-csp.mts`) |
| Database | Supabase Postgres + PostGIS + `pg_trgm` + FTS | Data, `company_filter` + snapshot RPCs, RLS |
| Auth | Supabase Auth | **Administrators only**, with an allowlist in `admin_user`. RLS is the only enforcement |
| Server-side functions | Supabase Edge Functions | `submit-feedback` (Turnstile + Zod + rate limit), `click` (outbound-click counter), `request-rebuild` (reviewer+ → GitHub `repository_dispatch`). These three are the only functions in `supabase/functions/`; a report re-check function is not built |
| Files | Supabase Storage: public bucket `company-logos`, private bucket `company-logos-pending` ([ADR-0024](decisions/0024-logo-storage-and-provenance.md), proposed) | Logos load **at run time** from the public bucket (`lib/data/logo.ts`); the browser builds the map's logo atlas from them. Copying logos into the build is not built |
| Light schedules | Supabase Cron (pg_cron) | `stale-sweep` (daily) and `partition-upkeep` (monthly); each records its heartbeat. The missed-run check is the hourly GitHub Action `monitor.yml` (`missed_heartbeats()`) |
| Batch jobs | Python in GitHub Actions | Feed sync, link checks, evidence checks, then a site rebuild trigger (`pipeline.yml`, every 6 h). CSV imports run in the admin (`import_commit`). Geocoding is not in the pipeline: only the local-only pilot script (`scripts/pilot/build_import.py`) geocodes, with Nominatim, for review (provider open, D-07) |
| Basemap | Geoapify vector tiles (free fallback: Protomaps PMTiles) | Tiles and style, with attribution |
| Edge protection | Turnstile + per-function rate limits in Supabase; static-asset `_headers` for the other security headers; the CSP is a meta tag in each page ([ADR-0014](decisions/0014-content-security-policy.md), `scripts/inject-csp.mts`) | Public forms, outbound beacons |

## Data flow
```mermaid
flowchart LR
  subgraph Browser
    UI[Static pages + explorer<br/>URL filter state, TS filter]
    MAP[MapLibre + custom WebGL layer]
    W[Web Worker<br/>Supercluster via Comlink]
    UI <--> MAP
    MAP <--> W
  end
  GEO[(Geoapify tiles)]
  PAGES[Cloudflare static assets<br/>HTML, city datasets, _headers, _redirects]
  subgraph Supabase
    PG[(Postgres + PostGIS + pg_trgm<br/>RLS, company_filter, snapshot RPCs)]
    AU[Auth - admins only]
    ST[Storage - company-logos, public]
    EF[Edge Functions<br/>submit-feedback, click, request-rebuild]
    CR[Cron]
  end
  subgraph GitHub Actions
    BUILD[Build + deploy<br/>next build, wrangler deploy]
    PIPE[Python pipeline<br/>feed sync, link checks, evidence checks]
  end
  EMP[Employer ATS feeds / careers pages]

  UI -- pages + data --> PAGES
  MAP -- tiles --> GEO
  UI -- feedback, click beacons --> EF
  UI -. admin session .-> AU
  UI -. admin reads/writes, RLS .-> PG
  EF --> PG
  EF -- repository_dispatch --> BUILD
  PIPE -- pipeline role --> PG
  PIPE -- fetch --> EMP
  PIPE -- on success --> BUILD
  BUILD -- snapshot, anon key --> PG
  MAP -- logos at run time --> ST
  BUILD -- deploy --> PAGES
  CR --> PG
  UI -. Apply: direct link .-> EMP
```

## Hosting and environments
- **Cloudflare assets-only Workers** (Free):
  - Production is Worker `company-map`, not deployed yet. A custom domain needs the domain's DNS on Cloudflare (D-08).
  - Staging is Worker `company-map-staging` at https://company-map-staging.company-map.workers.dev. It's `noindex` and will be built against the staging Supabase project.
  - Every production deploy needs explicit authorization.
- **Supabase projects** (Free allows 2 active): `staging` and `prod`, in the Mumbai region. Development uses the local stack (`supabase start`).
- **Freshness:** the site rebuilds after each successful pipeline run, on admin **Publish now** (debounced), and nightly. The time from a data change to live is one build plus deploy (measured in P1-06/P8-05).
- The P1-02 Workers preview (`company-map-preview`) is a feasibility artefact. It can be deleted now that the staging Worker (`company-map-staging`, Workers static assets, ADR-0007) works.

## Free-tier limits the design depends on
Checked 30 Sep 2026; full table in [ADR-0006](decisions/0006-free-tier-static-hosting.md#free-tier-validation-limits-checked-on-the-providers-pages-30-sep-2026).
- **Workers static assets:** requests free and unlimited; 20,000 files per version; 25 MiB per file; 2,000 static + 100 dynamic redirects; 100 header rules. The build guards all of these. Each prerendered page is 5 files (ADR-0007).
- **Supabase:** 500 MB database, 5 GB egress, 500,000 Edge Function invocations/month, 2 active projects, and projects pause after a week of inactivity. The public site keeps working if a project pauses.
- **GitHub Actions** is free on standard runners while the repository is public.

## Stack guardrails
No FastAPI, Celery, Redis, AWS, or Kubernetes. Any new service needs an ADR with a concrete requirement and the owner's approval. Free by default; a paid plan needs a written proposal the owner approves ([ADR-0018](decisions/0018-spending-policy.md)).
