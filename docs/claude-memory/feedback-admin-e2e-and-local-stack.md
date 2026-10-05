---
name: feedback-admin-e2e-and-local-stack
description: "How to run npm run test:admin and the Playwright builds on this laptop without false failures (db reset, stray next dev, Docker DNS 503, memory)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: f9750ba0-ad84-41ba-84d7-23087fc63beb
  modified: 2026-10-05T10:30:56.880Z
---

- `npx supabase db reset` before **every** `npm run test:admin` (the spec mutates data and is serial). Never run `supabase test db` at the same time.
- A running `next dev` (the owner's) rewrites `.next/dev/types` and corrupts it, so `npm run build` fails with "Failed to type check". Do not kill their server: run `rm -rf .next/dev/types && npx next typegen` right before a build or Playwright run.
- Kill stale `workerd` processes before a Playwright run (`Get-Process workerd | Stop-Process`), as in [[feedback-stale-test-server]].
- The local Edge runtime sometimes answers `503 {"message":"name resolution failed"}` (Docker DNS) before a function runs. It is a local fault, not a code bug; the Publish now spec retries only that answer. The functions log is at `%TEMP%/admin-e2e-functions.log`.
- Each Edge Function needs its own `deno.json` (zod import); the shared `import_map` path in `config.toml` was not applied for `submit-feedback`.
- When the machine is low on memory Claude Code kills background commands and a Playwright test can wait for 28 minutes. Run heavy jobs one at a time and never start a second while one runs (even a grep timed out). Do not restart a killed run until asked; see [[feedback-playwright-wipes-test-results]].
- A strict CSP turns library surprises into e2e failures: the dev pages' `blob:` logos and Zod's `Function("")` probe both showed up that way. `tests/e2e/csp.spec.ts` prints the source file and line of any violation.

**Why:** each cost a full run (2 to 10 minutes) to diagnose during P7 to P9.

**How to apply:** follow the order above whenever running the admin or full e2e suites.
