# Handoff Report: Explorer M6.2 — Shadow Worktree Snapshot & Restore Automation

**Agent:** `explorer_m6_2`  
**Milestone:** M6 (Ephemeral Lambda MicroVM State Persistence — Feature F22)  
**Deliverables Produced:**
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_2\report.md` (Specification & Architecture)
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_2\proposed_sync-workspace-state.sh` (Complete Tested Implementation)
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_2\handoff.md` (Handoff Report)

---

## 1. Observation

1. **EFS & Lambda Runtime Environment**:
   - `cloud/agent/Dockerfile.lambda` lines 47–55 establishes runtime packages:
     ```dockerfile
     RUN apt-get update && apt-get install -y --no-install-recommends \
         ca-certificates libssl3 git curl ripgrep procps
     ```
   - `cloud/agent/Dockerfile.lambda` lines 69–71 sets unprivileged user:
     ```dockerfile
     RUN groupadd -g 10001 frostfire && \
         useradd -u 10001 -g frostfire -m -d /tmp/frostfire -s /bin/bash frostfire
     ```
   - `deploy/aws/lambda-microvm.yaml` mounts `/mnt/workspace` via EFS Access Point matching UID/GID 10001. Root filesystem (`/`) is read-only; `/tmp` is ephemeral writable scratchpad; `/mnt/workspace` is persistent NFS.
2. **Worktree Architecture in `frostfire-exec`**:
   - `crates/frostfire-exec/src/worktree.rs` lines 301–317 implements agent ID validation:
     ```rust
     fn validate_agent_id(agent_id: &str) -> Result<(), WorktreeError> {
         let trimmed = agent_id.trim();
         if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
             return Err(WorktreeError::InvalidAgentId(agent_id.to_string()));
         }
         let is_valid_char = |c: char| c.is_alphanumeric() || c == '-' || c == '_' || c == '.';
         ...
     ```
3. **Survey 2.2 Directives**:
   - `.agents/spec_miner_survey_2_2/report.md` §4.2 lines 288–324 specifies Git plumbing commands:
     ```bash
     TREE_SHA=$(git write-tree)
     SHADOW_COMMIT=$(git commit-tree "$TREE_SHA" -p "$PARENT_COMMIT" -m "$COMMIT_MSG")
     git update-ref "refs/frostfire/shadow/${AGENT_ID}" "$SHADOW_COMMIT"
     git ls-files --others --exclude-standard -z | tar -czf "${EFS_DIR}/untracked_${SHADOW_COMMIT}.tar.gz" --null -T -
     ```
4. **Behavior Observed During Live Sandbox Execution**:
   - In live testing with isolated temporary Git indexes (`GIT_INDEX_FILE`), running `snapshot` on a repository with staged (`file1.txt`), unstaged (`file1.txt`, `file2.txt`), and untracked files (`.env.local`) captured:
     - `staged_tree_sha`: `304b50188724562d71c8645bd6d335c0da6f4470`
     - `working_tree_sha`: `77ea92740c4adac4c9d1860c5ad4ad2d67931acc`
     - `shadow_commit`: `097562f16e19370e6ecba390bbae5512ee561886`
     - Untracked archive: `untracked_097562f1...tar.gz` (SHA-256: `497b2326...`)
   - The user's active branch (`main`) and `HEAD` commit remained completely untouched.
   - Following complete working directory wiping (`git reset --hard HEAD && git clean -fd`), running `restore` rehydrated the exact staged files in the index and unstaged edits in the working tree, and unpacked `.env.local` with identical byte content.
   - Signal test verified `watch` daemon intercepted `SIGTERM`, emitted `[sync-workspace-state] watch: caught termination signal (SIGTERM/SIGINT) — flushing final dirty snapshot...`, executed a synchronous snapshot, and exited cleanly with return code 0.

---

## 2. Logic Chain

1. **Premise 1 (Disruption Avoidance)**: Developers and agents cannot tolerate tools modifying `HEAD` or switching branches unexpectedly. Running high-level commands like `git checkout` or `git commit` moves the current branch pointer.
2. **Inference 1**: Capturing state must rely strictly on low-level Git plumbing (`git write-tree`, `git commit-tree`, `git update-ref`) targeted at custom namespaces (`refs/frostfire/shadow/<agent_id>`).
3. **Premise 2 (Preservation of Staging Area)**: A developer or agent may have selectively staged files (`git add foo.rs`) while leaving `bar.rs` unstaged. Standard `git add -A` destroys this distinction.
4. **Inference 2**: The snapshot mechanism must copy `.git/index` into a temporary index file (`GIT_INDEX_FILE="$tmp_index"`), capture `STAGED_TREE_SHA`, then stage unstaged changes into the temporary index to capture `WORKING_TREE_SHA`. On restore, reading `WORKING_TREE_SHA` into the tree and `STAGED_TREE_SHA` into the index restores both the dirty files and the exact staged index.
5. **Premise 3 (Concurrency & EFS Latency)**: Multiple containers or concurrent background watchers accessing the same `/mnt/workspace` will corrupt manifests without mutual exclusion.
6. **Inference 3**: Exclusive advisory locking via Linux kernel `flock` on `/mnt/workspace/.frostfire/locks/<agent_id>.lock` guarantees serial execution. Because `flock` is tied to file descriptors, dead processes automatically release locks upon termination.
7. **Premise 4 (Lambda Shutdown Dynamics)**: AWS Lambda sends `SIGTERM` before container recycling.
8. **Inference 4**: Trapping `SIGTERM` and `SIGINT` inside `watch` guarantees a final synchronous snapshot is executed and flushed to EFS before the container process is destroyed.

---

## 3. Caveats

1. **EFS Performance & NFS Attributes**: In high-latency EFS environments, frequent `tar` operations on very large directories (> 100k untracked files or gigabytes of node_modules) could cause latency. The script filters untracked files through `.gitignore` (`--exclude-standard`) and explicitly prunes `.frostfire/` to minimize archive sizes.
2. **POSIX File Permissions in Containers**: The Lambda runtime user is `frostfire` (UID 10001, GID 10001). EFS Access Points must be configured with POSIX user `10001:10001` so that file creation under `/mnt/workspace/.frostfire` does not encounter `EACCES`.
3. **Read-Only Root Filesystem**: In AWS Lambda, `/tmp` must be used for temporary index files and temporary archive lists since `/` is read-only. The script uses `${TMPDIR:-/tmp}` for all temporary files.

---

## 4. Conclusion

The specification and reference implementation for `scripts/sync-workspace-state.sh` are complete, robust, and verified.
- The implementer agent can copy `.agents/explorer_m6_2/proposed_sync-workspace-state.sh` directly into `scripts/sync-workspace-state.sh` and make it executable (`chmod +x scripts/sync-workspace-state.sh`).
- All five required subcommands (`snapshot`, `restore`, `watch`, `list`, `clean`) satisfy the functional requirements and architectural invariants of Feature F22 and Milestone M6.

---

## 5. Verification Method

To independently verify the script after placement into `scripts/sync-workspace-state.sh`:

```bash
# 1. Ensure executable permissions
chmod +x scripts/sync-workspace-state.sh

