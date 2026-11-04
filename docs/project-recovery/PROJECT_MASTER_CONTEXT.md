# Project master context (recovery index)

> **Snapshot:** 4 Nov 2026, at commit `f95e9ae`, written when the project moved to a new Windows laptop. The live state is in
> [../session-handoff.md](../session-handoff.md); where they differ, the handoff wins. These files are a dated snapshot:
> they are **not** maintained in parallel with the handoff. Update them only when they become misleading, and say so in the
> handoff log.

## What this project is

**Company Map** (domain **officemap.tech**) is a map-first company discovery portal for Indian tech cities:
- A visitor picks a city and explores companies by office location on a full-screen map. Search, filters and a
  Map/Grid/List switch cover the same result set.
- The visitor opens a company page (**Visit website**, **View jobs**), then a jobs page where each row is only a title and
  **Apply**. Apply opens the employer's own site.
- There is **no public login and no applicant data**. Only allowlisted administrators sign in, with a password and TOTP MFA.
- **Cities:** Bengaluru (`/bangalore`) goes live first; Chennai (`/chennai`) follows. Both are built and tested from the start
  (ADR-0002, ADR-0016).
- **Data:** real and verified, with reviewed evidence per field. AI may extract and organise data, but never invents it and
  never reviews it (ADR-0016, ADR-0021).

## Where it stands (4 Nov 2026)

| Area | State |
| --- | --- |
| Application code | **Feature-complete locally through Phase 9**: public site, WebGL map, filters, company and jobs pages, admin with MFA, evidence and publication gates, feeds, logos, pipeline, build and deploy safeguards, backup drill |
| Tests | Last full results (old laptop): unit 758 and e2e 297/0/63 (2 Nov); pgTAP 781, parity 8, pytest 89+24, admin e2e 60 (9 Oct); CI green 2 Nov. **None re-run on the new laptop yet** |
| Hosting | **Production never deployed.** No hosted Supabase project. Staging last showed the synthetic sample on 11 Oct; the staging workflow is disabled on GitHub |
| Real data | 46 **unreviewed** Bengaluru drafts, only in the old laptop's local database. **Chennai has none** |
| Machines | From 4 Nov 2026 **one new Windows laptop** ([ADR-0027](../decisions/0027-one-development-laptop.md)). The old laptop is available briefly and must be rescued first ([NEW_MACHINE_SETUP.md](NEW_MACHINE_SETUP.md) Part A) |
| Launch blockers | Mostly owner and human items: a data reviewer, the D-07 geocoder, D-04 coverage, hosted projects and keys, D-06 devices, monitoring, backups, DNS. The recovery analysis also found that **the build cannot produce a Bengaluru-only site** ([PENDING_WORK_AND_ROADMAP.md](PENDING_WORK_AND_ROADMAP.md), BUILD-CITY) |

## Architecture in one paragraph

- **Build:** a Next.js 16 **static export** served as an assets-only Cloudflare Worker (`company-map`; staging
  `company-map-staging`). At build time, `scripts/build-datasets.mts` reads each city's `city_build_snapshot` from Supabase
  (as anon, so RLS limits it to published data). It writes content-hashed JSON datasets, which the browser filters with one
  TypeScript mirror of the SQL `company_filter`; a CI parity test proves they agree.
- **Map:** MapLibre with a re-coloured Geoapify basemap, plus a **custom WebGL2 instanced marker layer** fed by
  **Supercluster in a Web Worker** (Comlink).
- **Backend:** Supabase Postgres/PostGIS holds the data behind RLS and deferred evidence and publication gates. There are
  four Edge Functions (`click`, `submit-feedback`, `request-rebuild`, `activate-logo`) and two Storage buckets for logos.
- **Batch:** a Python pipeline on GitHub Actions syncs employer ATS feeds and checks links and evidence.
- **Release:** production releases are manual and tagged. Data-only refreshes rebuild the last approved release (ADR-0025
  option C).

## The recovery files

| File | Read it for |
| --- | --- |
| [AI_AGENT_CONTINUATION_GUIDE.md](AI_AGENT_CONTINUATION_GUIDE.md) | Load order, binding rules, **dangerous commands**, where to change what |
| [NEW_MACHINE_SETUP.md](NEW_MACHINE_SETUP.md) | **Old-laptop rescue runbook**, new-laptop install, baseline checks, restore and verify |
| [CURRENT_STATUS.md](CURRENT_STATUS.md) | Status of every task in the brief's vocabulary, and where each claim was last verified |
| [PENDING_WORK_AND_ROADMAP.md](PENDING_WORK_AND_ROADMAP.md) | What's left, by owner and priority; risk register R1–R20; documentation drift |
| [ARCHITECTURE_DEEP_DIVE.md](ARCHITECTURE_DEEP_DIVE.md) | Layers, the 15 end-to-end flows with file references, the map pipeline, the ADR conformance table |
| [MODULE_INVENTORY.md](MODULE_INVENTORY.md) | Every folder: responsibility, key exports, status, gaps, orphaned code |
| [DATABASE_AND_DATA_FLOW.md](DATABASE_AND_DATA_FLOW.md) | 30 migrations, final schema, functions, RLS, gates, the data lifecycle, destructive commands |
| [DEVELOPMENT_HISTORY.md](DEVELOPMENT_HISTORY.md) | Timeline 30 Sep to 4 Nov 2026, incidents and the lessons they produced |

## Authoritative sources (link, don't copy)

| Topic | File |
| --- | --- |
| Rules, stack, commands | [../../CLAUDE.md](../../CLAUDE.md) |
| Current state and next action | [../session-handoff.md](../session-handoff.md) |
| Tasks and the decision register | [../../plan.md](../../plan.md) |
| Dated work log | [../progress.md](../progress.md) |
| Full 9 Oct briefing (snapshot) | [../../PROJECT_HANDOVER.md](../../PROJECT_HANDOVER.md) |
| Decisions | [../decisions/](../decisions/README.md) |
| AI working rules | [../claude-memory/](../claude-memory/README.md) |
| Specs | [../map-spec.md](../map-spec.md), [../filters.md](../filters.md), [../data-model.md](../data-model.md), [../design-system.md](../design-system.md), [../security.md](../security.md), [../testing.md](../testing.md), [../deploy-environments.md](../deploy-environments.md), [../release-checklist.md](../release-checklist.md), [../backup-restore.md](../backup-restore.md), [../curation-guide.md](../curation-guide.md), [../data-pipeline.md](../data-pipeline.md) |
| Source architecture (30 Sep) | [../../Company Map — Architecture & Implementation Plan.md](<../../Company Map — Architecture & Implementation Plan.md>) |
| BRD | **Not in the repository.** Requirement IDs are second-hand; ask for the BRD before relying on exact wording |

## How this snapshot was made

On 4 Nov 2026, Claude Code analysed the fresh clone read-only, covering every subsystem:
- documentation, memory, the handoff and plan, and 24 of the 26 ADRs read directly (0003 and 0015 are superseded);
- three parallel read-only reviews of the frontend and map engine, the database, admin and pipeline, and CI, build and tests;
- Git history and remote branches.

Nothing was installed, built or run. The test counts above are the last **recorded** results, not new ones. Claims checked
directly against the code carry file and line references in the deep-dive files.
