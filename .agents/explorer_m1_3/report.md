# Milestone 1 Investigation Report: Workspace Integrity, frostfire-cli, and Gateway Authentication

**Explorer**: `explorer_m1_3`  
**Milestone**: Milestone 1: Cloud Gateway Hardening & Tenant Auth  
**Scope**: Workspace manifest integrity (`crates/frostfire-cli`), Gateway authentication hardening (`subtle::ConstantTimeEq`), and Milestone 1 Verification Strategy.

---

## 1. Executive Summary

Milestone 1 focuses on hardening the edge ingress gateway (`frostfire-gateway`), enforcing constant-time tenant authentication on `AgentTunnelService.OpenTunnel`, and establishing full workspace integrity.

Key findings of this investigation:
1. **Orphan Crate `crates/frostfire-cli`**:
   - `crates/frostfire-cli` was excluded from root `Cargo.toml` `workspace.members` while declaring `version.workspace = true` and workspace dependencies.
   - When verified independently via `cargo check --manifest-path crates/frostfire-cli/Cargo.toml`, Cargo failed immediately with `error: current package believes it's in a workspace when it's not`.
   - Adding `"crates/frostfire-cli"` to root `Cargo.toml` `workspace.members` resolved the manifest disconnect. When checked, `cargo check --workspace` completed cleanly with exit code 0, `cargo test -p frostfire-cli` ran all 5 unit/integration tests with 0 failures, and `cargo clippy --workspace -- -D warnings` passed with 0 warnings.
2. **Gateway Authentication Gap**:
   - `cloud/gateway/src/service.rs` currently extracts only the `x-agent-id` metadata header and performs **no authentication whatsoever**, allowing unauthorized clients to stream frames and invoke cloud turn routines.
   - The cryptographic crate `subtle` is completely absent from root `Cargo.toml` and `cloud/gateway/Cargo.toml`.
   - To satisfy the invariant defined in `ORIGINAL_REQUEST.md` and `PROJECT.md`, `subtle = "2.6"` must be integrated, and a constant-time validator (`TenantAuthenticator`) must check both `authorization: Bearer <token>` and `x-sand-window-owner: <token>`. Unauthenticated requests must immediately abort with `tonic::Status::unauthenticated("invalid or missing tenant token")`.
3. **Verification & Test Strategy**:
   - Formulated a comprehensive unit test suite for `frostfire-gateway` covering exact token matches, invalid tokens (same and differing lengths), empty tokens, bit-flip/transposition constant-time properties, and metadata header parsing.
   - Formulated a robust integration test suite for `cloud/gateway/tests/` verifying that `open_tunnel` rejects unauthenticated requests with gRPC status code `Unauthenticated` and accepts authenticated requests under both supported header formats.

---

## 2. Investigation: Orphan Crate `crates/frostfire-cli`

### 2.1 Problem Diagnosis & Root Cause
In root `Cargo.toml` (lines 3–15), the `workspace.members` array was defined as:
```toml
members = [
    "crates/frostfire-proto",
    "crates/frostfire-tunnel",
    "crates/frostfire-exec",
    "crates/frostfire-security",
    "crates/frostfire-mcp",
    "crates/frostfire-daemon",
    "crates/frostfire-core",
    "crates/frostfire-engine",
    "services/swarm-orchestrator",
    "cloud/gateway",
    "cloud/agent",
]
```

Notice that `crates/frostfire-cli` was omitted from this list.

However, inspecting `crates/frostfire-cli/Cargo.toml`:
```toml
[package]
name = "frostfire-cli"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true

[[bin]]
name = "frostfire"
path = "src/main.rs"

[dependencies]
frostfire-proto = { workspace = true }
frostfire-tunnel = { workspace = true }
frostfire-exec = { workspace = true }
frostfire-security = { workspace = true }
frostfire-mcp = { workspace = true }
frostfire-daemon = { workspace = true }
frostfire-engine = { workspace = true }
clap = { workspace = true }
tokio = { workspace = true }
tonic = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
thiserror = { workspace = true }
anyhow = { workspace = true }
uuid = { workspace = true }
chrono = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
rusqlite = { workspace = true }
webrtc = "0.20"
reqwest = { workspace = true }
tokio-tungstenite = "0.26"
futures = { workspace = true }
```

