# ADR-0006: Free-tier hosting with a Next.js static export on Cloudflare Pages

- **Status:** Accepted (the owner proposed the approach and chose both options below, 30 Sep 2026). **Amended by [ADR-0007](0007-workers-static-assets.md):** Cloudflare has folded Pages into Workers, so the export is served as an assets-only Worker. The file-count estimate below is corrected there.
- **Date:** 2026-09-30
- **Supersedes:** the ADR-0003 recommendation (Workers Paid), and in [ADR-0001](0001-stack.md) the items "Cloudflare Workers via `@opennextjs/cloudflare`" and "Route Handlers"
- **Related:** D-09 (resolved by this ADR), P1-02, P1-03, P1-06, [ADR-0005](0005-map-rendering.md) (unchanged)

## Context
P1-02 measured the skeleton on Workers Free. A prerendered page used 5 ms of CPU at the median, but a server-rendered page used **38 ms** against a **10 ms** Free limit ([ADR-0003](0003-hosting-plan-tiers.md#measurements-p1-02-30-sep-2026)). Company pages were meant to be server-rendered, so ADR-0003 recommended Workers Paid. The owner doesn't want paid plans and asked for a design that stays on free tiers without hurting usability.

The product suits static hosting. There's no public login and nothing per-visitor, and the data changes on a pipeline schedule, not per request. The map is entirely client-side.

## Decision
1. **Hosting:** the Next.js app is built with `output: "export"` and served by **Cloudflare Pages (Free)** for both staging and production. Nothing renders on a server at request time.
2. **Deploys:** GitHub Actions builds the site and uploads it with `wrangler pages deploy` (Direct Upload). Pages' own Git builds are capped at 500 per month; Direct Upload doesn't use Cloudflare's build system. Production is the `main` branch; staging is a `--branch staging` deployment at `staging.<project>.pages.dev`.
3. **Backend:** all server-side work moves from Next.js Route Handlers to **Supabase**:
   - Postgres functions (RPC) with RLS for reads and admin writes.
   - Edge Functions for anything that needs a secret or has to sit in front of a write: Turnstile check, feedback, click counting, and the rebuild trigger.
   - The Next.js app contains **no Route Handlers that read the request, no Server Actions, no `proxy`, and no secrets**.
4. **Explorer data (owner's choice):** each build writes a **static dataset per city**: company summaries, office points, and a search index, generated from the SQL `company_filter` path. The browser filters it with **one shared TypeScript filter** (`lib/filters/`). Map, Grid, List, and every count use that one function over that one dataset. CI proves the TypeScript filter returns exactly the same company IDs as the SQL function over the filter matrix.
5. **Outbound links (owner's choice):**
   - Apply and Visit website are **direct links** to the employer URL, validated at build time (`https`, company domain or a known ATS host).
   - A click sends a `navigator.sendBeacon` to the `click` Edge Function, which increments a daily counter. It carries no IP address and no identifier.
   - The `/go/*` redirects are dropped.
6. **Supabase projects:** Free allows **2 active projects**, so the cloud projects are **staging** and **prod**. Development uses the local Supabase stack (Docker).
7. **Everything else is unchanged.** The full map implementation, the design system, the data model, RLS, the Python pipeline, and the testing standards all stay. See [ADR-0005](0005-map-rendering.md) and [map-spec.md](../map-spec.md).

## Where each job runs
| Concern | Before (Workers + OpenNext) | Now |
| --- | --- | --- |
| Public pages (`/`, `/{city}`, `/companies/{slug}`, `/companies/{slug}/jobs`) | Server-rendered per request | Prerendered at build (`generateStaticParams`), served as static files |
| City points, list, facets, search | `GET /api/v1/...`, then Postgres | Static `data/{city}` files, filtered in the browser. SQL `company_filter` generates them and CI checks the parity |
| Apply / Visit website | `/go/job/{id}` 302 + log | Direct link + `click` Edge Function beacon |
| Old-slug redirects, `/bengaluru` → `/bangalore` | Route logic | Pages `_redirects`, generated from `slug_redirect` at build |
| Feedback (reports, suggestions) | Route Handler + Turnstile | `submit-feedback` Edge Function: Turnstile `siteverify`, Zod, rate limit, insert |
| Admin workspace | Server-checked Route Handlers / Server Actions | Client-rendered `/admin` pages using Supabase Auth. **RLS and SECURITY INVOKER RPCs are the only enforcement** (the admin bundle is public JavaScript) |
| Publish → site update | Cache purge | `request-rebuild` Edge Function (reviewer+) → GitHub `repository_dispatch` → build + deploy |
| Security headers, CSP, caching | Worker | Pages `_headers` |

## How company pages are generated, updated, and indexed

**Generated (each build):**
1. The build reads published data from Supabase with the **anon key**, so RLS guarantees only published rows appear. It makes one bulk RPC per city (`city_build_snapshot(city)`), not one query per company.
2. `generateStaticParams` builds one page per published company (`/companies/{slug}`) and one jobs page per company (`/companies/{slug}/jobs`). The jobs page may be merged into the company page if the file count gets tight.
3. The same snapshot produces the city datasets, the map logo atlas pages, `_redirects`, `sitemap.xml`, and `robots.txt`. All pages and datasets carry one `data_version` (the snapshot ID), so pages, map, and list always agree.
4. Validation fails the build rather than publishing bad output: any job URL that isn't `https` or doesn't pass the domain check, a missing slug, or a file count over the guard.

**Updated:**
- A rebuild and deploy runs:
  - after each successful pipeline run (feed sync every 6 h, link check daily);
  - after an admin presses **Publish now** (`request-rebuild`, debounced to at most one build per 10 min);
  - **nightly** as a safety net.
- The expected lag from a data change to the live site is one build plus deploy (to be measured in P1-06). Direct Upload sends only changed files.
- A **removed** company disappears from the next build. Its URL gets the branded 404 page (the export includes `404.html`, so Pages doesn't fall back to single-page mode).
- A **renamed** company gets a static `_redirects` line from each old slug (the limit is 2,000).
- Freshness text ("Jobs checked 3 h ago") is computed **in the browser** from the absolute `last_checked_at` in the page, so it stays true between builds.

**Indexed:**
- `app/sitemap.ts` lists the city pages and every company page with `lastModified = company.updated_at`. `app/robots.ts` points to it. Production's sitemap is submitted in Google Search Console.
- Each page sets `metadataBase`, a canonical URL, a title and description built from real company data, and `Organization` JSON-LD.
- **No `JobPosting` markup.** Rows show only a title, and Google's job-posting data requires a description; revisit if descriptions are added.
- **Staging is never indexed.** Staging builds (`SITE_ENV=staging`) emit `robots.txt` `Disallow: /` and a `noindex` meta tag.

## Free-tier validation (limits checked on the providers' pages, 30 Sep 2026)
| Service and limit | Our expected use | Result |
| --- | --- | --- |
| Pages: static requests "free and unlimited" (Workers static assets billing page); preview deployments unlimited | All public page, data, and asset requests | Fits |
| Pages: 20,000 files per site | ~~About 8,200~~. **Corrected in ADR-0007** after measuring: 5 files per prerendered page, about 17,650 with separate jobs pages, about 9,650 with jobs on the company page (D-10) | Fits; the margin depends on D-10. A CI guard fails the build at 18,000 |
| Pages: 25 MiB per file | Largest expected is the city dataset, a few hundred KB | Fits. CI guard |
| Pages: `_redirects` 2,000 static + 100 dynamic; `_headers` 100 rules | A few hundred old slugs; under 10 header rules | Fits. CI guard |
| Pages: 500 builds/month, 1 concurrent, 20 min timeout | Not used: builds run in GitHub Actions. **Unverified:** whether Direct Upload deploys count toward the 500. P1-06 checks the dashboard after the first deploys | To verify |
| Supabase Free: 500 MB database | Two cities of companies, offices, jobs, and check history (partitioned; old checks pruned) | Fits; to be measured in P3 |
| Supabase Free: 5 GB egress (+5 GB cached) | Builds (a few snapshot reads per day), admin sessions, beacons. Visitors don't call Supabase | Fits |
| Supabase Free: 500,000 Edge Function invocations/month | Click beacons, feedback, rebuild requests | Fits (about 16,000/day of headroom) |
| Supabase Free: 50,000 MAU | Admins only | Fits |
| Supabase Free: 2 active projects | staging + prod; dev runs locally | Fits |
| Supabase Free: "paused after 1 week of inactivity" | The pipeline writes to prod several times a day. If a project did pause, the public site would keep working (static); only feedback, beacons, admin, and rebuilds would stop | Acceptable; the missed-run alert (P8-03) catches it |
| GitHub Actions | CI, builds, deploys, pipeline | Free on standard runners **while the repository is public** |
| Cloudflare Turnstile | Feedback forms | Free |

Still to verify:
- ~~Geoapify's free allowance~~ Checked in P1-05 (1 Oct 2026): 3,000 credits a day, 0.25 per tile, so about 100 to 500 sessions a day. See [ADR-0008](0008-basemap.md) and D-11.
- Build time with real data (P1-06, then P4).
- What backups Supabase Free includes (P9-04).

## Consequences
- **Usability:**
  - Page speed and SEO are as good as or better than server rendering.
  - The map is unaffected.
  - Data freshness is bounded by the rebuild schedule instead of being instant.
  - Search runs in the browser from a lazily loaded index.
- **Validation moves** from Route Handler Zod checks to Postgres constraints and function argument checks, plus Zod inside Edge Functions.
- **No Cloudflare WAF in front of Supabase.** Feedback abuse protection is Turnstile, single-use tokens, and a per-function rate limit keyed on a salted, daily-rotated hash (proposal; no raw IP is stored).
- **P1-02's OpenNext setup is replaced** in P1-06. Its measurements remain the evidence for this ADR. The `company-map-preview` Worker can be deleted once Pages staging works (owner's call).
- **Platform direction:** Cloudflare's docs steer new projects toward Workers, but Pages isn't deprecated. If it ever is, the same `out/` folder deploys to Workers Static Assets, which are also free and unlimited, with no code change.
- **File-count growth:** more cities (Phase 10) push toward 20,000 files. The options, in order: merge the jobs page into the company page, move logos into atlas pages only, split cities into separate Pages projects.

## Sources (checked 2026-09-30)
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Workers static assets billing: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Pages Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Pages vs Workers: https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- Supabase pricing: https://supabase.com/pricing
- Next.js 16 static exports: `code/node_modules/next/dist/docs/01-app/02-guides/static-exports.md` (unsupported features list)
- Vercel Hobby (rejected: "non-commercial, personal use only"): https://vercel.com/docs/plans/hobby
