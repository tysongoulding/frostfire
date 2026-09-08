# Milestone 1 Investigation Report: Cloud Gateway Hardening & Tenant Authentication

## Executive Summary
This report presents the architectural analysis, code audit, and implementation plan for **Milestone 1 (M1): Cloud Gateway Hardening & Tenant Authentication**.

Specifically, this investigation details:
1. **Workspace & Crate Dependency Configuration**: Integrating the `subtle` crate into `Cargo.toml` and `cloud/gateway/Cargo.toml`, plus integrating `crates/frostfire-cli` into `workspace.members` (Feature F5).
2. **Configuration & Data Model**: Defining `GatewayConfig` with `tenant_token: Option<String>` and integrating it into `GatewayTunnelService`, `GatewayServerHandle`, and `frostfire-gateway` CLI args.
3. **Metadata Extraction & Constant-Time Verification**: Extracting `authorization: Bearer <token>` and `x-sand-window-owner: <token>` from gRPC request metadata in `cloud/gateway/src/service.rs`, verifying against the configured token via `subtle::ConstantTimeEq`, and immediately rejecting missing/invalid requests with `tonic::Status::unauthenticated("invalid or missing tenant token")`.
4. **Client & Daemon Alignment**: Aligning `crates/frostfire-tunnel` and `cloud/agent` clients with the gateway authentication contract.
5. **Testing & Verification Harness**: Unit test suites for token parsing and timing-safe evaluation, along with end-to-end gRPC stream rejection/admission integration tests.

---

## 1. Current Codebase State & Gap Analysis

### 1.1 `Cargo.toml` and `cloud/gateway/Cargo.toml`
- **Root `Cargo.toml`**:
  - `[workspace.dependencies]` (lines 24–69) lacks `subtle`.
  - `subtle = "2.6.1"` is **already present** in `Cargo.lock` (line 2729) as a transitive dependency of TLS/crypto crates (`rustls-pki-types`, `aws-lc-rs`).
  - `[workspace.members]` (lines 3–15) currently lists 11 crates, omitting `crates/frostfire-cli` (Feature F5 in `PROJECT.md`).
- **`cloud/gateway/Cargo.toml`**:
  - `[dependencies]` (lines 12–28) contains `frostfire-proto`, `tokio`, `tonic`, `frostfire-orchestrator`, etc., but does not declare `subtle`.

### 1.2 `cloud/gateway/src/service.rs`
- In `GatewayTunnelService::open_tunnel` (lines 44–54):
  ```rust
  async fn open_tunnel(
      &self,
      request: Request<Streaming<TunnelClientFrame>>,
  ) -> Result<Response<Self::OpenTunnelStream>, Status> {
      let metadata_agent_id = request
          .metadata()
          .get("x-agent-id")
          .and_then(|v| v.to_str().ok())
          .map(|s| s.to_string());
  ```
- **Observed Gaps**:
  1. `GatewayTunnelService` has no `tenant_token` or `config` field (lines 16–20).
  2. `open_tunnel` does not inspect `authorization` or `x-sand-window-owner` metadata headers.
  3. No token validation or rejection is performed; any caller can establish an unauthenticated tunnel session.
  4. There is no usage of `subtle::ConstantTimeEq`.

### 1.3 `cloud/gateway/src/server.rs` & `main.rs`
- In `server.rs`: `GatewayServerHandle::bind_ephemeral` and `bind_with_engine` construct `GatewayTunnelService::new(registry.clone(), Some(client_frame_tx))` without passing any tenant configuration.
- In `main.rs`: `Args` (lines 12–18) only accepts `--bind` (`0.0.0.0:50051`). There is no CLI or environment variable binding for `FROSTFIRE_TENANT_TOKEN`.

### 1.4 Existing Tests Baseline
- Existing integration test in `cloud/gateway/tests/service_communication_test.rs`:
  - `test_cloud_service_communicates_with_application_crates` (spawns daemon and gateway via `bind_ephemeral`).
  - `test_cloud_gateway_evaluates_user_prompt_and_returns_tool_frames` (spawns tunnel client and gateway via `bind_with_engine`).
  - Neither test currently configures or transmits an authentication token.
  - **Critical Architectural Requirement**: If `tenant_token` is `None` (unconfigured), the gateway must operate in backward-compatible unauthenticated/dev mode so existing tests continue to pass with zero regressions. When `tenant_token` is `Some(...)`, strict constant-time authentication must be enforced.

