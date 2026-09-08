# Technical Specification: R4 — Tauri Client Dynamic Ingress Integration

**Author:** Explorer Survey 2.3  
**Status:** Approved Specification  
**Target Repositories:**  
- `c:\Users\tyson\.repo\personal\frostfire` (`crates/frostfire-tunnel`, `application/src-tauri`)  
- `c:\Users\tyson\.repo\personal\frostfire-cloud` (`crates/frostfire-tunnel`, `crates/frostfire-proto`, `cloud/gateway`)

---

## 1. Executive Summary & Objective

The Frostfire autonomous agent platform requires seamless operational flexibility across three execution paradigms:
1. **Local Daemon Mode**: Execution on the user host machine via `frostfire-daemon` listening on localhost or a local socket, prioritizing zero latency (<1ms), offline capability, and zero cloud resource cost.
2. **Cloud Gateway Mode**: Multi-tenant microVM virtualization on AWS (ECS/EC2 bare-metal hypervisors) fronted by the hardened, TLS 1.3 `frostfire-gateway` over gRPC bidirectional streams.
3. **Cloud Lambda MicroVM Mode**: On-demand, containerized AWS Lambda microVM execution per user leveraging native Firecracker microVM isolation and response streaming (`AWS_LWA_INVOKE_MODE: response_stream`) with Lambda Web Adapter.

Currently, the Frostfire desktop client (`application/src-tauri`) initializes a static `TunnelClient` against a single environment-provided endpoint URL (`FROSTFIRE_SERVER_URL` or `EC2_AGENT_HOST`), requiring a full process restart to alter endpoints, lacking pre-signed authentication rotation, and missing dynamic IPC bindings for user-directed or automated endpoint switching.

This specification provides the production blueprint for **R4: Tauri Client Dynamic Ingress Integration**, detailing:
- The multi-mode dynamic ingress state machine and hot-switching protocol.
- Pre-signed token authentication headers, constant-time validation (`subtle::ConstantTimeEq`), and AWS IAM SigV4 signing.
- Secure OS keyring credential management and zeroization.
- Complete Tauri IPC command bindings, configuration schema, and frontend event contracts.
- Exact source code structures, proto synchronizations, and verification test harnesses for `crates/frostfire-tunnel`.

---

## 2. Baseline Architecture & Deficiency Analysis

### 2.1 Existing Client Tunnel (`crates/frostfire-tunnel`)
In both `frostfire` and `frostfire-cloud`, `crates/frostfire-tunnel/src/client.rs` defines:
```rust
pub struct TunnelConfig {
    pub server_url: String,
    pub agent_id: String,
    pub auth_token: Option<String>,
    pub initial_reconnect_delay: Duration,
    pub max_reconnect_delay: Duration,
    pub backoff_factor: f64,
    pub max_reconnect_attempts: Option<usize>,
    pub heartbeat_interval: Option<Duration>,
    pub channel_capacity: usize,
    pub connect_timeout: Duration,
    pub tls_config: Option<ClientTlsConfig>,
}
```
`TunnelClient::start(config)` spawns an internal worker loop `run_tunnel_worker` and returns `(tx, rx, handle)`:
- `tx: mpsc::Sender<TunnelClientFrame>`
- `rx: mpsc::Receiver<TunnelServerFrame>`
- `handle: TunnelHandle`

### 2.2 Existing Tauri Desktop Integration (`application/src-tauri`)
In `src-tauri/src/lib.rs`:
```rust
// Static endpoint resolution at boot
let server_url = std::env::var("FROSTFIRE_SERVER_URL")
    .or_else(|_| std::env::var("EC2_AGENT_HOST").map(|h| format!("http://{}:50051", h)))
    .unwrap_or_else(|_| "http://44.242.94.86:50051".to_string());
let agent_id = format!("desktop-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);

let tunnel_config = TunnelConfig::new(&server_url, &agent_id)
    .with_heartbeat_interval(Some(std::time::Duration::from_secs(10)))
    .with_reconnect_policy(
        std::time::Duration::from_millis(500),
        std::time::Duration::from_secs(30),
        1.5,
        None,
    );

let tunnel = TunnelClient::start(tunnel_config).expect("Failed to start tunnel client");
let (outbound_tx, mut inbound_rx, tunnel_handle) = tunnel.split();
```
`outbound_tx` and `tunnel_handle` are stored in `AppState`, while `inbound_rx` is moved into a dedicated background `tokio::spawn` loop that processes incoming server frames (`BlackboardSync`, `DagSync`, `AgentMessage`, `ApprovalRequest`).

