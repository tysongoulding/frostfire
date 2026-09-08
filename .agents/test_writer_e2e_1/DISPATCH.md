# Dispatch: E2E Test Writer (Opaque-Box Verification Suite)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` and `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`.
Your role is `teamwork_preview_test_writer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e_1`.

Your mission:
Design and build the comprehensive, opaque-box E2E test suite according to the Project Dual Track specification:
1. Create `c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_INFRA.md` at project root defining:
   - Test architecture and runner
   - Feature inventory (all 16 features from PROJECT.md)
   - 4-Tier test methodology:
     - Tier 1: Feature Coverage (>=5 tests per feature)
     - Tier 2: Boundary & Corner Cases (>=5 tests per feature)
     - Tier 3: Cross-Feature Combinations (pairwise coverage)
     - Tier 4: Real-World Application Scenarios (>=5 application-level tests)
2. Create the test suite in `tests/e2e/` (or integration test files under `tests/`):
   - Simulate Frostfire desktop client connecting over gRPC to `frostfire-gateway` via `AgentTunnelService.OpenTunnel`.
   - Verify constant-time tenant token validation:
     - Valid `x-sand-window-owner` or `authorization: Bearer <token>` accepted.
     - Invalid / missing tokens rejected with gRPC Unauthenticated.
     - Side-channel timing variance check.
   - Verify multiplexing: PTY interactive terminal frames, VNC/display takeover frames, atomic patch application, MCP tool invocations, and WebAuthn ceremonies over the single reverse tunnel.
   - Verify microVM network bridge isolation: assert that guest network (`172.16.x.0/24`) cannot route directly to public internet without going through the reverse tunnel.
   - Verify clean teardown: session termination, resource cleanup, no orphaned processes or sockets.
3. Validate tests run via `cargo test --test <name>` or workspace test runner.

## 2026-09-08T20:35:45Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e_1\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e_1.
Design and implement the comprehensive opaque-box E2E test suite:
1. Create c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_INFRA.md following the Dual Track test architecture guidelines.
2. Implement test cases across Tiers 1-4 in tests/e2e/ (or integration tests under tests/):
   - Tier 1: Feature coverage (all 16 features from PROJECT.md)
   - Tier 2: Boundary & corner cases (token lengths, empty tokens, special chars, disconnects)
   - Tier 3: Cross-feature interactions (token auth + bidirectional multiplexing + reconnect)
   - Tier 4: Real-world scenarios (desktop client -> gateway -> isolated microVM -> PTY/VNC streaming -> teardown)
3. Ensure tests run with `cargo test`.
4. When complete, create c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md.
5. Write your handoff to c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\test_writer_e2e_1\handoff.md and notify parent.
