# Setting up a laptop (macOS or Windows)

The project is developed on two laptops, a Windows 11 laptop and a Mac ([ADR-0026](decisions/0026-two-laptop-workflow.md)).
GitHub carries the code and the project context. A few things never go through Git, and each laptop sets them up by
hand: the Geoapify key (`code/.env.local`), sign-ins (GitHub, Cloudflare), and the local databases. Follow the steps in
order. The macOS commands come first; Windows notes follow where they differ.

**Status of this guide (14 Oct 2026):** the versions and commands were read from the repository and checked on the
Windows laptop. **Nothing in it has been run on a Mac yet.** Step 7 records the first Mac results in the handoff.

## 1. Tools and versions

| Tool | Required | On the Windows laptop (14 Oct 2026) | Notes |
| --- | --- | --- | --- |
| Xcode Command Line Tools | any | — | macOS only; needed by Homebrew and Git |
| Homebrew | current | — | macOS package manager |
| Git | any recent | 2.53.0 | |
| GitHub CLI `gh` | any recent | 2.102.0 | sign-in, CI results, read-only settings checks |
| Node.js | **24.x** (`engines: >=24`; CI uses 24) | **24.14.1** | use the same 24.14.1 for identical behaviour |
| npm | 11 (comes with Node 24) | **11.11.0** | always `npm ci`, never `npm install` |
| Python | **3.12 or later**; CI uses **3.13** | 3.14.3 | the pipeline and pilot scripts; use 3.13 |
| Docker Desktop, with Compose v2 | current | Docker 29.4.0, Compose v5.1.1 | the local Supabase stacks. The project doesn't call Compose itself; it comes with Docker Desktop |
| Supabase CLI | **2.118.0**, from `package-lock.json` | 2.118.0 | run as `npx supabase`; don't install a separate copy (versions would drift between laptops) |
| Wrangler | **4.144.0**, from the lockfile (workerd 1.20260926.1) | 4.144.0 | run as `npx wrangler` |
| Playwright | **1.63.0**, from the lockfile | 1.63.0 | `npx playwright install chromium` downloads its browser |
| Next.js, React, TypeScript, Vitest, ESLint | from the lockfile: 16.3.7, 19.2.8, 5.9.3, 5.0.2, 9.39.5 | same | installed by `npm ci` |
| Google Chrome | current | installed | only for the map gate (`npm run gate`, `channel: "chrome"`) |
| gitleaks | optional; CI pins **8.30.1** | not installed (run from a checked download on 14 Oct) | the same secret scan CI runs, before you push |
| GnuPG (`gpg`) | any | ships with Git for Windows | only to encrypt or decrypt a database transfer (§8) |
| Claude Code | current | installed | to continue with the same instructions |

PostgreSQL client tools are **not** needed on the host: `pg_dump` and `pg_restore` run inside the Supabase container
(`docker exec`).

### Install on macOS

```bash
xcode-select --install                                   # once; a dialog installs the tools
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Apple Silicon: Homebrew lives in /opt/homebrew. Intel: /usr/local. The installer prints the line to add; for Apple Silicon:
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile && eval "$(/opt/homebrew/bin/brew shellenv)"

brew install git gh fnm python@3.13 gnupg gitleaks
brew install --cask docker-desktop google-chrome          # or download Docker Desktop from docker.com (pick your chip)

# Node 24.14.1 through fnm (keeps the exact version; `brew install node@24` also works but tracks the newest 24.x)
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc && eval "$(fnm env --use-on-cd --shell zsh)"
fnm install 24.14.1 && fnm default 24.14.1

# Claude Code (see its docs for the current installer)
curl -fsSL https://claude.ai/install.sh | bash
```

Open Docker Desktop once and wait until it says it is running. In **Settings → Resources**, give it at least **4 GB** of
memory, and **6 GB** if you will run the main stack and the test stack at the same time (each full stack takes about 2 GB).

### Verify

```bash
xcode-select -p
brew --version
git --version
gh --version
node -v            # v24.14.1
npm -v             # 11.x (if not 11.11.0: npm install -g npm@11.11.0)
node -p process.arch   # arm64 on Apple Silicon, x64 on Intel; see §2
python3.13 --version   # Python 3.13.x
docker version         # both Client and Server must answer
docker compose version
docker run --rm hello-world
gpg --version
gitleaks version
claude --version
```

