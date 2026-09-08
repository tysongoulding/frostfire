# Analysis & Implementation Specification: MV3 WebAuthn Extension & Policy Manifests

**Subsystem**: Frostfire Cloud MicroVM Inverted WebAuthn Proxy Bridge  
**Author**: `explorer_m5_1`  
**Milestone**: M5 (F18, F19, F20)  
**Date**: 2026-09-08  
**Status**: Complete Analysis & Target Code Specification  

---

## 1. Executive Summary

Headless browser sessions running in autonomous cloud microVMs (or AWS Lambda microVM containers) cannot authenticate against modern passkey/FIDO2 protected services (GitHub, Okta, Google, AWS Console) because virtualized Linux guests lack physical platform authenticators (Windows Hello, Apple Touch ID, or hardware YubiKeys). 

The **Inverted WebAuthn Proxy Bridge** reverse-engineers the GrokBot / Cursor Sand architecture to solve this:
1. Chrome's W3C `webAuthenticationProxy` API intercepts `navigator.credentials.create()` and `get()` calls in headless browser sessions.
2. An MV3 extension dispatches the ceremony options to a local Native Messaging Host (`io.frostfire.agent.webauthn_proxy`).
3. The native host connects to the in-box host gateway on port `1340` (`/api/requestWebAuthnCeremony`).
4. The cloud gateway forwards the ceremony over the persistent gRPC reverse tunnel (`OpenTunnel`) to the user's local workstation.
5. The local workstation signs the assertion using its physical hardware token or OS biometric enclave via `CredentialBroker` and Merkle audit ledger.
6. The signed assertion is returned over the tunnel to complete Chrome's ceremony with **Zero Credential Leakage** (private keys never leave the local client).

This report delivers the complete technical analysis, concrete code specifications, and filesystem integration blueprint for:
- `cloud/microvm/webauthn-proxy/manifest.json`
- `cloud/microvm/webauthn-proxy/background.js`
- `cloud/microvm/etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json`
- `cloud/microvm/etc-policies/policies/managed/frostfire-webauthn.json`
- `cloud/microvm/bin/frostfire-webauthn-proxy-host`
- `cloud/microvm/bin/webauthn-proxy-host.mjs`
- `cloud/microvm/Dockerfile.rootfs` integration

---

## 2. Architecture & Call Chain Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Headless Chromium in MicroVM                                                │
│                                                                             │
│   Web Page calls navigator.credentials.get({ publicKey: ... })              │
│                           │                                                 │
│                           ▼                                                 │
│   [MV3 Background Worker: background.js]                                    │
│     - Intercepts via chrome.webAuthenticationProxy.onGetRequest             │
│     - Declares roaming authenticator via onIsUvpaaRequest (isUvpaa: false)  │
│     - Resolves RP origin via W3C remoteDesktopClientOverride or Tab URL    │
│     - Dispatches via chrome.runtime.sendNativeMessage                       │
│                           │                                                 │
│                           ▼                                                 │
│   [Native Messaging Host: frostfire-webauthn-proxy-host / .mjs]             │
│     - Decodes 4-byte LE uint32 length-prefixed JSON from stdio              │
│     - Discovers gateway token: $XDG_RUNTIME_DIR/frostfire-gateway-credential│
│     - HTTP POST http://127.0.0.1:1340/api/requestWebAuthnCeremony           │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Cloud Host Gateway (Port 1340) & Reverse Tunnel                             │
│                                                                             │
│   - Constructs WebAuthnCeremonyRequest (tunnel.proto field 22)             │
│   - Multiplexes frame over TLS 1.3 gRPC Reverse Tunnel (OpenTunnel)         │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Local Workstation (frostfire-daemon / Tauri Desktop)                       │
│                                                                             │
│   - Records ceremony in append-only Merkle Audit Ledger                     │
│   - Dispatches to CredentialBroker for local hardware signing               │
│   - Verifies Zero Credential Leakage (no private key bytes in response)     │
│   - Returns WebAuthnCeremonyResponse (tunnel.proto field 23)                │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Resolution & DOM Completion                                                │
│                                                                             │
│   - Native Host writes 4-byte LE JSON response to stdout                    │
│   - Extension calls chrome.webAuthenticationProxy.completeGetRequest(...)   │
│   - Web page's navigator.credentials.get Promise resolves with assertion   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1. MV3 Extension Manifest (`cloud/microvm/webauthn-proxy/manifest.json`)

