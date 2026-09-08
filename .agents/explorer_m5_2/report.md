# Technical Analysis & Specification: WebAuthn Native Messaging Host & Stdio Framing

**Subsystem**: Frostfire Cloud MicroVM Virtualization Infrastructure — Inverted WebAuthn Proxy Bridge  
**Target Files**:
- `cloud/microvm/bin/frostfire-webauthn-proxy-host` (Executable Bash wrapper)
- `cloud/microvm/bin/webauthn-proxy-host.mjs` (NodeJS Native Messaging Host)  
**Milestone**: M5.2  
**Author**: `explorer_m5_2`  
**Date**: 2026-09-08  

---

## 1. Executive Summary & Architectural Role

The **WebAuthn Native Messaging Host** is the intermediary bridge between the headless Chromium browser running inside an isolated cloud microVM (or containerized microVM guest) and the in-box microVM control plane listening on localhost port `1340`.

In modern web authentication, FIDO2/WebAuthn ceremonies (`navigator.credentials.get()` and `navigator.credentials.create()`) require user presence and cryptographic signing by a physical authenticator (such as a YubiKey, Apple Touch ID, or Windows Hello). In headless microVM environments, no local physical authenticator or platform TPM exists. To authenticate headless browser sessions against enterprise web applications without exposing or transmitting private keys to cloud infrastructure, the **Inverted WebAuthn Proxy Bridge** intercepts WebAuthn calls via Chrome's Manifest V3 `webAuthenticationProxy` API in an extension (`background.js`), forwards the raw ceremony parameters to the native messaging host via `chrome.runtime.sendNativeMessage()`, which in turn relays the ceremony via HTTP POST to the in-box gateway at `http://127.0.0.1:1340/api/requestWebAuthnCeremony`. The in-box gateway marshals the request into `WebAuthnCeremonyRequest` frames sent over the persistent gRPC reverse tunnel (`OpenTunnel`) to the user's local workstation, where the local platform authenticator signs the assertion and returns public W3C assertion artifacts with **Zero Credential Leakage**.

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             CLOUD MICROVM GUEST                                                   │
│                                                                                                                   │
│   ┌───────────────────────────┐      chrome.runtime.sendNativeMessage()      ┌────────────────────────────────┐  │
│   │   Headless Chromium       │ ───────────────────────────────────────────► │  frostfire-webauthn-proxy-host │  │
│   │   (MV3 Extension Worker)  │ ◄─────────────────────────────────────────── │  (Bash Shim -> Node.js host)   │  │
│   └───────────────────────────┘         4-byte LE framing on stdio           └────────────────┬───────────────┘  │
│                                                                                               │                   │
│                                                                        HTTP POST :1340        │                   │
│                                                                        /api/requestWebAuthn   │                   │
│                                                                        Bearer Token Auth      ▼                   │
│                                                                              ┌────────────────────────────────┐  │
│                                                                              │      In-Box Host Gateway       │  │
│                                                                              │        (Port 1340)             │  │
│                                                                              └────────────────┬───────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┘
                                                                                                │
                                                                           gRPC Reverse Tunnel  │ WebAuthnCeremonyRequest
                                                                           (TLS 1.3 OpenTunnel) │ WebAuthnCeremonyResponse
                                                                                                ▼
                                                                               ┌────────────────────────────────┐
                                                                               │      Local Workstation         │
                                                                               │   (Tauri / CredentialBroker)   │
                                                                               │   Windows Hello / Touch ID     │
                                                                               └────────────────────────────────┘
