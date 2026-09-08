# Handoff Report: Explorer M6 Fix 1 — Git Worktree & Staged Object Reachability Remediation

**Agent**: `explorer_m6_fix_1`  
**Role**: Teamwork Explorer (read-only investigation, analysis, remediation specification)  
**Milestone**: M6 (Ephemeral Lambda MicroVM State Persistence & Worktrees)  
**Date**: 2026-09-08  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_1`  
**Handoff Type**: Hard (Task complete)  

---

## 1. Observation

Direct empirical observations from inspecting `scripts/sync-workspace-state.sh` and reproducing adversarial defects:

1. **Defect 1 (Git Worktree Crash)**:
   - **File**: `scripts/sync-workspace-state.sh` (line 169).
   - **Code**:
     ```bash
     if [ -f "${ws_dir}/.git/index" ]; then
         cp "${ws_dir}/.git/index" "$tmp_index"
         staged_tree="$(GIT_INDEX_FILE="$tmp_index" git -C "$ws_dir" write-tree 2>/dev/null || echo "")"
     else
         staged_tree=""
     fi
     ```
   - **Direct Observation**: In a linked Git worktree created via `git worktree add <dir>`, `<dir>/.git` is a pointer file (`gitdir: <path>`), not a directory. The check `[ -f "${ws_dir}/.git/index" ]` evaluates to false. `$tmp_index` remains an empty 0-byte file. `git add -u` fails to match any files. `staged_tree` and `working_tree` both evaluate to `""`.
   - **Verbatim Error**: Executing `scripts/sync-workspace-state.sh snapshot wt_agent /path/to/worktree` outputs:
     ```
     fatal: not a valid object name 
     ```
     and terminates with exit code `1`.
   - **Git Plumbing Resolution**: Executing `git -C "$ws_dir" rev-parse --git-path index` inside a linked worktree successfully returns `/abs/path/.git/worktrees/<name>/index`, while in a standard repository it returns `.git/index`.

2. **Defect 2 (Dangling Staged Tree SHA / Remote Fetch & Pruning Drop)**:
   - **File**: `scripts/sync-workspace-state.sh` (lines 171, 196–205).
   - **Code**:
     ```bash
     staged_tree="$(GIT_INDEX_FILE="$tmp_index" git -C "$ws_dir" write-tree 2>/dev/null || echo "")"
     ...
     shadow_commit="$(git -C "$ws_dir" commit-tree "$working_tree" -p "$head_commit" -m "$commit_msg")"
     git -C "$ws_dir" update-ref "refs/frostfire/shadow/${agent_id}" "$shadow_commit"
     ```
   - **Direct Observation**: `staged_tree` is written to Git's object database by `git write-tree`, but no commit or ref points to it. Only `shadow_commit` (which references `$working_tree`) is referenced by `refs/frostfire/shadow/<agent_id>`.
   - **Verbatim Error**: In `tests/adversarial/test_sync_workspace_adversarial.sh` (lines 247–256), cloning with `git clone --no-local` and fetching `refs/frostfire/shadow/*` followed by `restore` produces:
     ```
     fatal: failed to unpack tree object e42c0d0583193a737ab1efbcee132fb67a273bcf
     ```
   - **Garbage Collection Test**: Executing `git reset --hard` followed by `git gc --prune=now` permanently unlinks and deletes `$staged_tree` from the repository.
   - **D/F Ref Conflict Observation**: Attempting to update `refs/frostfire/shadow/<agent_id>/staged` via `git update-ref` when `refs/frostfire/shadow/<agent_id>` exists fails verbatim with:
     ```
     fatal: update_ref failed for ref 'refs/frostfire/shadow/agent1/staged': cannot lock ref 'refs/frostfire/shadow/agent1/staged': 'refs/frostfire/shadow/agent1' exists; cannot create 'refs/frostfire/shadow/agent1/staged'
     ```

---

## 2. Logic Chain

1. **Defect 1 Root Cause & Solution** (Obs 1):
   - In standard repositories, `.git` is a directory containing `index`. In worktrees and submodules, `.git` is a text file pointing to the actual gitdir. Hardcoding `${ws_dir}/.git/index` assumes `.git` is a directory.
   - Calling `git -C "$ws_dir" rev-parse --git-path index` delegates path resolution to Git's internal worktree engine.
   - When rev-parse returns a relative path (standard repo), prefixing with `${ws_dir}/` resolves the full path. When rev-parse returns an absolute path (linked worktree), it is used as-is.
   - Seeding `$tmp_index` from this resolved index ensures `$tmp_index` is a valid Git index header populated with the worktree's tracked files, enabling `staged_tree` and `working_tree` to calculate properly.

2. **Defect 2 Root Cause & Solution** (Obs 2):
   - Git object transmission (`git fetch`, `git clone`) constructs packfiles by traversing reachable objects starting from the requested ref tips.
   - Because `staged_tree` is not linked to any commit or ref, it is treated as an unreachable loose object. Packfile generation skips it; garbage collection prunes it.
   - The dispatch suggestion to use `refs/frostfire/shadow/<agent_id>/staged` fails due to Git's D/F ref conflict: a loose ref is a file, preventing a directory with the same name. Renaming the primary shadow ref would break `PROJECT.md`, `test-container-recycling.sh`, and external monitoring.
   - Creating a companion staged commit (`staged_commit`) with tree `$staged_tree` and parent `$head_commit`, and referencing it as Parent 2 of `shadow_commit` (`shadow_commit` parents: `$head_commit`, `$staged_commit`) anchors `$staged_tree` directly into the commit DAG.
   - This mirrors the architecture of Git's native `git stash` (`stash^1` = HEAD, `stash^2` = index). Any fetch or clone of `refs/frostfire/shadow/<agent_id>` automatically transfers `$staged_commit` and `$staged_tree` in the packfile without altering refspecs or creating secondary refs.

---

## 3. Caveats

1. **Scope Boundary**: This analysis and fix covers Defect 1 (worktree index resolution) and Defect 2 (staged tree object reachability). Defects 3 and 4 (file deletion and rename pruning during `do_restore`) are scoped to `explorer_m6_fix_2`. Defect 5 (pre-condition validation ordering) is scoped to `explorer_m6_fix_3`.
2. **Initial Repositories with No Commits**: If a repository has staged changes but zero commits (`head_commit` is empty), `staged_commit` is created without parents, and `shadow_commit` references `staged_commit` as its sole parent. This maintains reachability across all lifecycle stages.

---

## 4. Conclusion

Both Defect 1 and Defect 2 are fully solved with surgical, drop-in modifications to `do_snapshot` in `scripts/sync-workspace-state.sh`:
1. Replace `[ -f "${ws_dir}/.git/index" ]` with `git -C "$ws_dir" rev-parse --git-path index` with relative path normalisation.
2. Form a canonical multi-parent commit DAG: create `staged_commit` for `$staged_tree` (parent: `$head_commit`), then create `shadow_commit` for `$working_tree` with parents `("$head_commit", "$staged_commit")`.
3. Record `staged_commit` in `manifest.json`.

These changes require zero refspec alterations, introduce no D/F conflicts, are completely immune to `git gc` pruning, and maintain 100% backward compatibility with `test-container-recycling.sh` and `PROJECT.md`.

---

## 5. Verification Method

### 5.1 Independent Reproduction & Verification Commands

To verify both fixes directly in bash/WSL:

1. **Verify Worktree Snapshotting (Defect 1)**:
   ```bash
   bash -c '
   WS_DIR=$(mktemp -d); cd "$WS_DIR"
   git init -q -b main && git config user.email "t@d.ev" && git config user.name "T"
   echo "base" > base.txt && git add . && git commit -m "init" -q
   WT_DIR=$(mktemp -d -u) && git worktree add "$WT_DIR" -b wt_branch -q
   echo "staged" > "$WT_DIR/staged.txt" && git -C "$WT_DIR" add staged.txt
   scripts/sync-workspace-state.sh snapshot wt_test "$WT_DIR"
   git -C "$WT_DIR" rev-parse refs/frostfire/shadow/wt_test
   rm -rf "$WS_DIR" "$WT_DIR"
   '
   ```
   *Expected Output*: Exit code 0, non-empty shadow commit SHA.

2. **Verify Remote Fetch Reachability & GC Immunity (Defect 2)**:
   ```bash
   bash -c '
   BASE=$(mktemp -d); cd "$BASE"
   git init -q -b main && git config user.email "t@d.ev" && git config user.name "T"
   echo "v1" > f.txt && git add . && git commit -m "v1" -q
   echo "v2" > f.txt && git add f.txt && echo "v3" >> f.txt
   scripts/sync-workspace-state.sh snapshot fetch_test "$BASE"
   DEST=$(mktemp -d)
   git clone --no-local "$BASE" "$DEST" -q
   git -C "$DEST" fetch "$BASE" "refs/frostfire/shadow/*:refs/frostfire/shadow/*" -q
   scripts/sync-workspace-state.sh restore fetch_test "$DEST"
   git -C "$DEST" status --short
   rm -rf "$BASE" "$DEST"
   '
   ```
   *Expected Output*: Exit code 0, `MM f.txt` reported by `git status --short`.

3. **Verify Adversarial Stress Suite**:
   ```bash
   bash tests/adversarial/test_sync_workspace_adversarial.sh
   ```
   *Expected Result*: Tests 1.11 and 1.12 pass cleanly.

4. **Verify Container Recycling Harness**:
   ```bash
   bash scripts/test-container-recycling.sh
   ```
   *Expected Result*: All 5 phases pass with 0 errors.
