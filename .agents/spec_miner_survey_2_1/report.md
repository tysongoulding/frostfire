# Specification and Porting Report: Inverted WebAuthn Proxy Bridge

**Target Architecture**: Frostfire Cloud MicroVM Virtualization Infrastructure & Reverse Tunnel Gateway  
**Author**: `spec_miner_survey_2_1`  
**Date**: 2026-09-08  
**Authoritative Sources Investigated**:
- GrokBot MV3 WebAuthn Proxy Extension: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\webauthn-proxy/` (`background.js`, `manifest.json`)
- GrokBot Architecture Specification: `c:\Users\tyson\.repo\personal\syntropy\docs\GROKBOT_MICROVM_ARCHITECTURE.md` (§5, §8, §11)
- GrokBot Native Messaging Host & Managed Policies:
  - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\etc-policies\native-messaging-hosts\co.anysphere.sand.webauthn_proxy.json`
  - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\etc-policies\policies\managed\sand-webauthn.json`
  - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\sand-webauthn-proxy-host`
  - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\webauthn-proxy-host.mjs`
  - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\box-contract.generated.mjs`
- Frostfire Protocol Buffers & Gateway:
  - `crates/frostfire-proto/proto/tunnel.proto`
  - `cloud/gateway/src/` (`service.rs`, `server.rs`, `auth.rs`, `session.rs`)
  - `crates/frostfire-tunnel/` (`tests/tunnel_test.rs`, `mock_server.rs`, `client.rs`)
  - `crates/frostfire-daemon/src/orchestrator.rs`
  - `crates/frostfire-security/src/broker.rs`
- Frostfire Desktop Test Harness & Invariants:
  - `c:\Users\tyson\.repo\personal\frostfire\tests\e2e\tier1\test_feat15_webauthn_bridge.py`
  - `c:\Users\tyson\.repo\personal\frostfire\tests\e2e\tier2\test_bva_feat15_webauthn_bridge.py`
  - `c:\Users\tyson\.repo\personal\frostfire\tests\e2e\harness\crypto_bridge.py`

---

## 1. Executive Summary & Architectural Overview

The **Inverted WebAuthn Proxy Bridge** is a mission-critical subsystem reverse-engineered from the GrokBot / Cursor Sand microVM architecture. It solves the fundamental limitation of cloud-hosted, headless browser automation: **authenticating against modern web applications protected by hardware-bound FIDO2/WebAuthn passkeys (YubiKeys, Apple Touch ID, Windows Hello) without exporting, storing, or compromising raw private key material on cloud hypervisors**.

### The Inverted Token Pattern
Under standard WebAuthn, a browser tab calls `navigator.credentials.get()` or `create()`. On a headless Linux microVM in AWS (or AWS Lambda container), no physical authenticator or platform TPM/Enclave exists, causing immediate authentication failure (`NotAllowedError` or missing authenticator).

The inverted architecture redirects this ceremony:
1. **Headless Chrome in Cloud MicroVM** invokes WebAuthn.
2. **Chrome MV3 Extension (`webAuthenticationProxy`)** intercepts the ceremony.
3. **Native Messaging Host** receives the options via stdio framing and calls the in-box host gateway on port `1340` (`/api/requestWebAuthnCeremony`).
4. **Cloud Gateway (`frostfire-gateway`)** multiplexes the ceremony into a `WebAuthnCeremonyRequest` frame sent over the persistent gRPC reverse tunnel (`OpenTunnel`) to the user's local workstation.
5. **Local Workstation (`frostfire-daemon` / Tauri desktop)** receives the request and triggers the local platform authenticator (e.g. Windows Hello prompt, Touch ID dialog, or YubiKey tap) via the `CredentialBroker`.
6. **Local Workstation** computes the assertion signature, produces standard W3C AuthenticatorData, and returns a `WebAuthnCeremonyResponse` frame.
7. **Cloud MicroVM** completes the browser's ceremony with the signed assertion JSON.
8. **Security Guarantee**: **Zero Credential Leakage**. The cloud microVM only ever sees ephemeral signed assertion artifacts; private keys never leave the local client machine.

---

## 2. End-to-End Sequence & Component Topology

