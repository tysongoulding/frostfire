# Technical Report: Defect 5 Remediation & 17-Test Regression Verification Plan

**Agent**: `explorer_m6_fix_3`  
**Role**: Teamwork Explorer (Read-Only Investigation & Analysis)  
**Milestone**: M6 — Ephemeral Lambda MicroVM State Persistence & Worktrees  
**Date**: 2026-09-08  
**Target Files**:
- `scripts/sync-workspace-state.sh`
- `tests/adversarial/test_sync_workspace_adversarial.sh`

---

## 1. Executive Summary

During empirical stress testing of `scripts/sync-workspace-state.sh` conducted by `challenger_m6_1` using the adversarial test suite `tests/adversarial/test_sync_workspace_adversarial.sh`, 5 defects were uncovered across 17 executed tests (12 passed, 5 surfaced defects).

This report delivers:
1. **In-depth Root Cause Analysis & Remediation Specification for Defect 5** (*Premature Working Tree Mutation on Corrupt Archive in `do_restore`*).
2. **The 17-Test Regression Verification Matrix** detailing each adversarial stress scenario, baseline behavior, defect mapping, and verification criteria required to achieve a clean **17/17 (100%) pass rate**.
3. **Cross-Fix Integration Protocol** harmonizing Defect 5 validation ordering with Explorer Fix 1 (worktree index resolution & staged ref reachability) and Explorer Fix 2 (deleted and renamed file pruning).

---

## 2. Defect 5 Analysis: Premature Working Tree Mutation

### 2.1 Problem Formulation & Mechanism

In `scripts/sync-workspace-state.sh` (`do_restore`, lines 378–418), the restoration logic performs mutations to the Git index and working tree files *before* validating the integrity of the untracked files archive (`.untracked.tar.gz`):

```bash
# Existing do_restore implementation (lines 378-418):
# 2. Restore working tree files non-disruptively
if [ -n "$working_tree" ]; then
    vlog "Restoring working tree from tree SHA ${working_tree}"
    git -C "$ws_dir" read-tree "$working_tree"
    git -C "$ws_dir" checkout-index -a -f                  # <-- MUTATION OCCURS HERE
fi

# 3. Restore the staged index
if [ -n "$staged_tree" ]; then
    vlog "Restoring staged index from tree SHA ${staged_tree}"
    git -C "$ws_dir" read-tree "$staged_tree"              # <-- INDEX MUTATION HERE
elif [ -n "$head_commit" ]; then
    git -C "$ws_dir" read-tree "$head_commit"
fi

# 4. Unpack untracked files archive after validating checksum
...
if [ -n "$untracked_archive" ] && [ -f "$untracked_archive" ]; then
    local actual_sha256
    actual_sha256="$(sha256sum "$untracked_archive" | cut -d' ' -f1)"
    if [ -n "$untracked_sha256" ] && [ "$actual_sha256" != "$untracked_sha256" ]; then
        error "Checksum mismatch on untracked archive: expected ${untracked_sha256}, got ${actual_sha256}"
        release_lock
        return 5                                          # <-- ABORT WITH ERROR 5
    fi
    tar -C "$ws_dir" -xzf "$untracked_archive" 2>/dev/null
fi
```

### 2.2 Empirical Failure Trace (Test 12)

In `tests/adversarial/test_sync_workspace_adversarial.sh` (Test 12, lines 381–412):
1. A clean workspace at commit `v1` (`file.txt` = "clean v1") is modified to "mutated v2", with an untracked file `untracked.txt`.
2. A snapshot is executed (`snapshot premut_agent`).
3. The untracked tarball is deliberately corrupted: `echo "CORRUPT" >> "$PREMUT_TAR"`.
4. The workspace is reset to clean `v1`: `git checkout -f HEAD -q`.
5. `restore premut_agent` is executed.
6. **Failure Mode**: `git checkout-index -a -f` overwrites `file.txt` with "mutated v2". Subsequently, `sha256sum "$untracked_archive"` detects corruption and returns exit code `5`.
7. When the test inspects `cat file.txt`, it observes "mutated v2" instead of the original "clean v1".
8. **Result**:
   ```
   [DEFECT] Defect: Working directory mutated BEFORE archive checksum validation on corrupted restore
   ```

### 2.3 Violation of Architectural Invariants

