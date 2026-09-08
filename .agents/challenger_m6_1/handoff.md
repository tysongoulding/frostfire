# Handoff Report: Challenger M6.1 — Adversarial Worktree Sync & Git Plumbing Stress

**Agent**: `challenger_m6_1`  
**Role**: Empirical Challenger (critic, specialist)  
**Milestone**: M6 (Ephemeral Lambda MicroVM State Persistence & Worktrees)  
**Date**: 2026-09-08  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m6_1`  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

Direct empirical observations from executing adversarial tests against `scripts/sync-workspace-state.sh` via `tests/adversarial/test_sync_workspace_adversarial.sh`:

1. **Git Worktree Crash (Defect 1)**:
   - File: `scripts/sync-workspace-state.sh` (lines 169–178, 197–200).
   - In a Git worktree (`git worktree add ../wt -b feature`), `.git` is a pointer file (`gitdir: ...`), not a directory.
   - Observation: `[ -f "${ws_dir}/.git/index" ]` evaluates to false. `staged_tree` evaluates to `""`. The temporary index file `$tmp_index` remains 0 bytes. `git add -u` on an empty index matches 0 tracked files, leaving `working_tree` as `""`.
   - Command:
     ```bash
     scripts/sync-workspace-state.sh snapshot wt_agent /path/to/worktree
     ```
   - Verbatim stderr output:
     ```
     fatal: not a valid object name 
     ```
   - Exit code: `1`.

2. **Dangling Staged Tree SHA / Remote Fetch Failure (Defect 2)**:
   - File: `scripts/sync-workspace-state.sh` (lines 171, 197, 204).
   - Staged tree SHA is generated via `GIT_INDEX_FILE="$tmp_index" git -C "$ws_dir" write-tree`, but no Git ref or commit points to `$staged_tree`. Only `refs/frostfire/shadow/<agent_id>` is updated with `shadow_commit`, which references only `$working_tree` and `$head_commit`.
   - When a fresh workspace clones or fetches shadow refs via standard Git transport:
     ```bash
     git clone --no-local /path/to/repo /path/to/clone
     git -C /path/to/clone fetch /path/to/repo "refs/frostfire/shadow/*:refs/frostfire/shadow/*"
     scripts/sync-workspace-state.sh restore agent /path/to/clone
     ```
   - Verbatim stderr output:
     ```
     fatal: failed to unpack tree object <staged_tree_sha>
     ```
   - Exit code: `128` (or non-zero). Staged trees are also subject to silent pruning by `git gc --prune=now`.

3. **Deleted Files Resurrected / Silently Reverted (Defect 3)**:
   - File: `scripts/sync-workspace-state.sh` (lines 381–392).
   - In `do_restore`, `git read-tree "$working_tree"` + `git checkout-index -a -f` only copies files present in `$working_tree` to the disk; it never deletes files that are absent from `$working_tree`.
   - Observation:
     - Unstaged deletion: A tracked file `del_target.txt` deleted via `rm del_target.txt` remains on disk after restore. Line 389 restores `staged_tree` (which still contains `del_target.txt`). `git status` reports clean state; the deletion is completely reverted and lost.
     - Staged deletion: A tracked file deleted via `git rm del_target.txt` remains on disk after restore. Line 389 restores `staged_tree` (which does not contain `del_target.txt`). Git reports `D del_target.txt` and `?? del_target.txt` (the deleted file resurrects as an untracked zombie).

4. **Renamed Files Restored as Zombie Duplicates (Defect 4)**:
   - File: `scripts/sync-workspace-state.sh` (lines 381–392).
   - Tracked file `orig.txt` is renamed to `renamed.txt` (via `git mv orig.txt renamed.txt` or `mv orig.txt renamed.txt`).
   - On restore: `git checkout-index -a -f` creates `renamed.txt`, but leaves `orig.txt` on disk.
   - Observation: Both `orig.txt` and `renamed.txt` exist on disk. `git status --short` emits:
     ```
     R  orig.txt -> renamed.txt
     ?? orig.txt
     ```

5. **Premature Working Directory Mutation on Corrupt Archive (Defect 5)**:
   - File: `scripts/sync-workspace-state.sh` (lines 380–415).
   - In `do_restore`, lines 381–392 execute `git read-tree "$working_tree"`, `git checkout-index -a -f`, and `git read-tree "$staged_tree"` BEFORE validating `untracked_archive` SHA-256 (lines 408–413).
   - Observation: When `.untracked.tar.gz` has a bit flip or checksum mismatch, `restore` aborts with exit code `5`, but the working tree files have already been overwritten and mutated, leaving the workspace in an inconsistent, partially restored state.

6. **Successful Invariant Verifications**:
   - `flock` lock contention: Confirmed timeout with exit code `75` (`EX_TEMPFAIL`) when lock is held past `LOCK_TIMEOUT`.
   - Concurrent queuing: 5 concurrent background snapshots serialized cleanly with 0 failures and valid `manifest.json`.
   - Multi-tenant isolation: Distinct agent IDs snapshot simultaneously without lock interference.
   - Checksum audit on dirty extremes: Staged additions, unstaged modifications, deep nesting (4 directory levels), binary payloads with null bytes, empty files, filenames with spaces/symbols (`#$@%`), and symlinks (file, directory, relative) restored bit-for-bit identical.
   - Active branch invariance: `git symbolic-ref HEAD`, `git rev-parse HEAD`, and `git log --oneline` are byte-identical before and after `snapshot` and `restore` on both named branches and detached HEAD.
   - Rust workspace gates: `cargo test --workspace` passed (80+10+6+6+12+2+1+7+6+14+4 tests) with 0 warnings; `cargo clippy --workspace -- -D warnings` passed with 0 warnings.

