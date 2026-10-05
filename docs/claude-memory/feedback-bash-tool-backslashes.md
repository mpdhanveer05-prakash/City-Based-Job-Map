---
name: feedback-bash-tool-backslashes
description: "In this environment the Bash tool collapses backslashes inside commands (python heredocs, sed), and a heredoc with apostrophes can fail; write files with Write/Edit instead"
metadata:
  node_type: memory
  type: feedback
  originSessionId: f9750ba0-ad84-41ba-84d7-23087fc63beb
  modified: 2026-10-05T06:43:03.855Z
---

When a file's content needs backslashes (regex escapes, ` `, `\b`, JS string escapes), **do not create or patch it through a Bash command** (python heredoc, `sed`, `cat <<EOF`). The tool layer collapses one level of backslashes, so `\\u003c` arrives as `<`, which Python or JS then turns into a real character: this put U+2028 line terminators into a TypeScript source file and produced a template literal with a backspace (`\b`). A long heredoc containing many apostrophes also failed once with "unexpected EOF while looking for matching `'`".

**Why:** it cost several failed test runs on 5 Oct 2026 (P4-03, P6-01) before the cause was clear.

**How to apply:** use the Write tool for new files and the Edit tool for patches whenever the text has a backslash or a lot of quotes (the Edit and Write tools keep `\\b` as typed). Use Bash only for commands, and for Python edits keep the text free of backslashes (build them with `chr(92)` or `String.fromCharCode(92)` if truly needed). After writing a file with escapes, `grep -c` for the stray characters or run the tests at once. See [[feedback-e2e-suite-conventions]] for the test runs.
