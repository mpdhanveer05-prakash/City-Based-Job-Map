# Progress

Update this after every task: what changed, how it was verified (the commands actually run and their results), what's unverified, blockers, and the next action.

## Current state
- **Current task:** P1-03 Supabase local setup (In progress). Then P1-05 (the Geoapify key is in `code/.env.local`) and P2-01.
- **Next action:** P1-02 needs a Cloudflare account and authorization for a preview deploy. P1-03 needs the Supabase CLI and Docker, plus a Supabase `dev` project. See the P1-01 entry.
- **Blockers:** none for code work. For product decisions, see the decision register (D-01…D-09).

## Log

### 2026-09-30: D-10 decided (Option A, with Option B on standby)
- **Decision (owner):** separate `/companies/{slug}/jobs` pages now (about 10 files per company). Option B (jobs as a `#jobs` section of the company page, about 5 files per company) is kept ready as plan task **P6-04**, used only when triggered.
- **Early warning:** `scripts/check-static-limits.mts` now warns (without failing) above **15,000** files, pointing to P6-04. It still fails above 18,000. `checkOutput` accepts custom limits for testing.
- **Verified:** `npm test`: **45 passed** (a new warn-vs-fail test). Lint and `tsc --noEmit` clean.
- **Deploy staging workflow verified (run by the owner, 2026-09-30 18:04 UTC, commit `687cd3e`):** with the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID` added, the workflow ran `npm ci` (0 vulnerabilities), built (39 files), deployed `company-map-staging` version `ebbd8ae8-3e28-4cdc-9dee-4cccaf88fb8d`, and the post-deploy smoke test passed **10/10** (desktop project) against the live URL. The owner also supplied a Geoapify key (stored only in the git-ignored `code/.env.local`; a style request returned HTTP 200) and started Docker Desktop (server 29.4.0).

### 2026-09-30: P1-06 completed on Workers static assets (ADR-0007)
- **Platform change found:** `wrangler pages project create` answered "Delegating to the latest version of Cloudflare Pages, now part of Cloudflare Workers" and failed, with nothing created. Legacy Pages needs `--force`. Cloudflare's Pages docs say "Start new projects with Workers". The owner chose **Workers static assets** (an assets-only Worker), recorded in [ADR-0007](decisions/0007-workers-static-assets.md).
- **Changed:** `wrangler.jsonc` is now an assets-only Worker (`./out`, `404-page`, `env.staging` → `company-map-staging`). The scripts are `preview` = `wrangler dev`, `deploy:staging` = `wrangler deploy --env staging`. Playwright serves through `wrangler dev`. The deploy workflow uses `wrangler deploy --env staging`, and its token needs Workers Scripts: Edit. The basemap ADR is renumbered to 0008. A new decision **D-10** is in the register.
- **Measured (probe build, removed afterwards):** a prerendered page is **5 files** plus 3–4 directories, so a company with separate company and jobs pages is 10 files. The corrected 2-city estimate is about 17,650 files with separate jobs pages, or about 9,650 with jobs on the company page. ADR-0006's "~8,200" is corrected in ADR-0007. Wrangler's "Read N files" includes directories; the upload counts files only.
- **Staging deploy (owner approved):** https://company-map-staging.company-map.workers.dev, version `408ad6a9-a8d2-486a-acf9-58f2620796b2`. 39 files; Worker upload 0.31 KiB (no script).
- **Verified in this session:**
  - Live staging: `/` 200, `/dev/tokens` 200, `/robots.txt` = `Disallow: /`, `/sitemap.xml` 200, unknown path **404**, and `nosniff`, `DENY`, and referrer-policy headers present.
  - `PLAYWRIGHT_BASE_URL=<staging> npx playwright test`: **19 passed, 1 skipped**. `npm run test:e2e` against local `wrangler dev`: 19 passed, 1 skipped.
  - Lint, typecheck, and 44 unit tests pass. The production build is 33 files with no `/dev` output. All three workflow files parse.
- **Not verified:** the Deploy staging workflow on GitHub (it needs the `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets). Production isn't deployed (it needs explicit authorization later).

