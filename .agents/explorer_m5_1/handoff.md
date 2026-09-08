# Handoff Report: Explorer M5.1 — WebAuthn MV3 Extension & Policy Manifests

**Agent**: `explorer_m5_1`  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_1`  
**Handoff Type**: Hard (Task Complete)  
**Target Recipient**: Orchestrator / Developer Agent  

---

## 1. Observation

1. **GrokBot / Syntropy MV3 WebAuthn Proxy Reference**:
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\webauthn-proxy\manifest.json`:
     Lines 1-14 specify MV3 manifest with `service_worker: "background.js"` and permissions `["webAuthenticationProxy", "nativeMessaging", "tabs"]`.
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\webauthn-proxy\background.js`:
     Line 1: `const NATIVE_HOST = "io.syntropy.agent.webauthn_proxy";`
     Lines 8-18: Listeners on `onRemoteSessionStateChange`, `onStartup`, and `onInstalled` triggering `attach()`.
     Lines 20-26: `onIsUvpaaRequest` completes with `isUvpaa: false`.
     Lines 28-34: `onCreateRequest` and `onGetRequest` dispatched to `handleRequest`.
     Lines 36-40: `onRequestCanceled` evicts request from `inFlight` Set.
     Lines 55-70: `resolveCaller` prioritizes `remoteDesktopClientOverride` over tab URL.
     Lines 72-112: `handleRequest` calls `chrome.runtime.sendNativeMessage` and completes ceremony with `completeCreateRequest` or `completeGetRequest`.

2. **GrokBot / Syntropy Enterprise Policies & Native Host**:
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\etc-policies\native-messaging-hosts\co.anysphere.sand.webauthn_proxy.json`:
     Line 2: `"name": "co.anysphere.sand.webauthn_proxy"`
     Line 4: `"path": "/usr/local/bin/sand-webauthn-proxy-host"`
     Line 7: `"allowed_origins": [ "chrome-extension://pkjakndclmokfbgfnpgjieoebnbghhgb/" ]`
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\etc-policies\policies\managed\sand-webauthn.json`:
     Line 2: `"ExtensionSettings": { "pkjakndclmokfbgfnpgjieoebnbghhgb": { "installation_mode": "force_installed", "update_url": "https://clients2.google.com/service/update2/crx" } }`
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\sand-webauthn-proxy-host`:
     Lines 6-15: Bash shim locating `node` and executing `/usr/local/bin/webauthn-proxy-host.mjs "$@"`.
   - `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\webauthn-proxy-host.mjs`:
     Lines 8-10: 4-byte LE length header, 64 MB message cap, and port `1340` default.
     Lines 17-37: `credentialFile` reads `$XDG_RUNTIME_DIR/sand-gateway-credential` or `/tmp/xdg-runtime-box/sand-gateway-credential`.
     Lines 78-110: `requestCeremony` posts JSON payload to `http://127.0.0.1:${port}/api/requestWebAuthnCeremony` with `Bearer ${token}`.

3. **Current Frostfire MicroVM Rootfs**:
   - `c:\Users\tyson\.repo\personal\frostfire-cloud\cloud\microvm\Dockerfile.rootfs`:
     Line 25: Installs `chromium-browser`.
     Line 54: Creates `/etc/opt/chrome/policies/managed` directory, but lacks native messaging directories and Chromium policy directories.
     Lines 64-82: Copies scripts, but does not copy WebAuthn extension, policies, manifests, or proxy host scripts.
     Line 113: `EXPOSE 1337 1338 1339 5901 5902 5903 6080 6081 8790 8791 9223 9224 9225` does not expose port `1340`.

4. **Frostfire Protobuf & Reverse Tunnel Schema**:
   - `crates/frostfire-proto/proto/tunnel.proto`:
     Lines 177-183: `WebAuthnCeremonyRequest` message (`ceremony_id`, `kind`, `origin`, `options_json`).
     Lines 185-192: `WebAuthnCeremonyResponse` message (`ceremony_id`, `success`, `credential_json`, `error_name`, `error_message`).
     Payload fields 22 and 23 in `TunnelServerFrame` and `TunnelClientFrame`.

5. **Frostfire Zero Credential Leakage Invariant**:
   - `crates/frostfire-security/src/broker.rs:333-375`:
     `sign_webauthn_ceremony()` signs assertions locally on client workstation.
   - `c:\Users\tyson\.repo\personal\frostfire\tests\e2e\harness\crypto_bridge.py:139-151`:
     `verify_zero_credential_leakage` validates responses never contain private key markers (`BEGIN PRIVATE KEY`, `d:`, etc.).

---

## 2. Logic Chain

