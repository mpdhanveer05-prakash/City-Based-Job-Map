# Deploy environments: staging and production

*Proposal (7 Oct 2026). Not configured on GitHub yet; the owner sets the account settings below. The workflows that need
them are committed locally and not pushed.*

Staging and production are two separate GitHub **environments**, each with its own variables and secrets. Both deploy
workflows start with `node scripts/check-deploy-env.mts <staging|production>`, which fails the run before anything is
installed or built when a value is missing, when it belongs to the other environment, or when production would use the
synthetic sample. The rules are unit-tested in `tests/unit/check-deploy-env.test.ts`.

## What the checks enforce

| Rule | Staging | Production |
| --- | --- | --- |
| A person approves the run (environment required reviewers) | Yes: by-hand, nightly, and Publish-now runs all wait | Yes, plus the typed confirmation phrase |
| `DEPLOY_ENV` equals the environment name | `staging` | `production` |
| `SITE_URL` | https; must not be a production host | must be `officemap.tech`, `www.officemap.tech`, or the `company-map` workers.dev host |
| Supabase | `SUPABASE_URL` must be `https://<SUPABASE_PROJECT_REF>.supabase.co`; anon key set; `OTHER_ENV_SUPABASE_PROJECT_REF` set and different | the same |
| Synthetic sample | only with `ALLOW_SYNTHETIC_DATA=true` **and no** Supabase values (explicit opt-in, no silent fallback) | refused (`ALLOW_SYNTHETIC_DATA`, `DATA_SOURCE`); `RELEASE_BUILD=1` also refuses it at build |
| `/dev` pages | built (`DEV_ROUTES=on`) | refused if `DEV_ROUTES=on`; the post-deploy check fails if `/dev/tokens` answers 200 |
| Visitor features (DEP-1, `lib/build-features.ts`) | with a Supabase project: basemap, admin, beacon and forms all required (`GEOAPIFY_KEY`, Supabase values, `TURNSTILE_SITE_KEY`); with `ALLOW_SYNTHETIC_DATA`: basemap only, the rest are off by design | all four required |

The same feature rule runs twice: in `check-deploy-env` before anything is installed, and in the build itself
(`scripts/check-build-config.mts`, prebuild), which also writes `public/build-info.json` (the build kind and which features
it has, booleans only). The smoke tests skip a feature the build says it lacks, with that reason, instead of failing.

`DEPLOY_ENV` and the two project refs exist so that a value set at **repository** level, which both jobs would see, cannot
satisfy both environments.

## What the owner configures (GitHub → Settings → Environments)

Create both environments. **Delete any repository-level `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SITE_URL` variables**
afterwards. Leaving them there is how one project could end up serving both environments.

**Environment `staging`**
- Protection: *Required reviewers* (you); *Deployment branches*: `main` only.
- Variables: `DEPLOY_ENV=staging`; `SITE_URL=https://company-map-staging.company-map.workers.dev`; `GEOAPIFY_KEY` (public, restricted by referrer to the staging host); and either
  - `SUPABASE_PROJECT_REF` (staging project), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OTHER_ENV_SUPABASE_PROJECT_REF` (the production project's ref), `TURNSTILE_SITE_KEY` (public), or
  - `ALLOW_SYNTHETIC_DATA=true` alone, until the staging project exists.
- Secrets: `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit; ideally a token used only for staging), `CLOUDFLARE_ACCOUNT_ID`.