```

The native messaging host must strictly adhere to the Chromium Native Messaging protocol, guarantee robust chunk reassembly across arbitrary TCP/pipe fragmentation, enforce safety circuit breakers against memory exhaustion, handle multi-source credential discovery, dispatch authenticated HTTP POST requests, and deliver compliant JSON responses back to Chrome.

---

## 2. Chromium Native Messaging Stdio Framing Specification

Chrome communicates with native messaging hosts via standard input (`stdin`) and standard output (`stdout`).

### 2.1 Stdio Wire Framing Contract

1. **Header**: Exactly 4 bytes containing a 32-bit unsigned integer (`uint32`) in native byte order (Little-Endian on x86_64 and aarch64 Linux systems).
2. **Payload**: Exactly $N$ bytes of UTF-8 encoded JSON, where $N$ is the value encoded in the 4-byte header.
3. **Directionality**:
   - **Chrome -> Host (`stdin`)**: Chrome sends a single framed JSON message containing the ceremony details (`kind`, `origin`, `optionsJson`).
   - **Host -> Chrome (`stdout`)**: The host responds with a single framed JSON message containing the result (`{ ok: true, credentialJson: ... }` or `{ ok: false, error: { name: ..., message: ... } }`).
4. **Strict Isolation of `stdout`**:
   - In Chromium Native Messaging, **`stdout` is strictly reserved for framed protocol messages**.
   - Any extraneous output written to `stdout` (e.g., debug messages, `console.log`, uncaught warning outputs) will corrupt the byte stream, cause the browser's native messaging deserializer to fail, and trigger an immediate process termination error (`"Native host has exited"`).
   - **All diagnostic, trace, and debug logging MUST be directed to `stderr`** (`process.stderr.write` or `console.error`).

### 2.2 Binary Stream Fragmentation & Chunk Buffering

In Node.js, `process.stdin` is an asynchronous `Readable` stream emitting chunks of type `Buffer`. Because stdio is a streaming byte conduit:
- A chunk may arrive with fewer than 4 bytes (header fragmentation).
- A chunk may contain the 4-byte header and an incomplete slice of the payload.
- A single large message may be split across multiple read events.
- Reading must buffer chunks into a continuous sequence until `buffered.length >= 4 + payloadLength`.

#### Stream Parser State Machine

```
         ┌───────────────────┐
         │  process.stdin    │
         └─────────┬─────────┘
                   │ chunk
                   ▼
         ┌───────────────────┐
         │ Append to chunks  │
         │ total += chunk.len│
         └─────────┬─────────┘
                   │
                   ▼
       [ total > 64 MB? ] ─────── YES ────► Throw "native message exceeded maximum size"
                   │ NO
                   ▼
       [ total < 4 bytes? ] ───── YES ────► Continue reading next chunk
                   │ NO
                   ▼
         ┌───────────────────┐
         │ Read length       │
         │ (uint32LE at 0)   │
         └─────────┬─────────┘
                   │
                   ▼
       [ length > 64 MB? ] ────── YES ────► Throw "native message header length exceeds maximum size"
                   │ NO
                   ▼
    [ total < 4 + length? ] ───── YES ────► Continue reading next chunk
                   │ NO
                   ▼
         ┌──────────────────────────────────────┐
         │ Extract buffered[4 .. 4+length]       │
         │ Parse JSON -> Return message object   │
         └──────────────────────────────────────┘
```

---

## 3. Bash Shim Specification: `cloud/microvm/bin/frostfire-webauthn-proxy-host`

### 3.1 Rationale & Constraints

Chrome requires the native host executable specified in the native messaging manifest (`"path"`) to be a directly executable binary. A `.mjs` script requires an explicit JavaScript runtime interpreter. In containerized and microVM guest environments, the Node.js binary may be installed at varying paths (`/usr/bin/node`, `/usr/local/bin/node`, or `/exec-daemon/node`). The wrapper shim:
1. Detects available Node.js runtimes using environment overrides, system `PATH`, and standard Linux installation locations.
2. Locates the companion `webauthn-proxy-host.mjs` script, allowing both container production paths and local test harness overrides.
3. Replaces the shell process using `exec` to prevent orphan shell processes and ensure signals and exit codes are directly communicated between Chrome and Node.js.

### 3.2 Code Specification

```bash
#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Frostfire MicroVM WebAuthn Native Messaging Host Shim
# Locates the Node.js runtime and executes webauthn-proxy-host.mjs
# ==============================================================================

# 1. Resolve Node.js runtime binary
# Precedence: FROSTFIRE_WEBAUTHN_PROXY_NODE -> SAND_WEBAUTHN_PROXY_NODE -> PATH -> well-known locations
node_bin="${FROSTFIRE_WEBAUTHN_PROXY_NODE:-${SAND_WEBAUTHN_PROXY_NODE:-}}"

if [ -n "${node_bin}" ] && [ ! -x "${node_bin}" ]; then
	node_bin=""
fi

if [ -z "${node_bin}" ]; then
	node_bin="$(command -v node || true)"
fi

