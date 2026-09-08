# Handoff Report: Specification Mining for Client Tunnel & Gateway Ingress

**Agent / Role**: `spec_miner_survey_2` (Specification Miner)  
**Date**: 2026-09-08  
**Handoff Type**: Hard (Task Complete)  
**Target Audience**: Orchestrator / Lead Engineer / Implementer Agents

---

## 1. Observation

Direct observations extracted from authoritative specification files, interfaces, and test suites across the repository:

1. **Protobuf Contract (`crates/frostfire-proto/proto/tunnel.proto`)**:
   - Lines 6–8:
     ```protobuf
     service AgentTunnelService {
       rpc OpenTunnel(stream TunnelClientFrame) returns (stream TunnelServerFrame);
     }
     ```
   - Lines 11–35 (`TunnelServerFrame`): Contains `frame_id`, `timestamp_unix_ms`, and `oneof payload` containing 17 variants: `Heartbeat` (10), `ExecCommand` (11), `TerminalInputChunk` (12), `ApplyPatch` (13), `McpInvokeRequest` (14), `ApprovalResponse` (15), `ApprovalRequest` (16), `TerminalOutputChunk` (17), `PatchResult` (18), `McpInvokeResponse` (19), `string error_frame` (20), `AgentMessage` (21), `WebAuthnCeremonyRequest` (22), `WebAuthnCeremonyResponse` (23), `DisplayTakeoverEvent` (24), `TeachSessionCommand` (25), `TeachSessionResponse` (26), `UserPrompt` (27).
   - Lines 38–63 (`TunnelClientFrame`): Contains `frame_id`, `timestamp_unix_ms`, `agent_id`, and `oneof payload` with the matching symmetric 17 variants.

2. **Client Reconnection & Ingress Invariants (`crates/frostfire-tunnel/src/client.rs`)**:
   - Lines 310–318:
     ```rust
     let mut request = tonic::Request::new(outbound_stream);
     if let Some(token) = &config.auth_token {
         if let Ok(meta_val) = token.parse() {
             request.metadata_mut().insert("authorization", meta_val);
         }
     }
     if let Ok(meta_val) = config.agent_id.parse() {
         request.metadata_mut().insert("x-agent-id", meta_val);
     }
     ```
   - Lines 352–356:
     ```rust
     if let Some(frame) = pending_frame.take() {
         if let Err(e) = conn_tx.send(frame).await {
             pending_frame = Some(e.0);
         }
     }
     ```
   - Lines 425–443: Autonomous heartbeat ticker emits `TunnelClientFrame` with `is_ack = false` every `heartbeat_interval` (default 10s); failure to send terminates `stream_active` and triggers exponential backoff reconnect.
   - Lines 470–486: TLS 1.3 configured when `server_url` begins with `https://` via `ClientTlsConfig::new().with_native_roots()`.

3. **Current Cloud Gateway Implementation (`cloud/gateway/src/service.rs`)**:
   - Lines 48–53:
     ```rust
     let metadata_agent_id = request
         .metadata()
         .get("x-agent-id")
         .and_then(|v| v.to_str().ok())
         .map(|s| s.to_string());
     ```
   - Lines 63–75: If `metadata_agent_id` is missing, gateway extracts `agent_id` from the first client frame and registers it in `SessionRegistry`.
   - Lines 77–93: Auto-acknowledges client `Heartbeat` pings with `is_ack = true`.
   - **Crucial Observation**: Gateway `open_tunnel` currently does **not** check the `authorization` or `x-sand-window-owner` metadata headers against any tenant token.

4. **Constant-Time Tenant Token Validation Invariants (`cloud/microvm/scripts/sand-window-router.mjs`)**:
   - Lines 24–30:
     ```javascript
     export function tokensMatch(a, b) {
       if (typeof a !== "string" || typeof b !== "string") return false;
       const ab = Buffer.from(a);
       const bb = Buffer.from(b);
       if (ab.length === 0 || ab.length !== bb.length) return false;
       return timingSafeEqual(ab, bb);
     }
     ```
   - Lines 39–52: Display 1 routes directly to port 1337 (`if (display <= 1) return { port: primaryPort };`). Displays > 1 read `/tmp/sand-window-tokens.d/<display>` and compare against `x-sand-window-owner` via `tokensMatch`. Mismatch returns HTTP 403 Forbidden.
   - Workspace `AGENTS.md` (line 16): `- **Tenant Authorization**: All display routes must pass `x-sand-window-owner` token checks with constant-time comparison (`timingSafeEqual`).`
   - `ORIGINAL_REQUEST.md` (lines 17, 40): Requires gRPC/TLS 1.3 edge gateway (`frostfire-gateway`) to enforce constant-time tenant token validation (`timingSafeEqual` / `subtle::ConstantTimeEq`).

5. **Test Suite Verification**:
   - `cargo test --workspace` executed: 23 tests in `frostfire-exec`, 4 tests in `frostfire-tunnel`, 2 tests in `frostfire-gateway`, 14 tests in `frostfire-security`, 7 tests in `frostfire-mcp`, 6 tests in `frostfire-orchestrator`, 4 tests in security_tests, 3 tests in tool_tests. Total 63 tests pass with 0 failures.
   - `cargo clippy --workspace -- -D warnings` executed: 0 warnings.

