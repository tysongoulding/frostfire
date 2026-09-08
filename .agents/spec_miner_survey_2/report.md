# Comprehensive Specification Mining Report: Frostfire Client Tunnel & Ingress Gateway

**Author / Role**: Specification Miner (`spec_miner_survey_2`)  
**Date**: 2026-09-08  
**Scope**: Authoritative specifications for Frostfire desktop client tunnel, cloud gateway ingress, bidirectional multiplexing protocols, constant-time tenant token validation, and connection recovery.

---

## 1. Executive Summary & Authoritative Sources

This specification mining report establishes the definitive technical contract for the Frostfire Cloud edge ingress gateway (`frostfire-gateway`), the desktop/daemon reverse-tunnel client (`frostfire-tunnel`), and the microVM display/execution router (`sand-window-router.mjs`).

### Authoritative Specification Sources Investigated:
1. **Protobuf Interface Definition**: `c:\Users\tyson\.repo\personal\frostfire\crates\frostfire-proto\proto\tunnel.proto` and `c:\Users\tyson\.repo\personal\frostfire-cloud\crates\frostfire-proto\proto\tunnel.proto` (byte-identical, defining `AgentTunnelService.OpenTunnel`).
2. **Tunnel Client Implementation**: `c:\Users\tyson\.repo\personal\frostfire\crates\frostfire-tunnel\src\client.rs`, `error.rs`, `mock_server.rs`, and test harness `tests\tunnel_test.rs`.
3. **Gateway Ingress Implementation**: `c:\Users\tyson\.repo\personal\frostfire-cloud\cloud\gateway\src\service.rs`, `session.rs`, `server.rs`, `main.rs`, and integration test `tests\service_communication_test.rs`.
4. **MicroVM Router & Multiplexing**: `c:\Users\tyson\.repo\personal\frostfire-cloud\cloud\microvm\scripts\sand-window-router.mjs`, `start-desktop.sh`, and `patch-novnc.py`.
5. **Architectural Specification & Invariants**: `c:\Users\tyson\.repo\personal\frostfire-cloud\docs\MICROVM_ARCHITECTURE.md`, `ORIGINAL_REQUEST.md`, and workspace `AGENTS.md`.
6. **Consumer Daemons & Security Modules**: `c:\Users\tyson\.repo\personal\frostfire-cloud\crates\frostfire-daemon\src\orchestrator.rs`, `cloud\agent\src\main.rs`, `hitl.rs`, `teach.rs`, `browser.rs`, and `crates\frostfire-security\src\broker.rs`.

---

## 2. Deep Inspection 1: `AgentTunnelService.OpenTunnel` gRPC / TLS 1.3 Service Contract

### 2.1 Service Definition
From `crates/frostfire-proto/proto/tunnel.proto` (lines 5–8):
```protobuf
syntax = "proto3";
package frostfire.tunnel;

// Bidirectional streaming tunnel service connecting agents with the gateway.
service AgentTunnelService {
  rpc OpenTunnel(stream TunnelClientFrame) returns (stream TunnelServerFrame);
}
```

### 2.2 Transport & TLS 1.3 Protocol Requirements
1. **Directionality & Ingress Invariant**: Outbound-only from client/agent/microVM to Cloud Gateway. The agent inside an isolated microVM (`172.16.x.0/24` or user machine) dials outbound to the edge gateway over TCP/TLS. No incoming ports are opened on the client side.
2. **TLS 1.3 Encryption**:
   - In production, connections terminate at the Cloud Gateway (or preceding AWS Network Load Balancer / ALB with HTTP/2 end-to-end).
   - In `frostfire-tunnel/src/client.rs` (lines 470–490), TLS is configured on the `tonic::transport::Endpoint`:
     - If `server_url.starts_with("https://")`, `ClientTlsConfig::new().with_native_roots()` is enabled by default.
     - Custom TLS configurations can be injected via `TunnelConfig::with_tls_config(...)`.
     - `connect_timeout` defaults to 10s (`Duration::from_secs(10)`).