```
[Cloud MicroVM / Lambda]                                    [Frostfire Edge Gateway]                  [Local Desktop / Client]
  Headless Chromium                                               frostfire-gateway                      frostfire-daemon / Tauri
       │                                                                  │                                         │
       │ 1. navigator.credentials.get(...)                                │                                         │
       ▼                                                                  │                                         │
  [MV3 Extension] (webAuthenticationProxy)                                │                                         │
       │                                                                  │                                         │
       │ 2. chrome.runtime.sendNativeMessage(...)                         │                                         │
       ▼                                                                  │                                         │
  [Native Messaging Host] (webauthn-proxy-host.mjs)                       │                                         │
       │                                                                  │                                         │
       │ 3. HTTP POST 127.0.0.1:1340/api/requestWebAuthnCeremony           │                                         │
       ▼                                                                  │                                         │
  [In-Box Host / MicroVM Daemon]                                          │                                         │
       │                                                                  │                                         │
       │ 4. Forward ceremony to Gateway                                   │                                         │
       └─────────────────────────────────────────────────────────────────►│                                         │
                                                                          │ 5. TunnelServerFrame                    │
                                                                          │    (WebAuthnCeremonyRequest)            │
                                                                          │    over TLS 1.3 gRPC Reverse Tunnel     │
                                                                          └────────────────────────────────────────►│
                                                                                                                    │ 6. CredentialBroker
                                                                                                                    │    Hardware Touch / Hello
                                                                                                                    │    Sign ECDSA P-256
                                                                                                                    │    Zero Leakage Check
                                                                          │ 7. TunnelClientFrame                    │
                                                                          │    (WebAuthnCeremonyResponse)           │
                                                                          │◄────────────────────────────────────────┘
                                                                          │
       ┌──────────────────────────────────────────────────────────────────┘
       │ 8. HTTP 200 { ok: true, credentialJson: ... }
       ▼
  [Native Messaging Host]
       │
       │ 9. Stdio LE uint32 framing
       ▼
  [MV3 Extension]
       │
       │ 10. chrome.webAuthenticationProxy.completeGetRequest(...)
       ▼
  Headless Chromium (Authenticated!)
```

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | MV3 Extension | `chrome.webAuthenticationProxy` Attach | Hooks browser session to intercept all `navigator.credentials` ceremonies | None (`chrome.webAuthenticationProxy.attach()`) | Resolves on success; returns string reason if refused | Logs `attach refused: <reason>`; retry on session change | `syntropy/deploy/microvm/webauthn-proxy/background.js:42-53` |
| 2 | MV3 Extension | Remote Session State Lifecycle | Re-attaches proxy when remote desktop session or browser restarts | Events `onRemoteSessionStateChange`, `onStartup`, `onInstalled` | Calls `attach()` | Exceptions caught and logged to console | `syntropy/deploy/microvm/webauthn-proxy/background.js:8-18` |
| 3 | MV3 Extension | Roaming Authenticator Force (`onIsUvpaaRequest`) | Signals that VM has no platform authenticator; forces relying party to accept roaming authenticator | Request object `{ requestId }` | `completeIsUvpaaRequest({ requestId, isUvpaa: false })` | Cannot fail; hardcoded boolean response | `syntropy/deploy/microvm/webauthn-proxy/background.js:20-26` |
| 4 | MV3 Extension | Ceremony Interception (`onCreateRequest`, `onGetRequest`) | Captures `navigator.credentials.create` and `get` calls from any tab | Request `{ requestId, requestDetailsJson }` | Routes to native host via `sendNativeMessage` | Rejects with `DataError` if unparseable JSON | `syntropy/deploy/microvm/webauthn-proxy/background.js:28-34, 72-84` |
| 5 | MV3 Extension | Remote Desktop Origin Resolution (`resolveCaller`) | Extracts authoritative RP origin using W3C `remoteDesktopClientOverride`, active tab URL, or `https://${rpId}` | `options` object, `rpId` string | `{ origin: string }` | Falls back to `https://${rpId}` if tab query fails | `syntropy/deploy/microvm/webauthn-proxy/background.js:55-70` |
| 6 | MV3 Extension | Ceremony Cancellation Tracking (`onRequestCanceled`) | Tracks in-flight request IDs in a `Set` to prevent duplicate resolution or memory leaks | `requestId` | `inFlight.delete(requestId)` | If request canceled by page, suppresses stale completion | `syntropy/deploy/microvm/webauthn-proxy/background.js:36-40, 114-121` |
| 7 | MV3 Extension | Ceremony Completion (`completeGetRequest`, `completeCreateRequest`) | Resolves browser DOM promise with signed credential JSON | `{ requestId, responseJson }` | DOM promise in webpage resolves with `PublicKeyCredential` | Calls `fail(...)` if native host returns error or throws | `syntropy/deploy/microvm/webauthn-proxy/background.js:96-112` |
| 8 | Native Host | Native Messaging Stdio Framing | Implements Chrome native messaging stdio protocol (4-byte LE length prefix + JSON) | `process.stdin` binary stream | `process.stdout` binary stream | Throws if message exceeds 64MB; returns `DataError` | `syntropy/deploy/microvm/bin/webauthn-proxy-host.mjs:8-9, 44-76` |
| 9 | Native Host | Gateway Credential & Port Discovery | Discovers in-box gateway token and port from environment or filesystem | `$XDG_RUNTIME_DIR/sand-gateway-credential` or `/tmp/xdg-runtime-box/sand-gateway-credential` | `{ token: string, port: string }` | Returns `NotAllowedError` if token is missing/unreadable | `syntropy/deploy/microvm/bin/webauthn-proxy-host.mjs:17-42` |
| 10 | Native Host | In-Box HTTP Dispatch (`requestCeremony`) | Dispatches ceremony payload via HTTP POST to in-box gateway on port 1340 | `{ kind, origin, optionsJson }` | HTTP 200 with `{ ok: true, credentialJson: ... }` | Returns `NotAllowedError` if HTTP status non-200 or network fails | `syntropy/deploy/microvm/bin/webauthn-proxy-host.mjs:78-110` |
| 11 | Native Host | Node Runtime Executable Wrapper | Executable shell shim that locates node runtime and invokes the `.mjs` script | Stdin/stdout and CLI arguments | Passes through to Node process | Exits with status 1 if no node binary found | `syntropy/deploy/microvm/bin/sand-webauthn-proxy-host:1-16` |
| 12 | Policy / OS | Chrome Enterprise Managed Policy | Forces installation of extension in headless Chromium via `ExtensionSettings` | `/etc/opt/chrome/policies/managed/frostfire-webauthn.json` | Extension force-installed on browser startup | Browser fails to load extension if policy file malformed | `syntropy/deploy/microvm/etc-policies/policies/managed/sand-webauthn.json` |
| 13 | Policy / OS | Native Messaging Host Registration | Registers host manifest with Chrome so extension can spawn the native host process | `/etc/opt/chrome/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json` | Chrome launches host on `sendNativeMessage` | Chrome throws error if extension origin not in `allowed_origins` | `syntropy/deploy/microvm/etc-policies/native-messaging-hosts/co.anysphere.sand.webauthn_proxy.json` |
| 14 | Proto Contract | Protocol Buffer Framing (`WebAuthnCeremonyRequest`) | Protobuf definition for transmitting ceremony parameters over gRPC tunnel | `ceremony_id`, `kind`, `origin`, `options_json` | `TunnelServerFrame` / `TunnelClientFrame` field 22 | Protobuf serialization failure if malformed | `crates/frostfire-proto/proto/tunnel.proto:177-183` |
| 15 | Proto Contract | Protocol Buffer Framing (`WebAuthnCeremonyResponse`) | Protobuf definition for transmitting signed credential back over gRPC tunnel | `ceremony_id`, `success`, `credential_json`, `error_name`, `error_message` | `TunnelServerFrame` / `TunnelClientFrame` field 23 | Protobuf serialization failure if malformed | `crates/frostfire-proto/proto/tunnel.proto:185-192` |
| 16 | Tunnel Gateway | Bidirectional Frame Multiplexing | Multiplexes WebAuthn frames alongside terminal, patch, and MCP frames over single TLS stream | `TunnelClientFrame` / `TunnelServerFrame` | Delivered to corresponding session channel | Stream dropped on unauthenticated or corrupted frame | `crates/frostfire-tunnel/tests/tunnel_test.rs:341-395` |
| 17 | Security Broker | Local Assertion Signing (`sign_webauthn_ceremony`) | Signs WebAuthn ceremony on local device without leaking private key | `WebAuthnCeremonyParams`, optional `key_handle` | `WebAuthnCeremonyResult` with W3C assertion JSON | Returns `BrokerError` if keystore error or signing fails | `crates/frostfire-security/src/broker.rs:333-375` |
| 18 | Security Broker | W3C AuthenticatorData Construction | Constructs standard 37+ byte binary AuthenticatorData (`rpIdHash` + flags + `signCount`) | `rp_id`, `sign_count` | 37 bytes binary data with UP bit (`0x01`) set | Panics/fails if RP ID empty | `frostfire/tests/e2e/harness/crypto_bridge.py:74-80` |
| 19 | Security Broker | Zero Credential Leakage Invariant | Guarantees response contains only public assertion artifacts and no private key material | `WebAuthnCeremonyResponse` | `bool` (true = safe, false = leak detected) | Blocks transmission if private key markers detected | `frostfire/tests/e2e/harness/crypto_bridge.py:139-151` |
| 20 | Daemon Orch | Audit Ledger Logging (`webauthn_ceremony`) | Appends every ceremony request/response to append-only tamper-evident Merkle ledger | `ceremony_id`, `kind`, `origin` | Appended block in Merkle audit ledger | Rejects ceremony if ledger disk write fails | `crates/frostfire-daemon/src/orchestrator.rs:451-473` |
| 21 | MicroVM Gateway | Port 1340 In-Box Host Gateway | In-box HTTP server listening on port 1340 for `/api/requestWebAuthnCeremony` | HTTP POST on port 1340 with Bearer token | JSON response `{ ok: true, credentialJson: ... }` | Returns HTTP 403 on token mismatch; 504 on tunnel timeout | `syntropy/deploy/microvm/bin/box-contract.generated.mjs:9` |

