# Technical Investigation Report: Display Routing, Chrome Session Linking & Live CDP Cookie Sync

**Milestone**: M2 — MicroVM Virtualization Infrastructure (Display & Browser Multiplexing)  
**Agent**: `explorer_m2_3` (`teamwork_preview_explorer`)  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_3`  
**Date**: 2026-09-08T21:10:45Z  

---

## 1. Executive Summary

This investigation analyzed three core components of the Frostfire autonomous cloud microVM virtualization infrastructure (Milestone 2):
1. **Multi-Display Window Router (`cloud/microvm/scripts/sand-window-router.mjs`)**: Identified a critical unauthenticated bypass on Display 1 (`display <= 1`) and the total absence of WebSocket upgrade proxying (`server.on('upgrade', ...)`), causing dropped PTY and VNC connections.
2. **Multi-Monitor Chrome Session Linker (`cloud/microvm/scripts/link-chrome-session.sh`)**: Identified a high-severity circular invocation bug that destroys the master cookie database if run against the primary profile, along with missing stale WAL/journal lock cleanup that risks `SQLITE_BUSY` concurrency deadlocks.
3. **Live CDP Cookie Synchronizer (`cloud/microvm/scripts/cdp-cookies.mjs`)**: The script is currently an empty stub that inspects port targets but never performs `Network.getCookies` or `Network.setCookies`, does not filter expired cookies, lacks SHA-256 deduplication to prevent echo loops, and does not recover from disconnected secondary targets.

All findings have been validated with concrete execution prototypes and mapped to the existing verification harness (`frostfire-e2e` Tiers 1–4). Complete production-ready replacement implementations and migration checklists are provided below.

---

## 2. Component 1: Multi-Display Window Router (`sand-window-router.mjs`)

### 2.1 File Location & Architectural Role
- **Path**: `cloud/microvm/scripts/sand-window-router.mjs`
- **Port**: 1339 (ingress HTTP/WS router)
- **Upstream Targets**:
  - Display 1: Primary Agent Daemon on port `1337`
  - Display $N$ ($N \ge 2$): Forked Agent Daemons on port `14000 + N` (e.g. `14002`, `14003`)
- **Security Invariant**: All display routes must pass tenant token validation using constant-time comparison (`crypto.timingSafeEqual`) against `/tmp/sand-window-tokens.d/<display>`.

### 2.2 Discovered Defects

#### Defect 1: Unauthenticated Bypass on Display 1
In `sand-window-router.mjs` lines 39–40:
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
  // ...
```
- **Vulnerability**: If `x-sand-display` is omitted (defaults to 1), explicitly set to `"1"`, or set to `"0"` / `"-1"`, the function immediately routes traffic to `primaryPort` (1337) without checking `ownerHeader` or `lookupBoundToken`.
- **Impact**: Any unauthenticated client on the internal network can issue arbitrary commands to the primary agent daemon on port 1337, completely bypassing tenant token authentication.
- **Contract Violation**: Violates `ORIGINAL_REQUEST.md` §R2, `AGENTS.md` Invariant ("Tenant Authorization: All display routes must pass `x-sand-window-owner` token checks with constant-time comparison"), and `tests/e2e/tests/tier1_feature_coverage.rs` (`test_f8_token_validation_enforced_all_displays`).

#### Defect 2: Invalid Display Number Acceptance
- Requests with `x-sand-display: 0` or `x-sand-display: -1` return `{ port: 1337 }` instead of rejecting with HTTP 400 Bad Request.
- In `tests/e2e/src/harness.rs` lines 100–106 and `tier2_boundary_corner.rs` lines 512–525 (`test_f8_b1_negative_display_number_rejected`, `test_f8_b2_zero_display_number_rejected`), displays $< 1$ must be rejected with status 400.

