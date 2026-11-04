# ADR-0027: One development laptop from 4 Nov 2026

- **Status:** Accepted (owner, 4 Nov 2026)
- **Date:** 2026-11-04
- **Related tasks / decisions:** amends [ADR-0026](0026-two-laptop-workflow.md) (two laptops). Replaces MAC-1 and DB-MOVE-to-Mac
  with RESCUE-1, SETUP-1 and DB-RESTORE ([plan.md](../../plan.md)). Runbook:
  [project-recovery/NEW_MACHINE_SETUP.md](../project-recovery/NEW_MACHINE_SETUP.md)

## Context

ADR-0026 (14 Oct 2026) assumed two machines, the Windows laptop and a Mac, with GitHub carrying code and context between
them. The Mac was never set up. On 4 Nov 2026 the owner moved to a **new Windows laptop** with a fresh clone, and answered
(4 Nov 2026, in the recovery session):
- this new laptop is the **only** development machine from now on;
- the old Windows laptop is available **for a short time**;
- it isn't known whether any work after 2 Nov 2026 was left unpushed there.

The old laptop holds the only copy of the pilot database, the OSM-derived pilot files, `.local-backups/` and the Geoapify
key.

## Decision

1. **One development laptop:** the new Windows laptop. MAC-1 and moving the pilot database to a Mac are dropped.
2. **ADR-0026's practices stay in force.** GitHub holds the latest code and the project context. There is standing push
   authorization for checked code and docs. Work that isn't finished goes on WIP branches. Integration never uses
   force-pushes or rebases of pushed commits. A session ends by saying exactly what did not sync. They still protect the
   work if a second machine is ever added again, or if this one is lost.
3. **The old laptop is rescued before it is released:** RESCUE-1 exports everything, and DB-RESTORE proves the copy on
   the new laptop with the backup drill's `verify`. Only then does the handoff name the new laptop as the pilot-database
   owner.
4. **The clone lives at a path without spaces** (`C:\dev\City-Based-Job-Map`), as the setup guide asks.

## Consequences

- `CLAUDE.md`'s "Two laptops" rules still read correctly with one laptop; its introduction and the memory note
  `user-two-laptops.md` now point here.
- The macOS sections of `docs/setup-new-machine.md` stay as reference for a future Mac. They were never run.
- Until DB-RESTORE is done, the handoff's "Pilot database owner" remains the old laptop.

## Sources (with date checked)

- Owner's answers in the 4 Nov 2026 recovery session.
- Fresh clone checked read-only on 4 Nov 2026: `main` = `origin/main` = `f95e9ae`; no local-only files present.
