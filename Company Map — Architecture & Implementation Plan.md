# Company Map — Architecture & Implementation Plan

Sep 30, 2026 · @M.P.DHANVEER PRAKASH

## Summary

We build a map-first company discovery portal, launch it in Bengaluru alone, and add one city per release once its data passes a quality gate. It is not a job-application portal: visitors find companies by where they sit, check verified openings, and apply on the employer's own site.

The product runs as Next.js on Cloudflare Workers, a MapLibre map with a custom animated logo layer, and Supabase PostgreSQL with PostGIS. Python jobs in GitHub Actions check every job link and office location on a schedule.

**Unique selling points for the job seeker**

- **See who is hiring where.** Companies appear as logos on the map, grouped into clusters that split open as you zoom. You judge a company by its location and commute before you read a single listing.
- **Tech-park view.** Bengaluru hiring is concentrated in parks such as Manyata, ITPL and Embassy Golf Links. Every company in a building or park opens as one list, which no listing site offers.
- **Location you can trust.** Every office carries an accuracy label (building, campus, locality). A job appears in a city only when its stated location resolves to that city, which removes wrong-city listings.
- **Only live, employer-sourced jobs.** Jobs come from the employer's careers site or applicant-tracking system, never from reposts. Each link is re-checked on a schedule, and a job that fails two checks is hidden. The page shows when jobs were last checked.
- **Zero friction.** No login, no resume upload, no data collected. Apply opens the exact original posting; a browser-local shortlist tracks Interested / Applied / Interviewing (P2).
- **Equal footing for small companies.** A 20-person startup gets the same marker as an MNC. Sponsored placement, if it ever comes (P3), is labelled.

The map is easy to copy; the lasting advantage is data quality — verified locations and fresh links. The plan invests there first.

**Changes against the BRD**

- The BRD launches Bengaluru and Chennai together; this plan launches Bengaluru alone, as you asked, and makes Chennai the second release.
- The problem statement names five cities and the solution eight; the plan covers all eight.

## Scope and phased rollout

Release 1 is Bengaluru with every P0 requirement and the P1 discovery set; each later city is a data release, not a code release. A city is a row in the `city` table plus its neighbourhood polygons, map-tile extract and curated data. It moves from `draft` to `beta` (hidden URL, testers only) to `live` when it passes the launch gate below.

| Release | City | Scope |
| --- | --- | --- |
| R1 | Bengaluru | All P0 (journey, map clustering, company and job pages, admin, mobile, accessibility) + P1 (search, filters, presets, role search, experience filter, freshness, share links, reports, suggestions, Search this area, list–map sync, city intro) |
| R1.1 | Bengaluru | P2: local shortlist and status tracking, recently viewed, compare up to 3, near a metro station or neighbourhood, cluster previews, neighbourhood insights, Find companies for me |
| R2 | Chennai | City data release; P2 features apply automatically |
| R3 | Hyderabad | City data release |
| R4 | Pune | City data release |
| R5 | Coimbatore | City data release |
| R6 | Mumbai | City data release |
| R7 | Gurugram and Noida | Released together because they share one map region; each keeps its own city page and counts |
| Later | All | P3: company claims, sponsored placement, alerts, dashboards, subscriptions, embeds, news — not before three cities are live |

**City launch gate** (proposed thresholds — confirm after the sourcing spike in Sprint 0)

1. Coverage: the agreed company target is published (proposed: 800 for Bengaluru, 300 for each later city).
2. Location: every office sits inside the city boundary or carries an admin review; at least 90% are at building or campus accuracy.
3. Freshness: at least 95% of active jobs were checked in the last 24 hours; a random audit of 100 Apply links finds fewer than 2 broken.
4. Reference data: city aliases, neighbourhoods and tech parks loaded; tile extract live on the CDN.
5. Performance: map and search budgets met on the reference devices with that city's dataset.
6. Sign-off: the data owner and the product owner approve.

## Tech stack and hosting

This is the final stack. Build the map interaction first and prove it on a mid-range phone and a desktop before the remaining pages.

| Layer | Final choice |
| --- | --- |
| Frontend | Next.js App Router, React, TypeScript |
| UI | Tailwind CSS, shadcn/ui |
| Map rendering | MapLibre GL JS |
| Company clustering | Supercluster in a Web Worker, connected through Comlink. This is the only clustering engine; MapLibre's built-in clustering stays off for company points |
| Logo split and merge animation | Custom MapLibre rendering layer, driven by cluster parent/child links, with position, scale and opacity animated together |
| Basemap at launch | Geoapify vector tiles; move to Protomaps PMTiles on Cloudflare R2 when tile usage or styling needs justify it |
| State and data fetching | TanStack Query; URL parameters for search, filters and selected view |
| Long lists | TanStack Virtual |
| Saved companies (P2) | IndexedDB through Dexie.js |
| Backend | Next.js Route Handlers; Supabase Edge Functions for selected background and integration tasks |
| Database | Supabase PostgreSQL with PostGIS and `pg_trgm` |
| Search | PostgreSQL full-text search and trigram matching |
| Migrations | Supabase CLI with version-controlled SQL migrations |
| Admin sign-in | Supabase Auth, an administrator allowlist and row-level security policies |
| Logos and artwork | Supabase Storage |
| Imports and job checks | Python scripts run by GitHub Actions |
| Light scheduled tasks | Supabase Cron |
| Public-form protection | Cloudflare Turnstile, validated on the server |
| Hosting | Cloudflare Workers, using the OpenNext adapter that Cloudflare supports for Next.js |
| Testing | Vitest, Playwright, axe-core |
| CI/CD | GitHub Actions: linting, TypeScript checks, tests, dependency scanning |
| Monitoring at launch | Cloudflare and Supabase logs, plus an error-reporting service (for example Sentry) |

