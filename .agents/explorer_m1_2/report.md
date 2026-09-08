# Milestone 1 Deep-Dive Investigation Report: Cloud Gateway Hardening, Multiplexing, TLS 1.3 & Resilience

**Author**: Explorer Agent (`explorer_m1_2`)  
**Date**: 2026-09-08  
**Scope**: Milestone 1 (Cloud Gateway Hardening & Tenant Auth) — Specifically focusing on:
1. TLS 1.3 Server Listener Configuration in `cloud/gateway`
2. Multiplexed 17-Frame Streaming Support, Payload Schema & Buffering
3. Connection Recovery, Heartbeat Keepalive, and Atomic Channel Swaps in `SessionRegistry`

---

## 1. Executive Summary

This report establishes the implementation architecture and concrete code designs for hardening the Frostfire Cloud edge gateway (`frostfire-gateway`). 

### Core Findings & Action Items:
1. **TLS 1.3 Ingress Gap**:
   - `cloud/gateway/Cargo.toml` specifies `tonic = { workspace = true }` without the `tls` feature flag, making `tonic::transport::ServerTlsConfig` and `Identity` unavailable.
   - `cloud/gateway/src/main.rs` and `src/server.rs` only support plaintext TCP listeners via `Server::builder().serve(addr)`.
   - `crates/frostfire-tunnel/src/client.rs` already features full TLS client configuration via `ClientTlsConfig::new().with_native_roots()`.
   - **Remediation**: Add `features = ["tls"]` to `tonic` in `cloud/gateway/Cargo.toml`, add `--tls-cert` and `--tls-key` CLI options (with `FROSTFIRE_TLS_CERT` and `FROSTFIRE_TLS_KEY` env var fallbacks) to `main.rs`, and add `bind_tls` / `bind_with_options` to `server.rs`.
2. **Multiplexed 17-Frame Streaming**:
   - Both `TunnelServerFrame` and `TunnelClientFrame` in `crates/frostfire-proto/proto/tunnel.proto` define a symmetric polymorphic `oneof payload` containing 17 structured message types (1. `Heartbeat`, 2. `ExecCommand`, 3. `TerminalInputChunk`, 4. `ApplyPatch`, 5. `McpInvokeRequest`, 6. `ApprovalResponse`, 7. `ApprovalRequest`, 8. `TerminalOutputChunk`, 9. `PatchResult`, 10. `McpInvokeResponse`, 11. `AgentMessage`, 12. `WebAuthnCeremonyRequest`, 13. `WebAuthnCeremonyResponse`, 14. `DisplayTakeoverEvent`, 15. `TeachSessionCommand`, 16. `TeachSessionResponse`, 17. `UserPrompt`) plus a primitive string payload variant (18. `error_frame`).
   - The gateway streams these via gRPC HTTP/2 DATA frames without corruption. Protobuf framing enforces message boundary integrity.
   - Channel capacities: `out_tx` (512), `client_frame_tx` (256), client `channel_capacity` (1024).
3. **Session Registry Race Condition & Atomic Channel Swaps**:
   - **Critical Defect**: In `cloud/gateway/src/session.rs`, `register` inserts `(AgentSession, FrameSender)` into `HashMap<String, ...>`, and `unregister` removes solely by `&str agent_id`. When a network blip occurs and a client reconnects rapidly, Connection 2 registers *before* Connection 1 finishes unwinding. Connection 1 then calls `registry.unregister(&agent_id)`, purging the brand new Connection 2 from the registry.
   - **Lock Contention Defect**: In `send_to_agent`, the `RwLock` read guard is held across `.send().await`. A slow or blocked client holds the read lock, causing all subsequent write locks (`register`/`unregister`) to block, which in turn blocks all readers—deadlocking the entire gateway.
   - **Remediation**: Session versioning via `session_uuid: uuid::Uuid` with `unregister_if_matching`, and cloning `FrameSender` under read lock prior to `.await`.

---

## 2. Deep Dive: TLS 1.3 Server Configuration in `cloud/gateway`