---

## 4. Edge Cases and Observed Behaviors

| # | Feature | Input / Condition | Observed Behavior | Handling / Defense |
|---|---------|-------------------|-------------------|--------------------|
| 1 | `background.js` Parse Error | `requestDetailsJson` is invalid or truncated JSON | `JSON.parse` throws syntax error | Caught in `try/catch`, calls `fail(kind, requestId, "DataError", message)`, removes from `inFlight`. |
| 2 | `background.js` Aborted Ceremony | Webpage triggers `AbortController.abort()` mid-ceremony | Chrome fires `onRequestCanceled` event | `inFlight.delete(requestId)` deletes ID. Subsequent completion attempt safely no-ops. |
| 3 | `background.js` Remote Desktop Override | Webpage provides `options.extensions.remoteDesktopClientOverride.origin` | Extension prioritizes this override over active tab URL | Complies with W3C WebAuthn Level 3 Remote Desktop specification. |
| 4 | `background.js` Tab Origin Mismatch | Active tab domain does not match `rpId` (e.g. iframe or background script) | `tab.url.hostname` check fails | Falls back safely to `https://${rpId}` to ensure relying party origin matches. |
| 5 | Native Messaging Buffer | Stdin delivers message in fragmented chunks (<4 bytes initially, then body) | Chunk stream buffers bytes until `buffered.length >= HEADER_BYTES + length` | Message parsed only when full frame arrives. |
| 6 | Native Messaging Oversize | Stdin input exceeds `MAX_MESSAGE_BYTES` (64 MB) | Total bytes checked on each chunk | Immediately throws error "native message exceeded the maximum size" to prevent OOM crash. |
| 7 | Native Messaging EOF | Chrome closes stdin before any message is sent | `readMessage` returns `undefined` | Native host writes failure `{ ok: false, error: { name: "DataError", message: "no native message was received" } }` and exits cleanly. |
| 8 | Credential File Missing | `/tmp/xdg-runtime-box/sand-gateway-credential` does not exist | `credentialFile()` returns `undefined` | If `SAND_GATEWAY_TOKEN` also unset, returns `NotAllowedError` with descriptive message. |
| 9 | In-Box Host Unreachable | Port 1340 is not listening or crashes | `fetch()` throws connection refused | Caught in `main()`, writes `{ ok: false, error: { name: "NotAllowedError", message: "could not reach Sand's in-box host..." } }`. |
| 10 | Host HTTP Status Refusal | In-box host returns HTTP 401/403 (invalid bearer token) | `response.ok` is false | Native host returns `NotAllowedError` with HTTP status code. |
| 11 | Empty Challenge | Ceremony request contains empty challenge (`challenge: b""`) | CredentialBroker checks `request.challenge.is_empty()` | Raises `ValueError` / returns `BrokerError`. Never signs empty challenges. |
| 12 | Empty RP ID | Ceremony request contains empty `rp_id` (`rp_id: ""`) | CredentialBroker checks `request.rp_id.is_empty()` | Raises `ValueError` / returns `BrokerError`. Never signs unbound assertions. |
| 13 | Tampered Signature | Altered signature byte in assertion response | Public key cryptographic verification | Fails ASN.1 DER ECDSA verification. Browser/server rejects corrupted assertion. |
| 14 | Cross-Origin Spoofing | Assertion signed for `original.com` verified against `spoofed.com` | `clientDataJSON.origin` mismatch | Verification fails immediately. Origin binding prevents cross-site replay attacks. |
| 15 | Private Key Invariant Breach | Response accidentally contains private key markers (`BEGIN PRIVATE KEY`, etc.) | `verify_zero_credential_leakage` scans byte stream | Detects forbidden substring and halts transmission. |
| 16 | Audit Ledger Failure | MicroVM or host disk fills up; audit log append fails | `self.ledger.lock().append()` returns `Err` | Orchestrator halts ceremony and returns `LedgerError`. Never executes unlogged ceremonies. |
| 17 | Tunnel Reconnection Storm | Client disconnects and reconnects while ceremony is in-flight | Gateway session replacement logic | Atomic session unregister prevents stale session eviction; client timeout triggers clean retry. |