1. **Atomicity (All-or-Nothing)**: A restore operation that fails on corrupt input must leave the target workspace bit-for-bit unchanged. Overwriting working tree files prior to validating all artifacts breaks transaction atomicity and leaves the workspace in a tainted, inconsistent state.
2. **Fail-Fast Preconditions**: All cryptographic checksums, schema constraints, and object database reachability checks must execute during a read-only validation phase before any filesystem or index mutation begins.

---

## 3. Remediation Specification for Defect 5

### 3.1 Two-Phase Transaction Architecture

`do_restore` must be restructured into two distinct phases:

#### Phase 1: Read-Only Validation & Integrity Preconditions (Fail-Fast)
Execute all validations with zero mutations:
1. **Manifest Integrity & Schema Validation**:
   - Verify `manifest.json` exists (`return 2` if missing).
   - Validate JSON well-formedness and schema version (`version == 1`).
   - Validate `agent_id` match to prevent cross-agent manifest hijacking.
2. **Git Repository Verification**:
   - Verify target `$ws_dir` is an initialized Git repository (`is_git_repo "$ws_dir"`, `return 3` if false).
3. **Git Object Database Reachability**:
   - Verify `shadow_commit` exists via `git cat-file -e "$shadow_commit"` (`return 4` if missing).
   - Verify `working_tree` exists via `git cat-file -e "$working_tree"` (`return 4` if missing).
   - Verify `staged_tree` exists via `git cat-file -e "$staged_tree"` (`return 4` if missing).
4. **Untracked Archive Verification (Git Mode)**:
   - Resolve `untracked_archive` path.
   - If `untracked_archive` exists:
     - Verify SHA-256 against manifest `untracked_sha256` (`return 5` on mismatch).
     - Verify gzip/tar stream integrity via `tar -tzf "$untracked_archive" >/dev/null 2>&1` (`return 5` on corrupt stream).
   - If manifest indicates untracked files (`untracked_file` not empty) but file is missing on disk: fail fast with `return 5`.
5. **Non-Git Archive Verification (Non-Git Mode)**:
   - Verify `archive_file` exists (`return 6` if missing).
   - Verify SHA-256 against manifest `archive_sha256` (`return 5` on mismatch).
   - Verify `tar -tzf "$non_git_archive" >/dev/null 2>&1` (`return 5` on corrupt stream).

#### Phase 2: State Application & Workspace Mutation (All Checks Passed)
Only reached if Phase 1 finishes with 0 errors:
1. In Git Mode:
   - Apply file pruning for deleted/renamed files (Defect 3 & Defect 4 resolution).
   - Checkout working tree files: `git -C "$ws_dir" read-tree "$working_tree"` and `git -C "$ws_dir" checkout-index -a -f`.
   - Restore staged index: `git -C "$ws_dir" read-tree "$staged_tree"`.
   - Extract untracked files: `tar -C "$ws_dir" -xzf "$untracked_archive" 2>/dev/null`.
2. In Non-Git Mode:
   - Extract workspace archive: `tar -C "$ws_dir" -xzf "$non_git_archive" 2>/dev/null`.
3. Restore developer CLI credentials (`persist-cli-auth restore`).

### 3.2 Code Diff for `scripts/sync-workspace-state.sh`