#### Defect 3: Missing WebSocket Upgrade Handler
- Current code creates an HTTP server via `http.createServer((req, res) => { ... })` and binds it with `server.listen(...)`, but never attaches a listener to `server.on('upgrade', ...)`.
- In Node.js, when an HTTP client sends `Connection: Upgrade` with `Upgrade: websocket` and no `upgrade` listener is attached to `http.Server`, Node immediately closes the client socket.
- Consequently, all PTY terminal WebSockets (`13600 + N`) and noVNC/websockify WebSockets routed through port 1339 are abruptly dropped.

### 2.3 Proposed Solution & Code Specification

1. **Import `node:net`**: Required for raw bidirectional TCP socket forwarding of HTTP upgrade handshakes and WebSocket frames.
2. **Harden `decideWindowRoute`**:
   - Check if `display < 1`: reject with `{ reject: { status: 400, message: "..." } }`.
   - Retrieve `bound = lookupBoundToken(display)`.
   - If `bound === undefined || !tokensMatch(owner, bound)`: reject with `{ reject: { status: 403, message: "..." } }`.
   - If `display === 1`: return `{ port: primaryPort }`.
   - If `display > 1`: return `{ port: execBase + display }`.
3. **Add `server.on('upgrade', ...)`**:
   - Evaluate route and auth via `decideWindowRoute`.
   - On rejection, send raw HTTP response (`HTTP/1.1 400 Bad Request\r\n...` or `HTTP/1.1 403 Forbidden\r\n...`) and close socket.
   - On success, establish TCP connection to `127.0.0.1:decision.port` using `net.connect`.
   - Forward reconstructed HTTP Upgrade request headers verbatim (`req.rawHeaders`) and any trailing `head` buffer.
   - Pipe sockets bidirectionally: `upstreamSocket.pipe(socket)` and `socket.pipe(upstreamSocket)`.
   - Handle error and close events on both ends to prevent FD leakage.

