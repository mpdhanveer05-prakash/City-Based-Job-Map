# Setting up on another laptop

Everything needed to build, test, and continue this project is in this repository, except three things that must never be committed: your Geoapify key, your Cloudflare login, and Claude Code's memory folder (a copy of it is kept here, see step 6). Follow the steps in order.

## 1. Install the tools

| Tool | Version | Why |
| --- | --- | --- |
| Git | any recent | clone and push |
| Node.js | **24 or later** (npm 11) | the app, tests, and the Supabase CLI (`npx supabase`) |
| Docker Desktop | running | the local Postgres for `supabase db start` and the `database` CI job (not needed for map work) |
| Claude Code | current | to continue the work with the same instructions |

Check: `node -v` (v24+), `npm -v`, `git --version`, `docker version` (if you will touch the database).

## 2. Get the code

```
git clone https://github.com/mpdhanveer05-prakash/City-Based-Job-Map.git
cd City-Based-Job-Map
git pull          # always, before starting; the other laptop may have pushed
```

The first push or pull asks you to sign in to GitHub (Git Credential Manager opens a browser).

## 3. Install the dependencies

```
cd code
npm ci
npx playwright install chromium
```

`npm ci` installs exactly what `package-lock.json` says. Do not use `npm install` for this (it can change the lockfile).

## 4. Add your local settings (not in git)

Copy `code/.env.example` to `code/.env.local` and fill in only what you need:

- `NEXT_PUBLIC_GEOAPIFY_KEY`: the Geoapify API key. Get it from your Geoapify account (MyProjects, API Keys). **Without it the map pages still work** on a blank Milky background, and the 10 basemap e2e tests skip themselves (that is how CI runs). With it you get the real basemap.
- Leave the Supabase, Turnstile, and Cloudflare values as placeholders until a task needs them. The server-side secrets (`SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN`, and so on) belong in Supabase function secrets and GitHub repository secrets, never in `.env.local` of the app and never in git. The GitHub secrets for deploys (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are already set on the repository, so you do not need them locally.

`code/.env.local` is ignored by git (`code/.gitignore` has `.env*`). Check with `git check-ignore -v code/.env.local`.

## 5. Check that it works

From `code/`:

```
npm run lint
npm run typecheck
npm test            # Vitest; expect all tests to pass
npm run build       # static export into out/, 36 files
npm run test:e2e    # builds with DEV_ROUTES=on and runs Playwright (about 2 to 4 minutes)
npm run dev         # http://localhost:3000, and /dev/map-layer, /dev/tokens, /dev/basemap
```

To run the browser tests the way CI does (no key), set `NEXT_PUBLIC_GEOAPIFY_KEY=` empty for that command.

Database (only when working on Phase 3): start Docker Desktop, then `npx supabase db start`, `npx supabase db reset`, `npx supabase test db`.

Deploying to the staging Worker needs `npx wrangler login` (or the GitHub Action "Deploy staging") and the owner's approval; see CLAUDE.md. Nothing is deployed to production.

## 6. Give Claude Code the same memory

Claude Code keeps a per-project memory folder outside the repository, under your home directory, in a folder whose name encodes the project path. That is why it does not sync by itself. A copy of this project's memory is in [`docs/claude-memory/`](claude-memory/README.md); its README has the copy commands for Windows and macOS/Linux.

Do this once on the new laptop, and again whenever the memory changes on either laptop.

## 7. Continue where the work stopped

1. `git pull`.
2. Open the repository folder in Claude Code and say: *"Read CLAUDE.md, plan.md and docs/progress.md, then continue."* Claude Code loads `CLAUDE.md` by itself.
3. `docs/progress.md` starts with **Current state**: the task in progress, what is verified, what is not, and the exact next action.

## Gotchas that have cost time

- **A leftover test server serves an old build.** `npm run test:e2e` reuses anything already listening on port 3100 and skips the rebuild. After debugging with `npx wrangler dev`, stop the `node.exe` and `workerd.exe` processes first (Windows: `Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'node.exe','workerd.exe' -and $_.CommandLine -match 'wrangler|workerd' } | Stop-Process -Force`). Match on the process name: a match on the command line alone also kills your shells. If a new test fails oddly, check that `out/_next/static` contains a string you just added.
- **Software WebGL is slow.** The e2e suite uses 3 workers locally (2 in CI) and a 60 s test timeout; the logo and animation specs allow 120 s.
- **Line endings.** Git on Windows prints "LF will be replaced by CRLF" warnings. They are harmless.
- **Never commit** `.env.local`, tokens, or the Supabase service-role key. CI runs gitleaks on every push.
