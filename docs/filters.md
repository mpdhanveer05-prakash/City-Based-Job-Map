# Filter and search contract

This is the contract between the SQL reference (`company_filter` and its siblings, migration `20261003110000_filter_functions.sql`) and its single TypeScript mirror in `lib/filters/` (P4-01). A CI parity test compares the two over a filter matrix. The status of each item is marked; items marked **Proposal** were chosen in P3-03 and need the owner's confirmation or the designer's input.

## Filter object

A JSON object. Every key is optional; an absent, `null`, or empty group does not constrain the result.

| Key | Type | Meaning |
| --- | --- | --- |
| `q` | string | Search text (below) |
| `types` | string[] of `startup`, `mnc`, `product` | OR within the group |
| `stages` | string[] of the nine startup stages | Only applies while `startup` is in `types` |
| `neighbourhoods` | string[] of neighbourhood slugs | OR within the group |
| `tech_parks` | string[] of tech-park slugs | OR within the group |
| `sectors` | string[] of sector slugs | OR within the group |

Groups combine with **AND**. String values are trimmed and lower-cased. An **unknown key, a wrong shape, or an unknown type or stage value is an error** (`22023`), never a silent widening. The TypeScript side parses the URL with its Zod schema first, so only valid objects reach the filter; the database checks again.

## Which companies are candidates [Confirmed from the brief and data rules]

A company is a candidate in a city when it is `published` and has at least one `published` office in that city. Companies and offices that are drafts are never returned, **even to a signed-in admin** (the functions name the published states; they do not rely on RLS alone). A city the caller cannot see (a `draft` city, for anon) or an unknown city returns nothing.

## Types and stages [Confirmed, ADR-0004, D-02 accepted 3 Oct 2026]

- A company matches the type group if it carries **any** selected tag, with one exception: the `startup` tag counts only if the company's `startup_stage` is in `stages` (when `stages` is not empty).
- **MNC + Startup + Seed** returns every MNC-tagged company **or** the Startup-tagged companies at Seed.
- `stages` are ignored when `startup` is not in `types` (including when `types` is empty).
- A startup with no recorded stage matches no stage (it is never guessed).
- A company with several tags appears once.

## Locations and sectors [Proposal]

`neighbourhoods` and `tech_parks` match a company that has a **published office in this city** in one of the selected neighbourhoods or parks. `sectors` match a company in one of the selected sectors.

## Search [Proposal: substring matching, chosen so the TypeScript mirror can be exact]

`q` is trimmed and lower-cased, then split into words on **white space, which here means exactly the Unicode White_Space set** (U+0009 to U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000). The class is spelled out in both the SQL (`parse_filters`) and TypeScript (`WHITESPACE` in `lib/filters/schema.ts`) because the engines' own `\s` differ: PostgreSQL's follows the database locale and includes U+001C to U+001F; JavaScript's includes U+FEFF. The parity test found this. **Every word must be a substring of at least one field** of the company; different words may match different fields. A blank `q` does not constrain. Characters such as `%` and `_` are plain text (the SQL uses `strpos`, not `LIKE`).

The fields, all lower-cased:

1. the company name;
2. the titles of its **active** jobs listed in this city (suspect and expired jobs do not match);
3. the names of the neighbourhoods and tech parks of its published offices in this city;
4. the addresses of its published offices in this city;
5. its **published** founders' names.

Typo tolerance (trigram similarity) is deliberately **not** part of the filter, because the TypeScript mirror must return exactly the same company IDs. Suggestions and "did you mean" belong to the browser search index (P5-01).

**Case folding.** SQL `lower()` follows the database collation and JavaScript `toLowerCase()` follows Unicode. On this project's local database (`en_US.UTF-8`) they agree on everything the parity matrix tries: accented capitals, a final sigma, the dotted capital I, `ß`, Kannada, and an emoji. **Unverified on a hosted Supabase project**: check its collation (`select datcollate from pg_database`) when one exists; if it differs, the parity test (run against it) will show where.

## Functions