3. **HTTP/2 Transport Constraints**:
   - Must support continuous bidirectional streaming frames without request/response turn taking.
   - Initial HTTP/2 headers are exchanged prior to streaming data frames.

### 2.3 gRPC Metadata & Handshake Headers
During `open_tunnel`, the client injects metadata headers onto the gRPC `Request<ReceiverStream<TunnelClientFrame>>` (`client.rs`, lines 310–318):
- `x-agent-id`: Unique agent/daemon identifier (e.g. `daemon-<uuid>`, `prompt-test-agent`, `local-cli-agent`).
- `authorization`: Bearer token string or tenant key (e.g. `Bearer <tenant_token>`).
- Display routing header (for multi-display sub-agents): `x-sand-window-owner` and `x-sand-display`.

### 2.4 Handshake Lifecycle & Gateway Registration
1. Client establishes TCP connection & completes TLS 1.3 handshake.
2. Client invokes `AgentTunnelService.OpenTunnel`, passing `ReceiverStream<TunnelClientFrame>` and metadata headers.
3. Gateway extracts `x-agent-id` from metadata (or inspects the first client frame if header is absent; `service.rs`, lines 63–75).
4. Gateway registers the session in `SessionRegistry` with an outbound mpsc channel (`mpsc::channel(512)`), returning a `Response<Pin<Box<dyn Stream<Item = Result<TunnelServerFrame, Status>>>>`.
5. Stream enters active multiplexing loop.

---

## 3. Deep Inspection 2: Bidirectional Streaming Protocols & Multiplexing Logic

All tunnel messages are multiplexed within two top-level protobuf envelopes: `TunnelServerFrame` (Gateway -> Client) and `TunnelClientFrame` (Client -> Gateway).

### 3.1 Top-Level Frame Envelopes
Both envelopes share standard framing fields:
- `frame_id` (field 1, string): UUID v4 generated per frame.
- `timestamp_unix_ms` (field 2, int64): Millisecond UTC epoch.
- `agent_id` (field 3, string, on `TunnelClientFrame`): Originating agent identifier.
- `payload` (`oneof`): Polymorphic payload discriminating 17 specific message types.

### 3.2 Subsystem Multiplexing Breakdown