1. **Step 1 (Extension Interception)**:
   From Observation 1 and 4, Chrome's `webAuthenticationProxy` API requires MV3 service worker architecture with permissions `webAuthenticationProxy`, `nativeMessaging`, and `tabs`. The extension must hook `onCreateRequest` and `onGetRequest` and resolve the relying party origin using W3C `remoteDesktopClientOverride` or active tab query, falling back to `https://${rpId}`.

2. **Step 2 (Platform Authenticator Absence)**:
   From Observation 1 (`background.js:20-26`), headless microVM guests lack platform biometric authenticators. Responding `isUvpaa: false` ensures relying party web applications allow roaming FIDO2 authenticators (security keys / passkeys) rather than failing immediately.

3. **Step 3 (Native Messaging Bridge & Protocol)**:
   From Observation 1 (`background.js:1`) and Observation 2 (`sand-webauthn-proxy-host`), the extension dispatches requests to `io.frostfire.agent.webauthn_proxy`. The native host must speak Chrome's 4-byte LE uint32 length-prefixed stdio protocol, extract credentials from `$XDG_RUNTIME_DIR/frostfire-gateway-credential` or `/tmp/xdg-runtime-box/frostfire-gateway-credential`, and POST to `http://127.0.0.1:1340/api/requestWebAuthnCeremony`.

4. **Step 4 (Enterprise Force Installation & Browser Dual Compatibility)**:
   From Observation 2 (`sand-webauthn.json`) and Observation 3 (`Dockerfile.rootfs:25`), Ubuntu 24.04 packages `chromium-browser`. Google Chrome inspects `/etc/opt/chrome/`, whereas Chromium inspects `/etc/chromium/`. To guarantee seamless execution across both browsers, both `/etc/opt/chrome/` and `/etc/chromium/` must contain the managed policy (`frostfire-webauthn.json`) and the native messaging manifest (`io.frostfire.agent.webauthn_proxy.json`).

5. **Step 5 (Container Image Layering & Port Exposure)**:
   From Observation 2 and Observation 3, `Dockerfile.rootfs` must create `/cloud/microvm/webauthn-proxy`, copy the extension files, install the enterprise policies and native host manifests, install the executable wrappers in `/usr/local/bin/`, set `box:box` ownership and `chmod +x` permissions, and expose port `1340`.

---

## 3. Caveats

1. **Extension ID in Local Unpacked Mode**:
   Chrome enterprise policy forces extension ID `pkjakndclmokfbgfnpgjieoebnbghhgb`. If a developer manually tests unpacked extensions via `--load-extension`, Chrome derives an ID from the path unless a fixed `"key"` is provided in `manifest.json`. For local development, the developer must either match the path or register the unpacked ID in `allowed_origins`.
2. **In-Box Port 1340 Server**:
   This milestone specifies the extension, policies, manifests, and rootfs image integration. The in-box HTTP listener on port 1340 is implemented in the microVM daemon/bridge (Feature F20).
3. **Chromium Snap vs Deb**:
   In standard Ubuntu 24.04 Docker containers, `chromium-browser` is installed without snap. Should snap ever be introduced, policy paths would relocate to `/var/snap/chromium/current/policies/`. The current Dockerfile installs direct apt packages, so `/etc/chromium/` remains authoritative.

---

## 4. Conclusion

The specifications for MV3 extension files (`manifest.json`, `background.js`), enterprise policies (`frostfire-webauthn.json`), native messaging host manifests (`io.frostfire.agent.webauthn_proxy.json`), wrapper scripts (`frostfire-webauthn-proxy-host`, `webauthn-proxy-host.mjs`), and `Dockerfile.rootfs` integration are complete, verified against GrokBot/Syntropy source code, and documented with exact byte-for-byte target contents in `report.md`.

---

## 5. Verification Method

To independently verify the implementation:

1. **JSON Syntax Verification**:
   ```bash
   node -e 'JSON.parse(fs.readFileSync("cloud/microvm/webauthn-proxy/manifest.json"))'
   node -e 'JSON.parse(fs.readFileSync("cloud/microvm/etc-policies/policies/managed/frostfire-webauthn.json"))'
   node -e 'JSON.parse(fs.readFileSync("cloud/microvm/etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json"))'
   ```

2. **JavaScript Syntax Verification**:
   ```bash
   node -c cloud/microvm/webauthn-proxy/background.js
   node -c cloud/microvm/bin/webauthn-proxy-host.mjs
   ```

3. **Workspace Test Suite Verification**:
   ```bash
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```

4. **Invalidation Conditions**:
   - Renaming native host without updating `background.js:1` or `io.frostfire.agent.webauthn_proxy.json:2`.
   - Modifying `allowed_origins` such that it fails to match the enterprise policy extension ID.
   - Omitting port `1340` from `Dockerfile.rootfs` `EXPOSE`.
