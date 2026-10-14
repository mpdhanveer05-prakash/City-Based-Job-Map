---
name: project-setup-and-secrets
description: Where secrets and local settings live for Company Map, and how to set up a new machine
metadata:
  type: reference
  modified: 2026-10-14
---

- GitHub repo: `https://github.com/mpdhanveer05-prakash/City-Based-Job-Map` (public). Full new-laptop steps, macOS and Windows: `docs/setup-new-machine.md`.
- The **Geoapify key** is only in each laptop's `code/.env.local` (git-ignored). It is a browser key and is **not yet restricted by referrer** (decision D-11, an owner action). Never commit it, and never paste it into chat. Without it, map pages use a blank Milky background and the basemap e2e specs skip.
- Cloudflare deploy secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are GitHub **repository** secrets (14 Oct 2026); the plan moves them into the `staging` environment (owner action, PROJECT_HANDOVER.md §14.4). Staging: `https://company-map-staging.company-map.workers.dev`. Production is not deployed and needs the owner's explicit authorization.
- `gh` is installed and signed in on the Windows laptop (14 Oct 2026); use it read-only for settings (`gh api` GET) and for CI results. Changing GitHub settings is a hosted change: owner only.
- Docker Desktop must be running for the local Supabase stacks. Node 24 or later.
- The pilot database and its backups never go in Git or any cloud folder unencrypted: they hold admin password hashes and TOTP secrets.
- Open owner decisions are in the `plan.md` register and `docs/session-handoff.md`.

**Why:** a fresh clone has none of these local settings, so each laptop has to recreate them by hand.

**How to apply:** point to `docs/setup-new-machine.md` instead of repeating the steps. See [[user-two-laptops]].
