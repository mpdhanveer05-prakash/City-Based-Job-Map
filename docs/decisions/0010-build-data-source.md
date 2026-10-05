# ADR-0010: Where the build gets its city data, and how synthetic data is kept out of production

- **Status:** Accepted (engineering decision under ADR-0006; the owner is asked to confirm the release rule)
- **Date:** 2026-10-05
- **Related tasks / decisions:** P4-01, P4-02, ADR-0006, D-04 (real data), CLAUDE.md hard rules ("Don't invent data", "Synthetic data must be labelled synthetic")

## Context

Every public page is prerendered from per-city datasets that `npm run data` writes (ADR-0006). P4-01 left open what `npm run build` does when there is no database to read: it could fail, or fall back to the synthetic sample. CI, the Playwright suite, and staging all build without a Supabase project today, while production must never show sample data as if it were real. The city page also needs each city's boundary and a way to know whether its data is synthetic.

## Decision

1. **Data source order** (`lib/api/data-source.ts`, unit-tested): a Supabase project over REST (`NEXT_PUBLIC_SUPABASE_URL` + anon key); a local Postgres (`LOCAL_DATABASE_URL`, development only); the committed synthetic snapshot (`supabase/seed/snapshots/<city>.json`) **only when asked for** (`DATA_SOURCE=seed`, or `--seed-fallback`, which `npm run dev` passes). Otherwise the build **fails** (`prebuild` runs `build-datasets --require`): a build without data is a broken site.
2. **The sample is a committed file, not a database dependency.** The seed's ids are derived from slugs, so `npm run data -- --export-seed` rewrites the snapshots byte-for-byte after any `db reset`. CI exports them again and runs `git diff --exit-code`, so the file cannot drift from `supabase/seed/`.
3. **Synthetic data is flagged on the record.** `company.is_synthetic` (migration `20261005090000`) is true for every seed company. `city_build_snapshot` returns `synthetic_companies`; the build calls a dataset synthetic only when all its companies are, and **refuses a mix** of real and synthetic companies. The flag travels in `companies.json` and the manifest. It sits on `company`, not `source`, because `source` is admin-only under RLS and the build reads as anon.
4. **A release build refuses sample data.** `RELEASE_BUILD=1` (set only by the production deploy workflow, P9-05) makes `build-datasets` exit 1 when any city is synthetic.
5. **Labelling.** While a build holds synthetic data, every public page carries a "Sample data" notice, counts read "sample companies", and the city tiles draw only the boundary outline, never dots (design-system.md §5).
6. `city_build_snapshot` also returns the city boundary (simplified GeoJSON, about 50 m tolerance), used by the city tiles and the explorer's boundary line.

## Consequences

- Local `npm run build`, CI, e2e, and staging need `DATA_SOURCE=seed` (or a real source). The `.env.example`, `playwright.config.ts`, and both workflows set it.
- Staging shows the synthetic sample until a staging Supabase project has data; then set the repository variables and drop `DATA_SOURCE=seed` from the deploy workflow.
- Real launch data (D-04) arrives by changing the source, not by editing code.
- Open: the production deploy workflow does not exist yet; until it sets `RELEASE_BUILD=1`, rule 4 protects nothing automatically. Tracked in P9-05.
- The committed snapshots are about 95 KB of JSON; they are replaced by real curated data in production builds and never loaded there.

## Sources (with date checked)

- Next.js 16 static export guide, `node_modules/next/dist/docs/01-app/02-guides/static-exports.md` (read 2026-10-05): server components run at build; no request-time data.