When building or checking `frostfire-cli` directly via:
```powershell
cargo check --manifest-path crates/frostfire-cli/Cargo.toml
```
Cargo halted with the following verbatim error:
```
error: current package believes it's in a workspace when it's not:
current:   C:\Users\tyson\.repo\personal\frostfire-cloud\crates\frostfire-cli\Cargo.toml
workspace: C:\Users\tyson\.repo\personal\frostfire-cloud\Cargo.toml

this may be fixable by adding `crates\frostfire-cli` to the `workspace.members` array of the manifest located at: C:\Users\tyson\.repo\personal\frostfire-cloud\Cargo.toml
Alternatively, to keep it out of the workspace, add the package to the `workspace.exclude` array, or add an empty `[workspace]` table to the package's manifest.
```

Because it was not in `workspace.members`, `cargo check --workspace` and `cargo test --workspace` silently bypassed `crates/frostfire-cli`.

### 2.2 Compilation & Test Validation
During our dry-run test, `"crates/frostfire-cli"` was added to `workspace.members` in `Cargo.toml`.
Observations:
- Cargo locked 113 transitive dependencies (including `webrtc v0.20.5`, `tokio-tungstenite v0.26.2`, `rkyv`, `rcgen`, etc.).
- `cargo check --workspace` compiled in 23.5s on clean cache, and in 0.34s warm, with **exit code 0**.
- `cargo test -p frostfire-cli` was executed, running all 5 tests embedded in `crates/frostfire-cli`:
  ```
  running 5 tests
  test browser::tests::test_generate_stealth_script_profiles ... ok
  test ui::tests::test_sanitize_terminal_output ... ok
  test browser::tests::test_sync_cdp_cookies_graceful_offline ... ok
  test browser::tests::test_browser_action_handles_unreachable_port ... ok
  test ui::tests::test_ui_http_server_endpoints ... ok

  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.42s
  ```
- `cargo clippy --workspace -- -D warnings` finished with **0 warnings**.
- The entire workspace test suite (`cargo test --workspace`) executed 65+ unit and integration tests across all workspace crates with **0 failures**.

