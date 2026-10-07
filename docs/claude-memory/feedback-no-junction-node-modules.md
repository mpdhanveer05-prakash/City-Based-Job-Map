---
name: feedback-no-junction-node-modules
description: Never junction/symlink code/node_modules into a worktree; git worktree remove --force follows it and deletes the real packages
metadata:
  node_type: memory
  type: feedback
  originSessionId: d3b7802d-4556-4f6b-86b0-ff25c6e5bdb3
  modified: 2026-10-07T04:51:18.176Z
---

Do not `mklink /J` the real `code/node_modules` into a git worktree or scratch copy. On 7 Oct 2026 `git worktree remove --force` followed the junction and deleted most of `code/node_modules` (fixed with `npm ci`, which needed the :8788 wrangler preview stopped because miniflare files were locked).

**Why:** Windows junctions are traversed by recursive deletes; the damage hits the main checkout and running previews.

**How to apply:** For an old-commit worktree or a separate build dir, robocopy `code/` (node_modules included) or run `npm ci` there. If a junction exists, remove it first with `cmd /c rmdir <link>` (removes only the link). See [[feedback-protect-local-db]].
