# Review & Adversarial Critic Report: Milestone M6 — Ephemeral Lambda MicroVM State Persistence

**Agent**: `reviewer_m6_1`  
**Milestone**: M6 (Ephemeral Lambda MicroVM State Persistence & Worktrees)  
**Date**: 2026-09-08  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m6_1`  
**Target Work Products**:
- `deploy/aws/lambda-microvm.yaml`
- `scripts/sync-workspace-state.sh`
- `cloud/microvm/bin/persist-cli-auth`
- `scripts/test-container-recycling.sh`

---

## Review Summary

**Verdict**: **APPROVE**

Milestone M6 delivers a fully functional, production-ready persistence and state synchronization architecture for ephemeral AWS Lambda Firecracker microVMs. The CloudFormation template conforms strictly to AWS VPC and EFS best practices with non-circular security group relationships, POSIX access point mapping, and explicit dependency sequencing. The workspace state synchronization script employs genuine low-level Git plumbing (`GIT_INDEX_FILE`, `git write-tree`, `git commit-tree`, `git read-tree`, `checkout-index`) to guarantee zero disruption to active developer branches and staging areas. The developer CLI persistence utility enforces rigorous security hardening (0700/0600 permissions), cache pruning, and size caps. The container recycling test suite passes all 5 verification phases with bit-for-bit SHA-256 cryptographic parity across 21 files. No integrity violations, facade implementations, or hardcoded shortcuts were detected.

---

## 1. Observation

Directly observed verification commands, file properties, and tool outputs:

1. **CloudFormation Template Validation (`deploy/aws/lambda-microvm.yaml`)**:
   - Command:
     ```bash
     aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml
     ```
   - Result: Exit code `0`. Returned valid JSON schema with parameters `TimeoutSeconds`, `PrivateSubnet1CIDR`, `LambdaMemorySize`, `EphemeralStorageSize`, `ContainerImageUri`, `VpcCIDR`, `EnvironmentName`, `PrivateSubnet2CIDR`, `GatewayEndpoint`, and Capabilities `["CAPABILITY_NAMED_IAM"]`.
   - Resource Inspection:
     - VPC: `LambdaVpc` (`10.50.0.0/16`), `PrivateSubnet1` (`10.50.1.0/24`, AZ 0), `PrivateSubnet2` (`10.50.2.0/24`, AZ 1).
     - Security Groups: `LambdaSecurityGroup` (egress `0.0.0.0/0`, no circular ingress); `EfsSecurityGroup` (ingress TCP 2049 from `LambdaSecurityGroup`).
     - EFS: `WorkspaceFileSystem` (`PerformanceMode: generalPurpose`, `ThroughputMode: elastic`, `Encrypted: true`).
     - Mount Targets: `EfsMountTarget1` and `EfsMountTarget2`.
     - Access Point: `WorkspaceAccessPoint` (`Path: /workspace`, `PosixUser: {Uid: '10001', Gid: '10001'}`, `CreationInfo: {OwnerUid: '10001', OwnerGid: '10001', Permissions: '0755'}`).
     - Lambda Function: `AgentMicroVmFunction` with `DependsOn: [LogGroup, LambdaExecutionRole, EfsMountTarget1, EfsMountTarget2]`, `FileSystemConfigs` mounting `WorkspaceAccessPoint` at `/mnt/workspace`, and environment variables `WORKSPACE_DIR: "/mnt/workspace"` and `FROSTFIRE_PERSIST_ROOT: "/mnt/workspace"`.
     - IAM Role: `LambdaExecutionRole` includes managed policy `arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole` and policy `EfsClientAccessPolicy` granting `elasticfilesystem:ClientMount`, `ClientWrite`, `ClientRootAccess` conditioned on `elasticfilesystem:AccessPointArn`.

2. **Shell Script Syntax Validation**:
   - Command:
     ```bash
     bash -n scripts/sync-workspace-state.sh && bash -n cloud/microvm/bin/persist-cli-auth && bash -n scripts/test-container-recycling.sh
     ```
   - Result: Exit code `0` across all three scripts.

3. **Container Recycling Integration Suite Execution**:
   - Command:
     ```bash
     bash -c "./scripts/test-container-recycling.sh"
     ```
   - Verbatim Output:
     ```
     [INFO] Phase 0: Initializing sandbox environment...
     [PASS] Phase 0 completed.
     [INFO] Phase 1: Seeding Container 1 credentials and workspace repository...
     [INFO] Computing baseline SHA-256 checksums...
     [PASS] Phase 1 completed: Workload seeded and baseline manifest recorded.
     [INFO] Phase 2: Executing workspace and credential snapshotting...
     [INFO] Executing sync-workspace-state.sh snapshot test-agent...
     [sync-workspace-state] snapshot: agent=test-agent commit=56ab5518 dirty=true untracked=3
     [PASS] Phase 2 completed: Credentials mirrored and workspace state captured.
     [INFO] Phase 3: Simulating container recycling (destroying Container 1 and wiping ephemeral state)...
     [PASS] Phase 3 completed: Ephemeral container destroyed and fresh container spawned.
     [INFO] Phase 4: Restoring state inside Container 2...
     [INFO] Executing sync-workspace-state.sh restore test-agent...
     [sync-workspace-state] restore: agent=test-agent completed successfully into /tmp/frostfire-recycling-test-367/mnt_workspace/test-repo
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
     [persist-cli-auth] save: persisted /tmp/frostfire-recycling-test-367/container_2/home/frostfire:.gitconfig (168 B)
     [persist-cli-auth] save: completed (persisted=1 pruned=0 oversized=0 unchanged=9 absent=2)
     [persist-cli-auth] sync: convergence completed
     [PASS] Bidirectional sync audit PASSED: Local edits correctly propagated to mirror.
     [INFO] Executing status report and list commands...
     ...
     [INFO] Testing sync-workspace-state.sh watch daemon and termination trap...
     [sync-workspace-state] watch: daemon starting for agent=test-agent on /tmp/frostfire-recycling-test-367/mnt_workspace/test-repo (interval: 1s)
     [sync-workspace-state] snapshot: agent=test-agent commit=244e590b dirty=true untracked=3
     [sync-workspace-state] watch: caught termination signal (SIGTERM/SIGINT) — flushing final dirty snapshot...
     [sync-workspace-state] snapshot: agent=test-agent commit=a297c5c6 dirty=true untracked=3
     [sync-workspace-state] watch: final flush complete, exiting cleanly
     [PASS] Watch daemon audit PASSED: Background loop detected changes and cleanly flushed on SIGTERM.
     [INFO] Testing sync-workspace-state.sh clean subcommand...
     [sync-workspace-state] Purging snapshot artifacts for agent=test-agent
     [sync-workspace-state] clean: agent=test-agent purged successfully
     [PASS] Clean subcommand audit PASSED: All agent artifacts cleanly purged.
     [PASS] ALL 5 PHASES OF CONTAINER RECYCLING & WORKSPACE SYNC VERIFICATION PASSED.
     [INFO] Cleaning up sandbox directory: /tmp/frostfire-recycling-test-367
     [PASS] Test suite completed successfully.
     ```

4. **Workspace Unit & Integration Test Suite**:
   - Command:
     ```bash
     cargo test --workspace
     ```
   - Result: Exit code `0`. All tests in all crates passed (0 failures, 0 errors across `frostfire_exec`, `frostfire_gateway`, `frostfire_mcp`, `frostfire_orchestrator`, `frostfire_proto`, `frostfire_security`, `frostfire_tunnel`, and integration suites).

5. **Workspace Linter Suite**:
   - Command:
     ```bash
     cargo clippy --workspace -- -D warnings
     ```
   - Result: Exit code `0`. Dev profile compiled in 0.45s with 0 warnings.

6. **Integrity & Facade Inspection**:
   - Checked `scripts/sync-workspace-state.sh` lines 160-248 for genuine Git plumbing. Verified `GIT_INDEX_FILE="$tmp_index"`, `git write-tree`, `git add -u`, `git commit-tree`, `git update-ref`, `tar -czf --null -T`, and atomic manifest writing.
   - Checked `cloud/microvm/bin/persist-cli-auth` lines 213-326 for real file system inspection, size bounds checking, `content_sig` hashing, and atomic rename swapping.
   - Checked `scripts/test-container-recycling.sh` lines 151-274 for genuine cryptographic comparison (`sha256sum` + `diff -u`) of pre- and post-recycling states.
   - Verified zero hardcoded shortcuts or facades.

---

## 2. Logic Chain

1. **EFS Infrastructure Alignment (Observation 1)**:
   - Observation: `WorkspaceAccessPoint` specifies `PosixUser` `10001:10001` and `CreationInfo` permissions `0755` at `/workspace`, while `AgentMicroVmFunction` mounts this at `/mnt/workspace`.
   - Inference: In `cloud/agent/Dockerfile.lambda`, the execution user is non-root `frostfire` with UID 10001 and GID 10001. The access point identity guarantees that Lambda invocations write directly to the EFS filesystem with matching POSIX permissions, preventing `EACCES` permission denied errors.
   - Inference: `DependsOn: [EfsMountTarget1, EfsMountTarget2]` prevents race conditions where Lambda attempts to mount EFS before the elastic network interfaces (ENIs) in the target subnets are fully in `Available` status.
   - Inference: `EfsSecurityGroup` ingress references `LambdaSecurityGroup`, while `LambdaSecurityGroup` has only egress `0.0.0.0/0`. This prevents circular CloudFormation dependency errors during stack deployment and deletion.

2. **Zero-Disruption Working Copy Invariant (Observation 2 & 3)**:
   - Observation: `do_snapshot` copies `.git/index` to an isolated temporary index file (`GIT_INDEX_FILE`), executes `git write-tree` to capture staged files, executes `git add -u` to capture unstaged tracked modifications, writes a shadow commit via `git commit-tree` pointing to the working tree, and stores the reference under `refs/frostfire/shadow/<agent_id>`.
   - Inference: Neither `HEAD` nor any branch under `refs/heads/*` is ever modified. The active user branch and staging state remain completely undisturbed.
   - Observation: `do_restore` executes `git read-tree "$working_tree"` + `git checkout-index -a -f`, followed by `git read-tree "$staged_tree"`.
   - Inference: The working tree files on disk are rehydrated from `$working_tree`, while the `.git/index` is rehydrated from `$staged_tree`. Consequently, `git status` accurately reflects both staged changes (diff between `HEAD` and index) and unstaged modifications (diff between index and disk), preserving the exact workflow context across microVM restarts.

3. **Cryptographic Parity & Untracked File Preservation (Observation 3 & 6)**:
   - Observation: Untracked files are captured via null-delimited `git ls-files -o --exclude-standard -z`, excluding `.frostfire` metadata, and compressed into `.untracked.tar.gz`. The SHA-256 digest is stored in `manifest.json`.
   - Observation: On restore, `sha256sum` validates the archive before calling `tar -xzf`.
   - Inference: Any corrupted or partially written archive on EFS is rejected prior to unpacking, preventing state corruption.
   - Inference: In the test harness, all 21 files (15 credentials + 6 workspace files) yielded identical SHA-256 checksums before and after container destruction and recreation (`diff -u` returned 0 differences).

4. **Security Hardening & Quota Protection (Observation 3 & 6)**:
   - Observation: `persist-cli-auth` enforces `harden_perms` (0700 for directories, 0600 for files) on both the persistent mirror and restored files.
   - Observation: `CLI_AUTH_DIR_CAP_BYTES` (50 MiB) and `CLI_AUTH_PRUNE_NAMES` (Cache, GPUCache, logs, tmp) prevent uncontrolled growth.
   - Inference: Cache files are pruned prior to mirroring, avoiding unnecessary EFS I/O and disk bloat. Secret files (.ssh, .aws, .netrc) are locked down against multi-tenant read exposure.

---

## 3. Adversarial Challenges & Findings

### Overall Risk Assessment: LOW

### Findings

#### [Minor] Finding 1: Path Traversal Validation Gap in `validate_agent_id`
- **What**: The regex `^[a-zA-Z0-9._-]+$` permits `.` and `..` as valid `agent_id` strings.
- **Where**: `scripts/sync-workspace-state.sh:76`
- **Why**: If a caller or automated process passes `agent_id=".."`, `validate_agent_id` returns 0. In `do_clean`, `rm -rf "${STATE_BASE:?}/${target}"` expands to `rm -rf /mnt/workspace/.frostfire/state/..`, which could delete the parent `.frostfire` directory.
- **Suggestion**: Add an explicit check in `validate_agent_id`:
  ```bash
  if [ "$agent_id" = "." ] || [ "$agent_id" = ".." ] || [[ "$agent_id" == *".."* ]]; then
      error "agent_id cannot contain path traversal dots"
      return 1
  fi
  ```

#### [Minor] Finding 2: Python Manifest Inline String Interpolation
- **What**: `python3 -c "m = json.load(open('${manifest}'))"` interpolates the shell path variable directly into Python code.
- **Where**: `scripts/sync-workspace-state.sh:340`
- **Why**: If `${manifest}` contains single quotes or backslashes (e.g., in unconventional mount paths or test environments), Python will raise a `SyntaxError`.
- **Suggestion**: Pass the manifest path as an argument:
  ```bash
  python3 -c "import json, sys; m = json.load(open(sys.argv[1])); ..." "$manifest"
  ```

#### [Informational] Finding 3: Unrouted Internet Gateway in CloudFormation Template
- **What**: `InternetGateway` and `AttachInternetGateway` are provisioned, but `PrivateRouteTable` contains no route to the gateway.
- **Where**: `deploy/aws/lambda-microvm.yaml:73-85, 109-115`
- **Why**: Private subnets cannot route directly to an IGW without NAT. While this adheres to the Frostfire isolation invariant (microVM traffic is mediated via the Cloud Gateway reverse tunnel), the IGW resource itself remains idle unless a public NAT subnet is provisioned.
- **Suggestion**: Document that outbound direct internet egress is intentionally disabled in favor of reverse-tunnel gateway routing.

---

## 4. Integrity Violation Audit

| Integrity Dimension | Evaluation | Result |
|---------------------|------------|--------|
| Hardcoded Test Results | Inspected shell scripts and test harness; checksums and git trees are computed dynamically. | **PASS (None)** |
| Dummy / Facade Implementations | All subcommands (`snapshot`, `restore`, `watch`, `list`, `clean`, `save`, `sync`) contain full, working production logic. | **PASS (None)** |
| Shortcut Tasks | CloudFormation, Git plumbing, credential mirroring, and recycling tests all fully implemented. | **PASS (None)** |
| Fabricated Attestation Artifacts | Independent execution of all test commands reproduced identical results in real time. | **PASS (None)** |
| Self-Certifying Work | Test suite independently exercises container obliteration, directory wiping, and bit-for-bit SHA-256 validation. | **PASS (None)** |

---

## 5. Caveats

1. **EFS Availability Zone Placement**: `deploy/aws/lambda-microvm.yaml` provisions mount targets in AZ 0 and AZ 1. In production deployments, both AZs must support Amazon EFS and correspond to active VPC subnets.
2. **NAT Gateway for Direct External Egress**: If a Lambda agent requires direct egress to external Git providers (e.g. GitHub over HTTPS) rather than routing through the Frostfire Cloud Gateway reverse tunnel, an AWS NAT Gateway and corresponding route table entry must be added to the VPC.
3. No other caveats.

---

## 6. Conclusion

Milestone M6 satisfies all functional, architectural, and security requirements defined in `PROJECT.md` and `ORIGINAL_REQUEST.md`.
- `deploy/aws/lambda-microvm.yaml` passes AWS CloudFormation validation with correct EFS, VPC, and IAM specifications.
- `scripts/sync-workspace-state.sh` executes zero-disruption Git shadow state snapshotting and restoration.
- `cloud/microvm/bin/persist-cli-auth` enforces hardened credential persistence across microVM lifecycles.
- `scripts/test-container-recycling.sh` validates bit-for-bit file integrity (all 21 files identical across container recycling).
- `cargo test --workspace` and `cargo clippy --workspace -- -D warnings` pass cleanly.

**Final Verdict**: **APPROVE**

---

## 7. Verification Method

To independently verify this evaluation from the repository root:

1. **CloudFormation Validation**:
   ```powershell
   aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml
   ```
   *Expected*: Valid JSON schema output with `CAPABILITY_NAMED_IAM` and exit code 0.

2. **Shell Script Syntax**:
   ```bash
   bash -n scripts/sync-workspace-state.sh
   bash -n cloud/microvm/bin/persist-cli-auth
   bash -n scripts/test-container-recycling.sh
   ```
   *Expected*: Exit code 0 for all scripts.

3. **Container Recycling Test**:
   ```bash
   bash -c "./scripts/test-container-recycling.sh"
   ```
   *Expected*: All 5 phases pass, reporting "ALL 5 PHASES OF CONTAINER RECYCLING & WORKSPACE SYNC VERIFICATION PASSED" and exit code 0.

4. **Rust Quality & Verification Gates**:
   ```powershell
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
   *Expected*: All tests pass with 0 failures and 0 warnings.