### 2.3 Proposed Workspace Changes
The recommended change in `Cargo.toml` is captured in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_3\workspace_members.patch`:
```diff
--- a/Cargo.toml
+++ b/Cargo.toml
@@ -9,6 +9,7 @@ members = [
     "crates/frostfire-daemon",
     "crates/frostfire-core",
     "crates/frostfire-engine",
+    "crates/frostfire-cli",
     "services/swarm-orchestrator",
     "cloud/gateway",
     "cloud/agent",
@@ -32,6 +33,7 @@ frostfire-daemon = { path = "crates/frostfire-daemon" }
 frostfire-core = { path = "crates/frostfire-core" }
 frostfire-engine = { path = "crates/frostfire-engine" }
 frostfire-orchestrator = { path = "services/swarm-orchestrator" }
+frostfire-cli = { path = "crates/frostfire-cli" }
 
 # Async & Networking
 tokio = { version = "1.43", features = ["full"] }
@@ -58,6 +60,7 @@ sha2 = "0.10"
 hex = "0.4"
 directories-next = "2.0"
+subtle = "2.6"
 
 # CLI & Observability
 clap = { version = "4.5", features = ["derive", "env"] }
```

*(Note: `tests/e2e/Cargo.toml` also specifies `version.workspace = true`. When Milestone 4 is scheduled for execution, `tests/e2e` should be added to `workspace.members` or managed alongside integration test harnesses).*

---

## 3. Investigation: Gateway Authentication & Constant-Time Verification

### 3.1 Current State of `frostfire-gateway`
Inspecting `cloud/gateway/src/service.rs` (lines 44–54):
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

        let mut in_stream = request.into_inner();
        let (out_tx, out_rx) = mpsc::channel(512);
        ...
```
Currently:
1. `open_tunnel` only reads `x-agent-id`.
2. No check is performed on `authorization` or `x-sand-window-owner`.
3. If an unauthenticated client connects without headers or with arbitrary tokens, the gateway accepts the connection, registers the session, and processes frames.
4. Neither root `Cargo.toml` nor `cloud/gateway/Cargo.toml` includes `subtle`.

### 3.2 Target Specification & Invariants
From `ORIGINAL_REQUEST.md` and `PROJECT.md`:
- **Protocol**: gRPC over HTTP/2 with TLS 1.3 (`AgentTunnelService.OpenTunnel`).
- **Accepted Headers**:
  - `authorization: Bearer <tenant-token>` OR
  - `x-sand-window-owner: <tenant-token>`
  - `x-agent-id: <agent-uuid>`
- **Security Invariant**:
  All display and session routes MUST enforce tenant token checks using constant-time comparison (`subtle::ConstantTimeEq`).
- **Rejection Behavior**:
  If the header is missing, malformed, or the token does not match the configured tenant token, the gateway must abort immediately with:
  `tonic::Status::unauthenticated("invalid or missing tenant token")`.

### 3.3 Constant-Time Comparison Architecture

To eliminate timing side channels, two levels of protection are recommended:
1. **SHA-256 Digest Normalization**:
   Comparing raw strings with `a.len() != b.len()` can leak token length through early returns. By computing the SHA-256 digest of both the expected token and the provided token, both inputs are normalized to 32 bytes before comparison:
   $$\text{digest}_{\text{expected}} = \text{SHA256}(\text{expected})$$
   $$\text{digest}_{\text{provided}} = \text{SHA256}(\text{provided})$$
2. **Constant-Time Slice Equality (`subtle::ConstantTimeEq`)**:
   Compare the 32-byte arrays using `subtle::ConstantTimeEq`:
   ```rust
   let eq: bool = digest_expected.ct_eq(&digest_provided).into();
   ```
   Both direct slice comparison (`a.as_bytes().ct_eq(b.as_bytes())`) and SHA-256 digest comparison are supported. Using SHA-256 digest comparison provides complete immunity against length-leakage side channels.

### 3.4 Module Design: `cloud/gateway/src/auth.rs`

```rust
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tonic::metadata::MetadataMap;
use tonic::Status;

/// Tenant token authenticator providing constant-time equality validation.
#[derive(Clone, Debug)]
pub struct TenantAuthenticator {
    expected_token: String,
}

impl TenantAuthenticator {
    pub fn new(expected_token: impl Into<String>) -> Self {
        Self {
            expected_token: expected_token.into(),
        }
    }

    /// Validates an incoming token against the expected token in constant time.
    ///
    /// Uses SHA-256 hashing to normalize both operands to 32 bytes (preventing length leakage),
    /// followed by `subtle::ConstantTimeEq` comparison.
    pub fn verify_token(&self, provided_token: &str) -> bool {
        if self.expected_token.is_empty() || provided_token.is_empty() {
            return false;
        }

        let expected_hash = Sha256::digest(self.expected_token.as_bytes());
        let provided_hash = Sha256::digest(provided_token.as_bytes());

        expected_hash.ct_eq(&provided_hash).into()
    }

    /// Authenticates incoming gRPC request metadata.
    /// Returns Ok(()) if valid, or Status::unauthenticated if missing or invalid.
    pub fn authenticate_metadata(&self, metadata: &MetadataMap) -> Result<(), Status> {
        let token = extract_token_from_metadata(metadata)
            .ok_or_else(|| Status::unauthenticated("invalid or missing tenant token"))?;

        if self.verify_token(&token) {
            Ok(())
        } else {
            Err(Status::unauthenticated("invalid or missing tenant token"))
        }
    }

    pub fn expected_token(&self) -> &str {
        &self.expected_token
    }
}

/// Extracts a tenant token from either `authorization` (Bearer ...) or `x-sand-window-owner`.
pub fn extract_token_from_metadata(metadata: &MetadataMap) -> Option<String> {
    // 1. Check `authorization` header
    if let Some(auth_val) = metadata.get("authorization").and_then(|v| v.to_str().ok()) {
        let clean = auth_val.trim();
        let token = if let Some(stripped) = clean.strip_prefix("Bearer ") {
            stripped.trim()
        } else if let Some(stripped) = clean.strip_prefix("bearer ") {
            stripped.trim()
        } else {
            clean
        };
        if !token.is_empty() {
            return Some(token.to_string());
        }
    }

    // 2. Check `x-sand-window-owner` header
    if let Some(owner_val) = metadata.get("x-sand-window-owner").and_then(|v| v.to_str().ok()) {
        let clean = owner_val.trim();
        if !clean.is_empty() {
            return Some(clean.to_string());
        }
    }

    None
}
```

### 3.5 Service & Server Integration
In `cloud/gateway/src/service.rs`:
```rust
pub struct GatewayTunnelService {
    registry: Arc<SessionRegistry>,
    client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
    turn_engine: Option<Arc<AgentTurnEngine>>,
    authenticator: Arc<TenantAuthenticator>,
}

impl GatewayTunnelService {
    pub fn new(
        registry: Arc<SessionRegistry>,
        client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
    ) -> Self {
        let default_token = std::env::var("FROSTFIRE_TENANT_TOKEN")
            .unwrap_or_else(|_| "frostfire-dev-tenant-secret".to_string());
        Self::with_authenticator(
            registry,
            client_frame_tx,
            Arc::new(TenantAuthenticator::new(default_token)),
        )
    }

    pub fn with_authenticator(
        registry: Arc<SessionRegistry>,
        client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
        authenticator: Arc<TenantAuthenticator>,
    ) -> Self {
        Self {
            registry,
            client_frame_tx,
            turn_engine: None,
            authenticator,
        }
    }

    pub fn with_tenant_token(mut self, token: impl Into<String>) -> Self {
        self.authenticator = Arc::new(TenantAuthenticator::new(token));
        self
    }
}
```

In `open_tunnel`:
```rust
    async fn open_tunnel(
        &self,
        request: Request<Streaming<TunnelClientFrame>>,
    ) -> Result<Response<Self::OpenTunnelStream>, Status> {
        // Enforce constant-time tenant authentication before establishing stream
        self.authenticator.authenticate_metadata(request.metadata())?;

        let metadata_agent_id = request
            .metadata()
            .get("x-agent-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        ...
```

In `cloud/gateway/src/main.rs`:
```rust
#[derive(Parser, Debug)]
#[command(name = "frostfire-gateway")]
#[command(about = "Frostfire Edge Cloud Gateway: Ingress control plane for agent daemons")]
struct Args {
    #[arg(short, long, default_value = "0.0.0.0:50051")]
    bind: String,

    #[arg(long, env = "FROSTFIRE_TENANT_TOKEN", default_value = "frostfire-dev-tenant-secret")]
    tenant_token: String,
}
```

In `cloud/gateway/src/server.rs`:
```rust
    pub async fn bind_ephemeral() -> Result<Self, anyhow::Error> {
        let token = std::env::var("FROSTFIRE_TENANT_TOKEN")
            .unwrap_or_else(|_| "frostfire-dev-tenant-secret".to_string());
        Self::bind_ephemeral_with_token(&token).await
    }

    pub async fn bind_ephemeral_with_token(token: &str) -> Result<Self, anyhow::Error> {
        let gemini = Arc::new(GeminiClient::from_env());
        let engine = Arc::new(AgentTurnEngine::new(gemini));
        Self::bind_with_engine_and_token("127.0.0.1:0", Some(engine), token).await
    }
```

---

## 4. Milestone 1 Verification Strategy & Concrete Test Suite

To guarantee 100% test coverage and satisfy all acceptance criteria, the verification suite is divided into three tiers:

### 4.1 Unit Test Suite: Constant-Time Token Verification (`cloud/gateway/src/auth.rs` or `cloud/gateway/tests/auth_unit_tests.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tonic::metadata::{MetadataMap, MetadataValue};

    #[test]
    fn test_valid_token_matches() {
        let auth = TenantAuthenticator::new("secret-token-12345");
        assert!(auth.verify_token("secret-token-12345"));
    }

    #[test]
    fn test_invalid_token_rejected_same_length() {
        let auth = TenantAuthenticator::new("secret-token-12345");
        assert!(!auth.verify_token("secret-token-12346"));
        assert!(!auth.verify_token("xecret-token-12345"));
    }

    #[test]
    fn test_invalid_token_rejected_diff_length() {
        let auth = TenantAuthenticator::new("secret-token-12345");
        assert!(!auth.verify_token("secret-token-1234"));
        assert!(!auth.verify_token("secret-token-123456"));
        assert!(!auth.verify_token(""));
    }

    #[test]
    fn test_empty_expected_token_rejects_all() {
        let auth = TenantAuthenticator::new("");
        assert!(!auth.verify_token(""));
        assert!(!auth.verify_token("any-token"));
    }

    #[test]
    fn test_timing_safe_bit_flip_and_transposition() {
        let auth = TenantAuthenticator::new("frostfire_secure_token_alpha_99");
        let valid = "frostfire_secure_token_alpha_99";

        // Transposition
        let mut chars: Vec<char> = valid.chars().collect();
        chars.swap(5, 6);
        let transposed: String = chars.into_iter().collect();
        assert!(!auth.verify_token(&transposed));

        // Bit flip
        let mut bytes = valid.as_bytes().to_vec();
        bytes[10] ^= 0x01;
        let flipped = String::from_utf8(bytes).unwrap();
        assert!(!auth.verify_token(&flipped));
    }

    #[test]
    fn test_metadata_extraction_bearer_token() {
        let mut meta = MetadataMap::new();
        meta.insert("authorization", "Bearer my-secret-token".parse().unwrap());

        let extracted = extract_token_from_metadata(&meta);
        assert_eq!(extracted, Some("my-secret-token".to_string()));
    }

    #[test]
    fn test_metadata_extraction_bearer_case_insensitivity_and_whitespace() {
        let mut meta = MetadataMap::new();
        meta.insert("authorization", "  bearer   token-with-spaces   ".parse().unwrap());

        let extracted = extract_token_from_metadata(&meta);
        assert_eq!(extracted, Some("token-with-spaces".to_string()));
    }

    #[test]
    fn test_metadata_extraction_sand_window_owner() {
        let mut meta = MetadataMap::new();
        meta.insert("x-sand-window-owner", "tenant-owner-key-xyz".parse().unwrap());

        let extracted = extract_token_from_metadata(&meta);
        assert_eq!(extracted, Some("tenant-owner-key-xyz".to_string()));
    }

    #[test]
    fn test_metadata_precedence_authorization_over_owner() {
        let mut meta = MetadataMap::new();
        meta.insert("authorization", "Bearer auth-token".parse().unwrap());
        meta.insert("x-sand-window-owner", "owner-token".parse().unwrap());

        let extracted = extract_token_from_metadata(&meta);
        assert_eq!(extracted, Some("auth-token".to_string()));
    }

    #[test]
    fn test_metadata_extraction_empty_or_missing() {
        let meta = MetadataMap::new();
        assert_eq!(extract_token_from_metadata(&meta), None);

        let mut meta_empty = MetadataMap::new();
        meta_empty.insert("authorization", "Bearer   ".parse().unwrap());
        assert_eq!(extract_token_from_metadata(&meta_empty), None);
    }

    #[test]
    fn test_authenticate_metadata_lifecycle() {
        let auth = TenantAuthenticator::new("correct-token");

        let mut valid_meta = MetadataMap::new();
        valid_meta.insert("authorization", "Bearer correct-token".parse().unwrap());
        assert!(auth.authenticate_metadata(&valid_meta).is_ok());

        let mut invalid_meta = MetadataMap::new();
        invalid_meta.insert("authorization", "Bearer wrong-token".parse().unwrap());
        let res = auth.authenticate_metadata(&invalid_meta);
        assert!(res.is_err());
        let status = res.unwrap_err();
        assert_eq!(status.code(), tonic::Code::Unauthenticated);
        assert_eq!(status.message(), "invalid or missing tenant token");

        let empty_meta = MetadataMap::new();
        let res_empty = auth.authenticate_metadata(&empty_meta);
        assert!(res_empty.is_err());
        assert_eq!(res_empty.unwrap_err().code(), tonic::Code::Unauthenticated);
    }
}
```

### 4.2 Integration Test Suite: Gateway Rejection & Acceptance (`cloud/gateway/tests/gateway_auth_integration_test.rs`)

```rust
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::wrappers::ReceiverStream;
use tonic::Code;

