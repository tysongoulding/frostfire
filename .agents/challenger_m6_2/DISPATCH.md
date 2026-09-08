# Dispatch: Challenger M6.2 — Container Recycling Simulation & Credential Quotas

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m6_2`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Inspect Worker Handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_1\handoff.md`
- Inspect `cloud/microvm/bin/persist-cli-auth` and `scripts/test-container-recycling.sh`

## Objective & Adversarial Stress Testing
Empirically stress test credential mirroring and container recycling:
1. Quota & DoS Attack: Attempt to mirror a directory exceeding 50 MB (e.g. 60 MB dummy file in `.docker` or `.cache`). Verify that `persist-cli-auth` safely prunes or skips the oversized directory without crashing.
2. Permission Stripping: Create credentials with insecure permissions (`0777` or `0666`). Run `persist-cli-auth` and verify that the mirrored storage and restored files strictly enforce `0700` for directories and `0600` for secret files.
3. Path Traversal & Injection: Test maliciously crafted filenames in credential paths (e.g. `../../etc/passwd`, spaces, semicolons, backticks). Verify safe shell expansion.
4. Container Recycling Teardown: Run `scripts/test-container-recycling.sh` and verify all 5 phases exit with code 0 and 100% cryptographic checksum parity.
5. Output explicit verdict `APPROVE` or `REQUEST_CHANGES` in `handoff.md` and send message to parent.

## 2026-09-08T23:09:41Z
You are challenger_m6_2.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m6_2.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m6_2\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and worker handoff at .agents/worker_m6_1/handoff.md.
Empirically stress test cloud/microvm/bin/persist-cli-auth quotas (>50MB), 0700/0600 permissions, path traversal, and execute scripts/test-container-recycling.sh.
Write your adversarial findings to handoff.md with an explicit verdict APPROVE or REQUEST_CHANGES and notify your parent with send_message.