---

## 5. Specification of Subsystem Files to Port

To bring complete GrokBot Inverted WebAuthn parity into `frostfire-cloud`, the following files must be created, ported, and configured:

```
cloud/microvm/
├── webauthn-proxy/
│   ├── manifest.json                                      # MV3 Chrome Extension Manifest
│   └── background.js                                      # Service Worker WebAuthn interceptor
├── etc-policies/
│   ├── native-messaging-hosts/
│   │   └── io.frostfire.agent.webauthn_proxy.json         # Chrome Native Messaging Host manifest
│   └── policies/
│       └── managed/
│           └── frostfire-webauthn.json                    # Chrome enterprise force-install policy
├── bin/
│   ├── frostfire-webauthn-proxy-host                      # Executable wrapper (locates node)
│   └── webauthn-proxy-host.mjs                            # Stdio framing + HTTP bridge to port 1340
└── scripts/
    └── sand-window-router.mjs                             # (Update) Add port 1340 /api/requestWebAuthnCeremony
```

### File 1: `cloud/microvm/webauthn-proxy/manifest.json`
```json
{
  "manifest_version": 3,
  "name": "Frostfire WebAuthn Inverted Proxy",
  "version": "0.1.0",
  "description": "Intercepts WebAuthn ceremonies in headless Chrome and brokers credentials via local client tunnel",
  "background": {
    "service_worker": "background.js"
  },
  "permissions": [
    "webAuthenticationProxy",
    "nativeMessaging",
    "tabs"
  ]
}
```

