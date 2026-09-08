# Handoff Report: Milestone 1 Cloud Gateway Multiplexing, TLS 1.3 & Resilience

**Agent**: `explorer_m1_2`  
**Role**: Explorer / Investigator  
**Type**: Hard Handoff (Investigation Complete)  
**Target Recipient**: Parent Orchestrator / Milestone 1 Implementer  

---

## 1. Observation

1. **Gateway TLS Configuration Missing**:
   - `cloud/gateway/Cargo.toml` lines 16–17:
     ```toml
     tokio-stream = { workspace = true }
     tonic = { workspace = true }
     prost = { workspace = true }
     ```
     `tonic` lacks `features = ["tls"]`.
   - `cloud/gateway/src/main.rs` lines 15–18 and 40–43:
     ```rust
     struct Args {
         #[arg(short, long, default_value = "0.0.0.0:50051")]
         bind: String,
     }
     ...
     Server::builder()
         .add_service(AgentTunnelServiceServer::new(service))
         .serve(addr)
         .await?;
     ```
     `Args` has no certificate or key arguments; `Server::builder()` runs strictly plaintext TCP without `ServerTlsConfig`.
   - In contrast, `crates/frostfire-tunnel/Cargo.toml` line 12:
     ```toml
     tonic = { workspace = true, features = ["tls", "tls-roots"] }
     ```
     and `crates/frostfire-tunnel/src/client.rs` lines 479–484:
     ```rust
     } else if config.server_url.starts_with("https://") {
         let tls = ClientTlsConfig::new().with_native_roots();
         endpoint
             .tls_config(tls)
             .map_err(TunnelError::Transport)?
     ```
     The client is already wired for HTTPS / TLS 1.3.

2. **17 Frame Types in Protobuf Schema**:
   - In `crates/frostfire-proto/proto/tunnel.proto` lines 15–34 and 43–62:
     Both `TunnelServerFrame` and `TunnelClientFrame` define a `oneof payload` containing:
     - 17 message payload types: `Heartbeat` (10), `ExecCommand` (11/16), `TerminalInputChunk` (12/17), `ApplyPatch` (13/18), `McpInvokeRequest` (14/19), `ApprovalResponse` (15/15), `ApprovalRequest` (16/14), `TerminalOutputChunk` (17/11), `PatchResult` (18/12), `McpInvokeResponse` (19/13), `AgentMessage` (21/27), `WebAuthnCeremonyRequest` (22/22), `WebAuthnCeremonyResponse` (23/23), `DisplayTakeoverEvent` (24/24), `TeachSessionCommand` (25/25), `TeachSessionResponse` (26/26), `UserPrompt` (27/21).
     - 1 primitive string payload: `string error_frame = 20`.
     - Total oneof payload variants: 18 (representing the 17 domain message types + error frame).

3. **Frame Buffering Capacities**:
   - `cloud/gateway/src/service.rs` line 55:
     ```rust
     let (out_tx, out_rx) = mpsc::channel(512);
     ```
   - `cloud/gateway/src/server.rs` line 47:
     ```rust
     let (client_frame_tx, client_frame_rx) = mpsc::channel(256);
     ```
   - `crates/frostfire-tunnel/src/client.rs` line 41:
     ```rust
     channel_capacity: 1024,
     ```
   - `crates/frostfire-tunnel/src/client.rs` lines 400–404:
     ```rust
     if let Err(e) = conn_tx.send(client_frame).await {
         warn!("Stream connection broken during send; buffering frame for reconnect");
         pending_frame = Some(e.0);
         stream_active = false;
     }
     ```

4. **Session Registry Reconnect Race Condition & Deadlock Vector**:
   - `cloud/gateway/src/session.rs` lines 28–43:
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
   - `cloud/gateway/src/service.rs` lines 132–134:
     ```rust
     if let Some(agent_id) = current_agent_id {
         registry.unregister(&agent_id).await;
     }
     ```
   - `cloud/gateway/src/session.rs` lines 45–55:
     ```rust
     pub async fn send_to_agent(&self, agent_id: &str, frame: TunnelServerFrame) -> Result<(), String> {
         let map = self.sessions.read().await;
         if let Some((_, sender)) = map.get(agent_id) {
             sender
                 .send(Ok(frame))
                 .await
     ```

---

## 2. Logic Chain

1. **TLS 1.3 Listener**:
   - Observation 1 demonstrates that `cloud/gateway` has no TLS dependencies or configuration flags.
   - For `frostfire-tunnel` to securely connect over `https://...` (TLS 1.3), the gateway must configure tonic's `ServerTlsConfig`.
   - Therefore, `cloud/gateway/Cargo.toml` must enable `tonic = { workspace = true, features = ["tls"] }`, and `main.rs` / `server.rs` must load certificate and private key PEM bytes into `Identity::from_pem` and supply `ServerTlsConfig::new().identity(...)` to `Server::builder().tls_config(...)`.