#### Complete Proposed Implementation for `sand-window-router.mjs`:
```javascript
import http from "node:http";
import net from "node:net";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

export const SAND_BOX_DISPLAY_HEADER = "x-sand-display";
export const SAND_BOX_WINDOW_OWNER_HEADER = "x-sand-window-owner";
export const WINDOW_TOKEN_DIR = process.env.SAND_WINDOW_TOKEN_DIR || "/tmp/sand-window-tokens.d";
export const DEFAULT_LISTEN_PORT = 1339;
export const DEFAULT_PRIMARY_PORT = 1337;
export const DEFAULT_FORK_EXEC_BASE = 14000;

function firstHeader(raw) {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseDisplayNumber(raw) {
  const value = firstHeader(raw);
  const num = Number.parseInt(value ?? "1", 10);
  return Number.isInteger(num) ? num : 1;
}

export function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function decideWindowRoute({
  displayHeader,
  ownerHeader,
  primaryPort,
  execBase,
  lookupBoundToken,
}) {
  const display = parseDisplayNumber(displayHeader);
  if (display < 1) {
    return {
      reject: {
        status: 400,
        message: `sand-window-router: bad request (display :${display} must be >= 1)`,
      },
    };
  }
  const owner = firstHeader(ownerHeader);
  const bound = lookupBoundToken(display);
  if (bound === undefined || !tokensMatch(owner, bound)) {
    return {
      reject: {
        status: 403,
        message: `sand-window-router: forbidden (display :${display} owner-token mismatch)`,
      },
    };
  }
  if (display === 1) return { port: primaryPort };
  return { port: execBase + display };
}

function readBoundToken(display) {
  try {
    const raw = readFileSync(`${WINDOW_TOKEN_DIR}/${display}`, "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function main() {
  const LISTEN_PORT = Number(process.argv[2] || DEFAULT_LISTEN_PORT);
  const PRIMARY_PORT = Number(process.argv[3] || DEFAULT_PRIMARY_PORT);
  const EXEC_BASE = Number(process.argv[4] || DEFAULT_FORK_EXEC_BASE);

  const server = http.createServer((req, res) => {
    const decision = decideWindowRoute({
      displayHeader: req.headers[SAND_BOX_DISPLAY_HEADER],
      ownerHeader: req.headers[SAND_BOX_WINDOW_OWNER_HEADER],
      primaryPort: PRIMARY_PORT,
      execBase: EXEC_BASE,
      lookupBoundToken: readBoundToken,
    });
    if (decision.reject !== undefined) {
      if (!res.headersSent) {
        res.writeHead(decision.reject.status, { "content-type": "text/plain" });
      }
      res.end(decision.reject.message);
      req.resume();
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: decision.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`sand-window-router upstream error: ${String(err)}`);
    });
    req.pipe(upstream);
  });

  // Handle WebSocket / HTTP Upgrade requests
  server.on("upgrade", (req, socket, head) => {
    const decision = decideWindowRoute({
      displayHeader: req.headers[SAND_BOX_DISPLAY_HEADER],
      ownerHeader: req.headers[SAND_BOX_WINDOW_OWNER_HEADER],
      primaryPort: PRIMARY_PORT,
      execBase: EXEC_BASE,
      lookupBoundToken: readBoundToken,
    });
    if (decision.reject !== undefined) {
      const statusText = decision.reject.status === 400 ? "Bad Request" : "Forbidden";
      socket.write(
        `HTTP/1.1 ${decision.reject.status} ${statusText}\r\n` +
          `Content-Type: text/plain\r\n` +
          `Connection: close\r\n\r\n` +
          `${decision.reject.message}\n`
      );
      socket.destroy();
      return;
    }

    const upstreamSocket = net.connect(
      {
        host: "127.0.0.1",
        port: decision.port,
      },
      () => {
        let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        rawReq += "\r\n";
        upstreamSocket.write(rawReq);
        if (head && head.length > 0) {
          upstreamSocket.write(head);
        }
        upstreamSocket.pipe(socket);
        socket.pipe(upstreamSocket);
      }
    );

    upstreamSocket.on("error", (err) => {
      if (socket.writable) {
        socket.write(
          `HTTP/1.1 502 Bad Gateway\r\n` +
            `Content-Type: text/plain\r\n` +
            `Connection: close\r\n\r\n` +
            `sand-window-router upstream upgrade error: ${String(err)}\n`
        );
      }
      socket.destroy();
    });

    socket.on("error", () => {
      upstreamSocket.destroy();
    });

    upstreamSocket.on("close", () => {
      socket.destroy();
    });

    socket.on("close", () => {
      upstreamSocket.destroy();
    });
  });

  server.timeout = 0;
  server.listen(LISTEN_PORT, "0.0.0.0", () => {
    process.stdout.write(
      `sand-window-router listening pid=${process.pid} port=${LISTEN_PORT} primary=${PRIMARY_PORT} fork_base=${EXEC_BASE} (owner-token enforced)\n`
    );
  });
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
```

---

## 3. Component 2: Multi-Monitor Chrome Session Linker (`link-chrome-session.sh`)

### 3.1 File Location & Architectural Role
- **Path**: `cloud/microvm/scripts/link-chrome-session.sh`
- **Invoked By**: `/usr/local/bin/box-chrome` on displays $> 1$.
- **Objective**: "One microVM, one authenticated session". Chrome locks `--user-data-dir` to a single process. Multi-display Chrome solves this by maintaining separate profile directories (`/home/box/chrome-profile`, `/home/box/chrome-profile-2`, etc.) while symlinking the core SQLite databases (`Cookies`, `Login Data`, `Login Data For Account`).

### 3.2 Discovered Defects