| # | Subsystem | Proto Payload Types | Frame Flow | Description & Serialization |
|---|---|---|---|---|
| 1 | **PTY / Terminal Streaming** | `ExecCommand`<br>`TerminalOutputChunk`<br>`TerminalInputChunk` | Server -> Client (`ExecCommand`)<br>Client -> Server (`TerminalOutputChunk`)<br>Server -> Client (`TerminalInputChunk`) | Bidirectional terminal multiplexing. Spawns virtual PTY sessions (`pty: true`, rows, cols). Chunks raw bytes (`data: bytes`), stderr split (`is_stderr`), EOF marker (`is_eof`), exit codes (`exit_code`), and interactive resize events (`resize: bool`). |
| 2 | **Multi-Display & VNC Routing** | `DisplayTakeoverEvent`<br>HTTP/WS Headers | Bidirectional | Supports multi-head X11/VNC routing. `DisplayTakeoverEvent` manages human-in-the-loop pause/resume (`USER_FOCUSED`, `AGENT_PAUSED`, `USER_RELEASED`, `AGENT_RESUMED`). Port 1339 window router proxies displays to `14000 + N`; port 6081 websockify proxies to `5900 + N`. |
| 3 | **Atomic File Transfers & Diff Application** | `ApplyPatch`<br>`PatchResult` | Server -> Client (`ApplyPatch`)<br>Client -> Server (`PatchResult`) | Transactional atomic file patching. Carries file path, unified diff, expected pre-condition SHA-256 (`expected_sha256`), and dry-run flag (`dry_run`). Returns `success`, `new_sha256`, lines added/removed, or error message. |
| 4 | **Tool Execution (MCP)** | `McpInvokeRequest`<br>`McpInvokeResponse` | Server -> Client (`McpInvokeRequest`)<br>Client -> Server (`McpInvokeResponse`) | Forwards Model Context Protocol (MCP) tool executions to the local machine/daemon. Contains `invocation_id`, `server_name`, `tool_name`, `arguments_json`, timeout, and returns `result_json`. |
| 5 | **Human-in-the-Loop Approvals** | `ApprovalRequest`<br>`ApprovalResponse` | Bidirectional | Enforces dual-authorization for destructive operations (e.g. `rm`, `sudo`, external egress). Contains `request_id`, `action_type`, `description`, `details_json`, `requested_by`. Returns `approved: bool`, `reason`, `approved_by`. |
| 6 | **Inverted WebAuthn Passkey Bridge** | `WebAuthnCeremonyRequest`<br>`WebAuthnCeremonyResponse` | Server -> Client (`WebAuthnCeremonyRequest`)<br>Client -> Server (`WebAuthnCeremonyResponse`) | Proxies WebAuthn hardware key ceremonies (TouchID, YubiKey, Windows Hello) from headless Chrome in the cloud microVM to the user's local machine without passing private keys into the VM. |
| 7 | **SOP Recording & Teach Sessions** | `TeachSessionCommand`<br>`TeachSessionResponse` | Server -> Client (`TeachSessionCommand`)<br>Client -> Server (`TeachSessionResponse`) | Controls in-VM screen recording and workflow compilation. Actions: `START_RECORDING`, `STOP_RECORDING`, `COMPILE_SOP`. Generates demo video (`demo.mp4`) and compiles Markdown standard operating procedures (`SOP.md`). |
| 8 | **Swarm Reasoning & Turn Dispatches** | `UserPrompt`<br>`AgentMessage` | Client -> Server (`UserPrompt`)<br>Server -> Client (`AgentMessage`) | Client submits `UserPrompt` (with prompt text, session ID, and context files). Cloud Swarm Orchestrator processes turn via Gemini/LLM without leaking API keys to the client, streaming back `AgentMessage` (with content, tool calls, `is_final`). |
| 9 | **Liveness & Health Monitoring** | `Heartbeat` | Bidirectional Ping/Pong | Sequence-numbered keepalive frame (`sequence: int64`, `timestamp_unix_ms`, `agent_id`, `is_ack: bool`). |
| 10 | **Error Notifications** | `error_frame` (string) | Bidirectional | Immediate text error description when stream processing or cloud reasoning fails. |

---

## 4. Deep Inspection 3: Constant-Time Tenant Token Validation

### 4.1 Ground-Truth Specifications
- `AGENTS.md` Invariant: *"All display routes must pass `x-sand-window-owner` token checks with constant-time comparison (`timingSafeEqual`)."*
- `ORIGINAL_REQUEST.md` Requirement R1 & Acceptance Criteria: *"All display and session routes enforce tenant token checks with constant-time comparison (`timingSafeEqual` / `subtle::ConstantTimeEq`)."*
- `docs/MICROVM_ARCHITECTURE.md` Section 3: *"Security: Verified via constant-time token comparison (`crypto.timingSafeEqual`)."*

### 4.2 Authoritative MicroVM Router Implementation (`sand-window-router.mjs`)
From `cloud/microvm/scripts/sand-window-router.mjs` (lines 7–53):
```javascript
export const SAND_BOX_DISPLAY_HEADER = "x-sand-display";
export const SAND_BOX_WINDOW_OWNER_HEADER = "x-sand-window-owner";
export const WINDOW_TOKEN_DIR = "/tmp/sand-window-tokens.d";

export function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function decideWindowRoute({ displayHeader, ownerHeader, primaryPort, execBase, lookupBoundToken }) {
  const display = parseDisplayNumber(displayHeader);
  if (display <= 1) return { port: primaryPort };
  const owner = firstHeader(ownerHeader);
  const bound = lookupBoundToken(display);
  if (bound === undefined || !tokensMatch(owner, bound)) {
    return {
      reject: {
        status: 403,
        message: `sand-window-router: forbidden (display :${display} owner-token mismatch)`,
      },
    };
  }
  return { port: execBase + display };
}
```

