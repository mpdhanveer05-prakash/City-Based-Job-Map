# Architecture Decision Records

Each ADR is short: context, decision, consequences, status (Proposed · Accepted · Superseded). Copy [template.md](template.md). Number them sequentially and never rewrite an accepted ADR; supersede it with a new one instead.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-stack.md) | Approved application stack | Accepted; hosting + Route Handlers superseded by 0006 |
| [0002](0002-launch-scope-two-cities.md) | Launch scope: Bengaluru and Chennai | Accepted (scope); dates resolved by 0016 |
| [0003](0003-hosting-plan-tiers.md) | Hosting plan tiers are not assumed | Superseded by 0006 (measurements kept; Paid recommendation not adopted) |
| [0004](0004-company-type-filter-model.md) | Overlapping company types and the startup-stage filter | Accepted (D-02); D-05 resolved by 0017 |
| [0005](0005-map-rendering.md) | Custom WebGL layer with Supercluster in a worker | Accepted, subject to the validation gate |
| [0006](0006-free-tier-static-hosting.md) | Free-tier hosting: Next.js static export on Cloudflare Pages, backend in Supabase | Accepted (resolves D-09); hosting target amended by 0007; spending rule amended by 0018 |
| [0007](0007-workers-static-assets.md) | Serve the static export as Workers static assets, not legacy Pages | Accepted |
| [0008](0008-basemap.md) | Basemap: Geoapify Positron, re-coloured in MapLibre | Accepted · Open (free allowance vs launch traffic, D-11) |
| [0009](0009-marker-layer-projection.md) | The marker layer projects on the CPU; the explorer camera is north-up | Accepted (implementation) · Proposed (rotation and tilt off) |
| [0010](0010-build-data-source.md) | Where the build gets its city data; keeping synthetic data out of production | Accepted (release rule to confirm) |
| [0011](0011-click-beacon.md) | How an Apply or Visit website click is counted | Accepted (retention is D-07) |
| [0012](0012-admin-workspace-and-publishing.md) | The admin workspace, its saves, the audit log, and "Publish now" | Accepted (MFA, logo upload, geocoding are owner calls) |
| [0013](0013-pipeline-and-public-feedback.md) | The data pipeline, its database role, and public reports and suggestions | Accepted (thresholds and ATS host list are proposals) |
| [0014](0014-content-security-policy.md) | Content-Security-Policy as a per-page meta tag with script hashes | Accepted |
| [0015](0015-dependency-audit-gate.md) | The dependency audit gates production dependencies; tooling findings are reported | Not accepted; superseded by 0019 |
| [0016](0016-launch-sequence-and-data-policy.md) | Launch sequence, data sourcing, founders, and the "Product" definition | Accepted |
| [0017](0017-company-status-separate-from-stage.md) | Company status is a separate field from startup stage | Accepted; implemented (P9-06) |
| [0018](0018-spending-policy.md) | Free by default; justified production spending is allowed | Accepted |
| [0019](0019-dependency-vulnerability-exceptions.md) | Vulnerability exceptions must be documented, reviewed, and time-limited | Accepted; implemented (P9-09) |
| [0020](0020-monitoring-analytics-and-owner-choices.md) | Monitoring, analytics, JavaScript budget, basemap evaluation, admin MFA, backups | Accepted |

Open decisions are listed in the [plan.md decision register](../../plan.md#open-decision-register).