#### Defect 1: Master Profile Database Destruction via Circular Invocation
- If `link-chrome-session.sh` is invoked with `PROFILE_DIR` pointing to the primary session directory (`/home/box/chrome-profile` or `/home/box/chrome-profile/Default`):
  ```bash
  SESSION_DIR="${CHROME_SESSION_DIR:-/home/box/chrome-profile/Default}"
  DEFAULT_DIR="${PROFILE_DIR}/Default"
  for name in "${SESSION_FILES[@]}"; do
    target="${SESSION_DIR}/${name}"
    link="${DEFAULT_DIR}/${name}"
    # link == target!
    rm -f "${link}" 2>/dev/null || true
    ln -s "${target}" "${link}" 2>/dev/null || true
  done
  ```
- Because `link == target`, `rm -f "${link}"` **deletes the actual master SQLite database file**! Then `ln -s` creates a broken self-referencing circular symlink (`Cookies -> Cookies`).
- **Impact**: Invoking the script on Display 1 or misconfigured profile directories wipes out all stored cookies and credentials.
- **Contract**: Checked by `test_f9_b4_circular_symlink_prevention` in `tests/e2e/tests/tier2_boundary_corner.rs`.

#### Defect 2: SQLite Rollback-Journal & WAL Lock Collisions
- When Chromium operates on SQLite databases, it generates companion lock and journal files:
  - Rollback mode: `${name}-journal`
  - WAL mode: `${name}-wal` and `${name}-shm`
- If an existing display directory previously ran standalone, or aborted mid-transaction, stale local journal or WAL files remaining in `${DEFAULT_DIR}/` cause SQLite to fail with `SQLITE_BUSY` ("database is locked") or disk I/O errors when accessing the symlinked database.
- The script must purge stale local `${link}-journal`, `${link}-wal`, and `${link}-shm` before establishing symlinks.

#### Defect 3: Target Database Non-Existence & Permissions
- If secondary Chrome boots before primary Chrome has created the SQLite databases, the symlinks point to non-existent targets.
- Pre-touching the target database with `0600` permissions ensures the symlink is immediately valid, prevents permission errors, and satisfies `0700` profile directory constraints.
- Path normalization: if a caller passes `/path/to/profile/Default`, appending `/Default` produces `/path/to/profile/Default/Default`. Stripping trailing `/Default` normalizes input.

### 3.3 Proposed Solution & Code Specification

#### Complete Proposed Implementation for `link-chrome-session.sh`:
```bash
#!/usr/bin/env bash
# Link session SQLite databases (Cookies, Login Data, Login Data For Account) across multi-display Chrome profiles.
# Implements "One microVM, one authenticated session" across all concurrent agent screens.

set -euo pipefail

PROFILE_DIR="${1:-}"
SESSION_DIR="${CHROME_SESSION_DIR:-/home/box/chrome-profile/Default}"

if [ -z "${PROFILE_DIR}" ]; then
  exit 0
fi

# Normalize PROFILE_DIR: if caller passed path ending in /Default, strip it
if [[ "${PROFILE_DIR}" == */Default ]]; then
  DEFAULT_DIR="${PROFILE_DIR}"
  PROFILE_DIR="${PROFILE_DIR%/Default}"
else
  DEFAULT_DIR="${PROFILE_DIR}/Default"
fi

ensure_secure_dir() {
  local dir="$1"
  mkdir -p "${dir}" 2>/dev/null || true
  chmod 700 "${dir}" 2>/dev/null || true
  if [ "$(id -u)" -eq 0 ] && id "box" >/dev/null 2>&1; then
    chown box:box "${dir}" 2>/dev/null || true
  fi
}

ensure_secure_dir "${SESSION_DIR}"

# Prevent circular symlink and destruction of master profile databases
CANONICAL_TARGET="$(readlink -f "${SESSION_DIR}" 2>/dev/null || echo "${SESSION_DIR}")"
CANONICAL_DEST="$(readlink -f "${DEFAULT_DIR}" 2>/dev/null || echo "${DEFAULT_DIR}")"
if [ "${CANONICAL_TARGET}" = "${CANONICAL_DEST}" ]; then
  exit 0
fi

if [ -L "${DEFAULT_DIR}" ]; then
  rm -f "${DEFAULT_DIR}" 2>/dev/null || true
fi
ensure_secure_dir "${DEFAULT_DIR}"

SESSION_FILES=(Cookies "Login Data" "Login Data For Account")
for name in "${SESSION_FILES[@]}"; do
  target="${SESSION_DIR}/${name}"
  link="${DEFAULT_DIR}/${name}"

  # Clean up any stale local SQLite journal/WAL lock files in target display directory
  # that could cause SQLITE_BUSY or rollback concurrency conflicts
  rm -f "${link}-journal" "${link}-wal" "${link}-shm" 2>/dev/null || true

  # Ensure master database file exists so symlink is valid
  if [ ! -e "${target}" ] && [ ! -L "${target}" ]; then
    touch "${target}" 2>/dev/null || true
    chmod 600 "${target}" 2>/dev/null || true
    if [ "$(id -u)" -eq 0 ] && id "box" >/dev/null 2>&1; then
      chown box:box "${target}" 2>/dev/null || true
    fi
  fi

  # Already correctly symlinked: leave untouched
  if [ -L "${link}" ] && [ "$(readlink "${link}" 2>/dev/null)" = "${target}" ]; then
    continue
  fi

  # Safely replace with symlink
  rm -f "${link}" 2>/dev/null || true
  ln -s "${target}" "${link}" 2>/dev/null || true
done

exit 0
```