### 4.3 Key Observations & Architectural Gaps in Gateway
1. **MicroVM Side**: `sand-window-router.mjs` strictly enforces `timingSafeEqual` on port 1339 for secondary displays (`display > 1`). Primary display (`display <= 1`) defaults to port 1337 without token check.
2. **Gateway Ingress Gap**: In `frostfire-cloud/cloud/gateway/src/service.rs`, `GatewayTunnelService::open_tunnel` currently extracts `x-agent-id` from metadata, but does **not** validate `authorization` or `x-sand-window-owner` headers against a configured tenant secret.
3. **Rust Constant-Time Requirement**:
   To satisfy R1 and Acceptance Criteria, `frostfire-gateway` must validate tenant tokens on gRPC `open_tunnel` requests using constant-time comparison.
   - Recommended crate: `subtle::ConstantTimeEq` (e.g. `a.as_bytes().ct_eq(b.as_bytes()).into()`).
   - Mismatched tokens or missing credentials must return `Err(tonic::Status::unauthenticated("Invalid or missing tenant token"))`.

---

## 5. Deep Inspection 4: Connection Recovery, Keepalive, Reconnection & Error Handling

### 5.1 Reconnection Architecture (`frostfire-tunnel/src/client.rs`)
The client manages connection lifecycles via an autonomous background worker `run_tunnel_worker`:
1. **Exponential Backoff Formula**:
   $$\text{delay}_{n+1} = \min(\text{delay}_n \times \text{backoff\_factor}, \text{max\_reconnect\_delay})$$
   - Default initial delay: $500\text{ ms}$.
   - Default max delay: $30\text{ s}$.
   - Default backoff factor: $1.5$.
   - Max attempts: Optional (`None` = indefinite retry).
2. **Connection State Tracking**:
   - Communicated via `tokio::sync::watch::Sender<bool>`.
   - Methods `is_connected()` and `wait_connected(Duration)` allow callers to block or poll connection state.
3. **Pending Frame Buffering (Zero-Loss Guarantee)**:
   - When a connection drops during an active `send` (`conn_tx.send(frame)` fails), the failed frame is captured in `pending_frame: Option<TunnelClientFrame>`.
   - As soon as the gRPC channel is reconnected, `pending_frame.take()` is sent first before processing new incoming outbound frames (lines 352–356).
4. **Heartbeat Keepalive Ping-Pong**:
   - Interval: Configurable, default $10\text{ s}$ (`with_heartbeat_interval`).
   - Sequence: Incremented on every tick (`heartbeat_seq += 1`).
   - Client sends `TunnelClientFrame` with `Payload::Heartbeat(Heartbeat { sequence, timestamp, agent_id, is_ack: false })`.
   - Server acknowledges with `TunnelServerFrame` with `Payload::Heartbeat(Heartbeat { sequence, timestamp, agent_id, is_ack: true })`.
   - In `service.rs` (lines 76–93) and `mock_server.rs` (lines 68–84), heartbeats are auto-acknowledged immediately.
   - If a heartbeat write fails, `stream_active` is set to `false`, triggering immediate teardown and reconnect.

### 5.2 Gateway Session Management (`frostfire-gateway/src/session.rs`)
- `SessionRegistry` maintains an `Arc<RwLock<HashMap<String, (AgentSession, FrameSender)>>>`.
- **Duplicate Connections**: If an agent reconnects with an existing `agent_id`, `register` overwrites the old channel, ensuring the newest socket receives traffic.
- **Teardown**: When the client stream yields `None` (EOF) or error, the worker task calls `registry.unregister(&agent_id)`.
- **Targeted & Broadcast Messaging**:
  - `send_to_agent(&agent_id, frame)` targets a specific agent.
  - `broadcast(frame)` fans out to all active sessions.

