# ADR-0003: Hosting plan tiers are not assumed

- **Status:** Proposed. To be finalised in P1-02 with measurements.
- **Date:** 2026-09-30

## Context
The plan states that Workers Paid is needed from the first deploy (because of script size), that an R2 bucket is needed at launch for the OpenNext cache, and that production runs on Supabase Pro. The brief says not to assume any of these without evidence.

## Evidence (checked 2026-09-30)
| Claim | Finding | Source |
| --- | --- | --- |
| Worker script-size limit forces Paid | The docs currently list **64 MiB uncompressed for both Free and Paid**, with no compressed limit. The plan's script-size reasoning looks outdated. | https://developers.cloudflare.com/workers/platform/limits/ |
| Free-plan constraint | Free: **10 ms CPU per request** and 100,000 requests/day. Paid: 30 s default CPU (up to 5 min), no daily limit. SSR CPU time is the more likely reason to need Paid. | same |
| Adapter | `@opennextjs/cloudflare`. Supports Next.js 16 and the latest minors of 14 and 15. **Node Middleware is not supported**, and the Node.js runtime (not Edge) is required. | https://opennext.js.org/cloudflare |
| R2 cache mandatory | **No.** An incremental cache is needed only for SSG/ISR and the data cache. SSR works without one. If ISR is used, R2 is recommended (KV isn't recommended; static assets can't revalidate). | https://opennext.js.org/cloudflare/caching |
| Supabase Pro | Free projects pause when idle and have lower quotas (500 MB DB, 5 GB egress, 1 GB storage). Pro prevents pausing and unlocks PITR and add-ons. Pausing a *production* database is unacceptable, so Pro is likely needed at launch, but that's a cost decision for the owner. | https://supabase.com/docs/guides/platform/billing-on-supabase |

Limits change often. Re-check on the day P1-02 runs, and update this table.

## Decision (proposed)
Develop on free tiers. In P1-02, measure SSR CPU time and bundle size, then decide on Workers Paid. Use no OpenNext incremental cache unless ISR is adopted. Supabase plan for production is decided under D-09.