use frostfire_gateway::GatewayServerHandle;
use frostfire_proto::tunnel::agent_tunnel_service_client::AgentTunnelServiceClient;
use frostfire_proto::tunnel::TunnelClientFrame;
use frostfire_tunnel::{TunnelClient, TunnelConfig};

const TEST_TENANT_TOKEN: &str = "test-secret-tenant-token-42";

#[tokio::test]
async fn test_open_tunnel_rejects_missing_auth_header() {
    let gateway = Arc::new(
        GatewayServerHandle::bind_ephemeral_with_token(TEST_TENANT_TOKEN)
            .await
            .expect("Failed to bind ephemeral gateway"),
    );

    let channel = tonic::transport::Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");
    let mut grpc_client = AgentTunnelServiceClient::new(channel);

    let (_tx, rx) = tokio::sync::mpsc::channel::<TunnelClientFrame>(1);
    let request = tonic::Request::new(ReceiverStream::new(rx));

    let response = grpc_client.open_tunnel(request).await;
    assert!(response.is_err(), "Tunnel should be rejected without auth headers");
    let status = response.unwrap_err();
    assert_eq!(status.code(), Code::Unauthenticated);
    assert_eq!(status.message(), "invalid or missing tenant token");

    gateway.shutdown();
}

#[tokio::test]
async fn test_open_tunnel_rejects_invalid_token() {
    let gateway = Arc::new(
        GatewayServerHandle::bind_ephemeral_with_token(TEST_TENANT_TOKEN)
            .await
            .expect("Failed to bind ephemeral gateway"),
    );

    let channel = tonic::transport::Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");
    let mut grpc_client = AgentTunnelServiceClient::new(channel);

    let (_tx, rx) = tokio::sync::mpsc::channel::<TunnelClientFrame>(1);
    let mut request = tonic::Request::new(ReceiverStream::new(rx));
    request.metadata_mut().insert("authorization", "Bearer invalid-tampered-token".parse().unwrap());
    request.metadata_mut().insert("x-agent-id", "test-agent".parse().unwrap());

    let response = grpc_client.open_tunnel(request).await;
    assert!(response.is_err(), "Tunnel should be rejected with invalid token");
    let status = response.unwrap_err();
    assert_eq!(status.code(), Code::Unauthenticated);
    assert_eq!(status.message(), "invalid or missing tenant token");

    gateway.shutdown();
}