| Function | Returns |
| --- | --- |
| `company_filter(city_slug, filters)` | the matching company IDs, each once: the reference definition |
| `city_points(city_slug, filters)` | every published office in the city of every matching company: `office_id, company_id, lng, lat, accuracy`, ordered by office ID |
| `search_companies(city_slug, filters, result_limit, result_offset)` | one row per matching company, in name order: `company_id, slug, name, logo_key, types, startup_stage, office_count, open_job_count` |
| `company_facets(city_slug, filters)` | `facet, value, company_count` rows, below |

- **Points and locations [Proposal].** A location filter selects companies; a matching company keeps all its offices in the city on the map. If the designer would rather show only the matching offices, change `city_points` and the TypeScript mirror together (P4-03).
- **List order.** Lower-cased name in code-point order (`collate "C"`), then ID.
- **Job counts [Proposal].** `open_job_count` and search count only `active` jobs, following the data rule "active published jobs only". Public RLS also exposes `suspect` jobs; whether they should be counted is the open question in data-model.md.

## Facets [Proposal]

A facet's count is the size of `company_filter` **with that group's selection replaced by the single value**, every other group as it is:

| Facet | Count for value `v` |
| --- | --- |
| `total` | the filter as given |
| `type` | `types = [v]`, `stages` cleared (the Startup count does not shrink when stages are picked) |
| `stage` | `types = [startup]`, `stages = [v]` |
| `neighbourhood`, `tech_park`, `sector` | that group `= [v]` |

So selecting Startup does not zero the MNC count: the user can still add MNC. Counts can add up to more than the total because types overlap, so the UI shows the unique-company total from the `total` row. Every value is returned, including those with a count of 0. The tests check each facet count against `company_filter` itself, so the two cannot drift apart.

## City datasets [Confirmed design, ADR-0006; file layout is a Proposal]

`city_build_snapshot(city_slug)` returns, as one JSON document, everything the build needs for a city: the city, its neighbourhoods and tech parks, all sectors, every candidate company (with its types, stage, sectors, and published founders), its published offices in the city, and its active and suspect jobs listed in the city. The candidates are exactly `company_filter(city, '{}')`. It returns `null` for an unknown city or one the caller cannot see. Slug redirects are not in it yet (the table arrives with company merging, P7).

`npm run data` (`scripts/build-datasets.mts`) reads it once per launch city, validates it with Zod, and writes, under `public/data/` (git-ignored; Next copies it into the static export):

| File | Holds | Loaded by the browser |
| --- | --- | --- |
| `<city>/<version>/companies.json` | the city, reference lists, one summary per company | at city entry |
| `<city>/<version>/offices.json` | one point per published office | at city entry |
| `<city>/<version>/search.json` | active job titles and published founder names per company | when a visitor first searches |
| `<city>/<version>/details.json` | description, links, last verified, and the jobs to list | on a company page |
| `manifest.json` | each city's current version, counts, file paths, and byte sizes (no timestamp) | first |

The version is `city.data_version`, so a file URL changes when the data does and can be cached for a long time. Older version folders are removed on each run.

**Data source** ([ADR-0010](decisions/0010-build-data-source.md), `lib/api/data-source.ts`): a Supabase project over REST with the public anon key (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; RLS applies), else `LOCAL_DATABASE_URL` (a local database as the anon role, development only), else the committed synthetic snapshot in `supabase/seed/snapshots/` **only** when `DATA_SOURCE=seed` or `--seed-fallback` is given. With nothing, the script skips with a message, and `--require` (what `npm run build` passes) makes that an error. `npm run data -- --export-seed` rewrites the committed snapshots from the seeded local database. `RELEASE_BUILD=1` refuses synthetic data.

**Synthetic data:** `company.is_synthetic` marks sample records; the snapshot's `synthetic_companies` counts them; `companies.json` and the manifest carry `synthetic: true` only when all of a city's companies are (a mix is a build error). `city.boundary` is the simplified city limit (a GeoJSON MultiPolygon).

`lib/filters/filter.ts` is the TypeScript mirror: `prepareIndex(dataset)` once, then `companyFilter`, `cityPoints`, `searchCompanies`, `companyFacets`. Before `search.json` has loaded, pass an empty `search` list: a search then matches names and locations only.