### 2.3 Identified Deficiencies
1. **Static Lifecycle & Coupling**: `tunnel.split()` irrevocably splits the client. If the target server changes or drops connection permanently, `inbound_rx` closes, and the background event dispatch loop terminates with no way to recover without restarting the application.
2. **Missing Ingress Modes**: Only a single URL string is supported. There is no first-class concept of `LocalDaemon`, `CloudGateway`, or `CloudLambda`.
3. **Missing Authentication Flexibility**: Only a basic static `auth_token` inserted into gRPC metadata is supported. There is no support for:
   - Dynamic token expiry / refresh.
   - Dual-header tenant authentication (`authorization: Bearer <token>` and `x-sand-window-owner: <token>`).
   - AWS IAM SigV4 signing for Lambda Function URLs.
4. **No Hot-Switching IPC**: The Tauri command catalog has `get_tunnel_status` (reporting whether `is_connected` is true), but has no commands to query configured endpoints, test candidate endpoints, update tokens, or hot-switch modes.
5. **Protobuf Discrepancy**:
   `frostfire/crates/frostfire-proto/proto/tunnel.proto` defines:
   - Field 28: `BlackboardSyncFrame blackboard_sync`
   - Field 29: `DagSyncFrame dag_sync`
   `frostfire-cloud/crates/frostfire-proto/proto/tunnel.proto` omits fields 28 and 29. These must be synchronized to ensure protocol parity.

---

## 3. Dynamic Ingress Architecture & Endpoint Modes

### 3.1 Ingress Modes Specification

| Mode | Endpoint Scheme / Default | Transport Protocol | Authentication Strategy | Primary Use Case |
|---|---|---|---|---|
| **LocalDaemon** | `http://127.0.0.1:50051` or `\\.\pipe\frostfire-daemon` | gRPC over HTTP/2 cleartext (`h2c`) or IPC | Loopback trust / Local dev secret | Offline execution, local repository indexing, zero cost, <1ms latency |
| **CloudGateway** | `https://gateway.frostfire.internal:50051` or NLB FQDN | gRPC over HTTP/2 with TLS 1.3 | Constant-time tenant token (`Bearer` + `x-sand-window-owner`) | Multi-tenant persistent swarm, multi-screen X11/VNC display routing, long-lived daemons |
| **CloudLambda** | `https://<id>.lambda-url.<region>.on.aws/` | HTTPS chunked response stream (`AWS_LWA_INVOKE_MODE: response_stream`) or gRPC reverse-tunnel | AWS IAM SigV4 or Pre-signed Function URL Token | Per-user ephemeral Firecracker microVM, zero idle cost, automatic AWS scaling |

### 3.2 Dynamic Ingress State Machine
The client tunnel transitions through the following formal state machine:

```
                  +-----------------------------------+
                  |           Disconnected            |
                  +-----------------------------------+
                    |                               ^
        switch_mode |                               | connection_lost
                    v                               | (max attempts reached)
         +--------------------+                     |
         |      Switching     |---------------------+
         +--------------------+                     
            | (drain old)                           
            v                                       
         +--------------------+   handshake ok   +--------------------+
         |     Connecting     |----------------->|     Connected      |
         +--------------------+                  +--------------------+
            |              ^                        |              |
            | fail         | retry                  | error        | heartbeat timeout
            v              | (backoff)              v              v
         +------------------------------------------------------------+
         |                        Reconnecting                        |
         +------------------------------------------------------------+
```

#### State Invariants:
1. **Atomic Switch (`Switching`)**: Switching endpoints requires acquiring an exclusive write lock on the `TunnelSessionManager`.
2. **Buffer Preservation**: Frames queued in application channels during `Switching` or `Reconnecting` must not be dropped. Critical control frames (`UserPrompt`, `ApprovalResponse`, `DisplayTakeover`) are buffered in a persistent priority queue (capacity 1024) and flushed upon transition to `Connected`.
3. **Graceful Teardown**: Before connecting to a new endpoint, the active worker's `shutdown_tx` is triggered, waiting up to 2.5s for clean frame completion before forcibly dropping the transport channel.

---

