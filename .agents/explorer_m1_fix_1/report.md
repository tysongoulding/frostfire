# Investigation Report: UTF-8 Character Boundary Slicing Panic & Remediation Strategy

**Target**: `cloud/gateway/src/auth.rs` (`extract_bearer_token`)  
**Scope**: Milestone 1 Remediation (Authentication & Ingress Hardening)  
**Author**: Explorer M1-Fix-1  
**Date**: 2026-09-08T20:55:00Z  

---

## 1. Executive Summary

A critical panic vulnerability and a logic bug exist in `extract_bearer_token` at `cloud/gateway/src/auth.rs:100-107`. Unchecked byte slicing `trimmed[..7]` triggers a thread panic whenever byte 7 falls inside a multi-byte UTF-8 character, enabling remote unauthenticated Denial of Service (DoS). Additionally, eager trimming via `auth_header.trim()` strips trailing whitespace before inspecting length, causing `"Bearer "` to return `"Bearer"` instead of `""`. 

This report provides the mathematical proof of the defect, resolves conflicting proposals from Challenger M1-1 and M1-2, and supplies the exact, verified zero-allocation remediation strategy using Rust standard library `str::get(..7)`.

---

## 2. Problem Analysis & Root Cause

### 2.1 Defect 1: UTF-8 Character Boundary Slicing Panic (CWE-1286 / Denial of Service)

- **Location**: `cloud/gateway/src/auth.rs`, Line 102
- **Original Code**:
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
- **Mechanism**:
  Rust strings (`&str`) are UTF-8 encoded byte sequences. Slicing with range syntax `s[..N]` requires that `N` satisfies `s.is_char_boundary(N)`. If `N` falls between code units of a multi-byte Unicode scalar value, the Rust runtime aborts with `panic!("end byte index 7 is not a char boundary; it is inside ...")`.
- **Trigger**:
  The condition `trimmed.len() >= 7` verifies only the *byte length* of the slice, not its Unicode character boundaries. When an untrusted client supplies an Authorization header where byte 7 is inside a multi-byte UTF-8 sequence, the gateway panics immediately:
  - `"123456\u{00E9}"`: 6 ASCII bytes (0..6) + 2-byte `é` (`0xC3 0xA9`, bytes 6..8). Byte 7 is mid-character.
  - `"1234\u{1F600}"`: 4 ASCII bytes (0..4) + 4-byte `😀` (`0xF0 0x9F 0x98 0x80`, bytes 4..8). Byte 7 is mid-character.
  - `"12345\u{4E2D}"`: 5 ASCII bytes (0..5) + 3-byte `中` (`0xE4 0xB8 0xAD`, bytes 5..8). Byte 7 is mid-character.
  - `"\0\0\0\0\0\0é"`: 6 null bytes (0..6) + 2-byte `é` (bytes 6..8). Byte 7 is mid-character.
- **Impact**:
  `extract_bearer_token` is called by `TenantAuthenticator::authenticate_metadata` during gRPC metadata inspection. Any external network request with such a header crashes the connection handling task in `frostfire-gateway`.

### 2.2 Defect 2: Eager Trimming of Trailing Whitespace in Empty Bearer Headers

- **Location**: `cloud/gateway/src/auth.rs`, Line 101
- **Mechanism**:
  `let trimmed = auth_header.trim();` strips both leading AND trailing whitespace.
  - For input `"Bearer "`, `.trim()` strips the trailing space, producing `"Bearer"` (length 6).
  - The length check `trimmed.len() >= 7` evaluates `6 >= 7`, which is `false`.
  - Execution branches to `else { trimmed }`, returning `"Bearer"`.
- **Impact**:
  The function erroneously returns `"Bearer"` instead of the empty token `""`. This causes the authenticator to test whether the literal string `"Bearer"` matches the secret tenant token. Furthermore, `adversarial_m1_test.rs` explicitly asserts `assert_eq!(extract_bearer_token("Bearer "), "")`.

---

## 3. Synthesis & Evaluation of Challenger Proposals

Two independent Challenger agents evaluated this failure:

| Aspect | Challenger M1-1 Proposal | Challenger M1-2 Proposal | Synthesized Evaluation |
|---|---|---|---|
| **Prefix Slicing** | `trimmed.get(..7)` | `trimmed.len() >= 7 && trimmed.is_char_boundary(7) && trimmed[..7]` | Both prevent slicing panic. `str::get(..7)` is more idiomatic Rust. |
| **Leading Trim** | `auth_header.trim_start()` | `auth_header.trim_start()` | Consensus: Only trim leading whitespace before inspecting the 7-byte `"Bearer "` prefix. |
| **Trailing/Empty Branch** | Added `if trimmed.eq_ignore_ascii_case("bearer") { return ""; }` | Returned `auth_header.trim()` in `else` | **Conflict Identified**: Challenger M1-1's extra branch breaks test case `("Bearer", "Bearer")`! |

