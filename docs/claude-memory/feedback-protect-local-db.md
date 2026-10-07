---
name: feedback-protect-local-db
description: Never db reset the main local Supabase DB; DB/admin tests use an isolated disposable stack or backup-and-restore
metadata:
  node_type: memory
  type: feedback
  originSessionId: d3b7802d-4556-4f6b-86b0-ff25c6e5bdb3
  modified: 2026-10-07T04:17:55.141Z
---

Never run `npx supabase db reset` (or anything destructive) against the main local database. It holds the 46 Bengaluru pilot drafts (restored 7 Oct 2026 via `python -m scripts.pilot.build_import --import`) and owner work.

**Why:** On 7 Oct 2026 I reset it twice for pgTAP/admin e2e runs and erased the pilot drafts; the owner then ruled this out.

**How to apply:** For `supabase test db`, `npm run test:admin`, or anything needing clean fixtures, use an isolated disposable stack (separate project_id/ports, or a scratch database), OR first `pg_dump -Fc` to `.local-backups/` (git-ignored) and restore afterwards, and verify the pilot counts. Before preview builds, never overwrite the running synthetic `out/` preview; use a separate output directory and port. Overrides the "db reset first" advice in [[feedback-admin-e2e-and-local-stack]].