**Platform accounts**

- **Cloudflare:** Workers (app and API), CDN cache, WAF rate rules, Turnstile, and R2 later for tiles.
- **Supabase:** Postgres, Auth, Storage, Edge Functions and Cron, in the Mumbai region (ap-south-1) to sit close to users and to the Workers that call it.
- **Geoapify:** basemap tiles and styles.
- **GitHub:** code, CI/CD, and the scheduled Python jobs.

**Points to plan for in this stack**

- **Worker size and plan:** a Next.js app on Workers often exceeds the free plan's script-size limit. Budget for Workers Paid from the first deploy.
- **Page caching:** incremental regeneration on Workers needs an OpenNext cache store (R2 or KV), so a small R2 bucket appears at launch, before the basemap move.
- **Database calls from Workers:** Route Handlers call Postgres functions through `supabase-js` (HTTP), or through Cloudflare Hyperdrive if raw SQL is needed. No per-request connection pools.
- **GitHub Actions schedules:** scheduled runs can start several minutes late under load, and in public repositories they are switched off after 60 days without activity. Keep the repository private, and alert when a scheduled run is missed.
- **Supabase plan:** free projects pause when idle, and point-in-time recovery is a paid add-on. Production runs on the Pro plan with daily backups.
- **Geoapify:** confirm the credit allowance against expected map loads, and keep Geoapify and OpenStreetMap attribution visible.

## System architecture

One Next.js app on Cloudflare Workers serves pages, the API and the admin workspace; Supabase holds the data, auth and files; Python jobs in GitHub Actions keep jobs and locations fresh.

&#91;embedded content: Release 1 architecture · 3 tiers plus background workers\]

Visitors and admins reach Postgres only through Route Handlers and row-level security; the browser fetches basemap tiles straight from Geoapify. The dashed line on the right is the Apply journey: the visitor leaves the portal through the counted `/go` redirect.

## Map interaction design

The browser holds the whole filtered city point set and clusters it locally in a Web Worker, so every zoom step animates without a network round trip. For Bengaluru's launch dataset (proposed 800 companies, roughly 1,000–1,500 offices) the compact point payload is well under 100 KB gzipped. Server-side clustering is kept in reserve for when a city passes about 50,000 points.

&#91;embedded content: Map states from city view to selection · illustrative counts\]

**Clustering engine**

- Library: Supercluster in a Web Worker, rebuilt when filters change. A rebuild of a few thousand points takes milliseconds.
- Settings: cluster radius 60 px, clusters stop forming at zoom 17, map max zoom 19, minimum 2 points per cluster.
- Counts: each cluster carries the set of unique company IDs it holds. The bubble shows companies; the tooltip shows both ("38 companies · 41 offices"), as the BRD's data rules require.
- Bubble size steps at 2–9, 10–49, 50–199 and 200+ companies, so the map stays readable at city zoom.

**Low zoom (city view, zoom 10–13)**

- Only numbered clusters show; no logos. At most about 60 elements are on screen.
- Clicking a cluster flies to its expansion zoom (the zoom at which it first splits).
- On city entry (UI02), the camera eases from a wide view to the city centre over 1.2 s, and clusters fade in progressively.

**During zoom (split and merge animation)**

1. The map listens to the continuous `zoom` event, not only `zoomend`, and asks the worker for clusters whenever the whole-number zoom level changes. The split starts mid-pinch.
2. The worker returns each visible item with a stable key (cluster ID or office ID) and the key of the item that contained it at the previous level. Company identities and positions never change between zoom levels; only their grouping does.
3. Zooming in: each new child starts at its parent's position and scale, then eases to its own position and full size in 280 ms (ease-out cubic), fading from 0 to 1. The parent shrinks and fades out in the same frames.
4. Zooming out: each child eases back to the position of the cluster that now contains it in 220 ms (ease-in), shrinking and fading, while the merged cluster grows in. This is the exact reverse of the split.
5. Every transition carries a generation number. A newer zoom step cancels older animations and snaps them to their end state, so rapid zooming never leaves duplicate or stale markers (BRD map acceptance).
6. Above 250 moving items, the step becomes a cross-fade to protect frame rate. With `prefers-reduced-motion`, items swap instantly and the counts are unchanged.
7. All clusters and logos are drawn by the custom rendering layer below, never as hidden-and-shown DOM markers.

**Custom rendering layer**

