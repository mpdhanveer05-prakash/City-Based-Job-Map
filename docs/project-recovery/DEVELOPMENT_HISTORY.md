# Development history (30 Sep to 4 Nov 2026)

> **Snapshot:** 4 Nov 2026, at commit `f95e9ae`. Index: [PROJECT_MASTER_CONTEXT.md](PROJECT_MASTER_CONTEXT.md). The detailed,
> dated record is [../progress.md](../progress.md), newest first. Hashes here are the ones on GitHub. Older hashes quoted in
> progress.md are pre-cleanup; [../history-cleanup-plan.md](../history-cleanup-plan.md#old-to-new-hashes) maps them.

`main` has 109 commits by one author. The work was done with Claude Code (and, the owner says, Codex) on a Windows laptop.
A Mac was planned but never set up. On 4 Nov 2026 the project moved to a new Windows laptop.

## Timeline

| Date (2026) | What happened | Key commits | Decisions |
| --- | --- | --- | --- |
| 30 Sep | BRD (not in the repo), architecture plan, design system. P1-01 scaffold; P1-04 CI; P1-02 OpenNext on Workers (CPU too high for Free); P1-06 static export on Workers static assets; D-10 option A (separate jobs pages) | `1f65dcf`, `2f2fd3b`, `bf62bdd`, `d0eed1b`, `687cd3e`, `521b519` | ADR-0001…0007 |
| 1 Oct | P1-03 local Supabase; P1-05 Geoapify basemap; P2-01 fixtures; P2-02 clustering worker; P2-03 WebGL layer; P2-04 logo atlas | `4a7f7f4`, `3518d96`, `a359927`, `dec6a8b`, `e54d7cf`, `6939d62` | ADR-0008, 0009 |
| 2 Oct | P2-05 animation; P2-06 hit testing and spider; P2-07 popup, keyboard list, fallbacks; P2-08 lifecycle. P2-09 gate Blocked on devices (D-06) | `3ac8e22`, `5fdc706`, `5cc8148`, `5533d25` | — |
| 3 Oct | P3-01…04 schema, RLS, shared filter SQL, synthetic seed; P4-04 URL state; P4-01 datasets and the parity test | `8a9129a`, `09ea7ee`, `63a8eba`, `213ea66`, `5cdde30`, `423e218` | ADR-0004 accepted (D-02) |
| 4 Oct | Informal map gate on the laptop GPU (harness built, a real bug fixed, full run not completed for lack of memory). Mac hand-off prepared | `b970aad`, `2aa3f60` | — |
| 5 Oct | Back to the Windows laptop only. P4-02 city page; P4-03 explorer; P5 search, filters, Grid and List; P6 company and jobs pages, click beacon; P7 admin; P8 pipeline and feedback; P9-02 CSP | `0fd00a3`, `8479afb`, `3df5680`, `8afcd90`, `05c7c9b`, `c237f9e`, `436081c` | ADR-0010…0015 |
| 6 Oct | Owner decisions (ADR-0016…0020). P9-06 ownership status; P9-09 audit gate; P9-07 evidence and publication gates; feed governance; P9-17 prefetch fix; Bengaluru pilot research and local draft import; publication rule restored | `59ca0e3`, `883de71`, `571378f`, `88962b3`, `08d8b0b`, `479fd48`, `fae4326` | ADR-0016…0023 |
| 7 Oct | P9-13 admin MFA; P9-21 logos; pilot preview; device tooling (P2-09a/b); DEF-1…3; SEC-1…4 and the listing rule; disposable test stack (OPS-1/2); DEP-1; DEP-2 content-versioned datasets; PROJECT_HANDOVER.md written | `766e645`, `6418f33`, `74b213e`, `0e50a9c`, `42cbdfd`, `9c182f0`, `0bfb4ab` | ADR-0024 (proposed), ADR-0025 (proposed) |
| 8 Oct | Logo SHA-256 activation; main local database migrated without a reset (DB-MAIN); ADR-0025 option C built (REBUILD-1); P9-12 JS budget 629 → 566 KB; backup drill rewritten; feed and pilot tests; SEC-MINOR; Dependabot report; history-cleanup plan | `766d5d0`, `7dc164d`, `4f92129`, `0714dbb`, `219f8f9`, `44ea826`, `68c9ba5`, `a6d49c8` | ADR-0025 option C accepted |
| 9 Oct | DEP-3/4 staging smoke and validate-before-deploy; automation gate; FEED-CREATE; device-tooling tests; recorded e2e runner; Escape/URL fix; Modern Standby traced; **full suite 297/0/63**; transition checklist | `c4dd8df`, `3e4f48d`, `89ee018`, `2d8105e`, `4304437`, `caefae1`, `c1548cd` | — |
| 12 Oct | GIT-1 history cleanup run locally (OSM files and Claude trailers removed from unpushed commits); DEP-5; transition policies | `273bfd4`, `2976007`, `e327f18`, `980ff4c` | — |
| 14 Oct | Two-laptop workflow; the 47 local commits pushed (fast-forward); CI red only on new `next` advisories. SEC-NEXT (16.3.8) on a task branch | `c5285b7`, `1b53aa5` | ADR-0026 |
| 2 Nov | SEC-NEXT merged; SEC-DEPS (`next` 16.4.3, `zod` 4.6.7, `vitest` 5.0.5, `wrangler` 4.153.0; the release audit gate passes); Next 16.4 checkbox regression fixed; GitHub environments, ruleset and fork-PR approval set; **CI green** | `371596a`, `2d7f2bc`, `8aaefc4`, `1fbd43c`, `1d8cf51`, `f95e9ae` | — |
| 4 Nov | Moved to a new Windows laptop (fresh clone). Read-only recovery analysis; owner: **one laptop only**; old laptop available briefly | (this batch) | ADR-0027 |

The owner's standing instruction since 2 Nov: *"proceed with all the pending tasks and make the application live as soon as
possible"*. It was taken to cover merges and protective settings, **not** deployments, Dependabot merges or human review.

## Machines

| Period | Machine setup |
| --- | --- |
| 30 Sep – 3 Oct | One Windows laptop |
| 4 Oct | Mac hand-off prepared (never used) |
| 5 – 13 Oct | Windows laptop only (`0fd00a3`) |
| 14 Oct – 3 Nov | "Two laptops" (ADR-0026); the Mac was never set up |
| From 4 Nov | **One new Windows laptop** ([ADR-0027](../decisions/0027-one-development-laptop.md)); the old laptop is being rescued |

## Incidents and the rules they produced

| Date | Incident | Resulting rule or fix |
| --- | --- | --- |
| 1–5 Oct | Playwright reused a stale `wrangler dev` on :3100 and tested an old build (several times) | [feedback-stale-test-server](../claude-memory/feedback-stale-test-server.md) |
| 4 Oct | Map gate numbers lost: Playwright empties `test-results/` | write to `gate-results/` ([feedback-playwright-wipes-test-results](../claude-memory/feedback-playwright-wipes-test-results.md)) |
| 5 Oct | The Bash tool collapsed backslashes and put U+2028 into a TypeScript file | use Write/Edit for escapes ([feedback-bash-tool-backslashes](../claude-memory/feedback-bash-tool-backslashes.md)) |
| 5 Oct | Admin e2e false failures (stray `next dev`, Docker DNS 503, low memory) | [feedback-admin-e2e-and-local-stack](../claude-memory/feedback-admin-e2e-and-local-stack.md) |
| 6 Oct | OSM-derived pilot coordinates were committed (licence unresolved) | git-ignored (`4abd5bd`); removed from history by GIT-1 on 12 Oct (verified absent on GitHub, 4 Nov) |
| 6 Oct | The publication rule had been weakened to accept claimed evidence | restored (`fae4326`, migration `20261007090000`) |
| 7 Oct | **The main local database was reset twice by test runs**, erasing the pilot drafts (re-imported) | never reset the main database; disposable test stack with guards ([feedback-protect-local-db](../claude-memory/feedback-protect-local-db.md)) |
| 7 Oct | `git worktree remove --force` followed a `node_modules` junction and deleted the real packages | [feedback-no-junction-node-modules](../claude-memory/feedback-no-junction-node-modules.md) |
| 7–11 Oct | The old `deploy-staging.yml` nightly deployed staging **six times without approval** (smoke failed each time) | automation gate (`AUTOMATION_ENABLED`), environment reviewers; the workflow disabled on GitHub |
| 9 Oct | Full e2e runs hung overnight; traced to Windows Modern Standby | `e2e-full-run.mts` keeps the machine awake and flags suspension |
| 9 Oct | Escape didn't clear `?company=` (a race in the URL-tidying effect) | fixed (`4304437`), regression e2e |
| 14 Oct / 2 Nov | New `next`, `undici`, `vite` and `zod` advisories turned the CI audit red | SEC-NEXT, SEC-DEPS; ADR-0019 register now empty |
| 2 Nov | Next 16.4's router queue made filter checkboxes lag their URL writes (5 e2e failures) | `useExplorerState` reads its own writes through `useSyncExternalStore` (`8aaefc4`) |

## Attribution

The owner wants only their name in the history (30 Sep 2026). GIT-1 removed Claude trailers from the commits that weren't
yet pushed. The 38 commits pushed earlier still carry them; removing those would need a force-push, which is not
recommended and not authorized.
