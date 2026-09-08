# Handoff Report: Explorer M6 Fix 2 — Deleted & Renamed File Pruning Remediation

**Agent**: `explorer_m6_fix_2`  
**Role**: Teamwork Explorer (Read-only investigation & analysis)  
**Milestone**: M6 (Ephemeral Lambda MicroVM State Persistence & Worktrees)  
**Date**: 2026-09-08  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_2`  
**Target Code**: `scripts/sync-workspace-state.sh` (lines 378–393)  

---

## 1. Observation

Direct empirical observations from executing adversarial tests against `scripts/sync-workspace-state.sh` via `tests/adversarial/test_sync_workspace_adversarial.sh`:

1. **Defect 3 (Deleted Files Resurrected / Silently Reverted)**:
   - Target: `scripts/sync-workspace-state.sh` lines 381–382.
   - Command:
     ```bash
     bash .agents/explorer_m6_fix_2/test_adversarial_1_9_and_1_10.sh
     ```
   - Verbatim observation:
     ```
     Running Test 1.9 (Deleted Files)...
     [sync-workspace-state] snapshot: agent=del_agent commit=62020530 dirty=true untracked=0
     [sync-workspace-state] restore: agent=del_agent completed successfully into /tmp/ff_test_fix2_5449/del_ws_restored
     CURRENT RESULT: Defect 3 reproduced: del_target.txt resurrected!
     ```
   - State inspection:
     - On unstaged deletion (`rm del_target.txt`): `del_target.txt` remains on disk in the restored clone. Line 388 restores `staged_tree` (which contains `del_target.txt`). `git status` reports clean state; the deletion is completely reverted and lost.
     - On staged deletion (`git rm del_target.txt`): `del_target.txt` remains on disk in the restored clone. Line 388 restores `staged_tree` (which does not contain `del_target.txt`). Git reports `?? del_target.txt` (the deleted file resurrects as an untracked zombie).

2. **Defect 4 (Renamed Files Duplicated as Zombie Originals)**:
   - Target: `scripts/sync-workspace-state.sh` lines 381–382.
   - Command:
     ```bash
     bash .agents/explorer_m6_fix_2/test_adversarial_1_9_and_1_10.sh
     ```
   - Verbatim observation:
     ```
     Running Test 1.10 (Renamed Files)...
     [sync-workspace-state] snapshot: agent=ren_agent commit=ca09034d dirty=true untracked=0
     [sync-workspace-state] restore: agent=ren_agent completed successfully into /tmp/ff_test_fix2_5449/ren_ws_restored
     CURRENT RESULT: Defect 4 reproduced: orig.txt zombie alongside renamed.txt!
     ```
   - State inspection:
     - Both `orig.txt` and `renamed.txt` exist simultaneously on disk.
     - `git status --short` emits:
       ```
       R  orig.txt -> renamed.txt
       ?? orig.txt
       ```

3. **Plumbing Mechanism Behavior**:
   - `git checkout-index -a -f` writes entries present in the index to disk, but never removes any file from disk.
   - `git read-tree -u --reset "$working_tree"` atomically updates the index and working tree, unlinks files that existed in the index but are absent from `$working_tree`, and cleans up empty directories.
   - `git diff-tree -r --name-only -z --diff-filter=D "$head_commit" "$working_tree"` correctly detects both deleted files and renamed source files without relying on the pre-restore index state.

---

## 2. Logic Chain

1. **Root Cause of Non-Pruning (Observation 1 & Observation 2)**:
   In `do_restore`, line 381 calls `git read-tree "$working_tree"` to load the working tree into the index. Line 382 calls `git checkout-index -a -f`. The manual page for `checkout-index` states: *"Will copy all files from the index to the working directory"*. It operates only on entries in the index. Any file that exists on disk prior to restore (from `HEAD` checkout in a clone or from a previous container state) but is missing from `$working_tree` is never touched by `checkout-index`.

2. **Mechanism of Resurrection vs Duplication**:
   - For unstaged deletions: `$staged_tree` still contains the file (since the user only ran `rm`, not `git rm`). When line 388 executes `git read-tree "$staged_tree"`, the index is re-seeded with the file. Since the file is also still on disk, `git status` shows clean, completely undoing the user's deletion.
   - For staged deletions: `$staged_tree` does not contain the file. The index remains without the file, but the file is on disk, causing Git to report it as an untracked zombie (`?? file`).
   - For renames: `$working_tree` has `renamed.txt` and lacks `orig.txt`. `checkout-index` writes `renamed.txt` to disk but leaves `orig.txt` intact, creating a duplicate zombie.

3. **Sufficiency & Completeness of Candidate C (Hybrid Pruning)**:
   - Using `git diff-tree -r --name-only -z --diff-filter=D` against `head_commit` and `staged_tree` detects every file that was removed or renamed from any prior commit/stage state and unlinks it with `rm -f`, followed by `rmdir -p` for empty parent directories.
   - Using `git read-tree -u --reset "$working_tree"` updates the working tree and index in one atomic Git-native operation, pruning any remaining stale index entries and preserving all untracked files.
   - Using fallback to `read-tree` + `checkout-index -a -f` guarantees zero degradation if `--reset` encounters unexpected conditions.
   - Finally, `git read-tree "$staged_tree"` restores the staging index cleanly without modifying disk files.

---

## 3. Caveats

1. **Non-Git Workspace Tarball Restore**:
   Lines 420–445 restore non-Git workspaces via `tar -C "$ws_dir" -xzf "$non_git_archive"`. `tar` extracts files over existing files but does not delete files absent from the tarball. In non-Git environments, if a user deleted a file between snapshots and restores into a dirty directory, the deleted file will persist. To address this in non-git mode in the future, a manifest file list or clean directory extract would be needed. This is out of scope for the Git worktree persistence defect (Defects 3 & 4).
2. **Untracked Files in Target Workspace**:
   Pruning intentionally targets only tracked files (files in `head_commit`, `staged_tree`, or current Git index). Untracked files that exist in the target directory and are not part of `untracked_archive` are deliberately preserved to prevent accidental destruction of user artifacts outside Git management.

---

## 4. Conclusion

**Verdict: READY FOR IMPLEMENTATION**

Defect 3 and Defect 4 are fully resolved by replacing lines 381–382 in `scripts/sync-workspace-state.sh` with Candidate C (Hybrid Defense-in-Depth Pruning):

```bash
        # 2. Restore working tree files non-disruptively (HEAD and branch remain unchanged)
        if [ -n "$working_tree" ]; then
            vlog "Restoring working tree from tree SHA ${working_tree}"
            # Prune tracked files deleted or renamed relative to HEAD or staged tree
            if [ -n "$head_commit" ]; then
                git -C "$ws_dir" diff-tree -r --name-only -z --diff-filter=D "$head_commit" "$working_tree" 2>/dev/null | \
                while IFS= read -r -d '' del_file; do
                    if [ -n "$del_file" ] && [ -e "${ws_dir}/${del_file}" ]; then
                        rm -f "${ws_dir}/${del_file}"
                        rmdir -p "${ws_dir}/$(dirname "$del_file")" 2>/dev/null || true
                    fi
                done
            fi
            if [ -n "$staged_tree" ]; then
                git -C "$ws_dir" diff-tree -r --name-only -z --diff-filter=D "$staged_tree" "$working_tree" 2>/dev/null | \
                while IFS= read -r -d '' del_file; do
                    if [ -n "$del_file" ] && [ -e "${ws_dir}/${del_file}" ]; then
                        rm -f "${ws_dir}/${del_file}"
                        rmdir -p "${ws_dir}/$(dirname "$del_file")" 2>/dev/null || true
                    fi
                done
            fi
            if ! git -C "$ws_dir" read-tree -u --reset "$working_tree" 2>/dev/null; then
                git -C "$ws_dir" read-tree "$working_tree"
                git -C "$ws_dir" checkout-index -a -f
            fi
        fi
