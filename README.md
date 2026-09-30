# Company Map

A map-first company discovery portal for Bengaluru and Chennai. Visitors browse companies by office location, filter by type, startup stage and more, see live employer-sourced jobs, and apply on the employer's site. There is no public login.

> **Status:** planning. No application code yet. Start with [plan.md](plan.md).

## Documents
- [CLAUDE.md](CLAUDE.md): working rules for Claude Code and contributors
- [plan.md](plan.md): phased tasks and the open decisions
- [Architecture & Implementation Plan](Company%20Map%20—%20Architecture%20&%20Implementation%20Plan.md): the source architecture document
- BRD: **not in the repository yet**
- [docs/design-system.md](docs/design-system.md): brand colours (Milky + Mantis), type, layout, and map colours
- [docs/](docs/): architecture, map spec, data model, testing, security, data pipeline, ADRs, progress

## Stack
Next.js (App Router) · TypeScript · Tailwind + shadcn/ui · MapLibre + Supercluster (Web Worker, Comlink) · Supabase (Postgres/PostGIS, Auth, Storage, Cron, Edge Functions) · Cloudflare Workers via OpenNext · Python on GitHub Actions · Vitest, Playwright, axe-core.

## Setup (planned, unverified until task P1-01)
```bash
cp .env.example .env.local   # fill in values; never commit them
npm ci
supabase start && supabase db reset
npm run dev
```
Prerequisites: Node.js LTS, the Supabase CLI, Docker (for local Supabase), and Python 3.12+ for `scripts/`.
