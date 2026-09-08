# Dispatch: Reviewer M6.1 — Ephemeral Lambda MicroVM State Persistence Review

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m6_1`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Inspect Worker Handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_1\handoff.md`
- Inspect Implemented Files:
  - `deploy/aws/lambda-microvm.yaml`
  - `scripts/sync-workspace-state.sh`
  - `cloud/microvm/bin/persist-cli-auth`
  - `scripts/test-container-recycling.sh`

## Review Criteria
1. CloudFormation Specification: Validate `deploy/aws/lambda-microvm.yaml` using `aws cloudformation validate-template`. Verify VPC, private subnets, security group non-circular ingress on port 2049, EFS FileSystem with elastic throughput, EFS AccessPoint with UID/GID 10001 mapping to `/workspace`, and `DependsOn: [EfsMountTarget1, EfsMountTarget2]`.
2. Shell Script Integrity: Verify `bash -n` on all shell scripts. Review `scripts/sync-workspace-state.sh` for zero-disruption Git plumbing (`GIT_INDEX_FILE`, `git write-tree`, `git commit-tree`), untracked file tarballing, SHA-256 verification, and flock file locking.
3. Build & Tests: Run `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`.

## 2026-09-08T23:09:40Z
You are reviewer_m6_1.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m6_1.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m6_1\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and worker handoff at .agents/worker_m6_1/handoff.md.
Review CloudFormation EFS integration in deploy/aws/lambda-microvm.yaml and Git plumbing in scripts/sync-workspace-state.sh. Run builds and tests.
Write your review report to handoff.md with an explicit verdict APPROVE or REQUEST_CHANGES and notify your parent with send_message.