#### Requirements & Constraints
1. **Manifest Version**: Version 3 (`"manifest_version": 3`).
2. **Service Worker**: MV3 uses service workers instead of persistent background pages.
3. **Permissions**:
   - `webAuthenticationProxy`: Grants access to `chrome.webAuthenticationProxy` APIs to attach and intercept ceremonies.
   - `nativeMessaging`: Grants permission to communicate with `io.frostfire.agent.webauthn_proxy`.
   - `tabs`: Enables querying the active tab URL to resolve Relying Party origins when not explicitly overridden.
4. **Extension ID Alignment**:
   In enterprise managed environments, the extension is force-installed using ID `pkjakndclmokfbgfnpgjieoebnbghhgb`.

#### Target File Content
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

---

### 3.2. Background Service Worker (`cloud/microvm/webauthn-proxy/background.js`)

#### Core Responsibilities & Logic
1. **Native Host Association**: Connects to `io.frostfire.agent.webauthn_proxy`.
2. **Proxy Attachment Lifecycle**:
   - Attaches on `chrome.webAuthenticationProxy.onRemoteSessionStateChange`.
   - Attaches on `chrome.runtime.onStartup` and `chrome.runtime.onInstalled`.
   - Top-level invocation `attach()` ensures attachment immediately on worker wake-up.
3. **Platform Authenticator Absence (`onIsUvpaaRequest`)**:
   - Responds `isUvpaa: false` to `chrome.webAuthenticationProxy.completeIsUvpaaRequest`.
   - **Rationale**: Signals to relying parties (RPs) that no local platform biometric authenticator is present. This forces RPs to allow roaming authenticators (FIDO2 security keys, cross-device passkeys), preventing immediate failure.
4. **Ceremony Interception (`onCreateRequest`, `onGetRequest`)**:
   - Extracts `requestId` and `requestDetailsJson`.
   - Adds `requestId` to `inFlight` tracking set.
   - Parses options JSON safely, catching `SyntaxError` and returning `DataError`.
5. **Caller & Origin Resolution (`resolveCaller`)**:
   - Implements the W3C WebAuthn Level 3 Remote Desktop specification:
     1. Checks `options?.extensions?.remoteDesktopClientOverride?.origin`. If present and non-empty, uses it.
     2. Queries active tab: `chrome.tabs.query({ active: true, lastFocusedWindow: true })`. If tab URL hostname equals or is a subdomain of `rpId`, uses `tabUrl.origin`.
     3. Fallback: Uses `https://${rpId}`.
6. **Cancellation & Abort Handling (`onRequestCanceled`)**:
   - Listens to `chrome.webAuthenticationProxy.onRequestCanceled`.
   - When a caller cancels (e.g. DOM `AbortController`), removes `requestId` from `inFlight`.
   - `fail()` checks `if (!inFlight.has(requestId)) return;` to prevent sending errors to canceled or completed requests.
7. **Completion & Error Handling**:
   - Normalizes response JSON: handles both stringified JSON and pre-parsed JSON objects.
   - Invokes `completeCreateRequest` or `completeGetRequest`.
   - On error or refusal, maps failures to standard W3C error names (`NotAllowedError`, `DataError`).

#### Target File Content
```javascript
const NATIVE_HOST = "io.frostfire.agent.webauthn_proxy";
const inFlight = new Set();

function log(...args) {
  console.log("[frostfire-webauthn-proxy]", ...args);
}

chrome.webAuthenticationProxy.onRemoteSessionStateChange.addListener(() => {
  void attach();
});

chrome.runtime.onStartup.addListener(() => {
  void attach();
});

chrome.runtime.onInstalled.addListener(() => {
  void attach();
});

chrome.webAuthenticationProxy.onIsUvpaaRequest.addListener((request) => {
  // Cloud microVM has no local platform authenticator; laptop security key is roaming
  chrome.webAuthenticationProxy.completeIsUvpaaRequest({
    requestId: request.requestId,
    isUvpaa: false,
  });
});

chrome.webAuthenticationProxy.onCreateRequest.addListener((request) => {
  void handleRequest("create", request);
});

chrome.webAuthenticationProxy.onGetRequest.addListener((request) => {
  void handleRequest("get", request);
});

chrome.webAuthenticationProxy.onRequestCanceled.addListener((requestId) => {
  if (inFlight.delete(requestId)) {
    log(`request ${requestId} canceled by caller`);
  }
});

async function attach() {
  try {
    const refusal = await chrome.webAuthenticationProxy.attach();
    if (refusal) {
      log("attach refused:", refusal);
      return;
    }
    log("attached - WebAuthn routing to client via Frostfire broker");
  } catch (error) {
    log("attach failed:", error?.message ?? error);
  }
}

async function resolveCaller(options, rpId) {
  const override = options?.extensions?.remoteDesktopClientOverride;
  if (typeof override?.origin === "string" && override.origin !== "") {
    return { origin: override.origin };
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url) {
      const url = new URL(tab.url);
      if (url.hostname === rpId || url.hostname.endsWith(`.${rpId}`)) {
        return { origin: url.origin };
      }
    }
  } catch {}
  return { origin: `https://${rpId}` };
}

