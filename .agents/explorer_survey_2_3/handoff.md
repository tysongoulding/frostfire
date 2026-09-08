# Handoff Report: Explorer Survey 2.3 — R4 Tauri Client Dynamic Ingress Integration

## 1. Observation

1. **Current Tunnel Implementation (`crates/frostfire-tunnel/src/client.rs`)**:
   - `TunnelConfig` (lines 15–28) accepts only a single static `server_url: String`, `agent_id: String`, and optional `auth_token: Option<String>`.
   - `create_channel` (lines 470–490) connects to a single endpoint via `Endpoint::from_shared(config.server_url.clone())`.
   - `run_tunnel_worker` (lines 246–467) maintains an infinite reconnection loop against that single URL, backing off on error.
   - Test suite `crates/frostfire-tunnel/tests/tunnel_test.rs` currently passes 4 tests (`test_bidirectional_frame_transmission`, `test_frame_multiplexing_all_types`, `test_heartbeat_ping_pong`, `test_reconnect_exponential_backoff`) in 0.22s.

2. **Current Tauri Desktop Client (`c:\Users\tyson\.repo\personal\frostfire\application\src-tauri`)**:
   - In `src-tauri/src/lib.rs` (lines 49–65), `server_url` is statically resolved at startup from `std::env::var("FROSTFIRE_SERVER_URL")` or `EC2_AGENT_HOST`, falling back to `"http://44.242.94.86:50051"`.
   - `TunnelClient::start(tunnel_config)` is invoked once at launch. The client is split via `tunnel.split()`, moving `inbound_rx` into a spawned task (lines 136–221).
   - In `src-tauri/src/commands.rs` (lines 26–38), `AppState` holds `tunnel_tx: tokio::sync::mpsc::Sender<TunnelClientFrame>` and `tunnel_handle: Arc<RwLock<Option<TunnelHandle>>>`.
   - Only `get_tunnel_status` (lines 2698–2708) is exposed to query connectivity. No commands exist to query endpoint configurations, test candidate endpoints, update tokens, or hot-switch modes.

3. **Cloud Ingress & Authentication (`cloud/gateway/src/`)**:
   - `cloud/gateway/src/auth.rs` (lines 20–57) implements `TenantAuthenticator` using constant-time comparison:
     ```rust
     let candidate_hash: [u8; 32] = Sha256::digest(candidate.as_bytes()).into();
     let ct_result = self.expected_token_hash.ct_eq(&candidate_hash);
     ct_result.into()
     ```
   - Headers inspected (lines 68–86): `authorization: Bearer <token>` and `x-sand-window-owner: <token>`.

4. **Lambda MicroVM Infrastructure (`deploy/aws/lambda-microvm.yaml` & `cloud/agent/Dockerfile.lambda`)**:
   - `deploy/aws/lambda-microvm.yaml` provisions an AWS Lambda container function with `AgentFunctionUrl` (`InvokeMode: RESPONSE_STREAM`, `AuthType: NONE` or `AWS_IAM`).
   - `cloud/agent/Dockerfile.lambda` incorporates AWS Lambda Web Adapter (`public.ecr.aws/awsgsl/aws-lambda-adapter:0.9.0`), listening on `PORT: "8080"` with `AWS_LWA_INVOKE_MODE: response_stream` and 15-minute read timeout.

5. **Protobuf Discrepancy**:
   - `frostfire/crates/frostfire-proto/proto/tunnel.proto` defines `BlackboardSyncFrame` (field 28) and `DagSyncFrame` (field 29) on both client and server frames.
   - `frostfire-cloud/crates/frostfire-proto/proto/tunnel.proto` lacks fields 28 and 29.

---

## 2. Logic Chain