```diff
--- scripts/sync-workspace-state.sh
+++ scripts/sync-workspace-state.sh
@@ -367,31 +367,52 @@
             return 3
         fi
 
-        # 1. Verify that shadow commit exists in Git object database
+        # ----------------------------------------------------------------------
+        # PHASE 1: PRECONDITIONS & INTEGRITY CHECKS (FAIL-FAST, ZERO MUTATION)
+        # ----------------------------------------------------------------------
+        # 1.1 Verify Git objects exist before touching working tree or index
         if [ -n "$shadow_commit" ]; then
             if ! git -C "$ws_dir" cat-file -e "$shadow_commit" 2>/dev/null; then
                 error "Shadow commit ${shadow_commit} not found in Git object database"
                 release_lock
                 if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
                 return 4
             fi
         fi
 
-        # 2. Restore working tree files non-disruptively (HEAD and branch remain unchanged)
+        if [ -n "$working_tree" ]; then
+            if ! git -C "$ws_dir" cat-file -e "$working_tree" 2>/dev/null; then
+                error "Working tree ${working_tree} not found in Git object database"
+                release_lock
+                if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
+                return 4
+            fi
+        fi
+
+        if [ -n "$staged_tree" ]; then
+            if ! git -C "$ws_dir" cat-file -e "$staged_tree" 2>/dev/null; then
+                error "Staged tree ${staged_tree} not found in Git object database"
+                release_lock
+                if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
+                return 4
+            fi
+        fi
+
+        # 1.2 Locate and validate untracked files archive BEFORE any workspace mutation
+        local untracked_archive=""
+        if [ -n "$untracked_file" ] && [ -f "${state_dir}/${untracked_file}" ]; then
+            untracked_archive="${state_dir}/${untracked_file}"
+        elif [ -f "${state_dir}/.untracked.tar.gz" ]; then
+            untracked_archive="${state_dir}/.untracked.tar.gz"
+        elif [ -f "${state_dir}/untracked.latest.tar.gz" ]; then
+            untracked_archive="${state_dir}/untracked.latest.tar.gz"
+        elif [ -f "${state_dir}/untracked.tar.gz" ]; then
+            untracked_archive="${state_dir}/untracked.tar.gz"
+        fi
+
+        if [ -n "$untracked_archive" ] && [ -f "$untracked_archive" ]; then
+            local actual_sha256
+            actual_sha256="$(sha256sum "$untracked_archive" | cut -d' ' -f1)"
+            if [ -n "$untracked_sha256" ] && [ "$actual_sha256" != "$untracked_sha256" ]; then
+                error "Checksum mismatch on untracked archive: expected ${untracked_sha256}, got ${actual_sha256}"
+                release_lock
+                if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
+                return 5
+            fi
+            if ! tar -tzf "$untracked_archive" >/dev/null 2>&1; then
+                error "Untracked archive stream is corrupted: ${untracked_archive}"
+                release_lock
+                if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
+                return 5
+            fi
+        elif [ -n "$untracked_file" ]; then
+            error "Untracked archive specified in manifest but missing on disk: ${state_dir}/${untracked_file}"
+            release_lock
+            if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
+            return 5
+        fi
+
+        # ----------------------------------------------------------------------
+        # PHASE 2: MUTATION & RESTORATION (ALL PRECONDITIONS PASSED)
+        # ----------------------------------------------------------------------
+        # 2.1 Restore working tree files non-disruptively (HEAD and branch remain unchanged)
         if [ -n "$working_tree" ]; then
             vlog "Restoring working tree from tree SHA ${working_tree}"
             git -C "$ws_dir" read-tree "$working_tree"
             git -C "$ws_dir" checkout-index -a -f
         fi
 
-        # 3. Restore the staged index so the user's staged changes are faithfully recreated
+        # 2.2 Restore the staged index so the user's staged changes are faithfully recreated
         if [ -n "$staged_tree" ]; then
             vlog "Restoring staged index from tree SHA ${staged_tree}"
             git -C "$ws_dir" read-tree "$staged_tree"
         elif [ -n "$head_commit" ]; then
             # If nothing was staged relative to HEAD, reset index to HEAD tree
             git -C "$ws_dir" read-tree "$head_commit"
         fi
 
-        # 4. Unpack untracked files archive after validating checksum
-        local untracked_archive=""
-        if [ -n "$untracked_file" ] && [ -f "${state_dir}/${untracked_file}" ]; then
-            untracked_archive="${state_dir}/${untracked_file}"
-        elif [ -f "${state_dir}/.untracked.tar.gz" ]; then
-            untracked_archive="${state_dir}/.untracked.tar.gz"
-        elif [ -f "${state_dir}/untracked.latest.tar.gz" ]; then
-            untracked_archive="${state_dir}/untracked.latest.tar.gz"
-        elif [ -f "${state_dir}/untracked.tar.gz" ]; then
-            untracked_archive="${state_dir}/untracked.tar.gz"
-        fi
-
-        if [ -n "$untracked_archive" ] && [ -f "$untracked_archive" ]; then
-            local actual_sha256
-            actual_sha256="$(sha256sum "$untracked_archive" | cut -d' ' -f1)"
-            if [ -n "$untracked_sha256" ] && [ "$actual_sha256" != "$untracked_sha256" ]; then
-                error "Checksum mismatch on untracked archive: expected ${untracked_sha256}, got ${actual_sha256}"
-                release_lock
-                if [ -n "$prev_exit_trap" ]; then eval "$prev_exit_trap"; else trap - EXIT; fi
-                return 5
-            fi
+        # 2.3 Unpack untracked files archive (already validated in Phase 1)
+        if [ -n "$untracked_archive" ] && [ -f "$untracked_archive" ]; then
             vlog "Extracting untracked files from ${untracked_archive}"
             tar -C "$ws_dir" -xzf "$untracked_archive" 2>/dev/null
         fi
```

