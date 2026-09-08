# Handoff Report: Reviewer M6.2 — Ephemeral Lambda MicroVM State Persistence Review

**Agent**: `reviewer_m6_2`  
**Roles**: Reviewer, Adversarial Critic  
**Milestone**: M6 (Ephemeral Lambda MicroVM State Persistence & Worktrees)  
**Date**: 2026-09-08  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m6_2`  

---

## 1. Observation

Directly observed files, line counts, tool execution outputs, and verification metrics:

1. **Integrity & Anti-Facade Audit**:
   - Inspected `cloud/microvm/bin/persist-cli-auth` (460 lines), `scripts/test-container-recycling.sh` (349 lines), `scripts/sync-workspace-state.sh` (691 lines), and `deploy/aws/lambda-microvm.yaml` (412 lines).
   - Zero hardcoded test outputs or mock hashes were found embedded in the source code or test harness. Checksums are computed dynamically via `sha256sum` on disk across both container lifecycle phases.
   - POSIX permissions are verified using live `stat -c '%a'` queries against actual filesystem inodes.
   - No shortcuts or facade logic detected.

2. **Credential Mirroring & Security (`cloud/microvm/bin/persist-cli-auth`)**:
   - **Target Coverage**: Lines 39–52 declare 12 credential targets:
     ```bash
     CLI_AUTH_TARGETS=(
         .config/gh        # GitHub CLI
         .aws              # AWS CLI
         .config/gcloud    # Google Cloud SDK
         .ssh              # SSH keys, known_hosts, config
         .docker           # Docker registry auth
         .vercel           # Vercel CLI auth
         .fly              # Fly.io CLI (legacy ~/.fly)
         .config/fly       # Fly.io CLI (XDG ~/.config/fly)
         .netrc            # Machine credentials (file)
         .npmrc            # npm registry auth tokens (file)
         .gitconfig        # Git identity & signing config (file)
         .git-credentials  # Git credential helper store (file)
     )
     ```
     Plus general `.config/*` sweep (excluding `origin-cli`).
   - **POSIX Hardening**: Enforces `chmod -R go-rwx`, `chmod 0700` on directories, and `chmod 0600` on secret files (`harden_perms` at lines 102–112).
   - **Quota Cap**: Line 33 sets `CLI_AUTH_DIR_CAP_BYTES="${CLI_AUTH_DIR_CAP_BYTES:-52428800}"` (50 MiB). Lines 233–239 inspect pruned size via `du` before copying; oversized targets are safely skipped with logging and counter increment.
   - **Transient Cache Pruning**: Line 55 sets `CLI_AUTH_PRUNE_NAMES=(Cache cache .cache GPUCache logs buildx scout tmp temp)`. Pruning is applied in `has_content` (lines 122–130), `pruned_size` (line 177), and `copy_pruned` (lines 192–195).

3. **Container Recycling Test Execution (`scripts/test-container-recycling.sh`)**:
   - Executed `./scripts/test-container-recycling.sh` in bash. Verbatim output:
     ```
     [INFO] Phase 0: Initializing sandbox environment...
     [PASS] Phase 0 completed.
     [INFO] Phase 1: Seeding Container 1 credentials and workspace repository...
     [INFO] Computing baseline SHA-256 checksums...
     [PASS] Phase 1 completed: Workload seeded and baseline manifest recorded.
     [INFO] Phase 2: Executing workspace and credential snapshotting...
     [INFO] Executing sync-workspace-state.sh snapshot test-agent...
     [sync-workspace-state] snapshot: agent=test-agent commit=ff49d00a dirty=true untracked=3
     [PASS] Phase 2 completed: Credentials mirrored and workspace state captured.
     [INFO] Phase 3: Simulating container recycling (destroying Container 1 and wiping ephemeral state)...
     [PASS] Phase 3 completed: Ephemeral container destroyed and fresh container spawned.
     [INFO] Phase 4: Restoring state inside Container 2...
     [INFO] Executing sync-workspace-state.sh restore test-agent...
     [sync-workspace-state] restore: agent=test-agent completed successfully into /tmp/frostfire-recycling-test-6539/mnt_workspace/test-repo
     [PASS] Phase 4 completed: State rehydrated into Container 2.
     [INFO] Phase 5: Verifying bit-for-bit file integrity and security boundaries...
     [INFO] Comparing baseline vs restored SHA-256 checksums...
     [PASS] Bit-for-bit cryptographic checksum audit PASSED: All 21 files identical.
     [INFO] Verifying POSIX permission hardening in Container 2...
     [PASS] POSIX permission audit PASSED: 0700 dirs and 0600 secret files enforced.
     [PASS] Cache exemption audit PASSED: Ephemeral cache files properly omitted.
     [INFO] Testing persist-cli-auth sync idempotency in Container 2...
     [persist-cli-auth] sync: initiating bidirectional credential convergence...
     [persist-cli-auth] restore: completed (restored=0 kept_local=10)
     [persist-cli-auth] save: completed (persisted=0 pruned=0 oversized=0 unchanged=10 absent=2)
     [persist-cli-auth] sync: convergence completed
     [PASS] Sync idempotency audit PASSED: Zero redundant writes on synchronized state.
     [INFO] Testing bidirectional sync propagation...
     [persist-cli-auth] sync: initiating bidirectional credential convergence...
     [persist-cli-auth] restore: completed (restored=0 kept_local=10)
     [persist-cli-auth] save: persisted /tmp/frostfire-recycling-test-6539/container_2/home/frostfire:.gitconfig (168 B)
     [persist-cli-auth] save: completed (persisted=1 pruned=0 oversized=0 unchanged=9 absent=2)
     [persist-cli-auth] sync: convergence completed
     [PASS] Bidirectional sync audit PASSED: Local edits correctly propagated to mirror.
     [INFO] Testing sync-workspace-state.sh watch daemon and termination trap...
     [PASS] Watch daemon audit PASSED: Background loop detected changes and cleanly flushed on SIGTERM.
     [INFO] Testing sync-workspace-state.sh clean subcommand...
     [PASS] Clean subcommand audit PASSED: All agent artifacts cleanly purged.
     [PASS] ALL 5 PHASES OF CONTAINER RECYCLING & WORKSPACE SYNC VERIFICATION PASSED.
     [PASS] Test suite completed successfully.
     ```

4. **Workspace Gates & CloudFormation Validation**:
   - `cargo test --workspace`: 10 test suites passed, 0 failures.
   - `cargo clippy --workspace -- -D warnings`: Finished in 0.47s with 0 warnings.
   - `aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml`: Returned valid parameters and `CAPABILITY_NAMED_IAM`.
   - `bash -n` syntax check: All three shell scripts exited code 0 with no syntax errors.

---

## 2. Logic Chain

1. **Anti-Tamper & Cryptographic Parity**: The recycling harness seeds 15 credential files across 7 distinct cloud CLI services and 6 repository files (tracked, staged, dirty unstaged, and untracked binary payloads). It obliterates Container 1 and resets the git working tree to baseline commit via `git reset --hard` and `git clean -fdx`. Upon invoking `restore`, all 21 files are cryptographically compared via `diff -u` on SHA-256 manifests. The exact match proves full bit-for-bit parity across container recycling.
2. **Permission Hardening Invariant**: In multitenant environments and shared EFS volumes, credential leakage occurs if permissions default to umask (e.g. 0755 or 0644). In adversarial testing, source files created with 0777/0666 permissions were confirmed to be saved to the mirror as 0700/0600 and restored into target environments as 0700/0600.
3. **Storage & IOPS Safety**: Unbounded caching from tools like GitHub CLI (`GPUCache`) or SSH session files (`Cache`) would rapidly exhaust EFS IOPS or microVM memory. The combination of name-based pruning and the 50 MiB cap per target directory guarantees bounded resource consumption.
4. **Non-Disruptive Shadow Tree Synchronization**: `scripts/sync-workspace-state.sh` uses isolated git index files (`mktemp`), `git write-tree`, and `git commit-tree` into `refs/frostfire/shadow/<agent_id>`. This preserves developer branch pointers and `HEAD` without risk of merge conflicts or index corruption.

---

## 3. Caveats

- **Path Traversal Edge Case in Agent ID**: While path separators (`/`) are blocked by `^[a-zA-Z0-9._-]+$`, single and double dot characters (`.` and `..`) match this regex. An explicit check rejecting `.` and `..` should be added to prevent directory reference edge cases before git ref validation halts execution.
- **GNU Tar Dependency**: `scripts/sync-workspace-state.sh` uses GNU tar flags (`--null -T` and `--exclude`). This is standard in Linux / Docker environments (Debian Bookworm on AWS Lambda) but non-portable on BSD tar without adjustment.
- No other caveats.

---

## 4. Conclusion

**Verdict: APPROVE**

The ephemeral Lambda microVM state persistence implementation satisfies all functional, architectural, security, and quality requirements:
- Credential mirroring correctly covers all 12 target directories, enforces 0700/0600 permissions, caps directories at 50 MiB, and prunes transient caches.
- Container recycling simulation passes all 5 verification phases with bit-for-bit SHA-256 integrity across 21 files.
- CloudFormation EFS integration (`deploy/aws/lambda-microvm.yaml`) correctly aligns UID/GID 10001 with `cloud/agent/Dockerfile.lambda` and passes schema validation.
- All workspace gates (`cargo test`, `cargo clippy`) pass with 0 errors and 0 warnings.

---

## 5. Verification Method

To independently verify these results:

1. **Run Container Recycling Verification Suite**:
   ```bash
   ./scripts/test-container-recycling.sh
   ```
   *Expected*: All 5 phases pass with green `[PASS]` assertions, 21 files verified with SHA-256 matching, POSIX permissions verified, and clean exit.

2. **Validate CloudFormation Template**:
   ```powershell
   aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml
   ```
   *Expected*: Returns exit code 0 with `CAPABILITY_NAMED_IAM`.

3. **Run Rust Workspace Quality Gates**:
   ```powershell
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
   *Expected*: All tests pass with 0 warnings.

---

## Quality Review Report

### Review Summary
- **Verdict**: APPROVE
- **Integrity Status**: CLEAN — No hardcoded test results, facade shortcuts, or self-certifying mock logic detected.

### Findings

#### [Minor] Finding 1: Agent ID Regex Allows Literal `.` and `..`
- **What**: `validate_agent_id` in `scripts/sync-workspace-state.sh` uses regex `^[a-zA-Z0-9._-]+$`, which matches `.` and `..`.
- **Where**: `scripts/sync-workspace-state.sh:76`
- **Why**: The intent documented in code comments is to reject path traversal `..`. While slashes (`/`) are rejected, `.` and `..` pass regex validation and cause downstream Git ref errors (`bad name 'refs/frostfire/shadow/..'`).
- **Suggestion**: Add an explicit check: `if [ "$agent_id" = "." ] || [ "$agent_id" = ".." ] || [[ "$agent_id" == *..* ]]; then error "Disallowed agent_id traversal"; return 1; fi`.

### Verified Claims
- Credential coverage: 12 targets + general `.config` verified in `persist-cli-auth` → PASS
- Directory / file permissions: 0700 and 0600 enforced on save and restore → PASS
- Quota capping: Exceeding 50 MiB cap skips target directory without error → PASS
- Cache pruning: `GPUCache`, `Cache`, `logs` excluded from mirrored archive → PASS
- Bit-for-bit SHA-256 parity: 21 files match exactly between pre-recycling and restored container → PASS
- CloudFormation EFS integration: Dual subnets, MountTargets, AccessPoint UID/GID 10001, and Lambda VPC config → PASS
- Workspace gates: `cargo test` and `cargo clippy` pass with 0 warnings → PASS

### Coverage Gaps
- None. All dependencies, call sites, and script execution paths for Milestone 6 were explored and executed.

### Unverified Items
- None.

---

## Adversarial Challenge Report

### Challenge Summary
- **Overall Risk Assessment**: LOW

### Challenges

#### [Low] Challenge 1: Unsanitized `..` in Agent Identifier
- **Assumption Challenged**: `validate_agent_id` guarantees non-traversing directory paths.
- **Attack Scenario**: Calling `scripts/sync-workspace-state.sh snapshot '..'` or `clean '..'`.
- **Blast Radius**: Git plumbing blocks the ref update (`refs/frostfire/shadow/..`), but lock files and directories under `${PERSIST_ROOT}/.frostfire/locks/..lock` can be created.
- **Mitigation**: Add explicit dot/dot-dot equality and substring checks in `validate_agent_id`.

#### [Low] Challenge 2: Concurrent Multi-Container Credential Clashing
- **Assumption Challenged**: Multiple microVM containers sharing an EFS volume will not overwrite each other's credentials.
- **Attack Scenario**: Two microVMs with different active credentials invoke `persist-cli-auth save` concurrently.
- **Blast Radius**: Kernel `flock` on `/mnt/workspace/.frostfire/credentials/.lock` serializes access, and `home_sig_tag` / `.by-home` separates secondary homes. For single-user Lambda execution with user-isolated EFS access points, clash risk is eliminated.
- **Mitigation**: Architecture adheres to per-user access point isolation.

### Stress Test Results
- **Quota Cap Stress Test**: Set `CLI_AUTH_DIR_CAP_BYTES=5` on 42-byte file → Skipped oversized target, zero mirror corruption → PASS
- **Cache Pruning Stress Test**: Seeded `.config/gh` with `GPUCache/blob.bin` and `logs/debug.log` → Mirror contained only `hosts.yml` → PASS
- **Permission Hardening Stress Test**: Seeded source with `0777` dir and `0666` secret file → Mirror and restore enforced `0700`/`0600` → PASS
- **Container Recycling 5-Phase Test**: Destroyed Container 1, wiped git working copy, rehydrated into Container 2 → All 21 files SHA-256 identical → PASS

### Unchallenged Areas
- EFS multi-region replication (out of scope for single-region Lambda microVM deployment).
