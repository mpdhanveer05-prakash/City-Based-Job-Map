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

`DEPLOY_ENV` and the two project refs exist so that a value set at **repository** level, which both jobs would see, cannot
satisfy both environments.

## What the owner configures (GitHub → Settings → Environments)

Create both environments. **Delete any repository-level `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SITE_URL` variables**
afterwards. Leaving them there is how one project could end up serving both environments.

**Environment `staging`**
- Protection: *Required reviewers* (you); *Deployment branches*: `main` only.
- Variables: `DEPLOY_ENV=staging`; `SITE_URL=https://company-map-staging.company-map.workers.dev`; and either
  - `SUPABASE_PROJECT_REF` (staging project), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OTHER_ENV_SUPABASE_PROJECT_REF` (the production project's ref), or
  - `ALLOW_SYNTHETIC_DATA=true` alone, until the staging project exists.
- Secrets: `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit; ideally a token used only for staging), `CLOUDFLARE_ACCOUNT_ID`.

**Environment `production`**
- Protection: *Required reviewers* (a second person if possible, and *Prevent self-review*); *Deployment branches*: `main` only.
- Variables: `DEPLOY_ENV=production`; `SITE_URL=https://officemap.tech`; `SUPABASE_PROJECT_REF` (production), `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `OTHER_ENV_SUPABASE_PROJECT_REF` (staging's ref). Never `ALLOW_SYNTHETIC_DATA`.
- Secrets: `CLOUDFLARE_API_TOKEN` (a separate production token), `CLOUDFLARE_ACCOUNT_ID`.

The anon keys are public by design, which is why they are variables and not secrets. Nothing privileged goes in either
environment's variables.

## Outside GitHub: separation the owner must keep

- **Two Supabase projects**: their own database, Storage buckets (`company-logos`, `company-logos-pending`), Auth users,
  allowlisted `admin_user` rows, and enrolled MFA factors. Create administrators separately in each; don't copy them.
- **Edge Function secrets in each project**: `TURNSTILE_SECRET_KEY`, `ALLOWED_ORIGINS` (that environment's site only),
  and `GITHUB_DISPATCH_TOKEN`. Publish now sends a `rebuild` event that only `deploy-staging.yml` listens for, and
  production has no dispatch or schedule trigger. So the production project's Publish now cannot deploy production
  until the owner decides how production rebuilds work (docs/release-checklist.md).
- **Pipeline and monitor** (`pipeline.yml`, `monitor.yml`) read the repository secret `PIPELINE_DATABASE_URL`, which isn't
  set yet, so both fail at "Check the secret is set". **Open:** which project the pipeline serves. When it is decided,
  give the job an `environment:` so the secret lives in one environment only.

## Not covered yet

- Staging still deploys before its smoke test, so a failing test leaves the new build live. The fix would be to upload a
  Worker version (`wrangler versions upload`), test its preview URL, then promote it. That needs preview URLs to work
  for an assets-only Worker; it hasn't been tried.