---

## 6. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Ingress | `AgentTunnelService.OpenTunnel` | Full-duplex gRPC streaming service for outbound agent reverse tunnels | `stream TunnelClientFrame`, gRPC metadata (`x-agent-id`, `authorization`) | `stream TunnelServerFrame` | Returns `tonic::Status` on handshake failure, drops stream on network partition | `crates/frostfire-proto/proto/tunnel.proto` |
| 2 | Client | `TunnelClient::connect` | Connects gRPC tunnel and blocks until established | `TunnelConfig` (URL, agent_id, timeouts, TLS) | `Result<TunnelClient>` | Returns `TunnelError::Timeout` or `TunnelError::Transport` | `crates/frostfire-tunnel/src/client.rs:150` |
| 3 | Client | `TunnelClient::start` | Starts background reconnection worker asynchronously | `TunnelConfig` | `Result<TunnelClient>` (immediate) | Emits tracing logs on connection retry | `crates/frostfire-tunnel/src/client.rs:158` |
| 4 | Client | `TunnelHandle::wait_connected` | Awaits connected status with timeout | `Duration` | `Result<()>` | Returns `TunnelError::Timeout` or `TunnelError::ConnectionClosed` | `crates/frostfire-tunnel/src/client.rs:101` |
| 5 | Client | Frame Queueing & Pending Retry | Buffers frames during disconnect; retains failed frame across drops | `TunnelClientFrame` | Frame transmitted upon reconnect | Queues up to channel capacity (default 1024), drops oldest if capacity exceeded | `crates/frostfire-tunnel/src/client.rs:352, 401` |
| 6 | Gateway | `SessionRegistry` | Tracks active agent sessions and frame senders | `agent_id: String`, `FrameSender` | `AgentSession`, list of active agents | Returns error string if `send_to_agent` misses | `cloud/gateway/src/session.rs:17` |
| 7 | Multiplexing | Virtual PTY Session (`ExecCommand`) | Spawns command in isolated PTY or standard sub-process | Command, args, cwd, env, rows, cols, timeout | Stream of `TerminalOutputChunk` | Emits error chunk with `exit_code: -1` if jail or spawn fails | `crates/frostfire-daemon/src/orchestrator.rs:142` |
| 8 | Multiplexing | Terminal Input & Resize | Injects stdin keystrokes or terminal window dimension updates | `TerminalInputChunk` (data, resize, rows, cols) | None (applied to process PTY) | Silently drops if session ID does not exist | `crates/frostfire-daemon/src/orchestrator.rs:272` |
| 9 | Multiplexing | Atomic Patch Application (`ApplyPatch`) | Applies unified diffs atomically with SHA-256 pre-verification | File path, diff, `expected_sha256`, `dry_run` | `PatchResult` (success, lines added/removed, new hash) | Returns `PatchResult` with `success: false` and error message | `crates/frostfire-daemon/src/orchestrator.rs:284` |
| 10 | Multiplexing | MCP Tool Proxy (`McpInvokeRequest`) | Routes MCP tool calls through security allowlist | Tool name, server name, JSON args | `McpInvokeResponse` (success, JSON result) | Rejection if tool is not in allowlist | `crates/frostfire-daemon/src/orchestrator.rs:367` |
| 11 | Multiplexing | Human-in-the-Loop Approval | Requires human operator signoff for high-risk commands | `ApprovalRequest` (action type, details JSON) | `ApprovalResponse` (approved bool, reason) | Action blocked if denied | `cloud/agent/src/hitl.rs`, `daemon/orchestrator.rs:417` |
| 12 | Multiplexing | WebAuthn Inverted Passkey Ceremony | Proxies hardware security key auth from cloud VM to client | `WebAuthnCeremonyRequest` (origin, options JSON) | `WebAuthnCeremonyResponse` (credential JSON) | Returns WebAuthn error name and message | `crates/frostfire-proto/proto/tunnel.proto:178` |
| 13 | Multiplexing | Teach / SOP Recording | Records screen actions on display N and compiles SOP markdown | `TeachSessionCommand` (action, display, session_id) | `TeachSessionResponse` (SOP markdown, video path) | Emits error string in response if compilation fails | `cloud/agent/src/teach.rs:15` |
| 14 | Multiplexing | Display Takeover (`DisplayTakeoverEvent`) | Pauses/resumes AI agents when human interacts with display | Display number, action (USER_FOCUSED, USER_RELEASED) | `is_paused` atomic flag set | Agent pauses new LLM action execution | `cloud/agent/src/main.rs:242` |
| 15 | Security | Constant-Time Display Route Validation | Validates `x-sand-window-owner` header on port 1339 | Display header, owner header, bound token | Upstream proxy to `14000 + display` | HTTP 403 Forbidden on token mismatch | `cloud/microvm/scripts/sand-window-router.mjs:24` |
| 16 | Security | Constant-Time Tenant Ingress Token Validation | Verifies `authorization` / `x-sand-window-owner` on gRPC ingress | gRPC Metadata (`authorization`) | Stream admitted to gateway | `Status::unauthenticated` on mismatch | `ORIGINAL_REQUEST.md:17`, `AGENTS.md:16` |
| 17 | Testing | `MockGatewayServer` | In-process test gateway server with frame recording and disconnect simulation | Socket bind, server frames | Client frames recorded in memory, disconnect trigger | None | `crates/frostfire-tunnel/src/mock_server.rs:162` |

