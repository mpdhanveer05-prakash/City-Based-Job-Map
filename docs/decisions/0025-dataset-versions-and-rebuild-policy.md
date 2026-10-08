# ADR-0025: Dataset versions, update discovery, and the production rebuild policy

- **Status:** Accepted (8 Oct 2026): the owner chose **option C** for part 2. Part 1 and option C are built locally; neither has run on GitHub or Cloudflare.
- **Date:** 2026-10-07
- **Related tasks / decisions:** DEP-2 and REBUILD-1 (PROJECT_HANDOVER.md), ADR-0006 (static datasets), ADR-0012 (Publish now), ADR-0013 (pipeline), ADR-0022 (refresh), [docs/deploy-environments.md](../deploy-environments.md)

## Context
Each city's dataset is a set of static JSON files written at build time. Until now their folder was the database's
`city.data_version`, which only **Publish now** increments. A pipeline run or the nightly build could change a city's data
(a job expired, a link changed) and write it under the **same** URL, so a URL no longer identified one content. There was no
cache rule for `/data/*`, and an open explorer tab had no way to learn that newer data existed. Separately, every automatic
rebuild (nightly, Publish now, pipeline) targets **staging**; production changes only when someone runs the production
workflow by hand, so job freshness in production depends on how often a person releases.

## Decision

### Part 1: content-versioned datasets (built locally, not deployed)
1. **Folder = data_version plus content hash.** `scripts/build-datasets.mts` publishes each city's files under
   `/data/<city>/<data_version>-<12 hex of SHA-256 over the four files>/` (`datasetVersion()` in `lib/filters/dataset-files.ts`).
   Any change in content gives a new folder, whatever triggered the build; an unchanged rebuild gives the same folder.
   The manifest records it as `dataset_version`.
2. **Caching.** `public/_headers`: files in a version folder (`/data/:city/:version/:file`) are
   `public, max-age=31536000, immutable`; the pointer `/data/:city/current.json` is `no-cache`.
3. **How an open tab discovers updates.**
   - A new page load gets the current HTML, which names the current folder (the paths are baked in at build time).
   - A tab already open keeps the data it loaded. When it becomes visible again (at most once every five minutes), or is
     restored from the back/forward cache, the explorer reads `/data/<city>/current.json` without the cache. If the version
     differs, it shows "The companies in <city> have been updated since this page loaded" with a **Reload** button. Nothing is
     swapped under the visitor.
   - A deployment replaces the whole asset set, so an old version's files disappear. A tab that then fetches one (for
     example `search.json`, loaded on first search) gets a 404 and already says "The city data has been updated since this
     page loaded. Reload the page to get the new data."
   - Prerendered company and jobs pages are separate HTML documents; a visitor sees new content on their next navigation.

### Part 2: the production rebuild policy (owner chose C, 8 Oct 2026)
| Option | How production gets new data | Approval | Freshness | Risk |
| --- | --- | --- | --- | --- |
| **A. Manual releases only** (today) | A person runs `deploy-production.yml` (typed phrase, environment reviewers) | Every change | As often as someone releases; job links can go stale for days | Lowest automation risk; fails the launch gate's freshness target unless released daily |
| **B. Scheduled production builds, approved each time** | A schedule queues `deploy-production.yml`; a reviewer approves each run | Every run | Daily at best, if someone approves | Approval fatigue; same code risk as A |
| **C. Data-only refresh of the last approved release** (recommended) | A separate job rebuilds **the commit of the last approved release** (a release tag) with fresh data after each pipeline run and on Publish now from the production project; never new code | Code: only by a manual release (A). Data: the database's gates (reviewed evidence, reviewer-only publication, the approved-feed rule) plus `RELEASE_BUILD=1`, `check-deploy-env production`, and the launch gate on every run; a failing check leaves the previous deployment live | Within hours | Needs a release tag convention and a second workflow; data mistakes go live without a person, but only data the database already accepted under its rules |

Whichever option is chosen, staging actions must never trigger it (Publish now on staging dispatches only to staging), and
the production workflow keeps its own environment, project, and keys.

### Option C in detail (accepted 8 Oct 2026; built locally, never run)
**Goal:** production data refreshes automatically, while production **code** changes only through a person's approved
release. A refresh rebuilds the exact commit of the last approved release with fresh production data, or it does nothing.

1. **Approved releases are recorded, immutably.**
   - When `deploy-production.yml` succeeds (typed phrase, `production` environment reviewers, audit, launch gate), its last
     step creates an annotated tag `release/<UTC date>-<run number>` on the commit it built, and records the deployed Worker
     version id in the tag message.
   - The tag namespace is protected (repository ruleset: only the `github-actions` app may create `release/*`; nobody may
     move or delete one).
   - The `out/` folder, `manifest.json`, the launch-gate report, and the Worker version id are uploaded as a workflow
     artifact (retention 90 days), keyed by the tag.
2. **A separate workflow refreshes data only:** `refresh-production-data.yml`.
   - Triggers:
     - `repository_dispatch` of type `refresh-production-data`, sent only by the **production** Supabase project's
       `request-rebuild` and by the production pipeline run;
     - a schedule, every 6 hours after the pipeline;
     - by hand.
   - Staging never sends this event type, and staging's token cannot (separate fine-grained tokens per project).
   - Environment `production-data`: production variables only (`DEPLOY_ENV=production`, the production project ref and anon
     key, `OTHER_ENV_SUPABASE_PROJECT_REF` = staging), and its own Cloudflare token scoped to the `company-map` Worker.
     Required reviewers are optional; the checks below are the gate.
