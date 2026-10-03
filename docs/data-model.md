# Data Model

The base schema comes from the [architecture plan](../Company%20Map%20—%20Architecture%20&%20Implementation%20Plan.md#database) (its core DDL is authoritative for the tables it defines). This file records the **changes needed** to meet the confirmed brief. Each change is marked **[Proposal]** until the related decision is closed.

## Entities (from the plan)

`city` · `neighbourhood` · `tech_park` · `company` · `sector` / `company_sector` · `office` · `job` · `job_city` · `source` · `verification_check` (partitioned by month) · `submission` · `admin_user` · `audit_log` · `slug_redirect` · `import_batch`.

```mermaid
erDiagram
  city ||--o{ neighbourhood : has
  city ||--o{ tech_park : has
  company ||--o{ office : has
  city ||--o{ office : contains
  company ||--o{ job : posts
  job ||--o{ job_city : "listed in"
  company ||--o{ company_type_tag : "tagged (proposal)"
  company ||--o{ company_founder : "founded by (proposal)"
  company }o--o{ sector : "company_sector"
  source ||--o{ job : feeds
```

## Changes against the plan

### 1. Company types overlap [Confirmed, D-02, 3 Oct 2026; built in P3-01]
The plan's single `company.company_type` column can't represent a company that is both a Startup and a Product company. Proposed replacement:

```sql
CREATE TYPE company_type AS ENUM ('startup','mnc','product');   -- launch set; extend by migration
CREATE TABLE company_type_tag (
  company_id uuid REFERENCES company(id) ON DELETE CASCADE,
  type       company_type NOT NULL,
  PRIMARY KEY (company_id, type)
);
```
- The filter is OR within the group: `type IN (...)` via `EXISTS`, and results are always `DISTINCT company`.
- The plan's extra values (`services`, `gcc`, `other`) are not in the launch enum. Add them by a migration if a non-filterable tag is wanted.
- The definition of "Product" (the company builds its own product, as opposed to services) must be written into the curation guide.

### 2. Startup stage [Proposal, D-05; built in P3-01 as proposed]
```sql
CREATE TYPE startup_stage AS ENUM
  ('pre_seed','seed','bootstrapped','series_a','series_b','series_c','series_c_plus','public','acquired');
ALTER TABLE company ADD COLUMN startup_stage startup_stage;  -- NULL = unknown, never guessed
-- Enforced by a deferred constraint trigger: startup_stage IS NULL OR company has a 'startup' tag.
-- Deferred so a company and its tags can be written in any order inside one transaction.
-- The plan's company.funding_stage text column is dropped: startup_stage is the one stage field.
```
- The stage filter applies only when `startup` is in the type filter. The server **ignores** stage parameters without `type=startup`, and the client normalises the URL to match.
- Open question D-05: "Bootstrapped" is a funding mode, and "Public" and "Acquired" are outcomes rather than stages. They're kept in one list because the brief asks for it.

### 3. Founder name search [Confirmed in scope, D-03, 3 Oct 2026; built in P3-01]
The plan has no founder data. Proposed:
```sql
CREATE TABLE company_founder (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  source_url  text NOT NULL,          -- where this was published by the company
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published'))
);
CREATE INDEX company_founder_name_trgm ON company_founder USING gin (full_name gin_trgm_ops);
```
Only founders the company itself publishes (on its website or in a press kit) are stored, and only after admin review. Published founder names are included in `company.search_doc` (weight C; name is A, description B), kept current by triggers on `company` and `company_founder`. Removal requests go through the feedback process. The table ships empty: no real founder is loaded until legal settles source, permitted use, and privacy handling (D-03).

### 4. Search scope [Confirmed brief]
One search input matches: **job title** (`job.title_norm`, trigram + role family), **company name** (FTS + trigram), **location** (neighbourhood, tech park, office address locality), and **founder name**. Suggest results are grouped by kind.

### 5. Other changes made in P3-01
- `source` is created before `company` and `job`, so `company.source_id` and `job.source_id` are real foreign keys.
- Website, careers, apply, source base, and founder source URLs must start with `https://` (a CHECK, as well as the build-time domain check).
- `company.domain` must be lower case; `company.slug` and `city.slug` must be kebab-case; a `merged` company must name its survivor and only a `merged` company may.
- An office's neighbourhood and tech park must belong to the office's city, checked by the same trigger as the city-boundary rule.
- `job.exp_min_years <= exp_max_years` when both are set.
- RLS is enabled on all twelve tables with **no policies**, so nothing is reachable through the API roles until P3-02 adds them.

## Indexes (plan plus additions)
- GIN on `company.search_doc` and trigram on `company.name`, `job.title_norm`, and `company_founder.full_name`.
- GiST on `office.geom`. Partial index `office (city_id) WHERE status='published'`.
- `job (company_id) WHERE status IN ('active','suspect')`.
- [Proposal] `company_type_tag (type, company_id)` and `company (startup_stage) WHERE startup_stage IS NOT NULL`.

## Shared filter function
`company_filter(city_slug, filters jsonb) RETURNS SETOF uuid` is the **reference definition** of filter semantics. The functions are `STABLE` and `SECURITY INVOKER`, so RLS still applies.

Since ADR-0006 the explorer runs in the browser over a static dataset. `city_build_snapshot(city_slug)` (anon, published rows only) returns everything the build needs in one call: company summaries, offices, types, stages, job titles, founders, `last_checked_at`, and slug redirects. `lib/filters/` holds the **single TypeScript mirror** of `company_filter`, used by Map, Grid, List, and all counts. A CI parity test runs both over the filter matrix and requires identical company-ID sets. Aggregated outbound clicks go to `link_click_daily(day, kind, target_id, count)`, incremented only by the `click` Edge Function, with no visitor data.

## Authorization rules
| Role | company / office / founder | job | submission | admin tables |
| --- | --- | --- | --- | --- |
| `anon` | SELECT where `status='published'` | SELECT where `status IN ('active','suspect')` and the company is published | none directly (INSERT only through the `submit-feedback` Edge Function after Turnstile) | none |
| `authenticated`, not in `admin_user` | same as anon | same as anon | none | none |
| admin `editor` | full CRUD, cannot delete published records | CRUD | read | none |
| admin `reviewer` | editor + publish | + publish | resolve | read audit_log |
| admin `admin` | all | all | all | manage `admin_user` |
| pipeline (dedicated Postgres role, server-side only) | upsert via functions | upsert and status changes | none | writes `verification_check`, `import_batch` |

RLS is enabled on **every** table in `public`. `is_admin()` is `SECURITY DEFINER` with a fixed `search_path` (see the plan's DDL). Every policy has a pgTAP test.

### As built in P3-02 (`migrations/20261003100000_rls.sql`)
- **Publishing needs a reviewer.** A policy cannot compare old and new status, so a `BEFORE INSERT OR UPDATE` trigger on `company`, `office`, `company_founder`, and `job` rejects a signed-in editor who moves a record into or out of its public state (`published`; for jobs `active` or `suspect`). Connections with no signed-in user (the migration owner, `service_role`, the future pipeline role) are not affected, because `auth.uid()` is null for them.
- **Deleting.** An editor or reviewer may delete only records that are not published (a job counts as published while `active` or `suspect`); only an `admin` may delete a published record. Tags and links follow the editor rule.
- **Visibility chain.** An office is public only if it is published **and** its company is published **and** its city is `beta` or `live`. A `draft` city hides itself, its neighbourhoods, tech parks, offices, and job-city rows. Jobs are public when `active` or `suspect` and the company is published. Founders are public when published and the company is published.
- **Reference data** (`city`, `neighbourhood`, `tech_park`, `sector`, `source`) is writable by `admin` only. The matrix above does not name it; loosen it in P7 if editors need it. `source` and `admin_user` are closed to `anon` at the privilege level, not just filtered.
- **Privileges.** `anon` has no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER on any table in `public`, including tables created later (default privileges). `authenticated` has no TRUNCATE, REFERENCES, or TRIGGER.
- **Not built yet:** the pipeline role (P8-01), `audit_log` (P7-02), `submission` (P8-04).

Open question: suspect jobs are **built as visible** until the second failed check (as the plan's policy has it). Confirm.
