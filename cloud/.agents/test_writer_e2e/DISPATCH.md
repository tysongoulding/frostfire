# Dispatch: E2E Testing Track Test Writer

**Identity**: `test_writer_e2e` (Archetype: `teamwork_preview_test_writer`)
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e`
**Workspace Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud`

You MUST read the authoritative user request at:
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`

Also read the project architecture, feature inventory, and interface contracts at:
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`

### Write Ownership
You exclusively own:
- `TEST_INFRA.md` at project root
- `TEST_READY.md` at project root
- `tests/` directory and all test runner and test case files within it

Do NOT touch files in `deploy/`, `scripts/`, `kernel/`, `rootfs/`, or `crates/`.

### Mission & Responsibilities
Design and implement a comprehensive opaque-box, requirement-driven E2E test suite for Frostfire Cloud Phase 1 covering all 32 inventoried features in `PROJECT.md`:
1. **Tier 1 — Feature Coverage (>=5 tests per feature)**:
   - Happy-path tests verifying each feature in isolation using simplest verification channel.
2. **Tier 2 — Boundary & Corner Cases (>=5 tests per feature where boundaries exist)**:
   - Limits, empty inputs, max sizes, timeout values, invalid arguments, network disconnects.
3. **Tier 3 — Cross-Feature Combinations (Pairwise coverage)**:
   - Interactions between host auto-idle and hypervisor, kernel cmdline and network config, rootfs assets and systemd, hypervisor UDS API sequencing.
4. **Tier 4 — Real-World Application Scenarios (>=5 application scenarios)**:
   - End-to-end VM lifecycle, desktop remote access via noVNC/websockify, box-doctor diagnostic pass, clean shutdown under load.
5. Create executable test runner scripts in `tests/` (e.g. bash and powershell or python runner) that execute all test tiers, reporting clear pass/fail status and exit code 0 on success.
6. Publish `TEST_INFRA.md` and `TEST_READY.md` documenting test invocation command, coverage summary table, and feature checklist.

Write your completion report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e\handoff.md` and notify parent orchestrator via `send_message`.

## 2026-09-11T03:23:43Z
You are test_writer_e2e.
Your working directory is: c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e
The workspace directory is: c:\Users\tyson\.repo\personal\frostfire-cloud

You MUST read the authoritative user request at:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md

Read your full dispatch instructions at:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e\DISPATCH.md
Read the project architecture and feature inventory at:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md

Your exclusive write ownership:
- TEST_INFRA.md at project root
- TEST_READY.md at project root
- tests/ directory and all files within it

Implement the comprehensive 4-tier opaque-box test suite:
- Tier 1: Feature Coverage (>=5 tests per feature across all 32 inventoried features)
- Tier 2: Boundary & Corner Cases (>=5 tests per feature where boundaries exist)
- Tier 3: Cross-Feature Combinations (pairwise interaction tests)
- Tier 4: Real-World Application Scenarios (>=5 end-to-end scenarios)

Create executable test runner scripts in tests/ reporting pass/fail with exit code 0 on success.
Publish TEST_INFRA.md and TEST_READY.md.
Write your handoff report to:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e\handoff.md
And notify the parent orchestrator via send_message.
