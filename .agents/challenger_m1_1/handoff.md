# Milestone 1 Empirical Challenge & Verification Report

**Verdict**: `FAIL` (Remediation Required for `cloud/gateway/src/auth.rs`)

---

## Challenge Summary

**Overall risk assessment**: HIGH (Denial-of-Service / Panic on Untrusted Input & Auth Bypass Edge Case)

| Dimension | Target | Result | Risk |
|---|---|---|---|
| **Constant-Time Comparison** | `TenantAuthenticator::validate_token` | **PASS** (0.24% timing delta across 100,000 iterations) | LOW |
| **Token Fuzzing** | `TenantAuthenticator::validate_token` | **PASS** (2,100+ random variations, 1..50k bytes, nulls, control chars) | LOW |
| **Session Hijacking** | `SessionRegistry::unregister_if_matching` | **PASS** (Stale connections cannot evict newer reconnected sessions) | LOW |
| **Concurrent Reconnect Stress** | `SessionRegistry` + Ephemeral Gateway | **PASS** (15 concurrent workers, 150 cycles, 0 leaks, 0 deadlocks) | LOW |
| **UTF-8 Char Boundary Slicing** | `extract_bearer_token` (`auth.rs:102`) | **FAIL** (Panics on multi-byte UTF-8 str crossing byte index 7) | **CRITICAL** |
| **Empty Bearer Extraction** | `extract_bearer_token` (`auth.rs:101`) | **FAIL** (`"Bearer "` returns `"Bearer"` instead of `""`) | **MEDIUM** |

---

## 1. Observation

### Observation 1: Panic on Multi-Byte UTF-8 in `extract_bearer_token`
- **File**: `cloud/gateway/src/auth.rs`, Line 102, Column 37:
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
- **Test Executed**: `cargo test --package frostfire-gateway --test adversarial_m1_test challenge_utf8_char_boundary_slicing_in_extract_bearer_token`
- **Verbatim Error**:
  ```text
  thread 'challenge_utf8_char_boundary_slicing_in_extract_bearer_token' (15724) panicked at cloud\gateway\src\auth.rs:102:37:
  end byte index 7 is not a char boundary; it is inside 'é' (bytes 6..8 of string)
  thread 'challenge_utf8_char_boundary_slicing_in_extract_bearer_token' (15724) panicked at cloud\gateway\src\auth.rs:102:37:
  end byte index 7 is not a char boundary; it is inside '😀' (bytes 4..8 of string)
  thread 'challenge_utf8_char_boundary_slicing_in_extract_bearer_token' (15724) panicked at cloud\gateway\src\auth.rs:102:37:
  end byte index 7 is not a char boundary; it is inside '中' (bytes 5..8 of string)
  ```

### Observation 2: Flawed Trimming of Empty Bearer Headers
- **File**: `cloud/gateway/src/auth.rs`, Line 101:
- **Test Case**: `extract_bearer_token("Bearer ")`
- **Verbatim Result**:
  ```text
  extract_bearer_token("Bearer ") returned "Bearer", expected ""
  ```
  `auth_header.trim()` strips trailing whitespace before length inspection. `"Bearer ".trim()` becomes `"Bearer"` (length 6). Because `6 >= 7` is false, it falls through to `trimmed`, returning `"Bearer"`, causing the authenticator to attempt validating the literal string `"Bearer"` as the tenant token secret.

### Observation 3: Constant-Time Invariance Verified
- **File**: `cloud/gateway/src/auth.rs`, Lines 49–56:
  ```rust
  pub fn validate_token(&self, candidate: &str) -> bool {
      if candidate.is_empty() {
          return false;
      }
      let candidate_hash: [u8; 32] = Sha256::digest(candidate.as_bytes()).into();
      let ct_result = self.expected_token_hash.ct_eq(&candidate_hash);
      ct_result.into()
  }
  ```
- **Empirical Measurement** (100,000 iterations in `challenge_constant_time_timing_consistency`):
  - 31-byte matching prefix candidate: `62.53 ns/op`
  - 0-byte matching candidate: `62.38 ns/op`
  - Absolute difference: `0.15 ns`
  - Relative difference: `0.24%` (well within statistical noise ceiling of 20%)

