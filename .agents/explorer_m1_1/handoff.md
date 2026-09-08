# Handoff Report: Milestone 1 Gateway Hardening & Tenant Authentication

## 1. Observation
1. **Workspace Manifest (`Cargo.toml:3-15, 24-69`)**:
   - `members` in `Cargo.toml` contains 11 crates, omitting `crates/frostfire-cli` (Feature F5 in `PROJECT.md:43`).
   - `[workspace.dependencies]` does not declare `subtle`.
   - `Cargo.lock:2728-2733` already locks `subtle` version `2.6.1` via transitive crypto dependencies (`rustls-pki-types`, `aws-lc-rs`).
2. **Gateway Crate Manifest (`cloud/gateway/Cargo.toml:12-28`)**:
   - `[dependencies]` contains `tonic`, `tokio`, `prost`, etc., but does not include `subtle`.
3. **Gateway Service Ingress (`cloud/gateway/src/service.rs:16-20, 44-54`)**:
   - `GatewayTunnelService` struct definition:
     ```rust
     pub struct GatewayTunnelService {
         registry: Arc<SessionRegistry>,
         client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
         turn_engine: Option<Arc<AgentTurnEngine>>,
     }
     ```
     Lacks any `tenant_token` or `config` field.
   - `open_tunnel` implementation:
     ```rust
     let metadata_agent_id = request
         .metadata()
         .get("x-agent-id")
         .and_then(|v| v.to_str().ok())
         .map(|s| s.to_string());
     ```
     Does not read `authorization` or `x-sand-window-owner`, does not perform any authentication checks, and does not use `subtle::ConstantTimeEq`.
4. **Existing Integration Tests (`cloud/gateway/tests/service_communication_test.rs:13-18, 160-165`)**:
   - `test_cloud_service_communicates_with_application_crates` calls `GatewayServerHandle::bind_ephemeral()`.
   - `test_cloud_gateway_evaluates_user_prompt_and_returns_tool_frames` calls `GatewayServerHandle::bind_with_engine()`.
   - Neither test configures or passes authentication headers.
   - `cargo test -p frostfire-gateway` runs 2 tests and exits 0.
   - `cargo clippy --workspace -- -D warnings` exits 0.
5. **E2E Reference Implementation (`tests/e2e/src/mock_gateway.rs:98-119`)**:
   - Extracts `authorization` (stripping `"Bearer "` prefix) or `x-sand-window-owner`.
   - Compares token in constant time.
   - Rejects unauthenticated requests with `tonic::Status::unauthenticated("invalid or missing tenant token")`.

---

## 2. Logic Chain
1. From Observation 1, `subtle v2.6.1` is already locked in `Cargo.lock` and compiles locally without external network dependencies. Adding `subtle = "2.6"` to `Cargo.toml` `[workspace.dependencies]` and `subtle = { workspace = true }` to `cloud/gateway/Cargo.toml` will immediately provide `subtle::ConstantTimeEq` to `frostfire-gateway`.
2. From Observation 1, adding `"crates/frostfire-cli"` to `members` fulfills Feature F5 and ensures full workspace coverage under `cargo test --workspace`.
3. From Observation 3, `GatewayTunnelService` currently admits any client without checking credentials, violating security invariant `AGENTS.md:16` and requirements in `ORIGINAL_REQUEST.md:17` and `PROJECT.md:74-77`.
4. From Observation 4, existing integration tests rely on unauthenticated default behavior (`bind_ephemeral`). To prevent regressions while strictly enforcing security, `GatewayConfig.tenant_token` should be an `Option<String>`:
   - When `Some(expected_token)`: `open_tunnel` strictly enforces constant-time validation on all requests and aborts unauthenticated streams with `tonic::Status::unauthenticated("invalid or missing tenant token")`.
   - When `None`: Operates in backward-compatible development/test mode.
5. From Observation 5 and `PROJECT.md:74-77`, clients supply tokens via either `authorization: Bearer <tenant-token>` or `x-sand-window-owner: <tenant-token>`. The extraction logic must support both formats, handle case-insensitivity on `"bearer "`, and reject empty or invalid UTF-8 strings.
6. Constant-time byte comparison using `subtle::ConstantTimeEq::ct_eq` on the extracted slice and the expected slice prevents statistical byte-by-byte timing attacks.

---

## 3. Caveats
- **Agent Client (`cloud/agent/src/main.rs:139`)**: The in-VM agent daemon CLI defines `--token` (default `"local-token"`), but `run_tunnel_client` does not yet inject the `authorization` header into its gRPC request. When connecting to an authenticated gateway, `cloud/agent` will require an update to pass `authorization: Bearer <token>`.
- **Length-Timing Leakage**: `subtle::ConstantTimeEq` on `[u8]` short-circuits if slice lengths differ. If tokens have arbitrary variable lengths and length concealment is strictly required, SHA-256 pre-hashing should be used (`Sha256::digest(a).ct_eq(&Sha256::digest(b))`). For uniform fixed-length tokens (e.g. 32-char hex), direct slice comparison is sufficient.

---

## 4. Conclusion
Milestone 1 is ready for immediate implementation following the detailed architectural blueprint in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\report.md`.
The changes are strictly scoped to:
1. `Cargo.toml` (workspace members & dependencies).
2. `cloud/gateway/Cargo.toml` (`subtle = { workspace = true }`).
3. `cloud/gateway/src/config.rs` (new `GatewayConfig` struct).
4. `cloud/gateway/src/service.rs` (tenant token field, builder, metadata extraction, and constant-time check in `open_tunnel`).
5. `cloud/gateway/src/server.rs` (`bind_ephemeral_with_token` and `bind_with_config`).
6. `cloud/gateway/src/main.rs` (wire CLI/env `FROSTFIRE_TENANT_TOKEN` into `GatewayConfig`).
7. `cloud/gateway/tests/auth_test.rs` (unit & integration tests for valid admission and rejection).

---

## 5. Verification Method
1. **Compilation & Clippy**:
   ```bash
   cargo check --workspace
   cargo clippy --workspace -- -D warnings
   ```
   Both commands must exit 0 with 0 warnings.
2. **Gateway Test Suite**:
   ```bash
   cargo test -p frostfire-gateway
   ```
   Must pass all existing communication tests and new authentication tests.
3. **Invalidation Conditions**:
   - Gateway allows an `open_tunnel` connection when `tenant_token` is set and `authorization`/`x-sand-window-owner` is missing or mismatched.
   - Gateway panics or leaks timing on invalid UTF-8 metadata.
   - Any regression occurs in `cloud/gateway/tests/service_communication_test.rs`.