3. **The exact approved commit, never newer code.**
   - The job resolves the newest `release/*` tag, verifies it is an annotated tag created by the workflow, checks out
     `refs/tags/<tag>`, and asserts `git rev-parse HEAD` equals the tag's commit.
   - It refuses if the tag's commit is not an ancestor of `main` (no orphan or rewritten release).
   - Workflow and scripts run from the tag's tree too: the job calls the tag's `scripts/`, not `main`'s.
   - A change to this workflow file itself needs code-owner review on `main`.
4. **Production data only, and every check of a release.**
   - `check-deploy-env production` (no synthetic data, no `DEV_ROUTES`, separate projects, required visitor features).
   - `RELEASE_BUILD=1`: refuses synthetic, pilot-preview, and any company or job whose evidence is incomplete.
   - `npm run audit -- --release`: an exception that expired since the release blocks the refresh.
   - The launch gate for every live city.
   - A **shrink guard** (new): refuse when a city's published companies or open jobs drop by more than an agreed share
     (proposal: 20%) against the deployed manifest, so a bad import or mass unpublish waits for a person.
   - If nothing changed (every city's `dataset_version` equals the deployed one), stop: no deployment.
5. **No overlap.**
   - `refresh-production-data.yml` and `deploy-production.yml` share one concurrency group (`deploy-production`,
     `cancel-in-progress: false`), so at most one production deployment runs and one waits.
   - If a newer release tag appears while a refresh waits, the refresh re-resolves the tag when it starts.
6. **Rollback.**
   - Before deploying, it records the currently deployed Worker version id.
   - After `wrangler deploy` it runs the production smoke checks, including `build-info.json` against policy.
   - On failure it runs `wrangler rollback <previous version id>` and fails the run. Every refresh also uploads its `out/`,
     manifest and launch-gate report as an artifact (retention 30 days), so any earlier state can be redeployed by hand.
7. **Visibility.** Each run writes a summary: tag, commit, dataset versions before and after, the counts per city, and the
   Worker version deployed or rolled back.

**What it does not do:** it never builds `main`, never deploys code that no person approved, never uses staging data or keys,
and never runs while another production deployment is in progress.

**As built (8 Oct 2026, local, not pushed):**
- `deploy-production.yml`: after the smoke checks pass, it reads the serving Worker version (`wrangler deployments status
  --json`, `scripts/worker-version.mts`), creates and pushes the annotated tag (`scripts/release-tag.mts name`), and uploads
  `out/`, the manifest, the launch-gate report and the version id as `release-<run>` (90 days). The smoke checks moved to
  `scripts/smoke-production.sh`, shared by both workflows.
- `refresh-production-data.yml`: a `resolve` job runs `scripts/release-tag.mts resolve` from `main`. It refuses the newest
  `release/*` tag unless it is annotated, tagged by `github-actions[bot]`, correctly named, and on `main`, and it never falls
  back to an older tag. The `refresh` job checks out that commit, checks `HEAD`, and from then on uses the tag's own scripts.
  It runs `check-deploy-env production`, `audit --release`, the `RELEASE_BUILD=1` build, the launch gate and
  `scripts/refresh-guard.mts`. Only if a city's dataset changed does it record the serving version, deploy, smoke-test and,
  on any failure, `wrangler rollback` to that version. It keeps `refresh-<run>` (30 days).
- **Shrink guard:** a drop of more than 20% in a city's companies or jobs, compared with the deployed `manifest.json`,
  stops the run. Only a manual run with the `allow_shrink` input lets it through, and the summary records it. The guard
  also stops on synthetic data, a live city missing from the build, a new city (a city goes live only through a release),
  or an unreadable deployed manifest.
- **Dispatch:** `request-rebuild` reads `REBUILD_EVENT_TYPE` (unset → `rebuild`, staging; `refresh-production-data` on the
  production project; any other value fails the dispatch).
- **Tests:** `tests/unit/release.test.ts` (tag choice, shrink guard, version parsing) and `rebuild-handler.test.ts` (event
  type). `release-tag.mts resolve` was exercised against a scratch git repository: no tag, a valid tag, a newest tag off
  `main`, and a newest tag by another tagger. `refresh-guard.mts` was run against a local server: unchanged, changed, a 32%
  shrink, the same with `--allow-shrink`, and an unreachable site. Both workflows pass `@action-validator/cli` 0.6.0.

**Not verified (needs GitHub and Cloudflare):** the tag push with `GITHUB_TOKEN`; the shape of `wrangler deployments
status --json` (read defensively; anything unexpected stops the run before it deploys); `wrangler rollback` on an
assets-only Worker; the schedule and dispatch triggers.

**Owner setup before it can run:**
- the production Supabase project, and the `production` and `production-data` environments;
- the `release/*` tag ruleset;
- a production-only dispatch token, and `REBUILD_EVENT_TYPE=refresh-production-data` in the production project's function
  secrets;
- the shrink-guard threshold (20% is a proposal);
- a first release from `deploy-production.yml`.

## Consequences
- Part 1 makes "changed snapshot, same URL" impossible and lets the files be cached for a year. It costs no extra files
  beyond one `current.json` per city and two header rules (5 of 100 used).
- `data_version` still exists (the database counter Publish now moves); the published folder is now the content version.
- Option C adds a tag per approved release, `refresh-production-data.yml`, and a separate dispatch event type for the
  production project. Production data can now change without a person, but only data the database already accepted,
  through every release check, and never with new code.

## Verification (7 Oct 2026, local)
- Unit: `tests/unit/dataset-build.test.ts` checks the folder format, that changed content gets a new version with the same
  `data_version`, and that equal content keeps it.
- E2E: `tests/e2e/static-hosting.spec.ts` checks `current.json` is `no-cache` and a version file is `immutable` on the
  served build (wrangler dev). Not yet verified on a deployed Worker.
- The open-tab notice: `tests/e2e/open-tab-update.spec.ts` (added 7 Oct 2026).
