# Current status (reconciled, 4 Nov 2026)

> **Snapshot:** 4 Nov 2026, at commit `f95e9ae`. The live state is in [../session-handoff.md](../session-handoff.md), and task
> statuses live in [../../plan.md](../../plan.md). Index: [PROJECT_MASTER_CONTEXT.md](PROJECT_MASTER_CONTEXT.md).

**Status values:**
- **COMPLETE:** the code exists and local tests passed (on the old laptop).
- **PARTIAL:** built with a named gap.
- **PLANNED:** not started.
- **BLOCKED:** waiting on a person, a device or an account.
- **NEEDS VERIFICATION:** a claim nobody can confirm from the new laptop yet.
- **DEPRECATED:** no longer wanted.

**Nothing has been re-run on the new laptop yet.** Every "tested" below means the old laptop's recorded runs (unit and e2e
2 Nov; database suites 9 Oct) and CI on 2 Nov.

## 1. By task

| Status | Tasks | Evidence |
| --- | --- | --- |
| **COMPLETE** | P1-01…06; P2-01…08; P3-01…04; P4-01…04; P5-01…04; P6-01…03; P7-01…04; P8-01…05 (locally); P9-02, P9-06, P9-07, P9-09, P9-12, P9-13 (locally), P9-16, P9-17, P9-19; SEC-1…4, SEC-MINOR; OPS-1/2; DEP-1…5; DB-MAIN; FEED-TESTS; FEED-CREATE; FIX-ESCAPE-URL; E2E-RUN; PILOT-TESTS; SEC-NEXT; SEC-DEPS; GIT-1 | plan.md; progress.md; code read on 4 Nov ([MODULE_INVENTORY.md](MODULE_INVENTORY.md)); GIT-1 confirmed on GitHub on 4 Nov (no OSM file in any reachable commit) |
| **PARTIAL** | P5-05 (no row-hover highlight); P4-03 (a cluster doesn't inherit the selection ring); P9-01 (no screen-reader pass); P9-03 (JS measured; devices blocked); P9-04 (local drill only); P9-05 (checklist and workflow written, never run); P9-20 (46 drafts, 0 reviewed); P9-21 / ADR-0024 (built; categories, weekly logo check and copying logos into the build missing); REBUILD-1 (built, never run); founder search (code only, no founder data) | plan.md; code |
| **PLANNED** | P6-04 (standby); P9-08; P9-10; P9-11; P9-14; P9-15; DATA-1…3 (**Chennai has no data**); ENV-1; PIPE-1; TEST-1; DOC-1; Phase 10; the new tasks in [PENDING_WORK_AND_ROADMAP.md](PENDING_WORK_AND_ROADMAP.md) | plan.md, PROJECT_HANDOVER §10 |
| **BLOCKED** | P2-09 (D-06 devices); P9-20 review (a human reviewer; D-07 geocoder); all hosted work (no Supabase project; Cloudflare and Geoapify owner actions) | handoff "Stage" |
| **NEEDS VERIFICATION** | every test count, on the new laptop; CI after 2 Nov; GitHub environments, variables and secrets (`gh` not installed on 4 Nov); the old laptop's database counts and migration level; unpushed work on the old laptop; R14's exploit chain; R19's "Show on map" defect; the Worker-version JSON shape (R3) | — |
| **DEPRECATED** | MAC-1 and DB-MOVE-to-Mac (owner, 4 Nov 2026: one laptop); P1-02's OpenNext setup (ADR-0006); `/go/*` and `/api/v1` routes (empty `.gitkeep` leftovers); "wrangler pages dev" comments | ADR-0027, ADR-0006 |

## 2. Four sources compared

| Topic | Plans and docs | Memory and handoff | Code and migrations | Tests and Git |
| --- | --- | --- | --- | --- |
| Launch order | Bengaluru first, Chennai later (ADR-0016) | same | **The build refuses a city with no published companies** (`code/scripts/build-datasets.mts:128-130`), so a Bengaluru-only release can't be built | No test covers a one-city release |
| Machines | CLAUDE.md and ADR-0026: Windows plus Mac | handoff: Mac onboarding not started | n/a | Owner, 4 Nov: one new laptop → ADR-0027 |
| Pilot data | 46 drafts at migration `20261007160000`, 3 migrations pending | same | Migrations #28–30 are data-neutral | Exists only on the old laptop; not verifiable here |
| Tool versions | setup-new-machine.md §1: Next 16.3.7, Wrangler 4.144.0, Vitest 5.0.2 | — | Lockfile: Next 16.4.3, Wrangler 4.153.0, Vitest 5.0.5, workerd 1.20261023.1 | SEC-DEPS `1fbd43c` (2 Nov) |
| Edge Functions | architecture.md line 14: "these three are the only functions" | — | four (`activate-logo` too) | — |
| Test-stack safety | CLAUDE.md, memory: never `db reset` the main DB | same | `code/vitest.parity.config.ts:4`, `code/tests/parity/filter-parity.test.ts:14,94` still tell the reader to run `db reset` | The tests themselves are guarded |
| Smoke policy | `deploy-environments.md:23-25`, `testing.md:96`: a missing feature is skipped | — | `featureTestDecision` **fails** on a required feature, skips only optional ones | unit-tested |
| Production rollback | release-checklist "Rolling back" | — | `deploy-production.yml` has no automatic rollback and no pre-deploy smoke (staging and refresh do) | never run |
| "Open jobs" count | — | UX-1 open | company page counts active plus suspect; explorer counts active only | — |
| Launch-gate thresholds | architecture plan: 800/300 companies, 95%, 24 h | D-04 open | `lib/launch-gate.ts`: 300/100, 90%, 7 days | unit-tested |
| Plan statuses | plan.md P4-01 "except build hook", P4-04 "except AC07", P5-03 "D-05 open, nine stages" | PROJECT_HANDOVER §13.3 calls these stale | the hook, AC07 tests and the seven stages exist | — |
| README | "Status: Phase 1" | — | Phase 9 | — |

PROJECT_HANDOVER §13's 22 inconsistencies (9 Oct) were spot-checked on 4 Nov:
- **Fixed since:** most of the CLAUDE.md items (founders, type filter, test counts, never `db reset`), and the
  architecture.md items on logos, the re-check function, Pages and CSP.
- **Still present:** the plan.md status items above, the architecture.md function count, the parity `db reset` comments,
  and the ADR texts listed in §13.11.
- **Not re-checked item by item:** the rest. That stays task DOC-1.

## 3. Environment facts on 4 Nov 2026

| Where | State |
| --- | --- |
| GitHub `main` | `f95e9ae` (2 Nov). 5 Dependabot branches open (actions; minor-and-patch, which includes maplibre-gl 6.16, React 19.3.1 and Playwright 1.64.1; @types/node 26; TypeScript 7; ESLint 10). Merged branches still on the remote: `design-system`, `p1-01-scaffold`, `p1-04-ci`, `task/SEC-NEXT-16.3.8` |
| Hosted | No Supabase project (per the handoff). Staging Worker last deployed 11 Oct (synthetic); Deploy staging disabled. Production never deployed |
| Old laptop | Main database (pilot), OSM files, `.local-backups/`, `.env.local`, `backup/*` branch; available briefly → [NEW_MACHINE_SETUP.md](NEW_MACHINE_SETUP.md) Part A |
| New laptop | Fresh clone at a path with spaces (re-clone planned). Node 26 instead of 24; no Python, Docker or gh; Git identity set on 4 Nov → [NEW_MACHINE_SETUP.md](NEW_MACHINE_SETUP.md) Part B |
