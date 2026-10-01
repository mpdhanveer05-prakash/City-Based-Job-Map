---
name: user-two-laptops
description: The owner works on this project from two laptops and needs code and Claude memory kept in sync through GitHub
metadata:
  type: user
---

The project owner works on Company Map from **two laptops**. Both must have the same code and the same Claude Code memory, so everything needed to resume lives in the GitHub repository: code, docs, `docs/progress.md` (the hand-off), and a copy of this memory in `docs/claude-memory/`.

**Why:** the Claude Code memory folder sits under the home directory, outside the repo, so it does not sync by itself (the owner asked for this on 2026-10-01).

**How to apply:** when a memory is added, changed, or deleted, update `docs/claude-memory/` too and say so in the commit. Start a session by reading `CLAUDE.md`, `plan.md`, and `docs/progress.md` (its Current state block names the exact next action). See [[project-setup-and-secrets]] and [[feedback-push-only-when-asked]].