---

## 7. Edge Cases & Observed Behaviors

| # | Feature | Input / Condition | Observed Behavior |
|---|---------|-------------------|-------------------|
| 1 | Connection Recovery | Network severed during frame transmission | Client detects stream write failure, moves failed frame to `pending_frame`, sets `connected = false`, and backs off exponentially ($500\text{ ms} \to 30\text{ s}$). Upon reconnection, pending frame is re-sent before new frames. |
| 2 | Heartbeat Liveness | Gateway misses heartbeat or connection dies | Heartbeat send fails in client worker, immediately breaks stream loop, triggers disconnect log, and initiates reconnection backoff. |
| 3 | Token Validation | Secondary display requested with missing or mismatched `x-sand-window-owner` | `sand-window-router.mjs` rejects request with HTTP 403 Forbidden (`sand-window-router: forbidden (display :<N> owner-token mismatch)`). |
| 4 | Token Validation | Display :1 requested without owner token | `sand-window-router.mjs` allows request through to primary port 1337 without requiring token (`display <= 1`). |
| 5 | Token Validation | Empty string token or length mismatch | `tokensMatch` returns `false` immediately without calling `timingSafeEqual` (preventing Node.js Buffer length exception). |
| 6 | Workspace Jail | `ExecCommand` with `working_dir = "../../etc"` | `WorkspaceJail::validate_cwd` detects directory traversal and returns error; orchestrator intercepts error, logs to Merkle audit ledger, and returns `TerminalOutputChunk` with `exit_code: -1` and security error. |
| 7 | Environment Leakage | `ExecCommand` with `env` containing `AWS_SECRET_ACCESS_KEY` or `TOKEN` | Orchestrator sanitizes environment variables, stripping any keys matching `*TOKEN*` or `*SECRET*` before spawning child process. |
| 8 | Patch Application | `ApplyPatch` with non-matching `expected_sha256` | `AtomicPatchApplicator` aborts before disk write, returning `PatchResult` with `success: false` and error message without mutating file. |
| 9 | Duplicate Agent Session | Client reconnects with same `agent_id` after dropping socket | Gateway `SessionRegistry::register` replaces the previous sender channel with the new channel and updates `connected_at_unix_ms`. |
| 10 | Stream Teardown | Client terminates connection cleanly | Client stream sends EOF; gateway unregisters `agent_id` from `SessionRegistry` and logs disconnection. |