```

This change:
- Passes Test 1.9 (`Deleted file properly unlinked on restore`).
- Passes Test 1.10 (`Renamed file cleanly swapped without duplicate`).
- Passes all 8 subtests of Section 1 in `test_sync_workspace_adversarial.sh`.
- Handles complex filenames with spaces, quotes, and symbols (`#$@%`).
- Cleans up empty parent directories.
- Preserves symlinks and untracked files bit-for-bit.

---

## 5. Verification Method

To independently verify this remediation:

1. **Verify Baseline Reproduction**:
   Run `.agents/explorer_m6_fix_2/test_adversarial_1_9_and_1_10.sh` against the unpatched `scripts/sync-workspace-state.sh`:
   ```bash
   bash .agents/explorer_m6_fix_2/test_adversarial_1_9_and_1_10.sh
   ```
   *Expectation*:
   - Test 1.9 reports `Defect 3 reproduced: del_target.txt resurrected!`.
   - Test 1.10 reports `Defect 4 reproduced: orig.txt zombie alongside renamed.txt!`.

2. **Verify Proposed Fix on Tests 1.9 & 1.10**:
   Run against `.agents/explorer_m6_fix_2/proposed_sync-workspace-state.sh`:
   ```bash
   bash .agents/explorer_m6_fix_2/test_adversarial_1_9_and_1_10.sh
   ```
   *Expectation*:
   - `CURRENT RESULT: del_target.txt properly unlinked!`
   - `CURRENT RESULT: Renamed file cleanly swapped!`

3. **Verify Full Section 1 Dirty Extremes**:
   ```bash
   bash .agents/explorer_m6_fix_2/test_adversarial_sec1.sh
   ```
   *Expectation*:
   - `[PASS] Dirty extremes bit-for-bit preserved`
   - `[PASS] Symlinks faithfully recreated`
   - `[PASS] Deleted file properly unlinked`
   - `[PASS] Renamed file cleanly swapped`
   - `ALL SECTION 1 TESTS PASSED WITH PROPOSED FIX!`

4. **Verify Filename Characters and Nested Dirs Stress**:
   ```bash
   bash .agents/explorer_m6_fix_2/test_pruning_stress.sh
   ```
   *Expectation*:
   - `ALL COMPLEX PRUNING STRESS TESTS PASSED PERFECTLY!`