- A MapLibre custom layer (WebGL2) draws every cluster bubble and logo as an instanced textured quad, so all visible items render in one pass per frame.
- Each item carries its current position, scale, opacity and selected flag. The animator interpolates all three together each frame and asks MapLibre to repaint until the transition ends.
- Logos are fetched once, resized to 64 and 128 px, and packed into a 2048 × 2048 texture atlas (256 logos at 128 px per page), with least-recently-used eviction. The device pixel ratio picks the size, so logos stay sharp. Letter fallbacks are drawn on a canvas and packed into the same atlas.
- Cluster counts come from a small digit atlas and render in the same pass.
- Only items inside the viewport plus a 20% margin go to the GPU.
- Hit testing uses a KDBush index of the items' screen positions, rebuilt when the view settles. Clicks, hovers and taps resolve against it with a 44 px touch radius.
- Touch: pinch and double-tap zoom trigger the same split and merge; a tap on a cluster flies to its expansion zoom.
- Keyboard and screen readers: a visually hidden, focusable list mirrors the visible markers. Arrow keys move focus, and the layer draws the focus ring.
- The selection card stays a DOM element, placed from the marker's screen position.
- Effort: this layer is the largest single frontend task; my estimate is 3–4 weeks for one engineer. If it misses the validation gate, the fallback is DOM markers moved with `transform` at high zoom only.

**High zoom (street view, zoom 15–19)**

- Individual 40 px round logo markers (WebP at 1x and 2x). A missing or failed logo falls back to the company's initial on a colour derived from its name (MAP06).
- Hiring companies carry a small green dot with the open-job count; companies with no active jobs are drawn at 70% opacity, so hiring is visible at a glance.
- Co-located companies: offices within 5 m of each other, or in the same tech-park building, form a co-location group. At any zoom where they would still overlap, they show as a stacked marker with a count badge.
- Clicking a stacked marker spiders it open: up to 8 companies on a circle, 9–20 on a spiral, each joined to the true location by a thin leg line. More than 20 opens a nearby-company list in the side panel (bottom sheet on mobile), sorted by open jobs. Esc, a map click or zooming out collapses it.
- Tech-park groups also get a named label at zoom 15 and above ("Manyata Tech Park · N companies"), which opens the same list.

**Selection**

- One selected-company ID lives in the UI store and in the URL (`?company=<slug>`), so a shared link reopens the same selection.
- Selecting on the map highlights the row in the list and scrolls it into view (the list is virtualised, so it scrolls by index). Hovering a row raises and rings its marker (MAP08).
- The selected marker is scaled 1.25×, gets a 3 px accent ring and sits on top of all other markers. A company with several offices in the city rings all of them; the card belongs to the nearest one.
- If zooming out swallows the selected marker into a cluster, that cluster keeps the accent ring, and clicking it zooms straight back to the company.
- **Card placement (desktop):** the card tries four positions around the marker — right, left, above, below — and takes the first that fits fully inside the visible map area with a 12 px gap from the marker. The visible area excludes the list panel and map controls. If none fits, the map eases (300 ms) until the marker sits where the right-hand position fits. The card never overlaps its marker.
- **Card placement (mobile):** the card is a bottom sheet (peek 30% of screen height, expanded 60%). The map's bottom padding is set to the sheet height and the map eases so the marker sits in the centre of the uncovered area.
- The card shows logo, name, sector, company type, neighbourhood, location accuracy, open-job count and **View company**. Esc or the close button clears the selection on both map and list.

## Frontend

One Next.js App Router application (React, TypeScript) serves the public pages, the admin workspace and the API, deployed to Cloudflare Workers through OpenNext. Public pages are server-rendered for SEO; the explorer hydrates on the client. The admin route group is never bundled into public pages.

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | Next.js App Router, React, TypeScript | Server rendering and cached regeneration for company pages (NFR10); one language for UI and API |
| UI kit | Tailwind CSS + shadcn/ui | Accessible primitives (dialogs, sheets, comboboxes) owned in the repo, not a locked library |
| Map | MapLibre GL JS + custom animated logo layer | Open-source WebGL map; the custom layer gives full control of split and merge |
| Basemap | Geoapify vector tiles, with Geoapify and OpenStreetMap attribution (MAP01, NFR11) | Hosted tiles, so the team spends its time on the company layer |
| Clustering | Supercluster in a Web Worker via Comlink | Keeps clustering off the main thread during zoom |
| Server state | TanStack Query | Caching, retries and request cancellation for search and listings |
| URL state | City, view, filters, query, selected company, map centre and zoom as URL parameters | Share links (ENG01) and exact restore after Back (AC07) |
| UI state | A small store for hovered company, open panel and spider group | Map layer and list read one source, so highlight stays in sync |
| Lists | TanStack Virtual | Grid and List stay fast with thousands of rows |
| Local data (P2) | IndexedDB through Dexie.js, with a disclosure notice | Saved companies, statuses, recently viewed — no account (ENG04, ENG05) |
| Testing | Vitest (units), Playwright (journeys, map interactions, visual diffs), axe-core (accessibility) | AC01–AC08 run as automated journeys |

**Pages and routes**

- `/` city selection: active city cards; inactive cities shown as Coming soon and not clickable (AC01).
- `/bangalore` explorer (`/bengaluru` redirects here): Map, Grid and List share one result set; filters in a left panel on desktop and a bottom sheet on mobile.
- `/companies/{slug}` details: logo, description, sector, type, size and funding if known, all published offices on a mini map, verification date, Visit website, View jobs.
- `/companies/{slug}/jobs?q=`: page-level freshness line and "Applications happen on the employer's site" label; each row is title + Apply only (JOB01).
- `/admin/*`: admin workspace, signed in through Supabase Auth.
- Old slugs from merged companies redirect permanently to the surviving slug.

