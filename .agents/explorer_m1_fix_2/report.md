# Gateway & Daemon Codebase String Slicing and Panic Point Audit Report

**Date**: 2026-09-08  
**Auditor**: Explorer M1-Fix-2  
**Scope**: `cloud/gateway/src/`, `crates/frostfire-daemon/`, and ingress-connected dependencies  
**Mode**: Read-Only Investigation  

---

## 1. Executive Summary

This investigation performed a comprehensive static and semantic audit of all source files in `cloud/gateway/src/` (`auth.rs`, `main.rs`, `server.rs`, `service.rs`, `session.rs`, `lib.rs`), `crates/frostfire-daemon/src/` (`config.rs`, `orchestrator.rs`, `service.rs`, `lib.rs`), and downstream crates directly invoked by gateway frames.

### Audit Summary Matrix

| Crate / Module | File Path | Slicing / Indexing Operations | Panic Risk | Status / Verdict |
|---|---|---|---|---|
| `frostfire-gateway` | `cloud/gateway/src/auth.rs` | `trimmed[..7]`, `trimmed[7..]` | **CRITICAL** | **FAIL** (Panic on multi-byte UTF-8; trim defect on empty Bearer) |
| `frostfire-gateway` | `cloud/gateway/src/main.rs` | None | None | **PASS** (Zero slicing, clean error propagation) |
| `frostfire-gateway` | `cloud/gateway/src/server.rs` | None | None | **PASS** (Zero slicing, safe ephemeral/TLS bindings) |
| `frostfire-gateway` | `cloud/gateway/src/service.rs` | None (Direct) | None | **PASS** (Safe stream loop, constant-time auth call) |
| `frostfire-gateway` | `cloud/gateway/src/session.rs` | None | None | **PASS** (Safe atomic session registry) |
| `frostfire-gateway` | `cloud/gateway/src/lib.rs` | None | None | **PASS** (Module re-exports only) |
| `frostfire-daemon` | `crates/frostfire-daemon/src/orchestrator.rs` | None | None | **PASS** (Safe frame handlers, audit logging, jail validation) |
| `frostfire-daemon` | `crates/frostfire-daemon/src/service.rs` | None | None | **PASS** (Safe stream polling loop) |
| `frostfire-daemon` | `crates/frostfire-daemon/src/config.rs` | None | LOW | **PASS WITH NOTE** (Windows `\` in script deny-list) |
| `frostfire-orchestrator` | `services/swarm-orchestrator/src/gemini.rs` | `prompt[idx + 10..]` | **HIGH** | **SECONDARY FINDING** (Cross-string case-mapping slice panic in `process_prompt`) |
| `frostfire-cli` | `crates/frostfire-cli/src/ui.rs` | `&key[..4]`, `&key[key.len() - 4..]` | **MEDIUM** | **SECONDARY FINDING** (UTF-8 char boundary slice panic on non-ASCII key) |

---

## 2. Detailed Audit of `cloud/gateway/src/`

### 2.1 `cloud/gateway/src/auth.rs`
- **Lines 27–32 (`TenantAuthenticator::new`)**:
  ```rust
  let hash: [u8; 32] = Sha256::digest(expected_token.as_ref().as_bytes()).into();
  ```
  `Sha256::digest` deterministically returns a 32-byte `GenericArray<u8, U32>`. Conversion into `[u8; 32]` is guaranteed by type layout. Cannot panic.
- **Lines 49–56 (`TenantAuthenticator::validate_token`)**:
  Empty check prevents superfluous hashing. SHA-256 pre-hashing normalizes input to a fixed 32-byte array, and `subtle::ConstantTimeEq` guarantees constant-time comparison without leaking length. Cannot panic.
- **Lines 67–89 (`TenantAuthenticator::authenticate_metadata`)**:
  Header extraction uses `metadata.get(...).to_str()`. If non-ASCII or invalid bytes are present, `to_str()` returns `Err(ToStrError)` which is safely discarded via `if let Ok(str)`.
- **Lines 100–107 (`extract_bearer_token`) — DEFECT CONFIRMED**:
  ```rust
  pub fn extract_bearer_token(auth_header: &str) -> &str {
      let trimmed = auth_header.trim();
      if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("bearer ") {
          trimmed[7..].trim()
      } else {
          trimmed
      }
  }
  ```
  **Failure Mode 1 (UTF-8 Character Boundary Violation)**:
  `trimmed.len()` returns the byte length of the string slice. The range slice `trimmed[..7]` assumes byte index 7 is an exact Unicode scalar value boundary (`is_char_boundary(7) == true`). If an untrusted caller supplies a header where byte 7 falls inside a multi-byte sequence (such as 2-byte Latin `\u{00E9}`, 3-byte CJK `\u{4E2D}`, or 4-byte emoji `\u{1F600}`):
  ```text
  thread '...' panicked at cloud\gateway\src\auth.rs:102:37:
  end byte index 7 is not a char boundary; it is inside 'é' (bytes 6..8 of string)
  ```
  **Failure Mode 2 (Premature Trailing Whitespace Trim)**:
  `let trimmed = auth_header.trim();` strips both leading and trailing whitespace.
  When `auth_header == "Bearer "`, trimming reduces it to `"Bearer"` (length 6).
  The condition `trimmed.len() >= 7` evaluates to `false`, causing the function to return `"Bearer"` rather than the expected token value `""`.

### 2.2 `cloud/gateway/src/main.rs`
- **Lines 34–80**:
  - Command-line arguments parsed via `clap::Parser`.
  - Socket address parsed via `args.bind.parse()?`. All failure paths propagate `anyhow::Error`.
  - TLS files read with `tokio::fs::read` and propagated via `?`.
  - No string slicing, array indexing, or bare unwraps exist.

### 2.3 `cloud/gateway/src/server.rs`
- **Lines 41–130 (`GatewayServerHandle`)**:
  - `TcpListener::bind(addr_str).await?` propagates IO errors cleanly.
  - TLS provider registered with Ring (`rustls::crypto::ring::default_provider().install_default()`).
  - Server runs inside `tokio::spawn` with graceful shutdown signal.
  - No string indexing, slicing, or panic points.

### 2.4 `cloud/gateway/src/service.rs`
- **Lines 55–162 (`GatewayTunnelService`)**:
  - Metadata authentication occurs at line 63 *before* registering session or allocating resources.
  - Incoming stream messages are received in `while let Ok(Some(client_frame)) = in_stream.message().await`, which cleanly exits on client disconnection or stream reset.
  - Heartbeat auto-replies and session deregistration on termination are resilient.
  - Prompt dispatching (`handle UserPrompt`) calls `turn_engine.process_prompt()`. Error cases are converted to `TunnelServerFrame::Payload::ErrorFrame`.
  - No direct slicing or indexing operations exist.

### 2.5 `cloud/gateway/src/session.rs`
- **Lines 29–94 (`SessionRegistry`)**:
  - Internal storage uses `HashMap<String, (AgentSession, FrameSender)>` protected by `tokio::sync::RwLock`.
  - Disconnection eviction uses `unregister_if_matching` with UUID verification, preventing stale reconnections from removing active channels.
  - No string slicing or bracket indexing operations exist in production code (line 118 has `active[0]` in unit tests only).

---

## 3. Detailed Audit of `crates/frostfire-daemon/`

### 3.1 `crates/frostfire-daemon/src/orchestrator.rs`
- **Lines 142–270 (`handle_exec_command`)**:
  - CWD validation is delegated to `WorkspaceJail::validate_cwd()`. If rejected, a security error frame is dispatched without panicking.
  - Environment variables are scrubbed for `TOKEN` and `SECRET` substrings using standard `contains()`.
  - PTY dimensions are cast via `cmd.pty_rows as u16` and `cmd.pty_cols as u16`. In Rust, `as u16` performs standard wrapping truncation without panic.
  - Tamper-evident logging via `MerkleAuditLedger` writes errors cleanly to output frame.
- **Lines 284–360 (`handle_apply_patch`)**:
  - Target paths verified via `WorkspaceJail::resolve_path()`.
  - Patch application delegated to `AtomicPatchApplicator`.
- **Lines 367–410 (`handle_mcp_request`)**:
  - Allowlist checked via `mcp_proxy.is_tool_allowed()`.
- **Lines 442–506 (`handle_webauthn_request`)**:
  - Dispatched to `CredentialBroker::sign_webauthn_ceremony()`.
- **Verdict**: Zero string indexing, zero slicing, zero unwraps in production paths. Fully robust.

### 3.2 `crates/frostfire-daemon/src/config.rs`
- **Lines 171–180 (`AppConfig::load_from_dir`)**:
  - Safe file read and TOML parsing returning `Result<Self, ConfigError>`.
- **Lines 209–213 (`is_script_update_allowed`)**:
  ```rust
  pub fn is_script_update_allowed(script_name: &str) -> bool {
      let clean = script_name.trim();
      let base = clean.split('/').next_back().unwrap_or(clean);
      !BOX_SCRIPTS_DENY.contains(&base)
  }
  ```
  - **Observation / Hardening Recommendation**:
    `clean.split('/')` only handles forward slashes. If an update command contains Windows path separators (e.g. `scripts\sand-exit-watch`), `base` retains the backslash prefix and is not matched against `BOX_SCRIPTS_DENY`.
    *Recommendation*: Use `std::path::Path::new(clean).file_name()` or split on `['/', '\\']`.

### 3.3 `crates/frostfire-daemon/src/service.rs`
- Outbound gRPC connection established using `frostfire_tunnel::TunnelClient`.
- Frame processing dispatches tasks asynchronously with graceful shutdown on stream close. Zero slicing or panic points.

---

## 4. Secondary Ingress & Downstream Panic Points

During whole-workspace cross-reference analysis, two secondary panic points were identified that can be triggered by external/untrusted inputs:

### 4.1 Secondary Finding A: Cross-String Case-Mapping Slice in `gemini.rs`
- **Files**:
  - `services/swarm-orchestrator/src/gemini.rs:302–304`
  - `crates/frostfire-engine/src/gemini.rs:302–304`
- **Call Chain**:
  `cloud/gateway/src/service.rs:131` (`GatewayTunnelService::open_tunnel`)  
  $\rightarrow$ `AgentTurnEngine::process_prompt(&prompt_clone, ...)`  
  $\rightarrow$ `GeminiClient::generate_turn(&prompt.text, ...)`  
  $\rightarrow$ Mock prompt inspection (`gemini.rs:302–304`)
- **Vulnerable Code**:
  ```rust
  } else if let Some(idx) = prompt.to_lowercase().find("text kayla") {
      let rest = prompt[idx + 10..].trim();
      if rest.is_empty() { "Ill be coming to bed soon" } else { rest }
  }
  ```
- **Vulnerability Mechanism**:
  1. `prompt.to_lowercase()` creates a new `String`.
  2. In Unicode, uppercase-to-lowercase conversions do not preserve character byte lengths. For example, Latin Capital Letter I with Dot Above (`\u{0130}`, 2 bytes `0xC4 0xB0`) expands to two code units in lowercase: `i` + combining dot above (`\u{0069}\u{0307}`, 3 bytes `0x69 0xCC 0x87`).
  3. `prompt.to_lowercase().find("text kayla")` computes the byte index `idx` in the *lowered* string, and then indexes directly into the *original* string `prompt[idx + 10..]`.
  4. If `prompt` contains characters that shift byte counts before `"text kayla"`:
     - `idx + 10` can land in the middle of a multi-byte UTF-8 sequence in `prompt` $\rightarrow$ **Thread Panic**: `byte index ... is not a char boundary`.
     - `idx + 10` can exceed `prompt.len()` $\rightarrow$ **Thread Panic**: `byte index ... is out of bounds`.

### 4.2 Secondary Finding B: UI Key Preview Slicing in `ui.rs`
- **File**: `crates/frostfire-cli/src/ui.rs:375–379`
- **Vulnerable Code**:
  ```rust
  let preview = if key.len() > 8 {
      format!("{}...{}", &key[..4], &key[key.len() - 4..])
  } else {
      "***".to_string()
  };
  ```
- **Vulnerability Mechanism**:
  `key.len()` evaluates byte count. If `key` is set to a non-ASCII token or contains multi-byte UTF-8 characters, `&key[..4]` or `&key[key.len() - 4..]` panics if byte 4 or `key.len() - 4` is not a char boundary.

---

## 5. Recommended Safe Implementations

### Remediation for Finding 1: `cloud/gateway/src/auth.rs`

Replace `cloud/gateway/src/auth.rs` lines 100–107 with:

```rust
/// Extracts the token portion from an Authorization header value.
/// Handles Bearer <token>, bearer <token>, BEARER <token>, or a raw token.
/// Safe against invalid or multi-byte UTF-8 character boundaries.
pub fn extract_bearer_token(auth_header: &str) -> &str {
    let trimmed_start = auth_header.trim_start();
    if let Some(prefix) = trimmed_start.get(..7) {
        if prefix.eq_ignore_ascii_case("bearer ") {
            return trimmed_start.get(7..).map(|s| s.trim()).unwrap_or("");
        }
    }
    auth_header.trim()
}
```

#### Why This Fix Is Safe and Correct:
1. `trimmed_start.get(..7)` uses `.get()` which returns `Option<&str>`. If byte 7 is out of bounds or in the middle of a multi-byte UTF-8 codepoint, it returns `None` without panicking.
2. If `prefix.eq_ignore_ascii_case("bearer ")` matches:
   - The first 7 bytes are confirmed to be ASCII (`b'b'|b'B', b'e'|b'E', b'a'|b'A', b'r'|b'R', b'e'|b'E', b'r'|b'R', b' '`).
   - Byte index 7 is guaranteed to be a valid char boundary.
   - `trimmed_start.get(7..).map(|s| s.trim()).unwrap_or("")` safely extracts the remainder, trims leading and trailing whitespace, and returns `""` if empty.
3. If no `"bearer "` prefix is present, it returns `auth_header.trim()`.
4. Handles all adversarial test inputs:
   - `"123456\u{00E9}"` $\rightarrow$ returns `"123456\u{00E9}"` (no panic).
   - `"abcdef\u{00E9}"` $\rightarrow$ returns `"abcdef\u{00E9}"` (no panic).
   - `"1234\u{1F600}"` $\rightarrow$ returns `"1234\u{1F600}"` (no panic).
   - `"12345\u{4E2D}"` $\rightarrow$ returns `"12345\u{4E2D}"` (no panic).
   - `"Bearer "` $\rightarrow$ returns `""` (no bogus `"Bearer"` token).
   - `"Bearer"` $\rightarrow$ returns `"Bearer"`.
   - `"Bearer secret"` $\rightarrow$ returns `"secret"`.
   - `"  Bearer   secret  "` $\rightarrow$ returns `"secret"`.

---

### Remediation for Secondary Finding A: `services/swarm-orchestrator/src/gemini.rs`

Replace lines 302–305 with boundary-safe extraction on the original string:

```rust
} else if let Some((idx, _)) = prompt.char_indices().find(|&(i, _)| {
    prompt.get(i..i + 10).map_or(false, |s| s.eq_ignore_ascii_case("text kayla"))
}) {
    let rest = prompt.get(idx + 10..).map(|s| s.trim()).unwrap_or("");
    if rest.is_empty() { "Ill be coming to bed soon" } else { rest }
```

---

### Remediation for Secondary Finding B: `crates/frostfire-cli/src/ui.rs`

Replace lines 375–379 with char-based slicing:

```rust
let preview = {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() > 8 {
        let first4: String = chars[..4].iter().collect();
        let last4: String = chars[chars.len() - 4..].iter().collect();
        format!("{}...{}", first4, last4)
    } else {
        "***".to_string()
    }
};
```

---

## 6. Verification Method

Workers implementing the remediation can independently verify:

1. **Targeted Adversarial Unit Test**:
   ```bash
   cargo test --package frostfire-gateway --test adversarial_m1_test challenge_utf8_char_boundary_slicing_in_extract_bearer_token
   ```
   Must pass with 0 failures.

2. **Full Gateway Integration & Stress Suite**:
   ```bash
   cargo test -p frostfire-gateway
   ```

3. **Workspace Acceptance Gates**:
   ```bash
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