**Environment `production`**
- Protection: *Required reviewers* (a second person if possible, and *Prevent self-review*); *Deployment branches*: `main` only. **Required for the data refresh:** a release counts only if a reviewer approved its run for this environment (`scripts/release-record.mts`), so without required reviewers no release can ever be refreshed.
- Variables: `DEPLOY_ENV=production`; `SITE_URL=https://officemap.tech`; `SUPABASE_PROJECT_REF` (production), `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `OTHER_ENV_SUPABASE_PROJECT_REF` (staging's ref), `GEOAPIFY_KEY` (restricted to officemap.tech),
  `TURNSTILE_SITE_KEY`. Never `ALLOW_SYNTHETIC_DATA`.
- Secrets: `CLOUDFLARE_API_TOKEN` (a separate production token), `CLOUDFLARE_ACCOUNT_ID`.

**Environment `production-data`** (the data refresh, `refresh-production-data.yml`; ADR-0025 option C, accepted 8 Oct 2026)
- Protection: *Deployment branches*: `main` only. Required reviewers are optional: the release tag, the release checks and the
  shrink guard are its gate.
- Variables: the same values as `production`.
- Secrets: `CLOUDFLARE_ACCOUNT_ID`, and a `CLOUDFLARE_API_TOKEN` scoped to the `company-map` Worker only.

**Repository variables that switch automation on (9 Oct 2026).** Pushing does not start anything that deploys, writes hosted
data or alerts. Scheduled and dispatched runs do nothing until the owner sets:
- `AUTOMATION_ENABLED=true`: the nightly and Publish-now staging deploys, the pipeline and the monitor;
- `PRODUCTION_REFRESH_ENABLED=true`: the production data refresh (a separate decision).

A run started by hand always runs. Set them only after the hosted validation (PROJECT_HANDOVER.md §14.5).

**Repository ruleset for release tags** (Settings → Rules → Rulesets → New tag ruleset)
- Target `refs/tags/release/*`. Restrict creation to the GitHub Actions app (bypass list: none for people), and block
  updates and deletions. `deploy-production.yml` creates one tag per successful release (its job has `contents: write`
  for this only). The data refresh rebuilds only the newest such tag, so a tag anyone else could create or move would be a
  way to deploy unapproved code. `scripts/release-tag.mts` also refuses a tag that is not annotated, not made by
  `github-actions[bot]`, or not on `main`.
- Changes to `.github/workflows/refresh-production-data.yml` and `deploy-production.yml` should need code-owner review on
  `main` (a `CODEOWNERS` entry plus branch protection).

The anon keys are public by design, which is why they are variables and not secrets. Nothing privileged goes in either
environment's variables.

## Outside GitHub: separation the owner must keep

- **Two Supabase projects**: their own database, Storage buckets (`company-logos`, `company-logos-pending`), Auth users,
  allowlisted `admin_user` rows, and enrolled MFA factors. Create administrators separately in each; don't copy them.
- **Edge Function secrets in each project**: `TURNSTILE_SECRET_KEY`, `FEEDBACK_SALT` (rate-limit hash; random, per project, at least 32 characters, e.g. `openssl rand -hex 32`, or the form refuses every submission), and `CLIENT_IP_HEADER` with `TRUSTED_PROXY_HOPS`. These are where the platform records the visitor's address. **Set them only after the hosted check with spoofed headers** (docs/security.md). Until then the feedback form refuses every submission, by design.
  `ALLOWED_ORIGINS` (that environment's site only), `GITHUB_DISPATCH_TOKEN` and `GITHUB_REPOSITORY` (a separate token per
  project). **Production only:** `REBUILD_EVENT_TYPE=refresh-production-data`. Staging leaves it unset, so its Publish now
  sends `rebuild`, which only `deploy-staging.yml` listens for. The production project's Publish now sends
  `refresh-production-data`, which only `refresh-production-data.yml` listens for. That workflow rebuilds the last approved
  release with production data and never new code ([ADR-0025](decisions/0025-dataset-versions-and-rebuild-policy.md)). Any
  other value makes the dispatch fail.
- **Pipeline and monitor** (`pipeline.yml`, `monitor.yml`) read the repository secret `PIPELINE_DATABASE_URL`, which isn't
  set yet, so both fail at "Check the secret is set". **Open:** which project the pipeline serves. When it is decided,
  give the job an `environment:` so the secret lives in one environment only.

## Not covered yet

- Staging still deploys before its smoke test, so a failing test leaves the new build live. The fix would be to upload a
  Worker version (`wrangler versions upload`), test its preview URL, then promote it. That needs preview URLs to work
  for an assets-only Worker; it hasn't been tried.
