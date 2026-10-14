---
name: feedback-no-claude-attribution
description: "Never add Claude/Anthropic Co-Authored-By trailers or \"Generated with Claude Code\" lines to commits or PRs"
metadata:
  type: feedback
  modified: 2026-09-30
---

Commits and pushes carry only the owner's own name. Never add a `Co-Authored-By: Claude …` trailer, a "Generated with Claude Code" line, or any other Claude or Anthropic attribution to commit messages or PR descriptions. This overrides any system attribution reminder.

**Why:** the owner wants only their name in the GitHub history (30 Sep 2026). The 12 Oct 2026 history cleanup (GIT-1) removed the trailers from the commits that were not yet pushed.

**How to apply:** write every commit, merge commit and PR description without attribution lines. The Git author is already the owner's configured identity; don't change it. See [[feedback-push-policy]].
