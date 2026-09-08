# Handoff Report: Milestone 2 MicroVM Display Routing, Chrome Linking & Live CDP Cookie Sync

**Agent Folder**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_3`  
**Role**: Explorer (`teamwork_preview_explorer`)  
**Type**: Hard Handoff (Investigation Complete)  
**Target Milestone**: Milestone 2 — MicroVM Virtualization Infrastructure (Display & Browser Multiplexing)  

---

## 1. Observation

Direct observations extracted from the codebase, scripts, tests, and active execution:

1. **`sand-window-router.mjs` Display 1 Token Bypass**:
   - In `cloud/microvm/scripts/sand-window-router.mjs` lines 39–40:
     ```javascript
     export function decideWindowRoute({
       displayHeader,
       ownerHeader,
       primaryPort,
       execBase,
       lookupBoundToken,
     }) {
       const display = parseDisplayNumber(displayHeader);
       if (display <= 1) return { port: primaryPort };
       const owner = firstHeader(ownerHeader);
       const bound = lookupBoundToken(display);
     ```
   - Direct Node invocation confirmed that an unauthenticated caller with no headers or invalid display numbers is routed to port 1337:
     ```bash
     node -e "import('./cloud/microvm/scripts/sand-window-router.mjs').then(m => { console.log('display 1, no token:', m.decideWindowRoute({ displayHeader: '1', ownerHeader: undefined, primaryPort: 1337, execBase: 14000, lookupBoundToken: () => 'valid' })); console.log('display 0:', m.decideWindowRoute({ displayHeader: '0', ownerHeader: undefined, primaryPort: 1337, execBase: 14000, lookupBoundToken: () => 'valid' })); });"
     ```
     Result:
     ```text
     display 1, no token: { port: 1337 }
     display 0: { port: 1337 }
     ```

2. **`sand-window-router.mjs` Missing WebSocket Upgrade Proxy**:
   - In `cloud/microvm/scripts/sand-window-router.mjs` lines 68–102:
     Only standard HTTP `http.createServer((req, res) => { ... })` is created.
     There is no `server.on('upgrade', ...)` event listener attached.
   - Node.js `http.Server` terminates client connections on HTTP Upgrade requests with `Connection: close` unless an `upgrade` listener intercepts the socket.
   - In `tests/e2e/tests/tier1_feature_coverage.rs` lines 621–629 (`test_f8_websocket_upgrade_forwarding`), WebSocket upgrades must return status 101 and preserve the connection to port 14000 + display.

3. **`link-chrome-session.sh` Master Database Destruction on Circular Invocation**:
   - In `cloud/microvm/scripts/link-chrome-session.sh` lines 7–41:
     ```bash
     PROFILE_DIR="${1:-}"
     SESSION_DIR="${CHROME_SESSION_DIR:-/home/box/chrome-profile/Default}"
     [ -n "${PROFILE_DIR}" ] || exit 0

     DEFAULT_DIR="${PROFILE_DIR}/Default"
     # ...
     SESSION_FILES=(Cookies "Login Data" "Login Data For Account")
     for name in "${SESSION_FILES[@]}"; do
       target="${SESSION_DIR}/${name}"
       link="${DEFAULT_DIR}/${name}"
       # If PROFILE_DIR is /home/box/chrome-profile, DEFAULT_DIR is /home/box/chrome-profile/Default
       # and target == link!
       rm -f "${link}" 2>/dev/null || true
       ln -s "${target}" "${link}" 2>/dev/null || true
     done
     ```
   - When `$1` is the master profile directory, `rm -f "${link}"` permanently deletes the master `Cookies`, `Login Data`, and `Login Data For Account` files, replacing them with circular broken symlinks.

4. **`cdp-cookies.mjs` Placeholder Stub**:
   - In `cloud/microvm/scripts/cdp-cookies.mjs` lines 41–48:
     ```javascript
     // In Frostfire, session sync extracts cookies using SQLite reader or CDP Network.getCookies
     // and calls Network.setCookies on target instances
     for (const port of SECONDARY_PORTS) {
       const secondaryTargets = await fetchJson(`http://127.0.0.1:${port}/json`);
       if (secondaryTargets && secondaryTargets.length > 0) {
         // Target is live
       }
     }
     ```
   - No CDP commands are ever dispatched; `Network.getCookies` and `Network.setCookies` are never called; expired cookies are not filtered; deduplication hash checks are absent.

5. **Existing E2E Test Suite Status**:
   - Executing `cargo test -p frostfire-e2e` passed all 175 tests (80 Tier 1 tests, 80 Tier 2 tests, 10 Tier 3 tests, 5 Tier 4 tests) against the specification models in `tests/e2e/src/harness.rs`.
   - Executing `bash -n cloud/microvm/scripts/link-chrome-session.sh` passed with 0 syntax errors.
   - Target scripts (`sand-window-router.mjs`, `link-chrome-session.sh`, `cdp-cookies.mjs`) have LF line endings (`HasCRLF = False`).

---

## 2. Logic Chain

1. **Vulnerability in Display Routing (Observation 1)**:
   - Line 40 of `sand-window-router.mjs` short-circuits on `display <= 1`.
   - Any client sending `GET /` with no `x-sand-display` header parses to Display 1, bypassing the `lookupBoundToken` check entirely.
   - Therefore, to enforce the project-wide security invariant (`AGENTS.md` Invariant 3: "All display routes must pass `x-sand-window-owner` token checks with constant-time comparison"), `decideWindowRoute` must validate tokens for ALL displays (including Display 1), and reject `display < 1` with HTTP 400 Bad Request.

2. **PTY / VNC WebSocket Disconnection (Observation 2)**:
   - Client applications (including the Frostfire desktop client) establish WebSocket connections through port 1339 for interactive PTY shells and VNC display takeover.
   - Without an `upgrade` event handler on `http.Server`, Node drops incoming upgrade requests immediately.
   - Therefore, adding `server.on('upgrade', (req, socket, head) => { ... })` with raw bidirectional piping via `net.connect` to the authenticated target port is necessary and sufficient to support persistent WebSocket streaming without third-party dependencies.

3. **Data Loss Prevention in Chrome Profile Linking (Observation 3)**:
   - Chrome on Linux fails to start if multiple instances attempt to access the same profile directory due to single-instance singleton locks.
   - `link-chrome-session.sh` solves this by linking only `Cookies`, `Login Data`, and `Login Data For Account` into per-display profiles (`chrome-profile-2`, `chrome-profile-3`).
   - However, if the script is invoked with the master profile directory, it deletes the real files before creating self-referencing symlinks.
   - Adding a canonical directory comparison (`readlink -f "${SESSION_DIR}" = readlink -f "${DEFAULT_DIR}"`) prevents this destruction.
   - Purging stale `${link}-journal`, `${link}-wal`, and `${link}-shm` lock files prevents `SQLITE_BUSY` concurrency errors when secondary browsers attach to the shared SQLite database.

4. **In-Memory Browser Session Synchronization (Observation 4)**:
   - Symlinked SQLite files only synchronize session data on disk flush (e.g. during browser shutdown or checkpointing).
   - Live session cookies in RAM are invisible to secondary displays unless synchronized via the Chrome DevTools Protocol.
   - Replacing the stub in `cdp-cookies.mjs` with an automated daemon that queries primary port 9223 (`Network.getCookies`), strips readonly attributes (`size`, `session`), filters expired cookies, hashes the payload via SHA-256 to avoid echo loops, and pushes to secondary ports 9224 and 9225 (`Network.setCookies`) fulfills the dual-tier session sync architecture.

---

## 3. Caveats

1. **Hardware KVM & Headless X11 Execution**:
   - The microVM display environment relies on Xvfb and x11vnc running inside Linux microVMs or containers. On Windows development hosts, verification of X11 rendering and real Chromium execution requires Linux/WSL or containerization.
2. **Chromium Version Dependency for CDP Commands**:
   - `cdp-cookies.mjs` uses `Network.getCookies` and `Network.setCookies`. On Chromium versions $\ge 110$, these methods operate on page and browser debugger targets. If Chromium launches without any open tab, `/json` target list may be empty; the implementation therefore falls back to the `/json/version` browser debugger WebSocket URL.
3. **Rollback Journal vs WAL Mode in Chromium**:
   - Chromium typically runs in WAL or rollback journal mode depending on compile flags and user data directory backing. Cleaning up `-journal`, `-wal`, and `-shm` before symlink creation ensures compatibility regardless of SQLite mode.

---

## 4. Conclusion

The investigation into Milestone 2 display routing, Chrome profile linking, and live CDP cookie synchronization is complete:
- **`sand-window-router.mjs`**: Hardening specifications are formulated to close the Display 1 token bypass, reject displays $< 1$ with 400 Bad Request, and provide bidirectional WebSocket upgrade forwarding via `net.connect`.
- **`link-chrome-session.sh`**: Hardening specifications are formulated to prevent circular master database destruction, purge stale SQLite lock files, and enforce strict directory permissions (`0700` dirs, `0600` files).
- **`cdp-cookies.mjs`**: Complete functional implementation is formulated with expired cookie filtering, SHA-256 deduplication, readonly field stripping, and error-tolerant reconnection.
- Detailed implementation blueprints and before/after code are delivered in `.agents/explorer_m2_3/report.md`.

---

## 5. Verification Method

To independently verify these findings and validate future implementations:

1. **E2E Rust Test Suite**:
   ```bash
   cargo test -p frostfire-e2e
   ```
   Must pass all 80 Tier 1 tests, 80 Tier 2 boundary tests, 10 Tier 3 cross-feature tests, and 5 Tier 4 real-world tests (0 failures).

2. **Shell Script Syntax & Line Ending Verification**:
   ```bash
   bash -n cloud/microvm/scripts/link-chrome-session.sh
   # Verify no CRLF line endings
   pwsh -Command "Get-Content cloud/microvm/scripts/link-chrome-session.sh -Raw | Select-String \"`r`n\""
   ```

3. **Window Router Token & Upgrade Verification**:
   Execute the verified test script:
   ```bash
   node .agents/explorer_m2_3/test_upgrade.mjs
   ```
   Must output:
   ```text
   SUCCESS: End-to-end upgrade proxying confirmed!
   ```

4. **Live CDP Cookie Synchronization Verification**:
   Execute the verified mock CDP synchronization test:
   ```bash
   node .agents/explorer_m2_3/test_cdp.mjs
   ```
   Must output:
   ```text
   ALL CDP TESTS PASSED SUCCESSFULLY!
   ```

5. **Chrome Session Linking Verification**:
   Execute the verified test suite for circular symlink prevention and lock cleanup:
   ```bash
   bash .agents/explorer_m2_3/test_link_chrome.sh
   ```
   Must output:
   ```text
   ALL CHROME LINKING TESTS PASSED!
   ```