---

## 2. Logic Chain

1. **Service Boundary**:
   - The user request and system architecture define an outbound-only reverse tunnel model.
   - Observation 1 and 2 establish that `AgentTunnelService.OpenTunnel` is the single gRPC streaming RPC connecting the outside edge (desktop Tauri app, cloud agent daemon in microVM) to `frostfire-gateway`.
   - Therefore, all communication channels—PTY interactive shells, VNC takeovers, atomic file patching, MCP tools, WebAuthn ceremonies, and LLM turn dispatches—must be multiplexed over this single bidirectional stream.

2. **Multiplexing Protocol Completeness**:
   - Observation 1 reveals that `tunnel.proto` defines 17 payloads on both client and server frames.
   - Observation 2, 3, and the daemon orchestrator (`orchestrator.rs`) demonstrate full support for terminal IO (`ExecCommand`, `TerminalOutputChunk`, `TerminalInputChunk`), atomic diffing (`ApplyPatch`, `PatchResult`), and passkey ceremonies (`WebAuthnCeremonyRequest`, `WebAuthnCeremonyResponse`).
   - Therefore, the client and gateway multiplexing schema is fully specified in protobuf and implemented in the client/daemon tracks.

3. **Security Invariant & Architectural Gap**:
   - Observation 4 quotes the invariant in `AGENTS.md` and `ORIGINAL_REQUEST.md` requiring constant-time tenant token validation (`timingSafeEqual` / `subtle::ConstantTimeEq`) on all display and session routes.
   - Observation 3 shows that while `sand-window-router.mjs` enforces this for microVM display ports, `cloud/gateway/src/service.rs` currently accepts incoming `OpenTunnel` calls without verifying `authorization` or `x-sand-window-owner`.
   - Therefore, hardening `frostfire-gateway` requires adding constant-time comparison (using `subtle::ConstantTimeEq`) against a configured tenant token before admitting the gRPC stream.

4. **Connection Resilience**:
   - Observation 2 demonstrates that `TunnelClient` already contains production-grade exponential backoff ($500\text{ ms} \to 30\text{ s}$, factor 1.5), pending frame buffering across reconnects, and periodic heartbeat ping-pong.
   - Observation 3 shows `SessionRegistry` handles reconnecting agents by atomically updating the active sender channel.
   - Therefore, connection recovery and keepalive mechanisms are structurally intact and verified by integration tests (`test_reconnect_exponential_backoff`, `test_heartbeat_ping_pong`).

---

## 3. Caveats

1. **No Implementation Undertaken**: As a Specification Miner, no source code changes were made to `frostfire-gateway` or any other crates. The implementation of gateway tenant token verification is left for the implementation phase.
2. **WebAuthn Local Bridge**: The WebAuthn proxy proto frames are fully specified and mocked in `frostfire-security`, but physical hardware security keys (FIDO2 / CTAP2) require native platform authenticator support on the client machine.
3. **AWS Infrastructure**: Production TLS 1.3 termination will occur either directly on the `frostfire-gateway` process (requiring certificate configuration) or at the AWS Network Load Balancer (NLB) layer terminating TLS and forwarding gRPC / HTTP/2 to ECS tasks.

---

## 4. Conclusion

The authoritative specifications for `frostfire-tunnel` and `frostfire-gateway` have been thoroughly discovered and documented in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2\report.md`:
1. **Contract**: `AgentTunnelService.OpenTunnel(stream TunnelClientFrame) returns (stream TunnelServerFrame)` is the single authoritative gRPC / TLS 1.3 service contract.
2. **Multiplexing**: 17 bidirectional message payloads fully cover Virtual PTY, VNC/Display Takeover, Atomic Patching, MCP, HITL Approvals, Inverted WebAuthn Passkeys, SOP Recording, and Cloud Swarm Prompting.
3. **Tenant Security Requirement**: `x-sand-window-owner` and `authorization` token validation must be performed in constant time using `subtle::ConstantTimeEq` in `frostfire-gateway` to prevent side-channel timing attacks.
4. **Resilience**: Exponential backoff reconnection, pending frame buffers, and sequence-numbered heartbeat keepalives are validated and functional.

---

## 5. Verification Method

To independently verify the facts and code state documented in this report:

1. **Verify Workspace Tests**:
   ```bash
   cargo test --workspace
   ```
   *Expected result*: All 63 tests pass across 9 crates with 0 failures.
2. **Verify Workspace Linter**:
   ```bash
   cargo clippy --workspace -- -D warnings
   ```
   *Expected result*: Exits with code 0 and 0 warnings.
3. **Inspect Protobuf Contract**:
   Inspect `crates/frostfire-proto/proto/tunnel.proto` (lines 6–35) for `OpenTunnel` and all 17 frame payloads.
4. **Inspect Constant-Time Reference Implementation**:
   Inspect `cloud/microvm/scripts/sand-window-router.mjs` (lines 24–30) for `timingSafeEqual` implementation.
5. **Inspect Tunnel Client Resilience**:
   Inspect `crates/frostfire-tunnel/src/client.rs` (lines 245–465) for backoff, pending frame buffering, and heartbeat keepalive.