### 2026-09-30: D-09 resolved (ADR-0006) and P1-06 started
- **Decision:** the owner rejected paid plans and proposed Cloudflare Pages + Next.js static export for staging and production, with the backend moved to Supabase functions. They also chose **static per-city datasets** for the explorer and **direct Apply links + a click beacon**. Recorded in [ADR-0006](decisions/0006-free-tier-static-hosting.md), which supersedes the ADR-0003 recommendation and ADR-0001's hosting/Route Handler items. Free-tier limits were re-checked on the providers' pages today (the table is in ADR-0006).
- **Docs revised:** CLAUDE.md (a new "Free tiers only" section, the filter convention, security, commands), plan.md (Phase 1 gate; P1-03 local-only Supabase; new P1-06; P4-01, P5-01, P5-04, P6-01…03, P7-01/02, P8-04; new P8-05; D-09 resolved; the basemap ADR renumbered to 0007), architecture.md (rewritten), security.md, data-model.md (`city_build_snapshot`, `link_click_daily`), data-pipeline.md, testing.md, map-spec.md §3, and the ADR index. The map specification is otherwise unchanged.
- **P1-06 code (in `code/`):**
  - `output: "export"`. Removed `@opennextjs/cloudflare`, the `esbuild` pin, `open-next.config.ts`, and the Worker config. `wrangler.jsonc` is now a Pages config (`pages_build_output_dir: ./out`).
  - `/dev` pages use the `.dev.tsx` extension, registered only under `next dev` or `DEV_ROUTES=on`, so production output contains no `/dev` files at all. (A `notFound()` gate would have produced a 200 "soft 404" file mentioning "Design tokens".)
  - `app/robots.ts` and `app/sitemap.ts`; `SITE_ENV=staging` gives `Disallow: /` and `noindex, nofollow`. `public/_headers` adds security headers.
  - `scripts/check-static-limits.mts` runs as `postbuild`: file guard 18,000 of 20,000, 25 MiB per file, redirects 2,000 + 100, 100 header rules, and a secret-pattern scan of `out/`.
  - Playwright serves `out/` with `wrangler pages dev`. A new `tests/e2e/static-hosting.spec.ts` covers the real 404 status, headers, immutable assets, and robots/sitemap.
  - `.github/workflows/deploy-staging.yml` (manual + `repository_dispatch: rebuild`) builds for staging, deploys `--branch staging`, and smoke-tests if `STAGING_URL` is set.
  - `prebuild`/`pretypecheck` clear `.next/dev`: stale dev-server route types would otherwise break the production type check, because dev and production have different route sets.
- **Verified in this session (from `code/`):**
  - Lint: pass. Typecheck: pass. `npm test`: **44 passed** (3 files).
  - `npm run build` (production): pass. 33 files; largest 223.8 KiB; 0 redirects; 2 header rules; no `/dev` output; the text "Design tokens" is absent from `out/`.
  - Staging build (`SITE_ENV=staging DEV_ROUTES=on`): 39 files. `/dev/tokens` is present, `robots.txt` is `Disallow: /`, and pages carry `<meta name="robots" content="noindex, nofollow">`.
  - Build time: about 47 s on this laptop, skeleton only.
  - `npm run test:e2e` against `wrangler pages dev out`: **19 passed, 1 skipped** (keyboard focus runs on desktop only).
  - Both workflow YAML files parse.
- **Not done yet (at the time of this entry):** the staging deploy and the workflow secrets. See the P1-06 completion entry above; Pages was replaced by Workers static assets (ADR-0007).

