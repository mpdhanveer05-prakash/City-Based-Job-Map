# Session handoff

**Read this first in every session, on either laptop.** It is the single place for the current state. Details live in
[progress.md](progress.md) (the dated log), [PROJECT_HANDOVER.md](../PROJECT_HANDOVER.md) (the full 9 Oct snapshot) and
[plan.md](../plan.md) (tasks). The working rules are in [CLAUDE.md](../CLAUDE.md#two-laptops-github-is-the-shared-memory).

Update the **Now** block and add a line to **Handoff log** at the end of every batch, in the same commit as the work.

## Now

| Item | Value |
| --- | --- |
| Updated | 4 Nov 2026, **new Windows laptop** (fresh clone; [ADR-0027](decisions/0027-one-development-laptop.md): the only development machine from now on) |
| Branch | `main` |
| Last validated code | `8aaefc4` (SEC-DEPS), merged to `main` as `1fbd43c`: audit (technical and release) pass, lint, typecheck, 758 unit, seed build, full e2e 297/0/63, **on the old laptop**. Nothing has been run on the new laptop yet (SETUP-1) |
| Synced to GitHub | Pushed 4 Nov 2026 (documentation only; see the log) |
| CI on `main` | **Green** on `1d8cf51` (2 Nov 2026, run [41406002866](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/41406002866)): lint, types, unit, build, audit; Playwright e2e + axe; migrations + pgTAP; gitleaks. The 4 Nov push: see the log |
| Work in progress (WIP branches) | None |
| Branches awaiting the owner | None. Dependabot PRs #2, #3, #4, #13, #14 are open and not merged (owner) |
| Branch claims (who is editing what) | None. Claim a branch here and push before starting on it |
| Machines | **One new Windows laptop** from 4 Nov 2026 (ADR-0027). MAC-1 dropped. The **old Windows laptop is available only briefly** and holds the only pilot data: rescue it first (RESCUE-1) |
| Pilot database owner | **Old Windows laptop** (Docker volume `supabase_db_company-map`) until DB-RESTORE passes on the new laptop. The new laptop has no copy yet |
| Next concrete action | **1. RESCUE-1 (urgent, owner on the old laptop):** [project-recovery/NEW_MACHINE_SETUP.md](project-recovery/NEW_MACHINE_SETUP.md) Part A (unpushed-work check, raw dump, the 3 pending migrations with the owner's go-ahead, drill backup, OSM files, Geoapify key to the password manager, encrypted archive). **2. SETUP-1:** re-clone to `C:\dev\City-Based-Job-Map`, install Node 24.14.1, Python 3.13, WSL2 + Docker, gh; baseline checks (Part B). **3. DB-RESTORE:** restore and verify (Part C), then release the old laptop. **Owner (staging preview), unchanged:** a Cloudflare token (Workers Scripts › Edit) and the account ID as `staging` environment secrets, delete the repository-level copies and revoke the old token, a Geoapify key restricted to the staging host (`GEOAPIFY_KEY`), enable Deploy staging. **Production:** "Path to production" below |
| Recovery index | [project-recovery/PROJECT_MASTER_CONTEXT.md](project-recovery/PROJECT_MASTER_CONTEXT.md) (4 Nov snapshot: status, flows, risks R1–R20, dangerous commands) |

## Stage

Phases 1–9 are built and tested **locally**: the public site, the WebGL map, search and filters, company and jobs pages,
the admin with MFA, imports, evidence and publication gates, the feeds, logos, the pipeline, the build and deploy
safeguards, and the backup drill. **Nothing is in production.** Staging last ran the synthetic sample on 11 Oct 2026, from
an old workflow that is now disabled.

Blocked (unchanged since 12 Oct):
- **P2-09** map gate on real devices: needs the owner's device list (D-06);
- **P9-20** Bengaluru pilot: 46 drafts imported locally, **none reviewed**; needs a human reviewer, and coordinates need
  the D-07 geocoding provider;
- **hosted work**: no hosted Supabase project exists yet.

## Done in the latest batches

- **4 Nov (new laptop):** read-only recovery analysis of the whole repository; [project-recovery/](project-recovery/PROJECT_MASTER_CONTEXT.md)
  written (9 files); ADR-0027 (one laptop); root `AGENTS.md` for Codex; memory, `CLAUDE.md` pointers, setup-guide
  versions and plan.md updated; new tasks RESCUE-1, SETUP-1, DB-RESTORE and the code findings (BUILD-CITY: the build
  refuses a Bengaluru-only release; DEPLOY-HARDEN; WRANGLER-SAFE; SCAN-1; RLS-2; PIPE-2; UI-FIX-1; DOC-1; CI-PILOT).
  Nothing was installed, built or tested. Details in [progress.md](progress.md).
- **2 Nov:** merged SEC-NEXT (`371596a`). SEC-DEPS: new advisories since 14 Oct (`next` critical, `undici`, `vite`, `zod`
  high) fixed with `next` 16.4.3, `zod` 4.6.7, `vitest` 5.0.5, `wrangler` 4.153.0; the stale `braces` exception
  removed, so the release audit gate passes. A Next 16.4 change made filter checkboxes lag their URL writes (5 e2e
  failures); `useExplorerState` now reads its own writes synchronously (`8aaefc4`). GitHub: environments, `main`
  ruleset, fork-PR approval, `staging` variables. Details in [progress.md](progress.md).
- **14 Oct (later):** SEC-NEXT on `task/SEC-NEXT-16.3.8` (`1b53aa5`, not merged): `next` 16.3.7 → 16.3.8. Verified in
  the GitHub Advisory Database and the official v16.3.8 release notes as the first patched version for all six
  advisories, so it is a patch release rather than 16.4.0. `npm run audit`: the technical audit went from 1 problem to
  pass; the reviewed-exception file is unchanged. Details in [progress.md](progress.md).
- **14 Oct:** pushed the 47 local commits (6–12 Oct work) to GitHub after the checks below. Added the two-laptop workflow
  ([CLAUDE.md](../CLAUDE.md#two-laptops-github-is-the-shared-memory), [ADR-0026](decisions/0026-two-laptop-workflow.md)),
  this file, shared Claude memory in [claude-memory/](claude-memory/README.md), the macOS onboarding in
  [setup-new-machine.md](setup-new-machine.md), and `.gitleaksignore` for one false positive (below).
- **12 Oct:** DEP-5, a stricter `OTHER_ENV_SUPABASE_PROJECT_REF` check (`980ff4c`). GIT-1 history cleanup: OSM-derived
  files and Claude trailers removed from the then-unpushed commits (new HEAD `273bfd4`, same tree). Transition policies
  (`e327f18`).
- **9 Oct:** the Escape/URL fix, the recorded full-run tool, and the full suite on the final application code (below).

## Test results and their commits

Hashes are the post-cleanup ones. Older hashes in progress.md are mapped in
[history-cleanup-plan.md](history-cleanup-plan.md#old-to-new-hashes).

| When, where | Commit | Command | Result |
| --- | --- | --- | --- |
| 2 Nov, Windows | `8aaefc4` (merged as `1fbd43c`) | `npm run audit`, `-- --release`; lint; typecheck; `npx vitest run --maxWorkers=2`; `DATA_SOURCE=seed npm run build` | pass, pass; clean; clean; 46 files, 758 passed; built with Next.js 16.4.3 |
| 2 Nov, Windows | `8aaefc4` | full e2e, `node scripts/e2e-full-run.mts --workers 2` | **297 passed, 0 failed, 63 skipped**, 0 flaky, 19.4 min. The run on `2d7f2bc` (before the fix): 292 passed, 5 failed |
| 14 Oct, Windows | `1b53aa5` (branch `task/SEC-NEXT-16.3.8`) | `npm run audit`; lint; typecheck; `npx vitest run --maxWorkers=2`; `DATA_SOURCE=seed npm run build` | technical pass; clean; clean; 46 files, 758 passed; built with Next.js 16.3.8, postbuild checks pass (823 files) |
| 14 Oct, Windows | `1b53aa5` | full e2e (keyed), `node scripts/e2e-full-run.mts --workers 2` | **297 passed, 0 failed, 63 skipped** (the same by-design skips), 0 flaky, 13.9 min; budgets pass (city selection 134.3 KB) |
| 14 Oct, GitHub | `1b53aa5` | CI by hand, run [38589403586](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/38589403586) | **all 4 jobs green**: audit pass, unit 758, e2e 254 passed, pgTAP, parity 8, pytest 89, gitleaks |
| 14 Oct, Windows | `980ff4c` | `npm run lint`; `npm run typecheck`; `npx vitest run --maxWorkers=2` | clean; clean; 46 files, **758 passed** |
| 14 Oct, Windows | `main` history | gitleaks 8.30.1 (the CI version) over all of `main` | 1 finding, a false positive (below); 0 after `.gitleaksignore` |
| 12 Oct, Windows | `980ff4c` | the same unit run | 758 passed |
| 9 Oct, Windows | `ba450c3` (was `8093e91`) | full e2e, `node scripts/e2e-full-run.mts --workers 2` | **297 passed, 0 failed, 63 skipped** (all skips by design), 18.0 min |
| 9 Oct, Windows | the 9 Oct batch (`c4dd8df` … `89ee018`) | `npm run test:db`; `npm run test:admin` (test stack) | 19 files, 781 passed; 60 passed |
| 8 Oct, Windows | 8 Oct batch | parity; pipeline pytest; backup drill | 8 passed; 89 passed; verify passed twice |
| 4 Nov, new Windows laptop | `f95e9ae` | anything | **Not run yet.** No dependencies installed (SETUP-1). Expected values: [project-recovery/NEW_MACHINE_SETUP.md](project-recovery/NEW_MACHINE_SETUP.md) B4 |
| — | Mac | anything | Never run; the Mac is dropped (ADR-0027) |

CI on GitHub: see the handoff log for the run of each push. Run
[38586305911](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/38586305911) on `c5285b7` (14 Oct):
gitleaks, pgTAP (database job), Playwright e2e + axe, lint, typecheck, unit tests and build **passed**; the dependency
audit step **failed** (above).

## Environment status

**GitHub** (read and changed with `gh api`, 2 Nov 2026):
- Automation is **off**: no repository variables, so `AUTOMATION_ENABLED` and `PRODUCTION_REFRESH_ENABLED` are absent and
  every scheduled or dispatched job skips. `Deploy staging` is `disabled_manually`. The workflow token is read-only.
- A push to `main` starts only `ci.yml` (no secrets, no deploy). Pushes to other branches start nothing.
- **Closed on 2 Nov 2026** (owner-authorized): environments `staging`, `production`, `production-data` exist (required
  reviewer: the owner; deployment branch `main` only; admin bypass off); ruleset 26348099 on the default branch blocks
  deletion and force pushes (no PR requirement yet); fork-PR approval is `all_external_contributors`. `staging` has the
  variables `DEPLOY_ENV=staging`, `SITE_URL=https://company-map-staging.company-map.workers.dev`,
  `ALLOW_SYNTHETIC_DATA=true`.
- **Still open (Owner):** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are still **repository** secrets, readable
  by every workflow. Put a new Workers Scripts: Edit token and the account ID in `staging` only, delete the repository
  copies, revoke the old token. Add the staging `GEOAPIFY_KEY` variable. Then enable Deploy staging.

**Hosted:** no Supabase project. Staging Worker last deployed 11 Oct (synthetic sample). Production never deployed.

**Old Windows laptop (available only briefly; rescue with RESCUE-1):**
- the main local database (project `company-map`, :54322) holds the 46 pilot drafts at migration `20261007160000`;
  3 migrations are pending and not authorized (handover §14.1);
- Docker is stopped, with the data kept in its volume;
- `.local-backups/` holds the dumps, the drill backup and the pre-cleanup bundle;
- `.local-previews/` and `.local-test-runs/` hold the previews and the run records.

**New Windows laptop (4 Nov 2026):**
- fresh clone at `C:\Users\dhanveerp\Documents\City Job Map\City-Based-Job-Map` (a path with spaces; re-clone to
  `C:\dev\City-Based-Job-Map` planned);
- Node 26.13.0 (the project uses 24), npm 11.20.0, Git 2.56.0; **no Python, Docker or gh yet**;
- Git identity set globally to the history's author;
- 31.7 GB RAM, i5-1235U, Iris Xe.

**Mac:** dropped (ADR-0027).

## Only on the old Windows laptop (never in Git; rescue with RESCUE-1)

- The pilot database, and its dumps in `.local-backups/`. To move it, see
  [setup-new-machine.md §8](setup-new-machine.md#8-the-pilot-data-a-separate-secure-transfer).
- The OSM-derived pilot files `code/data/pilot/bangalore/{geocode-cache.json,import-rows.json,pilot.csv}` (ODbL, D-07).
- `code/.env.local`, with the Geoapify key.
- The branch `backup/pre-history-cleanup-20261012`, and `.local-backups/pre-history-cleanup-20261012.bundle`. They hold
  the pre-cleanup history, with the OSM files: **never push them.** They are kept until the pushed history is confirmed
  on GitHub, then the owner decides.
- `.local-previews/` and `.local-test-runs/`: rebuildable.

## Known issues

- **BUILD-CITY (found 4 Nov):** `code/scripts/build-datasets.mts:128-130` refuses any city with no published companies,
  so a Bengaluru-only production release cannot be built today (ADR-0016 wants Bengaluru first). It needs an ADR and the
  owner's agreement before the code change. Other findings (R1–R20):
  [project-recovery/PENDING_WORK_AND_ROADMAP.md](project-recovery/PENDING_WORK_AND_ROADMAP.md).
- **A bare `npx wrangler deploy` targets the production Worker** (`code/wrangler.jsonc:6`). Never run it by hand.
- **Dependency audit:** fixed on 2 Nov 2026 (SEC-NEXT merged, then SEC-DEPS: `next` 16.4.3 and the rest; see progress.md).
  No exception remains, so `npm run audit -- --release` passes. New advisories appear often: re-run `npm run audit`
  before any deploy.
- `--detach` in the e2e runner is not verified: a Ctrl+C of unknown origin ended its first run. Start long runs the way
  [setup-new-machine.md](setup-new-machine.md#windows-only-tooling-and-the-mac-equivalents) shows.
- `create_job_feed`'s duplicate check is case-sensitive (minor, not fixed).
- The macOS behaviour of the process clean-up in `tests/admin/global-setup.ts` and `scripts/smoke-local.mts` is not
  verified (they use `taskkill` on Windows and a plain kill elsewhere).
- gitleaks flags RFC 6238's published test secret in `code/tests/unit/totp.test.ts`. That line is allowlisted by
  fingerprint in `.gitleaksignore`; nothing else is.

## Open owner decisions

See [plan.md's register](../plan.md#open-decision-register) and handover §10.4. In short: the Cloudflare secrets above,
D-04 coverage, D-06 devices, D-07 geocoding, a human pilot reviewer, logo permitted-use categories, hosted MFA, the
pipeline's project, the 3 pending main-database migrations (now part of RESCUE-1 step A3), option A or B for the pilot
database on the new laptop (DB-RESTORE), whether to keep the pre-cleanup history bundle, and the BUILD-CITY ADR.

### Path to production (officemap.tech), in order

Items from [release-checklist.md](release-checklist.md). **Owner** items need an account, a person or a decision;
**Dev** items Claude Code can do once those exist.
1. **Staging preview (synthetic sample):** Owner adds the Cloudflare token, account ID and Geoapify key to `staging` and
   enables Deploy staging; Dev runs it, the Owner approves the review request.
2. **Hosted Supabase:** Owner creates the staging and production projects (Free plan), sign-ups off, admins created by
   hand, MFA on; Dev applies the migrations (`supabase db push`) and runs the hosted RLS probe (checklist 2–5, 11).
3. **Real data:** a named human reviews the Bengaluru pilot (46 drafts, none reviewed) with evidence per field; D-07
   geocoding provider chosen; the Owner decides on the ODbL terms; logos with provenance (checklist 6, 7a). AI cannot be
   the reviewer (ADR-0016, ADR-0021).
4. **Gates:** Owner confirms the launch-gate thresholds and Dev runs `launch-gate.mts` (7); the map gate on the D-06
   devices or a written waiver (8); a screen-reader pass or a written waiver (10); backup drill on the hosted project (14).
5. **Production setup:** `production` variables and a separate Cloudflare token; Turnstile keys; DNS for officemap.tech;
   Sentry and Cloudflare Web Analytics; a privacy notice (4, 15–17).
6. **Owner's written deploy authorization** (who, when, which commit), then Actions → Deploy production (18).

## Handoff log

Newest first. One line per batch: date, laptop, branch, commits, what was synced, what was not.

- **4 Nov 2026, new Windows laptop, `main`:** RECOVERY-1, documentation only (project-recovery/, ADR-0027, AGENTS.md, memory, plan, progress, setup guide, this file). Checks: relative links resolve and no secret-looking strings (lint, typecheck and unit not applicable: no code changed, no dependencies installed). Pushed with this commit; CI in the next line. **Not synced:** everything in "Only on the old Windows laptop" (RESCUE-1 pending).
- **2 Nov 2026 (later), Windows, `main`:** CI run 41406002866 on `1d8cf51`: **all 4 jobs green**. Scheduled Data pipeline and Refresh production data runs now show *skipped* (the gates work). This line is pushed in a follow-up documentation commit.
- **2 Nov 2026, Windows, `main`:** merged SEC-NEXT (`371596a`) and SEC-DEPS (`2d7f2bc`, `8aaefc4`, merge `1fbd43c`); GitHub settings above. Pushed with this commit; CI run in the next line. **Not synced:** everything in "Only on the Windows laptop"; run records `.local-test-runs/20261102-*` (git-ignored).
- **14 Oct 2026 (evening), Windows, `task/SEC-NEXT-16.3.8` and `main`:** pushed the branch (`1b53aa5`, new; the push
  started no workflow). Started CI on it by hand: run 38589403586, green. Released the claim. Recorded the results on
  `main` (this commit). **Not merged** (owner). **Not synced:** everything in "Only on the Windows laptop"; the local
  run record `.local-test-runs/20261014-152733-1b53aa5/` (git-ignored).
- **14 Oct 2026 (later), Windows, `main`:** claimed `task/SEC-NEXT-16.3.8` (owner-authorized `next`-only security update); Mac onboarding status and the protection gaps refreshed. CI on `c05724a` (run 38587585117): the same as below, red at the dependency audit only.
- **14 Oct 2026, Windows, `main`:** CI run 38586305911 on `c5285b7`: every job passed except the dependency audit step
  (new `next` advisories, see "Known issues"). The only workflow the push started was CI. Dependabot then re-ran CI on its
  open PRs, as usual. This line is pushed in a follow-up documentation commit.
- **14 Oct 2026, Windows, `main`:** pushed `883de71..c5285b7` (47 earlier commits plus the documentation commit `c5285b7`)
  as a fast-forward, with no force. **Not synced:** everything in "Only on the Windows laptop".
