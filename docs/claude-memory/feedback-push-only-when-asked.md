---
name: feedback-push-only-when-asked
description: Commit locally per task; push to GitHub only when the owner asks, and pushes go straight to main
metadata:
  type: feedback
---

Make one small local commit per plan task (`P2-03: …`). Do not push unless the owner asks. When they do ask, push `main` directly: the owner chose direct merges instead of pull requests in P1-04, and a push runs the same CI jobs.

**Why:** the owner approves outward-facing actions explicitly. Each task summary ended by asking whether to push; they asked for a push on 2026-10-01 so a second laptop could continue.

**How to apply:** before pushing, run lint, typecheck, and the unit tests, and confirm `git grep` finds no secret in tracked files. After a push, read the CI result from `https://api.github.com/repos/mpdhanveer05-prakash/City-Based-Job-Map/actions/runs` (the repo is public and there is no `gh` CLI installed) and record the run link in `docs/progress.md`. Never claim CI passed before seeing it.