### 2026-09-30: P1-02 Workers deployment feasibility (Completed)
- **Added in `code/`:** `@opennextjs/cloudflare` 1.20.7, `wrangler` 4.144.0 (dev), `wrangler.jsonc` (Worker `company-map-preview`, compat date 2026-09-26, `nodejs_compat`, Workers Logs on, `DEV_ROUTES=on` as a var on this Worker only), `open-next.config.ts` (`staticAssetsIncrementalCache`, no R2), `public/_headers` (immutable `/_next/static`), and the scripts `preview`, `deploy:preview`, and `cf-typegen`. `next.config.ts` calls `initOpenNextCloudflareForDev()`. `.open-next/` and `.wrangler/` are ignored by git, ESLint, and tsc. `playwright.config.ts` accepts `PLAYWRIGHT_BASE_URL`.
- **`/dev/*` now renders per request** (`await connection()` in the layout), so `DEV_ROUTES` is read at runtime. `/dev/tokens` serves as the server-rendering CPU probe.
- **Dependency fix:** `@opennextjs/cloudflare` imports `esbuild` without declaring it. It relies on hoisting, which failed because wrangler and `@opennextjs/aws` use different versions. `esbuild@0.28.1` was added as a dev dependency: it's the version wrangler uses, and it satisfies Vite 8's peer range (0.25.4 conflicted with Vite). `@opennextjs/aws` keeps its own nested 0.25.4.
- **Deploy (approved by the owner in this session):** https://company-map-preview.company-map.workers.dev, version `10af08d4-e2b0-44f6-a2a4-5b1650783ca2`. Wrangler also **registered the account's workers.dev subdomain `company-map`** during the first deploy; it can be changed in the Cloudflare dashboard. The TLS certificate for the new subdomain became valid about 90 s after the deploy.
- **Measured (full table in [ADR-0003](decisions/0003-hosting-plan-tiers.md#measurements-p1-02-30-sep-2026)):** bundle 4,945.58 KiB / 1,036.29 KiB gzip; startup 22 ms. CPU p50: `/` 5 ms, `/dev/tokens` 38 ms (p95 259 ms), 404 11 ms. 63 requests, all `ok`.
- **Verified in this session:**
  - Lint, typecheck, 39 unit tests, and `next build`: pass.
  - `npm run test:e2e` (next start): 11 passed, 1 skipped.
  - The same suite against `wrangler dev` (workerd): 11 passed, 1 skipped.
  - A production `next start` without `DEV_ROUTES`: `/dev/tokens` returns 404.
  - Deployed URLs: `/` 200, `/dev/tokens` 200, 404 for unknown paths.
  - No `middleware`/`proxy` file, no ISR, and no edge runtime in the code.
- **Notes:** OpenNext warns it is "not fully compatible with Windows" and recommends WSL. The Windows build worked, but ADR-0003 recommends building staging and production from Linux CI. This machine's DNS resolves the new hostname through the office domain, so it was tested with `curl --resolve` against Cloudflare's IP.
- **Decision for the owner (D-09):** Workers Paid for staging and production (because of CPU time, not script size); the preview stays on Free.

### 2026-09-30: P1-04 completed
- **CI run:** [36716151218](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/36716151218) on `main`, commit `bf62bdd`, **success**. The jobs `checks` (0.6 min), `e2e` (1.0 min), and `secret-scan` (0.1 min) all passed. The report upload was skipped, as expected (it runs only on failure).
- **Deviation:** acceptance asked for a test PR. The owner made the repository public and asked for a direct merge, so the push-to-`main` run served as the check; it runs the same jobs. The `pull_request` trigger runs for real on the next PR.
- **Repository now public:** the full history was checked. It holds only the planning docs and code, gitleaks reports no leaks, and no BRD file has ever been committed.

### 2026-09-30: P1-04 CI skeleton (work log)
- **Created:** `.github/workflows/ci.yml` (jobs `checks`, `e2e`, `secret-scan`; see [testing.md](testing.md#ci-on-pull-requests)) and `.github/dependabot.yml` (npm in `code/`, plus GitHub Actions, weekly on Mondays IST). Playwright now also writes an HTML report in CI, which is uploaded when a test fails.
- **Pinned versions (resolved 30 Sep 2026 with `git ls-remote`):** actions/checkout v7.0.1 `3d3c42e`, actions/setup-node v7.0.0 `8207627`, actions/upload-artifact v7.0.1 `043fb46`. gitleaks 8.30.1, with the linux_x64 SHA-256 taken from the release checksums file.
- **Verified locally:** both YAML files parse (Python `yaml.safe_load`). `npm audit --audit-level=high`: 0 vulnerabilities. Lint and typecheck: pass. gitleaks 8.30.1 (the Windows build, checksum verified) over the full history: 4 commits, **no leaks found**.
- **Not verified:** the workflow has not run on GitHub yet. Acceptance needs a passing run on a test PR.
- **Decided:** the repository is private (the unauthenticated API returns 404), so GitHub's dependency-review action isn't used (it needs Advanced Security) and `npm audit` covers dependencies. pgTAP joins CI with P1-03.
- **Next action:** push the `p1-04-ci` branch, open a PR to `main`, and record the run link here.

### 2026-09-30: P1-01 Scaffold the repository (Completed)
- **Where:** all application code is in `code/`, as the owner asked. Docs stay at the root. `.env.example` moved to `code/.env.example`.
- **Created:** Next.js **16.3.7** (App Router, TypeScript strict, Turbopack), React 19.2.8, Tailwind v4, and shadcn/ui (radix base, nova preset). Also Vitest 5.0.2, Playwright 1.63.0 (Chromium), and @axe-core/playwright 4.13.0. `@types/node` was bumped to ^24 (Vitest 5 needs 22+; the local runtime is Node 24.14.1) with `engines.node >=24`. The directory layout from CLAUDE.md is in place (`.gitkeep` in empty folders).
- **Version check:** `@opennextjs/cloudflare@1.20.7` has the peer dependency `next >=15.5.26 <16 || >=16.3.6`. Its docs (opennext.js.org/cloudflare, checked 30 Sep 2026) say: "All minor and patch versions of Next.js 16… are supported", and Node Middleware is still unsupported.
- **Design system applied:**
  - `app/globals.css` holds the Milky/Mantis tokens mapped onto the shadcn roles. The Tailwind default colours and type scale are reset, radius is 4 px everywhere, and focus is a 2 px Ink outline.
  - There is no dark mode: `dark:` is bound to a `.dark` class that nothing sets.
  - Overpass is loaded through `next/font`. fontTools confirmed it has a `tnum` feature with proportional default digits, so counts use `tabular-nums`.
  - The button was adapted: 44 px default, Ink on Mantis, underlined Mantis Deep links, white on Danger.
  - There's an on-brand `not-found.tsx` (Next's default 404 follows the OS dark mode) and a Mantis-disc `app/icon.svg`.
- **Review page:** `/dev/tokens` shows the palette, actions, chips, marker previews, type, and a live contrast table. `/dev/*` is served under `next dev`, and in production builds only with `DEV_ROUTES=on`.
- **Dependency checked:** shadcn's init added the npm package `cn@0.4.0`, which replaces `clsx` + `tailwind-merge`. It is published by shadcn (repo shadcn-ui/cn), has no install scripts and no dependencies, and `shadcn` itself depends on it. It was kept. A unit test covers its merge behaviour with our custom colour names.
- **Verified (run in this session, from `code/`):**
  - `npm ci`: pass, 0 vulnerabilities.
  - `npm run lint`: pass, no output.
  - `npm run typecheck` (`next typegen && tsc --noEmit`): pass.
  - `npm test`: 2 files, **39 passed**.
  - `npm run build`: pass. Routes `/`, `/_not-found`, `/dev/tokens`, `/icon.svg`, all static.
  - `npm run test:e2e`: **11 passed, 1 skipped** (keyboard focus runs on desktop only), in the desktop and Pixel 7 projects. It covers Milky/Ink/Overpass on `/`, the Mantis button with Ink text at ≥44 px, the 2 px Ink focus outline, the live contrast table, and zero serious or critical axe violations on `/` and `/dev/tokens`.
  - `npm run dev`: `/` 200, `/dev/tokens` 200, unknown path 404.
  - A production build without `DEV_ROUTES`: `/` 200, `/dev/tokens` **404**.
  - Screenshots at desktop 1280 px and Pixel 7 reviewed: no horizontal scroll, and the tokens render as specified.
- **Fixed during the run:** the first axe pass flagged 2 contrast failures on `/dev/tokens`. Both were bugs in the review page, not in the tokens: a missing `--white` variable, and a 3:1 border pair shown as text. Both are fixed.
- **Not done / deferred:** the `preview` script moves to P1-02 (it needs OpenNext + wrangler). No CI yet (P1-04). No Supabase (P1-03).
- **Unverified:** Geoapify terms for overriding style paint (P1-05). Designer sign-off on the derived tokens and font.
- **Owner inputs needed next:** a Cloudflare account and approval for a preview deploy (P1-02); a Supabase `dev` project with the Supabase CLI and Docker Desktop installed locally (P1-03); a referrer-restricted Geoapify API key (P1-05).

### 2026-09-30: Brand colours and design system documented
- **Changed:** added [design-system.md](design-system.md), with the Milky + Mantis `#59C749` palette, derived tokens, map colours, type (Overpass), layout wireframes, motion, copy, and the shadcn token block. Linked it from CLAUDE.md (new Design section), plan.md (P1-01, P1-05, P2-03, P2-04, P4-02, D-08), map-spec.md (§2, §5, §8), and testing.md.
- **Verified:** WCAG contrast ratios, computed with a Node script this session (for example, Mantis on Milky is 2.12:1, which fails; Ink on Mantis is 5.77:1, which passes). Documentation only: no code, no tests.
- **Confirmed:** Milky is `#FFFDF1` (the brief's `#FFDF1` was a typo). The owner may change the combination after seeing it in the UI.
- **Unverified / open:** designer sign-off on the derived tokens and font, and Geoapify terms for overriding style paint. (Overpass `tnum` was resolved in P1-01.)
- **Next action:** unchanged, P1-01.

### 2026-09-30: Repository instructions and plan prepared
- **Created:** CLAUDE.md, plan.md, README.md, .env.example, .gitignore, and docs/ (architecture, map-spec, data-model, testing, security, data-pipeline, progress, decisions/0001–0005).
- **Sources read:** `Company Map — Architecture & Implementation Plan.md` (the only file in the repo).
- **Missing inputs:** the **BRD isn't in the repository**, so its requirement IDs are cited only through the plan. The plan's embedded diagrams (architecture, map states, delivery timeline) weren't exported and are unavailable.
- **Web checks (2026-09-30):** Cloudflare Workers limits, OpenNext Cloudflare overview and caching, and Supabase billing. See ADR-0003.
- **Verification:** documentation only. No code, no tests run, nothing deployed.
- **Unverified:** every command in CLAUDE.md (there's no package.json yet); Geoapify free allowance; Turnstile and Supabase Cron limits.
