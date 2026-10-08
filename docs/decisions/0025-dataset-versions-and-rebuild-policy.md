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

**As built (8 Oct 2026, local, not pushed; hardened the same day):**
- **`deploy-production.yml`**, before the deploy:
  - names the release tag (`scripts/release-tag.mts name`);
  - writes the **approved baseline**, `out/data/approved-baseline.json` (`scripts/approved-baseline.mts`): the release's own
    counts per city, its tag, commit and run.

  After the smoke checks pass, it:
  - reads the serving Worker version (`wrangler deployments status --json`, `scripts/worker-version.mts`);
  - creates and pushes the annotated tag, whose message names the run;
  - uploads `out/`, the manifest, the launch-gate report and the version id as `release-<run>` (90 days).

  The smoke checks are in `scripts/smoke-production.sh`, shared by both workflows. `build-info.json` now records the commit
  each build was made from.
- **`refresh-production-data.yml`, `resolve` job** (from `main`, `actions: read`):
  - `scripts/release-tag.mts resolve` refuses the newest `release/*` tag unless it is annotated, tagged by
    `github-actions[bot]`, correctly named, and on `main`. It never falls back to an older tag.
  - **Release provenance comes from the release record, not from the tag.** `scripts/release-record.mts` reads the
    deploy-production run the tag names, through the GitHub API, and requires all of these:
    - the workflow is `.github/workflows/deploy-production.yml`, in this repository;
    - it ran on `main` and was started by a person (`workflow_dispatch`);
    - it finished with `success`;
    - its commit is the tag's commit;
    - a reviewer **approved** its `production` environment.

    The tag's name and tagger are a second check, never the only one.
- **`refresh` job:**
  - checks out exactly that commit, checks `HEAD`, and from then on uses the tag's own scripts;
  - runs `check-deploy-env production`, `audit --release`, the `RELEASE_BUILD=1` build, the launch gate, then
    `scripts/refresh-guard.mts`;
  - only if a city's dataset changed, and the guard passed: records the serving version, deploys, records the version it
    deployed, and smoke-tests;
  - keeps `refresh-<run>` (30 days).
- **The guard** (`evaluateRefresh` in `lib/release.ts`) stops the run unless all of these hold:
  - **The site is a build of this release.** The commit in its `build-info.json` must be the release's commit. A refresh
    therefore never deploys over a newer release whose tagging failed, or over anything deployed outside the workflows.
  - **The site's approved baseline names this release:** same tag, commit and run.
  - **No city is synthetic, missing from the build, or new.** A city goes live only through a release.
  - **No city's companies or jobs fall by more than 20%,** checked for each city separately, drops to zero included:
    - against the **last deployment**, which catches a sudden drop;
    - against the **approved baseline**, which catches a slow one: small drops that each pass the first check (100 → 90 →
      81 → 73: the third is stopped).

  On a manual run, a person may allow the shrink (the `allow_shrink` input). The new counts then become the approved
  baseline, recording that person and run. Otherwise an automatic refresh carries the baseline forward unchanged.
- **No overlap, and no rollback over something newer:**
  - Both workflows share the concurrency group `deploy-production` (`cancel-in-progress: false`): one production
    deployment runs at a time. GitHub keeps one more waiting; a newer queued run replaces an older queued one.
  - The resolve job runs when the run starts, after any release ahead of it.
  - A refresh rolls back only what it deployed. If the version serving is neither the one from before the run nor the one
    the run deployed, it does not roll back: it fails and says so.
- **Dispatch:** `request-rebuild` reads `REBUILD_EVENT_TYPE`:
  - unset → `rebuild` (staging);
  - `refresh-production-data` on the production project;
  - any other value makes the dispatch fail.
- **Tests:**
  - `tests/unit/release.test.ts` (35):
    - tag choice;
    - each guard rule: per-city drops, drops to zero, exactly 20%, creeping drops, an allowed shrink resetting the
      baseline, a foreign commit, a missing or other release's baseline, synthetic, missing and new cities;
    - each release-record rule: another workflow, failure, in progress, another commit, branch, event or repository, no or
      wrong approval, a tag naming no run;
    - version parsing.
  - `rebuild-handler.test.ts` (event type).
  - Scripts exercised locally:
    - `release-tag.mts resolve` on a scratch git repository;
    - `release-record.mts` against a stand-in GitHub API: no approval → exit 1; approved → exit 0;
    - `refresh-guard.mts` against a stand-in production site: a normal refresh → exit 0 and the baseline carried forward;
      a site built from another commit → exit 1; jobs halved → exit 1; the same allowed by a person → exit 0 and a new
      baseline recording the person and run.
  - All three deploy workflows pass `@action-validator/cli` 0.6.0.

**Hosted checks still outstanding (need GitHub and Cloudflare; none was possible locally):**
1. The tag push with `GITHUB_TOKEN` under the `release/*` ruleset. Also check that a person cannot create or move a
   `release/*` tag.
2. The release-record API calls: `GET /actions/runs/{id}` and `/approvals`, with the `actions: read` token. Check the
   approvals entry when the `production` environment has required reviewers.
3. The JSON of `wrangler deployments status --json`. It is read defensively: anything unexpected stops the run before it
   deploys.
4. `wrangler rollback` on an assets-only Worker, including the "not rolling back over a newer version" branch.
5. The schedule and `repository_dispatch` triggers. Check that staging's token cannot send `refresh-production-data`.
6. Concurrency: start a release and a refresh together and confirm one waits.
7. A first release end to end: tag, artifact, `approved-baseline.json` and `build-info.json` commit on the live site, then
   a refresh that deploys, one that finds nothing changed, and one stopped by the guard.

**Owner setup before it can run:**
- the production Supabase project, and the `production` (with required reviewers) and `production-data` environments;
- the `release/*` tag ruleset;
- a production-only dispatch token, and `REBUILD_EVENT_TYPE=refresh-production-data` in the production project's function
  secrets;
- confirm the shrink-guard threshold (20% stays **provisional**);
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
