# Dispatch: Worker M6.1 — Ephemeral Lambda MicroVM State Persistence & Worktrees Implementation

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_1`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Read Explorer Reports:
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_1\report.md` (and `proposed_lambda_microvm.yaml`)
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_2\report.md` (and `proposed_sync-workspace-state.sh`)
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_3\report.md`

## Exclusive Write Ownership
You exclusively own and may create/modify:
- `deploy/aws/lambda-microvm.yaml`
- `scripts/sync-workspace-state.sh`
- `cloud/microvm/bin/persist-cli-auth`
- `scripts/test-container-recycling.sh`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Objective & Implementation Requirements
1. Update `deploy/aws/lambda-microvm.yaml`:
   - Add VPC, Private Subnets, Route Tables, InternetGateway.
   - Add LambdaSecurityGroup and EfsSecurityGroup allowing NFS port 2049 ingress.
   - Add `AWS::EFS::FileSystem` (GeneralPurpose, Elastic throughput), `AWS::EFS::MountTarget` per subnet, `AWS::EFS::AccessPoint` enforcing UID 10001 / GID 10001 with root path `/workspace`.
   - Configure `AgentMicroVmFunction` with `VpcConfig`, `FileSystemConfigs` mounting `/mnt/workspace`, `DependsOn: [EfsMountTarget1, EfsMountTarget2]`.
   - Update `LambdaExecutionRole` with `AWSLambdaVPCAccessExecutionRole` and EFS client permissions.
2. Implement `scripts/sync-workspace-state.sh`:
   - Subcommands: `snapshot`, `restore`, `watch`, `list`, `clean`.
   - Implement zero-disruption git plumbing: isolated `GIT_INDEX_FILE`, `git write-tree`, `git commit-tree` creating `refs/frostfire/shadow/<agent_id>`.
   - Archive untracked files into `.untracked.tar.gz` with SHA-256 verification.
   - Atomic state metadata in `manifest.json`.
   - Distributed locking with `flock` and `SIGTERM`/`SIGINT` cleanup handler.
   - Set executable permissions (`chmod +x scripts/sync-workspace-state.sh`). Ensure LF line endings.
3. Implement `cloud/microvm/bin/persist-cli-auth`:
   - Mirror developer CLI targets (`.config/gh`, `.aws`, `.config/gcloud`, `.ssh`, `.docker`, `.vercel`, `.fly`, etc.) to `/mnt/workspace/.frostfire/credentials`.
   - Strict 0700/0600 POSIX permission enforcement, 50MB quota cap, and cache directory pruning.
   - Set executable permissions (`chmod +x cloud/microvm/bin/persist-cli-auth`). Ensure LF line endings.
4. Implement `scripts/test-container-recycling.sh`:
   - Automated 5-phase container recycling simulation harness validating EFS persistence across container lifecycles.
   - Set executable permissions (`chmod +x scripts/test-container-recycling.sh`). Ensure LF line endings.
5. Verify your implementation:
   - Run `bash -n` on all shell scripts.
   - Validate CloudFormation template with `aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml`.
   - Run `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`.
   - Execute verification harness tests.
6. Write your handoff report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_1\handoff.md` and send a completion message with verification results.
