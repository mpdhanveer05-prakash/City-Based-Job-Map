---
name: feedback-stale-test-server
description: Playwright reuses any server already on port 3100 and skips the rebuild; kill wrangler and workerd by process name before running e2e
metadata:
  type: feedback
---

`npm run test:e2e` runs `npm run build && wrangler dev` only if nothing answers on port 3100. A `wrangler dev` left over from debugging is reused, so the tests run against an **old `out/`** and a new feature looks broken (or an old bug looks fixed). This cost hours more than once (P1-05, P2-03, P2-04, P2-05).

**Why:** `reuseExistingServer: !process.env.CI` in `code/playwright.config.ts`. `pkill` does not kill wrangler on Windows, and matching on the command line alone also kills `bash.exe` shells.

**How to apply:** after any manual `npx wrangler dev`, stop only `node.exe` and `workerd.exe` whose command line matches `wrangler|workerd` (PowerShell `Get-CimInstance Win32_Process`), then check that `Get-NetTCPConnection -LocalPort 3100 -State Listen` is empty. If a result looks wrong, grep `code/out/_next/static` for a string you just added. "Timed out waiting 240000ms from config.webServer" means the build or server did not start; look for a process still holding a port.