### 2.1 Current Architecture & Code Review
In `cloud/gateway/Cargo.toml` (lines 12–28):
```toml
[dependencies]
frostfire-proto = { workspace = true }
tokio = { workspace = true }
tokio-stream = { workspace = true }
tonic = { workspace = true }
prost = { workspace = true }
```
`tonic` is imported without `features = ["tls"]`. Without this feature:
- `tonic::transport::ServerTlsConfig` does not exist.
- `tonic::transport::Identity` does not exist.
- `Server::builder().tls_config(...)` is unavailable.

In `cloud/gateway/src/main.rs` (lines 12–46):
```rust
#[derive(Parser, Debug)]
#[command(name = "frostfire-gateway")]
struct Args {
    #[arg(short, long, default_value = "0.0.0.0:50051")]
    bind: String,
}
```
There are no arguments or environment hooks for TLS certificate or private key paths.
The server simply runs:
```rust
Server::builder()
    .add_service(AgentTunnelServiceServer::new(service))
    .serve(addr)
    .await?;
```
This is strictly a plaintext HTTP/2 (`h2c`) gRPC server.

In `crates/frostfire-tunnel/src/client.rs` (lines 470–490):
```rust
async fn create_channel(config: &TunnelConfig) -> Result<Channel> {
    let endpoint = Endpoint::from_shared(config.server_url.clone())
        .map_err(|e| TunnelError::Config(format!("Invalid server URL '{}': {}", config.server_url, e)))?
        .connect_timeout(config.connect_timeout);

    let endpoint = if let Some(ref tls) = config.tls_config {
        endpoint
            .tls_config(tls.clone())
            .map_err(TunnelError::Transport)?
    } else if config.server_url.starts_with("https://") {
        let tls = ClientTlsConfig::new().with_native_roots();
        endpoint
            .tls_config(tls)
            .map_err(TunnelError::Transport)?
    } else {
        endpoint
    };

    let channel = endpoint.connect().await?;
    Ok(channel)
}
```
When `frostfire-tunnel` connects to an `https://...` address, it expects TLS 1.3 / modern TLS encryption.

### 2.2 TLS 1.3 Transport Specification & Rustls Invariants
- **Engine**: Tonic uses `rustls` (via `tokio-rustls`).
- **Protocol Version**: Rustls explicitly does not implement legacy protocols (SSLv2, SSLv3, TLS 1.0, TLS 1.1). By default, it negotiates TLS 1.3 (with TLS 1.2 fallback for older clients).
- **Supported Cipher Suites (TLS 1.3)**:
  - `TLS13_AES_256_GCM_SHA384`
  - `TLS13_AES_128_GCM_SHA256`
  - `TLS13_CHACHA20_POLY1305_SHA256`
- **ALPN**: Automatic configuration of `h2` (HTTP/2) for gRPC stream negotiation.
- **Mutual TLS (mTLS)**: Optional client certificate verification via `.client_ca_root(...)` if tenant client certificates are introduced.

### 2.3 Required Code Changes

#### 1. Update `cloud/gateway/Cargo.toml`
```toml
[dependencies]
tonic = { workspace = true, features = ["tls"] }
```

#### 2. Update `cloud/gateway/src/main.rs`
```rust
use std::path::PathBuf;
use tonic::transport::{Identity, Server, ServerTlsConfig};

#[derive(Parser, Debug)]
#[command(name = "frostfire-gateway")]
#[command(about = "Frostfire Edge Cloud Gateway: Ingress control plane for agent daemons")]
struct Args {
    #[arg(short, long, default_value = "0.0.0.0:50051", env = "FROSTFIRE_BIND")]
    bind: String,

    #[arg(long, env = "FROSTFIRE_TLS_CERT")]
    tls_cert: Option<PathBuf>,

    #[arg(long, env = "FROSTFIRE_TLS_KEY")]
    tls_key: Option<PathBuf>,

    #[arg(long, env = "FROSTFIRE_TENANT_TOKEN")]
    tenant_token: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = Args::parse();
    // ... tracing setup ...
    let addr: SocketAddr = args.bind.parse()?;
    let registry = Arc::new(SessionRegistry::new());
    let gemini = Arc::new(GeminiClient::from_env());
    let turn_engine = Arc::new(AgentTurnEngine::new(gemini));
    let service = GatewayTunnelService::new(registry.clone(), None)
        .with_turn_engine(turn_engine);

    info!("🚀 Frostfire Cloud Gateway starting on {}", addr);

    let mut server_builder = Server::builder()
        .tcp_nodelay(true)
        .http2_keepalive_interval(Some(std::time::Duration::from_secs(30)))
        .http2_keepalive_timeout(Some(std::time::Duration::from_secs(10)));

    if let (Some(cert_path), Some(key_path)) = (args.tls_cert, args.tls_key) {
        info!("Enabling TLS 1.3 on gateway listener using cert: {:?}", cert_path);
        let cert_pem = tokio::fs::read(&cert_path).await?;
        let key_pem = tokio::fs::read(&key_path).await?;
        let identity = Identity::from_pem(cert_pem, key_pem);
        let tls_config = ServerTlsConfig::new().identity(identity);
        server_builder = server_builder.tls_config(tls_config)?;
    } else {
        info!("Starting gateway in plaintext mode (TLS disabled)");
    }

    server_builder
        .add_service(AgentTunnelServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
```

