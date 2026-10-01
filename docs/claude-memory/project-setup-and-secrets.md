---
name: project-setup-and-secrets
description: Where secrets and local settings live for Company Map, and how to set up a new machine
metadata:
  type: reference
---

- GitHub repo: `https://github.com/mpdhanveer05-prakash/City-Based-Job-Map` (public). Full new-laptop steps: `docs/setup-new-machine.md`.
- The **Geoapify key** is only in `code/.env.local` (git-ignored). It is a browser key and is **not yet restricted by referrer** (decision D-11, an owner action). Never commit it. Without it, map pages use a blank Milky background and the basemap e2e specs skip.
- Cloudflare deploy secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are GitHub repository secrets, already set. Staging: `https://company-map-staging.company-map.workers.dev`. Production is not deployed and needs the owner's explicit authorization.
- Docker Desktop must be running for `npx supabase db start`. Node 24 or later.
- Open owner decisions are in the `plan.md` register (D-01 to D-11) and ADR-0009 (rotation and tilt off in the explorer).

**Why:** a fresh clone has none of these local settings, so the next laptop has to recreate them by hand.

**How to apply:** point to `docs/setup-new-machine.md` instead of repeating the steps. See [[user-two-laptops]].
