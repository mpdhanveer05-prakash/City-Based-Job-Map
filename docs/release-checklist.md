# Release checklist (P9-05)

This is the list to finish before the first production deploy, and before each launch of a city. Nothing here has been done for a real launch: the project has no hosted Supabase project, no production Worker, and no real data. The right-hand column says who can do each item and what, if anything, has already been run on the development laptop.

A production deploy needs the owner's explicit authorization ([CLAUDE.md](../CLAUDE.md), "Hard rules"). The manual workflow [deploy-production.yml](../.github/workflows/deploy-production.yml) is the way to do it; it has never run.

## Before the deploy

| # | Item | Who | State on 5 Oct 2026 |
| --- | --- | --- | --- |
| 1 | Every CI job green on the release commit (checks, e2e, database, secret scan) | Engineer | CI last confirmed green on `2aa3f60`, 4 Oct (3 of 4 jobs; the red audit job is addressed by [ADR-0015](decisions/0015-dependency-audit-gate.md), unpushed). Nothing since has been pushed. |
| 2 | Hosted Supabase projects exist: **staging** and **production** (the Free plan allows two), migrations applied with `supabase db push`, pg_cron available | Owner creates, engineer applies | Not done. Migrations are tested locally only. |
| 3 | Sign-ups **off** on both hosted projects; administrators created by hand in the dashboard ([security.md](security.md), "Admin access") | Owner | Not done. |
| 4 | Secrets set: GitHub (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PIPELINE_DATABASE_URL`) and Supabase function secrets (`ALLOWED_ORIGINS`, `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPOSITORY`, `TURNSTILE_SECRET_KEY`, `FEEDBACK_SALT`); repository variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL`; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and a **referrer-restricted** Geoapify key (D-11) | Owner | Staging has the Cloudflare secrets only. |
| 5 | The pipeline login created and `PIPELINE_DATABASE_URL` stored ([security.md](security.md), "Pipeline"); one manual run of **Data pipeline** and **Monitor scheduled jobs** against staging | Owner + engineer | Not done. |
| 6 | **Real data loaded** and permitted: sources and their permission notes (D-04), logos (no upload path yet, [ADR-0012](decisions/0012-admin-workspace-and-publishing.md)), founders only after legal sign-off (D-03) | Owner | Not done. Only the synthetic sample exists. |
| 7 | **City launch gate passes for each city going live** (`node scripts/launch-gate.mts`; thresholds in `lib/launch-gate.ts` are proposals the owner confirms) | Engineer runs, owner confirms thresholds | The gate runs and **fails the synthetic sample as designed** (5 Oct 2026). |
| 8 | **Map gate on the reference devices** with each city's real data (P2-09, D-06) | Owner names devices; engineer runs `npm run gate` | **Blocked** on D-06. Only an informal run on one laptop exists. |
| 9 | **Explorer JavaScript budget decided** (D-12): measured 629 KB gzipped against the plan's 350 KB | Owner | Open. |
| 10 | axe clean (automated: yes) **and a manual pass recorded**: keyboard-only (automated checks exist in `tests/a11y/keyboard.spec.ts`), and a screen reader (NVDA on desktop, TalkBack on a phone) over the explorer, a company page, the jobs page, and the report forms | Engineer + a person with the readers | Automated part passes. **The screen-reader pass has not been done.** |
| 11 | **RLS and the anonymous probe**: `npx supabase test db` and the anonymous-API probe in `npm run test:admin`, then the same probe by hand against the *hosted* project with its anon key | Engineer | Local runs pass (508 pgTAP tests; probe in the admin spec). Hosted: not done. |
| 12 | **Secret scan clean** (CI gitleaks) and no privileged key in the build (`postbuild` scans `out/`) | CI | Runs in CI; clean on the last confirmed run. |
| 13 | **Dependency audit**: `npm run audit` passes (ADR-0019) and every entry in `code/security/audit-exceptions.json` is reviewed, owned, and unexpired | Engineer + owner | Passes locally (6 Oct 2026) with one entry: GHSA-vfj7-8cjw-p6xm (`braces`, no fix) via `eslint-config-next`, expiring 4 Jan 2027; its owner entry needs the owner's confirmation. |
| 14 | **Backup and restore drill** done ([backup-restore.md](backup-restore.md)) against the hosted production project. As far as I know the Free plan gives no downloadable automatic backups (check the current plan terms): decide who takes a dump, how often, and where it is kept | Owner + engineer | Local drill script written; **not run against a hosted project**. |
| 15 | Content-Security-Policy checked on the deployed Worker (headers and meta) in a real browser, and `_headers` and `_redirects` served as expected | Engineer | Only `wrangler dev` has served it. |
| 16 | Error reporting and analytics decided (D-07); privacy notice; retention for click counts | Owner | Open. |
| 17 | Monitoring: the missed-run workflow's failure email goes to someone who reads it | Owner | Not set up. |
| 18 | **Explicit authorization to deploy to production recorded** (who, when, which commit) | Owner | Not given. |

## The deploy

1. Make sure items 1 to 18 are done or consciously waived, in writing, in [progress.md](progress.md).
2. In GitHub: Actions, **Deploy production**, Run workflow, and type the confirmation phrase. The `production` environment should require a reviewer.
3. The run builds with `RELEASE_BUILD=1` (refuses synthetic data and `/dev` pages), evaluates the launch gate, deploys with `wrangler deploy`, and makes the HTTP smoke checks.
4. After it: open the site on a phone and a desktop, search, filter, open a company, press Apply on one job, and report one test problem through the form.
5. Point the rebuild workflows (`deploy-staging.yml` handles `rebuild` dispatches today) at production **only** once the owner agrees; until then Publish now rebuilds staging.

## Rolling back

Cloudflare keeps previous Worker versions: `npx wrangler rollback` (or the dashboard) returns to the last good version in seconds. A bad data release is rolled back by fixing the data and publishing again, or by rolling the Worker back to the previous build, whose datasets are inside it.
