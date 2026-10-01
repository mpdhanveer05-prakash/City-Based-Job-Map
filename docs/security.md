# Security

## Admin access
- Supabase Auth is **only for administrators**. Public sign-up is disabled in the project settings (`[auth] enable_signup = false` for production, to be verified in P7-01).
- Access requires a valid session **and** a row in `admin_user` (roles editor < reviewer < admin). Being authenticated alone grants nothing beyond anon access.
- The site is a static export (ADR-0006), so there's no server to check admin access. `/admin` pages are client-rendered, and **their JavaScript is public**. Access control rests entirely on RLS policies and on `SECURITY INVOKER` RPCs that check `is_admin()`. Never rely on hiding admin code or routes.
- Proposal: MFA required for admin accounts. Session lifetime to be decided in P7-01.

## Database policies
- RLS is enabled on every `public` table. Tables without RLS fail CI (a pgTAP check over `pg_tables`).
- anon can only SELECT published or active rows, and has no direct INSERT. Public writes (feedback, click counts) go only through Edge Functions, which validate and then write with credentials held as Supabase function secrets. Admin writes are ordinary table writes and RPCs under the admin's session, checked by RLS.
- `SECURITY DEFINER` functions must `SET search_path` and be reviewed. Everything else is `SECURITY INVOKER`.
- The pipeline uses a dedicated Postgres role with only the grants it needs, never the service role inside browser code.

## Secrets
- Never commit credentials. `.env*` is git-ignored except for `code/.env.example`.
- Browser-safe values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or its publishable-key equivalent), `NEXT_PUBLIC_GEOAPIFY_KEY` (to be restricted by referrer in Geoapify MyProjects; **unrestricted on 1 Oct 2026**, see ADR-0008), and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- Server-only values: `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, the GitHub token for `request-rebuild`, `PIPELINE_DATABASE_URL`, and the Cloudflare API token for deploys. They live **only** in Supabase function secrets and GitHub encrypted secrets. The Next.js build sees only `NEXT_PUBLIC_*` values, and it reads the snapshot with the anon key, so RLS limits it to published data.
- CI greps the static output (`out/`) for secret-looking strings before deploying (see testing.md).
- CI runs a secret scan (for example gitleaks; the tool choice is open).

## Public forms (reports, suggestions)
- The `submit-feedback` Edge Function verifies the Turnstile token (`siteverify`) **before** any insert. The expected hostname and action are checked, and a token is never reused.
- Zod validation, length limits, a required source URL for suggestions, and no PII fields.
- Rate limit inside the Edge Function (proposal: 5 submissions per client per hour). The client key is a salted, daily-rotated hash; no raw IP is stored. The Cloudflare WAF doesn't sit in front of Supabase, so this replaces the plan's WAF rule.
- The response contains only a receipt ID. Nothing is published without review.

## Outbound links and content
- Apply and website URLs must be `https` and match the company domain or a known ATS host. This is checked **at build time**; a failing URL fails the build. Links point to the stored URL unchanged (no redirect service). The `click` beacon sends only the job or company ID and the link kind.
- Strict CSP set in the static-asset `_headers` file (allow self, `https://maps.geoapify.com`, Supabase, Turnstile; `worker-src 'self'`, because MapLibre is served same-origin from `/maplibre/`), sanitised descriptions, and `rel="noopener noreferrer"`.
- Company logos are fetched by the map from our own Storage host only. `allowedHosts` is set to that host once the dataset exists (P4-01), so a bad logo URL in the data cannot make a visitor's browser call a third party and reveal their IP address. Logos must be `https:` (or a same-origin path), raster (PNG, JPEG, WebP, GIF, AVIF), and at most 1 MB; they are fetched with no cookies and no referrer. SVG is refused. The CSP `connect-src` must list the Storage host, and Storage must send CORS headers (the layer reads the pixels). [Proposal until P4-01]

## Privacy
- There is no visitor account and no visitor PII. Click logs contain no IP address or user identifier (the retention and analytics tool are decided in D-07).
- Founder names are limited to what the company itself publishes (D-03).