### 3.3 Empirical Sandbox Validation

When evaluated against the adversarial suite in a sandbox environment:
- `Test 12` shifted from:
  ```
  [DEFECT] Defect: Working directory mutated BEFORE archive checksum validation on corrupted restore
  ```
  to:
  ```
  [PASS] Working directory atomic: not mutated on corrupt archive restore
  ```
- No regressions occurred in any of the existing passing tests.

---

## 4. Complete 17-Test Regression Verification Matrix

The test suite `tests/adversarial/test_sync_workspace_adversarial.sh` comprises 17 rigorous stress scenarios partitioned into 4 functional sections:

| # | Section | Test Name & Intent | Baseline Status | Root Cause / Defect ID | Target Remediator | Target 17/17 Status |
|---|---------|---------------------|-----------------|------------------------|-------------------|---------------------|
| **1** | 1. Dirty Extremes | Preserve staged, unstaged, deep nesting, binary, empty, spaces/symbols, symlinks | **PASS** | N/A | None (Preserve) | **PASS** |
| **2** | 1. Dirty Extremes | Preserve file, directory, and spaced symlinks | **PASS** | N/A | None (Preserve) | **PASS** |
| **3** | 1. Dirty Extremes | Unlink deleted files on restore | **DEFECT** | `checkout-index` does not unlink missing files (Defect 3) | Explorer M6 Fix 2 | **PASS** |
| **4** | 1. Dirty Extremes | Cleanly rename files without leaving zombie duplicates | **DEFECT** | `checkout-index` writes new path but leaves old path (Defect 4) | Explorer M6 Fix 2 | **PASS** |
| **5** | 1. Dirty Extremes | Snapshot linked Git worktrees (`.git` is file) | **DEFECT** | Index path assumed at `.git/index` (Defect 1) | Explorer M6 Fix 1 | **PASS** |
| **6** | 1. Dirty Extremes | Staged tree reachability across `git fetch` | **DEFECT** | `staged_tree_sha` is dangling unreferenced object (Defect 2) | Explorer M6 Fix 1 | **PASS** |
| **7** | 2. Concurrency | Lock contention aborted with exit code 75 (`EX_TEMPFAIL`) | **PASS** | N/A | None (Preserve) | **PASS** |
| **8** | 2. Concurrency | 5 concurrent snapshot invocations serialized cleanly | **PASS** | N/A | None (Preserve) | **PASS** |
| **9** | 2. Concurrency | Multi-tenant isolation: distinct agents snapshot concurrently | **PASS** | N/A | None (Preserve) | **PASS** |
| **10** | 3. Corruption | Restore halted with exit code 5 on corrupt untracked archive | **PASS** | N/A | None (Preserve) | **PASS** |
| **11** | 3. Corruption | Corrupt archive payload blocked from unpacking | **PASS** | N/A | None (Preserve) | **PASS** |
| **12** | 3. Corruption | Working directory not mutated before archive validation | **DEFECT** | Mutation preceded checksum validation (Defect 5) | **Explorer M6 Fix 3** | **PASS** |
| **13** | 3. Corruption | Tampered manifest SHA-256 detected with exit code 5 | **PASS** | N/A | None (Preserve) | **PASS** |
| **14** | 4. Invariance | Active branch preserved across snapshot (named branch, HEAD, log) | **PASS** | N/A | None (Preserve) | **PASS** |
| **15** | 4. Invariance | Active branch preserved across restore (named branch, HEAD, log) | **PASS** | N/A | None (Preserve) | **PASS** |
| **16** | 4. Invariance | Detached HEAD invariance preserved across snapshot | **PASS** | N/A | None (Preserve) | **PASS** |
| **17** | 4. Invariance | Detached HEAD invariance preserved across restore | **PASS** | N/A | None (Preserve) | **PASS** |