### Observation 4: Session Hijacking and Orphaned Sender Protection Verified
- **File**: `cloud/gateway/src/session.rs`, Lines 42–52:
  ```rust
  pub async fn unregister_if_matching(&self, agent_id: &str, session_id: uuid::Uuid) -> bool {
      let mut map = self.sessions.write().await;
      if let Some((session, _)) = map.get(agent_id) {
          if session.session_id == session_id {
              map.remove(agent_id);
              return true;
          }
      }
      false
  }
  ```
- **Test Results**:
  - `challenge_session_hijacking_stale_eviction_prevention`: Stale session disconnect returned `false` on unregister; active session 2 remained registered and receivable.
  - `challenge_concurrent_reconnect_stress_and_session_lifecycle`: 15 concurrent worker tasks completed 150 connect/send/disconnect cycles under high contention; `active_agents()` cleanly reached 0 with 0 orphaned sender channels.

---

## 2. Logic Chain

1. **Premise 1**: In Rust, indexing into a string slice with byte indices `s[..N]` requires that `N` is an index at a valid UTF-8 character boundary (`s.is_char_boundary(N) == true`). If `N` falls between code units of a multi-byte code point, the Rust standard library immediately executes a thread panic (Observation 1).
2. **Premise 2**: `extract_bearer_token` is a public function in `frostfire_gateway::auth` and is invoked during request authentication in `authenticate_metadata` (Observation 1).
3. **Premise 3**: When an untrusted client supplies an Authorization header with length $\ge 7$ where byte 7 is inside a multi-byte UTF-8 character (such as `"123456\u{00E9}"`, `"1234\u{1F600}"`, `"12345\u{4E2D}"`), `trimmed[..7]` panics.
4. **Premise 4**: A panic in the gRPC request handler task crashes the handler and causes denial of service.
5. **Premise 5**: Furthermore, `auth_header.trim()` on line 101 strips trailing spaces before checking for the `"bearer "` prefix. An authorization header of `"Bearer "` is reduced to `"Bearer"` (length 6), bypassing prefix extraction and incorrectly returning `"Bearer"` as the token value (Observation 2).
6. **Conclusion**: While constant-time token comparison and concurrent session recovery logic are fully robust, Milestone 1 cannot be approved in production until the string indexing panic and trim flaw in `extract_bearer_token` are resolved.

---

## 3. Caveats

- In tonic's standard HTTP/2 transport, header values inserted via `MetadataValue::from_str` are restricted to visible ASCII (`b' '..=b'~'`). However, `extract_bearer_token` is a public library function that can be called by reverse proxies, display routers (`sand-window-router.mjs`), WebSocket bridges, or internal services where headers may contain raw UTF-8 strings or query parameters.
- Timing measurements were taken on local multi-core Windows environment; network latency jitter across WAN was simulated in-process on ephemeral TCP loopback.

---

## 4. Conclusion

**Verdict**: `FAIL`

Milestone 1 is **rejected** due to a confirmed panicking vulnerability and logic flaw in `cloud/gateway/src/auth.rs`:
1. `extract_bearer_token` panics when given inputs with multi-byte UTF-8 characters crossing byte index 7.
2. `extract_bearer_token("Bearer ")` returns `"Bearer"` instead of `""`.

### Required Remediation for Worker
Update `cloud/gateway/src/auth.rs` lines 100–107 to safely slice character boundaries and handle leading whitespace properly:

```rust
pub fn extract_bearer_token(auth_header: &str) -> &str {
    let trimmed = auth_header.trim_start();
    if let Some(prefix) = trimmed.get(..7) {
        if prefix.eq_ignore_ascii_case("bearer ") {
            return trimmed[7..].trim();
        }
    }
    if trimmed.eq_ignore_ascii_case("bearer") {
        return "";
    }
    auth_header.trim()
}
```

---

## 5. Verification Method

To verify the failure and subsequent fix:

1. **Run Adversarial Suite**:
   ```bash
   cargo test --package frostfire-gateway --test adversarial_m1_test
   ```
   - **Current Result**: Fails with 1 panic in `challenge_utf8_char_boundary_slicing_in_extract_bearer_token`.
   - **Expected Result after remediation**: All 5 tests pass (0 failures, 0 warnings).

2. **Run Full Workspace Gate**:
   ```bash
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