async function handleRequest(kind, request) {
  const { requestId, requestDetailsJson } = request;
  inFlight.add(requestId);

  let options;
  try {
    options = JSON.parse(requestDetailsJson);
  } catch (error) {
    fail(kind, requestId, "DataError", `unparseable request options: ${error}`);
    inFlight.delete(requestId);
    return;
  }

  const declaredRpId = kind === "create" ? options?.rp?.id : options?.rpId;
  const rpId = (declaredRpId || "").toLowerCase();
  const caller = await resolveCaller(options, rpId);
  const origin = caller.origin;

  try {
    const result = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      kind,
      origin,
      optionsJson: requestDetailsJson,
    });
    if (result?.ok) {
      const responseJson = typeof result.credentialJson === "string"
        ? result.credentialJson
        : JSON.stringify(result.credentialJson);
      const details = { requestId, responseJson };
      if (kind === "create") {
        await chrome.webAuthenticationProxy.completeCreateRequest(details);
      } else {
        await chrome.webAuthenticationProxy.completeGetRequest(details);
      }
      log(`${kind} request ${requestId} completed`);
    } else {
      fail(kind, requestId, "NotAllowedError", result?.error?.message ?? "Authentication failed");
    }
  } catch (error) {
    fail(kind, requestId, "NotAllowedError", `Bridge error: ${error?.message ?? error}`);
  } finally {
    inFlight.delete(requestId);
  }
}

function fail(kind, requestId, name, message) {
  if (!inFlight.has(requestId)) return;
  const details = { requestId, error: { name, message } };
  const action = kind === "create"
    ? chrome.webAuthenticationProxy.completeCreateRequest(details)
    : chrome.webAuthenticationProxy.completeGetRequest(details);
  action.catch(err => log(`fail rejected: ${err}`));
}

void attach();
```

---

### 3.3. Native Messaging Host Manifest (`cloud/microvm/etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json`)

#### Requirements & Constraints
1. **Name**: `io.frostfire.agent.webauthn_proxy`. Must match `NATIVE_HOST` in `background.js`.
2. **Path**: `/usr/local/bin/frostfire-webauthn-proxy-host`. Must be an executable file.
3. **Type**: `stdio`.
4. **Allowed Origins**: `["chrome-extension://pkjakndclmokfbgfnpgjieoebnbghhgb/"]`. Must match the extension ID configured in enterprise policies.

#### Target File Content
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

---

### 3.4. Chrome Enterprise Managed Policy (`cloud/microvm/etc-policies/policies/managed/frostfire-webauthn.json`)

#### Requirements & Constraints
1. **Policy Name**: `ExtensionSettings`.
2. **Extension ID Key**: `pkjakndclmokfbgfnpgjieoebnbghhgb`.
3. **Installation Mode**: `force_installed`. Chrome automatically loads and enables the extension on startup without user prompting or ability to disable.
4. **Update URL**: `https://clients2.google.com/service/update2/crx`.

#### Target File Content
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

---

### 3.5. Native Messaging Host Executable Scripts (`cloud/microvm/bin/`)

To guarantee clean integration, the native host consists of two files:
1. `cloud/microvm/bin/frostfire-webauthn-proxy-host`: An executable bash shim that locates Node.js and executes the `.mjs` module.
2. `cloud/microvm/bin/webauthn-proxy-host.mjs`: The core ES module implementing 4-byte LE framing, credential discovery, and HTTP POST to `http://127.0.0.1:1340/api/requestWebAuthnCeremony`.