### Conflict Resolution:
Challenger M1-1 suggested:
```rust
if trimmed.eq_ignore_ascii_case("bearer") {
    return "";
}
```
However, in `cloud/gateway/tests/adversarial_m1_test.rs:24`:
```rust
("Bearer", "Bearer"), // Exactly 6 chars (less than 7)
```
When an Authorization header contains `"Bearer"` without trailing space or token, it is treated as a raw token named `"Bearer"`. Challenger M1-1's proposed branch would return `""`, causing a regression failure on `("Bearer", "Bearer")`.

Challenger M1-2's control flow correctly returns `auth_header.trim()` when `"Bearer "` (with space) is not present.

---

## 4. Remediation Strategy

### 4.1 Optimal Implementation
Combining `trim_start()` with `str::get(..7)`:

```rust
/// Extracts the token portion from an Authorization header value.
/// Handles Bearer <token>, bearer <token>, BEARER <token>, or a raw token.
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

### 4.2 Mathematical Proof of Panic-Freedom & Correctness

1. **Safety of `trimmed_leading.get(..7)`**:
   `str::get` is guaranteed by the Rust standard library specification:
   - If `7 > trimmed_leading.len()`, returns `None`.
   - If `!trimmed_leading.is_char_boundary(7)`, returns `None`.
   - Returns `Some(&str)` if and only if byte 7 is within bounds and on a valid UTF-8 character boundary.
   - **Never panics under any input**.

2. **Safety of `trimmed_leading[7..]`**:
   - `trimmed_leading[7..]` is evaluated only when `prefix.eq_ignore_ascii_case("bearer ")` evaluates to `true`.
   - `"bearer "` consists of 7 ASCII characters (`b'b'`, `b'e'`, `b'a'`, `b'r'`, `b'e'`, `b'r'`, `b' '`).
   - In UTF-8, all ASCII characters (values `0x00..=0x7F`) are strictly 1 byte in length.
   - Therefore, if the first 7 bytes match `"bearer "` case-insensitively, byte offset 7 is **mathematically guaranteed to be a UTF-8 character boundary**.
   - Slicing `trimmed_leading[7..]` is 100% panic-free.

3. **Empty Token Handling**:
   - For `"Bearer "`: `trimmed_leading` is `"Bearer "`. `prefix` matches. `trimmed_leading[7..]` is `""`. `"".trim()` returns `""`.
   - For `"Bearer   "`: `trimmed_leading[7..]` is `"  "`. `"  ".trim()` returns `""`.
   - For `"Bearer"`: length is 6. `get(..7)` returns `None`. Falls through to `auth_header.trim()` returning `"Bearer"`.
   - For `"  Bearer   token  "`: `trimmed_leading` is `"Bearer   token  "`. `trimmed_leading[7..]` is `"   token  "`. Returns `"token"`.

4. **Zero Allocation**:
   - No `String` or `Vec` allocations; all operations are borrowed string slice references (`&'a str -> &'a str`).

---

## 5. Exact Code Changes

### Target File: `cloud/gateway/src/auth.rs`

#### Diff:
```patch
--- a/cloud/gateway/src/auth.rs
+++ b/cloud/gateway/src/auth.rs
@@ -100,8 +100,10 @@ impl Default for TenantAuthenticator {
 pub fn extract_bearer_token(auth_header: &str) -> &str {
-    let trimmed = auth_header.trim();
-    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("bearer ") {
-        trimmed[7..].trim()
-    } else {
-        trimmed
-    }
+    let trimmed_leading = auth_header.trim_start();
+    if let Some(prefix) = trimmed_leading.get(..7) {
+        if prefix.eq_ignore_ascii_case("bearer ") {
+            return trimmed_leading[7..].trim();
+        }
+    }
+    auth_header.trim()
 }
```

### In-Crate Unit Tests Enhancement:
Add test cases in `cloud/gateway/src/auth.rs` under `mod tests`:

```rust
    #[test]
    fn test_extract_bearer_token_edge_cases() {
        assert_eq!(extract_bearer_token("Bearer "), "");
        assert_eq!(extract_bearer_token("Bearer"), "Bearer");
        assert_eq!(extract_bearer_token("123456\u{00E9}"), "123456\u{00E9}");
        assert_eq!(extract_bearer_token("1234\u{1F600}"), "1234\u{1F600}");
        assert_eq!(extract_bearer_token("Bearer \u{1F600}"), "\u{1F600}");
    }
```

---

## 6. Verification Plan

1. **Targeted Adversarial Test**:
   ```bash
   cargo test --package frostfire-gateway --test adversarial_m1_test
   ```
   *Expectation*: All 5 tests pass (5 passed; 0 failed).

2. **In-Crate Auth Tests**:
   ```bash
   cargo test --package frostfire-gateway --lib auth::tests
   ```
   *Expectation*: All unit tests pass.

3. **Full Workspace Gate**:
   ```bash
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
   *Expectation*: 0 errors, 0 warnings.
