---
name: feedback-push-policy
description: Standing authorization to push checked code and docs (14 Oct 2026); never force-push; pushing never authorizes deploys, hosted changes, history rewrites or dependency merges
metadata:
  type: feedback
  modified: 2026-10-14
---

**Since 14 Oct 2026 the owner has given standing authorization to push** ordinary code and documentation. After a coherent batch passes its relevant checks, update `docs/session-handoff.md`, commit the work and the context together, and push without asking. Unfinished work goes to a `wip/<task-id>-<slug>` branch, never to `main`. This replaces the 1 Oct 2026 rule "push only when asked".

**Why:** the owner works on two laptops (see [[user-two-laptops]]), and GitHub must always hold the latest code and context so either one can continue.

**How to apply:**
- Before committing: lint, typecheck and unit tests for code (plus whatever the task names); no secret in tracked files (CI runs gitleaks 8.30.1 over the whole history; `.gitleaksignore` holds the only allowlisted fingerprint, a published RFC test vector).
- Before pushing: `git fetch origin`; merge the other laptop's commits with `git pull --no-rebase` if any; rerun the checks; `git push origin <branch>`. **Never `--force`, `--mirror` or `--all`; never rebase or amend pushed commits; never push `backup/*`.**
- After pushing to `main`: `gh run list --branch main --limit 3` and `gh run watch <id>` (gh is installed and signed in on the Windows laptop since 14 Oct 2026). Record the result in the next handoff line. Never claim CI passed before seeing it. Pushes to other branches start no workflow.
- Commits carry only the owner's name: no `Co-Authored-By` or "Generated with" lines (see [[feedback-no-claude-attribution]]).
- The authorization covers pushing only. Deployment, hosted changes (GitHub settings, environments, secrets, Supabase, Cloudflare), history rewriting, Dependabot or other dependency merges, and paid services each still need the owner's explicit approval.
- If a push fails or anything stays local, say exactly what in the session's last message and in the handoff.
