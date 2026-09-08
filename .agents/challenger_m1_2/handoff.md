# Handoff: Challenger M1-2 Empirical Protocol Stress & Invariants Report

## 1. Observation

### 1.1 Empirical Protocol Stress Testing (`cloud/gateway/tests/grpc_protocol_stress_test.rs`)
Executed 12 automated empirical stress tests validating gRPC error invariants, streaming limits, and TLS 1.3 edge cases:
- Command: `cargo test -p frostfire-gateway --test grpc_protocol_stress_test`
- Result: 12 passed; 0 failed; finished in 2.02s:
  1. `test_grpc_error_empty_metadata_strictly_unauthenticated`: Request with empty metadata returns `Code::Unauthenticated` with message `"invalid or missing tenant token"`.
  2. `test_grpc_error_missing_auth_with_other_headers`: Request with `x-agent-id`, `user-agent`, and `x-custom-meta` but missing auth returns `Code::Unauthenticated` with `"invalid or missing tenant token"`.
  3. `test_grpc_error_corrupt_bearer_tokens_matrix`: Tested 20 corrupt/malformed bearer variations (`Bearer `, `Bearer \t\r\n`, `Bearer !!!@@@###$$$`, `Bearer invalid_base64_====`, `Basic ...`, `Token ...`, `Bearer null`, `Bearer 🦀🔥⚡...`). All 20 returned `Code::Unauthenticated`.
  4. `test_grpc_error_corrupt_window_owner_tokens_matrix`: Tested corrupt `x-sand-window-owner` values (`""`, `"   "`, `"invalid-token"`). All returned `Code::Unauthenticated`.
  5. `test_grpc_error_binary_metadata_and_non_ascii_rejected`: Binary header `authorization-bin` without valid ASCII auth was rejected with `Code::Unauthenticated`.
  6. `test_grpc_streaming_large_frames_up_to_16mb_no_crash`: Sent frames of sizes 64KB, 512KB, 1MB, 2MB, 4MB, 8MB, and 16MB. Gateway did not panic or crash. Subsequent client immediately connected and completed heartbeat ping/pong.
  7. `test_grpc_streaming_invalid_frame_payloads_no_crash`: Sent `payload: None`, extreme timestamps (`i64::MIN`, `i64::MAX`), empty/invalid `TerminalOutputChunk`, corrupt `ApplyPatch`, malformed `McpInvokeRequest` JSON, malformed `ApprovalRequest` JSON, out-of-range `DisplayTakeoverEvent` enum, and empty `UserPrompt`. Gateway did not panic or crash; responded normally to subsequent heartbeat.
  8. `test_grpc_streaming_raw_garbage_socket_disconnect_resilience`: Sent raw non-HTTP/2 garbage bytes and abrupt TCP socket disconnects; gateway survived and accepted subsequent valid gRPC connections.
  9. `test_tls_rejects_plain_http_connection`: Plain HTTP gRPC call to TLS endpoint failed at TLS layer; gateway survived.
  10. `test_tls_rejects_untrusted_ca_certificate`: Connection without custom CA cert failed TLS verification; gateway survived.
  11. `test_tls_rejects_wrong_domain_name`: Connection with SAN mismatch failed TLS verification; gateway survived.
  12. `test_tls_server_survives_garbage_client_hello_and_serves_valid_client`: Sent garbage bytes to TLS port, then verified valid TLS 1.3 client connected and received heartbeat ack.

### 1.2 Observed Failures in Workspace Suite (`cloud/gateway/src/auth.rs`)
- Command: `cargo test --workspace`
- Exit code: 1 (FAILED)
- Verbatim error in `cloud/gateway/tests/adversarial_m1_test.rs`:
```
---- challenge_utf8_char_boundary_slicing_in_extract_bearer_token stdout ----
thread 'challenge_utf8_char_boundary_slicing_in_extract_bearer_token' (45648) panicked at cloud\gateway\src\auth.rs:102:37:
end byte index 7 is not a char boundary; it is inside 'é' (bytes 6..8 of string)
[BUG CONFIRMED] extract_bearer_token panicked on input: "123456é"
[BUG CONFIRMED] extract_bearer_token panicked on input: "abcdefé"
[BUG CONFIRMED] extract_bearer_token panicked on input: "1234😀"
[BUG CONFIRMED] extract_bearer_token panicked on input: "12345中"
[BUG CONFIRMED] extract_bearer_token panicked on input: "\0\0\0\0\0\0é"

thread 'challenge_utf8_char_boundary_slicing_in_extract_bearer_token' (45648) panicked at cloud\gateway\tests\adversarial_m1_test.rs:57:9:
FAIL: extract_bearer_token failed on 6 inputs:
extract_bearer_token("123456é") panicked due to unverified char boundary slicing!
extract_bearer_token("abcdefé") panicked due to unverified char boundary slicing!
extract_bearer_token("1234😀") panicked due to unverified char boundary slicing!
extract_bearer_token("12345中") panicked due to unverified char boundary slicing!
extract_bearer_token("Bearer ") returned "Bearer", expected ""
extract_bearer_token("\0\0\0\0\0\0é") panicked due to unverified char boundary slicing!
```

