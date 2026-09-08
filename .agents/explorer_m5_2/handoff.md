# Handoff Report: WebAuthn Native Messaging Host & Stdio Framing (M5.2)

**Agent ID**: `explorer_m5_2`  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_2`  
**Recipient**: `parent` (`99761dd8-6bab-46d3-ac62-cbe7af651c53`)  
**Type**: Hard Handoff (Task Complete)  

---

## 1. Observation

1. **GrokBot Reference Implementation**:
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\sand-webauthn-proxy-host` (lines 1-16):
     ```bash
     #!/usr/bin/env bash
     set -euo pipefail
     node_bin="${SAND_WEBAUTHN_PROXY_NODE:-node}"
     if [ ! -x "${node_bin}" ]; then
         node_bin="$(command -v node || true)"
     fi
     if [ -z "${node_bin}" ] || [ ! -x "${node_bin}" ]; then
         echo "sand-webauthn-proxy-host: no node runtime found" >&2
         exit 1
     fi
     exec "${node_bin}" /usr/local/bin/webauthn-proxy-host.mjs "$@"
     ```
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\webauthn-proxy-host.mjs` (lines 8-10, 44-76, 78-110):
     - `HEADER_BYTES = 4; MAX_MESSAGE_BYTES = 64 * 1024 * 1024; SAND_BOX_PORT_HOST_GATEWAY = "1340";`
     - Stdio framing reads 4-byte LE length prefix via `buffered.readUInt32LE(0)`.
     - Credentials discovered from `$SAND_PRIMARY_XDG_RUNTIME_DIR` (`/tmp/xdg-runtime-box/sand-gateway-credential`) or `$SAND_GATEWAY_TOKEN`.
     - Dispatches HTTP POST to `http://127.0.0.1:1340/api/requestWebAuthnCeremony` with `Authorization: Bearer ${token}`.
     - Payload format: `{ kind: message.kind, origin: message.origin, optionsJson: message.optionsJson }`.
     - Response formatting writes `[4-byte LE length][UTF-8 JSON]` to `process.stdout`.
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\box-contract.generated.mjs` (line 9):
     `export const SAND_BOX_PORTS = { ... "hostGateway":1340 ... };`
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\webauthn-proxy\background.js` (lines 91-112):
     Extension calls `chrome.runtime.sendNativeMessage(NATIVE_HOST, { kind, origin, optionsJson: requestDetailsJson })` and handles `{ ok: true, credentialJson }` or `{ ok: false, error: { name, message } }`.

2. **Frostfire Cloud Infrastructure**:
   - `crates/frostfire-proto/proto/tunnel.proto` (lines 177-192):
     Defines `WebAuthnCeremonyRequest` (`ceremony_id`, `kind`, `origin`, `options_json`) and `WebAuthnCeremonyResponse` (`ceremony_id`, `success`, `credential_json`, `error_name`, `error_message`) mapped to fields 22 and 23 of `TunnelServerFrame` and `TunnelClientFrame`.
   - `crates/frostfire-daemon/src/orchestrator.rs` (lines 442-504):
     Processes `WebAuthnCeremonyRequest`, records audit event to `MerkleAuditLedger`, calls `broker.sign_webauthn_ceremony()`, and returns `WebAuthnCeremonyResponse`.
   - `crates/frostfire-security/src/broker.rs` (lines 335-375):
     Constructs standard W3C credential JSON structure with clientDataJSON, authenticatorData, and signature with zero private key transmission.
   - `cloud/microvm/Dockerfile.rootfs` (lines 25-30, 64-82, 113):
     Node.js and Chromium are installed, but `cloud/microvm/bin/` does not yet exist in the repository tree. Port 1340 is not yet exposed.

---

## 2. Logic Chain

1. **Protocol Compliance**:
   Chromium's Native Messaging API enforces strict stdio framing: every message sent and received must be prefixed with a 32-bit (4-byte) Little-Endian unsigned integer declaring the payload's byte length. Node's `Buffer.alloc(4).writeUInt32LE(len, 0)` and `buffered.readUInt32LE(0)` satisfy this contract exactly (Observation 1).
