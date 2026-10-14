# Shared Claude Code memory for this project

This folder is the project's working memory for Claude Code: rules and lessons learned in past sessions, one fact per file, with `MEMORY.md` as the index. **It is the original**, tracked in Git, so both laptops read the same version. `CLAUDE.md` tells every session to read `MEMORY.md` at the start. It holds no secrets.

The current state of the work is not here: it is in [../session-handoff.md](../session-handoff.md).

## How it relates to Claude Code's own memory folder

Claude Code also keeps a memory folder per machine, in the home directory (`~/.claude/projects/<project path with separators as dashes>/memory/`). That folder does not sync. Since 14 Oct 2026 ([ADR-0026](../decisions/0026-two-laptop-workflow.md)):

- **Project knowledge goes here**, not only in the home folder. When a session learns something that applies to the project (a rule from the owner, a trap that cost time), add or update a file here and commit it with the batch.
- **The home folder keeps only machine-specific notes** (for example, a quirk of that laptop's shell). Nothing needs to be copied into it. If it holds an older copy of a file here, this folder wins; delete or update the old copy.
- **Never** put credentials, tokens, TOTP secrets, database contents, or personal data in either place.

## When both laptops changed the same file

Git merges them like any text file. Each file is one fact: keep the newer decision, and if the two disagree, ask the owner.