**Performance and accessibility budgets** (proposed; measured on the reference devices agreed in Sprint 0)

- Useful first view within 3 s on a mid-range Android over a throttled 4G profile (NFR01). Explorer JavaScript under 350 KB gzipped including MapLibre.
- Filter change to updated map and list within 1 s warm (NFR01). Zoom animation at 55 fps or better, measured as dropped frames per zoom step (NFR02).
- WCAG 2.2 AA (NFR03): every map company is also reachable in Grid and List; markers are keyboard-reachable through the mirrored focus list; focus is visible; touch targets are at least 44 px.
- Failure handling (NFR05): a failed tile load shows a retry banner with a link to List view; a failed data request shows retry in place; logos fall back to initials.

## Backend: search and listings

The backend is Next.js Route Handlers on Cloudflare Workers in front of Postgres functions in Supabase. The filter and search logic lives in the database as SQL functions, so the map, the list and every count run the same query (MAP05, AC03). Supabase Edge Functions handle a few event-driven tasks; Python jobs in GitHub Actions do the heavy ingestion.

**Where each piece runs**

- Route Handlers (`app/api/v1/*`, `app/go/*`): validate input with Zod, call Postgres functions through `supabase-js`, set cache headers, verify Turnstile tokens on public forms.
- Postgres functions (RPC): `search_companies(city, filters)`, `city_points(city, filters)`, `company_facets(city, filters)`, `search_roles(city, q, exp, mode)`, `suggest(city, q)`. Points, list and facets all call one shared SQL filter so they can never disagree.
- Row-level security: the public (anonymous) role reads only published rows and active jobs; it cannot write anywhere except through the feedback handler. Admin writes need a Supabase Auth session whose user is in `admin_user` with the right role.
- Edge Functions: re-check a job immediately when a visitor reports it; purge the Cloudflare cache for a city or company on publish.
- Supabase Cron: nightly refresh of count views, hourly stale-job sweep, weekly logo and website checks queue.

**Public API (v1, read-only except feedback)**

| Method and path | Returns | Cache |
| --- | --- | --- |
| `GET /api/v1/cities` | Active and upcoming cities, centre, zoom, aliases | Edge 1 h |
| `GET /api/v1/cities/{city}/points?{filters}` | Compact map points: office ID, company ID, lng, lat, logo key, open-job count, co-location group | Edge 5 min; key = city data version + filter hash |
| `GET /api/v1/cities/{city}/companies?{filters}&q&bbox&sort&cursor` | Paged cards for Grid and List, unique companies, offices, facet counts | Edge 5 min |
| `GET /api/v1/cities/{city}/roles?q&exp&mode` | Companies with matching active jobs, match count per company | Edge 5 min |
| `GET /api/v1/suggest?city&q` | Type-ahead: companies, sectors, neighbourhoods, tech parks, roles | Edge 10 min |
| `GET /api/v1/companies/{slug}` | Profile, offices, verification dates, open-job count | Edge 10 min, purged on publish |
| `GET /api/v1/companies/{slug}/jobs?q` | Active jobs (ID, title) + last-checked time for the page | Edge 10 min, purged on refresh |
| `POST /api/v1/reports`, `POST /api/v1/suggestions` | Receipt ID only; never promises publication (ENG02, ENG03) | None; Turnstile + WAF rate rule |
| `GET /go/job/{id}`, `GET /go/site/{company}` | 302 to the stored URL, unchanged; logs the click with no personal data | None |

Filters combine as AND across groups and OR within a group (DISC03): `type`, `sector`, `neighbourhood`, `park`, `size`, `hiring`, `funding`, `role`, `exp`, `mode`, `bbox`.

**Search implementation**

- PostgreSQL full-text search (`tsvector` over name, aliases, sector, neighbourhood, park) plus `pg_trgm` for typos and prefix type-ahead. For thousands of companies and tens of thousands of jobs this answers in tens of milliseconds, so no separate search engine is needed.
- City aliases resolve in SQL: Bangalore, Bengaluru, BLR and Bengalooru all map to the same city (DISC01).
- Role search maps free text to a role family (for example "SRE", "platform engineer" and "DevOps" → DevOps and Cloud) and ranks exact title matches first. Titles that only match a family are labelled "related", never "match".
- Experience: a job matches `exp=3` only when its parsed range covers 3 years. Jobs with no stated experience match only when the visitor ticks Include unspecified.

**Outbound links**

- Apply goes through `/go/job/{id}` so clicks are counted, then redirects to the exact stored posting URL with no parameters added (JOB02).
- Stored URLs must be `https` and pass a domain check against the company's domain or its known applicant-tracking host. Links open in a new tab with `rel="noopener noreferrer"`.

## Database

Supabase PostgreSQL with PostGIS and `pg_trgm` holds every entity in the BRD, and the schema lives in version-controlled SQL migrations applied with the Supabase CLI. Companies, offices and jobs are separate tables, so one company can have many offices across cities while keeping one stable ID and slug.