#### 3. Update `cloud/gateway/src/server.rs`
Add `bind_with_options` to allow programmatic binding with TLS config for integration tests:
```rust
impl GatewayServerHandle {
    pub async fn bind_with_options(
        addr_str: &str,
        turn_engine: Option<Arc<AgentTurnEngine>>,
        tls_config: Option<tonic::transport::ServerTlsConfig>,
    ) -> Result<Self, anyhow::Error> {
        let listener = tokio::net::TcpListener::bind(addr_str).await?;
        let addr = listener.local_addr()?;
        let stream = TcpListenerStream::new(listener);
        let is_tls = tls_config.is_some();

        let registry = Arc::new(SessionRegistry::new());
        let (client_frame_tx, client_frame_rx) = mpsc::channel(256);
        let mut service = GatewayTunnelService::new(registry.clone(), Some(client_frame_tx));
        if let Some(engine) = turn_engine {
            service = service.with_turn_engine(engine);
        }

        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

        tokio::spawn(async move {
            let mut builder = Server::builder()
                .tcp_nodelay(true)
                .http2_keepalive_interval(Some(std::time::Duration::from_secs(30)))
                .http2_keepalive_timeout(Some(std::time::Duration::from_secs(10)));

            if let Some(tls) = tls_config {
                if let Ok(b) = builder.tls_config(tls) {
                    builder = b;
                }
            }

            let _ = builder
                .add_service(AgentTunnelServiceServer::new(service))
                .serve_with_incoming_shutdown(stream, async move {
                    let _ = shutdown_rx.changed().await;
                })
                .await;
        });

        Ok(Self {
            addr,
            is_tls,
            registry,
            client_frame_rx: Arc::new(Mutex::new(client_frame_rx)),
            shutdown_tx,
        })
    }

    pub fn url(&self) -> String {
        let scheme = if self.is_tls { "https" } else { "http" };
        format!("{}://{}", scheme, self.addr)
    }
}
```

---

## 3. Deep Dive: Multiplexed 17 Frame Streaming Support & Buffering

### 3.1 Protobuf Payload Specifications
In `crates/frostfire-proto/proto/tunnel.proto`:
- `TunnelServerFrame` (Gateway -> Client)
- `TunnelClientFrame` (Client -> Gateway)

Each frame shares the metadata envelope:
- `frame_id`: UUID v4 string.
- `timestamp_unix_ms`: int64 epoch time in milliseconds.
- `agent_id`: string (present on client frame).
- `payload`: `oneof` discriminator.

#### Complete 18-Variant Symmetric Payload Matrix

