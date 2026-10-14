# ADR-0026: Two laptops, with GitHub as the shared code and project memory

- **Status:** Accepted (owner, 14 Oct 2026)
- **Date:** 2026-10-14
- **Related tasks / decisions:** supersedes the "one machine" note of 5 Oct 2026 (`docs/claude-memory/user-two-laptops.md`)
  and the "push only when asked" rule of 1 Oct 2026; GIT-1 (history cleanup); [PROJECT_HANDOVER.md §14.3](../../PROJECT_HANDOVER.md)

## Context

The project is developed on two laptops, Windows 11 and macOS. Either one must be able to resume where the other
stopped. Until now the state lived partly outside Git: Claude Code's memory in the user's home folder, the "current state"
in a long progress log, and 47 commits that were never pushed. Pushing was allowed only on request.

## Decision

1. **GitHub holds the latest code and the project context.** The context is in tracked Markdown:
   [session-handoff.md](../session-handoff.md) (current state, next action, what is not synced), [progress.md](../progress.md)
   (the dated log), this folder (decisions), and [claude-memory/](../claude-memory/README.md) (working rules learned in past
   sessions). Claude Code's local memory folder holds only machine-specific notes.
2. **Standing push authorization** for ordinary code and documentation. After a coherent batch passes its relevant checks,
   the handoff is updated and committed with the work, and pushed. **This does not authorize** deployment, hosted changes,
   history rewriting, force pushes, Dependabot or other dependency merges, or paid services.
3. **Branch per task.** Short batches finished in one sitting go to `main`. Work that spans sessions or laptops goes on
   `wip/<task-id>-<slug>`, claimed in the handoff before work starts. One laptop edits a branch at a time. Unfinished work
   is never presented as validated on `main`.
4. **Integration without rewriting.** Fetch before starting and before pushing. Bring in the other laptop's commits with a
   fast-forward or a merge (`git pull --no-rebase`), never a rebase of pushed commits and never `--force`.
5. **The local database does not travel through Git.** One laptop at a time owns the pilot database, and the handoff says
   which. It moves only by an encrypted backup carried by hand
   ([setup-new-machine.md §8](../setup-new-machine.md#8-the-pilot-data-a-separate-secure-transfer)).

## Consequences

- A push to `main` runs CI (`ci.yml`, read-only, no secrets). A push to a `wip/` branch runs nothing, so WIP pushes are
  cheap and carry no validation claim.
- `main` keeps a linear-enough history without force pushes; merge commits are acceptable.
- Every session starts with `git fetch` and the handoff, and ends by saying exactly what did not sync.
- The memory copy in `docs/claude-memory/` is the original, so it no longer has to be copied into the home folder by hand.
- The Windows-only tooling (PowerShell keep-awake and power events in `scripts/e2e-full-run.mts`, `taskkill` clean-ups)
  has documented macOS equivalents; their behaviour on macOS is unverified until a Mac run records it.

## Sources (with date checked)

- Owner's instruction, 14 Oct 2026 (this session).
- GitHub settings read with `gh api` (GET only), 14 Oct 2026: no repository variables, no environments, no rulesets,
  `Deploy staging` disabled, workflow token read-only.