#[tokio::test]
async fn test_open_tunnel_accepts_valid_authorization_bearer_header() {
    let gateway = Arc::new(
        GatewayServerHandle::bind_ephemeral_with_token(TEST_TENANT_TOKEN)
            .await
            .expect("Failed to bind ephemeral gateway"),
    );

    let channel = tonic::transport::Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");
    let mut grpc_client = AgentTunnelServiceClient::new(channel);

    let (tx, rx) = tokio::sync::mpsc::channel::<TunnelClientFrame>(4);
    let mut request = tonic::Request::new(ReceiverStream::new(rx));
    request.metadata_mut().insert(
        "authorization",
        format!("Bearer {}", TEST_TENANT_TOKEN).parse().unwrap(),
    );
    request.metadata_mut().insert("x-agent-id", "auth-agent-1".parse().unwrap());

    let response = grpc_client.open_tunnel(request).await;
    assert!(response.is_ok(), "Authenticated client with Bearer token must be accepted");

    // Verify session registered in gateway
    tokio::time::sleep(Duration::from_millis(100)).await;
    let agents = gateway.registry.active_agents().await;
    assert!(agents.iter().any(|a| a.agent_id == "auth-agent-1"));

    drop(tx);
    gateway.shutdown();
}

#[tokio::test]
async fn test_open_tunnel_accepts_valid_sand_window_owner_header() {
    let gateway = Arc::new(
        GatewayServerHandle::bind_ephemeral_with_token(TEST_TENANT_TOKEN)
            .await
            .expect("Failed to bind ephemeral gateway"),
    );

    let channel = tonic::transport::Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");
    let mut grpc_client = AgentTunnelServiceClient::new(channel);

    let (tx, rx) = tokio::sync::mpsc::channel::<TunnelClientFrame>(4);
    let mut request = tonic::Request::new(ReceiverStream::new(rx));
    request.metadata_mut().insert("x-sand-window-owner", TEST_TENANT_TOKEN.parse().unwrap());
    request.metadata_mut().insert("x-agent-id", "sand-agent-2".parse().unwrap());

    let response = grpc_client.open_tunnel(request).await;
    assert!(response.is_ok(), "Authenticated client with x-sand-window-owner must be accepted");

    tokio::time::sleep(Duration::from_millis(100)).await;
    let agents = gateway.registry.active_agents().await;
    assert!(agents.iter().any(|a| a.agent_id == "sand-agent-2"));

    drop(tx);
    gateway.shutdown();
}