| # | Proto Payload Variant | Server Tag | Client Tag | Associated Message Type | Directionality | Description |
|---|-----------------------|------------|------------|-------------------------|----------------|-------------|
| 1 | `heartbeat` | 10 | 10 | `Heartbeat` | Bidirectional | Ping/Pong keepalive frame (`sequence`, `timestamp_unix_ms`, `agent_id`, `is_ack`). |
| 2 | `exec_command` | 11 | 16 | `ExecCommand` | Server -> Client (or nested) | Spawns command or interactive PTY session (`command`, `args`, `working_dir`, `pty`, rows, cols). |
| 3 | `terminal_input` | 12 | 17 | `TerminalInputChunk` | Bidirectional | Interactive keystrokes (`data: bytes`), EOF flag (`is_eof`), or PTY window resize events. |
| 4 | `apply_patch` | 13 | 18 | `ApplyPatch` | Server -> Client | Transactional unified diff application (`file_path`, `diff`, `expected_sha256`, `dry_run`). |
| 5 | `mcp_request` | 14 | 19 | `McpInvokeRequest` | Server -> Client | Model Context Protocol tool execution (`server_name`, `tool_name`, `arguments_json`). |
| 6 | `approval_response` | 15 | 15 | `ApprovalResponse` | Bidirectional | Human-in-the-loop grant or denial (`request_id`, `approved: bool`, `reason`, `approved_by`). |
| 7 | `approval_request` | 16 | 14 | `ApprovalRequest` | Bidirectional | Human-in-the-loop authorization trigger (`action_type`, `description`, `details_json`). |
| 8 | `terminal_output` | 17 | 11 | `TerminalOutputChunk` | Client -> Server | Streamed stdout/stderr chunk (`data: bytes`, `is_stderr`, `is_eof`, `exit_code`). |
| 9 | `patch_result` | 18 | 12 | `PatchResult` | Client -> Server | Atomic patch application outcome (`success: bool`, `new_sha256`, lines added/removed). |
| 10 | `mcp_response` | 19 | 13 | `McpInvokeResponse` | Client -> Server | MCP execution output (`invocation_id`, `success: bool`, `result_json`, `error_message`). |
| 11 | `error_frame` | 20 | 20 | `string` (primitive) | Bidirectional | Fatal stream or processing error notification. |
| 12 | `agent_message` | 21 | 27 | `AgentMessage` | Server -> Client | LLM reasoning response (`turn_id`, `content`, `tool_calls`, `is_final`). |
| 13 | `webauthn_request` | 22 | 22 | `WebAuthnCeremonyRequest` | Server -> Client | Inverted Passkey ceremony request (`ceremony_id`, `kind`, `origin`, `options_json`). |
| 14 | `webauthn_response` | 23 | 23 | `WebAuthnCeremonyResponse` | Client -> Server | Hardware security key assertion/attestation (`credential_json`, `error_name`). |
| 15 | `display_takeover` | 24 | 24 | `DisplayTakeoverEvent` | Bidirectional | Human interaction pause/resume (`USER_FOCUSED`, `AGENT_PAUSED`, `USER_RELEASED`, etc.). |
| 16 | `teach_command` | 25 | 25 | `TeachSessionCommand` | Server -> Client | Workflow recording & SOP compilation (`START_RECORDING`, `STOP_RECORDING`, `COMPILE_SOP`). |
| 17 | `teach_response` | 26 | 26 | `TeachSessionResponse` | Client -> Server | Output SOP Markdown (`sop_markdown`) and recording video path (`video_path`). |
| 18 | `user_prompt` | 27 | 21 | `UserPrompt` | Client -> Server | Client prompt input to cloud orchestrator (`text`, `session_id`, `context_files`). |

*Note: The user specification references "17 frame types" denoting the 17 structured domain message types, with `error_frame` serving as the 18th string payload variant.*

### 3.2 Gateway Frame Routing & Zero Dropping
In `cloud/gateway/src/service.rs`:
```rust
while let Ok(Some(client_frame)) = in_stream.message().await {
    let agent_id = client_frame.agent_id.clone();
    
    // 1. Heartbeat auto-reply
    if let Some(tunnel::tunnel_client_frame::Payload::Heartbeat(ref hb)) = client_frame.payload {
        if !hb.is_ack {
            let ack_frame = TunnelServerFrame { ... };
            let _ = out_tx.send(Ok(ack_frame)).await;
        }
    }

    // 2. Forward to event_tx
    if let Some(ref tx) = event_tx {
        let _ = tx.send(client_frame.clone()).await;
    }

    // 3. UserPrompt handling via turn_engine
    if let Some(tunnel::tunnel_client_frame::Payload::UserPrompt(ref prompt)) = client_frame.payload { ... }
}
```
Every incoming client frame variant is forwarded to `event_tx` without dropping.
For outbound traffic, `SessionRegistry::send_to_agent(agent_id, frame)` and `broadcast(frame)` accept any valid `TunnelServerFrame` payload.

