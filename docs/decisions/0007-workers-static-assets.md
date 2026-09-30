# ADR-0007: Serve the static export as Workers static assets, not legacy Pages

- **Status:** Accepted (owner's choice, 30 Sep 2026)
- **Date:** 2026-09-30
- **Amends:** [ADR-0006](0006-free-tier-static-hosting.md) decision 1–2 (hosting target and deploy command). Everything else in ADR-0006 stands.
- **Related:** P1-06, D-08 (domain), D-10 (company/jobs page layout)

## Context
Creating the Pages project for ADR-0006 failed. Wrangler 4.144.0 answered `wrangler pages project create` with "Delegating to the latest version of Cloudflare Pages, now part of Cloudflare Workers". The old Pages product ("the previous version of Cloudflare Pages") is reachable only with `--force`. Cloudflare's Pages docs now carry the banner: "Workers supports most Pages use cases and offers a broader feature set. It is Cloudflare's primary platform for building applications. Start new projects with Workers." Nothing was created or deployed by the failed attempts.

## Decision
- Serve `out/` as an **assets-only Worker**: `wrangler.jsonc` has `assets.directory: ./out`, `not_found_handling: "404-page"`, `html_handling: "auto-trailing-slash"`, and **no `main` script**. Requests are free, unlimited, and use no CPU.
- **Production:** Worker `company-map` (not deployed yet; needs explicit authorization).
- **Staging:** Worker `company-map-staging` (`wrangler deploy --env staging`), at https://company-map-staging.company-map.workers.dev.
- Legacy Pages (`--force`) is rejected because it's the product Cloudflare is moving away from.

## Limits (checked 2026-09-30) and measurements
| Limit (Workers Free, static assets) | Value | Source |
| --- | --- | --- |
| Files per Worker version | 20,000 | developers.cloudflare.com/workers/platform/limits |
| File size | 25 MiB | same |
| `_redirects` | 2,000 static + 100 dynamic | developers.cloudflare.com/workers/static-assets/redirects |
| `_headers` | 100 rules, 2,000 characters per line | developers.cloudflare.com/workers/static-assets/headers |
| Missing paths with `404-page` | nearest `404.html`, **status 404** | developers.cloudflare.com/workers/static-assets/routing/static-site-generation |
| Asset requests | "free and unlimited" | developers.cloudflare.com/workers/static-assets/billing-and-limitations |

**Measured output of the Next.js 16 static export** (a probe build with 10 dynamic company routes, since removed):
- One prerendered page produces **5 files**: the `.html`, a `.txt` RSC payload, and three segment-prefetch files. It also produces 3–4 directories.
- A company with a company page **and** a jobs page produces **10 files**.
- Wrangler's "Read N files" line counts directories too. The upload counts only files (38 assets = 39 files minus `_headers`), so the limit guard counts files.

**Corrected estimate** (ADR-0006 said about 8,200 files, which was wrong):

| Layout for ~1,600 companies (2 cities) | Files |
| --- | --- |
| Separate `/companies/{slug}` + `/companies/{slug}/jobs` | about 16,000 + ~1,600 logos + ~40 ≈ **17,650**. Fits under 20,000 but trips the 18,000 guard with little growth |
| Jobs listed on the company page (`View jobs` jumps to `#jobs`) | about 8,000 + ~1,600 + ~40 ≈ **9,650** |

**D-10, decided 30 Sep 2026 by the owner:** use **Option A** (separate jobs pages) now. **Option B** is kept ready as plan task P6-04. `postbuild` warns above **15,000** files (the switch signal) and fails above 18,000.

**Staging validation (30 Sep 2026):**
- Deployed version `408ad6a9-a8d2-486a-acf9-58f2620796b2`: 39 files, largest 223.8 KiB, Worker upload 0.31 KiB.
- `/` 200, `/dev/tokens` 200, `/robots.txt` = `Disallow: /`, unknown path **404**, security headers present.
- Playwright e2e + axe against the live URL: **19 passed, 1 skipped** (keyboard focus runs on desktop only).

## Consequences
- **Custom domain (D-08):** a Worker custom domain needs the domain's DNS on Cloudflare (free plan). Pages could attach a domain hosted elsewhere; Workers can't.
- The staging deploy workflow uses `wrangler deploy --env staging`. Its API token needs **Account → Workers Scripts: Edit**.
- The P1-02 feasibility Worker `company-map-preview` still exists (the owner chose to keep it for now).