## 4. Pre-Signed Token Authentication & Credential Management

### 4.1 Ingress Authentication Schemes

#### Scheme A: Constant-Time Tenant Token (`CloudGateway`)
- Ingress requires both:
  1. `authorization: Bearer <tenant_token>`
  2. `x-sand-window-owner: <tenant_token>`
  3. `x-agent-id: <agent_id>`
- Gateway enforces constant-time equality via `subtle::ConstantTimeEq` after SHA-256 pre-hashing:
  $$\text{Valid} = \text{ct\_eq}(\text{SHA256}(\text{candidate}), \text{SHA256}(\text{expected}))$$

#### Scheme B: Pre-Signed Time-Bound HMAC Token (`PreSignedHmac`)
- Used for ephemeral access delegations without sharing the root tenant secret.
- Token Format:
  `ff_v1.<tenant_id>.<expires_at_unix>.<signature_hex>`
- Signature Generation:
  $$\text{Signature} = \text{HMAC-SHA256}(K_{\text{tenant}}, \text{"ff\_v1:"} \parallel \text{tenant\_id} \parallel \text{":"} \parallel \text{expires\_at\_unix})$$
- Expiration check: $\text{current\_unix\_time} \le \text{expires\_at\_unix}$.
- Constant-time validation guarantees no secret leakage via timing side-channels.

#### Scheme C: AWS IAM SigV4 Authentication (`CloudLambda`)
When AWS Lambda Function URL is configured with `AuthType: AWS_IAM`:
1. Request requires canonical SigV4 headers:
   - `host`: `<function-id>.lambda-url.<region>.on.aws`
   - `x-amz-date`: UTC timestamp in ISO 8601 (`YYYYMMDD'T'HHMMSS'Z'`)
   - `x-amz-security-token`: Session token (when using temporary STS credentials)
   - `x-amz-content-sha256`: SHA-256 hash of payload
   - `authorization`: `AWS4-HMAC-SHA256 Credential=<AccessKey>/<Date>/<Region>/lambda/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=<Sig>`
2. Client implements `AwsSigV4Signer` in Rust without external heavy AWS SDK dependencies, using `ring` / `hmac` / `sha2`.

### 4.2 Credential Storage & Memory Hygiene
1. **OS Secure Keyring**:
   Credentials (`tenant_token`, `aws_access_key_id`, `aws_secret_access_key`, `aws_session_token`) are stored in the host OS vault via `keyring-rs` (Windows Credential Manager / macOS Keychain / Linux Secret Service).
   - Target Service Name: `com.frostfire.desktop`
   - Keys:
     - `frostfire:tenant_token`
     - `frostfire:aws_access_key_id`
     - `frostfire:aws_secret_access_key`
     - `frostfire:aws_session_token`
2. **Zeroization on Drop**:
   In-memory secrets implement `zeroize::Zeroize` and `zeroize::ZeroizeOnDrop` via `zeroize::Zeroizing<String>` to prevent residual secrets in memory dumps or core dumps.
3. **Sanitized Telemetry**:
   Any log message or IPC state serializable to the frontend replaces tokens with masked previews: e.g. `ff_***...[8 chars redacted]`.

---

## 5. Tauri IPC Command Bindings & Configuration Schema

### 5.1 Data Contracts (Rust & TypeScript)

#### Rust Schema (`frostfire-tunnel::config` & `src-tauri::commands`):
```rust
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelMode {
    LocalDaemon,
    CloudGateway,
    CloudLambda,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthConfig {
    Anonymous,
    TenantToken {
        token: String,
    },
    PreSignedHmac {
        tenant_id: String,
        token: String,
        expires_at_unix: i64,
    },
    AwsIam {
        access_key_id: String,
        secret_access_key: String,
        session_token: Option<String>,
        region: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IngressEndpointConfig {
    pub mode: TunnelMode,
    pub server_url: String,
    pub auth: AuthConfig,
    pub connect_timeout_ms: u64,
    pub heartbeat_interval_ms: Option<u64>,
    pub max_reconnect_attempts: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IngressStatusResponse {
    pub mode: TunnelMode,
    pub server_url: String,
    pub state: String, // "connected" | "connecting" | "reconnecting" | "switching" | "disconnected"
    pub is_connected: bool,
    pub agent_id: String,
    pub latency_ms: Option<u64>,
    pub last_heartbeat_unix_ms: Option<i64>,
    pub reconnect_attempts: usize,
    pub auth_mode: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EndpointProbeResult {
    pub success: bool,
    pub reachable: bool,
    pub authenticated: bool,
    pub latency_ms: u64,
    pub tls_verified: bool,
    pub error_message: Option<String>,
}
```

