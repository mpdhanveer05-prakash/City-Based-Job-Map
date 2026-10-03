---
name: user-two-laptops
description: The owner works from more than one laptop and needs code and Claude memory kept in sync through GitHub; from 2026-10-04 the main machine is moving from Windows to a Mac
metadata:
  type: user
---

The project owner works on Company Map from **more than one laptop**. All of them must have the same code and the same Claude Code memory, so everything needed to resume lives in the GitHub repository: code, docs, `docs/progress.md` (the hand-off), and a copy of this memory in `docs/claude-memory/`.

On 2026-10-04 the owner said they cannot free enough memory on the Windows laptop (the map gate needs about 4 GB free) and will **continue on a Mac** by cloning the repo. Expect macOS paths, zsh or bash, Docker Desktop for Mac, and no PowerShell. The first Mac session should follow `docs/setup-new-machine.md` and then `docs/progress.md` ("Current state").

**Why:** the Claude Code memory folder sits under the home directory, outside the repo, so it does not sync by itself (the owner asked for this on 2026-10-01).

**How to apply:** when a memory is added, changed, or deleted, update `docs/claude-memory/` too and say so in the commit. Start a session by reading `CLAUDE.md`, `plan.md`, and `docs/progress.md`. See [[project-setup-and-secrets]], [[feedback-push-only-when-asked]], and [[feedback-playwright-wipes-test-results]].
