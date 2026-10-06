# Curation guide

How companies, offices, founders, and jobs get into the directory and stay right. It follows the owner's decisions of 6 Oct 2026 ([ADR-0016](decisions/0016-launch-sequence-and-data-policy.md), [ADR-0017](decisions/0017-company-status-separate-from-stage.md), [ADR-0021](decisions/0021-field-evidence-and-publication-gates.md), [ADR-0022](decisions/0022-evidence-for-jobs-changes-and-refresh.md)). The database enforces the rules marked **(enforced)**; the rest are for the people doing the work.

**The one rule above all:** never invent a company, founder, location, or job. Tools, AI included, may help find, extract, and organise information, but every fact that reaches the site comes from a source a person checked. If a value is unknown, leave it empty.

## 1. Sources

| Fact | Preferred source | What to check |
| --- | --- | --- |
| Company name, website | The company's official website | The name on the site matches; the domain is the company's own |
| Office address and map point | The official contact or locations page | It is a real office (not a registered-office address used only for filings); the point is on the building or campus |
| Description, industry (sectors) | The official About or Product pages | Write a short, factual summary in your own words; no marketing claims |
| Company type: Startup, MNC, Product | Published company information | Apply the definitions in section 2 |
| Funding stage, ownership status | The company's own announcements, or a reliable funding report | Record the announcement and its date; if it is not stated, leave it unknown |
| Founders | The official leadership or About page | Name and role exactly as published; professional facts only |
| Logo | The company's brand assets, or a licensed logo provider | It is this company's current logo, and we may use it |
| Jobs | The official careers page or an authorised feed (an applicant-tracking system the company uses) | Title, employer, location and work arrangement, and a working application link on the employer's site |

**Discovery is not evidence.** Directories, ecosystem lists, and news round-ups help find candidates. Every fact must then be checked on an official source. A dataset may be imported only after its reuse conditions are checked. Each **source** in the admin (Sources page) records its permission note.

## 2. Classifications