if [ -z "${node_bin}" ] || [ ! -x "${node_bin}" ]; then
	for candidate in /usr/bin/node /usr/local/bin/node /exec-daemon/node; do
		if [ -x "${candidate}" ]; then
			node_bin="${candidate}"
			break
		fi
	done
fi

if [ -z "${node_bin}" ] || [ ! -x "${node_bin}" ]; then
	echo "frostfire-webauthn-proxy-host: no node runtime found in PATH or standard paths" >&2
	exit 1
fi

# 2. Resolve target JavaScript host script
# Precedence: FROSTFIRE_WEBAUTHN_HOST_SCRIPT -> /usr/local/bin/webauthn-proxy-host.mjs -> script directory
host_script="${FROSTFIRE_WEBAUTHN_HOST_SCRIPT:-/usr/local/bin/webauthn-proxy-host.mjs}"
if [ ! -f "${host_script}" ]; then
	script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	if [ -f "${script_dir}/webauthn-proxy-host.mjs" ]; then
		host_script="${script_dir}/webauthn-proxy-host.mjs"
	fi
fi

if [ ! -f "${host_script}" ]; then
	echo "frostfire-webauthn-proxy-host: host script not found at ${host_script}" >&2
	exit 1
fi

# 3. Execute with clean process replacement
exec "${node_bin}" "${host_script}" "$@"
```

### 3.3 Execution Attributes
- **Permissions**: `chmod 0755` (`-rwxr-xr-x`).
- **Standard Location in Guest**: `/usr/local/bin/frostfire-webauthn-proxy-host`.
- **Exit Codes**:
  - `0`: Normal host execution and completion.
  - `1`: Node runtime or host script missing.

---

## 4. Node.js Native Messaging Host Specification: `cloud/microvm/bin/webauthn-proxy-host.mjs`

### 4.1 Component Design

The host module executes the following lifecycle on each invocation:
1. **`readMessage()`**: Asynchronously reads binary chunks from `process.stdin`, verifies size boundaries ($< 64\text{ MB}$), validates the 4-byte LE length header, buffers until the complete message arrives, and parses the UTF-8 JSON body.
2. **`credentialFile()` & `readEnv()`**: Hierarchically discovers the in-box gateway token and port from environment variables and filesystem runtime directories.
3. **`requestCeremony()`**: Performs an HTTP `POST` to `http://127.0.0.1:${port}/api/requestWebAuthnCeremony` with `Authorization: Bearer ${token}` and a timeout signal.
4. **`writeMessage()`**: Formats the JSON response with a 4-byte LE length prefix and writes it to `process.stdout`.
5. **`main()`**: Coordinates execution, maps errors to standard W3C WebAuthn error types (`NotAllowedError`, `DataError`), outputs the formatted response, and cleanly exits.

### 4.2 Code Specification

```javascript
// ==============================================================================
// Frostfire Cloud MicroVM WebAuthn Native Messaging Host
//
// Bridges Chrome's webAuthenticationProxy extension with the microVM in-box
// gateway on port 1340 via stdio binary framing and HTTP REST dispatch.
// ==============================================================================

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

const HEADER_BYTES = 4;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024; // 64 MB maximum message limit
const DEFAULT_GATEWAY_PORT = "1340";
const DEFAULT_CEREMONY_TIMEOUT_MS = 120000; // 2 minute timeout for human interaction

/**
 * Read environment variable with fallback.
 *
 * @param {string} name
 * @param {string|undefined} fallback
 * @returns {string|undefined}
 */
function readEnv(name, fallback) {
	const value = process.env[name];
	return value === undefined || value === "" ? fallback : value;
}

/**
 * Discover in-box gateway credentials from filesystem or runtime environment.
 * Searches candidate XDG directories for gateway credential files.
 *
 * @returns {{ token: string, port?: string } | undefined}
 */
function credentialFile() {
	const candidateDirs = [
		readEnv("FROSTFIRE_PRIMARY_XDG_RUNTIME_DIR", undefined),
		readEnv("SAND_PRIMARY_XDG_RUNTIME_DIR", undefined),
		readEnv("XDG_RUNTIME_DIR", undefined),
		"/tmp/xdg-runtime-box",
		"/tmp/frostfire-runtime",
		"/tmp/sand-window-tokens.d",
	].filter((dir) => dir !== undefined && dir !== "");

	const candidateFilenames = [
		"frostfire-gateway-credential",
		"sand-gateway-credential",
		"gateway-credential",
	];

	for (const runtimeDir of candidateDirs) {
		for (const filename of candidateFilenames) {
			const credentialPath = `${runtimeDir}/${filename}`;
			try {
				const content = readFileSync(credentialPath, "utf8");
				const lines = content.split(/\r?\n/).map((line) => line.trim());
				const token = lines[0];
				const port = lines[1] && lines[1] !== "" ? lines[1] : undefined;
				if (token !== undefined && token !== "") {
					return { token, port };
				}
			} catch {
				// Continue search if file does not exist or is unreadable
			}
		}
	}
	return undefined;
}

/**
 * Resolve the base URL for the in-box gateway HTTP service.
 *
 * @param {{ port?: string } | undefined} credential
 * @returns {string}
 */
function gatewayBaseUrl(credential) {
	const port =
		readEnv("FROSTFIRE_HOST_PORT", undefined) ??
		readEnv("SAND_HOST_PORT", undefined) ??
		credential?.port ??
		DEFAULT_GATEWAY_PORT;
	return `http://127.0.0.1:${port}`;
}