| Table | Holds | Key rules |
| --- | --- | --- |
| `city` | Slug, display name, aliases, status, centre, default zoom, boundary polygon | Status `draft` → `beta` → `live` gates visibility |
| `neighbourhood` | Named areas with polygons per city | Drives the neighbourhood filter and insights |
| `tech_park` | Tech parks and multi-tenant buildings with footprints | Drives the park filter, label and co-location list |
| `company` | Slug, name, domain, logo, description, type, size, funding, website, careers URL, status, source, last verified | `domain` is the duplicate key; merged records point to the survivor |
| `sector`, `company_sector` | Sector taxonomy and company links | Many-to-many |
| `office` | Company, city, neighbourhood, park, address, point, accuracy, verification state | Must fall inside the city boundary or carry a review |
| `job` | Company, source, external ID, title, normalised title, role family, apply URL, experience range, work mode, status, check times, failure count | Duplicate hash per company; only `active` is public |
| `job_city` | Which cities (and optionally which office) a job belongs to | A job appears only in cities its location resolves to |
| `source` | Where data comes from, permission note, schedule, last run and result | Nothing is ingested without a source row |
| `verification_check` | Every link, feed and geocode check with result and timestamp | Partitioned by month; drives "last checked" |
| `submission` | Reports and suggestions with review status and resolution | Never publishes without review (ENG03) |
| `admin_user`, `audit_log` | Admin identities, roles, and before/after snapshots of every change | ADM01, ADM06 |
| `slug_redirect`, `import_batch` | Old slugs after merges; import runs with preview and error summary | ADM03 |

Core DDL:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE city (
  id            smallserial PRIMARY KEY,
  slug          text UNIQUE NOT NULL,              -- 'bangalore'
  name          text NOT NULL,                     -- 'Bengaluru'
  aliases       text[] NOT NULL DEFAULT '{}',      -- {'Bangalore','BLR','Bengalooru'}
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','beta','live')),
  centre        geography(Point,4326) NOT NULL,
  default_zoom  real NOT NULL,
  boundary      geography(MultiPolygon,4326) NOT NULL,
  data_version  bigint NOT NULL DEFAULT 1           -- bumped on every publish; used in cache keys
);

CREATE TABLE neighbourhood (
  id        serial PRIMARY KEY,
  city_id   smallint NOT NULL REFERENCES city(id),
  slug      text NOT NULL,
  name      text NOT NULL,
  boundary  geography(MultiPolygon,4326),
  UNIQUE (city_id, slug)
);

CREATE TABLE tech_park (
  id         serial PRIMARY KEY,
  city_id    smallint NOT NULL REFERENCES city(id),
  slug       text NOT NULL,
  name       text NOT NULL,
  footprint  geography(Polygon,4326),
  UNIQUE (city_id, slug)
);

CREATE TABLE company (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text UNIQUE NOT NULL,
  name              text NOT NULL,
  domain            text UNIQUE NOT NULL,          -- duplicate key, e.g. 'example.com'
  logo_key          text,                          -- CDN object key; NULL = initials fallback
  description       text,
  company_type      text CHECK (company_type IN ('startup','mnc','product','services','gcc','other')),
  size_band         text,                          -- NULL = unspecified, never guessed
  funding_stage     text,
  website_url       text NOT NULL,
  careers_url       text,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','unpublished','merged')),
  merged_into       uuid REFERENCES company(id),
  source_id         int,
  last_verified_at  timestamptz,                   -- NULL = not verified; UI says so
  search_doc        tsvector,                      -- maintained by trigger
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_search_gin ON company USING gin (search_doc);
CREATE INDEX company_name_trgm  ON company USING gin (name gin_trgm_ops);

CREATE TABLE office (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  city_id           smallint NOT NULL REFERENCES city(id),
  neighbourhood_id  int REFERENCES neighbourhood(id),
  tech_park_id      int REFERENCES tech_park(id),
  address           text NOT NULL,
  geom              geography(Point,4326) NOT NULL,
  accuracy          text NOT NULL CHECK (accuracy IN ('rooftop','building','campus','street','locality')),
  verification      text NOT NULL DEFAULT 'unverified' CHECK (verification IN ('unverified','auto','reviewed')),
  outside_reviewed  boolean NOT NULL DEFAULT false, -- admin accepted a point outside the city boundary
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','unpublished')),
  last_verified_at  timestamptz
);
CREATE INDEX office_geom_gist ON office USING gist (geom);
CREATE INDEX office_city_pub  ON office (city_id) WHERE status = 'published';

CREATE TABLE job (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES company(id),
  source_id             int NOT NULL,
  external_ref          text,                      -- posting ID in the employer's ATS
  title                 text NOT NULL,
  title_norm            text NOT NULL,
  role_family           text,                      -- 'devops-cloud', 'backend', ...
  apply_url             text NOT NULL,
  dedup_hash            bytea NOT NULL,            -- hash(company, title_norm, canonical URL)
  exp_min_years         smallint,                  -- NULL = unspecified
  exp_max_years         smallint,
  work_mode             text CHECK (work_mode IN ('onsite','hybrid','remote')),
  posted_at             date,
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspect','expired','withdrawn','draft')),
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_checked_at       timestamptz,
  last_ok_at            timestamptz,
  consecutive_failures  smallint NOT NULL DEFAULT 0,
  UNIQUE (company_id, dedup_hash)
);
CREATE INDEX job_company_active ON job (company_id) WHERE status IN ('active','suspect');
CREATE INDEX job_title_trgm     ON job USING gin (title_norm gin_trgm_ops);

CREATE TABLE job_city (
  job_id     uuid NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  city_id    smallint NOT NULL REFERENCES city(id),
  office_id  uuid REFERENCES office(id),
  PRIMARY KEY (job_id, city_id)
);
```

The city-boundary rule is enforced by a trigger that rejects a published office outside `city.boundary` unless `outside_reviewed` is true. Company and job counts shown to visitors come from `COUNT(DISTINCT company_id)` and active published jobs only (BRD data rules).

Row-level security, in the same migrations:

```sql
ALTER TABLE company ENABLE ROW LEVEL SECURITY;
ALTER TABLE office  ENABLE ROW LEVEL SECURITY;
ALTER TABLE job     ENABLE ROW LEVEL SECURITY;

CREATE TABLE admin_user (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id),
  role     text NOT NULL CHECK (role IN ('editor','reviewer','admin'))
);

