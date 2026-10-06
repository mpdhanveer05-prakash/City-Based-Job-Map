# ADR-0015: The dependency audit gates production dependencies; tooling findings are reported

- **Status:** Not accepted by the owner (6 Oct 2026); superseded by [ADR-0019](0019-dependency-vulnerability-exceptions.md). The move of `shadcn` to `devDependencies` is kept.
- **Date:** 2026-10-05
- **Related tasks / decisions:** P9-02, `docs/testing.md` (CI), `docs/security.md` (Secrets)

## Context

CI ran `npm audit --audit-level=high` over every dependency and failed on any high finding. On 5 Oct 2026 it reports **8 high findings, all in build tooling and all through `fast-glob`**, which depends on `micromatch` and `braces` (a stack-exhaustion denial of service on deeply nested glob patterns). The tools that pull it in are `shadcn` (the component CLI, with `ts-morph`) and `eslint-config-next`. `braces` is affected in every version, so there is **no fix to install**, and `npm audit fix --force` would only remove or downgrade the tools. Six of the eight were counted in the production tree only because `shadcn` was listed under `dependencies`.

`shadcn` was listed under `dependencies`, but nothing at run time uses it: the app only has `@import "shadcn/tailwind.css"` in `app/globals.css`, which the build bundles into the site's CSS, and the CLI (`components.json`). Nothing from its tree is shipped to a browser or into an Edge Function.

## Decision

1. Move `shadcn` to `devDependencies`, which is where it belongs.
2. Split the audit step in `ci.yml`: **`npm audit --omit=dev --audit-level=high` blocks** the build (what ships to visitors and runs in Supabase functions); **`npm audit --audit-level=high` runs as an informational step** (`continue-on-error`), so tooling findings stay visible in every run.
3. Review the informational step each month, and when `shadcn` or `fast-glob` publishes a fix, update and let the gate cover everything again.

## Consequences

- With the move, `npm audit --omit=dev --audit-level=high` reports **0 vulnerabilities** (run 5 Oct 2026).
- A vulnerable tool that runs on a developer's laptop or a CI runner against the repository's own files (glob patterns in the CLI) is accepted, not fixed. The braces issue needs a hostile pattern; the CLI is run by hand on trusted input. The runner holds no production secret during the `checks` job.
- This **weakens** the gate for tooling. If the owner prefers a gate over everything, revert step 2 and accept a red CI until a fix exists, or remove `shadcn` and `eslint-config-next` (which would mean maintaining the UI components and lint rules by hand).
- Dependabot still proposes updates weekly for both groups.

## Sources (with date checked)

- `npm audit` output and advisory GHSA-vfj7-8cjw-p6xm (braces), from the local run on 5 Oct 2026. The advisory text was not re-read online during this task.