/**
 * Write a framed message to Chrome on process.stdout.
 * Format: [4-byte unsigned int LE length][UTF-8 JSON string]
 *
 * @param {object} payload
 */
function writeMessage(payload) {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	const header = Buffer.alloc(HEADER_BYTES);
	header.writeUInt32LE(body.length, 0);
	process.stdout.write(Buffer.concat([header, body]));
}

/**
 * Construct standard error payload matching W3C WebAuthn proxy expectations.
 *
 * @param {string} name - e.g. 'NotAllowedError', 'DataError'
 * @param {string} message - Descriptive error message
 * @returns {{ ok: false, error: { name: string, message: string } }}
 */
function failure(name, message) {
	return { ok: false, error: { name, message } };
}

/**
 * Read and decode a single native messaging frame from process.stdin.
 *
 * @returns {Promise<object | undefined>} Resolves to parsed JSON or undefined on EOF
 */
async function readMessage() {
	const chunks = [];
	let total = 0;

	for await (const chunk of process.stdin) {
		chunks.push(chunk);
		total += chunk.length;

		if (total > MAX_MESSAGE_BYTES) {
			throw new Error("native message exceeded the maximum size (64MB)");
		}

		const buffered = Buffer.concat(chunks, total);
		if (buffered.length < HEADER_BYTES) {
			continue;
		}

		const length = buffered.readUInt32LE(0);
		if (length > MAX_MESSAGE_BYTES) {
			throw new Error(
				`native message specified length (${length} bytes) exceeds maximum size (64MB)`
			);
		}

		if (buffered.length >= HEADER_BYTES + length) {
			const bodyBuffer = buffered.subarray(HEADER_BYTES, HEADER_BYTES + length);
			return JSON.parse(bodyBuffer.toString("utf8"));
		}
	}

	return undefined;
}

/**
 * Dispatch ceremony parameters to in-box host gateway on port 1340.
 *
 * @param {object} message
 * @returns {Promise<object>}
 */