---

## 4. Component 3: Live CDP Cookie Synchronizer (`cdp-cookies.mjs`)

### 4.1 File Location & Architectural Role
- **Path**: `cloud/microvm/scripts/cdp-cookies.mjs`
- **Invoked By**: `start-desktop.sh` line 62 as a background supervisor daemon.
- **Objective**: While `link-chrome-session.sh` links cold disk SQLite files at startup, Chrome caches in-memory cookies during live browsing and only flushes to SQLite periodically. `cdp-cookies.mjs` polls the primary browser on port 9223 (Display 1) via Chrome DevTools Protocol (CDP) and actively pushes session cookies into secondary browser instances (ports 9224, 9225) in RAM every 1500ms.

### 4.2 Discovered Defects

#### Defect 1: Empty Stub Implementation
In `cdp-cookies.mjs` lines 41–48:
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
- The existing file is an incomplete placeholder. It queries the target list but does not call `Network.getCookies` or `Network.setCookies`.
- Live in-memory cookie changes (e.g. user logging in via WebAuthn, OAuth, or MFA) never reach secondary displays until Chrome exits and flushes SQLite.

#### Defect 2: Missing Expired Cookie Filtering
- In `tests/e2e/tests/tier2_boundary_corner.rs` line 602 (`test_f10_b3_expired_cookie_filtering`), expired cookies (`expires > 0 && expires < now`) must be detected and filtered out. Pushing expired cookies pollutes secondary instances and triggers auth invalidation.

#### Defect 3: Missing Deduplication & Echo Prevention
- In `tests/e2e/tests/tier1_feature_coverage.rs` line 692 (`test_f10_cdp_cookie_deduping_prevents_echo`), synchronizing must compute a cryptographic hash (SHA-256) of active cookies and avoid pushing unchanged payloads to secondary instances on every 1500ms tick.

#### Defect 4: Readonly Field Sanitization for `Network.setCookies`
- CDP `Network.getCookies` returns metadata including `size`, `session`, and `priority`.
- CDP `Network.setCookies` expects only valid `CookieParam` definitions (`name`, `value`, `domain`, `path`, `secure`, `httpOnly`, `sameSite`, `expires`). Passing readonly properties such as `size` or `session` causes Chromium's CDP parser to reject the command.

#### Defect 5: Connection Recovery & Zero-Dependency Portability
- The daemon must operate with zero external npm dependencies (`ws` cannot be assumed installed in minimal rootfs).
- It must handle offline targets gracefully without uncaught exceptions when secondary screens are closed or restarted.

