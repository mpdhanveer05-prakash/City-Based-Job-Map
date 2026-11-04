# New machine setup and old-laptop rescue (4 Nov 2026)

> **Snapshot:** 4 Nov 2026, written from commit `f95e9ae`. The live state is in
> [../session-handoff.md](../session-handoff.md); where they differ, the handoff wins. Index:
> [PROJECT_MASTER_CONTEXT.md](PROJECT_MASTER_CONTEXT.md).

From 4 Nov 2026 the owner develops on **one new Windows laptop only** ([ADR-0027](../decisions/0027-one-development-laptop.md)).
The old Windows laptop is available **for a short time**, and it is the only place that holds the pilot database and
several local-only files. So the order is:

1. **Part A:** rescue everything from the old laptop (owner, or a Claude Code session on that laptop).
2. **Part B:** set up the new laptop.
3. **Part C:** restore and verify the rescued data on the new laptop. **Release the old laptop only after C2 passes.**

The general guide, [../setup-new-machine.md](../setup-new-machine.md), still applies. This file adds what is specific to
this move.

---

## Part A: rescue from the old laptop (do this first)

**What exists only on the old laptop** (from [../session-handoff.md](../session-handoff.md), "Only on the Windows laptop"):

| Item | Where | Why it matters |
| --- | --- | --- |
| The main local database: 46 Bengaluru pilot drafts, 262 evidence items, admin accounts with password hashes and **TOTP secrets**, 3 logo uploads, the admin e2e leftovers | Docker volume `supabase_db_company-map` (Supabase project `company-map`, port 54322), at migration `20261007160000` | Not in Git, not hosted anywhere |
| The OSM-derived pilot files `geocode-cache.json`, `import-rows.json`, `pilot.csv` | `code/data/pilot/bangalore/` (git-ignored, ODbL, D-07) | Needed to re-import the drafts identically; regenerating them calls Nominatim again and gives different results and IDs |
| `.local-backups/`: earlier dumps, the 8 Oct drill backup, `pre-history-cleanup-20261012.bundle` | repository root (git-ignored, ACL-restricted) | Recovery copies; the bundle is the only copy of the pre-cleanup history (it contains OSM files: **never push it**) |
| The local branch `backup/pre-history-cleanup-20261012` | the old clone | Same content as the bundle; never push it |
| The Geoapify key | `code/.env.local` | Needed for the basemap |
| Run records | `.local-test-runs/` | Optional; evidence of earlier test runs |
| Possibly: unpushed or uncommitted work (including by Codex), Claude Code's machine-local memory | the old clone; `%USERPROFILE%\.claude\projects\…\memory\`; `%USERPROFILE%\.codex\` | **Unknown.** The owner is not sure whether anything after 2 Nov is missing from GitHub |

Run Part A in **PowerShell** unless a step says Git Bash. `<repo>` is the old laptop's clone folder. Docker Desktop must be
running. Have a USB drive and a password-manager entry ready for a new passphrase.

**Steps A1 and A2 only read. A3 changes the database and needs the owner's explicit go-ahead.**

### A1. Find unpushed or uncommitted work (read only)

```powershell
cd <repo>
git status --short --untracked-files=all
git stash list
git fetch origin
git log --exclude='backup/*' --branches --not --remotes --oneline   # local commits on no remote branch
git branch -vv
git worktree list
```

Expected if nothing is missing: a clean status, no stash, and an empty `git log` line. `backup/pre-history-cleanup-20261012` is excluded on purpose: its commits are the pre-cleanup history.

Also look for copies of the repository elsewhere, and for AI-assistant notes:

```powershell
Get-ChildItem $env:USERPROFILE -Directory -Recurse -Depth 4 -Filter 'City-Based-Job-Map' -ErrorAction SilentlyContinue | Select-Object FullName
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Directory -ErrorAction SilentlyContinue | Where-Object Name -like '*City*'
Test-Path "$env:USERPROFILE\.codex"
```

