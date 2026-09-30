# ADR-0001: Approved application stack

- **Status:** Accepted. The hosting (Workers via OpenNext) and Route Handlers are superseded by [ADR-0006](0006-free-tier-static-hosting.md)
- **Date:** 2026-09-30

## Context
The architecture plan (30 Sep 2026) sets out a final stack, and the project owner's brief confirms it.

## Decision
Use the stack listed in [CLAUDE.md](../../CLAUDE.md#approved-stack). Excluded unless a future ADR shows a concrete need: FastAPI, Celery, Redis, AWS, Kubernetes, a separate search engine, or MapLibre built-in clustering for company points.

## Consequences
- Search, filtering, and counts live in Postgres functions. Batch work is Python in GitHub Actions, so there are no long-running servers.
- The error-reporting and analytics tools are still open (D-07). The plan mentions Sentry only as an example.