### 3.3 Buffering, Capacities and Flow Control
1. **Outbound Stream Buffer (`out_tx`)**:
   - Initialized at `mpsc::channel(512)` (`service.rs:55`).
   - Sized for high throughput burst traffic (such as dense `TerminalOutputChunk` bursts or large `ApplyPatch` diffs).
2. **Event Queue Buffer (`client_frame_tx`)**:
   - Initialized at `mpsc::channel(256)` (`server.rs:47`).
3. **Client Queue Buffer (`TunnelClient`)**:
   - Channel capacity defaults to `1024` (`client.rs:41`).
   - When disconnected, up to 1024 client frames are safely buffered in memory.
4. **Message Sizing**:
   - Default gRPC maximum message size is 4MB.
   - For large unified diffs or deep context prompts, `AgentTunnelServiceServer::new(service).max_decoding_message_size(16 * 1024 * 1024).max_encoding_message_size(16 * 1024 * 1024)` should be set to allow up to 16MB payloads.
5. **Nagle Disabling (`tcp_nodelay = true`)**:
   - Keystrokes (`TerminalInputChunk`) and interactive ANSI escapes must not be delayed by TCP packet accumulation algorithms. Enabling `tcp_nodelay` on both the client `Endpoint` and the gateway `Server::builder()` eliminates 40ms input latency.

---

## 4. Deep Dive: Connection Recovery, Heartbeat Keepalive & Session Registry

### 4.1 Client Reconnection & Pending Frame Retention
In `crates/frostfire-tunnel/src/client.rs` (lines 253–465):
1. **Exponential Backoff**:
   - Default: initial 500ms, max 30s, factor 1.5.
   - Calculation: `current_delay = (current_delay.mul_f64(config.backoff_factor)).min(config.max_reconnect_delay);`
2. **Pending Frame Recovery (Zero Loss Guarantee)**:
   - When connection drops mid-send:
     ```rust
     if let Err(e) = conn_tx.send(client_frame).await {
         pending_frame = Some(e.0);
         stream_active = false;
     }
     ```
   - Immediately upon reconnecting:
     ```rust
     if let Some(frame) = pending_frame.take() {
         if let Err(e) = conn_tx.send(frame).await {
             pending_frame = Some(e.0);
         }
     }
     ```
   - Then the `outbound_rx` channel drains all queued frames in exact chronological sequence.

### 4.2 Heartbeat Keepalive Ping-Pong
- **Frequency**: Configurable, default 10s (`TunnelConfig::with_heartbeat_interval`).
- **Ping**: Client sends `TunnelClientFrame` with `Payload::Heartbeat(Heartbeat { sequence: seq++, timestamp_unix_ms, agent_id, is_ack: false })`.
- **Pong**: Server responds immediately with `TunnelServerFrame` with `Payload::Heartbeat(Heartbeat { sequence, timestamp_unix_ms: now, agent_id, is_ack: true })`.
- **Failure Detection**:
  - If client write fails: stream breaks immediately, triggering reconnect.
  - If gateway detects idle socket: HTTP/2 keepalive pings (`http2_keepalive_interval(Duration::from_secs(30))`) detect silent half-open TCP connections.

### 4.3 Flaws Identified in `SessionRegistry` and Atomic Remediation

#### Flaw 1: Session Eviction Race Condition
Look at `cloud/gateway/src/session.rs` (lines 28–43):
```rust
pub async fn register(&self, agent_id: String, sender: FrameSender) {
    let session = AgentSession {
        agent_id: agent_id.clone(),
        connected_at_unix_ms: chrono::Utc::now().timestamp_millis(),
    };
    let mut map = self.sessions.write().await;
    map.insert(agent_id, (session, sender));
}

pub async fn unregister(&self, agent_id: &str) {
    let mut map = self.sessions.write().await;
    map.remove(agent_id);
}
```
And in `cloud/gateway/src/service.rs` (lines 61–135):
```rust
tokio::spawn(async move {
    if let Some(ref agent_id) = current_agent_id {
        registry.register(agent_id.clone(), out_tx.clone()).await;
    }
    while let Ok(Some(client_frame)) = in_stream.message().await { ... }

    // Client stream ended, unregister
    if let Some(agent_id) = current_agent_id {
        registry.unregister(&agent_id).await;
    }
});
```

