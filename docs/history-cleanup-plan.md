# History cleanup before the first push: plan (not run)

*Prepared and rehearsed 8 Oct 2026. Status: **not run**. Run only when the owner authorizes it; push only when the owner
asks (CLAUDE.md, GIT-1).*

## What it fixes, and what it does not

Only the commits that were **never pushed** (`origin/main..main`) are rewritten. `origin/main` (`883de71`) and everything
before it stay as they are, so the push afterwards is a plain fast-forward. No force-push is needed.

| Problem | Where | Fix |
| --- | --- | --- |
| OSM/Nominatim-derived pilot files (ODbL), which must never be published | `code/data/pilot/bangalore/geocode-cache.json`, `import-rows.json`, `pilot.csv`; added by `5812ed2`, removed by `b55857e`; in no pushed commit | removed from every rewritten commit |
| `Co-Authored-By: Claude …` trailers, against the owner's rule (commits carry only the owner's name) | 20 of the 23 unpushed commits (`93ca2a6` … `2e4d8a6`); none since `db239d4` | the trailer lines are deleted from each message |

**Not covered:**
- **38 commits already on GitHub carry the same trailer.** Removing them would rewrite published history and need a
  force-push over `main`. That is a separate decision for the owner, and not recommended.
- **Files are untouched.** The working tree after the rewrite is byte-for-byte the same as before (checked below).

## Preconditions
1. The owner has authorized the rewrite.
2. Everything is committed: `git status --short` prints nothing. Stop any `next dev`.
3. `git fetch origin`, then confirm `origin/main` is still `883de71`, or at least that it is an ancestor of `main`:
   `git merge-base --is-ancestor origin/main main && echo ok`. If GitHub's `main` moved, stop and re-plan.
4. Note the values the checks compare against:
   ```
   git rev-parse main 'main^{tree}' origin/main
   git rev-list --count origin/main..main
   ```

## Steps (from the repository root)

**1. Recovery references, before anything changes.**
```
git branch backup/pre-history-cleanup-<date> main
git bundle create .local-backups/pre-history-cleanup-<date>.bundle --all
git bundle verify .local-backups/pre-history-cleanup-<date>.bundle
```
`.local-backups/` is git-ignored. The bundle holds every ref and object, and restores without the network.

**2. The rewrite.**
```
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f \
  --index-filter 'git rm -q --cached --ignore-unmatch code/data/pilot/bangalore/geocode-cache.json code/data/pilot/bangalore/import-rows.json code/data/pilot/bangalore/pilot.csv' \
  --msg-filter "sed -e '/^Co-Authored-By: Claude/Id' | git stripspace" \
  --prune-empty -- origin/main..main
```
- `git filter-branch` ships with Git; nothing to install.
- The author and committer names and dates are kept.
- `--prune-empty` would drop a commit left empty. None is: `b55857e` keeps its `.gitignore` change.

**3. Checks.** Every line must hold; otherwise go to *Recovery*.

| Check | Command | Expected |
| --- | --- | --- |
| Same files at the tip | `git rev-parse 'main^{tree}'` | the tree noted in precondition 4 |
| Same number of commits | `git rev-list --count origin/main..main` | the count noted (23 on 8 Oct, plus any later commits) |
| Base untouched; fast-forward possible | `git merge-base --is-ancestor origin/main main && echo ok` | `ok` |
| No OSM file anywhere in the rewritten commits | `git rev-list origin/main..main -- code/data/pilot/bangalore/geocode-cache.json code/data/pilot/bangalore/import-rows.json code/data/pilot/bangalore/pilot.csv` | nothing |
| No trailer left | `git log --format=%B origin/main..main \| grep -ci 'co-authored-by: claude'` | `0` |
| Each commit changed only where intended | for each old/new pair (`git rev-list --reverse origin/main..backup/pre-history-cleanup-<date>` against `git rev-list --reverse origin/main..main`): `git diff --name-only <old> <new>` | empty, or only the three OSM files (only `5812ed2`'s counterpart differs) |
| Authors, dates and subjects kept | per pair, `git log -1 --format='%an\|%ae\|%ad\|%cd\|%s'` | identical |
| Messages otherwise intact | per pair, the old message through `sed -e '/^Co-Authored-By: Claude/Id' \| git stripspace` | equals the new message |
| Tests | from `code/`: `npm run lint`, `npm run typecheck`, `npm test` | as before the rewrite |

The pairwise checks are scripted in the session scratchpad's `history-rehearsal.sh`. The same commands are listed above, so
the plan does not depend on that file.

**4. Tidy up the local repository.** After the checks pass, the rewritten-away objects stay reachable from
`refs/original/` and the backup branch. Remove only `refs/original/` (it is not pushed in any case):
```
git for-each-ref --format='%(refname)' refs/original/ | xargs -n 1 git update-ref -d
```
Keep `backup/pre-history-cleanup-<date>` and the bundle until the push has been checked on GitHub.

**5. Push (separate approval).** `git push origin main`, a fast-forward with no `--force`. Then check on GitHub:
- the OSM files are absent from the commit page of the rewritten `5812ed2` (new hash);
- the newest commits show only the owner as author.

## Recovery
At any point before the push:
```
git reset --hard backup/pre-history-cleanup-<date>
```
This discards any work since step 1, which is why precondition 2 requires everything to be committed. If the branch is
gone, use the bundle:
```
git fetch .local-backups/pre-history-cleanup-<date>.bundle 'refs/heads/main:refs/heads/restore-main'
git reset --hard restore-main
```

## Rehearsal (8 Oct 2026)
On a throwaway clone of the repository at `58fccfc`, with `origin/main` = `883de71` fetched in; the real repository was
not written. The recovery branch and bundle were made and the bundle verified. After the rewrite:
- **Tip:** the same tree (`a2202f22be34`), and still 23 commits on the same base.
- **Removed:** no OSM file in any commit, and no trailer in any message.
- **Unchanged otherwise:** authors, dates, subjects and message bodies preserved. Exactly one commit (`5812ed2`'s
  counterpart) differs from its original, and only in the three OSM files.
- **Push:** a fast-forward is possible.
- **Recovery branch:** still at the old head.

The real repository's `HEAD` was checked unchanged afterwards. The clone and bundle were deleted.
