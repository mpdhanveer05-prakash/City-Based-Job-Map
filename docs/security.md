# Security

## Admin access
- Supabase Auth is **only for administrators**. Public sign-up is disabled in the project settings (`[auth] enable_signup = false` for production, to be verified in P7-01).
- Access requires a valid session **and** a row in `admin_user` (roles editor < reviewer < admin). Being authenticated alone grants nothing beyond anon access.
- The `/admin` route group is checked on the server in every Route Handler and Server Action, not only in the layout. It is never bundled into public pages.
- Proposal: MFA required for admin accounts. Session lifetime to be decided in P7-01.

## Database policies
- RLS is enabled on every `public` table. Tables without RLS fail CI (a pgTAP check over `pg_tables`).
- anon can only SELECT published or active rows. Writes go through Route Handlers that use server-only credentials after validation.
- `SECURITY DEFINER` functions must `SET search_path` and be reviewed. Everything else is `SECURITY INVOKER`.
- The pipeline uses a dedicated Postgres role with only the grants it needs, never the service role inside browser code.

## Secrets
- Never commit credentials. `.env*` is git-ignored except for `.env.example`.
- Browser-safe values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or its publishable-key equivalent), `NEXT_PUBLIC_GEOAPIFY_KEY` (restricted by referrer), and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- Server-only values: `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `PIPELINE_DATABASE_URL`, and Cloudflare API tokens. These live in Cloudflare Worker secrets and GitHub encrypted secrets. Modules that read them import `server-only`.
- CI runs a secret scan (for example gitleaks; the tool choice is open).

## Public forms (reports, suggestions)
- The Turnstile token is verified on the server (`siteverify`) **before** any insert. The expected hostname and action are checked, and a token is never reused.
- Zod validation, length limits, a required source URL for suggestions, and no PII fields.
- WAF rate rule (proposal from the plan: 5 submissions per IP per hour).
- The response contains only a receipt ID. Nothing is published without review.

## Outbound links and content
- Apply and website URLs must be `https` and match the company domain or a known ATS host. `/go` redirects to the stored URL unchanged.
- Strict CSP (allow self, Geoapify, Supabase, Turnstile, and `worker-src blob:` as needed), sanitised descriptions, and `rel="noopener noreferrer"`.

## Privacy
- There is no visitor account and no visitor PII. Click logs contain no IP address or user identifier (the retention and analytics tool are decided in D-07).
- Founder names are limited to what the company itself publishes (D-03).