### 1.3 Code Inspection of Bug Site (`cloud/gateway/src/auth.rs:100-107`)
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
Two defects present:
1. `trimmed[..7]` performs direct byte indexing without verifying `trimmed.is_char_boundary(7)`. If byte 7 falls inside a multi-byte UTF-8 character (such as `é` spanning bytes 6..8 or an emoji spanning bytes 4..8), the Rust runtime panics.
2. `let trimmed = auth_header.trim();` eagerly strips trailing whitespace before prefix inspection. For `"Bearer "`, `trimmed` becomes `"Bearer"` (length 6), failing `trimmed.len() >= 7`, and returning `"Bearer"` instead of the expected empty token `""`.

---

## 2. Logic Chain

1. **Gate Invariant**: The project acceptance criteria (`ORIGINAL_REQUEST.md §Acceptance` and `AGENTS.md`) mandate: `cargo test --workspace` must pass with 0 failures and 0 warnings.
2. **Defect Impact**:
   - `extract_bearer_token` is a public utility in `frostfire_gateway::auth::extract_bearer_token` invoked on every incoming request in `TenantAuthenticator::authenticate_metadata`.
   - Feeding any input containing multi-byte UTF-8 where index 7 is mid-codepoint triggers an unhandled thread panic.
   - For input `"Bearer "`, eager trimming returns `"Bearer"` rather than an empty string.
3. **Empirical Gate Result**: `cargo test --workspace` exited with code 1 due to `challenge_utf8_char_boundary_slicing_in_extract_bearer_token` failing.
4. **Constraint Enforcement**: Per Challenger instructions, challengers review and find bugs, but do NOT modify implementation code. The fix must be applied by a worker.
5. **Verdict**: Because `cargo test --workspace` fails and the authentication parser panics on multi-byte UTF-8 inputs, the milestone cannot be approved in its current state.

---

## 3. Caveats

- All gRPC frame streaming invariants (up to 16MB) and invalid payload handlings pass cleanly without crashing or panicking the gateway.
- TLS 1.3 handshake rejections (plain HTTP, untrusted CA, domain SAN mismatch, and garbage ClientHello) are robust and do not cause denial of service.
- All 12 empirical tests in `cloud/gateway/tests/grpc_protocol_stress_test.rs` pass.
- The failure is isolated to `cloud/gateway/src/auth.rs:100-107` and its impact on `cargo test --workspace`.

---

## 4. Conclusion

**Verdict**: **FAIL**

### Required Fixes for Worker:
In `cloud/gateway/src/auth.rs`, rewrite `extract_bearer_token` to avoid eager trailing trim and check char boundaries or use prefix stripping:
```rust
pub fn extract_bearer_token(auth_header: &str) -> &str {
    let trimmed_leading = auth_header.trim_start();
    if trimmed_leading.len() >= 7 
        && trimmed_leading.is_char_boundary(7) 
        && trimmed_leading[..7].eq_ignore_ascii_case("bearer ") 
    {
        trimmed_leading[7..].trim()
    } else {
        auth_header.trim()
    }
}
```
Applying this fix will resolve the UTF-8 char boundary panic and the `"Bearer "` extraction defect, enabling `cargo test --workspace` to pass with 0 failures.

---

## 5. Verification Method

1. Run the empirical gRPC protocol stress test suite:
   ```bash
   cargo test -p frostfire-gateway --test grpc_protocol_stress_test
   ```
   (Must pass all 12 tests).
2. Run the full workspace test suite:
   ```bash
   cargo test --workspace
   ```
   (Must achieve 0 failures across all crates once `auth.rs` is remediated).
3. Run workspace clippy:
   ```bash
   cargo clippy --workspace -- -D warnings
   ```
