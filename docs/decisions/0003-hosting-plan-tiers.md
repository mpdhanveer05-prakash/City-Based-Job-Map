# ADR-0003: Hosting plan tiers are not assumed

- **Status:** Superseded by [ADR-0006](0006-free-tier-static-hosting.md). The measurements below are kept as its evidence; the Workers Paid recommendation was **not** adopted (the owner chose free tiers only).
- **Date:** 2026-09-30
- **Related:** P1-02, D-09, [ADR-0001](0001-stack.md)

## Context
The plan states that Workers Paid is needed from the first deploy (because of script size), that an R2 bucket is needed at launch for the OpenNext cache, and that production runs on Supabase Pro. The brief says not to assume any of these without evidence.

## Evidence (limits re-checked 2026-09-30, the day P1-02 ran)
| Claim | Finding | Source |
| --- | --- | --- |
| Worker script-size limit forces Paid | **No.** Both Free and Paid allow **64 MiB uncompressed**, with no compressed limit. The plan's script-size reasoning is outdated. | https://developers.cloudflare.com/workers/platform/limits/ |
| Free-plan constraint | Free: **10 ms CPU per request**, 100,000 requests/day, 50 subrequests. Paid: 30 s default CPU (up to 5 min), no daily limit. Both: 128 MB memory and 1 s startup. Time spent waiting on network I/O (fetch, database) does not count as CPU. | same |
| Adapter | `@opennextjs/cloudflare` 1.20.7. Supports all Next.js 16 minors (peer range `>=16.3.6`). **Node Middleware is not supported**; the Node.js runtime is required (not Edge). | https://opennext.js.org/cloudflare |
| R2 cache mandatory | **No.** Static-only pages use the read-only `staticAssetsIncrementalCache` (served from Workers Static Assets, no revalidation). R2 is needed only if ISR or revalidation is adopted. | https://opennext.js.org/cloudflare/caching |
| Supabase Pro | Free projects pause when idle and have lower quotas (500 MB DB, 5 GB egress, 1 GB storage). Pro prevents pausing and unlocks PITR and add-ons. Pausing a *production* database is unacceptable, so Pro is likely needed at launch, but it's a cost decision for the owner. | https://supabase.com/docs/guides/platform/billing-on-supabase |

## Measurements (P1-02, 30 Sep 2026)
Build: Next.js 16.3.7, @opennextjs/cloudflare 1.20.7, wrangler 4.144.0, compatibility date 2026-09-26. The build ran on Windows 11, which OpenNext warns is "not fully compatible"; the result still passed every check below.

| Measure | Result | How |
| --- | --- | --- |
| Worker bundle | **4,945.58 KiB uncompressed, 1,036.29 KiB gzip** (7.5% of the 64 MiB limit) | `wrangler deploy` output |
| Static assets | 24 files, about 0.8 MB | same |
| Startup time on Cloudflare | **22 ms** (limit 1,000 ms) | `wrangler deploy` "Worker Startup Time". Locally, `wrangler check startup` showed 103 ms of active CPU |
| Preview URL | https://company-map-preview.company-map.workers.dev: `/` 200, `/dev/tokens` 200, unknown path 404, `/_next/static/*` served `immutable` | curl, 60 requests |
| Test suite against the Worker runtime | Playwright e2e + axe: 11 passed, 1 skipped (desktop-only focus test) | `PLAYWRIGHT_BASE_URL=http://localhost:8787` under `wrangler dev` |

**CPU time per request on Cloudflare** (`wrangler tail --format json`, 63 requests, all outcome `ok`):

| Path | Rendering | n | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| `/` | Prerendered, served from the static-assets cache | 22 | **5 ms** | 14 ms | 14 ms |
| `/dev/tokens` | Server-rendered per request (a palette page with about 40 table rows, standing in for a company page) | 20 | **38 ms** | 259 ms | 267 ms |
| `/nope` | 404 through the server | 20 | 11 ms | 161 ms | 166 ms |

Caveats: the sample is small. The requests were spread across seven data centres (HKG, SIN, MRS, KIX, NRT, MXP, SEA), probably because of how the office network routes traffic, so many landed on a cold isolate. The 100–270 ms spikes are consistent with that. Users in India would mostly hit a warm BOM or MAA isolate. No Supabase call was involved yet; database waits won't add CPU time, but JSON parsing and rendering the results will.

## Decision (proposed)
1. **Workers Paid for staging and production.** A server-rendered page already takes **38 ms of CPU at the median**, nearly 4× the Free limit, before any data is added. Public company pages are server-rendered for SEO (plan). On Free, a request that goes over the CPU limit can be terminated ("exceeded resource limits", error 1102). None of the 63 requests was cut off today, but that tolerance isn't a documented guarantee to build on. This lands where the plan did, but because of **CPU time, not script size**.
2. **The Free plan is fine for preview Workers** while there's no real traffic. The `company-map-preview` Worker stays on Free.
3. **No R2 bucket and no OpenNext incremental store at launch** unless ISR is adopted. Prerendered pages use `staticAssetsIncrementalCache`. Dynamic pages set cache headers and rely on the Cloudflare cache.
4. **Build and deploy from Linux (GitHub Actions) for staging and production**, not from a Windows laptop, because of OpenNext's Windows warning. The laptop is fine for local previews.
5. **Supabase plan:** still open under D-09, measured once real data exists (P3).

## Consequences
- The Workers Paid subscription (priced on Cloudflare's pricing page; check it on the day) is needed before staging goes live. D-09 records the owner's decision.
- P9-03 re-runs these CPU measurements with real data, from India, on the Paid plan.
- If ISR is adopted later, a new ADR adds the R2 incremental cache and its cost.
