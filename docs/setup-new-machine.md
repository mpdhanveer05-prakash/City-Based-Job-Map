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

**On a Mac** (Apple Silicon or Intel), with [Homebrew](https://brew.sh):

```
brew install git node@24
brew link --overwrite node@24      # puts node 24 on the PATH (or use nvm: nvm install 24)
brew install --cask docker         # Docker Desktop; open it once and wait until it says "running"
brew install --cask google-chrome  # only for the map validation gate (npm run gate)
```

Docker Desktop on Apple Silicon runs the Supabase images fine. Allow it at least 4 GB of memory (Settings, Resources). The rest of this guide is written for Windows and works unchanged in a Mac terminal (zsh or bash) unless a step says otherwise.

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

**Moving from another laptop:** the Geoapify key exists only in the old laptop's `code/.env.local`, because it is never committed. Either copy that one line over yourself (a password manager, or AirDrop; do not paste it into chat, an issue, or a commit), or read it again in your Geoapify account (MyProjects, API Keys). The project works without it on a blank background, so you can start before you have it.

## 5. Check that it works

From `code/`:

```
npm run lint
npm run typecheck
npm test            # Vitest; expect all tests to pass
npm run build       # static export into out/, 36 files
npm run test:e2e    # builds with DEV_ROUTES=on and runs Playwright: about 9 minutes with a Geoapify key, all projects
npm run dev         # http://localhost:3000, and /dev/map-layer, /dev/tokens, /dev/basemap
```

To run the browser tests the way CI does (no key, 2 workers, 1 retry, map specs on desktop only), use `CI=true NEXT_PUBLIC_GEOAPIFY_KEY= npm run test:e2e` (PowerShell: set `$env:CI='true'; $env:NEXT_PUBLIC_GEOAPIFY_KEY=''` first). It takes about 2 minutes here. Run both before pushing.

Database and data (Phase 3 and later). Start Docker Desktop first, then, from `code/`:

```
npx supabase db start      # Postgres only, the way CI runs it
npx supabase db reset      # applies every migration and loads the synthetic sample data (supabase/seed)
npx supabase test db       # pgTAP: schema, RLS for each role, filter functions, seed (292 tests)
npm run test:parity        # the TypeScript filter against the SQL functions over the seeded database (about 35 s)
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run data   # writes public/data/ (git-ignored)
```

`npm test` does not need Docker; `npm run test:parity` and `npm run data` do. The sample data is **synthetic** (every company name ends in "(synthetic)", domains end in `.example`); never load it into production.

The map validation gate (`npm run gate`, see `docs/map-spec.md` section 10) needs the installed Google Chrome and **about 4 GB of free memory**: a Next.js build, Chrome, and Wrangler run at once. Close other apps first. It writes raw numbers to `code/gate-results/` (git-ignored). Run it on the machine you want numbers for: the first attempt was on a Windows laptop with an Intel GPU and ran out of memory (see `docs/progress.md`, 4 Oct 2026).

Deploying to the staging Worker needs `npx wrangler login` (or the GitHub Action "Deploy staging") and the owner's approval; see CLAUDE.md. Nothing is deployed to production.

## 6. Give Claude Code the same memory

**On a Mac** the folder is `~/.claude/projects/-Users-<you>-<the project path with / turned into ->/memory/` (it starts with a dash). Use the bash command in the memory README.

Claude Code keeps a per-project memory folder outside the repository, under your home directory, in a folder whose name encodes the project path. That is why it does not sync by itself. A copy of this project's memory is in [`docs/claude-memory/`](claude-memory/README.md); its README has the copy commands for Windows and macOS/Linux.

Do this once on the new laptop, and again whenever the memory changes on either laptop.

## 7. Continue where the work stopped

1. `git pull`.
2. Open the repository folder in Claude Code and say: *"Read CLAUDE.md, plan.md and docs/progress.md, then continue."* Claude Code loads `CLAUDE.md` by itself.
3. `docs/progress.md` starts with **Current state**: the task in progress, what is verified, what is not, and the exact next action.

## Gotchas that have cost time

- **A leftover test server serves an old build.** `npm run test:e2e` reuses anything already listening on port 3100 and skips the rebuild. After debugging with `npx wrangler dev`, stop the `node.exe` and `workerd.exe` processes first (Windows: `Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'node.exe','workerd.exe' -and $_.CommandLine -match 'wrangler|workerd' } | Stop-Process -Force`). Match on the process name: a match on the command line alone also kills your shells. If a new test fails oddly, check that `out/_next/static` contains a string you just added.
- **Software WebGL is slow.** The e2e suite uses 3 workers locally (2 in CI) and a 60 s test timeout; the logo and animation specs allow 120 s.
- **Line endings.** `.gitattributes` stores text as LF. Git on Windows still prints "LF will be replaced by CRLF" warnings; they are harmless. On a Mac there are none.
- **A leftover test server on a Mac:** `pkill -f workerd; pkill -f wrangler`, then rerun.
- **Playwright empties `test-results/` at the start of every run.** Anything you want to keep from a run (the gate's numbers) must be written somewhere else; the gate uses `gate-results/`.
- **Low memory kills long runs.** Claude Code stops a background command when the machine is critically short of memory, and a Windows run died at the build step for the same reason. Close other apps before a long run.
- **Never commit** `.env.local`, tokens, or the Supabase service-role key. CI runs gitleaks on every push.
