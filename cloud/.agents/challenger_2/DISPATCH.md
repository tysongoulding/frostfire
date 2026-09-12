# Dispatch: Challenger 2 (Adversarial Correctness Verification)

**Identity**: `challenger_2` (Archetype: `teamwork_preview_challenger`)
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_2`
**Workspace Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud`

You MUST read the authoritative user request at:
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`

Also read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md` and `c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md`.

### Mission: Adversarial Stress Testing
Empirically verify the correctness, robustness, and fault tolerance of the solution:
1. Challenge network isolation and microVM invariants:
   - Ensure TAP network (`172.30.0.1/24`, guest `172.30.0.2`) does not bridge unauthenticated networks to public internet.
   - Verify tenant authorization constant-time comparison checks in display routes.
2. Challenge Firecracker machine configuration & memory limits:
   - Verify `/machine-config` allocations (2 vCPU, 4096 MiB RAM) against Debian 13 + Chrome footprint.
3. Challenge `box-doctor` verification checks:
   - Test all 10 diagnostic failure branches (machine-id format, chrome missing, high FDs, clock skew, dead Xvfb/vnc/novnc).
4. Run integration tests and edge-case stress runs.

Formulate your explicit gate verdict: `APPROVE` or `REQUEST_CHANGES`.
Write your full challenge report and verdict to:
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_2\handoff.md`
And notify the parent orchestrator via `send_message`.

## 2026-09-11T03:32:32Z
You are challenger_2.
Your working directory is: c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_2
The workspace directory is: c:\Users\tyson\.repo\personal\frostfire-cloud

You MUST read the authoritative user request at:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md

Read your full dispatch instructions at:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_2\DISPATCH.md
Read the project architecture and test readiness at:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md
c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md

Empirically and adversarially stress test the solution:
1. Challenge network isolation invariants (microVM bridge isolation, non-bridging of guest networks, tenant authorization constant-time comparison).
2. Challenge microVM sizing (2 vCPU, 4096 MiB RAM vs Chrome memory footprint).
3. Challenge box-doctor diagnostic verification (verify all 10 checks and their failure branches).
4. Run integration tests and edge-case stress checks.

Determine your gate verdict: APPROVE or REQUEST_CHANGES.
Write your full report to:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_2\handoff.md
And notify the parent orchestrator via send_message.