---

## 2. Proposed Architectural Design

### 2.1 Dependency Changes

#### Root `Cargo.toml`
```toml
# In [workspace] members:
members = [
    "crates/frostfire-proto",
    "crates/frostfire-tunnel",
    "crates/frostfire-exec",
    "crates/frostfire-security",
    "crates/frostfire-mcp",
    "crates/frostfire-daemon",
    "crates/frostfire-core",
    "crates/frostfire-engine",
    "crates/frostfire-cli",        # Added: F5
    "services/swarm-orchestrator",
    "cloud/gateway",
    "cloud/agent",
]

# In [workspace.dependencies]:
subtle = "2.6"
```

#### `cloud/gateway/Cargo.toml`
```toml
[dependencies]
subtle = { workspace = true }
```

### 2.2 Configuration Model (`cloud/gateway/src/config.rs`)
Create a dedicated `GatewayConfig` module:

```rust
use serde::{Deserialize, Serialize};

/// Configuration for the Frostfire Cloud Edge Gateway.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GatewayConfig {
    /// Expected tenant authentication secret token.
    /// When `Some`, all `open_tunnel` requests must provide a matching token.
    /// When `None`, the gateway runs in unauthenticated development mode.
    pub tenant_token: Option<String>,
}

impl GatewayConfig {
    pub fn new(tenant_token: Option<String>) -> Self {
        Self { tenant_token }
    }

    pub fn with_token(token: impl Into<String>) -> Self {
        Self {
            tenant_token: Some(token.into()),
        }
    }

    pub fn from_env() -> Self {
        Self {
            tenant_token: std::env::var("FROSTFIRE_TENANT_TOKEN").ok(),
        }
    }
}
```

Expose `pub mod config;` and `pub use config::GatewayConfig;` in `cloud/gateway/src/lib.rs`.

### 2.3 Hardening `GatewayTunnelService` in `cloud/gateway/src/service.rs`

#### Data Structure & Builder
```rust
use subtle::ConstantTimeEq;
use crate::config::GatewayConfig;

pub struct GatewayTunnelService {
    registry: Arc<SessionRegistry>,
    client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
    turn_engine: Option<Arc<AgentTurnEngine>>,
    tenant_token: Option<String>,
}

impl GatewayTunnelService {
    pub fn new(
        registry: Arc<SessionRegistry>,
        client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
    ) -> Self {
        Self {
            registry,
            client_frame_tx,
            turn_engine: None,
            tenant_token: None,
        }
    }

    pub fn with_tenant_token(mut self, token: impl Into<String>) -> Self {
        self.tenant_token = Some(token.into());
        self
    }

    pub fn with_config(mut self, config: GatewayConfig) -> Self {
        self.tenant_token = config.tenant_token;
        self
    }

    pub fn with_turn_engine(mut self, engine: Arc<AgentTurnEngine>) -> Self {
        self.turn_engine = Some(engine);
        self
    }

    pub fn tenant_token(&self) -> Option<&str> {
        self.tenant_token.as_deref()
    }
}
```

#### Constant-Time Verification & Rejection Logic in `open_tunnel`
```rust
    async fn open_tunnel(
        &self,
        request: Request<Streaming<TunnelClientFrame>>,
    ) -> Result<Response<Self::OpenTunnelStream>, Status> {
        // Enforce constant-time tenant token validation if configured
        if let Some(ref expected_token) = self.tenant_token {
            let metadata = request.metadata();
            let auth_header = metadata.get("authorization").and_then(|v| v.to_str().ok());
            let window_owner_header = metadata.get("x-sand-window-owner").and_then(|v| v.to_str().ok());

            let extracted_token = if let Some(raw_auth) = auth_header {
                let trimmed = raw_auth.trim();
                if let Some(token) = trimmed.strip_prefix("Bearer ").or_else(|| trimmed.strip_prefix("bearer ")) {
                    token.trim()
                } else {
                    trimmed
                }
            } else if let Some(owner) = window_owner_header {
                owner.trim()
            } else {
                return Err(Status::unauthenticated("invalid or missing tenant token"));
            };

            if extracted_token.is_empty() {
                return Err(Status::unauthenticated("invalid or missing tenant token"));
            }

            // Constant-time comparison using subtle::ConstantTimeEq
            let matches: bool = extracted_token.as_bytes().ct_eq(expected_token.as_bytes()).into();
            if !matches {
                return Err(Status::unauthenticated("invalid or missing tenant token"));
            }
        }

        let metadata_agent_id = request
            .metadata()
            .get("x-agent-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
...
```