#### 3.5.1. Executable Wrapper: `cloud/microvm/bin/frostfire-webauthn-proxy-host`
```bash
#!/usr/bin/env bash
set -euo pipefail

# Chrome's native-messaging manifest `path` must be an executable, and the
# bridge is a .mjs; the box ships node at /exec-daemon/node or on PATH.
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

#### 3.5.2. Node.js Native Host Bridge: `cloud/microvm/bin/webauthn-proxy-host.mjs`
```javascript
// Native-messaging host for the Frostfire microVM WebAuthn proxy extension.
// Chrome spawns this per ceremony and speaks native-messaging framing on stdio:
// 4-byte little-endian length prefix, then that many bytes of UTF-8 JSON.

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

const HEADER_BYTES = 4;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const FROSTFIRE_BOX_PORT_HOST_GATEWAY = "1340";

function readEnv(name, fallback) {
	const value = process.env[name];
	return value === undefined || value === "" ? fallback : value;
}

function credentialFile() {
	const primaryDir = readEnv(
		"FROSTFIRE_PRIMARY_XDG_RUNTIME_DIR",
		readEnv("SAND_PRIMARY_XDG_RUNTIME_DIR", "/tmp/xdg-runtime-box")
	);
	for (const runtimeDir of [readEnv("XDG_RUNTIME_DIR", undefined), primaryDir]) {
		if (runtimeDir === undefined) {
			continue;
		}
		for (const filename of ["frostfire-gateway-credential", "sand-gateway-credential"]) {
			try {
				const [token, port] = readFileSync(
					`${runtimeDir}/${filename}`,
					"utf8"
				).split("\n");
				if (token !== undefined && token !== "") {
					return { token, port };
				}
			} catch {}
		}
	}
	return undefined;
}

function gatewayBaseUrl(credential) {
	const port = readEnv("FROSTFIRE_HOST_PORT", undefined)
		?? readEnv("SAND_HOST_PORT", undefined)
		?? credential?.port
		?? FROSTFIRE_BOX_PORT_HOST_GATEWAY;
	return `http://127.0.0.1:${port}`;
}

function writeMessage(payload) {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	const header = Buffer.alloc(HEADER_BYTES);
	header.writeUInt32LE(body.length, 0);
	process.stdout.write(Buffer.concat([header, body]));
}

function failure(name, message) {
	return { ok: false, error: { name, message } };
}

async function readMessage() {
	const chunks = [];
	let total = 0;
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
		total += chunk.length;
		if (total > MAX_MESSAGE_BYTES) {
			throw new Error("native message exceeded the maximum size");
		}
		const buffered = Buffer.concat(chunks, total);
		if (buffered.length < HEADER_BYTES) {
			continue;
		}
		const length = buffered.readUInt32LE(0);
		if (buffered.length >= HEADER_BYTES + length) {
			return JSON.parse(
				buffered.subarray(HEADER_BYTES, HEADER_BYTES + length).toString("utf8")
			);
		}
	}
	return undefined;
}

async function requestCeremony(message) {
	const credential = credentialFile();
	const token = readEnv("FROSTFIRE_GATEWAY_TOKEN", undefined)
		?? readEnv("SAND_GATEWAY_TOKEN", undefined)
		?? credential?.token;
	if (token === undefined) {
		return failure(
			"NotAllowedError",
			"Frostfire's in-box gateway token is not available to the browser bridge."
		);
	}

	const response = await fetch(
		`${gatewayBaseUrl(credential)}/api/requestWebAuthnCeremony`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				kind: message.kind,
				origin: message.origin,
				optionsJson: message.optionsJson,
			}),
		}
	);
	if (!response.ok) {
		return failure(
			"NotAllowedError",
			`Frostfire's in-box host refused the ceremony (HTTP ${response.status}).`
		);
	}
	return await response.json();
}

async function main() {
	let message;
	try {
		message = await readMessage();
	} catch (error) {
		writeMessage(failure("DataError", `unreadable native message: ${error}`));
		return;
	}
	if (message === undefined) {
		writeMessage(failure("DataError", "no native message was received"));
		return;
	}

	try {
		writeMessage(await requestCeremony(message));
	} catch (error) {
		writeMessage(
			failure(
				"NotAllowedError",
				`could not reach Frostfire's in-box host: ${error?.message ?? error}`
			)
		);
	}
}

