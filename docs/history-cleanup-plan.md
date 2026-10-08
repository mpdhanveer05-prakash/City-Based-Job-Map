# History cleanup before the first push: plan (not run)

*Prepared 8 Oct 2026; rehearsed again at `1094e08` (29 unpushed commits). Status: **not run**. Run only when the owner authorizes it; push only when the owner
asks (CLAUDE.md, GIT-1).*

## What it fixes, and what it does not

Only the commits that were **never pushed** (`origin/main..main`) are rewritten. `origin/main` (`883de71`) and everything
before it stay as they are, so the push afterwards is a plain fast-forward. No force-push is needed.

| Problem | Where | Fix |
| --- | --- | --- |
| OSM/Nominatim-derived pilot files (ODbL), which must never be published | `code/data/pilot/bangalore/geocode-cache.json`, `import-rows.json`, `pilot.csv`; added by `5812ed2`, removed by `b55857e`; in no pushed commit | removed from every rewritten commit |
| `Co-Authored-By: Claude …` trailers, against the owner's rule (commits carry only the owner's name) | 20 of the unpushed commits (`93ca2a6` … `2e4d8a6`); none of the 9 since (`db239d4` … `1094e08`, and this plan's own update) | the trailer lines are deleted from each message |

**Not covered:**
- **38 commits already on GitHub carry the same trailer.** Removing them would rewrite published history and need a
  force-push over `main`. That is a separate decision for the owner, and not recommended.
- **Files are untouched.** The working tree after the rewrite is byte-for-byte the same as before (checked below).

## The unpushed commits (8 Oct 2026, `origin/main` = `883de71`)

The rewrite covers `origin/main..main`, so any commit made after this list is included automatically. Count again
before running (precondition 4).

| Commit | Subject | Claude trailer | OSM-derived files |
| --- | --- | --- | --- |
| `93ca2a6` | P9-07: per-field evidence, review, and publication gates (ADR-0021); C | yes | — |
| `ae3172c` | P9-07 follow-ups (ADR-0022): job evidence, reviewed changes to public  | yes | — |
| `fa6e608` | Feed governance (ADR-0022 s7), classification definitions (ADR-0023),  | yes | — |
| `e8bb5ad` | WIP: feed admin page and review actions, export-repair tests, Bengalur | yes | — |
| `5812ed2` | Bengaluru pilot: verified research, local draft import (41 verified, 3 | yes | 3 file(s) |
| `b55857e` | Pilot: keep OSM-derived coordinates out of git until D-07 (geocoding p | yes | 3 file(s) |
| `4302801` | P9-20: Bengaluru pilot research round 3 (groups J, K): 51 verified, 46 | yes | — |
| `4d7d3f2` | Progress: pilot round 3, corrections to publication rule and coordinat | yes | — |
| `64845fb` | P9-07: restore the publication rule: every populated company fact need | yes | — |
| `75b0265` | DEF-1: demonstrate the 17 px Apply cause (pending stylesheet, no HTTP  | yes | — |
| `337ca02` | P9-13: admin MFA: is_admin() requires aal2; TOTP set-up and code scree | yes | — |
| `70aedec` | P9-21: logo storage, provenance records, reviewer approval, logo_key g | yes | — |
| `e98abe5` | P9-20: pilot-only local preview build (scratch copy, banner, noindex,  | yes | — |
| `e0dd89c` | DEF-2, P2-09a, P2-09b: map-load timings, one map-heavy test at a time; | yes | — |
| `8e41cfc` | Plan and progress: 7 Oct status, DEF-1 to DEF-3, blockers | yes | — |
| `0f79828` | DEF-3 and DEF-1 proofs and fixes; logo pending bucket and permitted-us | yes | — |
| `18f58b2` | P9-13, P9-21, DEF-1 to DEF-3: final verification runs recorded (e2e 27 | yes | — |
| `04aa427` | Deploy environments: staging approval gate, per-environment config che | yes | — |
| `ab6694d` | Docs: PROJECT_HANDOVER.md (reviewed at 04aa427); correct a pilot-files | yes | — |
| `2e4d8a6` | SEC-1..4, publication loophole, listed offices; disposable test stack  | yes | — |
| `db239d4` | Logo SHA-256 activation; open-tab, snapshot and smoke-policy tests; ma | no | — |
| `a624c2f` | REBUILD-1: production data refresh of the last approved release (ADR-0 | no | — |
| `58fccfc` | P9-12: JavaScript budget: explorer 629 -> 566 KB gzipped (zod/mini, Qu | no | — |
| `4ea4218` | P9-04: backup drill covers the database by content, Auth and Storage f | no | — |
| `80085b6` | FEED-TESTS: feed approve, withdraw and resolve tested as each role; un | no | — |
| `8ed2437` | P9-20: pilot script tests; pilot preview shows records again, with sim | no | — |
| `35190ce` | SEC-MINOR: feedback refuses without a salt or a checked client-address | no | — |
| `85c054e` | REBUILD-1: release provenance from the release record; approved baseli | no | — |
| `1094e08` | Docs: progress, plan and handover for the 8 Oct batch; history-cleanup | no | — |
| (this plan's update) | GIT-1: history-cleanup plan covers the 8 Oct commits | no | — |

`b55857e` deleted the three files, so its tree is the same before and after the rewrite. Only `5812ed2`'s tree changes.

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
| Same number of commits | `git rev-list --count origin/main..main` | the count noted (30 once this plan's update is committed, plus any later commits) |
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

## Rehearsal (8 Oct 2026, repeated at `1094e08`)

**Second run, at `1094e08` (29 commits), after the batch commits:**
- **Tip:** the same tree (`f1cb92985c04`), and still 29 commits on `883de71`.
- **Removed:** no OSM file and no trailer anywhere.
- **Unchanged otherwise:** authors, dates, subjects and the rest of each message kept. Only `5812ed2`'s counterpart
  differs, and only in the three files.
- **Push:** a fast-forward is possible.
- **Recovery branch:** still at the old head.

The real repository's `HEAD` was unchanged, and the clone and bundle were deleted.

**First run, at `58fccfc` (23 commits):**
On a throwaway clone of the repository at `58fccfc`, with `origin/main` = `883de71` fetched in; the real repository was
not written. The recovery branch and bundle were made and the bundle verified. After the rewrite:
- **Tip:** the same tree (`a2202f22be34`), and still 23 commits on the same base.
- **Removed:** no OSM file in any commit, and no trailer in any message.
- **Unchanged otherwise:** authors, dates, subjects and message bodies preserved. Exactly one commit (`5812ed2`'s
  counterpart) differs from its original, and only in the three OSM files.
- **Push:** a fast-forward is possible.
- **Recovery branch:** still at the old head.

The real repository's `HEAD` was checked unchanged afterwards. The clone and bundle were deleted.