# 2. Run unit syntax check
bash -n scripts/sync-workspace-state.sh

# 3. Test subcommands on a test repository
mkdir -p /tmp/test_repo && cd /tmp/test_repo
git init -b main
git config user.name "Tester"
git config user.email "test@frostfire.dev"
echo "base line" > file.txt && git add file.txt && git commit -m "init"

# Introduce dirty state
echo "staged line" >> file.txt && git add file.txt
echo "unstaged line" >> file.txt
echo "secret" > secret.env

# Snapshot
FROSTFIRE_PERSIST_ROOT="/tmp/test_persist" scripts/sync-workspace-state.sh snapshot "test-agent" /tmp/test_repo

# Wipe working tree
git reset --hard HEAD && git clean -fd

# Restore
FROSTFIRE_PERSIST_ROOT="/tmp/test_persist" scripts/sync-workspace-state.sh restore "test-agent" /tmp/test_repo

# Confirm restoration
git status --short
# Expected output:
# MM file.txt
# ?? secret.env

# List
FROSTFIRE_PERSIST_ROOT="/tmp/test_persist" scripts/sync-workspace-state.sh list
FROSTFIRE_PERSIST_ROOT="/tmp/test_persist" scripts/sync-workspace-state.sh list --json

# Clean
FROSTFIRE_PERSIST_ROOT="/tmp/test_persist" scripts/sync-workspace-state.sh clean "test-agent" /tmp/test_repo
```