**Failure Execution Trace**:
1. Client establishes Connection C1 (`agent-1`).
2. Network partition occurs. C1 freezes.
3. Client reconnects immediately on Connection C2 (`agent-1`).
4. Gateway accepts C2 and invokes `registry.register("agent-1", sender_C2)`. Entry in map is replaced with C2.
5. C1's Tokio task finally receives TCP RST/EOF, breaks its loop, and calls `registry.unregister("agent-1")`.
6. `map.remove("agent-1")` runs, **deleting the active Connection C2** from the registry!
7. Any subsequent command routed via `registry.send_to_agent("agent-1", ...)` fails with `"Agent session not found"` until the client reconnects again.

#### Flaw 2: Lock Contention & Gateway Deadlock
In `cloud/gateway/src/session.rs` (lines 45–55):
```rust
pub async fn send_to_agent(&self, agent_id: &str, frame: TunnelServerFrame) -> Result<(), String> {
    let map = self.sessions.read().await;
    if let Some((_, sender)) = map.get(agent_id) {
        sender
            .send(Ok(frame))
            .await // <-- AWAIT HELD UNDER READ LOCK!
            .map_err(...)
```
If an agent's buffer (512 frames) fills up because the agent is slow or unresponsive, `sender.send(...).await` blocks while holding the `read()` lock on `sessions`.
In Tokio `RwLock`, a pending write request blocks subsequent read requests. If any other agent connects or disconnects (requesting a `write()` lock), that write request queues up, blocking all other readers. The entire gateway session registry stalls!

### 4.4 Hardened `SessionRegistry` Implementation
To solve both flaws, session registrations must carry a unique `session_uuid: uuid::Uuid`, and `FrameSender` must be cloned under the lock and awaited *outside* the lock:

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{info, warn};
use uuid::Uuid;

use frostfire_proto::tunnel::TunnelServerFrame;

type FrameSender = mpsc::Sender<Result<TunnelServerFrame, tonic::Status>>;

#[derive(Debug, Clone)]
pub struct AgentSession {
    pub agent_id: String,
    pub session_uuid: Uuid,
    pub connected_at_unix_ms: i64,
}

#[derive(Default)]
pub struct SessionRegistry {
    sessions: Arc<RwLock<HashMap<String, (AgentSession, FrameSender)>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Atomically registers or replaces an agent session.
    pub async fn register(&self, agent_id: String, session_uuid: Uuid, sender: FrameSender) {
        let session = AgentSession {
            agent_id: agent_id.clone(),
            session_uuid,
            connected_at_unix_ms: chrono::Utc::now().timestamp_millis(),
        };
        let mut map = self.sessions.write().await;
        info!(
            agent_id = %agent_id,
            session_uuid = %session_uuid,
            "Agent tunnel session registered in gateway"
        );
        map.insert(agent_id, (session, sender));
    }

    /// Unregisters the session ONLY if the session_uuid matches the currently active session.
    /// This prevents an unwinding stale connection from evicting a reconnected active session.
    pub async fn unregister_if_matching(&self, agent_id: &str, session_uuid: Uuid) -> bool {
        let mut map = self.sessions.write().await;
        if let Some((session, _)) = map.get(agent_id) {
            if session.session_uuid == session_uuid {
                map.remove(agent_id);
                info!(
                    agent_id = %agent_id,
                    session_uuid = %session_uuid,
                    "Agent tunnel session cleanly unregistered from gateway"
                );
                return true;
            } else {
                info!(
                    agent_id = %agent_id,
                    stale_uuid = %session_uuid,
                    active_uuid = %session.session_uuid,
                    "Ignored unregister from superseded connection"
                );
            }
        }
        false
    }