---

## 5. Detailed Test Breakdown & Assertion Specifications

### Test 1: Dirty Git State Extremes
- **Intent**: Verifies that unstaged edits, staged edits, binary payloads (`/dev/urandom`), empty files, files in deeply nested directories (`nested/level1/level2/level3/level4/target.txt`), and files with spaces and special characters (`#$@%`) are preserved byte-for-byte.
- **Assertion**: `diff -u pre_dirty_checksums.sha256 post_dirty_checksums.sha256` produces 0 diff.

### Test 2: Symlinks Preservation
- **Intent**: Verifies file symlinks, directory symlinks, and symlinks with special characters/spaces.
- **Assertion**: `[ -L symlink_file ] && [ -L symlink_dir ] && [ -L 'symlink with spaces' ]`.

### Test 3: Deleted Files Handling (Defect 3)
- **Scenario**: A tracked file `del_target.txt` is deleted (`rm del_target.txt`). Snapshot is run. Workspace is cloned to a new location where `del_target.txt` exists, and restore is run.
- **Defect**: The file remained on disk because `git checkout-index` only creates entries present in the index.
- **Target Assertion**: `[ ! -f "${DEL_RESTORE}/del_target.txt" ]`.

### Test 4: Renamed Files Handling (Defect 4)
- **Scenario**: A tracked file `orig.txt` is renamed to `renamed.txt` via `git mv`. Snapshot is run, followed by restore into a clone.
- **Defect**: Both `orig.txt` and `renamed.txt` were present on disk after restore (zombie duplicate).
- **Target Assertion**: `! [ -f "${REN_RESTORE}/orig.txt" ] && [ -f "${REN_RESTORE}/renamed.txt" ]`.

### Test 5: Git Worktree Snapshot Support (Defect 1)
- **Scenario**: A secondary Git worktree is created via `git worktree add ../wt_linked -b linked_branch`. In this worktree, `.git` is a plain text pointer file containing `gitdir: <path>`.
- **Defect**: Line 169 checked `[ -f "${ws_dir}/.git/index" ]` which returned false, causing `git commit-tree ""` to fail with `fatal: not a valid object name`.
- **Target Assertion**: Snapshot exits 0 and records valid `shadow_commit`.

### Test 6: Staged Tree Object Reachability (Defect 2)
- **Scenario**: A staged modification is snapshotted. A remote clone fetches ONLY shadow refs (`refs/frostfire/shadow/*`).
- **Defect**: `staged_tree_sha` was unreferenced by any commit or ref, so standard Git transport dropped the object. Restore failed with `fatal: failed to unpack tree object`.
- **Target Assertion**: `staged_tree` is reachable from a ref (e.g. `refs/frostfire/shadow/<agent_id>/staged`) and unpacks without error.

### Test 7: Lock Contention Timeout
- **Scenario**: An external process holds the file lock (`flock -x 200`) for 2 seconds. A snapshot is invoked with `LOCK_TIMEOUT=1`.
- **Assertion**: Exits with code `75` (`EX_TEMPFAIL`) within 1s and logs `Failed to acquire lock`.

### Test 8: Concurrent Process Queuing
- **Scenario**: 5 background processes simultaneously snapshot modifications to the same workspace with `LOCK_TIMEOUT=15`.
- **Assertion**: All 5 processes serialize cleanly through the lock, exit 0, and leave a valid `manifest.json`.

### Test 9: Multi-Tenant Agent Isolation
- **Scenario**: Agent `agent_a` and Agent `agent_b` run snapshots simultaneously against separate lock files.
- **Assertion**: Neither process blocks the other; both complete without contention.

### Test 10: Untracked Archive Checksum Verification
- **Scenario**: Bytes are appended to `.untracked.tar.gz`. Restore is executed.
- **Assertion**: Exits with code `5` and logs `Checksum mismatch on untracked archive`.

### Test 11: Untracked Archive Payload Blocking
- **Scenario**: Checked after Test 10.
- **Assertion**: No corrupt or payload files from the invalid tarball are written to disk.