The project tools come after `npm ci` (step 4): `npx supabase --version` (2.118.0), `npx wrangler --version`
(4.144.0), `npx playwright --version` (1.63.0). The Supabase CLI prints "a new version is available": ignore it.
Upgrades arrive through Dependabot and the owner merges them.

**Windows:** the same tools from their installers or `winget` (`winget install Git.Git GitHub.cli OpenJS.NodeJS.LTS
Python.Python.3.13 Docker.DockerDesktop`). Check that Node is 24.x after installing.

## 2. Apple Silicon and Intel

- **Use native arm64 tools on Apple Silicon.** `node -p process.arch` must print `arm64`. If it prints `x64`, the terminal
  or Homebrew is running under Rosetta (a `/usr/local` Homebrew on an M-series Mac). Fix that before `npm ci`, or npm
  installs the wrong native binaries.
- **Every native package is in the lockfile for both chips:** Next.js SWC, workerd (Wrangler), esbuild, sharp, Tailwind's
  oxide, lightningcss, rolldown and the Supabase CLI, each for `darwin-arm64` and `darwin-x64`. `npm ci` picks the right
  ones.
- **Never copy `node_modules` between machines** (or between chips). Run `npm ci` on each one.
- **Docker:** install the Docker Desktop build for your chip. The Supabase images (Postgres 17 and the rest) are published
  for arm64 and amd64. If an image ever fails with "no matching manifest for linux/arm64", turn on **Settings → General →
  Use Rosetta for x86_64/amd64 emulation** (needs `softwareupdate --install-rosetta`), and note it in the handoff.
- **Python:** `psycopg[binary]` has wheels for both chips.
- **Browser tests:** headless Chromium draws WebGL with a different backend on macOS, so timings differ from Windows. The
  suite's 60 s and 120 s timeouts are generous. **Gate and performance numbers belong to the machine that measured them**:
  never compare a Mac number with a Windows one.

## 3. Get the code and sign in to GitHub

```bash
gh auth login --hostname github.com --git-protocol https --web   # browser sign-in with your GitHub 2FA
gh auth setup-git                                                 # Git uses gh's credentials
git config --global user.name  "<the same name as on the Windows laptop>"
git config --global user.email "<the same email as on the Windows laptop>"
git config --global pull.rebase false                             # pulls merge; pushed commits are never rebased
mkdir -p ~/Projects && cd ~/Projects
git clone https://github.com/mpdhanveer05-prakash/City-Based-Job-Map.git
cd City-Based-Job-Map
```

Read the name and email on Windows with `git config user.name` and `git config user.email`. Commits must carry only the
owner's identity (no Claude attribution lines). Keep the clone path free of spaces.

Line endings are handled by `.gitattributes` (LF everywhere). On Windows, "LF will be replaced by CRLF" warnings are
harmless; on a Mac there are none.

## 4. Install the dependencies

```bash
cd code
npm ci
npx playwright install chromium
python3.13 -m venv .venv && source .venv/bin/activate    # code/.venv is git-ignored
pip install -r scripts/requirements.txt
```

Activate the virtual environment (`source .venv/bin/activate`) in each new terminal that runs Python. With it active,
`python` means 3.13, so the commands in CLAUDE.md work as written. **Windows:** `py -3.13 -m venv .venv`, then
`.venv\Scripts\Activate.ps1`.

## 5. Local secrets (never in Git)

```bash
cp .env.example .env.local     # from code/
chmod 600 .env.local
git check-ignore -v .env.local # must print the ignore rule
```