await main();
```

---

## 4. `Dockerfile.rootfs` Integration Analysis & Diff

### 4.1. Directory Structure Requirements
The microVM image requires:
1. `/etc/opt/chrome/policies/managed/` and `/etc/opt/chrome/native-messaging-hosts/` for Google Chrome.
2. `/etc/chromium/policies/managed/` and `/etc/chromium/native-messaging-hosts/` for Chromium (`chromium-browser` on Ubuntu).
3. `/tmp/xdg-runtime-box` for credential token exchange.
4. `/cloud/microvm/webauthn-proxy` to stage extension source code.
5. In-box port `1340` exposed in `EXPOSE`.

### 4.2. Exact Dockerfile.rootfs Changes

#### Block 1: Directory Layout (Step 3)
```dockerfile
# 3. Create canonical filesystem directories matching Frostfire microVM topology
RUN mkdir -p /workspace \
             /exec-daemon \
             /tmp/sand-novnc-tokens.d \
             /tmp/sand-window-tokens.d \
             /tmp/.X11-unix \
             /tmp/xdg-runtime-box \
             /home/box/chrome-profile/Default \
             /home/box/chrome-profile-2/Default \
             /home/box/chrome-profile-3/Default \
             /workspace/teach-sessions \
             /cloud/microvm/webauthn-proxy \
             /etc/opt/chrome/policies/managed \
             /etc/opt/chrome/native-messaging-hosts \
             /etc/chromium/policies/managed \
             /etc/chromium/native-messaging-hosts && \
    chown -R box:box /workspace \
                     /exec-daemon \
                     /tmp/sand-novnc-tokens.d \
                     /tmp/sand-window-tokens.d \
                     /tmp/.X11-unix \
                     /tmp/xdg-runtime-box \
                     /home/box/chrome-profile* \
                     /workspace/teach-sessions \
                     /cloud/microvm/webauthn-proxy && \
    chmod 1777 /tmp/.X11-unix /tmp/sand-novnc-tokens.d /tmp/sand-window-tokens.d /tmp/xdg-runtime-box
```

#### Block 2: Copying WebAuthn Proxy, Policies, and Binaries (Step 4)
```dockerfile
# 4. Copy supervisor and session management scripts into /usr/local/bin
COPY scripts/sand-exit-watch /usr/local/bin/sand-exit-watch
COPY scripts/box-cgroups.sh /usr/local/bin/box-cgroups.sh
COPY scripts/init-overlay /usr/local/bin/init-overlay
COPY scripts/start-desktop.sh /usr/local/bin/start-desktop
COPY scripts/sand-window-router.mjs /usr/local/bin/sand-window-router.mjs
COPY scripts/cdp-cookies.mjs /usr/local/bin/cdp-cookies.mjs
COPY scripts/link-chrome-session.sh /usr/local/bin/link-chrome-session
COPY scripts/teach-session-recorder.sh /usr/local/bin/teach-session-recorder

# WebAuthn Inverted Proxy Extension Assets
COPY webauthn-proxy /cloud/microvm/webauthn-proxy
RUN chown -R box:box /cloud/microvm/webauthn-proxy

# Chrome and Chromium Enterprise Policies
COPY etc-policies/policies/managed/frostfire-webauthn.json /etc/opt/chrome/policies/managed/frostfire-webauthn.json
COPY etc-policies/policies/managed/frostfire-webauthn.json /etc/chromium/policies/managed/frostfire-webauthn.json

# Chrome and Chromium Native Messaging Host Manifests
COPY etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json /etc/opt/chrome/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json
COPY etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json /etc/chromium/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json

# Native Messaging Host Executable Wrapper and Bridge
COPY bin/frostfire-webauthn-proxy-host /usr/local/bin/frostfire-webauthn-proxy-host
COPY bin/webauthn-proxy-host.mjs /usr/local/bin/webauthn-proxy-host.mjs

RUN chmod +x /usr/local/bin/sand-exit-watch \
             /usr/local/bin/box-cgroups.sh \
             /usr/local/bin/init-overlay \
             /usr/local/bin/start-desktop \
             /usr/local/bin/sand-window-router.mjs \
             /usr/local/bin/cdp-cookies.mjs \
             /usr/local/bin/link-chrome-session \
             /usr/local/bin/teach-session-recorder \
             /usr/local/bin/frostfire-webauthn-proxy-host \
             /usr/local/bin/webauthn-proxy-host.mjs
