# ADR-0014: Content-Security-Policy as a per-page meta tag with script hashes

- **Status:** Accepted (engineering decision under ADR-0006)
- **Date:** 2026-10-05
- **Related tasks / decisions:** P9-02, ADR-0006, ADR-0007, docs/security.md ("Content-Security-Policy")

## Context

The site is a static export on Workers static assets. A strict policy is the main defence against a script injected into a page (the admin pages hold a signed-in session in the browser, and the admin JavaScript is public). Next.js emits **inline scripts** whose text differs on every page (hydration data), so a policy that forbids inline scripts breaks the site, and `'unsafe-inline'` would remove most of the protection. A policy per page in `public/_headers` would need one rule per page, and Workers static assets allow 100 header rules; the site has thousands of pages.

## Decision

1. **The policy is written into each HTML page as a `<meta http-equiv="Content-Security-Policy">`** by `scripts/inject-csp.mts`, which runs after `next build` (npm `postbuild`, before the limits check). `lib/csp.ts` builds it. For each page it computes the SHA-256 of every executable inline script and lists those hashes in `script-src`, with `'self'` and `https://challenges.cloudflare.com` (Turnstile). There is no `'unsafe-inline'` and no `'unsafe-eval'` for scripts.
2. `default-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. `connect-src` allows `'self'`, the Geoapify tile host, Cloudflare Turnstile, and the Supabase project origin (REST, Auth, Functions, Storage). `img-src` allows `'self'`, `data:`, `blob:` (the map's logo atlas), and the Supabase origin. `style-src` keeps `'unsafe-inline'` because computed positions use style attributes, and a style cannot run code. `worker-src` allows `'self'` and `blob:` (MapLibre's workers).
3. **What a meta policy cannot do** (framing, reporting) is covered by `X-Frame-Options` in `public/_headers`.
4. **The `/dev/**` pages** (built only with `DEV_ROUTES=on`, in tests and staging) also get `blob:` in `connect-src`, because their synthetic logos are `blob:` URLs fetched like real ones. Real logos come from the Storage origin, which is already allowed, so no public page gets `blob:` for connections.
5. **Zod runs without its compiler** (`lib/zod-config.ts` sets `jitless`): Zod 4 probes `Function("")` on first use, which a policy without `'unsafe-eval'` refuses and the browser reports as a violation. The inputs are a URL and small datasets, so the faster compiled parsers are not needed.
6. **It is tested** (`tests/unit/csp.test.ts`; `tests/e2e/csp.spec.ts` loads the key pages and fails on any `securitypolicyviolation`, checks that every page has a policy without `unsafe-inline` or `unsafe-eval` for scripts and without a wildcard, and checks that an injected inline script and a script from another site are blocked; the admin spec also fails on a violation).

## Consequences

- Any new third-party script, image host, font, or connection fails the e2e spec until `lib/csp.ts` allows it on purpose.
- A page's inline scripts are hashed at build, so a post-build edit of an HTML file breaks that page. Run `inject-csp` again after any such edit (it is idempotent).
- A meta tag only applies to what follows it, so it is inserted first in `<head>`.
- Not verified: how the deployed Worker serves these pages (only `wrangler dev` has served them); behaviour in browsers other than Chromium; a policy-violation report endpoint (none exists; the owner chooses an error-reporting tool under D-07).

## Sources (with date checked)

- The CSP meta element's limits (no `frame-ancestors`, `report-uri`, or `sandbox`): from the CSP specification as known on 5 Oct 2026; not re-fetched during this task. The behaviour here was observed in Chromium through Playwright.