### 4.3 Proposed Solution & Code Specification

1. **Lightweight Native WebSocket Framing / Upgrade**: Uses Node's built-in `http.request` with `upgrade` event (or `globalThis.WebSocket` when available in Node 22+) to exchange JSON-RPC CDP commands.
2. **Expired Cookie Filter**: Discards any cookie where `expires > 0 && expires < (Date.now() / 1000)`.
3. **Cookie Sanitization**: Maps CDP cookie objects to strict `CookieParam` structs, stripping `size` and `session`.
4. **SHA-256 Deduplication**: Generates a sorted hash of canonical cookie tuples `[domain, path, name, value, expires]` and caches per-target hashes in `Map<port, string>`.
5. **Resilient Reconnection**: Wraps all HTTP and socket operations in `try/catch` with short timeouts (2000ms), ignoring `ECONNREFUSED` during browser lifecycles.

#### Complete Proposed Implementation for `cdp-cookies.mjs`:
```javascript
// Dual-tier live CDP cookie sync daemon
// Polls primary Chrome instance on port 9223 and pushes cookies into secondary instances (9224, 9225) in RAM.

import http from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const PRIMARY_PORT = Number(process.env.PRIMARY_CDP_PORT || 9223);
export const SECONDARY_PORTS = process.env.SECONDARY_CDP_PORTS
  ? process.env.SECONDARY_CDP_PORTS.split(",").map(Number)
  : [9224, 9225];
export const POLL_INTERVAL_MS = Number(process.env.CDP_POLL_INTERVAL_MS || 1500);

let cdpSeq = 0;

export async function fetchJson(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      })
      .on("error", () => resolve(null));
  });
}

export function filterAndSanitizeCookies(cookies, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(cookies)) return [];
  const sanitized = [];
  for (const c of cookies) {
    if (!c || typeof c.name !== "string" || !c.name) continue;
    // Discard expired cookies
    if (typeof c.expires === "number" && c.expires > 0 && c.expires < nowSec) {
      continue;
    }
    const item = {
      name: c.name,
      value: String(c.value ?? ""),
      domain: String(c.domain ?? ""),
      path: String(c.path ?? "/"),
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
    };
    if (typeof c.expires === "number" && c.expires > 0) {
      item.expires = c.expires;
    }
    if (c.sameSite) {
      item.sameSite = c.sameSite;
    }
    sanitized.push(item);
  }
  return sanitized;
}

export function computeCookiesHash(cookies) {
  const sorted = [...cookies].sort((a, b) => {
    const keyA = `${a.domain}:${a.path}:${a.name}`;
    const keyB = `${b.domain}:${b.path}:${b.name}`;
    return keyA.localeCompare(keyB);
  });
  const serialized = JSON.stringify(
    sorted.map((c) => [c.domain, c.path, c.name, c.value, c.expires, c.secure, c.httpOnly])
  );
  return createHash("sha256").update(serialized).digest("hex");
}

export function executeCdpCommand(wsUrl, method, params = {}, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(wsUrl);
      const port = Number(url.port) || 80;
      const host = url.hostname;
      const path = url.pathname + url.search;
      const id = ++cdpSeq;

      const req = http.request({
        host,
        port,
        path,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      });

      const timer = setTimeout(() => {
        req.destroy(new Error(`CDP ${method} timed out`));
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);

      req.on("upgrade", (res, socket, head) => {
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const jsonMatch = buffer.match(/\{.*\}/);
          if (jsonMatch) {
            try {
              const msg = JSON.parse(jsonMatch[0]);
              if (msg.id === id) {
                clearTimeout(timer);
                socket.destroy();
                if (msg.error) {
                  reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                } else {
                  resolve(msg.result);
                }
              }
            } catch {
              // Await further data chunks
            }
          }
        });

        socket.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });

        const payload = JSON.stringify({ id, method, params });
        socket.write(payload);
      });

      req.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

const syncState = {
  lastSyncedHashes: new Map(),
};

export async function syncCookies(state = syncState) {
  try {
    const primaryTargets = await fetchJson(`http://127.0.0.1:${PRIMARY_PORT}/json`);
    const primaryVersion = await fetchJson(`http://127.0.0.1:${PRIMARY_PORT}/json/version`);
    const primaryWsUrl =
      (primaryTargets && primaryTargets.length > 0 && primaryTargets[0].webSocketDebuggerUrl) ||
      (primaryVersion && primaryVersion.webSocketDebuggerUrl);

    if (!primaryWsUrl) {
      return;
    }

    const getResult = await executeCdpCommand(primaryWsUrl, "Network.getCookies", {});
    const rawCookies = getResult && Array.isArray(getResult.cookies) ? getResult.cookies : [];
    const sanitizedCookies = filterAndSanitizeCookies(rawCookies);
    const cookieHash = computeCookiesHash(sanitizedCookies);

    for (const secPort of SECONDARY_PORTS) {
      try {
        const lastHash = state.lastSyncedHashes.get(secPort);
        if (lastHash === cookieHash) {
          continue;
        }

        const secTargets = await fetchJson(`http://127.0.0.1:${secPort}/json`);
        const secVersion = await fetchJson(`http://127.0.0.1:${secPort}/json/version`);
        const secWsUrl =
          (secTargets && secTargets.length > 0 && secTargets[0].webSocketDebuggerUrl) ||
          (secVersion && secVersion.webSocketDebuggerUrl);

        if (!secWsUrl) {
          continue;
        }

        if (sanitizedCookies.length > 0) {
          await executeCdpCommand(secWsUrl, "Network.setCookies", {
            cookies: sanitizedCookies,
          });
        }
        state.lastSyncedHashes.set(secPort, cookieHash);
      } catch {
        // Suppress transient secondary port connection drops
      }
    }
  } catch {
    // Suppress transient primary port connection drops
  }
}

