# Comprehensive Specification: Shadow Worktree State Sync & Snapshot Automation (`scripts/sync-workspace-state.sh`)

**Author:** `explorer_m6_2`  
**Target Milestone:** M6 (Ephemeral Lambda MicroVM State Persistence — Feature F22)  
**Target File:** `scripts/sync-workspace-state.sh`  
**Proposed Implementation Artifact:** `.agents/explorer_m6_2/proposed_sync-workspace-state.sh`  
**Date:** 2026-09-08  

---

## 1. Executive Summary

In the Frostfire Cloud architecture, autonomous agents run inside ephemeral AWS Lambda Firecracker microVMs (`cloud/agent/Dockerfile.lambda`, `deploy/aws/lambda-microvm.yaml`). Because AWS Lambda instances are ephemeral and can be recycled, frozen, or scaled down after an invocation or at the 900-second timeout boundary, workspace state must persist across container lifecycles without data loss.

Amazon Elastic File System (EFS) is mounted to the Lambda runtime at `/mnt/workspace` (POSIX UID/GID 10001). However, simply mounting a network disk is insufficient:
1. **Concurrent Operations**: Agents and background tasks execute simultaneous builds, git commands, and edits. Uncoordinated file overwrites cause corruption.
2. **In-Flight Working Trees**: An agent may have uncommitted staged changes, unstaged dirty modifications, and untracked files. Running standard high-level git commands like `git checkout` or `git reset` would destroy the developer's working context, wipe the staging index, or switch branches unpredictably.
3. **Abrupt Container Recycling**: AWS Lambda issues a `SIGTERM` signal when nearing timeout or during container retirement, granting a brief grace period (500–2000 ms) before issuing an uncatchable `SIGKILL`.

`scripts/sync-workspace-state.sh` solves these challenges by combining low-level Git plumbing (`git write-tree`, `git commit-tree`, `git update-ref`, temporary isolated index files), atomic tarball archiving, kernel-enforced distributed file locking (`flock`), debounced continuous watching, and signal-trapped flushing.

---

## 2. Architecture & Directory Layout

### 2.1 Storage Layout on Amazon EFS (`/mnt/workspace`)

```
/mnt/workspace/
├── .frostfire/
│   ├── locks/
│   │   ├── <agent_id>.lock                   # Distributed advisory lock for flock (FD 200)
│   │   └── default.lock
│   ├── state/
│   │   └── <agent_id>/
│   │       ├── manifest.json                 # Current canonical atomic state manifest
│   │       ├── manifest_<commit_or_ts>.json  # Historical snapshot manifests
│   │       ├── untracked_<commit>.tar.gz     # Gzip-compressed untracked files
│   │       ├── untracked.latest.tar.gz       # Symlink to latest untracked archive
│   │       ├── workspace_<timestamp>.tar.gz  # Fallback archive for non-git workspaces
│   │       └── workspace.latest.tar.gz       # Symlink to latest non-git archive
│   └── worktrees/                            # Ephemeral git worktree directories
│       └── <agent_id>/
├── .cli-config/                              # Mirrored developer credentials (persist-cli-auth)
└── <workspace_repo_or_project>/              # Live working directory
    ├── .git/
    │   └── refs/
    │       └── frostfire/
    │           └── shadow/
    │               └── <agent_id>            # Shadow commit pointer (independent of HEAD)
    └── ...
```

### 2.2 Security & Path Traversal Guardrails
Agent IDs are validated against strict regex: `^[a-zA-Z0-9._-]+$`. Any attempt to pass path traversal (`..`), forward slashes, backslashes, or shell metacharacters (`;&|`) is rejected immediately with an exit code of 1, preventing directory escapes outside `/mnt/workspace/.frostfire/`.

---

## 3. Subcommand Specifications

### 3.1 `snapshot <agent_id> [workspace_dir]`

Captures the full state of tracked files (staged and unstaged) into a shadow Git commit and untracked files into an archive without disrupting the user's working copy, staging index, or checked-out branch.

#### 3.1.1 Git Plumbing Sequence
1. **Acquire Distributed Lock**:
   Acquires exclusive lock `flock -x -w 10 200` on `/mnt/workspace/.frostfire/locks/<agent_id>.lock`.
2. **Discover Repository State**:
   - `BRANCH=$(git symbolic-ref --short -q HEAD || echo "DETACHED")`
   - `HEAD_COMMIT=$(git rev-parse -q --verify HEAD || echo "")`
3. **Index Isolation (The Zero-Disruption Invariant)**:
   Modifying the user's `.git/index` would erase the boundary between what the user has staged (`git add`) and what is unstaged. To prevent this:
   - A temporary index file is allocated in `/tmp`: `TEMP_INDEX=$(mktemp /tmp/ff_idx_<agent_id>.XXXXXX)`
   - The user's `.git/index` is copied to `$TEMP_INDEX`.
   - **Capture Staged Tree**:
     `STAGED_TREE_SHA=$(GIT_INDEX_FILE="$TEMP_INDEX" git write-tree)`
   - **Capture Full Working Tree**:
     Update the temporary index with all unstaged tracked modifications:
     `GIT_INDEX_FILE="$TEMP_INDEX" git add -u`
     `WORKING_TREE_SHA=$(GIT_INDEX_FILE="$TEMP_INDEX" git write-tree)`
   - Temporary index file is removed.