1. From Observation 1 and Observation 2, `frostfire-tunnel` and `src-tauri` are currently coupled to a single static endpoint URL established at boot time.
2. If a user switches between Local Daemon mode (`localhost:50051`), Cloud Gateway mode (`https://gateway:50051`), and Cloud Lambda mode (`https://*.lambda-url.*.on.aws/`), the current architecture requires killing the application process because `inbound_rx` is tied to a single channel that closes when the stream drops.
3. Therefore, a dynamic session supervisor (`DynamicTunnelClient`) is required. This supervisor maintains persistent application channels (`app_tx`, `app_rx`) for background tasks (Blackboard sync, DAG sync, UI commands) while dynamically multiplexing to an active underlying transport worker.
4. From Observation 3 and Observation 4, switching to Cloud Gateway requires constant-time verified tenant tokens (`x-sand-window-owner` / `authorization: Bearer`), while switching to Cloud Lambda Function URLs requires AWS IAM SigV4 request signing or pre-signed URLs.
5. Therefore, `frostfire-tunnel` must incorporate an `AuthConfig` abstraction supporting `Anonymous`, `TenantToken`, `PreSignedHmac`, and `AwsIam` (SigV4).
6. In-memory tokens must be zeroized (`zeroize::ZeroizeOnDrop`) and backed by the OS keyring (`keyring-rs`), preventing credential leakage.
7. From Observation 5, to prevent serialization and decoding errors when syncing blackboard and DAG state through the tunnel, `frostfire-cloud`'s `tunnel.proto` must be synchronized with `frostfire`'s `tunnel.proto`.

---

## 3. Caveats

1. AWS Lambda Function URLs natively support HTTP chunked response streaming (`RESPONSE_STREAM`), but do not support full-duplex HTTP/2 gRPC bidirectional streaming directly across the Function URL boundary without buffering requests or using WebSockets/SSE. For direct Lambda streaming, the client tunnel can use framed HTTP streaming POST or route via Cloud Gateway.
2. Keyring availability: headless or CI environments without a graphical keyring manager (e.g. Linux without Secret Service/D-Bus) fallback to in-memory volatile keystore.
3. No code in `frostfire` or `frostfire-cloud` source trees was modified during this survey, strictly adhering to the read-only explorer constraint.

---

## 4. Conclusion

R4 (Tauri Client Dynamic Ingress Integration) is fully specified and ready for implementation. The comprehensive architecture and implementation details are documented in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_2_3\report.md`.

Key deliverables specified:
- **`DynamicTunnelClient` & `TunnelSessionManager`** in `crates/frostfire-tunnel`: enables zero-downtime hot-switching between Local Daemon (`localhost:50051`), Cloud Gateway (`gateway:50051`), and Cloud Lambda MicroVM (`lambda-url`).
- **Authentication Engine**: constant-time tenant token validation (`subtle::ConstantTimeEq`), HMAC-SHA256 pre-signed token generation, and lightweight AWS SigV4 signer.
- **Tauri IPC Command Suite**: `get_ingress_status`, `get_ingress_config`, `switch_ingress_mode`, `test_ingress_endpoint`, `set_ingress_credentials`, `reconnect_ingress`.
- **Proto Synchronization**: add fields 28 (`BlackboardSyncFrame`) and 29 (`DagSyncFrame`) to `frostfire-cloud/crates/frostfire-proto/proto/tunnel.proto`.

---

## 5. Verification Method

To independently verify the findings and validate the forthcoming implementation:
1. **Existing Baseline Verification**:
   ```bash
   cargo test -p frostfire-tunnel
   cargo check --workspace
   cargo check --manifest-path "c:\Users\tyson\.repo\personal\frostfire\application\src-tauri\Cargo.toml"
   ```
   All commands exit with code 0.
2. **Specification Inspection**:
   Inspect `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_2_3\report.md` for complete API signatures, data contracts, and unit test designs.
3. **Future Implementation Verification**:
   - Run `cargo test -p frostfire-tunnel --test dynamic_test` once implemented.
   - Validate that switching endpoints does not panic and successfully delivers buffered frames.
   - Run `cargo clippy --workspace -- -D warnings` to guarantee clean quality gates.
