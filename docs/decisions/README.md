# Architecture Decision Records

Each ADR is short: context, decision, consequences, status (Proposed · Accepted · Superseded). Copy [template.md](template.md). Number them sequentially and never rewrite an accepted ADR; supersede it with a new one instead.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-stack.md) | Approved application stack | Accepted; hosting + Route Handlers superseded by 0006 |
| [0002](0002-launch-scope-two-cities.md) | Launch scope: Bengaluru and Chennai | Accepted (scope) · Open (dates, D-01) |
| [0003](0003-hosting-plan-tiers.md) | Hosting plan tiers are not assumed | Superseded by 0006 (measurements kept; Paid recommendation not adopted) |
| [0004](0004-company-type-filter-model.md) | Overlapping company types and the startup-stage filter | Proposed (D-02, D-05) |
| [0005](0005-map-rendering.md) | Custom WebGL layer with Supercluster in a worker | Accepted, subject to the validation gate |
| [0006](0006-free-tier-static-hosting.md) | Free-tier hosting: Next.js static export on Cloudflare Pages, backend in Supabase | Accepted (resolves D-09); hosting target amended by 0007 |
| [0007](0007-workers-static-assets.md) | Serve the static export as Workers static assets, not legacy Pages | Accepted |
| [0008](0008-basemap.md) | Basemap: Geoapify Positron, re-coloured in MapLibre | Accepted · Open (free allowance vs launch traffic, D-11) |

Open decisions are listed in the [plan.md decision register](../../plan.md#open-decision-register).
