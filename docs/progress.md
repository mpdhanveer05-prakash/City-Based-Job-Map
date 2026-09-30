# Progress

Update this after every task: what changed, how it was verified (the commands actually run and their results), what's unverified, blockers, and the next action.

## Current state
- **Current task:** P1-02 Workers deployment feasibility (Not started). P1-03, P1-04, and P1-05 are also unblocked.
- **Next action:** P1-02 needs a Cloudflare account and authorization for a preview deploy. P1-03 needs the Supabase CLI and Docker, plus a Supabase `dev` project. See the P1-01 entry.
- **Blockers:** none for code work. For product decisions, see the decision register (D-01…D-09).

## Log

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
