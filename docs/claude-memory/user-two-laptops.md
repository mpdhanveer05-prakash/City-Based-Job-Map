---
name: user-two-laptops
description: "The owner works only on this Windows laptop for the whole project (decided 2026-10-05, reversing the 2026-10-04 plan to move to a Mac); no multi-machine sync needed"
metadata:
  node_type: memory
  type: user
  originSessionId: f9750ba0-ad84-41ba-84d7-23087fc63beb
  modified: 2026-10-05T04:25:28.746Z
---

On **2026-10-05** the owner decided to work on **one machine only, this Windows 11 laptop (PowerShell/Git Bash), from the start of the project to the end**. They are **not** moving to a Mac and will not switch between laptops. This reverses the 2026-10-04 note that said they would continue on a Mac.

**Why:** the owner prefers a single system. The earlier Mac plan came from the Windows laptop having too little free memory (about 4 GB needed) for the map gate run.

**How to apply:** assume Windows paths and shells; do not give macOS instructions or ask which machine they are on. The memory-sync and new-laptop material in `docs/claude-memory/` and `docs/setup-new-machine.md` is kept only as a backup, not the working flow. The memory-heavy P2-09 gate run still needs about 4 GB free on this laptop, so close other apps first and run it with nothing else heavy open (see [[feedback-playwright-wipes-test-results]]). Start a session by reading `CLAUDE.md`, `plan.md`, and `docs/progress.md`. See also [[project-setup-and-secrets]] and [[feedback-push-only-when-asked]].