CREATE FUNCTION is_admin(min_role text DEFAULT 'editor') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_user
    WHERE user_id = auth.uid()
      AND array_position(ARRAY['editor','reviewer','admin'], role)
       >= array_position(ARRAY['editor','reviewer','admin'], min_role)
  );
$$;

CREATE POLICY public_read_company ON company FOR SELECT
  USING (status = 'published');
CREATE POLICY public_read_job ON job FOR SELECT
  USING (status IN ('active','suspect'));
CREATE POLICY admin_all_company ON company FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());
```

Backups: Supabase Pro daily backups; add point-in-time recovery before launch if a day of lost edits is unacceptable. One full restore into a scratch project is rehearsed before launch (NFR09).

## Data sourcing and verification

Every record starts from a registered, permitted employer source, and a scheduled worker re-checks it; nothing is copied from job aggregators. This pipeline is the product's real moat, so it is built in Sprints 1–3, alongside the map prototype.

**Sources, in order of trust**

1. Public job-board feeds of the employer's applicant-tracking system (for example Greenhouse, Lever, Ashby, SmartRecruiters). They return structured postings with stable IDs and locations.
2. `JobPosting` structured data (schema.org JSON-LD) on the employer's own careers page, which includes location and often an expiry date.
3. Admin CSV import of curated company and office lists, with a validation preview, duplicate detection and an error summary (ADM03).
4. Visitor suggestions with a required source URL, admitted only after review (ENG03).

Large employers on custom or Workday-style career sites often expose no permitted feed. They are added as company and office records with a careers link until a permitted job source is agreed; their jobs page then shows "See open roles on the employer's site".

**Pipeline stages**

1. **Fetch** — per source schedule, with an identifying user agent, `robots.txt` respected and at most 1 request per second per host.
2. **Normalise** — clean the title, assign a role family, parse experience ("3–5 years" → 3, 5; nothing found → NULL), parse work mode.
3. **Assign city** — match the posting's location text against city aliases and the company's known offices. "Bengaluru, Karnataka" joins Bengaluru; "Remote – India" is listed on the company page as Remote but adds no map presence; an unresolved location goes to review.
4. **Deduplicate** — jobs by company + normalised title + canonical URL; companies by web domain, then name similarity above 0.8 for review. Merges keep the old slug as a redirect.
5. **Geocode offices** — geocode the address, check the point falls inside the city boundary, snap to a known tech-park footprint where one contains it, record accuracy. Anything below building accuracy goes to the admin queue.
6. **Publish** — jobs from a trusted feed publish automatically; a company or office publishes only after its first admin review.
7. **Re-check** — see the schedule below. Each check writes a `verification_check` row.
8. **Expire** — a job missing from its feed, or whose link returns 404 or 410, or redirects to a generic careers index, becomes `suspect` and is re-checked within 6 hours. A second failure marks it `expired` and removes it from public results (JOB05, ADM05). Two checks prevent one flaky response from hiding a live job.

| Check | Frequency (proposed) | Failure action |
| --- | --- | --- |
| Job feed sync | Every 6 h | Missing posting → suspect |
| Job link check | Every 24 h, plus before a job's first publish | 404, 410 or careers-index redirect → suspect |
| Company website and logo | Weekly | Admin queue; initials shown if the logo fails |
| Office location | Every 90 days, and on any address change | Admin queue |
| Visitor reports | On arrival | Report on a job triggers an immediate re-check |

The jobs page shows "Jobs checked 3 hours ago" from the oldest `last_checked_at` on that page, and shows "Not yet verified" when no check exists. Verification dates are never invented (NFR08, AC10).

**Where it runs:** feed sync, link checks, geocoding, deduplication and bulk imports are Python scripts in GitHub Actions on `schedule` and `workflow_dispatch` triggers. They write through a dedicated database role, never the public key. Supabase Cron runs the light SQL tasks (stale-job sweep, count refresh); an Edge Function runs the instant re-check when a visitor reports a job. Admin CSV imports are validated and previewed in the admin UI, then committed by a Route Handler.

**Logos and licensing:** logos come from the company's own site or press kit, stored in Supabase Storage as square WebP at 64 and 128 px and served through the Cloudflare cache; companies can ask for removal. Map data is OpenStreetMap-derived via Geoapify, with attribution always visible (NFR11).

## BRD traceability

Every P0 and P1 requirement in the BRD ships in Release 1; P2 ships in R1.1 and P3 after three cities are live.

| BRD IDs | Delivered by | Release |
| --- | --- | --- |
| MAP01–MAP06 | Map module: MapLibre, Supercluster worker, custom animated rendering layer, spider and co-location list, unique-company counts, logo fallback | R1 |
| MAP07, MAP08 | Search this area (`bbox` filter chip), hover and selection sync through the UI store | R1 |
| MAP09, MAP10 | Cluster preview (top logos, sectors, hiring count), neighbourhood insights from `neighbourhood` aggregates | R1.1 |
| UI01, UI02 | Responsive layout with bottom sheets; city intro camera move with reduced-motion fallback | R1 |
| DISC01–DISC05 | `search` module: full-text + trigram, alias resolution, facets, presets, role families, experience and work-mode filters with Include unspecified | R1 (Near metro preset in R1.1, once transit data exists) |
| COMP01, COMP02 | Company details page; open-job counts from active jobs | R1 |
| JOB01–JOB05 | Jobs page (title + Apply only), `/go` redirect, job-title search, freshness line, empty state, expiry | R1 |
| ENG01–ENG03 | URL state, share links, `feedback` module with review queue | R1 |
| ENG04–ENG08 | IndexedDB shortlist, statuses, recent views, compare, near-me by stated radius, Find companies for me | R1.1 |
| ADM01–ADM06 | Admin workspace: Supabase Auth with allowlisted roles and row-level security, CRUD and publish, CSV import, review queues, verification views, audit log | R1 (built first, Sprints 1–2) |
| NFR01–NFR12 | Budgets in Frontend; security, monitoring and backups in Infrastructure; licensing in Data sourcing; outbound click analytics | R1 |
| AC01–AC10 | Automated Playwright journeys run on every merge, plus a manual accessibility and device pass before launch | R1 |
| P3 capabilities | Company claims, sponsored labels, alerts, dashboards, subscriptions, embeds, news | After R3 |

## Implementation plan

The map interaction is built and proven first: the custom layer must pass a device validation gate on 6 November 2026 before the remaining pages are built. Data, admin and the pipeline run alongside it, and Bengaluru can still go public on 18 January 2027 if Sprint 0 starts on 5 October 2026. Dates are proposals; the Diwali and year-end weeks carry reduced velocity.

**Proposed team**

| Role | Allocation | Owns |
| --- | --- | --- |
| Product owner | 0.5 | Scope, launch gate sign-off, source agreements |
| Frontend engineer (map) | 1.0 | Custom MapLibre layer, clustering worker, animation, selection, device validation |
| Frontend engineer | 1.0 | Pages, filters, Grid and List, admin UI with shadcn/ui, accessibility |
| Full-stack engineer | 1.0 | Route Handlers, SQL functions, row-level security, feedback, admin endpoints |
| DevOps and data engineer | 1.0 | Supabase projects and migrations, Cloudflare Workers, GitHub Actions, Python ingestion and verification jobs, monitoring |
| Data curator | 1.0 from Sprint 1 | Company and office curation, geocode review, report triage |
| Product designer | 0.5, Sprints 0–4 | Map markers and states, design system, mobile sheets, city artwork |

&#91;embedded content: Proposed delivery timeline · Bengaluru and Chennai\]

**Exit criteria per stage**

1. **Sprint 0** (5–16 Oct) — decisions list closed; Supabase `dev`, `staging` and `prod` projects and Cloudflare preview deploys running; schema v1 migrated; a prototype dataset of about 1,500 Bengaluru offices loaded, using real companies where available and synthetic points matching real density (Manyata, Whitefield, Outer Ring Road, Koramangala) for the rest.
2. **Map prototype and validation gate** (5 Oct–6 Nov) — custom layer with split and merge, click-to-expand, spider and co-location list, selection card, letter fallbacks, logo atlas, touch and reduced motion. Gate on a mid-range Android phone and a desktop: 20 rapid zoom-in/zoom-out cycles over the densest area and filter changes during zoom, with no duplicate or stale markers, no more than 5% dropped frames per zoom step, and filter updates within 1 s (proposed thresholds). A failed gate means fixing or taking the DOM-marker fallback before any page work.
3. **Data model, admin, pipeline** (19 Oct–27 Nov) — admin can create, import, review and publish; row-level security tested; feed sync, link checks and geocoding run on GitHub Actions schedules against `staging`; 300 real Bengaluru companies loaded.
4. **Pages** (9 Nov–4 Dec) — city selection, Grid and List, company and jobs pages, `/go` redirect, share links; AC01, AC02, AC05–AC07 pass as automated journeys.
5. **Search, filters, feedback** (7–25 Dec) — search, facets, presets, role and experience search, Search this area, reports and suggestions; AC03 and AC09 pass.
6. **Hardening and private beta** (28 Dec–15 Jan) — WCAG 2.2 AA audit fixed, performance budgets met with the real dataset, restore drill done, 50 invited testers; launch gate passed.
7. **Launch and after** — public launch on 18 January; 4-week baseline for success measures; R1.1 features and Chennai curation run in parallel.

## Infrastructure, DevOps and observability

The app runs on Cloudflare Workers and the data on Supabase in the Mumbai region, with GitHub Actions for CI/CD and scheduled jobs. There are no servers or containers to operate at launch; the operational work is configuration, schedules and monitoring.

| What | Where | Notes |
| --- | --- | --- |
| Pages, API, admin | Cloudflare Workers (Next.js via OpenNext), Workers Paid plan | Custom domain; edge cache for API reads and pages |
| Page cache | Cloudflare R2 (or KV) as the OpenNext incremental cache | Purged per city or company on publish |
| Security at the edge | Cloudflare WAF rate rules, Turnstile | Public forms: 5 submissions per IP per hour (proposed) |
| Database | Supabase Postgres (Pro plan), PostGIS, `pg_trgm` | Row-level security on every public table |
| Auth, files, functions | Supabase Auth, Storage, Edge Functions, Cron | Admin allowlist; logos and artwork in Storage |
| Basemap | Geoapify vector tiles | Later: Protomaps PMTiles on R2 |
| Scheduled Python jobs | GitHub Actions runners | Feed sync every 6 h, link checks every 24 h, imports on demand |
| Environments | Supabase: `dev`, `staging`, `prod` projects; Cloudflare: preview, staging, production Workers | Each pull request gets a preview Worker against the `dev` database |
| Secrets | GitHub encrypted secrets and Cloudflare Worker secrets | Supabase service key only in server code and Actions, never in the browser |

**Delivery pipeline (GitHub Actions)**

1. Pull request: ESLint, TypeScript check, Vitest, dependency scan (Dependabot or `npm audit`), Playwright journeys against a preview Worker, Supabase migration dry-run on `dev`.
2. Merge to main: apply migrations to `staging` with the Supabase CLI, deploy the staging Worker, run the smoke journeys (AC01–AC08).
3. Tagged release: apply migrations to `prod`, deploy the production Worker, run the smoke journeys; roll back with the previous Worker version if they fail.

**Monitoring at launch** (NFR09)

- Cloudflare Workers logs and analytics; Supabase database, API and function logs; an error-reporting service for browser and server errors.
- Real-user measures sent to the error service: first useful view time and dropped frames per zoom step, by device class.
- A scheduled GitHub Action every 30 minutes walks city → company → jobs → Apply redirect and alerts on failure.
- Proposed alerts: any scheduled job failing or not starting on time twice in a row; more than 5% of active jobs unchecked in 24 hours; 5xx rate above 1%; broken-link reports above the weekly baseline.
- Prometheus and Grafana stay on the roadmap for when traffic justifies them.

**Security** (NFR06): admin behind Supabase Auth plus the allowlist and row-level security; strict Content Security Policy; all input validated with Zod; displayed descriptions sanitised; Turnstile tokens verified server-side before any feedback insert.

## Risks, success measures and open questions

The biggest risk is data, not code: a sparse or stale Bengaluru map would sink the launch however good the animation is.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Too few permitted job sources | Many companies show no jobs; weak first impression | Sourcing spike in Sprint 0; launch coverage target set from its results; companies still appear with a careers link |
| Custom map layer takes longer than planned | Page work and launch slip | Map built first with a hard gate on 6 November; DOM-marker fallback ready at high zoom |
| Animation stutter on low-end Android | Map feels broken | Instanced WebGL drawing, viewport culling, cross-fade above 250 moving items, frame-drop monitoring |
| Large MNCs on sites with no feed | Gaps among the best-known employers | Company and office records first; agree feeds with employers after launch (P3 company claims) |
| Messy Bengaluru addresses | Markers in the wrong place | Accuracy labels, tech-park snapping, admin review below building accuracy |
| GitHub Actions schedules run late or stop | Stale jobs stay visible | Private repository, missed-run alert, Supabase Cron stale-job sweep as a backstop |
| Next.js features limited on Workers | Build or runtime surprises | Deploy a skeleton to Workers in Sprint 0; keep to features the OpenNext adapter supports |
| Geoapify usage limits or price at scale | Tile costs grow with traffic | Watch credit use weekly; move to Protomaps PMTiles on R2 when it pays off |
| Logo and tile licensing | Takedown requests | Company-owned logo sources, removal process, visible attribution |
| Map is easy to copy | Competitors add a map view | Invest in verified locations, freshness and tech-park data, which are slow to copy |

**Success measures** (from the BRD; targets set after a 4-week baseline)

- Visitors reaching a company profile, and reaching a jobs page.
- Outbound Apply clicks (labelled as clicks, not applications).
- Repeat visits within 30 days.
- Invalid-link reports per 1,000 Apply clicks.
- Data health (proposed internal measures): share of active jobs checked in 24 hours; share of offices at building accuracy or better.

**Decisions needed before Sprint 1**

- [x] Implementation stack and hosting (Next.js on Cloudflare Workers, Supabase, Geoapify, GitHub Actions).
- [ ] Product name, branding and domain.
- [ ] Bengaluru launch sources, their permitted use, the coverage target and refresh frequency.
- [ ] Confirm Chennai as R2 and the order of the remaining cities.
- [ ] Filter taxonomy: company types, sectors, size bands, role families.
- [ ] Rules for approximate locations, stale jobs and duplicate offices.
- [ ] Geocoding provider, error-reporting service and analytics tool (with privacy notice).
- [ ] Reference phone and desktop, network profile, and the owner of the map validation gate.
