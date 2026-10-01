# Claude Code memory for this project

These are the memory files Claude Code keeps for Company Map. Claude Code stores memory **outside** the repository, in your home directory, so it does not sync by itself. This folder is the copy that travels through GitHub. It holds no secrets.

## Install on a laptop

1. Open the repository in Claude Code once (run `claude` in the folder), so it creates its project folder.
2. Find the folder. It is `~/.claude/projects/<the project path with separators turned into dashes>/memory/`. On Windows that is under `C:\Users\<you>\.claude\projects\`, and the name looks like `C--Users-<you>-Videos-Job-Map-App-City-Based-Job-Map`. The folder in `projects` that was modified most recently is the one.
3. Copy these files into its `memory` folder, replacing files of the same name:

   - PowerShell: `Copy-Item docs\claude-memory\*.md "$env:USERPROFILE\.claude\projects\<folder>\memory\" -Force`
   - bash: `cp docs/claude-memory/*.md ~/.claude/projects/<folder>/memory/`

   Copy `MEMORY.md` too: it is the index Claude Code loads each session. Then delete `README.md` from the `memory` folder (it is only for this repo).

## Keep the two laptops in step

When Claude Code adds, changes, or removes a memory on one laptop, copy the changed files into `docs/claude-memory/` (the same command the other way round), commit, and push. On the other laptop, `git pull` and copy them in. If both changed, merge by hand: each file is one fact.