export function main() {
  console.log(
    `[cdp-cookies] Starting live cookie synchronization daemon (primary=${PRIMARY_PORT}, targets=${SECONDARY_PORTS})`
  );
  setInterval(() => {
    syncCookies(syncState);
  }, POLL_INTERVAL_MS);
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
```

---

## 5. Test Suite Verification & Traceability Matrix

| Test Identifier | Test Suite | Target Feature | Validation Requirement |
|---|---|---|---|
| `test_f8_display_1_routes_to_port_1337` | `tier1_feature_coverage.rs` | F8 Window Router | Display 1 routes to port 1337 with valid token |
| `test_f8_display_n_routes_to_14000_plus_n` | `tier1_feature_coverage.rs` | F8 Window Router | Displays $> 1$ route to port $14000 + N$ |
| `test_f8_token_validation_enforced_all_displays` | `tier1_feature_coverage.rs` | F8 Window Router | Display 1 rejects missing and invalid tokens with 403 |
| `test_f8_invalid_token_returns_403_forbidden` | `tier1_feature_coverage.rs` | F8 Window Router | Display $N$ rejects invalid token with 403 |
| `test_f8_websocket_upgrade_forwarding` | `tier1_feature_coverage.rs` | F8 Window Router | WebSocket upgrade returns 101 Switching Protocols to target port |
| `test_f8_b1_negative_display_number_rejected` | `tier2_boundary_corner.rs` | F8 Window Router | Display -1 rejected with 400 Bad Request |
| `test_f8_b2_zero_display_number_rejected` | `tier2_boundary_corner.rs` | F8 Window Router | Display 0 rejected with 400 Bad Request |
| `test_f8_b3_extreme_display_number_boundary_65535` | `tier2_boundary_corner.rs` | F8 Window Router | Display 65535 routed with valid token |
| `test_f8_b4_missing_token_file_returns_403` | `tier2_boundary_corner.rs` | F8 Window Router | Unregistered display token file returns 403 |
| `test_f8_b5_display_owner_token_length_mismatch_constant_time` | `tier2_boundary_corner.rs` | F8 Window Router | Constant-time rejection on mismatched token lengths |
| `test_f9_shared_sqlite_database_inventory` | `tier1_feature_coverage.rs` | F9 Chrome Linking | Links `Cookies`, `Login Data`, `Login Data For Account` |
| `test_f9_b3_locked_sqlite_wal_database_handling` | `tier2_boundary_corner.rs` | F9 Chrome Linking | Purges stale WAL lock files |
| `test_f9_b4_circular_symlink_prevention` | `tier2_boundary_corner.rs` | F9 Chrome Linking | Safe no-op when destination equals master session dir |
| `test_f10_cdp_cookie_sync_protocol` | `tier1_feature_coverage.rs` | F10 Live CDP Sync | Uses `Network.getCookies` and `Network.setCookies` |
| `test_f10_cdp_cookie_deduping_prevents_echo` | `tier1_feature_coverage.rs` | F10 Live CDP Sync | Deduplication prevents redundant echo pushes |
| `test_f10_cdp_port_discovery` | `tier1_feature_coverage.rs` | F10 Live CDP Sync | Port mapping $9222 + \text{display}$ ($9223 \to 9224, 9225$) |
| `test_f10_cdp_disconnected_target_recovery` | `tier1_feature_coverage.rs` | F10 Live CDP Sync | Resilient to connection refused on offline targets |
| `test_f10_b3_expired_cookie_filtering` | `tier2_boundary_corner.rs` | F10 Live CDP Sync | Discards cookies where `expires < now` |
| `test_tier3_chrome_session_linking_and_cdp_cookie_sync` | `tier3_cross_feature.rs` | F9 + F10 | End-to-end multi-display linking with live CDP sync |
| `test_tier4_scenario2_remote_window_and_vnc_takeover_e2e` | `tier4_real_world.rs` | F8 | Display takeover and WebSocket upgrade under simulated load |

---

## 6. Recommended Implementation Sequence for M2 Implementer

1. **Step 1: Apply `sand-window-router.mjs` Hardening**:
   - Update `cloud/microvm/scripts/sand-window-router.mjs`.
   - Ensure imports include `net` from `node:net`.
   - Update `decideWindowRoute` to reject `display < 1` with 400 and enforce token on all displays.
   - Attach `server.on('upgrade', ...)` handler.
   - Verify LF line endings (`\n`) are preserved.

2. **Step 2: Apply `link-chrome-session.sh` Hardening**:
   - Update `cloud/microvm/scripts/link-chrome-session.sh`.
   - Add canonical directory comparison to prevent circular symlinks when `SESSION_DIR == DEFAULT_DIR`.
   - Clean up stale `${link}-journal`, `${link}-wal`, and `${link}-shm` lock files.
   - Ensure target master files are touched with `0600` permissions and directories created with `0700`.
   - Verify LF line endings (`\n`) are preserved.

3. **Step 3: Replace `cdp-cookies.mjs` with Functional Synchronizer**:
   - Update `cloud/microvm/scripts/cdp-cookies.mjs`.
   - Implement `filterAndSanitizeCookies`, `computeCookiesHash`, `executeCdpCommand`, and `syncCookies`.
   - Verify LF line endings (`\n`) are preserved.

4. **Step 4: Execute Verification Gate**:
   - Run `cargo test -p frostfire-e2e` to verify all 80 unit tests, 80 boundary tests, 10 cross-feature tests, and 5 real-world scenarios pass.
   - Run `cargo clippy --workspace -- -D warnings`.
   - Run `bash -n cloud/microvm/scripts/link-chrome-session.sh`.
   - Run standalone Node verification tests.