#### TypeScript Frontend Typings (`application/src/types/tunnel.ts`):
```typescript
export type TunnelMode = 'local_daemon' | 'cloud_gateway' | 'cloud_lambda';

export type AuthConfig =
  | { type: 'anonymous' }
  | { type: 'tenant_token'; token: string }
  | { type: 'pre_signed_hmac'; tenant_id: string; token: string; expires_at_unix: number }
  | { type: 'aws_iam'; access_key_id: string; secret_access_key: string; session_token?: string; region: string };

export interface IngressEndpointConfig {
  mode: TunnelMode;
  server_url: string;
  auth: AuthConfig;
  connect_timeout_ms: number;
  heartbeat_interval_ms?: number;
  max_reconnect_attempts?: number;
}

export interface IngressStatusResponse {
  mode: TunnelMode;
  server_url: string;
  state: 'connected' | 'connecting' | 'reconnecting' | 'switching' | 'disconnected';
  is_connected: boolean;
  agent_id: string;
  latency_ms: number | null;
  last_heartbeat_unix_ms: number | null;
  reconnect_attempts: number;
  auth_mode: string;
}

export interface EndpointProbeResult {
  success: boolean;
  reachable: boolean;
  authenticated: boolean;
  latency_ms: number;
  tls_verified: boolean;
  error_message?: string;
}
```

### 5.2 Tauri IPC Commands

The following commands must be implemented in `application/src-tauri/src/commands.rs` and registered in `application/src-tauri/src/lib.rs`:

1. `get_ingress_status()`:
   - Returns: `IngressStatusResponse`
   - Fast, non-blocking check of current tunnel health, latency, active mode, and connection state.

2. `get_ingress_config()`:
   - Returns: `IngressEndpointConfig` (with secrets masked).
   - Reads persisted endpoint and mode configuration.

3. `switch_ingress_mode(target: IngressEndpointConfig)`:
   - Parameters: `target: IngressEndpointConfig`
   - Returns: `Result<IngressStatusResponse, String>`
   - Atomically switches active transport:
     1. Emits `frostfire://tunnel-status-changed` (`state: "switching"`).
     2. Signals teardown to current worker loop.
     3. Starts new transport with `target` settings.
     4. Performs handshake validation.
     5. Emits `frostfire://tunnel-status-changed` (`state: "connected"` or `"disconnected"`).
     6. Persists new active config to `AppPaths::resolve().config_dir.join("ingress.json")`.

4. `test_ingress_endpoint(candidate: IngressEndpointConfig)`:
   - Parameters: `candidate: IngressEndpointConfig`
   - Returns: `Result<EndpointProbeResult, String>`
   - Isolated out-of-band probe connecting to candidate endpoint, completing TLS handshake, verifying authentication headers, measuring round-trip latency, and closing connection without altering active application stream.

5. `set_ingress_credentials(auth: AuthConfig)`:
   - Parameters: `auth: AuthConfig`
   - Returns: `Result<(), String>`
   - Writes secret keys securely to OS keyring (`SecureKeystore`).

6. `reconnect_ingress()`:
   - Returns: `Result<(), String>`
   - Resets exponential backoff and triggers immediate connection retry on active endpoint.

### 5.3 Frontend Event Contracts

| Event Name | Payload | Trigger |
|---|---|---|
| `frostfire://tunnel-status-changed` | `IngressStatusResponse` | Connection state transition (connected, disconnected, switching, reconnecting) |
| `frostfire://tunnel-latency-ping` | `{ latency_ms: number, timestamp: number }` | Heartbeat ACK received from gateway/daemon |
| `frostfire://tunnel-error` | `{ code: string, message: string, fatal: boolean }` | Unrecoverable transport or auth failure |

---

## 6. Detailed Implementation Specification for `crates/frostfire-tunnel`