### File 2: `cloud/microvm/webauthn-proxy/background.js`
- **Host Identifier**: `const NATIVE_HOST = "io.frostfire.agent.webauthn_proxy";`
- Hooks `chrome.webAuthenticationProxy.attach()`.
- Responds `isUvpaa: false` to `onIsUvpaaRequest` (declaring roaming authenticator).
- Handles `onCreateRequest` and `onGetRequest`, extracting `requestDetailsJson` and resolving origin.
- Forwards to native messaging host via `chrome.runtime.sendNativeMessage`.
- Invokes `completeCreateRequest` or `completeGetRequest` with `result.credentialJson`.
- Handles cancellations via `onRequestCanceled`.

### File 3: `cloud/microvm/etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json`
```json
{
  "name": "io.frostfire.agent.webauthn_proxy",
  "description": "Inverted WebAuthn ceremony proxy bridge for Frostfire MicroVM",
  "path": "/usr/local/bin/frostfire-webauthn-proxy-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://pkjakndclmokfbgfnpgjieoebnbghhgb/"
  ]
}
```

### File 4: `cloud/microvm/etc-policies/policies/managed/frostfire-webauthn.json`
```json
{
  "ExtensionSettings": {
    "pkjakndclmokfbgfnpgjieoebnbghhgb": {
      "installation_mode": "force_installed",
      "update_url": "https://clients2.google.com/service/update2/crx"
    }
  }
}
```

### File 5: `cloud/microvm/bin/frostfire-webauthn-proxy-host`
```bash
#!/usr/bin/env bash
set -euo pipefail

node_bin="${FROSTFIRE_WEBAUTHN_PROXY_NODE:-${SAND_WEBAUTHN_PROXY_NODE:-node}}"
if [ ! -x "${node_bin}" ]; then
	node_bin="$(command -v node || true)"
fi
if [ -z "${node_bin}" ] || [ ! -x "${node_bin}" ]; then
	echo "frostfire-webauthn-proxy-host: no node runtime found" >&2
	exit 1
fi

exec "${node_bin}" /usr/local/bin/webauthn-proxy-host.mjs "$@"
```