4. **Determine Dirty Status**:
   If `HEAD_COMMIT` exists, compare `WORKING_TREE_SHA` against `HEAD_COMMIT^{tree}`. If different, `is_dirty=true`.
5. **Create Shadow Commit Object**:
   A new commit object is created directly in the Git object database pointing to `WORKING_TREE_SHA`:
   ```bash
   COMMIT_MSG="frostfire-shadow: auto-snapshot [${agent_id}] ${timestamp_utc}"
   if [ -n "$HEAD_COMMIT" ]; then
       SHADOW_COMMIT=$(git commit-tree "$WORKING_TREE_SHA" -p "$HEAD_COMMIT" -m "$COMMIT_MSG")
   else
       SHADOW_COMMIT=$(git commit-tree "$WORKING_TREE_SHA" -m "$COMMIT_MSG")
   fi
   ```
6. **Update Shadow Ref**:
   Points `refs/frostfire/shadow/<agent_id>` to `$SHADOW_COMMIT`:
   ```bash
   git update-ref "refs/frostfire/shadow/${agent_id}" "$SHADOW_COMMIT"
   ```
   *Crucial Property*: `HEAD` is never moved. The active branch pointer (e.g. `main`, `feature/x`) remains 100% untouched.
7. **Untracked Artifacts Archiving**:
   - Untracked files (excluding `.gitignore` patterns and `.frostfire/`) are collected using null-delimiters:
     `git ls-files --others --exclude-standard -z | grep -zv "^\.frostfire"`
   - Packed into `${STATE_DIR}/untracked_${SHADOW_COMMIT}.tar.gz`.
   - SHA-256 checksum calculated and stored.
8. **Credential Mirroring**:
   If `persist-cli-auth` exists, executes `persist-cli-auth save` to sync dotfiles (`.gitconfig`, `.ssh`, `.aws`, `.config/gh`) to `/mnt/workspace/.cli-config`.
9. **Atomic Manifest Commit**:
   Writes `manifest.json.tmp.$$` and performs an atomic rename `mv -f` to `manifest.json`.

---

### 3.2 `restore <agent_id> [workspace_dir]`

Rehydrates the working directory, staged index, and untracked artifacts from a snapshot manifest.

#### 3.2.1 Restoration Sequence
1. **Acquire Distributed Lock**: Exclusive lock on `/mnt/workspace/.frostfire/locks/<agent_id>.lock`.
2. **Read & Verify Manifest**:
   - Parses `manifest.json`.
   - Validates existence of `shadow_commit` in Git object database: `git cat-file -e "$shadow_commit"`.
3. **Restore Tracked Working Copy**:
   Restores all files from `WORKING_TREE_SHA` into the working tree without moving `HEAD`:
   ```bash
   git read-tree "$WORKING_TREE_SHA"
   git checkout-index -a -f
   ```
4. **Restore Staged Index Separation**:
   If `STAGED_TREE_SHA` was captured:
   ```bash
   git read-tree "$STAGED_TREE_SHA"
   ```
   *Result*: `git status` displays the exact staged changes in green ("Changes to be committed") and unstaged modifications in red ("Changes not staged for commit"), perfectly mirroring the state when the snapshot was taken.
5. **Verify & Unpack Untracked Files**:
   - Computes SHA-256 of `untracked_<shadow_commit>.tar.gz`.
   - Confirms checksum matches `untracked_sha256` in manifest. If mismatched, aborts with exit code 5 to prevent corrupted writes.
   - Extracts archive with `tar -C "$workspace_dir" -xzf`.
6. **Restore Developer Credentials**:
   Executes `persist-cli-auth restore`.

---

### 3.3 `watch <agent_id> [workspace_dir] [interval]`

Runs as an asynchronous supervisor daemon monitoring the workspace.

#### 3.3.1 Key Mechanics
1. **Signal Trapping for Container Recycling**:
   ```bash
   trap 'handle_shutdown' SIGTERM SIGINT SIGHUP
   ```
   When AWS Lambda signals container shutdown via `SIGTERM`, `handle_shutdown` intercepts the signal, logs the event, executes a synchronous snapshot under `flock`, and exits with code 0 before AWS issues `SIGKILL`.
2. **Debounced Change Detection**:
   Computes a SHA-256 hash of `git status --porcelain` on each iteration:
   - If the hash matches the previous iteration, no filesystem writes or commit creations occur, eliminating unnecessary disk I/O and object bloat on Amazon EFS.
   - If dirty state changes, a snapshot is executed.
3. **Interruptible Sleep**:
   Uses `sleep "$interval" & wait $!` so that incoming OS signals trigger immediate trap execution rather than blocking on the sleep duration.

---

### 3.4 `list [--json]`

Scans `${PERSIST_ROOT}/.frostfire/state/*/manifest.json` and renders:
- Human-readable aligned table with columns: `AGENT_ID`, `TIMESTAMP (UTC)`, `BRANCH`, `HEAD`, `SHADOW`, `DIRTY`, `UNTRACKED`.
- Machine-readable JSON array when `--json` flag is provided.

