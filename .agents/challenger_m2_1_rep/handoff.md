# Empirical Challenge Report: Milestone 2 — Display Routing & Chrome Session Linking

**Agent**: `challenger_m2_1_rep`  
**Role**: Empirical Challenger (`critic`, `specialist`)  
**Milestone**: Milestone 2: MicroVM Virtualization Architecture (Features F8 & F9)  
**Parent Agent**: `parent` (`a683d2a2-4cae-4a3a-a587-8741f091dc4b`)  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_1_rep`  
**Verdict**: **APPROVE**  
**Date**: 2026-09-08T21:43:45Z  

---

## 1. Observation

Direct, empirical observations and verbatim outputs executed directly in the repository environment:

### Observation 1: Verification of `.agents/explorer_m2_3/test_upgrade.mjs`
- Executed command:
  ```bash
  node .agents/explorer_m2_3/test_upgrade.mjs
  ```
- Verbatim Output:
  ```
  Client connected, sending upgrade handshake
  Proxy received upgrade request: /ws
  Backend received upgrade request: /ws
  Client received data: HTTP/1.1 101 Switching Protocols
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=

  Backend received data: PING
  Client received data: PONG:PING
  SUCCESS: End-to-end upgrade proxying confirmed!
  ```
- Exit code: `0`. Confirmed that raw TCP stream forwarding over WebSocket upgrade operates correctly.

### Observation 2: Display 1 Authorization Rejection & Constant-Time Token Verification
- Evaluated `cloud/microvm/scripts/sand-window-router.mjs`:
  - Lines 45–66 (`decideWindowRoute`):
    ```javascript
    const display = parseDisplayNumber(displayHeader);
    if (display < 1) {
      return { reject: { status: 400, message: `sand-window-router: bad request (display :${display} must be >= 1)` } };
    }
    const owner = firstHeader(ownerHeader);
    const bound = lookupBoundToken(display);
    if (bound === undefined || !tokensMatch(owner, bound)) {
      return { reject: { status: 403, message: `sand-window-router: forbidden (display :${display} owner-token mismatch)` } };
    }
    if (display === 1) return { port: primaryPort };
    return { port: execBase + display };
    ```
  - Lines 26–36 (`tokensMatch`): Constant-time comparison using `crypto.timingSafeEqual`, with dummy execution `timingSafeEqual(bb, bb)` on length mismatch to eliminate side-channel timing variance.
- Executed empirical test suite (`node tests/adversarial/test_sand_window_router.mjs`):
  - Unit check: `decideWindowRoute` with `display: 1` and `owner: undefined` returned `{ reject: { status: 403 } }`.
  - Unit check: `decideWindowRoute` with `display: 1` and `owner: "wrong-token"` returned `{ reject: { status: 403 } }`.
  - HTTP server test: Request to `127.0.0.1:29339` with `x-sand-display: 1` and no `x-sand-window-owner` returned `HTTP 403 Forbidden`.
  - HTTP server test: Request with `x-sand-display: 1` and mismatched token returned `HTTP 403 Forbidden`.
  - HTTP server test: Request with `x-sand-display: 0` and `x-sand-display: -5` returned `HTTP 400 Bad Request`.
  - HTTP server test: Request to Display 1 with matching token `alpha-secret-token-d1` returned `HTTP 200 OK` from `PRIMARY` (port 29337).
  - HTTP server test: Request to Display 2 with matching token `bravo-secret-token-d2` returned `HTTP 200 OK` from `DISPLAY_2` (port 39002).
  - HTTP server test: Cross-tenant request to Display 2 using Display 1's token returned `HTTP 403 Forbidden`.
  - Upgrade test: Raw TCP WebSocket Upgrade request to Display 1 without token returned:
    ```
    HTTP/1.1 403 Forbidden
    Content-Type: text/plain
    Connection: close

    sand-window-router: forbidden (display :1 owner-token mismatch)
    ```
    and immediately destroyed client socket.

### Observation 3: WebSocket Upgrade Proxying Under Concurrent Load & Adversarial Conditions
- Executed concurrency and resilience harness in `tests/adversarial/test_sand_window_router.mjs`:
  - 50 concurrent WebSocket clients (`CONCURRENT_CLIENTS = 50`) connected simultaneously to the router on port 29339 across Displays 1 and 2.
  - Each connection negotiated `101 Switching Protocols` and exchanged 10 sequential ping-pong messages (500 total messages).
  - Result: 50/50 clients completed successfully with 0 dropped frames and 0 timeouts (`Successfully transferred 500 messages across 50 concurrent WebSocket connections with 0 failures!`).
  - Backend offline test: Request targeting Display 3 (where token exists but upstream port 39003 is offline) returned `HTTP/1.1 502 Bad Gateway` and cleanly terminated socket without crashing router process.
  - Abrupt disconnect test: 10 consecutive clients sent upgrade requests and immediately destroyed their sockets (`sock.destroy()`). Subsequent valid requests to Display 1 succeeded with `HTTP 200 OK`, demonstrating zero socket leaks or unhandled exception crashes.

### Observation 4: Chrome Multi-Display Session Linking Edge Cases (`link-chrome-session.sh`)
- Evaluated `cloud/microvm/scripts/link-chrome-session.sh`:
  - Lines 34–38:
    ```bash
    CANONICAL_TARGET="$(readlink -f "${SESSION_DIR}" 2>/dev/null || echo "${SESSION_DIR}")"
    CANONICAL_DEST="$(readlink -f "${DEFAULT_DIR}" 2>/dev/null || echo "${DEFAULT_DIR}")"
    if [ "${CANONICAL_TARGET}" = "${CANONICAL_DEST}" ]; then
      exit 0
    fi
    ```
  - Line 52: `rm -f "${link}-journal" "${link}-wal" "${link}-shm" 2>/dev/null || true`
  - Lines 55–61: Initializes missing master databases with `touch` and `chmod 600`.
- Executed empirical harness `bash tests/adversarial/test_link_chrome_session.sh`:
  ```
  === Testing link-chrome-session.sh Edge Cases & Hardening ===
  Target script: /mnt/c/Users/tyson/.repo/personal/frostfire-cloud/cloud/microvm/scripts/link-chrome-session.sh
  [Test 1] Testing empty argument invocation...
    -> Passed: Empty argument safely exits 0
  [Test 2] Testing standard profile linking...
    -> Passed: Standard linking succeeded with bitwise parity
  [Test 3] Testing circular destination when PROFILE_DIR is SESSION_DIR...
    -> Passed: Circular invocation safely aborted without data loss
  [Test 4] Testing circular destination when PROFILE_DIR is parent of Default...
    -> Passed: Master parent invocation safely handled
  [Test 5] Testing circular destination with relative / dot-dot path...
    -> Passed: Canonical path detection resolved relative paths
  [Test 6] Testing stale SQLite lock cleanup in target display directory...
    -> Passed: All 9 stale SQLite lock files were pruned
  [Test 7] Testing missing source files in CHROME_SESSION_DIR...
    -> Passed: Missing source files were created with secure permissions
  [Test 8] Testing pre-existing conflicting regular files in destination...
    -> Passed: Conflicting local files safely replaced with master symlinks
  [Test 9] Testing idempotency across repeated executions...
    -> Passed: Repeated runs are completely idempotent
  === ALL link-chrome-session.sh EDGE CASE TESTS PASSED! ===
  ```
- Exit code: `0`. All 9 edge case tests passed.

### Observation 5: E2E and Workspace Verification Gates
- Executed `cargo test -p frostfire-e2e -- test_f8`:
  - 10 passed (5 Tier 1, 5 Tier 2), 0 failed.
- Executed `cargo test -p frostfire-e2e -- test_f9`:
  - 10 passed (5 Tier 1, 5 Tier 2), 0 failed.
- Executed `cargo test -p frostfire-e2e --test tier3_cross_feature`:
  - 10 passed, 0 failed (including `test_tier3_window_router_and_vnc_display_takeover` and `test_tier3_chrome_session_linking_and_cdp_cookie_sync`).
- Executed `cargo test -p frostfire-e2e --test tier4_real_world`:
  - 5 passed, 0 failed (including `test_tier4_scenario2_remote_window_and_vnc_takeover_e2e` and `test_tier4_scenario4_multi_tenant_isolation_e2e`).
- Executed full workspace unit/integration test suite:
  ```bash
  cargo test --workspace
  ```
  Result: 100% passed across all crates, 0 failures.
- Executed full workspace linter:
  ```bash
  cargo clippy --workspace -- -D warnings
  ```
  Result: 0 warnings.
- Executed shell script syntax validation across all `.sh` files:
  Result: 100% (15/15) scripts returned `ExitCode = 0` on `bash -n`.

---

## 2. Logic Chain

1. **Display 1 Authorization Invariant (Observation 2)**:
   - The primary security vulnerability identified in Milestone 2 was an authentication bypass where `display <= 1` bypassed token validation.
   - Direct inspection and empirical testing prove that lines 45–66 of `sand-window-router.mjs` evaluate `tokensMatch(owner, bound)` for *all* displays $\ge 1$.
   - When `displayHeader` is missing, it defaults to `1`; if `x-sand-window-owner` is missing, malformed, or mismatched, the router returns HTTP 403 Forbidden for both HTTP and WebSocket Upgrade requests.
   - Therefore, the Display 1 authorization bypass is completely closed and enforced with constant-time equality.

2. **WebSocket Upgrade Concurrency & Resilience (Observations 1 & 3)**:
   - WebSocket upgrades for PTY terminal streaming and RFB/VNC display takeover require transparent bi-directional TCP pipe bridging.
   - `server.on('upgrade', ...)` in `sand-window-router.mjs` validates the token before establishing `net.connect` to the backend.
   - Under stress testing with 50 concurrent connections transferring 500 total messages across multiple displays, all frames were received without data corruption or hung connections.
   - Abrupt socket drops and offline backends are trapped with error handlers and cleanly closed, preventing unhandled exceptions or denial of service to sibling connections.

3. **Chrome Multi-Display Session Linking Hardening (Observation 4)**:
   - Multi-monitor Chrome sessions require sharing SQLite credentials (`Cookies`, `Login Data`, `Login Data For Account`) without database corruption.
   - In previous iterations, invoking the script with the master directory destroyed the master files due to `rm -f "${link}"` when `link == target`.
   - `readlink -f` canonical comparison (`CANONICAL_TARGET = CANONICAL_DEST`) completely prevents this circular destruction scenario.
   - Pre-cleaning stale `-wal`, `-shm`, and `-journal` lock files prevents SQLite lock contention (`SQLITE_BUSY`) across multi-screen launches.
   - Missing master files are automatically initialized with restricted permissions (`0600`), and directory structures are hardened with `0700`.

4. **Integration & Workspace Cohesion (Observation 5)**:
   - All opaque-box E2E test suites for F8 and F9 pass cleanly.
   - The entire Frostfire Cloud workspace builds and passes all unit and integration tests with zero clippy warnings and zero shell script syntax errors.

---

## 3. Caveats

1. **Hardware KVM & GPU Acceleration**:
   - Verification was performed on a Windows development host with Node.js, Git Bash, and Cargo/Rust toolchains. Direct hardware KVM `/dev/kvm` execution and GPU framebuffer rendering require a Linux bare-metal hypervisor (`c5.metal` / `c6i.metal`), which is verified at the CloudFormation / deployment layer (Milestone 3 / Milestone 4).
2. **WebSocket Client Library Abstraction**:
   - Concurrency stress tests utilized raw RFC 6455 HTTP upgrade negotiation and framing over TCP sockets via Node.js `net.connect`, directly exercising the proxy's upgrade piping layer rather than a heavyweight headless browser.

---

## 4. Conclusion

**Verdict: APPROVE**

The implementations of Feature F8 (`sand-window-router.mjs`) and Feature F9 (`link-chrome-session.sh`) fulfill all architectural invariants, functional requirements, and security constraints:
- Display 1 authentication bypass is completely eliminated; HTTP 403 Forbidden is strictly enforced for unauthorized HTTP and WebSocket upgrade requests.
- WebSocket upgrade proxying handles high-concurrency multi-client streaming and gracefully handles disconnections and offline backends.
- Chrome session linking is resilient against circular invocations, cleans stale SQLite locks, safely initializes missing source databases, and operates idempotently.
- 100% of workspace tests and E2E verification suites pass with 0 failures and 0 warnings.

---

## 5. Verification Method

To independently reproduce all empirical challenge results:

1. **Run Display Window Router Adversarial & Concurrency Test**:
   ```bash
   node tests/adversarial/test_sand_window_router.mjs
   ```
   *Expected output*: `=== ALL sand-window-router tests PASSED successfully! ===` (Exit code 0).

2. **Run Chrome Session Linking Edge Case Test**:
   ```bash
   bash tests/adversarial/test_link_chrome_session.sh
   ```
   *Expected output*: `=== ALL link-chrome-session.sh EDGE CASE TESTS PASSED! ===` (Exit code 0).

3. **Run Milestone 2 Opaque-Box E2E Tests**:
   ```bash
   cargo test -p frostfire-e2e -- test_f8
   cargo test -p frostfire-e2e -- test_f9
   cargo test -p frostfire-e2e --test tier3_cross_feature
   cargo test -p frostfire-e2e --test tier4_real_world
   ```
   *Expected output*: All tests report `test result: ok` (Exit code 0).

4. **Run Full Workspace Verification Gates**:
   ```bash
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
   *Expected output*: 0 failed tests, 0 warnings.

### Invalidation Conditions:
- Any HTTP 200 response on Display 1 without a valid `x-sand-window-owner` header.
- Any socket hang or dropped frame during concurrent WebSocket upgrades.
- Any deletion or truncation of master Chrome SQLite files upon circular script invocation.
- Any failure in `cargo test -p frostfire-e2e`.
