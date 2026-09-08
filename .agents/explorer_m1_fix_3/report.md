# Milestone 1 Remediation: Test Harness Review, Test Matrix & Verification Oracle

**Author**: Explorer M1-Fix-3  
**Target Milestone**: M1 (Cloud Gateway Hardening & Tenant Auth)  
**Date**: 2026-09-08  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_fix_3`  
**Status**: COMPLETE  

---

## 1. Executive Summary & Harness Review

Challengers M1-1 and M1-2 developed two empirical test suites to validate the security, protocol robustness, and resilience of `frostfire-gateway`:
1. **`cloud/gateway/tests/adversarial_m1_test.rs`** (Challenger M1-1):
   - **5 test suites**: Character boundary slicing, token fuzzing (2,100+ variations, 1..50k bytes), empirical constant-time timing consistency (100,000 ops, 0.24% delta), concurrent reconnect stress (15 workers, 150 cycles), and session hijacking prevention via `unregister_if_matching`.
   - **Current status**: **4 passed, 1 failed**.
   - **Failure site**: `challenge_utf8_char_boundary_slicing_in_extract_bearer_token` panicked on 5 multi-byte UTF-8 inputs crossing byte 7 and failed on empty bearer header extraction (`"Bearer "` returned `"Bearer"`).
2. **`cloud/gateway/tests/grpc_protocol_stress_test.rs`** (Challenger M1-2):
   - **12 test suites** across 3 functional groups: Strict gRPC error codes (`Code::Unauthenticated` with `"invalid or missing tenant token"`), corrupt token matrices (20 bearer formats, 9 window-owner formats), frame streaming limits up to 16MB without memory exhaustion or crash, 8 invalid frame payloads (None, corrupt JSON/XML, bad enum), raw socket garbage injection, and TLS 1.3 handshake rejections (plain HTTP, untrusted CA, domain SAN mismatch, garbage ClientHello).
   - **Current status**: **12 passed, 0 failed** (finished in 2.01s).
3. **Workspace-Wide Baseline**:
   - `cargo test --workspace --exclude frostfire-gateway` executed across all 12 other crates (`frostfire-proto`, `frostfire-tunnel`, `frostfire-exec`, `frostfire-security`, `frostfire-mcp`, `frostfire-daemon`, `frostfire-core`, `frostfire-engine`, `frostfire-cli`, `frostfire-orchestrator`, `cloud/agent`, `tests/e2e`): **100% passed (0 failures)**.
   - `cargo clippy --workspace -- -D warnings`: **0 warnings**.
   - **Conclusion**: The sole blocker across the entire repository preventing clean `cargo test --workspace` pass is the defect in `cloud/gateway/src/auth.rs:100-107`.

---

## 2. Root Cause Analysis & Challenger Conflict Resolution

### 2.1 The Defects in `cloud/gateway/src/auth.rs:100-107`

Existing code:
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

Two distinct defects are present:
1. **Defect 1: Unchecked UTF-8 Byte Indexing (Denial of Service)**:
   Rust string indexing `&str[..7]` requires that byte offset 7 is a valid UTF-8 code point boundary (`s.is_char_boundary(7)`). If an input has $\ge 7$ bytes and byte 7 falls inside a multi-byte sequence (e.g., a 2-byte character starting at byte 6, a 3-byte CJK character starting at byte 5, or a 4-byte emoji starting at byte 4), `trimmed[..7]` panics immediately. This crashes request handlers processing untrusted headers.
2. **Defect 2: Eager Trailing Whitespace Trimming**:
   `auth_header.trim()` eagerly removes both leading AND trailing whitespace. For input `"Bearer "`, `.trim()` strips the trailing space, resulting in `"Bearer"` (length 6). Because `6 >= 7` is false, it drops through to `trimmed`, incorrectly returning `"Bearer"` as the token value instead of the expected empty token `""`.

### 2.2 Reconciling the Conflict Between Challenger Proposals

A critical contradiction exists between the remediation proposed in Challenger 1's report and Challenger 1's own test harness:

- **Challenger 1 Proposed Code**:
  ```rust
  pub fn extract_bearer_token(auth_header: &str) -> &str {
      let trimmed = auth_header.trim_start();
      if let Some(prefix) = trimmed.get(..7) {
          if prefix.eq_ignore_ascii_case("bearer ") {
              return trimmed[7..].trim();
          }
      }
      if trimmed.eq_ignore_ascii_case("bearer") {
          return ""; // <-- CONFLICT!
      }
      auth_header.trim()
  }
  ```
- **Contradiction**:
  In Challenger 1's test file (`cloud/gateway/tests/adversarial_m1_test.rs:24`), the test case explicitly defines:
  ```rust
  ("Bearer", "Bearer"), // Exactly 6 chars (less than 7)
  ```
  If the remediation includes `if trimmed.eq_ignore_ascii_case("bearer") { return ""; }`, `extract_bearer_token("Bearer")` will return `""`, causing `adversarial_m1_test.rs` to FAIL on `"Bearer"`.
- **Authoritative Resolution**:
  Per gRPC/HTTP standards and the contract in `adversarial_m1_test.rs`:
  - A header containing `"Bearer <token>"` must extract `<token>`.
  - A header containing `"Bearer "` has an explicit prefix and empty token: must return `""`.
  - A header containing `"Bearer"` lacks the required space separator and is treated as a raw token value: must return `"Bearer"`.
  - Multi-byte slices must be bounds-checked via `.get(..7)`.

The correct, production-ready implementation for the Worker is:
```rust
pub fn extract_bearer_token(auth_header: &str) -> &str {
    let trimmed_leading = auth_header.trim_start();
    if let Some(prefix) = trimmed_leading.get(..7) {
        if prefix.eq_ignore_ascii_case("bearer ") {
            return trimmed_leading[7..].trim();
        }
    }
    auth_header.trim()
}
```

---

## 3. Comprehensive Test Matrix for Worker Remediation

| ID | Test Category | Target Component | Test Name / Location | Key Input / Scenario | Expected Outcome |
|---|---|---|---|---|---|
| **M1-TM-01** | Unit | `extract_bearer_token` | `cloud/gateway/src/auth.rs::tests` | Multi-byte UTF-8 crossing byte 7 (`"123456é"`, `"abcdefé"`, `"1234😀"`, `"12345中"`, `"\0\0\0\0\0\0é"`) | No panic; safely returns trimmed input |
| **M1-TM-02** | Unit | `extract_bearer_token` | `cloud/gateway/src/auth.rs::tests` | Empty / Whitespace Bearer (`"Bearer "`, `"Bearer   "`, `"  Bearer  "`) | Returns `""` without panic |
| **M1-TM-03** | Unit | `extract_bearer_token` | `cloud/gateway/src/auth.rs::tests` | Exact `"Bearer"` without space (`"Bearer"`, `"bearer"`, `"BEARER"`) | Returns `"Bearer"`, `"bearer"`, `"BEARER"` |
| **M1-TM-04** | Unit | `extract_bearer_token` | `cloud/gateway/src/auth.rs::tests` | Unicode tokens (`"Bearer \u{1F600}"`, `"bearer \u{00E9}"`, `"Bearer 🦀🔥⚡"`, `"Bearer 中文トークン"`) | Returns `"\u{1F600}"`, `"\u{00E9}"`, `"🦀🔥⚡"`, `"中文トークン"` |
| **M1-TM-05** | Unit | `extract_bearer_token` | `cloud/gateway/src/auth.rs::tests` | Mixed leading whitespace + Unicode prefix (`" \u{1F600}abc"`, `"   Bearer token  "`) | Safely parses or returns trimmed value |
| **M1-TM-06** | Unit | `authenticate_metadata` | `cloud/gateway/src/auth.rs::tests` | Authorization header with multi-byte non-bearer string (`"123456é"`) | Returns `Err(Status::unauthenticated("invalid or missing tenant token"))` (no panic) |
| **M1-TM-07** | Unit | `authenticate_metadata` | `cloud/gateway/src/auth.rs::tests` | Authorization header `"Bearer "` (empty token) | Returns `Err(Status::unauthenticated("invalid or missing tenant token"))` |
| **M1-TM-08** | Unit | `authenticate_metadata` | `cloud/gateway/src/auth.rs::tests` | Unicode valid token (`"Bearer \u{1F600}"` with configured token `"\u{1F600}"`) | Returns `Ok(())` |
| **M1-TM-09** | Adversarial Integration | `extract_bearer_token` | `adversarial_m1_test::challenge_utf8_char_boundary_slicing_in_extract_bearer_token` | 11 boundary test vectors | All 11 cases match expected results (0 panics, 0 failures) |
| **M1-TM-10** | Adversarial Integration | `TenantAuthenticator` | `adversarial_m1_test::challenge_fuzz_thousands_of_token_variations` | 2,100+ fuzzed tokens (1..50k bytes, nulls, control chars, prefixes) | Correctly distinguishes expected token; 0 crashes |
| **M1-TM-11** | Adversarial Integration | `TenantAuthenticator` | `adversarial_m1_test::challenge_constant_time_timing_consistency` | 100,000 ops (31-byte match vs 0-byte match) | Relative timing difference < 20% |
| **M1-TM-12** | Concurrency Stress | `SessionRegistry` + Gateway | `adversarial_m1_test::challenge_concurrent_reconnect_stress_and_session_lifecycle` | 15 workers, 150 connect/send/drop cycles | $\ge 80\%$ success under contention; 0 leaked sessions |
| **M1-TM-13** | Security Invariant | `SessionRegistry` | `adversarial_m1_test::challenge_session_hijacking_stale_eviction_prevention` | Session 1 disconnects after Session 2 connects | Stale unregister returns false; Session 2 remains active and receives frames |
| **M1-TM-14** | Protocol Invariant | Gateway gRPC | `grpc_protocol_stress_test::test_grpc_error_empty_metadata_strictly_unauthenticated` | Empty metadata | Returns `Code::Unauthenticated` with exact contract message |
| **M1-TM-15** | Protocol Invariant | Gateway gRPC | `grpc_protocol_stress_test::test_grpc_error_missing_auth_with_other_headers` | Custom metadata present, auth missing | Returns `Code::Unauthenticated` |
| **M1-TM-16** | Protocol Invariant | Gateway gRPC | `grpc_protocol_stress_test::test_grpc_error_corrupt_bearer_tokens_matrix` | 20 corrupt bearer tokens (nulls, control, invalid base64, unicode attacks) | All 20 return `Code::Unauthenticated` |
| **M1-TM-17** | Protocol Invariant | Gateway gRPC | `grpc_protocol_stress_test::test_grpc_error_corrupt_window_owner_tokens_matrix` | 9 corrupt `x-sand-window-owner` values | All 9 return `Code::Unauthenticated` |
| **M1-TM-18** | Protocol Invariant | Gateway gRPC | `grpc_protocol_stress_test::test_grpc_error_binary_metadata_and_non_ascii_rejected` | Binary header `authorization-bin` | Rejected with `Code::Unauthenticated` |
| **M1-TM-19** | Protocol Stress | Gateway gRPC | `grpc_protocol_stress_test::test_grpc_streaming_large_frames_up_to_16mb_no_crash` | 64KB, 512KB, 1MB, 2MB, 4MB, 8MB, 16MB | Gateway survives and processes subsequent valid heartbeat |
| **M1-TM-20** | Protocol Stress | Gateway gRPC | `grpc_protocol_stress_test::test_grpc_streaming_invalid_frame_payloads_no_crash` | 8 malformed payload types (None, bad timestamps, corrupt JSON/XML) | Gateway survives; responds to heartbeat |
| **M1-TM-21** | Resilience | Gateway Network | `grpc_protocol_stress_test::test_grpc_streaming_raw_garbage_socket_disconnect_resilience` | Arbitrary raw TCP bytes + abrupt connection drop | Gateway accepts subsequent valid client connection |
| **M1-TM-22** | TLS Invariant | Gateway TLS 1.3 | `grpc_protocol_stress_test::test_tls_rejects_plain_http_connection` | Plain HTTP request to TLS 1.3 port | Rejected at TLS handshake; gateway survives |
| **M1-TM-23** | TLS Invariant | Gateway TLS 1.3 | `grpc_protocol_stress_test::test_tls_rejects_untrusted_ca_certificate` | Client without CA trust bundle | TLS verification fails |
| **M1-TM-24** | TLS Invariant | Gateway TLS 1.3 | `grpc_protocol_stress_test::test_tls_rejects_wrong_domain_name` | SAN mismatch | TLS verification fails |
| **M1-TM-25** | TLS Invariant | Gateway TLS 1.3 | `grpc_protocol_stress_test::test_tls_server_survives_garbage_client_hello_and_serves_valid_client` | Port scanner / malformed ClientHello | Gateway survives and serves legitimate TLS client |
| **M1-TM-26** | Workspace Gate | Entire Repository | `cargo test --workspace` | All workspace tests across 13 crates | All tests pass with 0 failures, 0 errors |
| **M1-TM-27** | Linter Gate | Entire Repository | `cargo clippy --workspace -- -D warnings` | All workspace crates and tests | 0 warnings |

---

## 4. Recommended Unit Test Expansions for `cloud/gateway/src/auth.rs`

In addition to fixing `extract_bearer_token`, the Worker must co-locate regression unit tests inside `cloud/gateway/src/auth.rs::tests`. This ensures that unit-level testing immediately catches any regressions without requiring full integration runs.

### Proposed Code for `cloud/gateway/src/auth.rs::tests`

```rust
    #[test]
    fn test_extract_bearer_token_utf8_char_boundaries() {
        // Multi-byte characters crossing byte index 7
        assert_eq!(extract_bearer_token("123456\u{00E9}"), "123456\u{00E9}");
        assert_eq!(extract_bearer_token("abcdef\u{00E9}"), "abcdef\u{00E9}");
        assert_eq!(extract_bearer_token("1234\u{1F600}"), "1234\u{1F600}");
        assert_eq!(extract_bearer_token("12345\u{4E2D}"), "12345\u{4E2D}");
        assert_eq!(extract_bearer_token(" \u{1F600}abc"), "\u{1F600}abc");
        assert_eq!(extract_bearer_token("b\u{1F600}xyz"), "b\u{1F600}xyz");
        assert_eq!(
            extract_bearer_token("\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{00E9}"),
            "\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{00E9}"
        );

        // Multi-byte Unicode tokens preceded by Bearer prefix
        assert_eq!(extract_bearer_token("Bearer \u{1F600}"), "\u{1F600}");
        assert_eq!(extract_bearer_token("bearer \u{00E9}"), "\u{00E9}");
        assert_eq!(extract_bearer_token("Bearer 🦀🔥⚡"), "🦀🔥⚡");
        assert_eq!(extract_bearer_token("Bearer 中文トークン"), "中文トークン");
    }

    #[test]
    fn test_extract_bearer_token_prefix_and_whitespace_edge_cases() {
        // "Bearer" without space returns trimmed string
        assert_eq!(extract_bearer_token("Bearer"), "Bearer");
        assert_eq!(extract_bearer_token("bearer"), "bearer");
        assert_eq!(extract_bearer_token("BEARER"), "BEARER");

        // "Bearer " with space returns empty string
        assert_eq!(extract_bearer_token("Bearer "), "");
        assert_eq!(extract_bearer_token("Bearer   "), "");
        assert_eq!(extract_bearer_token("  Bearer  "), "");
        assert_eq!(extract_bearer_token("bearer \t\r\n"), "");

        // Empty and blank strings
        assert_eq!(extract_bearer_token(""), "");
        assert_eq!(extract_bearer_token("   "), "");

        // Normal bearer extraction with extra spacing
        assert_eq!(extract_bearer_token("Bearer a"), "a");
        assert_eq!(extract_bearer_token("   Bearer   token-123   "), "token-123");
    }

    #[test]
    fn test_authenticate_metadata_utf8_resilience() {
        let auth = TenantAuthenticator::new("secret-tenant-token");
        let mut map = MetadataMap::new();

        // Multi-byte string that would trigger char boundary panic in flawed slice
        map.insert(
            AUTH_HEADER_BEARER,
            MetadataValue::from_static("123456\u{00E9}"),
        );
        let err = auth.authenticate_metadata(&map).unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
        assert_eq!(err.message(), UNAUTHENTICATED_MSG);

        // Empty bearer token
        let mut map2 = MetadataMap::new();
        map2.insert(
            AUTH_HEADER_BEARER,
            MetadataValue::from_static("Bearer "),
        );
        let err2 = auth.authenticate_metadata(&map2).unwrap_err();
        assert_eq!(err2.code(), tonic::Code::Unauthenticated);
        assert_eq!(err2.message(), UNAUTHENTICATED_MSG);
    }