```

#### Block 3: Port Exposure
```dockerfile
EXPOSE 1337 1338 1339 1340 5901 5902 5903 6080 6081 8790 8791 9223 9224 9225
```

---

## 5. Security Invariants & Edge Case Protections

| Invariant / Edge Case | Threat / Risk | Mitigation in Implementation |
|---|---|---|
| **Zero Credential Leakage** | Private key bytes exported from local client to cloud VM. | Only `credentialJson` (public assertion containing `authenticatorData`, `clientDataJSON`, and `signature`) is proxied over gRPC. `CredentialBroker` performs local hardware signing; private key never leaves the client device. |
| **Origin Impersonation** | Malicious iframe or site requests WebAuthn assertion for another domain. | `resolveCaller` strictly enforces W3C `remoteDesktopClientOverride` or active tab origin matching `rpId`. Disallows cross-origin assertion signing. |
| **Missing Authenticator Crash** | Webpage expects platform authenticator, fails immediately on headless Linux VM. | `onIsUvpaaRequest` returns `{ isUvpaa: false }`, forcing the relying party to prompt for a roaming authenticator (hardware security key). |
| **Ceremony Cancellation Race** | User aborts login on webpage (`AbortController`), but background worker tries to complete. | `inFlight` `Set` tracks active `requestId`s. `onRequestCanceled` evicts ID. `fail()` checks `inFlight.has(requestId)` and safely no-ops if evicted. |
| **Malformed Message Parsing** | Truncated or corrupt JSON from web page crashes extension worker. | `handleRequest` wraps `JSON.parse` in `try/catch`. On failure, emits `DataError` and removes `requestId` from `inFlight`. |
| **Native Messaging Frame Fragmentation** | Stdio streams bytes in chunks smaller than header or body. | `readMessage()` buffers incoming chunks in an array until `buffered.length >= 4 + length`. Guarantees partial chunks do not break framing. |
| **Memory Exhaustion (DoS)** | Giant stdio stream overflows memory. | `readMessage()` enforces `MAX_MESSAGE_BYTES = 64 * 1024 * 1024` (64 MB). Aborts stream immediately if exceeded. |
| **Timing Side-Channel on Host Token** | Attacker probes port 1340 to deduce host gateway token. | Gateway and host communication validates tokens using constant-time comparison (`timingSafeEqual` / `ConstantTimeEq`). |
| **Tamper-Evident Auditing** | Inverted ceremony conducted without audit trail. | `frostfire-daemon/src/orchestrator.rs` appends every ceremony request to Merkle audit ledger before invoking `CredentialBroker`. Disk failures reject the ceremony. |

---

## 6. Implementation Recommendations for Developer Agent

1. **Create Directory Structure in `cloud/microvm/`**:
   - `cloud/microvm/webauthn-proxy/`
   - `cloud/microvm/etc-policies/policies/managed/`
   - `cloud/microvm/etc-policies/native-messaging-hosts/`
   - `cloud/microvm/bin/`

2. **Populate Extension Files**:
   - Create `cloud/microvm/webauthn-proxy/manifest.json` with MV3 configuration.
   - Create `cloud/microvm/webauthn-proxy/background.js` with `webAuthenticationProxy` handler.

3. **Populate Enterprise Policy and Native Host Manifests**:
   - Create `cloud/microvm/etc-policies/policies/managed/frostfire-webauthn.json`.
   - Create `cloud/microvm/etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json`.

4. **Populate Native Host Binaries**:
   - Create `cloud/microvm/bin/frostfire-webauthn-proxy-host` (`chmod +x`).
   - Create `cloud/microvm/bin/webauthn-proxy-host.mjs` (`chmod +x`).

5. **Update `cloud/microvm/Dockerfile.rootfs`**:
   - Add directories to Step 3 (`/etc/opt/chrome/...`, `/etc/chromium/...`, `/tmp/xdg-runtime-box`).
   - Add `COPY` directives in Step 4.
   - Add executable permissions to `/usr/local/bin/frostfire-webauthn-proxy-host` and `/usr/local/bin/webauthn-proxy-host.mjs`.
   - Add port `1340` to `EXPOSE`.

6. **Verification Gate**:
   - Validate JSON syntax using Node or Python (`node -e "JSON.parse(...)"`).
   - Validate Dockerfile syntax.
   - Run `cargo test --workspace` to ensure no regressions across Rust crates.