- `NEXT_PUBLIC_GEOAPIFY_KEY`: copy it from the other laptop's `code/.env.local` **through your password manager** (or
  read it again in Geoapify, MyProjects → API Keys). Never put it in chat, an issue, a commit, or a synced notes app.
  Without it the map draws on a blank Milky background and the 10 basemap e2e tests skip, as in CI.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: only for a build against a local stack. Take them
  from `npx supabase status` (the local stack's demo keys). Don't commit them either.
- Leave every server-only value (`SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `CLOUDFLARE_*`, `GITHUB_DISPATCH_TOKEN`,
  `FEEDBACK_SALT`, `PIPELINE_DATABASE_URL`) as a placeholder. They belong in Supabase function secrets and GitHub
  environments, never on a laptop. Deploys run from GitHub Actions, so you don't need `npx wrangler login`, except for
  a staging deploy the owner has approved.

## 6. Claude Code

Open Claude Code **in the repository folder** (`cd ~/Projects/City-Based-Job-Map && claude`), not in its parent, so
`CLAUDE.md` loads. The shared memory is the tracked folder [docs/claude-memory/](claude-memory/README.md), which `CLAUDE.md`
points to: nothing needs copying. Claude Code's own folder (`~/.claude/projects/-Users-<you>-Projects-City-Based-Job-Map/`)
holds only notes for that Mac.

Start each session by saying: *"Follow CLAUDE.md: sync, read the handoff, then continue."*

## 7. Check that it works, and record it

From `code/`, with Docker running for the second block:

```bash
npm run lint
npm run typecheck
npx vitest run --maxWorkers=2          # 14 Oct, Windows, 980ff4c: 46 files, 758 passed
DATA_SOURCE=seed npm run build         # static export into out/ (a build needs a data source; seed = the synthetic sample)
CI=true NEXT_PUBLIC_GEOAPIFY_KEY= npm run test:e2e   # the CI configuration; the full keyed suite takes about 18 min
npm run dev                            # http://localhost:3000 (/bangalore, /chennai, /dev/tokens, /dev/map-layer)

node scripts/test-stack.mts start --db-only
npm run test:db                        # 9 Oct, Windows: 19 files, 781 passed
npm run test:parity                    # 8 passed
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres python -m pytest scripts/pipeline/tests -q   # 89 passed
python -m pytest scripts/pilot/tests -q
node scripts/test-stack.mts stop
```

Write the results (commands, counts, commit, "macOS <version>, <chip>") in [session-handoff.md](session-handoff.md),
then commit and push as CLAUDE.md describes. Note anything that behaved differently from Windows.

### The disposable test stack

Every database and admin test runs on a **separate** Supabase stack: project `company-map-test`, database port **55322**,
API **55321**. It is built from `supabase/` into the git-ignored `code/.test-stack/`. The tests refuse any database
without its marker, including the main local one (port 54322).

```bash
node scripts/test-stack.mts start [--db-only]   # full stack (about 2 GB) for the admin e2e; --db-only for pgTAP, parity, pytest
node scripts/test-stack.mts reset               # before every `npm run test:admin`
node scripts/test-stack.mts stop                # discards it
```

Don't run `npm run test:admin` and `npm run test:db` at the same time.

### Starting the application

- **Dev server:** `npm run dev` → http://localhost:3000. It falls back to the committed synthetic sample.
- **Static preview, as deployed:** `DATA_SOURCE=seed npm run build`, then `npm run preview` → http://localhost:8788
  (the assets-only Worker, with `_headers`, `_redirects` and the 404 page).
- **Admin against a local database:** needs a main local stack (below) and a preview built with its URL and anon key in
  `.env.local`. Sign in at `/admin`.

### A main local stack on the Mac (optional)

Most work needs only the seed and the test stack. If you want the admin UI on the Mac, start a main stack of your own:

```bash
npx supabase start -x imgproxy,vector,logflare,realtime,pgadmin-schema-diff,migra,postgres-meta   # Studio kept, on :54323
```

The first start applies every migration and the **synthetic** seed. It is the Mac's own database: it is not the pilot
database, and it never syncs. Stop it with a plain `npx supabase stop`. **Never `db reset` a main stack that holds
anything you want to keep.**

### MFA enrolment

- **GitHub:** keep two-factor authentication on the account. `gh auth login --web` uses the browser sign-in, with your
  authenticator or passkey. Keep recovery codes in the password manager, never in the repository.
- **The app's administrators (TOTP, required for every admin session):** accounts are per database. On a new Mac main
  stack:
  1. In Studio (http://127.0.0.1:54323), Authentication → Add user: email and password, auto-confirm.
  2. In the SQL editor: `insert into public.admin_user (user_id, role) select id, 'admin' from auth.users where email = '<that email>';`
  3. Sign in at `/admin` on a preview built against this stack. The first sign-in shows the set-up screen (a QR code and
     a key): scan it with your authenticator app, enter the 6-digit code. Later sign-ins ask for a code.
- If the pilot database is moved (§8), its accounts and TOTP factors come with it, and your authenticator keeps working.
- The admin e2e's own accounts and TOTP secrets live in `tests/admin/global-setup.ts`, for the test stack only. Don't
  reuse them.
- **Hosted projects:** the owner enables TOTP MFA in each Supabase dashboard and creates the administrators there,
  separately per environment ([deploy-environments.md](deploy-environments.md)).

## 8. The pilot data: a separate, secure transfer

**GitHub does not carry the database.** The 46 Bengaluru pilot drafts, their 262 evidence items, the admin accounts
(with password hashes and **TOTP secrets**) and the logo files exist only in the Windows laptop's main local stack
(Docker volume `supabase_db_company-map`, at migration `20261007160000`). The OSM-derived pilot files
(`code/data/pilot/bangalore/{geocode-cache.json,import-rows.json,pilot.csv}`) are local to that laptop for the same
reason ([.gitignore](../.gitignore), D-07).

**Rules:**
- **One owner at a time.** Drafts edited in two databases can't be merged. The handoff's "Pilot database owner" row names
  the laptop whose copy is authoritative. Edit pilot data only there.
- **Never in Git, e-mail, chat, issues, or a cloud-synced folder** unless encrypted, and the passphrase never travels with
  the file.
- **The Windows database and its recovery copies stay** (`.local-backups/`, the volume) until the owner decides otherwise,
  even after a move.

**Proposed procedure (not yet run; each step needs the owner's go-ahead):**

0. **Prerequisite:** the drill's `restore` refuses a test stack at a different migration level than the backup, and a
   new test stack applies every migration in the repository. Apply the 3 pending migrations to the Windows main database
   first: the rehearsed, backup-first procedure in [PROJECT_HANDOVER.md §14.1](../PROJECT_HANDOVER.md), which also needs
   the owner's approval.
1. **Export on Windows** (from `code/`, Docker running):
   ```bash
   npx supabase start -x studio,imgproxy,vector,logflare,realtime,pgadmin-schema-diff,migra,postgres-meta
   node scripts/backup-drill.mts backup --out ../.local-backups/transfer-YYYYMMDD   # read only: dump, Storage files, snapshot
   cp data/pilot/bangalore/geocode-cache.json data/pilot/bangalore/import-rows.json data/pilot/bangalore/pilot.csv ../.local-backups/transfer-YYYYMMDD/
   npx supabase stop                                                                  # plain stop keeps the data
   cd ../.local-backups && tar -czf transfer-YYYYMMDD.tgz transfer-YYYYMMDD
   gpg --symmetric --cipher-algo AES256 transfer-YYYYMMDD.tgz && rm transfer-YYYYMMDD.tgz   # Git Bash has gpg
   ```
   Create the passphrase in the password manager.
2. **Carry only `transfer-YYYYMMDD.tgz.gpg`**, by USB drive (delete it from the drive afterwards) or over the local
   network (Mac: System Settings → General → Sharing → Remote Login on; from Windows:
   `scp transfer-YYYYMMDD.tgz.gpg <mac user>@<mac name>.local:~/`).
3. **Import on the Mac:**
   ```bash
   mkdir -p .local-backups && chmod 700 .local-backups          # from the repository root; git-ignored
   mv ~/transfer-YYYYMMDD.tgz.gpg .local-backups/ && cd .local-backups
   gpg --decrypt transfer-YYYYMMDD.tgz.gpg > transfer-YYYYMMDD.tgz && tar -xzf transfer-YYYYMMDD.tgz && rm transfer-YYYYMMDD.tgz
   ```
4. **Prove the copy is whole**, with the rehearsed drill (from `code/`):
   ```bash
   node scripts/test-stack.mts start
   node scripts/backup-drill.mts restore --from ../.local-backups/transfer-YYYYMMDD
   DRILL_PASSWORD='<an admin password>' node scripts/backup-drill.mts verify --from ../.local-backups/transfer-YYYYMMDD --sign-in <admin email>
   node scripts/test-stack.mts stop     # discard it: tests would wipe a test stack
   ```
5. **Making the Mac the owner** needs one of these, decided by the owner, then recorded in the handoff:
   - **Option A (proposed task DB-MOVE, not built):** an explicitly authorized restore into the Mac's fresh main stack
     (migrations, then data only, then Storage files), checked with `verify`. The drill refuses that target today, on
     purpose, so this is new code with its own tests.
   - **Option B:** on the Mac's main stack, re-import the drafts from the committed research and the carried OSM files
     (`LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres python -m scripts.pilot.build_import --import`),
     then check 46 drafts, 46 offices, 262 evidence items. This loses the admin accounts, the 3 logo uploads, and any edits
     made in the admin since the import.
   - **Until then the Windows laptop stays the owner**, and the Mac works with the seed and the test stack.
6. **Afterwards:** the handoff names the new owner; the old copy is stale (don't edit it, don't delete it unasked). Delete
   intermediate decrypted copies you no longer need.

## Windows-only tooling and the Mac equivalents

Checked by reading the code on 14 Oct 2026. The "macOS" column has not been run yet.

| Where | On Windows | On macOS |
| --- | --- | --- |
| `scripts/e2e-full-run.mts`: keep-awake | a PowerShell helper calls `SetThreadExecutionState` during the run | **skipped** (`keepAwake: false`). Wrap the run: `caffeinate -dims node scripts/e2e-full-run.mts --workers 2`. Mains power, lid open |
| `scripts/e2e-full-run.mts`: power events | `Get-WinEvent` writes `power-events.json` | not written. Suspensions still show as gaps over 3 min in the resource samples |
| Starting a long run in the background | PowerShell `Start-Process -WindowStyle Hidden` (`--detach` is not verified) | `nohup caffeinate -dims node scripts/e2e-full-run.mts --workers 2 > ../.local-test-runs/launch.log 2>&1 &` |
| Free-memory figures in run records | `os.freemem()` | macOS counts cached memory as used, so "free" reads lower. Compare a Mac only with itself |
| Stopping a stale test server | `Get-CimInstance Win32_Process` … `Stop-Process` (see [claude-memory/feedback-stale-test-server.md](claude-memory/feedback-stale-test-server.md)) | `pkill -x workerd; pkill -f 'wrangler dev'`, then `lsof -nP -iTCP:3100 -sTCP:LISTEN` must print nothing |
| Process-tree clean-up in `tests/admin/global-setup.ts`, `scripts/smoke-local.mts`, `tests/device/cdp-setup.ts` | `taskkill /T /F` | a plain kill of the child. Not verified: after `npm run test:admin`, check `pgrep -fl 'supabase functions serve'` and stop leftovers with `pkill -f 'supabase functions serve'`. The Edge container is removed either way |
| The functions log of the admin e2e | `%TEMP%\admin-e2e-functions.log` | `$TMPDIR/admin-e2e-functions.log` |
| Restricting `.local-backups/` | `icacls` (owner account and SYSTEM only) | `chmod 700 .local-backups` |
| Copying `code/` for the pilot preview (handover §9.2) | `robocopy code <dir>\code /E /XD out .next …` | `rsync -a --exclude out --exclude .next --exclude .wrangler --exclude test-results --exclude gate-results --exclude playwright-report code/ <dir>/code/`. A real copy, `node_modules` included: **never a symlink** |
| Environment variables in a command | PowerShell: `$env:CI='true'; npm run test:e2e` | inline, as in this guide: `CI=true npm run test:e2e` |
| Python | `py -3.13`, or `python` in the venv | `python3.13`, or `python` in the venv |
| Encryption for a transfer | `gpg` from Git Bash | `gpg` from Homebrew |

Everything else is cross-platform: the npm scripts use `node -e`, the scripts build paths with `path`, and the Docker,
Supabase and Wrangler calls are the same on both. `code/scripts/smoke-production.sh` keeps its executable bit in Git
(mode 100755).

## Continue where the work stopped

1. `git status`, `git fetch origin`, then `git pull --ff-only` if you are only behind.
2. Read [session-handoff.md](session-handoff.md): the current state, branch claims, the pilot database owner, and the next
   action.
3. Follow [CLAUDE.md](../CLAUDE.md#two-laptops-github-is-the-shared-memory) for branches, pushing, and the end-of-session
   report.

## Gotchas that have cost time

- **A leftover test server serves an old build.** `npm run test:e2e` reuses anything listening on port 3100 and skips the
  rebuild. Stop stale servers first (table above). If a new test fails oddly, check that `out/_next/static` contains a
  string you just added.
- **A running `next dev` corrupts the generated types** for a build: run `rm -rf .next/dev/types && npx next typegen`
  before a build, or stop the dev server.
- **Software WebGL is slow.** The e2e suite uses 3 workers locally (2 in CI) and a 60 s test timeout; the logo and
  animation specs allow 120 s.
- **Playwright empties `test-results/` at the start of every run.** The gate keeps its numbers in `gate-results/`.
- **Low memory kills long runs.** Run one heavy job at a time (e2e, gate, a full Supabase stack).
- **Never junction or symlink `node_modules`** into a copy or worktree: a forced worktree removal followed one and deleted
  the real packages.
- **Never commit** `.env.local`, tokens, dumps, or anything under `.local-*`. CI runs gitleaks over the whole history on
  every push to `main`. Run `gitleaks git --redact --no-banner .` before pushing if you added anything that looks like a key.