Seed size (3 Oct 2026, 48 + 24 companies): about 88 KB of JSON in all, roughly 230 bytes per company and 245 per office in the explorer files, and 610 per company in `details.json`.

## One result for every view [As built, P4-03 and P5]

`lib/filters/filter.ts` exports `filterResult(index, filters)`: **one pass** that returns the matching companies (each once) and every office of those companies. The explorer calls it once per filter change, and the map (`setOffices`), the Grid and List rows (`listRows`, the same order and shape as `search_companies`), the toolbar's "38 companies in 41 offices", and every count read that one result, so the three views cannot disagree. `searchCompanies` is `listRows(filterResult(...))`, so the parity test covers the list path too. Each company summary carries `open_jobs` (active jobs listed in this city), so the popup and the list show the right count before `search.json` has loaded.

The search box (`components/explorer/explorer-toolbar.tsx`) applies after 200 ms, adds **one** history entry per search (the keys that follow rewrite it, and Back leaves the search), and starts loading `search.json` when it is first focused. Its suggestions (`lib/explorer/suggestions.ts`) are up to four companies, two neighbourhoods, one tech park, and three job titles that start with or contain the text: choosing a neighbourhood or tech park adds that filter and clears the text; choosing a company sets the text to its name, **drops the other filters that could hide it**, and selects it; choosing a job title sets the text. A URL that is not canonical (stages without Startup, a stray parameter, unsorted lists) is rewritten in place on load.

## URL state [Proposal for the parameter names; the rules are Confirmed]

`lib/filters/url.ts` is the only code that reads or writes the explorer's query string; components never touch `searchParams` (CLAUDE.md). The city is the path (`/bangalore`, `/chennai`), not a parameter.

| Parameter | Value | Default (omitted) |
| --- | --- | --- |
| `view` | `map`, `grid`, `list` | `map` |
| `q` | search text, white space collapsed, at most 100 characters | empty |
| `type` | comma list of `startup`, `mnc`, `product` | none |
| `stage` | comma list of the nine stages | none |
| `hood`, `park`, `sector` | comma lists of slugs | none |
| `company` | the selected company's slug | none |
| `map` | `lat,lng,zoom` (5, 5, and 2 decimals; zoom 0 to 22) | the city's default view |

- **Parsing is lenient, writing is canonical.** A bad value is dropped (anyone can edit a URL); the result is always normalised. The same state always gives the same string: fixed parameter order, sorted lists, no defaults. Back and Forward therefore compare URLs by value.
- **Stages need Startup.** `?stage=seed` alone, or with only `type=mnc`, is corrected on load; deselecting Startup clears the stages from the state and the URL (`applyFilterChange`).
- **History.** `historyMode(previous, next)`: a camera-only change replaces the current entry, any other change adds one, no change does nothing. Back and Forward step through what the visitor chose, not through every pan.
- **Not here:** clearing `company` when a filter hides the selected company depends on the dataset, so the explorer (P4-03, P5-05) does it. The Playwright check of Back and Forward (AC07) needs the explorer shell.

## Tests

- `supabase/tests/database/03_filter.test.sql`: the SQL rules.
- `tests/unit/filter-mirror.test.ts`: the same rules against the TypeScript filter, with no database.
- `tests/parity/filter-parity.test.ts` (`npm run test:parity`, needs the seeded local database): runs both over the same data for about 340 filters per city (20 hand-written, one per awkward search text, and 250 seeded random ones), including nine companies with awkward text (accents, Kannada, a final sigma, an emoji, `%`, `_`, a backslash, no-break spaces) inserted in a rolled-back transaction, and requires identical company IDs, office points, list rows (in order, with counts), and facet counts. CI runs it after the database tests.
- `tests/unit/filter-url.test.ts` (URL state; includes a seeded round trip over 3,000 generated states).
- `tests/unit/dataset-build.test.ts`: the serialiser, the manifest, and the REST reader against a local HTTP server.


`supabase/tests/database/03_filter.test.sql` covers each rule above, the error cases, the visibility rules for anon and a signed-in editor, and a 23-filter matrix across two cities that checks the points, the list, and every facet count against `company_filter`. The TypeScript parity test (P4-01) reuses the same matrix.