    /// Sends a frame to a specific agent without holding the RwLock across the async send.
    pub async fn send_to_agent(&self, agent_id: &str, frame: TunnelServerFrame) -> Result<(), String> {
        let sender = {
            let map = self.sessions.read().await;
            map.get(agent_id).map(|(_, s)| s.clone())
        };

        if let Some(sender) = sender {
            sender
                .send(Ok(frame))
                .await
                .map_err(|e| format!("Failed to send frame to agent {}: {}", agent_id, e))
        } else {
            Err(format!("Agent session not found for id: {}", agent_id))
        }
    }

    /// Broadcasts a frame to all active agents without holding the lock during transmission.
    pub async fn broadcast(&self, frame: TunnelServerFrame) {
        let senders: Vec<(String, FrameSender)> = {
            let map = self.sessions.read().await;
            map.iter().map(|(id, (_, s))| (id.clone(), s.clone())).collect()
        };

        for (agent_id, sender) in senders {
            if let Err(e) = sender.send(Ok(frame.clone())).await {
                warn!(agent_id = %agent_id, error = %e, "Broadcast failed to agent");
            }
        }
    }

    pub async fn active_agents(&self) -> Vec<AgentSession> {
        let map = self.sessions.read().await;
        map.values().map(|(s, _)| s.clone()).collect()
    }

    pub async fn is_connected(&self, agent_id: &str) -> bool {
        let map = self.sessions.read().await;
        map.contains_key(agent_id)
    }
}
```

And in `cloud/gateway/src/service.rs`:
```rust
let session_uuid = uuid::Uuid::new_v4();

tokio::spawn(async move {
    let mut current_agent_id = metadata_agent_id;
    if let Some(ref agent_id) = current_agent_id {
        registry.register(agent_id.clone(), session_uuid, out_tx.clone()).await;
    }

    while let Ok(Some(client_frame)) = in_stream.message().await {
        let agent_id = client_frame.agent_id.clone();
        if current_agent_id.is_none() && !agent_id.is_empty() {
            current_agent_id = Some(agent_id.clone());
            registry.register(agent_id.clone(), session_uuid, out_tx.clone()).await;
        }
        // ... frame dispatch ...
    }

    // Atomic unregister
    if let Some(agent_id) = current_agent_id {
        registry.unregister_if_matching(&agent_id, session_uuid).await;
    }
});
```

---

## 5. Verification & Testing Strategy for Implementer

### 5.1 Unit Tests for `SessionRegistry`
Location: `cloud/gateway/src/session.rs` (in `mod tests`)
1. `test_atomic_channel_replacement_preserves_new_session`:
   - Register Agent `A` with `uuid_1` and channel `tx_1`.
   - Register Agent `A` with `uuid_2` and channel `tx_2`.
   - Call `unregister_if_matching("A", uuid_1)` -> returns `false`.
   - Verify `is_connected("A")` is still `true`.
   - Call `send_to_agent("A", frame)` -> verify received on `rx_2`, not `rx_1`.
   - Call `unregister_if_matching("A", uuid_2)` -> returns `true`.
   - Verify `is_connected("A")` is now `false`.
2. `test_send_to_agent_does_not_deadlock_on_full_channel`:
   - Set up channel capacity 1. Send frame to fill buffer.
   - Verify concurrent `register` or `unregister` can still acquire write lock and progress without deadlock.

### 5.2 Integration Tests for TLS 1.3
Location: `cloud/gateway/tests/tls_tunnel_test.rs`
1. Test in-memory self-signed certificate generation (or pre-generated PEM test fixture):
   - Server binds with `ServerTlsConfig::new().identity(identity)`.
   - Client connects with `ClientTlsConfig::new().ca_certificate(ca_cert).domain_name("localhost")`.
   - Send `ExecCommand` and receive `TerminalOutputChunk`.
   - Verify connection succeeds over HTTPS/TLS 1.3.
   - Verify connection without CA certificate fails with TLS handshake error.

### 5.3 Multiplexing 17-Frame Verification
Location: `cloud/gateway/tests/service_communication_test.rs`
- Expand test coverage to stream all remaining frame types:
  - `ApprovalRequest` / `ApprovalResponse`
  - `WebAuthnCeremonyRequest` / `WebAuthnCeremonyResponse`
  - `TeachSessionCommand` / `TeachSessionResponse`
  - `DisplayTakeoverEvent`
  - `error_frame`
- Assert that none of the frames are dropped and all payloads decode with byte-exact fidelity.
