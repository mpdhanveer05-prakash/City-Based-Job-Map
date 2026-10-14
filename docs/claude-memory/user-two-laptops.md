---
name: user-two-laptops
description: "The owner develops on two laptops, Windows 11 and macOS (from 14 Oct 2026); GitHub carries code and project context between them"
metadata:
  type: user
  modified: 2026-10-14
---

From **14 Oct 2026** the owner develops on **two laptops: the Windows 11 laptop (PowerShell and Git Bash) and a Mac (zsh)**. Either one must be able to resume where the other stopped. This replaces the 5 Oct 2026 decision to stay on one Windows machine.

**Why:** the owner's choice (14 Oct 2026). The Windows laptop is often short of memory (about 2 GB free), which limits the map gate and long e2e runs.

**How to apply:** at the start of a session, find out which machine you are on (`uname` or `$env:OS`) and give commands for that shell; don't assume Windows. Follow the two-laptop rules in `CLAUDE.md` (fetch first, read `docs/session-handoff.md`, push after each checked batch, WIP branches for unfinished work). The pilot database lives on one laptop at a time; the handoff says which. Setup and the Windows/macOS differences: `docs/setup-new-machine.md`. See [[feedback-push-policy]] and [[project-setup-and-secrets]].
