# Dispatch: Worker M1-1 (Milestone 1 Implementation)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` and `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`.
Read the Explorer reports for Milestone 1:
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\handoff.md` (and `report.md`)
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_2\handoff.md` (and `report.md`)
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_3\handoff.md` (and `report.md`)

Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1_1`.

## Write Ownership
You exclusively own:
- `Cargo.toml` (workspace manifest)
- `cloud/gateway/Cargo.toml`
- `cloud/gateway/src/` (all files: `auth.rs`, `lib.rs`, `main.rs`, `service.rs`, `session.rs`, `server.rs`, etc.)
- `cloud/gateway/tests/` (integration tests)
- Any minor test harness updates in `crates/frostfire-daemon` or `crates/frostfire-tunnel` to provide the test tenant token during ephemeral tests if needed.

## Tasks to Implement:
1. **Workspace Manifest**:
   - Add `"crates/frostfire-cli"` to `workspace.members` in root `Cargo.toml`.
   - Add `subtle = "2.6"` to `[workspace.dependencies]` in root `Cargo.toml`.
   - Add `frostfire-cli` to `[workspace.dependencies]` in root `Cargo.toml`.
2. **Cloud Gateway Tenant Authentication**:
   - Add `subtle = { workspace = true }` and `sha2 = { workspace = true }` to `cloud/gateway/Cargo.toml`.
   - Implement `cloud/gateway/src/auth.rs`:
     - Constant-time comparison using `subtle::ConstantTimeEq`. Pre-hash tokens with SHA-256 so both sides are 32 bytes to eliminate length-timing side-channels.
     - Extract and authenticate `authorization: Bearer <token>` and `x-sand-window-owner: <token>` from gRPC request metadata.
     - Reject unauthenticated requests with `tonic::Status::unauthenticated("invalid or missing tenant token")`.
   - Wire the authenticator into `cloud/gateway/src/service.rs` in `open_tunnel` BEFORE stream registration.
   - Configure gateway to accept tenant token via CLI argument (`--tenant-token`) and environment variable (`FROSTFIRE_TENANT_TOKEN`), defaulting to a secure dev token for test harnesses if none configured.
3. **Gateway TLS 1.3 & Resilience**:
   - Add `tls` feature to `tonic` in `cloud/gateway/Cargo.toml`.
   - Support `ServerTlsConfig` in `cloud/gateway/src/server.rs` / `main.rs`.
   - Ensure session registry safely handles reconnects without race conditions.
4. **Verification & Tests**:
   - Write comprehensive unit tests in `auth.rs`.
   - Write integration tests in `cloud/gateway/tests/gateway_auth_integration_test.rs` testing valid tokens, invalid tokens, missing headers, and error codes.
   - Ensure all existing tests pass by having `bind_ephemeral()` configure a test tenant token and having test clients pass it.
   - Run `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`. Both MUST pass with 0 errors and 0 warnings.
5. Document all changes and verification command outputs in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1_1\handoff.md` and notify parent.

## 2026-09-08T20:40:18Z
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1_1\DISPATCH.md.
Also read the explorer handoffs:
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\handoff.md
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_2\handoff.md
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_3\handoff.md

Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1_1.
Implement Milestone 1: Cloud Gateway Hardening & Tenant Auth:
1. Add crates/frostfire-cli to workspace.members, subtle = "2.6" to workspace.dependencies in Cargo.toml.
2. Implement constant-time tenant token validation using subtle::ConstantTimeEq with SHA-256 pre-hashing in cloud/gateway/src/auth.rs.
3. Wire tenant authentication into cloud/gateway/src/service.rs in open_tunnel before registering session. Reject unauthenticated connections with Status::unauthenticated("invalid or missing tenant token").
4. Support TLS 1.3 server listener in cloud/gateway.
5. Add unit and integration tests; ensure existing tests pass with test token.
6. Verify cargo test --workspace (all tests pass) and cargo clippy --workspace -- -D warnings (0 warnings).
Write full report and handoff.md, then notify parent with send_message.