```

---

## 5. Verification Oracle

The Worker and Orchestrator must execute the following closed-loop verification gates in order:

### Gate 1: In-Crate Unit Tests
Execute the unit tests in `frostfire-gateway`:
```bash
cargo test -p frostfire-gateway --lib
```
- **Oracle Assertion**: Must pass all 11 unit tests (8 existing + 3 new test functions) with `0 failed`.

### Gate 2: Adversarial Integration Suite
Execute the empirical challenger regression suite:
```bash
cargo test -p frostfire-gateway --test adversarial_m1_test
```
- **Oracle Assertion**: Must pass all 5 tests:
  - `challenge_utf8_char_boundary_slicing_in_extract_bearer_token ... ok`
  - `challenge_fuzz_thousands_of_token_variations ... ok`
  - `challenge_constant_time_timing_consistency ... ok`
  - `challenge_concurrent_reconnect_stress_and_session_lifecycle ... ok`
  - `challenge_session_hijacking_stale_eviction_prevention ... ok`
- `0 failed; finished in under 2.0s`.

### Gate 3: Protocol Stress & Fault-Injection Suite
Execute the 12 empirical protocol stress tests:
```bash
cargo test -p frostfire-gateway --test grpc_protocol_stress_test
```
- **Oracle Assertion**: Must pass all 12 tests (all error code invariants, frame sizes up to 16MB, TLS 1.3 rejections) with `0 failed`.

### Gate 4: Existing Integration Test Suite
Execute the gateway's other integration tests:
```bash
cargo test -p frostfire-gateway --test gateway_auth_integration_test --test service_communication_test --test tls_tunnel_test
```
- **Oracle Assertion**: Must pass all 9 integration tests with `0 failed`.

### Gate 5: Full Workspace Clean Pass
Execute the complete workspace test suite across all 13 crates:
```bash
cargo test --workspace
```
- **Oracle Assertion**: Must pass 100% of workspace tests (over 180 tests total across all crates) with exit code `0`.

### Gate 6: Clippy Zero-Warning Linter Gate
Execute the workspace clippy linter:
```bash
cargo clippy --workspace -- -D warnings
```
- **Oracle Assertion**: Must complete with exit code `0` and `0 warnings`.
