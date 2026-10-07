# ADR-0025: Dataset versions, update discovery, and the production rebuild policy

- **Status:** Proposed (7 Oct 2026). Part 1 is built locally; part 2 needs the owner's decision.
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

### Part 2: the production rebuild policy (for the owner to choose)
| Option | How production gets new data | Approval | Freshness | Risk |
| --- | --- | --- | --- | --- |
| **A. Manual releases only** (today) | A person runs `deploy-production.yml` (typed phrase, environment reviewers) | Every change | As often as someone releases; job links can go stale for days | Lowest automation risk; fails the launch gate's freshness target unless released daily |
| **B. Scheduled production builds, approved each time** | A schedule queues `deploy-production.yml`; a reviewer approves each run | Every run | Daily at best, if someone approves | Approval fatigue; same code risk as A |
| **C. Data-only refresh of the last approved release** (recommended) | A separate job rebuilds **the commit of the last approved release** (a release tag) with fresh data after each pipeline run and on Publish now from the production project; never new code | Code: only by a manual release (A). Data: the database's gates (reviewed evidence, reviewer-only publication, the approved-feed rule) plus `RELEASE_BUILD=1`, `check-deploy-env production`, and the launch gate on every run; a failing check leaves the previous deployment live | Within hours | Needs a release tag convention and a second workflow; data mistakes go live without a person, but only data the database already accepted under its rules |

Whichever option is chosen, staging actions must never trigger it (Publish now on staging dispatches only to staging), and
the production workflow keeps its own environment, project, and keys.

## Consequences
- Part 1 makes "changed snapshot, same URL" impossible and lets the files be cached for a year. It costs no extra files
  beyond one `current.json` per city and two header rules (5 of 100 used).
- `data_version` still exists (the database counter Publish now moves); the published folder is now the content version.
- Option C would need: a tag per approved release, a `refresh-production-data.yml` that checks out that tag, and the
  production project's `request-rebuild` dispatching a separate event type. Not built until the owner chooses.

## Verification (7 Oct 2026, local)
- Unit: `tests/unit/dataset-build.test.ts` checks the folder format, that changed content gets a new version with the same
  `data_version`, and that equal content keeps it.
- E2E: `tests/e2e/static-hosting.spec.ts` checks `current.json` is `no-cache` and a version file is `immutable` on the
  served build (wrangler dev). Not yet verified on a deployed Worker.
- The open-tab notice has no automated test yet.
