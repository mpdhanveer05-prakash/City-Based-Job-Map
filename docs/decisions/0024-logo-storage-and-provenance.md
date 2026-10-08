# ADR-0024: Logo storage, provenance, and permitted use

- **Status:** Proposed. Built locally on 7 Oct 2026. The permitted-use categories need the owner's confirmation, and legal review where needed.
- **Date:** 2026-10-07
- **Related tasks / decisions:** P9-21. Also ADR-0012 (logo upload had no path), ADR-0016 (nothing invented), ADR-0021/0022 (evidence and review), the curation guide ("It is this company's current logo, and we may use it"), security.md (raster only, our own Storage host), and release checklist row 6.

## Context

Until now `company.logo_key` existed, but nothing could fill it. There was no bucket, no upload, and no record of where a logo came from or why we may show it. A logo is a trademark: showing one needs a basis, and the basis must be recorded.

## Decision

1. **Storage.** A public Supabase Storage bucket, `company-logos`. This is the one `lib/data/logo.ts` already reads. It accepts PNG, JPEG, WebP, GIF, and AVIF up to 1 MB; Storage enforces both, and SVG is refused (security.md).
   - Keys are `<company id>/<sha-256 of the file>.<ext>`. A key names exactly one file, and an upload never replaces another file.
   - Through the API, editors upload and only admins delete. All of these need an `aal2` session (P9-13).
2. **Provenance.** Every upload has a `logo_asset` record. It holds:
   - the address the file came from;
   - the permitted-use basis;
   - the https page that shows that basis;
   - a note (who allows it, and on what terms);
   - the date obtained;
   - the uploader.

   A record can be added only if the file is in the bucket. Nobody edits a record afterwards; changes go through the audit log.
3. **Permitted-use categories (proposal; the owner confirms them):**
   - `company_brand_assets`: the company's own brand, press, or media-kit page offers the logo for use.
   - `written_permission`: the company gave written permission. The note says who gave it and when.
   - `licensed_provider`: a logo provider whose licence covers this use. The note names the licence.

   Anything else is not uploaded. The panel says so, and the database refuses other values.
4. **Review.** A reviewer approves or rejects each upload with a note (`review_logo`). Approving makes it the company's logo. Rejecting the current logo removes it. A decision is final. A self-review is allowed and recorded, as for evidence.
5. **Gate.** A signed-in administrator can set `company.logo_key` only to an approved upload for that company, or clear it. The seed and the migration owner are not checked, as with the other gates.
6. **Postgres-only databases** (CI's `supabase db start`) have no `storage` schema. There, the migration skips the bucket and its policies, and `tests/database/15_logo_assets.test.sql` skips. Hosted projects and the full local stack have the schema.

7. **Changes after the first version (7 Oct 2026; this ADR is still Proposed).**
   - Uploads go to a private `company-logos-pending` bucket (`20261007130000`).
   - Each upload records the terms quote and the storage, display and atlas permissions (`20261007120000`).
   - Nothing may enter the public bucket before approval (SEC-2, `20261007150000`).
   - A logo becomes the company's logo only after the `activate-logo` Edge Function has hashed the pending upload's bytes
     and the public copy's bytes on the server (SHA-256) and both equal the hash the key names (`20261007160000`). No
     client-supplied hash or metadata establishes integrity.

## Consequences

- Logos can be loaded with a recorded basis, which release checklist row 6 needed.
- **Not built:**
  - the weekly logo check in data-pipeline.md;
  - copying approved logos into the static build (the map fetches them from the Storage host today, and `allowedHosts` limits it to that host);
  - an image-dimension check;
  - the Storage backup (P9-14).
- The categories are an engineering proposal, not legal advice. Until the owner confirms them, approved logos stay local.

## Sources (with date checked)

- Supabase Storage bucket options `file_size_limit` and `allowed_mime_types`, and RLS on `storage.objects`: the Supabase docs, Storage access control (checked 7 Oct 2026, local CLI 2.118.0).
