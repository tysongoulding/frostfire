# Dispatch: Reviewer M6.2 — Ephemeral Lambda MicroVM State Persistence Review

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m6_2`

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
1. Credential Mirroring & Security: Review `cloud/microvm/bin/persist-cli-auth`. Verify 12 target directories, 0700/0600 POSIX permissions, 50MB quota cap, and transient cache pruning (`Cache`, `logs`, `tmp`).
2. Container Recycling Verification: Review and execute `scripts/test-container-recycling.sh`. Verify all 5 phases pass, bit-for-bit SHA-256 parity, and signal handling.
3. Build & Tests: Run `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`.
4. Verdict: Output explicit verdict `APPROVE` or `REQUEST_CHANGES` in `handoff.md` and send message to parent.

## 2026-09-08T23:09:40Z
You are reviewer_m6_2.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m6_2.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m6_2\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and worker handoff at .agents/worker_m6_1/handoff.md.
Review credential mirroring in cloud/microvm/bin/persist-cli-auth and test harness scripts/test-container-recycling.sh. Run builds and tests.
Write your review report to handoff.md with an explicit verdict APPROVE or REQUEST_CHANGES and notify your parent with send_message.

