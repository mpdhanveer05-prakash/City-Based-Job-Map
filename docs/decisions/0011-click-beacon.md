# ADR-0011: How an Apply or Visit website click is counted

- **Status:** Accepted (engineering decision under ADR-0006; the retention and analytics questions stay with D-07)
- **Date:** 2026-10-05
- **Related tasks / decisions:** P6-03, ADR-0006 ("Apply and Visit website are direct links with a `click` beacon"), docs/security.md ("Outbound links and content", "Privacy"), D-07

## Context

ADR-0006 replaced the plan's `/go/job/{id}` redirect with a direct link to the employer plus a beacon that counts the click. A static site has no server of its own, so the count has to be written by a Supabase Edge Function. The visitor has no account, the site stores no applicant data, and the count must not become a tracking log.

## Decision

1. **The link is a plain anchor** to the stored URL, unchanged, `target="_blank"`, `rel="noopener noreferrer"`, with the visually hidden text "(opens the employer's site)". It works with scripts off and when the beacon is blocked or fails (tested).
2. **The beacon** is `navigator.sendBeacon` with a JSON body sent as **`text/plain`**: a CORS "simple" content type, so the browser needs no preflight. It carries `{kind: "apply" | "website", id}` and nothing else; the test asserts it has no cookie or authorization header. A build without a Supabase URL has no endpoint and sends nothing.
3. **The Edge Function `click`** runs with **JWT verification off** (`[functions.click] verify_jwt = false`), because `sendBeacon` cannot set an `Authorization` header. It compensates at the door: only `POST`, an `Origin` that is on the `ALLOWED_ORIGINS` secret (a missing origin is refused too), a body of at most 512 bytes, and a Zod strict object (`kind` enum, `id` guid, no other keys). The Zod schema runs in the Edge Function (CLAUDE.md), and `record_click` checks its arguments again in Postgres.
4. **The handler is a pure module** (`supabase/functions/_shared/click-handler.ts`), so Vitest tests it (10 cases) without Deno; `click/index.ts` only supplies the database call and the secrets.
5. **The counter** is `link_click_daily(day, kind, target_id, count)`, incremented by `record_click` (SECURITY DEFINER, fixed `search_path`, executable by the service role only). It holds a UTC day, never a timestamp, and has no column for an address, agent, user, or session (a pgTAP test checks the column list). Reviewers and above can read it; nobody can write it through the API. `record_click` refuses a job that is not listed (active or suspect, company published) and a company that is not published.
6. **A refused target answers 204, like an accepted one**, so the endpoint cannot be used to probe which ids exist. A database failure answers 503.

## Consequences

- **Counts can be inflated.** There is no per-visitor rate limit (it would need an identifier). The Origin check stops casual cross-site abuse, but a script that sets the header can still add counts. The numbers are for trends, not for billing. If abuse appears, add a salted, daily-rotated hash of the connection as in `submit-feedback` (P8-04), which still keeps no raw address.
- The function must be deployed with `--no-verify-jwt` (the `config.toml` entry does this for `supabase functions deploy`) and given `ALLOWED_ORIGINS` (`supabase secrets set`) for staging and production.
- Retention of the counts, and whether an analytics tool is also used, are D-07.

## Sources (with date checked)

- Supabase CLI configuration reference for `[functions.<name>] verify_jwt, import_map, entrypoint`, as supported by CLI 2.118 (the entry was accepted by `supabase functions serve`, 5 Oct 2026).
- MDN `Navigator.sendBeacon()` and the CORS "simple request" content types (`text/plain` needs no preflight), known behaviour, not re-fetched.
- Verified by running the function in the local edge runtime (`supabase functions serve click`): see docs/progress.md, 5 Oct 2026.
