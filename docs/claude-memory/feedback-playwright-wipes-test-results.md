---
name: feedback-playwright-wipes-test-results
description: Playwright empties test-results/ at the start of every run, so measurements written there are lost; and a long background run killed for low memory must not be restarted unasked
metadata:
  type: feedback
---

Playwright deletes its output folder (`test-results/`) at the start of each run. Raw numbers from the map validation gate were lost that way on 2026-10-04; the gate now writes to `code/gate-results/` (git-ignored) and `scripts/gate-report.mts` turns them into the report.

**Why:** a second run (DPR 2) would have wiped the first run's files, and an earlier S-dataset result was already gone.

**How to apply:** write anything that must survive a later run outside `test-results/`. Before a long gate or e2e run check free memory (about 4 GB for the gate). If Claude Code stops a background run for low memory, report it and wait to be asked before starting it again; do not retry on your own. See [[feedback-stale-test-server]] and [[feedback-e2e-suite-conventions]].