2. **Multiplexing All 17 Frame Types**:
   - Observation 2 establishes that `TunnelServerFrame` and `TunnelClientFrame` have 17 message types and 1 string error frame (18 variants total).
   - In `service.rs`, frames from `in_stream.message().await` are passed directly to `event_tx.send()`, and outgoing frames from `send_to_agent()` or `turn_engine` are sent directly into `out_tx`.
   - Because all frames are protobuf `oneof` variants over gRPC HTTP/2 streams, length framing and message boundaries are preserved without serialization loss or corruption.
   - Setting `tcp_nodelay(true)` on `Server::builder()` is required so interactive PTY (`TerminalInputChunk`) and stdout chunks are not delayed by Nagle's algorithm.

3. **Session Eviction Race Condition**:
   - Observation 4 shows `register` overwriting `(session, sender)` in `sessions: HashMap<String, ...>`, while `unregister` deletes by key `agent_id`.
   - When an agent drops connection C1 and immediately opens connection C2:
     - C2 calls `register(agent_id, out_tx_C2)`.
     - C1 wakes up from socket EOF and calls `unregister(agent_id)`.
     - C1 executes `map.remove(agent_id)`, which removes C2!
   - Therefore, each connection must generate a unique `session_uuid: uuid::Uuid`. `unregister_if_matching(&agent_id, session_uuid)` will compare the entry's UUID and only delete if matching, preventing the stale connection from evicting the active session.

4. **Lock Contention & Deadlock**:
   - Observation 4 shows `send_to_agent` holding `self.sessions.read().await` across `sender.send(Ok(frame)).await`.
   - If an agent's outbound buffer (512 capacity) is filled, `sender.send().await` blocks while holding the read guard.
   - A concurrent `register` or `unregister` requests `write().await`, which waits for the reader and blocks all subsequent readers.
   - The entire gateway registry deadlocks.
   - Therefore, `send_to_agent` must clone the `FrameSender` under the read lock and drop the lock *before* calling `.send().await`.

---

## 3. Caveats

1. **Certificate Generation in Automated Tests**:
   - In local developer environments and CI, valid CA-signed certificates are not available.
   - Automated TLS 1.3 integration tests must use either an in-memory self-signed certificate pair (or test PEM fixtures placed in `tests/fixtures/`) with `domain_name = "localhost"` configured on the client.
2. **Subtle Crate Division of Labor**:
   - Constant-time tenant token validation is being investigated by `explorer_m1_1`. The `open_tunnel` signature in `service.rs` will receive authentication checks from M1-1 prior to session registration.
3. **HTTP/2 Transport Keepalive vs Application Heartbeat**:
   - Application-level heartbeat (`Heartbeat` frame) operates at the session layer. Transport-level keepalive (`http2_keepalive_interval`) operates at the TCP/HTTP2 layer. Both should be enabled for defense-in-depth against silent network drops.

---

## 4. Conclusion

Milestone 1 gateway hardening requires three coordinated changes:
1. **Enable TLS 1.3**: Add `features = ["tls"]` to `tonic` in `cloud/gateway/Cargo.toml`; add CLI args `--tls-cert` and `--tls-key` in `main.rs`; add `bind_with_options` with `ServerTlsConfig` in `server.rs`.
2. **Multiplexing & Latency**: Maintain the 18-variant symmetric payload schema across client and server streams, configure `tcp_nodelay(true)` on gRPC server, and set message limit to 16MB for large patches.
3. **Session Registry Resilience**: Add `session_uuid: uuid::Uuid` to `AgentSession`, replace blind `unregister` with `unregister_if_matching(agent_id, session_uuid)`, and clone `FrameSender` to avoid holding `RwLock` across `.await`.

Full code designs and implementation snippets are documented in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_2\report.md`.

---

## 5. Verification Method

1. **Compile & Workspace Verification**:
   ```bash
   cargo check -p frostfire-gateway
   cargo test -p frostfire-gateway
   cargo clippy -p frostfire-gateway -- -D warnings
   ```
2. **Session Registry Race Condition Test**:
   - Run unit test `test_atomic_channel_replacement_preserves_new_session` in `cloud/gateway/src/session.rs`.
   - Condition for invalidation: If calling `unregister_if_matching` with an old UUID removes the entry or returns `true`, the fix is invalid.
3. **TLS 1.3 Integration Test**:
   - Run `cargo test -p frostfire-gateway --test tls_tunnel_test`.
   - Condition for invalidation: If the client handshake fails with protocol version mismatch or fails to negotiate TLS 1.3, the configuration is invalid.
4. **End-to-End Suite**:
   ```bash
   cargo test --workspace
   ```
