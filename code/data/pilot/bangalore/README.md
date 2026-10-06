# Bengaluru pilot data (P9-20)

Started 6 Oct 2026. **Nothing here is reviewed, approved, or published.** These are draft records with evidence claims, prepared for a human reviewer. Chennai follows once this process has been validated.

## How it was made

1. **Research** (`research/group-*.json`): AI research agents looked for each candidate company's official website. They recorded a name, website, Bengaluru office address, description, type tags, sectors, and listing status, each with a source URL and a quote from that page. Their output is kept exactly as returned, including what they could not find (`uncertain`).
2. **Verification** (`scripts/pilot/verify_research.py` → `verification.json`, `candidates.json`): none of the research is trusted until this script has re-fetched every cited page and found the quote in its raw text.
   - The source must be on the company's own domain.
   - The name must appear on the page.
   - The full address, not just its quote, must be on the page and must be in Bengaluru.
   - A listed status needs a named stock exchange.
   - A fact that fails is dropped (left unknown), never kept on trust.
   - `verified_at` is the date of that check.
3. **Local import** (`scripts/pilot/build_import.py --import` → `import-rows.json`, `pilot.csv`): geocodes each address and imports the companies into the **local** database through `import_commit`, as a local pilot *editor*. Every company and office is a **draft** and every piece of evidence is a **claim**.

## Where it stands (6 Oct 2026, after round 3: groups J and K)

| Step | Count |
| --- | --- |
| Candidates researched | 143 (some twice, in a retry round) |
| Evidence items checked against raw pages | 394 verified; 43 quotes not found on the page; 9 pages could not be fetched; 39 facts without evidence; 1 address only partly on the page |
| Companies with a verified name, website, and Bengaluru address | **51** |
| Placed by the geocoder | **46** imported. Atlassian, BYJU'S, InMobi, ThoughtSpot and Wipro could not be placed and need a person to place them |
| Imported locally | 46 companies, 46 offices (draft); every evidence item a claim; 0 reviewed, 0 published |
| Optional facts that verified | description 21, sectors 22, type tags 14, listing status 0 |

**The pilot target is 50: 51 are verified, 46 are imported.** Earlier rounds fell short because of:
- sites that serve their text only through JavaScript;
- sites that block plain HTTP fetches (403, 500, timeouts);
- addresses that appear only in images or structured data.

These need a person with a browser, or another research round.

## What the reviewer has to do

- **BYJU'S operating status.** Check it before publication (insolvency history); the page gives no PIN code.
- **Map points (all imported).** Coordinates come from OpenStreetMap's Nominatim and are **for local review only**: OSM data is ODbL-licensed, and the production geocoding provider is open decision D-07. Almost all matched only at locality level (area or PIN code), so they sit in the review queue. Every point must be placed properly, and re-derived with the chosen provider, before anything is published.
- **Display names.** Several records carry the legal entity, as the official page prints it, not the brand: Delightful Gourmet (Licious), Sorting Hat Technologies (Unacademy), Draftspotting Technologies (SpotDraft), Exotel Techcom. The reviewer decides the display name and records evidence for it.
- **Weak judgements.** Each record's `_review_notes` in `import-rows.json` lists what the research was unsure of and which facts were dropped. Some tags rest on general wording, for example "fintech" for an insurer, or "product" from a tagline. Approving them is a reviewer's decision, and dropping them is always allowed.
- **Startup tags.** None are set: owner definition ADR-0023 needs documented evidence, which this round did not gather.
- **Founders and jobs.** None were researched in this round.

## Reproducing

From `code/`, with the local database running:

```
python -m scripts.pilot.verify_research
python -m scripts.pilot.build_import
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres python -m scripts.pilot.build_import --import
```

`--import` refuses any database that is not local. The local database also holds the synthetic sample, and a build refuses a mix of real and synthetic companies. The pilot records are therefore for review in the admin, not for building the site, until a pilot-only data source exists (with hosted staging).