---

### 3.5 `clean <agent_id|--all> [workspace_dir]`

Purges state artifacts:
- Deletes `${STATE_BASE}/<agent_id>/`
- Removes lock file `${LOCK_BASE}/<agent_id>.lock`
- Deletes shadow ref: `git update-ref -d refs/frostfire/shadow/<agent_id>`
- Supports `--all` for complete workspace teardown.

---

## 4. State Manifest Schema (`manifest.json`)

```json
{
  "version": 1,
  "agent_id": "agent-alpha",
  "timestamp_utc": "2026-09-08T23:02:53Z",
  "workspace_dir": "/mnt/workspace",
  "is_git": true,
  "branch": "main",
  "head_commit": "ab571eb7b987e1fd669b7f3dd0de5c23825b8d83",
  "shadow_ref": "refs/frostfire/shadow/agent-alpha",
  "shadow_commit": "097562f16e19370e6ecba390bbae5512ee561886",
  "staged_tree_sha": "304b50188724562d71c8645bd6d335c0da6f4470",
  "working_tree_sha": "77ea92740c4adac4c9d1860c5ad4ad2d67931acc",
  "dirty": true,
  "untracked_count": 2,
  "untracked_file": "untracked_097562f16e19370e6ecba390bbae5512ee561886.tar.gz",
  "untracked_sha256": "497b2326352cd6aa648ad12d3ee919335926cfe3c5f1fcfc1568494bfb2ba078",
  "archive_file": "",
  "archive_sha256": "",
  "cli_auth_synced": true
}
```

---

## 5. Edge Case & Failure Mode Resilience Matrix

| Edge Case | Root Cause / Vulnerability | Frostfire Defense in `sync-workspace-state.sh` |
|---|---|---|
| **Unborn Git Branch (Initial Repo)** | `git rev-parse HEAD` returns empty/error; `git commit-tree -p HEAD` crashes | Checks `git rev-parse -q --verify HEAD`; if empty, executes `git commit-tree` without `-p` parent argument. |
| **Detached HEAD State** | `git symbolic-ref HEAD` fails with non-zero exit code | Catches error with `|| echo "DETACHED"`; preserves commit SHA in `head_commit` field. |
| **Staged vs Unstaged Collision** | Standard `git add` overwrites user's staging area | Employs temporary index via `GIT_INDEX_FILE="$tmp_index"`. User's `.git/index` remains untouched during snapshot and is accurately restored via `staged_tree_sha`. |
| **Untracked Filenames with Whitespace / Newlines** | Standard newline-delimited file lists fail in `tar` or `xargs` | Passes null-delimited stream: `git ls-files --others --exclude-standard -z` piped directly to `tar --null -T -`. |
| **Snapshot Recursion (`.frostfire/`)** | Untracked file scanner includes previously generated snapshots, causing exponential disk growth | Explicit filter `grep -zv "^\.frostfire"` ensures state archives never capture themselves. |
| **Concurrent Access / Split-Brain** | Multiple processes or background watchers attempt snapshot at the same instant | Enforces kernel file descriptor locking: `flock -x -w 10 200` on `${LOCK_BASE}/${agent_id}.lock`. Lock is automatically reclaimed on process crash or kill. |
| **Torn Manifest on Sudden Powerloss** | Container death midway through writing `manifest.json` leaves invalid JSON | Writes to `manifest.json.tmp.$$` and commits atomically via POSIX rename `mv -f`. |
| **Premature SIGKILL from Lambda** | Container shuts down before dirty buffer flushes | Traps `SIGTERM` and `SIGINT`, triggers synchronous flush snapshot before process exit. |
| **Non-Git Workspace** | Workspace does not contain a `.git` folder | Automatically falls back to atomic `.tar.gz` directory snapshot with SHA-256 tracking. |

---

## 6. Verification and Test Results

The proposed implementation was thoroughly validated across two test harnesses:
1. **Full Lifecycle Snapshot & Restore Test**:
   - Initialized Git repository.
   - Introduced staged modifications, unstaged modifications, and untracked secret files.
   - Verified that running `snapshot` left the working directory completely untouched (`git status` identical).
   - Verified that `manifest.json` accurately recorded commit SHAs, tree SHAs, and SHA-256 untracked checksums.
   - Simulated complete container loss via `git reset --hard HEAD && git clean -fd`.
   - Executed `restore`. Confirmed that staged files were restored to the index, unstaged modifications were present in the working tree, untracked files were unpacked, and all file contents matched byte-for-byte.
   - Executed `clean` and confirmed state directories and locks were purged.
2. **Watch Daemon & Signal Trap Test**:
   - Launched `watch` daemon in background.
   - Introduced modifications while watch was active; verified automatic snapshot creation.
   - Issued `kill -TERM $PID`; verified log emission: `watch: caught termination signal (SIGTERM/SIGINT) — flushing final dirty snapshot...` followed by successful flush and clean exit.

All verification steps passed with 0 errors and 0 warnings.