### 2.4 Server Handle & CLI Updates

#### `cloud/gateway/src/server.rs`
Add server constructor variants allowing tests and consumers to bind with an authentication token:
```rust
impl GatewayServerHandle {
    /// Binds an ephemeral port with an explicit tenant authentication token.
    pub async fn bind_ephemeral_with_token(token: &str) -> Result<Self, anyhow::Error> {
        let config = GatewayConfig::with_token(token);
        Self::bind_with_config("127.0.0.1:0", config, None).await
    }

    /// Binds to an address with explicit configuration and optional turn engine.
    pub async fn bind_with_config(
        addr_str: &str,
        config: GatewayConfig,
        turn_engine: Option<Arc<AgentTurnEngine>>,
    ) -> Result<Self, anyhow::Error> {
        let listener = tokio::net::TcpListener::bind(addr_str).await?;
        let addr = listener.local_addr()?;
        let stream = TcpListenerStream::new(listener);

        let registry = Arc::new(SessionRegistry::new());
        let (client_frame_tx, client_frame_rx) = mpsc::channel(256);
        let mut service = GatewayTunnelService::new(registry.clone(), Some(client_frame_tx))
            .with_config(config);
        if let Some(engine) = turn_engine {
            service = service.with_turn_engine(engine);
        }

        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

        tokio::spawn(async move {
            let _ = Server::builder()
                .add_service(AgentTunnelServiceServer::new(service))
                .serve_with_incoming_shutdown(stream, async move {
                    let _ = shutdown_rx.changed().await;
                })
                .await;
        });

        Ok(Self {
            addr,
            registry,
            client_frame_rx: Arc::new(Mutex::new(client_frame_rx)),
            shutdown_tx,
        })
    }
...
```

#### `cloud/gateway/src/main.rs`
```rust
#[derive(Parser, Debug)]
#[command(name = "frostfire-gateway")]
#[command(about = "Frostfire Edge Cloud Gateway: Ingress control plane for agent daemons")]
struct Args {
    #[arg(short, long, default_value = "0.0.0.0:50051")]
    bind: String,

    #[arg(long, env = "FROSTFIRE_TENANT_TOKEN")]
    tenant_token: Option<String>,
}
```
In `main()`:
```rust
    let config = GatewayConfig {
        tenant_token: args.tenant_token,
    };
    let mut service = GatewayTunnelService::new(registry.clone(), None)
        .with_config(config)
        .with_turn_engine(turn_engine);
```

---

## 3. Security & Constant-Time Analysis

### 3.1 Resistance to Side-Channel Timing Attacks
Standard string comparison (`==`) iterates byte-by-byte and terminates upon discovering the first mismatched character. In a network-facing gRPC service, attackers measuring latency over repeated requests can guess token characters sequentially (e.g. distinguishing a token with 4 matching prefix bytes from 0 matching bytes).

`subtle::ConstantTimeEq` mitigates this by:
1. Converting comparison outcomes to `subtle::Choice`.
2. Preventing early loop exits and compiler branch optimizations via volatile read barriers.
3. Accumulating differences across all bytes using bitwise operations:
   `for (ai, bi) in self.iter().zip(_rhs.iter()) { x &= ai.ct_eq(bi).unwrap_u8(); }`