async function requestCeremony(message) {
	const credential = credentialFile();
	const token =
		readEnv("FROSTFIRE_GATEWAY_TOKEN", undefined) ??
		readEnv("SAND_GATEWAY_TOKEN", undefined) ??
		credential?.token;

	if (token === undefined) {
		return failure(
			"NotAllowedError",
			"Frostfire in-box gateway token is not available to the browser bridge."
		);
	}

	const timeoutMs = Number(
		readEnv("FROSTFIRE_WEBAUTHN_TIMEOUT_MS", String(DEFAULT_CEREMONY_TIMEOUT_MS))
	);
	const targetUrl = `${gatewayBaseUrl(credential)}/api/requestWebAuthnCeremony`;

	let response;
	try {
		response = await fetch(targetUrl, {
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
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (networkError) {
		if (networkError?.name === "TimeoutError") {
			return failure(
				"NotAllowedError",
				`Frostfire in-box gateway timed out waiting for ceremony completion (${timeoutMs}ms).`
			);
		}
		return failure(
			"NotAllowedError",
			`Could not reach Frostfire in-box host: ${networkError?.message ?? networkError}`
		);
	}

	if (!response.ok) {
		let errorDetail = `HTTP ${response.status}`;
		try {
			const errJson = await response.json();
			if (errJson?.error?.message) {
				errorDetail = errJson.error.message;
			}
		} catch {
			try {
				const errText = await response.text();
				if (errText) errorDetail = errText.slice(0, 200);
			} catch {}
		}
		return failure(
			"NotAllowedError",
			`Frostfire in-box host refused the ceremony (${errorDetail}).`
		);
	}

	try {
		return await response.json();
	} catch (jsonErr) {
		return failure(
			"DataError",
			`Malformed JSON response from Frostfire in-box host: ${jsonErr?.message ?? jsonErr}`
		);
	}
}

/**
 * Main host entry point.
 */
async function main() {
	let message;
	try {
		message = await readMessage();
	} catch (error) {
		writeMessage(failure("DataError", `unreadable native message: ${error.message}`));
		return;
	}

	if (message === undefined) {
		writeMessage(failure("DataError", "no native message was received (stdin closed)"));
		return;
	}

	try {
		const result = await requestCeremony(message);
		writeMessage(result);
	} catch (error) {
		writeMessage(
			failure(
				"NotAllowedError",
				`unexpected host failure during ceremony dispatch: ${error?.message ?? error}`
			)
		);
	}
}

await main();
```

---

## 5. Detailed Edge Case Analysis & Failure Modes

| Edge Case / Condition | Trigger Scenario | Host Mechanism & Response | W3C WebAuthn Mapping |
|---|---|---|---|
| **1. Oversized Message Body** | Input stream exceeds `MAX_MESSAGE_BYTES` (64 MB). | `total > MAX_MESSAGE_BYTES` check throws exception in `readMessage()`. | Caught in `main()`, writes `{ ok: false, error: { name: "DataError", message: "unreadable native message: native message exceeded the maximum size (64MB)" } }`. |
| **2. Adversarial / Corrupted Header Length** | 4-byte header declares length $> 64\text{ MB}$ (e.g. `0xFFFFFFFF`). | Early check `length > MAX_MESSAGE_BYTES` throws before allocating or waiting for additional buffer chunks. | Caught in `main()`, writes `{ ok: false, error: { name: "DataError", message: "... exceeds maximum size ..." } }`. |
| **3. Stream Fragmentation Across Chunks** | Chrome delivers 4-byte header in split 1-byte chunks, or JSON body in multiple packets. | Loops through `process.stdin` iterator, concatenates buffers, and pauses until `buffered.length >= 4 + length`. | Reassembles complete frame transparently. |
| **4. Premature Stdin EOF** | Chrome terminates connection before sending full message (e.g. tab closed). | `for await` completes; `readMessage()` returns `undefined`. | Writes `{ ok: false, error: { name: "DataError", message: "no native message was received (stdin closed)" } }`. |
| **5. Malformed JSON on Stdin** | Input bytes are not valid UTF-8 JSON. | `JSON.parse` throws `SyntaxError`. | Caught in `readMessage()`, translated to `DataError` response frame. |
| **6. Missing Gateway Credentials** | No credential files found and neither `FROSTFIRE_GATEWAY_TOKEN` nor `SAND_GATEWAY_TOKEN` is set. | `credentialFile()` returns `undefined`; token check fails. | Writes `{ ok: false, error: { name: "NotAllowedError", message: "Frostfire in-box gateway token is not available to the browser bridge." } }`. |
| **7. Gateway Port 1340 Down / Refused** | In-box daemon is not running (`ECONNREFUSED`). | `fetch()` throws network error. | Caught and returned as `{ ok: false, error: { name: "NotAllowedError", message: "Could not reach Frostfire in-box host: ..." } }`. |
| **8. In-Box Gateway Authentication Failure** | Gateway returns HTTP 401 Unauthorized or 403 Forbidden (mismatched token). | `response.ok === false`. | Reads error details from gateway body, returns `NotAllowedError`. |
| **9. Human Verification Timeout** | User ignores or dismisses local Windows Hello / Touch ID / YubiKey prompt. | `AbortSignal.timeout(120000)` triggers after 2 minutes. | `fetch()` throws `TimeoutError`, host returns `{ ok: false, error: { name: "NotAllowedError", message: "... timed out waiting for ceremony completion ..." } }`. |
| **10. Local Device Rejection / Cancellation** | User clicks "Cancel" on hardware authenticator prompt. | In-box gateway returns `{ ok: false, error: { name: "NotAllowedError", message: "User canceled ceremony" } }`. | Host passes gateway JSON directly through to Chrome, allowing MV3 extension to resolve tab promise rejection. |
| **11. Clean Exit Codes** | Process finishes writing response frame. | Host process finishes and exits with code `0`. | **Critical**: Chrome Native Messaging marks exit code 1 as a process crash ("Native host has exited"). By returning error objects in the framed message and exiting with `0`, Chrome delivers the structured error to the extension cleanly. |

---

## 6. Verification and Test Strategy

### 6.1 Unit Verification of Stdio Framing

The stdio framing logic can be independently tested using a standalone Node.js or Bash script that executes `frostfire-webauthn-proxy-host` and pipes framed binary payloads into `stdin`:

```javascript
// Verification harness: test_framing.mjs
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

const host = spawn("./cloud/microvm/bin/frostfire-webauthn-proxy-host", [], {
  env: {
    ...process.env,
    FROSTFIRE_GATEWAY_TOKEN: "mock-token-xyz",
    FROSTFIRE_HOST_PORT: "1340",
  },
});

const payload = {
  kind: "get",
  origin: "https://auth.example.com",
  optionsJson: JSON.stringify({ challenge: "test-challenge", rpId: "example.com" }),
};

const body = Buffer.from(JSON.stringify(payload), "utf8");
const header = Buffer.alloc(4);
header.writeUInt32LE(body.length, 0);

host.stdout.on("data", (chunk) => {
  const respLen = chunk.readUInt32LE(0);
  const respJson = JSON.parse(chunk.subarray(4, 4 + respLen).toString("utf8"));
  console.log("Verified Host Response:", respJson);
});

host.stdin.write(Buffer.concat([header, body]));
host.stdin.end();
```

### 6.2 Dockerfile & Rootfs Deployment Wiring

When building `cloud/microvm/Dockerfile.rootfs`:
```dockerfile
# Copy native messaging scripts and set execution bits
COPY bin/frostfire-webauthn-proxy-host /usr/local/bin/frostfire-webauthn-proxy-host
COPY bin/webauthn-proxy-host.mjs /usr/local/bin/webauthn-proxy-host.mjs
RUN chmod +x /usr/local/bin/frostfire-webauthn-proxy-host \
             /usr/local/bin/webauthn-proxy-host.mjs

# Ensure backward-compatible symlinks for GrokBot/Sand tooling
RUN ln -sf /usr/local/bin/frostfire-webauthn-proxy-host /usr/local/bin/sand-webauthn-proxy-host
```

### 6.3 Chrome Native Messaging Host Registration

The Chrome native messaging manifest registered at `/etc/opt/chrome/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json` must specify:
```json
{
  "name": "io.frostfire.agent.webauthn_proxy",
  "description": "Frostfire MicroVM WebAuthn Native Messaging Host",
  "path": "/usr/local/bin/frostfire-webauthn-proxy-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://pkjakndclmokfbgfnpgjieoebnbghhgb/"
  ]
}
```

---

## 7. Synthesis & Recommendations for Downstream Agents

1. **For Worker M5 / Implementation Agent**:
   - Create `cloud/microvm/bin/frostfire-webauthn-proxy-host` with verbatim script from Section 3.2.
   - Create `cloud/microvm/bin/webauthn-proxy-host.mjs` with verbatim script from Section 4.2.
   - Ensure `chmod +x` is set on both files.
2. **For Explorer M5.1 / Policy Agent**:
   - Align the native host name (`io.frostfire.agent.webauthn_proxy`) in `manifest.json`, `background.js`, and `io.frostfire.agent.webauthn_proxy.json`.
   - Point `path` to `/usr/local/bin/frostfire-webauthn-proxy-host`.
3. **For Explorer M5.3 / In-Box Gateway Agent**:
   - Implement the HTTP listener on port `1340` (`POST /api/requestWebAuthnCeremony`).
   - Validate Bearer token using constant-time equality (`timingSafeEqual`).
   - Expect payload `{ kind, origin, optionsJson }` and return `{ ok: true, credentialJson: ... }` on success or `{ ok: false, error: { name, message } }` on failure.
