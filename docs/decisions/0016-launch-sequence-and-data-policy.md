# ADR-0016: Launch sequence, data sourcing, founders, and the "Product" definition

- **Status:** Accepted (owner decisions, 6 Oct 2026)
- **Date:** 2026-10-06
- **Related tasks / decisions:** resolves D-01, D-02 (follow-up), D-03, D-04 (policy; coverage targets still open). Amends [ADR-0002](0002-launch-scope-two-cities.md) (dates). P9-04, P9-07, P9-08.

## Context
ADR-0002 left the launch dates and sequencing open (D-01). D-04 asked for data sources and coverage targets, D-03 for the founder source and privacy handling, and D-02 still needed a written definition of "Product" for the curation guide.

## Decision
1. **Launch sequence (D-01).** Both cities are built and tested from the start. **Bengaluru goes live first.** Chennai is prepared with all of its data in parallel and is released after Bengaluru's launch. Each city still has to pass its own launch gate.
2. **Data sources (D-04).** We use verified company websites, official careers pages, permitted datasets, and company submissions. Directories and ecosystem lists are used to **discover** candidates only. Each candidate is verified against its official site, and a dataset's reuse conditions are checked before it's imported. **AI may extract and organise data, but it never invents companies, founders, locations, or jobs.** Unknown values stay empty.

   | Data | Preferred source | Verification |
   | --- | --- | --- |
   | Name, website | Official website | Name and domain match |
   | City, office address, coordinates | Official contact/location pages | Real office confirmed; address geocoded and the point reviewed on the map |
   | Description, industry | Official About/Product pages | Short factual summary |
   | Startup/MNC/Product tags | Published company information | Documented definitions; tags overlap |
   | Funding stage, status | Company announcements, reliable funding reports | Evidence and announcement date recorded; unknown stays empty |
   | Founders | Official leadership/About pages | Name verified, source recorded |
   | Logo | Official brand assets or a licensed logo provider | Correct company, permitted use confirmed |
   | Open jobs | Official careers pages or authorised feeds | Title, location, and a working application URL |

   **Evidence:** each important field carries a source URL and a verification timestamp, and each source carries a reuse/permission note. We also keep an edit audit trail, an approval status, and a public "Report incorrect information" option. **The process:** discover → verify → enrich → approve → publish → refresh. **Initial refresh schedule:** jobs daily, company links weekly, office and funding information monthly. A failed request means "needs checking"; it never deletes a company or closes all its jobs. **Offices:** a company can have several offices, stored separately from the company and pointing at one company profile, with location-specific jobs.
3. **Coverage (D-04, still open).** Targets are set after the available data has been assessed. The **proposal is a pilot of 50 verified companies per city**, followed by a larger agreed target. The pilot number isn't a launch requirement. The launch-gate thresholds in `lib/launch-gate.ts` stay proposals until the targets are agreed.
4. **Founders (D-03).** Founder search stays in scope. We publish **verified professional information** (name and role, from official pages, with the source recorded), and there's a correction/removal process. The data policy gets a review where necessary. A founder isn't automatically treated as a private individual, and the published information is limited to professional facts.
5. **"Product" (D-02).** *"A company that develops and sells its own repeatable software or technology product. Companies may also offer services."* Tags overlap.

## Consequences
- P9-07 checks that the admin import and schema hold everything listed above. In particular: the CSV columns `company_name, website, city, office_address, company_types, industry, description, source_url, verified_at`; per-field evidence (source URL and timestamp); and the refresh schedule. P9-07 then closes any gaps. The existing `office`, `source`, `verification_check`, and `audit_log` tables cover part of this already.
- P9-08 adds a public correction/removal route for founders and a published data policy.
- Chennai's data work runs in parallel. Its release is a separate data release with its own gate run and approval.

## Sources (with date checked)
- Owner instructions in the session of 6 Oct 2026.