### 3.2 Slice Length Considerations & Optional SHA-256 Pre-Hashing
- In `subtle 2.6.1`, `[T]::ct_eq` checks `if len != _rhs.len() { return Choice::from(0); }`.
- If tokens are of variable length, an attacker might infer token length from timing variances.
- **Defense-in-depth alternative**: If variable-length token length leakage is a concern, both candidate and expected tokens can be pre-hashed with SHA-256 before `ct_eq`. Both digests are guaranteed to be exactly 32 bytes (`[u8; 32]`), eliminating even length short-circuiting:
  ```rust
  use sha2::{Digest, Sha256};
  let h_cand = Sha256::digest(extracted_token.as_bytes());
  let h_exp = Sha256::digest(expected_token.as_bytes());
  let matches: bool = h_cand.as_slice().ct_eq(h_exp.as_slice()).into();
  ```
- **Recommendation**: Direct slice `ct_eq` satisfies standard constant-time requirements when token length is uniform (e.g. 32-byte hexadecimal strings or UUIDs). The SHA-256 pre-hash pattern can be applied if tenant tokens have arbitrary lengths.

### 3.3 Strict Stream Abort
When a request fails authentication:
- `open_tunnel` returns `Err(Status::unauthenticated("invalid or missing tenant token"))` immediately.
- Tonic emits gRPC HTTP/2 `Trailers-Only` with `grpc-status: 16 (UNAUTHENTICATED)`.
- No session is registered in `SessionRegistry`.
- No response channels or background forwarding tasks are allocated.

---

## 4. Test Verification Plan

### 4.1 Unit Tests (`cloud/gateway/src/service.rs`)
Add unit tests verifying token extraction and comparison:
1. `test_token_extraction_bearer`: Validates `"Bearer secret-token"` strips prefix.
2. `test_token_extraction_case_insensitive_bearer`: Validates `"bearer secret-token"`.
3. `test_token_extraction_window_owner`: Validates `"x-sand-window-owner: secret-token"`.
4. `test_token_extraction_precedence`: Validates `authorization` precedes `x-sand-window-owner`.
5. `test_constant_time_comparison`: Validates matching tokens return `true`, non-matching return `false`, differing length returns `false`.

### 4.2 Integration Tests (`cloud/gateway/tests/auth_test.rs`)
1. **Admit with Valid `authorization: Bearer <token>`**:
   - Gateway started with `tenant_token = "secret-123"`.
   - Client sends `authorization: Bearer secret-123`.
   - Assert stream connects and session registers.
2. **Admit with Valid `x-sand-window-owner: <token>`**:
   - Client sends `x-sand-window-owner: secret-123`.
   - Assert stream connects.
3. **Reject Missing Metadata**:
   - Client connects with empty metadata.
   - Assert returns `tonic::Code::Unauthenticated` with message `"invalid or missing tenant token"`.
4. **Reject Invalid Token**:
   - Client sends `authorization: Bearer wrong-token`.
   - Assert returns `tonic::Code::Unauthenticated`.
5. **Backward Compatibility**:
   - Gateway started with `tenant_token = None`.
   - Client connects with no token.
   - Assert stream connects successfully.

---

## 5. Summary of Implementation Files

| File | Change | Purpose |
|------|--------|---------|
| `Cargo.toml` | Add `crates/frostfire-cli` to `members`; add `subtle = "2.6"` to `[workspace.dependencies]` | F5 resolution & workspace dependency export |
| `cloud/gateway/Cargo.toml` | Add `subtle = { workspace = true }` | Enable `subtle::ConstantTimeEq` in gateway |
| `cloud/gateway/src/config.rs` | New file defining `GatewayConfig` | Tenant token configuration model |
| `cloud/gateway/src/lib.rs` | Export `config` module | Public API surface |
| `cloud/gateway/src/service.rs` | Add `tenant_token` field, builder methods, metadata extraction, and `ct_eq` check | Secure `open_tunnel` ingress |
| `cloud/gateway/src/server.rs` | Add `bind_ephemeral_with_token` and `bind_with_config` | Test & production server handles |
| `cloud/gateway/src/main.rs` | Add `tenant_token` argument in `Args` and wire into `GatewayConfig` | CLI & env var configuration |
| `cloud/gateway/tests/auth_test.rs` | New test file for tenant authentication | Automated verification harness |