---

## 2. Logic Chain

1. **Worktree Root Cause (Observation 1)**: `scripts/sync-workspace-state.sh` line 169 explicitly tests `[ -f "${ws_dir}/.git/index" ]`. In a linked Git worktree or submodule, `${ws_dir}/.git` is a text file containing `gitdir: <path>`. Therefore, `-f "${ws_dir}/.git/index"` is false. The script assumes an empty index, causing `working_tree=""`, which causes `git commit-tree ""` to fail. Fixing this requires resolving the index path via `git -C "$ws_dir" rev-parse --git-path index`.
2. **Object Reachability Root Cause (Observation 2)**: `shadow_commit` links only to `working_tree` and `head_commit`. Because `staged_tree` is never linked to any commit or ref, Git treats it as an unreferenced loose object. Any operation using standard Git object transfer (`git clone --no-local`, `git fetch`, or cloud object storage mirrors) will drop `staged_tree`. Fixing this requires recording staged state in a dedicated ref (`refs/frostfire/shadow/<agent_id>/staged`) or as a multi-parent commit.
3. **Checkout Pruning Root Cause (Observations 3 & 4)**: `git checkout-index -a -f` writes entries present in the index to the filesystem. It has no mechanism to prune deleted files that existed in the prior checkout. Deletions and renames thus leave zombie files on disk. Fixing this requires removing tracked files present in the pre-restore/staged tree that are missing from `$working_tree` prior to checkout.
4. **Transaction Ordering Root Cause (Observation 5)**: In any restore operation involving multiple artifacts (Git trees + tarball archives), integrity checks must be fail-fast preconditions. Mutating the Git working tree before verifying the tarball checksum violates atomicity.

---

## 3. Caveats

- The defects were observed on standard Git 2.43+ under Linux (WSL2 kernel 6.18.33).
- Container recycling where the `.git` directory is shared directly on the same volume (as tested in `scripts/test-container-recycling.sh`) masks Defect 2 because unreferenced loose objects remain locally accessible until `git gc` runs. However, in distributed or multi-host microVM recycling with git fetch/push, Defect 2 is fatal.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

While `scripts/sync-workspace-state.sh` successfully satisfies locking, branch invariance, and happy-path dirty file snapshotting, it contains 5 empirical defects under adversarial stress that must be addressed:
1. **CRITICAL**: Git worktrees crash during snapshot (`fatal: not a valid object name`).
2. **CRITICAL**: `staged_tree_sha` is a dangling unreferenced object, failing on remote fetch or after `git gc`.
3. **HIGH**: Deleted files resurrect on restore (unstaged deletions revert; staged deletions become untracked zombies).
4. **HIGH**: Renamed files leave zombie original copies on disk.
5. **MEDIUM**: Restore mutates the workspace before validating archive SHA-256 checksums.

---

## 5. Verification Method

To independently reproduce and verify all findings:

1. **Run the Automated Adversarial Stress Suite**:
   ```bash
   bash tests/adversarial/test_sync_workspace_adversarial.sh
   ```
   *Observed Result*:
   ```
   Adversarial Stress Suite Summary: 17 tests executed | 12 passed | 5 defects surfaced
   ```

2. **Verify Rust Workspace Quality Gates**:
   ```powershell
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
   *Observed Result*: All unit and integration tests pass with 0 warnings.