### 6.1 New Module Architecture
In `crates/frostfire-tunnel`:
```
crates/frostfire-tunnel/
├── Cargo.toml
└── src/
    ├── lib.rs                   # Re-exports and high-level client
    ├── client.rs                # Core gRPC transport worker
    ├── dynamic.rs               # NEW: DynamicTunnelClient & TunnelSessionManager
    ├── config.rs                # NEW: IngressEndpointConfig, TunnelMode, AuthConfig
    ├── error.rs                 # Comprehensive TunnelError enum
    ├── mock_server.rs           # Enhanced MockGatewayServer supporting multi-endpoint switching
    └── auth/
        ├── mod.rs               # Auth traits and token formatters
        ├── presigned.rs         # HMAC-SHA256 pre-signed token signer and validator
        └── sigv4.rs             # AWS IAM SigV4 signer for Lambda Function URLs
```

### 6.2 `DynamicTunnelClient` Implementation Details

The `DynamicTunnelClient` provides a persistent channel bridge:
```rust
pub struct DynamicTunnelClient {
    app_tx: mpsc::Sender<TunnelClientFrame>,
    app_rx: Arc<Mutex<mpsc::Receiver<TunnelServerFrame>>>,
    session_manager: Arc<RwLock<TunnelSessionManager>>,
}

pub struct TunnelSessionManager {
    current_config: IngressEndpointConfig,
    active_handle: Option<TunnelHandle>,
    current_state: IngressState,
    latency_tracker: Arc<AtomicU64>,
    reconnect_attempts: Arc<AtomicUsize>,
    transport_tx: Option<mpsc::Sender<TunnelClientFrame>>,
}
```

#### Application Channel Forwarding Loop:
- Applications always hold `app_tx` and `app_rx`.
- A background forwarder pumps frames:
  - Application -> Active `transport_tx` (buffered in memory if currently switching or disconnected).
  - Active `transport_rx` -> `app_rx`.
- When `switch_endpoint(new_config)` is invoked:
  1. The session manager pauses forwarder dequeue.
  2. `active_handle.close().await` is invoked.
  3. `TunnelClient::start(new_tunnel_config)` is created.
  4. The new `transport_tx` and `transport_rx` are spliced into the forwarder.
  5. Queued frames are drained into the new connection.
  6. The forwarder unpauses.

### 6.3 AWS SigV4 Signer (`auth/sigv4.rs`)
To support direct AWS Lambda Function URL streaming with IAM authentication without dragging in the complete AWS SDK:
```rust
use sha2::{Digest, Sha256};
use hmac::{Hmac, Mac};
type HmacSha256 = Hmac<Sha256>;

pub struct AwsSigV4Signer {
    access_key_id: String,
    secret_access_key: String,
    session_token: Option<String>,
    region: String,
    service: String,
}

impl AwsSigV4Signer {
    pub fn sign_request(
        &self,
        method: &str,
        url: &url::Url,
        headers: &mut reqwest::header::HeaderMap,
        body_sha256: &str,
        datetime: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), String> {
        let date_stamp = datetime.format("%Y%m%d").to_string();
        let amz_date = datetime.format("%Y%m%dT%H%M%SZ").to_string();

        headers.insert("x-amz-date", amz_date.parse().unwrap());
        headers.insert("x-amz-content-sha256", body_sha256.parse().unwrap());
        if let Some(ref token) = self.session_token {
            headers.insert("x-amz-security-token", token.parse().unwrap());
        }

        let canonical_headers = format!("host:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\n",
            url.host_str().unwrap(), body_sha256, amz_date);
        let signed_headers = "host;x-amz-content-sha256;x-amz-date";

        let canonical_request = format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            method,
            url.path(),
            url.query().unwrap_or(""),
            canonical_headers,
            signed_headers,
            body_sha256
        );

        let canonical_request_hash = hex::encode(Sha256::digest(canonical_request.as_bytes()));
        let credential_scope = format!("{}/{}/{}/aws4_request", date_stamp, self.region, self.service);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{}\n{}\n{}",
            amz_date,
            credential_scope,
            canonical_request_hash
        );

        let k_date = hmac_sha256(format!("AWS4{}", self.secret_access_key).as_bytes(), date_stamp.as_bytes());
        let k_region = hmac_sha256(&k_date, self.region.as_bytes());
        let k_service = hmac_sha256(&k_region, self.service.as_bytes());
        let k_signing = hmac_sha256(&k_service, b"aws4_request");

        let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
        let auth_header = format!(
            "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
            self.access_key_id, credential_scope, signed_headers, signature
        );

        headers.insert("authorization", auth_header.parse().unwrap());
        Ok(())
    }
}
```

