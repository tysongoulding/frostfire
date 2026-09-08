# Dispatch: Forensic Auditor M6.1 — Integrity Verification

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\auditor_m6_1`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Inspect Worker Handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_1\handoff.md`
- Inspect All Implemented Files in Milestone 6:
  - `deploy/aws/lambda-microvm.yaml`
  - `scripts/sync-workspace-state.sh`
  - `cloud/microvm/bin/persist-cli-auth`
  - `scripts/test-container-recycling.sh`

## Forensic Audit Protocol
Execute every check from the Integrity Forensics suite:
1. Genuine Implementation: Check for dummy/facade implementations, stubbed functions, or hardcoded return strings that circumvent genuine logic. Verify real git plumbing commands (`git write-tree`, `git commit-tree`, `GIT_INDEX_FILE`), real CloudFormation EFS resources, and real credential mirroring logic.
2. Security & Invariant Audit: Verify zero secrets or private keys committed to git, strict POSIX permissions (`0700`/`0600`), and clean git status.
3. Automated Quality Verification: Execute `aws cloudformation validate-template`, `bash -n` on all shell scripts, and workspace gates: `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`.
4. Output explicit verdict `CLEAN` or `INTEGRITY VIOLATION` in `handoff.md` and send message to parent.

## 2026-09-08T23:09:41Z
You are auditor_m6_1.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\auditor_m6_1.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\auditor_m6_1\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and worker handoff at .agents/worker_m6_1/handoff.md.
Execute forensic integrity checks on M6: genuine git plumbing/EFS, no stubs/facades, zero secrets in git, validate-template, and workspace gates.
Write your audit report to handoff.md with an explicit verdict CLEAN or INTEGRITY VIOLATION and notify your parent with send_message.

