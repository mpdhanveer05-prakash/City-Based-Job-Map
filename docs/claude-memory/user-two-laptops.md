---
name: user-two-laptops
description: "From 4 Nov 2026 the owner develops on ONE new Windows laptop (ADR-0027); the two-laptop plan (Windows + Mac, ADR-0026) is dropped, but GitHub stays the shared memory"
metadata:
  type: user
  modified: 2026-11-04
---

**From 4 Nov 2026 the owner develops on one new Windows 11 laptop only** ([ADR-0027](../decisions/0027-one-development-laptop.md)). The Mac of ADR-0026 was never set up, and MAC-1 is dropped. The old Windows laptop is available only briefly. It holds the only copy of the pilot database and the local-only files, so it is rescued first (`docs/project-recovery/NEW_MACHINE_SETUP.md` Part A).

History: one Windows laptop (30 Sep), a Mac hand-off prepared (4 Oct), Windows only (5 Oct), "two laptops" (14 Oct, ADR-0026), one new Windows laptop (4 Nov).

**Why:** the owner's answer in the 4 Nov 2026 recovery session. The new laptop has 31.7 GB of memory. The old one often had about 2 GB free, so its "one heavy job at a time" constraint was machine-specific. Still run one full e2e at a time, and never compare timings across machines.

**How to apply:** the shell is PowerShell, plus Git Bash (check with `$env:OS`). Keep following CLAUDE.md's GitHub-as-memory rules: fetch first, read `docs/session-handoff.md`, push after each checked batch, WIP branches for unfinished work. The handoff names the laptop that owns the pilot database; until DB-RESTORE is done, that is the old laptop. See [[feedback-push-policy]] and [[project-setup-and-secrets]].