### 6.4 Protobuf Synchronization
Synchronize `crates/frostfire-proto/proto/tunnel.proto` across both repositories by adding fields 28 and 29:
```protobuf
// In TunnelServerFrame:
BlackboardSyncFrame blackboard_sync = 28;
DagSyncFrame dag_sync = 29;

// In TunnelClientFrame:
BlackboardSyncFrame blackboard_sync = 28;
DagSyncFrame dag_sync = 29;
```
And compiling both crates via `cargo build -p frostfire-proto`.

---

## 7. Verification & Testing Matrix

### 7.1 Automated Test Plan in `crates/frostfire-tunnel/tests/`

| Test Case | Description | Pass Criteria |
|---|---|---|
| `test_dynamic_endpoint_switching_success` | Start Mock Server 1 (port A) and Mock Server 2 (port B). Connect to Server 1. Send Frame 1. Switch to Server 2. Send Frame 2. | Server 1 receives Frame 1; Server 2 receives Frame 2; no channel panic; status transitions: Connected -> Switching -> Connected. |
| `test_dynamic_switch_buffer_draining` | Send 5 frames while switching is in-flight. | All 5 frames buffered in memory are delivered to Server 2 upon connection establishment. |
| `test_constant_time_token_validation` | Test `PreSignedHmac` and `TenantToken` against invalid signatures, differing lengths, and valid tokens. | Constant time execution; all invalid tokens rejected with `Unauthenticated`; valid tokens accepted. |
| `test_aws_sigv4_canonical_signing` | Run AWS test vectors through `AwsSigV4Signer`. | Generated CanonicalRequest, StringToSign, and Authorization headers match expected hex hashes byte-for-byte. |
| `test_endpoint_probing_isolated` | Probe a live server and a dead port using `test_ingress_endpoint`. | Live server returns `reachable: true, authenticated: true`; dead port returns `reachable: false` without crashing or affecting active stream. |
| `test_secure_zeroization_on_drop` | Instantiate `AuthConfig::TenantToken` and `AuthConfig::AwsIam`. Drop instances. | Memory locations verified zeroed via memory inspection. |

### 7.2 End-to-End Desktop Verification Harness
1. **Local Mode Verification**:
   Launch `frostfire-daemon` on `127.0.0.1:50051`. Invoke `switch_ingress_mode` to `LocalDaemon`. Send agent turn. Verify terminal output stream arrives on display.
2. **Cloud Gateway Verification**:
   Launch `frostfire-gateway` with TLS 1.3 and tenant token `frostfire-dev-tenant-secret`. Switch ingress to `CloudGateway`. Send display takeover frame. Verify gateway session registry registers agent.
3. **Cloud Lambda Verification**:
   Deploy `deploy/aws/lambda-microvm.yaml`. Switch ingress to `CloudLambda` with Function URL. Verify response streaming terminates agent turn and closes cleanly.

---

## 8. Implementation Checklist & Timeline

- [ ] **Phase 1: Protobuf Parity**
  - Add `BlackboardSyncFrame` and `DagSyncFrame` to `frostfire-cloud/crates/frostfire-proto/proto/tunnel.proto`.
  - Recompile `frostfire-proto`.
- [ ] **Phase 2: Tunnel Core Extensions**
  - Implement `config.rs` (`TunnelMode`, `AuthConfig`, `IngressEndpointConfig`).
  - Implement `auth/presigned.rs` (constant-time token generator/validator).
  - Implement `auth/sigv4.rs` (AWS IAM SigV4 signer).
  - Implement `dynamic.rs` (`DynamicTunnelClient`, `TunnelSessionManager`).
- [ ] **Phase 3: Tauri IPC & Backend Wiring**
  - Update `AppState` in `src-tauri/src/commands.rs` to hold `Arc<DynamicTunnelClient>`.
  - Implement `get_ingress_status`, `switch_ingress_mode`, `test_ingress_endpoint`, `set_ingress_credentials`.
  - Register commands in `src-tauri/src/lib.rs`.
- [ ] **Phase 4: Test Suite & Quality Gates**
  - Add dynamic switching and auth unit tests to `crates/frostfire-tunnel/tests/dynamic_test.rs`.
  - Run `cargo test -p frostfire-tunnel`.
  - Run `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`.