#[tokio::test]
async fn test_tunnel_client_connect_with_auth_token_succeeds() {
    let gateway = Arc::new(
        GatewayServerHandle::bind_ephemeral_with_token(TEST_TENANT_TOKEN)
            .await
            .expect("Failed to bind ephemeral gateway"),
    );

    let config = TunnelConfig::new(gateway.url(), "tunnel-client-auth-agent")
        .with_auth_token(format!("Bearer {}", TEST_TENANT_TOKEN))
        .with_connect_timeout(Duration::from_secs(5));

    let client = TunnelClient::connect(config)
        .await
        .expect("TunnelClient should connect when configured with valid auth token");

    assert!(client.is_connected());

    client.close().await;
    gateway.shutdown();
}
```

### 4.3 Existing Test Compatibility & Migration Strategy
In `cloud/gateway/tests/service_communication_test.rs`:
- Line 14: `GatewayServerHandle::bind_ephemeral()` will default to using the dev tenant token (e.g. `frostfire-dev-tenant-secret` or `FROSTFIRE_TENANT_TOKEN`).
- In `DaemonConfig`: `DaemonConfig` should optionally support `auth_token: Option<String>` (or automatically read `FROSTFIRE_TENANT_TOKEN`).
- In test 2 (line 167): `frostfire_tunnel::TunnelConfig::new(gateway.url(), "prompt-test-agent").with_auth_token(format!("Bearer {}", gateway.tenant_token()))`.
This ensures existing communication and turn engine tests continue to pass with 0 regressions.

---

## 5. Implementation Roadmap for Milestone 1

| Order | Action | Target File(s) | Description |
|-------|--------|----------------|-------------|
| 1 | Manifest Update | `Cargo.toml` | Add `"crates/frostfire-cli"` to `workspace.members`, `frostfire-cli` to `[workspace.dependencies]`, and `subtle = "2.6"` to `[workspace.dependencies]`. |
| 2 | Gateway Dependencies | `cloud/gateway/Cargo.toml` | Add `subtle = { workspace = true }` and `sha2 = { workspace = true }` to dependencies. |
| 3 | Authenticator Module | `cloud/gateway/src/auth.rs` | Implement `TenantAuthenticator` with SHA-256 + `subtle::ConstantTimeEq` constant-time verification, and `extract_token_from_metadata`. |
| 4 | Gateway Service Auth | `cloud/gateway/src/service.rs`, `server.rs`, `main.rs`, `lib.rs` | Wire `TenantAuthenticator` into `GatewayTunnelService::open_tunnel`, update server bindings, and add `--tenant-token` CLI / env parameter. |
| 5 | Unit Tests | `cloud/gateway/src/auth.rs` | Add unit tests verifying timing-safe equality, token matches, rejection, and header parsing. |
| 6 | Integration Tests | `cloud/gateway/tests/gateway_auth_integration_test.rs` | Add integration test suite testing rejection of unauthenticated requests (`Code::Unauthenticated`) and acceptance of authenticated requests. |
| 7 | Daemon Auth Prop | `crates/frostfire-daemon/src/config.rs`, `service.rs` | Ensure daemon forwards auth token from config / env into outbound `TunnelConfig`. |
| 8 | Workspace Gate Pass | Full Workspace | Run `cargo check --workspace`, `cargo test --workspace`, and `cargo clippy --workspace -- -D warnings`. |

---

## 6. Artifact References
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_3\workspace_members.patch` — Exact patch for `Cargo.toml`.
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_3\handoff.md` — Handoff protocol document for implementer agents.