**If anything is unpushed or uncommitted** and belongs to the project, keep it on a labelled branch. Don't push it to `main`
(GitHub's `main` already has newer commits). Check `git status` first: nothing under `.local-*`, no `.env*` file, and none
of the three OSM files may be staged (all three are git-ignored).

```powershell
git switch -c wip/RESCUE-20261104-old-laptop
git add -A
git status --short                     # review before committing
git commit -m "WIP: RESCUE: unpushed work from the old Windows laptop (unchecked)"
git push origin wip/RESCUE-20261104-old-laptop
```

If the commits are on `main` (ahead of `origin/main`), push them on a branch rather than to `main`:
`git branch wip/RESCUE-20261104-main-ahead main`, then `git push origin wip/RESCUE-20261104-main-ahead`.
The new laptop then reviews and merges it ([CLAUDE.md](../../CLAUDE.md#two-laptops-github-is-the-shared-memory) rule 3).

### A2. Check the database and take a raw safety dump (read only)

From `<repo>\code`:

```powershell
npx supabase db start
docker exec supabase_db_company-map psql -U postgres -d postgres -At -c "select max(version) from supabase_migrations.schema_migrations"
docker exec supabase_db_company-map psql -U postgres -d postgres -At -F ' | ' -c "select (select count(*) from public.company), (select count(*) from public.office), (select count(*) from public.job), (select count(*) from public.field_evidence), (select count(*) from public.logo_asset), (select count(*) from public.company where not is_synthetic and status = 'draft' and domain not like '%.test')"
```

Expected values (recorded 8–9 Oct 2026):
- migration `20261007160000`;
- `117 | 137 | 115 | 275 | 3 | 46`: companies, offices, jobs, evidence items, logo uploads, pilot drafts.

**Write down what you actually get.** Different numbers are not a reason to stop. They are the state to preserve.

```powershell
New-Item -ItemType Directory -Force ..\.local-backups | Out-Null
docker exec supabase_db_company-map pg_dump -U postgres -Fc -d postgres -f /tmp/rescue-raw-20261104.dump
docker cp supabase_db_company-map:/tmp/rescue-raw-20261104.dump ..\.local-backups\rescue-raw-20261104.dump
docker exec supabase_db_company-map sh -c "pg_restore -l /tmp/rescue-raw-20261104.dump | grep -c 'TABLE DATA'"
```

The last command prints the number of table-data entries; it was 77 on 8 Oct. This dump is the safety net. Nothing has
changed in the database so far.

### A3. Apply the 3 pending migrations (needs the owner's explicit go-ahead)

**Why:** the backup drill's `restore` refuses a test stack at a different migration level from the backup. A new test
stack on the new laptop applies all 30 migrations. The 3 pending ones are data-neutral: two `CREATE OR REPLACE` function
fixes and two new nullable columns. They were rehearsed on a copy on 9 Oct with every count unchanged
([../../PROJECT_HANDOVER.md](../../PROJECT_HANDOVER.md) §14.1).

```powershell
npx supabase migration list --local     # must show exactly 20261008090000, 20261008100000, 20261008110000 as pending
npx supabase migration up --local       # applies only those; NEVER `db reset`
npx supabase migration list --local     # all applied
```

Re-run the count query from A2. The numbers must be identical. If a migration fails, it rolls back on its own: stop
and record the error. The A2 dump is the way back.

**If the owner declines A3,** skip it. The A2 dump still holds everything, but restoring it on the new laptop then needs
extra work (a test stack at the old migration level).

### A4. Full backup with Storage files (read only)

The drill reads the running main stack's keys from `supabase status`, so it needs the full stack with Storage:

```powershell
npx supabase stop                       # plain stop keeps the data; never --no-backup
npx supabase start -x studio,imgproxy,vector,logflare,realtime,pgadmin-schema-diff,migra,postgres-meta
node scripts/backup-drill.mts backup --out ..\.local-backups\transfer-20261104
```

It writes a full `pg_dump`, every logo file with its SHA-256, and a snapshot (row counts and content hashes per table,
grants, policies, visibility) that `verify` compares later. On 8 Oct it reported 32 tables, 1,624 rows and 5 files.

### A5. Add the local-only files

```powershell
$t = '..\.local-backups\transfer-20261104'
New-Item -ItemType Directory -Force "$t\pilot-osm", "$t\notes" | Out-Null
Copy-Item data\pilot\bangalore\geocode-cache.json, data\pilot\bangalore\import-rows.json, data\pilot\bangalore\pilot.csv "$t\pilot-osm\"
```

- **Claude Code's local memory:** copy the `memory\*.md` files of the project folder found in A1 into `$t\notes\claude-memory\`.
  The new laptop merges any project knowledge into [../claude-memory/](../claude-memory/README.md).
- **Codex:** copy only instruction or notes files you wrote yourself. **Never copy `auth.json`** or any file holding tokens.
- `.local-backups\` already holds the older dumps and `pre-history-cleanup-20261012.bundle`; they travel with it. The owner
  decides later whether to keep the bundle. GitHub's history was confirmed free of the OSM files on 4 Nov 2026.

### A6. The Geoapify key: by hand, into the password manager

Open `code\.env.local` in an editor and copy the `NEXT_PUBLIC_GEOAPIFY_KEY` value into the password manager. Do this
**yourself, not through an AI assistant**: the key would land in its transcript. Don't put `.env.local` in the archive.

### A7. Stop, archive, encrypt, carry

```powershell
npx supabase stop                       # plain stop; the volume and its data stay
```

Then in **Git Bash**, from `<repo>`:

```bash
tar -czf ~/rescue-20261104.tgz .local-backups .local-test-runs    # drop .local-test-runs if you don't want the run records
gpg --symmetric --cipher-algo AES256 ~/rescue-20261104.tgz         # passphrase from the password manager
rm ~/rescue-20261104.tgz
ls -l ~/rescue-20261104.tgz.gpg
```

Copy only `rescue-20261104.tgz.gpg` to the USB drive. The passphrase never travels with it.

### A8. Before releasing the old laptop

- [ ] A1: nothing unpushed, or it is on a `wip/RESCUE-*` branch that is visible on GitHub
- [ ] A2: counts written down; raw dump copied and listed
- [ ] A3: applied (counts unchanged), or explicitly declined by the owner
- [ ] A4: drill backup written
- [ ] A5: OSM files copied; notes copied (no secrets)
- [ ] A6: Geoapify key in the password manager
- [ ] A7: encrypted archive on the USB drive, passphrase in the password manager
- [ ] **C2 passed on the new laptop**
- [ ] The owner's decision on the history bundle is recorded in the handoff

---

## Part B: set up the new laptop

**State on 4 Nov 2026** (read-only checks):

| Item | Found |
| --- | --- |
| Machine | Windows 11 Pro 22621; Intel i5-1235U; Iris Xe; 31.7 GB RAM (18.6 GB free); 380 GB free on C: |
| Git | 2.56.0. Identity set globally on 4 Nov to the history's author. `pull.rebase=false`; `.gitattributes` forces LF |
| Node | **v26.13.0**: the project and CI use 24 (`engines: >=24`; the guide pins 24.14.1) |
| npm | 11.20.0 |
| Python | **missing** (only the Microsoft Store alias) |
| Docker, WSL2 | **missing** |
| gh | **missing** |
| Chrome | installed |
| Clone path | `C:\Users\dhanveerp\Documents\City Job Map\City-Based-Job-Map`, which **contains spaces** (the guide says not to). The owner chose to re-clone |

### B1. Re-clone to a path without spaces (owner)

```powershell
New-Item -ItemType Directory -Force C:\dev | Out-Null
git clone https://github.com/mpdhanveer05-prakash/City-Based-Job-Map.git C:\dev\City-Based-Job-Map
```

Open Claude Code in `C:\dev\City-Based-Job-Map` (the repository folder, so `CLAUDE.md` loads). The old clone under
`Documents\City Job Map\` can be deleted once `git status` there is clean and `git log origin/main..main` is empty.

### B2. Tools

| Tool | Install | Verify |
| --- | --- | --- |
| Node 24.14.1 (via fnm, the same manager the Mac guide uses) | `winget install Schniz.fnm`; then `if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Force $PROFILE }` and `Add-Content $PROFILE 'fnm env --use-on-cd --shell powershell \| Out-String \| Invoke-Expression'`; open a new terminal; `fnm install 24.14.1`; `fnm default 24.14.1` | `node -v` prints v24.14.1 (Node 26 can stay installed; fnm's copy comes first on `PATH`) |
| Python 3.13 | `winget install Python.Python.3.13`; then Settings → Apps → Advanced app settings → App execution aliases: turn off `python.exe` and `python3.exe` | `py -3.13 --version` |
| WSL2 + Docker Desktop | elevated PowerShell: `wsl --install`, reboot; `winget install Docker.DockerDesktop`; start Docker Desktop once | `docker version` (Client and Server); `docker run --rm hello-world` |
| GitHub CLI | `winget install GitHub.cli`; `gh auth login --hostname github.com --git-protocol https --web`; `gh auth setup-git` | `gh auth status` |
| GnuPG | ships with Git for Windows | Git Bash: `gpg --version` |
| gitleaks 8.30.1 | optional (CI runs it) | `gitleaks version` |

Docker's WSL2 backend gets half the RAM by default (about 16 GB here), which is enough for both Supabase stacks (about 2 GB
each).

### B3. Dependencies and local settings

From `C:\dev\City-Based-Job-Map\code`:

```powershell
npm ci
npx playwright install chromium
py -3.13 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r scripts/requirements.txt
```

Use `npm ci`, never `npm install`. Never copy or link `node_modules` from anywhere.

Create `.env.local` **after** the CI-mode e2e run in B4 (see the note there): `Copy-Item .env.example .env.local`, then
paste the Geoapify key from the password manager. Leave `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as
placeholders unless you build against a local stack. A real anon key there makes the e2e build read the local stack
instead of the seed. Server-only values never go on a laptop.

### B4. Baseline checks: record each result in the handoff

From `code/`, one heavy job at a time. Expected values are the last recorded ones (old laptop, 2 Nov 2026, `8aaefc4`; DB
suites 9 Oct). A difference is a finding to explain, not a failure to hide.

| # | Command (PowerShell) | Expected |
| --- | --- | --- |
| 1 | `gh run list --branch main --limit 3` | CI state of `main` |
| 2 | `npm run audit`, then `npm run audit -- --release` | pass, pass. New advisories appear often; a failure needs the owner (ADR-0019) |
| 3 | `npm run lint`; `npm run typecheck` | clean, clean |
| 4 | `npx vitest run --maxWorkers=2` | 46 files, 758 passed |
| 5 | `$env:DATA_SOURCE='seed'; npm run build; Remove-Item Env:DATA_SOURCE` | export written; postbuild passes (823 files) |
| 6 | CI-mode e2e, **before `.env.local` exists**: `$env:CI='true'; npm run test:e2e; Remove-Item Env:CI` | about 254 passed in CI's configuration (2 workers, map specs desktop-only) |
| 7 | Keyed full run (after `.env.local` has the key, tree clean, nothing on :3100): `Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'scripts/e2e-full-run.mts','--workers','2'` | 297 passed, 0 failed, 63 skipped (record in `..\.local-test-runs\`) |
| 8 | `node scripts/test-stack.mts start --db-only`; `npm run test:db` | 19 files, 781 passed |
| 9 | `npm run test:parity` | 8 passed |
| 10 | `$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55322/postgres'; python -m pytest scripts/pipeline/tests -q` | 89 passed |
| 11 | `python -m pytest scripts/pilot/tests -q` | 24 passed |
| 12 | `node scripts/test-stack.mts stop`; then `node scripts/test-stack.mts start` (full); `node scripts/test-stack.mts reset`; `npm run test:admin` | 60 passed |

**Notes:**
- **Row 6:** in Windows PowerShell, `$env:NEXT_PUBLIC_GEOAPIFY_KEY=''` *deletes* the variable, and Next then reads the
  key from `.env.local`. The run would quietly become a keyed run. Running before `.env.local` exists avoids that. In Git
  Bash, `CI=true NEXT_PUBLIC_GEOAPIFY_KEY= npm run test:e2e` also works.
- **Rows 7 and 12:** before any e2e run, stop stale `wrangler`/`workerd` processes
  ([../claude-memory/feedback-stale-test-server.md](../claude-memory/feedback-stale-test-server.md)).
- **Row 12:** never run `test:admin` together with `test:db`.
- **Never** `npx supabase db reset`, `npx supabase test db`, or `npx supabase stop --no-backup` against the main stack.

---

## Part C: restore and verify the rescued data on the new laptop

### C1. Unpack

From the repository root (`C:\dev\City-Based-Job-Map`), in PowerShell:

```powershell
New-Item -ItemType Directory -Force .local-backups | Out-Null
icacls .local-backups /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" "SYSTEM:(OI)(CI)F"
```

Copy `rescue-20261104.tgz.gpg` from the USB drive to your home folder, then in **Git Bash**:

```bash
cd ~ && gpg --decrypt rescue-20261104.tgz.gpg > rescue-20261104.tgz
tar -xzf rescue-20261104.tgz -C /c/dev/City-Based-Job-Map     # recreates .local-backups/ (and .local-test-runs/)
rm rescue-20261104.tgz
```

Delete the `.gpg` file from the USB drive once C2 has passed.

### C2. Prove the copy is whole (the gate for releasing the old laptop)

From `code/`, with Docker running:

```powershell
node scripts/test-stack.mts start                                   # full test stack: migrations + synthetic seed
node scripts/backup-drill.mts restore --from ..\.local-backups\transfer-20261104
$env:DRILL_PASSWORD = '<an administrator password>'                 # type it yourself; don't paste it into an AI chat
node scripts/backup-drill.mts verify --from ..\.local-backups\transfer-20261104 --sign-in <administrator email>
Remove-Item Env:DRILL_PASSWORD
node scripts/test-stack.mts stop                                    # discard it: it now holds a copy of real data
```

- `restore` refuses anything but the disposable test stack, and refuses a migration-level mismatch: see A3.
- `verify` must pass: content hashes per table, sequences, grants, policies, visibility, foreign keys, file bytes, logo
  records, and an MFA sign-in.
- If `verify` fails, keep the old laptop and investigate.

### C3. Make this laptop the pilot-database owner (owner decides)

The new laptop's **main** stack starts empty, with migrations plus the synthetic seed:

```powershell
npx supabase start -x studio,imgproxy,vector,logflare,realtime,pgadmin-schema-diff,migra,postgres-meta
```

Then choose one option:

| Option | How | Keeps | Loses |
| --- | --- | --- | --- |
| **B (recommended now)** | Copy the three files from `.local-backups\transfer-20261104\pilot-osm\` into `code\data\pilot\bangalore\`, then `$env:LOCAL_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'; python -m scripts.pilot.build_import --import`. Check 46 drafts, 46 offices, 262 evidence items | The drafts and their evidence (all unreviewed anyway) | The admin accounts (create new ones; [../setup-new-machine.md](../setup-new-machine.md) "MFA enrolment"), the 3 logo uploads, and any admin edits made after the import |
| **A (task DB-MOVE)** | New code with its own tests: an explicitly authorized restore of the drill backup into the main stack (migrations, then data only, then Storage files), checked with `verify` | Everything | Nothing; it costs more work |

- `build_import --import` leaves a persistent stand-in editor in the main database (`scripts/pilot/build_import.py:141-146`).
  That is fine locally; remove it before any data moves to a hosted project.
- **Afterwards:** set the handoff's "Pilot database owner" to this laptop. The encrypted archive stays as the record.
