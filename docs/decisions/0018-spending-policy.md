# ADR-0018: Free by default; justified production spending is allowed

- **Status:** Accepted (owner decision, 6 Oct 2026)
- **Date:** 2026-10-06
- **Related tasks / decisions:** amends [ADR-0006](0006-free-tier-static-hosting.md) (the "no paid plans" rule, D-09). Related: D-11, backups (P9-14), P9-04.

## Context
ADR-0006 recorded "no paid plans". The owner has said that this rule must not force weaker reliability, map quality, or recovery.

## Decision
- Keep the complete map and product functionality, and use free services where they're suitable.
- **Production spending is allowed when it's justified.** A proposal names the service, the plan, its monthly cost, the requirement it meets (reliability, map quality, recovery, capacity), and the free alternative that was considered. Nothing is bought or upgraded without the owner's approval of that proposal.
- The architecture of ADR-0006 stays: a static export, no request-time rendering, and no secrets in the Next.js app. Those are good design in their own right, not just cost choices.
- Development keeps using the local stack. Staging stays on free tiers unless a paid feature has to be tested before production.

## Consequences
- Candidates to evaluate rather than rule out: Supabase Pro for production (daily backups, point-in-time recovery, no project pausing), and a paid basemap plan if the Protomaps prototype (D-11) loses on quality or reliability.
- CLAUDE.md's "Free tiers only" section now points here.

## Sources (with date checked)
- Owner instructions, 6 Oct 2026.