- **Startup** (owner baseline, ADR-0023): *"A company founded to develop and scale a repeatable business model under substantial uncertainty. Apply this classification using documented evidence; funding stage alone does not determine it."* A Seed or Series A round is not enough on its own, and neither is the absence of one.
- **MNC** (owner baseline, ADR-0023): *"A company with established business operations in more than one country. Overseas customers alone do not qualify it."* Look for offices, subsidiaries, or teams in another country, documented on an official source.
- **Product**: *"A company that develops and sells its own repeatable software or technology product. Companies may also offer services."* (owner's definition, ADR-0016).
- **Type, stage, and ownership are separate.** Company type (the tags above), funding stage (Startup only), and ownership status (any company) describe different things and are recorded separately; none is inferred from another.
- **The tags overlap.** A company can be Startup and Product, or MNC and Product. Tag every one that applies.
- **Startup stage** (only for a company tagged Startup; **enforced**): Pre-seed, Seed, Bootstrapped, Series A, Series B, Series C, Series C+. Use the latest round the company or a reliable report announced.
- **Ownership status** (any company): Private, Public (listed on an exchange), Acquired (now owned by another company). It is independent of the type tags.

## 3. Evidence (enforced)

- Every fact a record holds needs **evidence**: the https page that shows it (`source_url`) and **the date someone actually looked** (`verified_at`). Do not put today's date unless you checked today.
- Evidence belongs to the record it supports: company facts on the company, address and location on each office, a founder's name on the founder, a job's facts on the job.
- Evidence supports a **value**. If the value changes, the old evidence no longer counts ("evidence is for an older value").
- One source may support several facts, but only the facts you name. In a CSV, list them in `source_covers`; a fact with a different source gets `<field>_source_url` and `<field>_verified_at`. A row's source never counts for every field automatically.
- Recorded evidence is a **claim** until a reviewer reviews it.

## 4. Review and publication (enforced)

- **Editors** add and edit records and record evidence. **Reviewers** review evidence and publish. Editors cannot review or publish.
- A reviewer may review evidence they recorded themselves for now. The admin shows it as "by the person who recorded it", and the database stores it as `self_reviewed`. Prefer a second person when one is available. (Exceptions to the dependency audit always need an independent human; see section 9.)
- **To publish a company** it needs reviewed evidence for its name and website, at least one office with reviewed address and location evidence, and evidence for every other fact it holds. **An office** needs reviewed address and location. **A founder** needs a reviewed name. **A job** needs reviewed title, employer, location and work arrangement, and application link. The company page in the admin lists exactly what is missing.
- **Changing a public fact:** the change goes through only when the new value already has reviewed evidence. Record evidence with the **proposed value** first (the "Proposed value" box), have it reviewed, then save the change. Until then the public site keeps the old value.
- Every publication and unpublication is recorded with who approved it and when.
- The public "Verified" date of a company is the oldest checked date among its reviewed core facts. It says nothing about its jobs: the jobs page shows when the jobs were last confirmed.

## 5. Importing a CSV

- Required columns: `name, domain, city, address, lat, lng, source_url, verified_at`. Optional: `website_url, careers_url, description, types, startup_stage, ownership_status, sectors` (or `industry`), `accuracy, neighbourhood, tech_park, source_covers`, and `<field>_source_url` / `<field>_verified_at` for `name, website, description, types, sectors, startup_stage, ownership_status, address, location`.
- The admin preview shows what each row would do and every problem; nothing is saved until you confirm. Everything lands as a **draft**.
- A row whose domain is already listed adds an office to that company and needs evidence for the office only.
- `industry` is read as the sector list and must name known sectors.

## 6. Refresh

The pipeline checks each piece of current evidence against its source on a schedule (owner's initial schedule, `evidence_refresh_policy`):

| Facts | Every |
| --- | --- |
| Job title, employer, location, application link | day |
| Company name, website, description | week |
| Company type, sectors, stage, ownership status; office address and location; founders | month |

What a check can say, on the Review page under "Source checks that need a person":

- **Could not be read**: the page did not answer (network error, refusal, an error status). **Nothing is known about the value. Do not treat it as a change**; it will be checked again.
- **Not found**: the page answered, but the value is not on it. It is a *possible* change. Look at the source: if the fact did change, record evidence for the new value (with the proposed value), have it reviewed, and update the record. If the fact did not change, record fresh evidence for it.
- A check never changes a verified date. Only a person recording new evidence does.

Jobs also go through the link checker (two failed checks close a job), and the feeds: a job that disappears from its employer's feed is marked suspect and then closed. A closed job's closing time is recorded.

## 7. Corrections

- The public "Report incorrect information" form on every company and jobs page sends a report to the Review page.
- Treat a report as a lead, not as evidence. Check the official source, record evidence for the corrected value, have it reviewed, then change the record.
- If the report is wrong, reject it with a short note.

## 8. Removal requests

- A company or a named founder may ask to be removed or corrected. Founders are listed only with **verified professional information** from official pages (ADR-0016).
- On a removal request: confirm the requester speaks for the company or is the person named, then unpublish the record (a reviewer) and note the request. Publish now so the next build drops it. Keep the audit trail.
- Any personal or legal question goes to the owner; the data policy is reviewed where necessary.

## 9. What a release needs

- **No synthetic records in production** (enforced by the release build).
- **No published record without its required evidence** (enforced by the release build and the launch gate). Records published before evidence existed may stay in local and staging data, and must be fixed or unpublished before production.
- The launch gate thresholds per city are confirmed by the owner. The pilot is 50 verified companies per city; launch coverage is still to be agreed.
- **Dependency-audit exceptions** need a named human approver who is not the assessor, and a confirmed owner; an AI assessment is not an approval (ADR-0022). The release audit (`npm run audit -- --release`) fails otherwise.