2. **Buffer Safety & Memory Protection**:
   Incoming stdio streams can be delivered in arbitrarily fragmented chunks. By appending chunks into a collection, checking total bytes against `MAX_MESSAGE_BYTES = 64 * 1024 * 1024`, inspecting the 4-byte header as soon as 4 bytes arrive, and validating that the declared length does not exceed 64 MB, the parser defends against memory exhaustion and buffer overrun attacks before reading multi-megabyte payloads (Observation 1).
3. **Execution Shim Requirement**:
   Chrome requires the native host registered in its manifest to be an executable binary (`chmod +x`). Running a `.mjs` directly can fail if Node is located in non-standard paths (`/usr/bin/node`, `/usr/local/bin/node`, `/exec-daemon/node`). The bash wrapper `frostfire-webauthn-proxy-host` inspects `$FROSTFIRE_WEBAUTHN_PROXY_NODE`, `$SAND_WEBAUTHN_PROXY_NODE`, `command -v node`, and standard paths, and uses `exec` to hand control directly to Node without leaving an idle shell wrapper (Observation 1, 2).
4. **Credential Discovery & Port Fallback**:
   The in-box microVM gateway token and port must be discoverable dynamically without hardcoded secrets. Searching candidate directories (`$FROSTFIRE_PRIMARY_XDG_RUNTIME_DIR`, `$XDG_RUNTIME_DIR`, `/tmp/xdg-runtime-box`, `/tmp/frostfire-runtime`, `/tmp/sand-window-tokens.d`) for `frostfire-gateway-credential` or `sand-gateway-credential` (line 1 = token, line 2 = port) with fallback to `$FROSTFIRE_GATEWAY_TOKEN` and port 1340 provides zero-config operation and backward compatibility with GrokBot (Observation 1).
5. **Error Propagation vs. Process Termination**:
   If a ceremony fails (e.g. host unreachable, user cancels, or missing token), exiting with code 1 causes Chrome to log a native messaging process crash ("Native host has exited"). Instead, returning a framed JSON response `{ ok: false, error: { name: "NotAllowedError", message: ... } }` and exiting with code 0 allows the MV3 extension to resolve or reject the DOM Promise cleanly per the W3C WebAuthn specification (Observation 1).

---

## 3. Caveats

- **Network Isolation**: The native messaging host connects to `http://127.0.0.1:1340`. In containerized Lambda or microVM instances, port 1340 must be bound to localhost inside the same network namespace as Chromium.
- **Port 1340 Implementation**: The native host relies on an in-box HTTP service listening on port 1340 (assigned to Explorer M5.3 / Milestone M5.3). If port 1340 is not running, the host gracefully reports `NotAllowedError` with connection refused.
- **Zero Raw Secrets**: Neither the bash wrapper nor the Node.js script ever caches or writes credentials or passkeys to disk; only transient in-memory Bearer token reading is performed.

---

## 4. Conclusion

The specification for `cloud/microvm/bin/frostfire-webauthn-proxy-host` and `cloud/microvm/bin/webauthn-proxy-host.mjs` is complete, hardened, and ready for implementation.
Key deliveries in `report.md`:
1. Verbatim production-ready bash wrapper (`frostfire-webauthn-proxy-host`) with multi-path Node discovery, script path resolution, and `exec` process replacement.
2. Verbatim production-ready Node.js module (`webauthn-proxy-host.mjs`) featuring 4-byte LE stdio framing, chunk fragmentation reassembly, dual-stage 64MB circuit breaker, robust credential/port discovery, timeout-guarded HTTP POST to port 1340, and clean exit behavior.
3. Detailed analysis of all 11 failure modes, mapping network, protocol, and token errors to W3C WebAuthn standard error types.

---

## 5. Verification Method

To independently verify the implementation:
1. **File Inspection**:
   Inspect `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_2\report.md` for complete verbatim script sources.
2. **Framing & Pipeline Verification**:
   Execute the standalone Node.js framing test harness defined in `report.md` Section 6.1:
   ```bash
   node test_framing.mjs
   ```
   Assert that a 4-byte LE length header followed by valid JSON is output on stdout.
3. **Workspace Gate Check**:
   Run workspace verification gates to ensure no regressions in existing codebase:
   ```pwsh
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