### File 6: `cloud/microvm/bin/webauthn-proxy-host.mjs`
- Implements 4-byte LE length prefix stdio parser (`readMessage`, `writeMessage`).
- Discovers credentials via `$XDG_RUNTIME_DIR/sand-gateway-credential` or `/tmp/xdg-runtime-box/sand-gateway-credential`.
- Connects to in-box gateway at `http://127.0.0.1:1340/api/requestWebAuthnCeremony`.
- Handles `NotAllowedError` and `DataError`.

### File 7: Dockerfile & Rootfs Deployment Wiring
In `cloud/microvm/Dockerfile.rootfs`:
1. Create policy and host directories:
   `/etc/opt/chrome/policies/managed`, `/etc/opt/chrome/native-messaging-hosts`, `/etc/chromium/policies/managed`, `/etc/chromium/native-messaging-hosts`.
2. Copy extension files to `/cloud/microvm/webauthn-proxy/`.
3. Copy managed policy and native host manifests to `/etc/opt/chrome/`.
4. Copy `frostfire-webauthn-proxy-host` and `webauthn-proxy-host.mjs` to `/usr/local/bin/` with `chmod +x`.
5. Expose port `1340` alongside `1337`, `1338`, `1339`.

---

## 6. gRPC Reverse Tunnel Protocol Marshaling & Schema Verification

The protocol buffers are already defined in `crates/frostfire-proto/proto/tunnel.proto`:

### Ceremony Request (`WebAuthnCeremonyRequest`)
```protobuf
message WebAuthnCeremonyRequest {
  string ceremony_id = 1;
  string kind = 2; // "get" or "create"
  string origin = 3;
  string options_json = 4;
}
```

### Ceremony Response (`WebAuthnCeremonyResponse`)
```protobuf
message WebAuthnCeremonyResponse {
  string ceremony_id = 1;
  bool success = 2;
  string credential_json = 3;
  string error_name = 4;
  string error_message = 5;
}
```

### Frame Multiplexing
- `TunnelServerFrame` (Gateway -> Client): payload field 22 (`webauthn_request`), field 23 (`webauthn_response`).
- `TunnelClientFrame` (Client -> Gateway): payload field 22 (`webauthn_request`), field 23 (`webauthn_response`).

Both directions are supported symmetrically, allowing either the cloud agent to challenge the client, or a client to initiate a test ceremony.

---

## 7. Security Invariants & Verification Checklist

| Invariant | Specification Requirement | Verification Method |
|---|---|---|
| **Zero Credential Leakage** | Private key bytes, seed phrases, or master secrets MUST NEVER cross the tunnel or enter cloud disk. | `verify_zero_credential_leakage` asserts no forbidden key markers (`BEGIN PRIVATE KEY`, `d:`, etc.) exist in response frames. |
| **Origin Binding** | Relying Party ID and client origin must be strictly validated. | Verification calculates `rpIdHash` (SHA-256) and verifies `clientDataJSON.origin` matches expected relying party. |
| **User Presence (UP)** | Assertion must verify user physical presence. | AuthenticatorData byte 32 enforces bit 0 is set (`flags & 0x01 == 0x01`). |
| **Constant-Time Auth** | All gateway and router token validations must prevent timing side channels. | In-box gateway and cloud gateway enforce `subtle::ConstantTimeEq` / `timingSafeEqual`. |
| **Tamper-Evident Audit** | All ceremonies must be recorded prior to dispatch. | Orchestrator logs to `MerkleAuditLedger`; disk errors reject ceremony. |

---

## 8. Verification Strategy & Implementation Plan

1. **Phase 1: Asset Porting**
   - Copy extension files to `cloud/microvm/webauthn-proxy/`.
   - Copy manifests to `cloud/microvm/etc-policies/`.
   - Copy native host scripts to `cloud/microvm/bin/`.
2. **Phase 2: In-Box Gateway Listener**
   - Add port 1340 HTTP handler `/api/requestWebAuthnCeremony` to `sand-window-router.mjs` or microVM daemon.
3. **Phase 3: Automated Testing & Verification**
   - Run `cargo test --workspace` to ensure 0 warnings, 0 errors.
   - Run `cargo test --package frostfire-tunnel --test tunnel_test`.
   - Run `cargo test --package frostfire-gateway`.
   - Execute integration test validating end-to-end roundtrip:
     Headless Chrome / simulated ceremony -> Port 1340 -> Gateway -> gRPC Reverse Tunnel -> Client `CredentialBroker` -> Gateway -> Browser completion.
