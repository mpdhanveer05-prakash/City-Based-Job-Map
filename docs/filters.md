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

`q` is trimmed and lower-cased, then split on whitespace into words. **Every word must be a substring of at least one field** of the company; different words may match different fields. A blank `q` does not constrain. Characters such as `%` and `_` are plain text (the SQL uses `strpos`, not `LIKE`).

The fields, all lower-cased:

1. the company name;
2. the titles of its **active** jobs listed in this city (suspect and expired jobs do not match);
3. the names of the neighbourhoods and tech parks of its published offices in this city;
4. the addresses of its published offices in this city;
5. its **published** founders' names.

Typo tolerance (trigram similarity) is deliberately **not** part of the filter, because the TypeScript mirror must return exactly the same company IDs. Suggestions and "did you mean" belong to the browser search index (P5-01).

**Known limit:** SQL `lower()` follows the database collation and JavaScript `toLowerCase()` follows Unicode, so they can differ for a few non-ASCII upper-case letters. Scripts without letter case (Kannada, Tamil, Devanagari) are unaffected. The parity matrix should include at least one non-ASCII name before launch.

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

## Tests

`supabase/tests/database/03_filter.test.sql` covers each rule above, the error cases, the visibility rules for anon and a signed-in editor, and a 23-filter matrix across two cities that checks the points, the list, and every facet count against `company_filter`. The TypeScript parity test (P4-01) reuses the same matrix.