### Test 12: Premature Mutation Elimination (Defect 5)
- **Scenario**: Workspace at `v1` is modified to `v2` + untracked file and snapshotted. Untracked tarball is corrupted. Workspace is reset to clean `v1`. Restore is executed.
- **Defect**: `file.txt` was overwritten with `v2` before the archive checksum validation aborted the restore.
- **Target Assertion**: `[ "$(cat file.txt)" != "mutated v2" ]` (remains "clean v1").

### Test 13: Tampered Manifest Detection
- **Scenario**: `manifest.json` `untracked_sha256` is modified to a bogus hash. Restore is run.
- **Assertion**: Exits with code `5` and logs `Checksum mismatch`.

### Test 14 & 15: Active Branch Invariance (Snapshot & Restore)
- **Scenario**: Working branch is `feature-active`. Dirty files are introduced. Snapshot is run, then restore.
- **Assertion**: `git symbolic-ref HEAD`, `git rev-parse HEAD`, and `git log --oneline` are byte-for-byte identical before and after both operations.

### Test 16 & 17: Detached HEAD Invariance (Snapshot & Restore)
- **Scenario**: HEAD is detached at `HEAD~1`. Dirty changes are snapshotted and restored.
- **Assertion**: HEAD remains detached; commit SHA and commit graph are unchanged.

---

## 6. Integration Contract Across Fix 1, Fix 2, and Fix 3

To achieve **17/17 passing tests**, the three explorer remediation streams must be synthesized in `scripts/sync-workspace-state.sh`:

```
┌────────────────────────────────────────────────────────────────────────┐
│              scripts/sync-workspace-state.sh Pipeline                  │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
      [Subcommand: snapshot]          [Subcommand: restore]
                 │                               │
    ┌────────────┴────────────┐                  ▼
    │ FIX 1: Worktree & Refs  │       ┌──────────────────────┐
    │ - rev-parse --git-path  │       │ FIX 3: PHASE 1       │
    │ - Staged companion ref  │       │ - Read-only check    │
    └─────────────────────────┘       │ - Verify Git objects │
                                      │ - Verify Tarball SHA │
                                      │ - Fail-fast exit 4/5 │
                                      └──────────┬───────────┘
                                                 │ (All checks PASS)
                                                 ▼
                                      ┌──────────────────────┐
                                      │ FIX 2: PHASE 2A      │
                                      │ - Prune deleted files│
                                      │ - Prune renamed orig │
                                      └──────────┬───────────┘
                                                 │
                                                 ▼
                                      ┌──────────────────────┐
                                      │ FIX 3: PHASE 2B      │
                                      │ - checkout-index -a  │
                                      │ - read-tree staged   │
                                      │ - tar -xzf untracked │
                                      └──────────────────────┘
```

1. **Fix 1 (`explorer_m6_fix_1`)**:
   - `snapshot`: Resolves index path via `git rev-parse --git-path index` (resolves Defect 1).
   - `snapshot`: Updates `refs/frostfire/shadow/${agent_id}/staged` with companion commit or tree ref (resolves Defect 2).
2. **Fix 2 (`explorer_m6_fix_2`)**:
   - `restore`: Pre-checkout pruning compares `working_tree` against pre-restore tracked files and unlinks files absent in `working_tree` (resolves Defect 3 & Defect 4).
3. **Fix 3 (`explorer_m6_fix_3` - This Report)**:
   - `restore`: Strict ordering enforces Phase 1 validation (manifest, objects, tarball SHA-256) *before* Phase 2 (pruning, checkout, extraction) (resolves Defect 5).
   - Provides regression test harness and coordinates 17/17 verification.

---

## 7. Verification Commands & Acceptance Protocol

### 7.1 Adversarial Verification
```bash
bash tests/adversarial/test_sync_workspace_adversarial.sh
```
**Expected Output upon full integration**:
```
Adversarial Stress Suite Summary: 17 tests executed | 17 passed | 0 defects surfaced
```

### 7.2 Rust Workspace Quality Gates
```powershell
cargo test --workspace
cargo clippy --workspace -- -D warnings
```
**Acceptance Criteria**:
- 0 test failures across all workspace crates (`frostfire-common`, `frostfire-display`, `frostfire-firecracker`, `frostfire-gateway`, `frostfire-orchestrator`, `frostfire-proto`, `frostfire-telemetry`, `frostfire-tunnel`, `tests/e2e`).
- 0 warnings in Clippy.
