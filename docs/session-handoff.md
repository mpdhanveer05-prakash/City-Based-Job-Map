# Session handoff

**Read this first in every session, on either laptop.** It is the single place for the current state. Details live in
[progress.md](progress.md) (the dated log), [PROJECT_HANDOVER.md](../PROJECT_HANDOVER.md) (the full 9 Oct snapshot) and
[plan.md](../plan.md) (tasks). The working rules are in [CLAUDE.md](../CLAUDE.md#two-laptops-github-is-the-shared-memory).

Update the **Now** block and add a line to **Handoff log** at the end of every batch, in the same commit as the work.

## Now

| Item | Value |
| --- | --- |
| Updated | 14 Oct 2026, Windows laptop |
| Branch | `main` |
| Last validated code | `980ff4c` (DEP-5). The tree since then changes documentation and `.gitleaksignore` only |
| Synced to GitHub | Yes: pushed 14 Oct 2026 (see the log for the commit and CI run) |
| CI on `main` | **Red since 14 Oct: the dependency audit only** (`next` 16.3.7 advisories; see "Known issues"). It turns green when `task/SEC-NEXT-16.3.8` is merged. Lint, types, unit, build, e2e, pgTAP and gitleaks pass |
| Work in progress (WIP branches) | None |
| Branches awaiting the owner | **`task/SEC-NEXT-16.3.8`** at `1b53aa5`: `next` 16.3.7 → 16.3.8, the security patch for all six advisories. **Checked and pushed; not merged**, on the owner's instruction. CI green (run 38589403586), full local e2e 297/0/63. Merging it: `git switch main && git pull --ff-only && git merge --no-ff task/SEC-NEXT-16.3.8`, then push, **only on the owner's word**. Dependabot PR #11 is not merged either |
| Branch claims (who is editing what) | None. The Windows laptop released `task/SEC-NEXT-16.3.8` (no more edits planned). Claim a branch here and push before starting on it |
| Mac onboarding (MAC-1) | **Not started.** No commit from the Mac on GitHub as of 14 Oct 2026, 15:45 UTC. Nothing in [setup-new-machine.md](setup-new-machine.md) has been run on a Mac yet |
| Pilot database owner | **Windows laptop** (Docker volume `supabase_db_company-map`). The Mac has no copy yet |
| Next concrete action | **Owner:** decide whether to merge `task/SEC-NEXT-16.3.8` (then close or rebase Dependabot PR #11, which would carry `next` 16.4.0 with 12 other bumps); close the GitHub protection gaps below. **Mac:** follow [setup-new-machine.md](setup-new-machine.md) steps 1–7, record the results here, and set the MAC-1 status |

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
| 14 Oct, Windows | `1b53aa5` (branch `task/SEC-NEXT-16.3.8`) | `npm run audit`; lint; typecheck; `npx vitest run --maxWorkers=2`; `DATA_SOURCE=seed npm run build` | technical pass; clean; clean; 46 files, 758 passed; built with Next.js 16.3.8, postbuild checks pass (823 files) |
| 14 Oct, Windows | `1b53aa5` | full e2e (keyed), `node scripts/e2e-full-run.mts --workers 2` | **297 passed, 0 failed, 63 skipped** (the same by-design skips), 0 flaky, 13.9 min; budgets pass (city selection 134.3 KB) |
| 14 Oct, GitHub | `1b53aa5` | CI by hand, run [38589403586](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/38589403586) | **all 4 jobs green**: audit pass, unit 758, e2e 254 passed, pgTAP, parity 8, pytest 89, gitleaks |
| 14 Oct, Windows | `980ff4c` | `npm run lint`; `npm run typecheck`; `npx vitest run --maxWorkers=2` | clean; clean; 46 files, **758 passed** |
| 14 Oct, Windows | `main` history | gitleaks 8.30.1 (the CI version) over all of `main` | 1 finding, a false positive (below); 0 after `.gitleaksignore` |
| 12 Oct, Windows | `980ff4c` | the same unit run | 758 passed |
| 9 Oct, Windows | `ba450c3` (was `8093e91`) | full e2e, `node scripts/e2e-full-run.mts --workers 2` | **297 passed, 0 failed, 63 skipped** (all skips by design), 18.0 min |
| 9 Oct, Windows | the 9 Oct batch (`c4dd8df` … `89ee018`) | `npm run test:db`; `npm run test:admin` (test stack) | 19 files, 781 passed; 60 passed |
| 8 Oct, Windows | 8 Oct batch | parity; pipeline pytest; backup drill | 8 passed; 89 passed; verify passed twice |
| — | Mac | anything | **Not run yet.** No test has run on macOS |

CI on GitHub: see the handoff log for the run of each push. Run
[38586305911](https://github.com/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs/38586305911) on `c5285b7` (14 Oct):
gitleaks, pgTAP (database job), Playwright e2e + axe, lint, typecheck, unit tests and build **passed**; the dependency
audit step **failed** (above).

## Environment status

**GitHub** (read with `gh api`, GET only, 14 Oct 2026):
- Automation is **off**: no repository variables, so `AUTOMATION_ENABLED` and `PRODUCTION_REFRESH_ENABLED` are absent and
  every scheduled or dispatched job skips. `Deploy staging` is `disabled_manually`. The workflow token is read-only.
- A push to `main` starts only `ci.yml` (no secrets, no deploy). Pushes to other branches start nothing.
- **GitHub protection gaps, still open** (Owner; [PROJECT_HANDOVER.md §14.3–14.4](../PROJECT_HANDOVER.md); re-read
  unchanged on 14 Oct 2026, 15:23 UTC):

  | Gap | Read | Why it matters | Fix (Owner, GitHub web UI) |
  | --- | --- | --- | --- |
  | No `staging`, `production`, `production-data` environments | 0 environments | a by-hand run of a deploy workflow would create its environment **unprotected**, with no reviewer step | create all three, branch `main` only, required reviewers, admin bypass off (handover §14.4 steps 4–5) |
  | Cloudflare secrets at repository level | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | every workflow can read them, including both production workflows | put them in `staging` only, delete the repository copies, revoke the old token if broader than Workers Scripts: Edit (steps 2, 6) |
  | No ruleset on `main` | 0 rulesets, `protected: false` | force pushes and branch deletion are not blocked | branch ruleset: restrict deletions, block force pushes; no PR requirement yet (step 7) |
  | Fork-PR approval | `first_time_contributors` | the repository is public | require approval for all outside collaborators (step 8) |
  | `deploy-production.yml` and `refresh-production-data.yml` are `active` | by hand (and gated schedule/dispatch) | combined with the gaps above, a by-hand run is the only remaining path to a deploy | the gaps above; optionally disable both until the environments exist |

  Already right: no repository variables (automation off), workflow token read-only, `Deploy staging` disabled. None of
  the gaps is reachable by a push; all of them by starting a workflow by hand.

**Hosted:** no Supabase project. Staging Worker last deployed 11 Oct (synthetic sample). Production never deployed.

**Windows laptop:**
- the main local database (project `company-map`, :54322) holds the 46 pilot drafts at migration `20261007160000`;
  3 migrations are pending and not authorized (handover §14.1);
- Docker is stopped, with the data kept in its volume;
- `.local-backups/` holds the dumps, the drill backup and the pre-cleanup bundle;
- `.local-previews/` and `.local-test-runs/` hold the previews and the run records.

**Mac:** not set up yet.

## Only on the Windows laptop (never in Git)

- The pilot database, and its dumps in `.local-backups/`. To move it, see
  [setup-new-machine.md §8](setup-new-machine.md#8-the-pilot-data-a-separate-secure-transfer).
- The OSM-derived pilot files `code/data/pilot/bangalore/{geocode-cache.json,import-rows.json,pilot.csv}` (ODbL, D-07).
- `code/.env.local`, with the Geoapify key.
- The branch `backup/pre-history-cleanup-20261012`, and `.local-backups/pre-history-cleanup-20261012.bundle`. They hold
  the pre-cleanup history, with the OSM files: **never push them.** They are kept until the pushed history is confirmed
  on GitHub, then the owner decides.
- `.local-previews/` and `.local-test-runs/`: rebuildable.

## Known issues

- **The CI dependency audit fails on `next` 16.3.7** (found 14 Oct 2026; `npm run audit` fails the same way locally). Six
  advisories published since the 12 Oct audit:
  - GHSA-cjq9-62q9-8jv4 (high): SSRF in Image Optimization;
  - GHSA-3w37-wq28-93x7, -4jqv-mc3x-m676, -f87g-xv8r-7p7x and -mcj8-r9mp-w47p (moderate): draft mode, SSG/ISR cache and
    metadata routes;
  - GHSA-39w2-rjm5-chcv (low): the dev server's MCP endpoint.
  - The first patched version is **16.3.8**: GitHub Advisory Database, all six advisories published there on 7 Oct; the
    v16.3.8 release notes, 30 Sep. It also fixes GHSA-h694-7cp9-m8p3 (moderate, `use cache`), which is in the Next.js
    repository but not in the global database, so the audit doesn't report it. npm suggests 16.4.0 only because it is
    the newest release.
  - **Fixed on `task/SEC-NEXT-16.3.8`, not yet merged** (owner's instruction). Until the merge, CI on `main` stays red at
    that step only. No exception was added: the advisories are fixed, not suppressed.
  - The static export uses no image optimisation, ISR, draft mode or server, so most of them probably didn't reach the
    deployed site. That is an assessment, not a review.
- **Scheduled workflows on the gated code: not yet observed.** No scheduled run had started by 15:42 UTC on 14 Oct (the
  last ones, on `883de71`, failed as before). Expect each new scheduled run of Monitor and Data pipeline to show its job
  as *skipped*. Check with `gh run list --limit 10`.
- `--detach` in the e2e runner is not verified: a Ctrl+C of unknown origin ended its first run. Start long runs the way
  [setup-new-machine.md](setup-new-machine.md#windows-only-tooling-and-the-mac-equivalents) shows.
- `create_job_feed`'s duplicate check is case-sensitive (minor, not fixed).
- The macOS behaviour of the process clean-up in `tests/admin/global-setup.ts` and `scripts/smoke-local.mts` is not
  verified (they use `taskkill` on Windows and a plain kill elsewhere).
- gitleaks flags RFC 6238's published test secret in `code/tests/unit/totp.test.ts`. That line is allowlisted by
  fingerprint in `.gitleaksignore`; nothing else is.

## Open owner decisions

See [plan.md's register](../plan.md#open-decision-register) and handover §10.4. In short: the GitHub protections above,
D-04 coverage, D-06 devices, D-07 geocoding, a human pilot reviewer, logo permitted-use categories, hosted MFA, an
independent approver for the audit exception, the pipeline's project, the 3 pending main-database migrations, and whether
the Mac becomes the pilot-database owner.

## Handoff log

Newest first. One line per batch: date, laptop, branch, commits, what was synced, what was not.

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
