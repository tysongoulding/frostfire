# Dispatch: Worker M5.1 — Inverted WebAuthn Proxy Bridge Implementation

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m5_1`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Read Explorer Reports:
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_1\report.md`
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_2\report.md`
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_3\report.md`
- Inspect GrokBot Reference: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\webauthn-proxy/` and `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin/`

## Exclusive Write Ownership
You exclusively own and may create/modify:
- `cloud/microvm/webauthn-proxy/manifest.json`
- `cloud/microvm/webauthn-proxy/background.js`
- `cloud/microvm/etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json`
- `cloud/microvm/etc-policies/policies/managed/frostfire-webauthn.json`
- `cloud/microvm/bin/frostfire-webauthn-proxy-host`
- `cloud/microvm/bin/webauthn-proxy-host.mjs`
- `cloud/microvm/bin/sand-webauthn-bridge.mjs`
- `cloud/microvm/Dockerfile.rootfs`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Objective & Implementation Requirements
1. Implement the MV3 Chrome extension in `cloud/microvm/webauthn-proxy/`:
   - `manifest.json`: permissions `["webAuthenticationProxy", "nativeMessaging", "tabs"]`, background service worker `background.js`.
   - `background.js`: attach to browser session, handle `onCreateRequest` and `onGetRequest`, respond `isUvpaa: false` on `onIsUvpaaRequest` to force roaming authenticator, resolve origin (supporting W3C `remoteDesktopClientOverride`), track in-flight cancellations with a Set, send native messages to `io.frostfire.agent.webauthn_proxy`, complete browser ceremonies via `completeGetRequest`/`completeCreateRequest`.
2. Implement native host manifest and managed policy:
   - `cloud/microvm/etc-policies/native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json`
   - `cloud/microvm/etc-policies/policies/managed/frostfire-webauthn.json`
3. Implement native messaging host in `cloud/microvm/bin/`:
   - `frostfire-webauthn-proxy-host`: bash launcher locating node and execing `webauthn-proxy-host.mjs`.
   - `webauthn-proxy-host.mjs`: Node.js native host implementing 4-byte LE length-prefixed framing over stdin/stdout, 64MB protection, credential discovery from `/tmp/xdg-runtime-box/sand-gateway-credential` or environment, HTTP POST to `http://127.0.0.1:1340/api/requestWebAuthnCeremony`.
4. Implement the in-box port 1340 HTTP bridge:
   - `cloud/microvm/bin/sand-webauthn-bridge.mjs`: HTTP listener on port 1340, constant-time bearer token check, mock/forwarding ceremony handling, Zero Credential Leakage validation.
5. Update `cloud/microvm/Dockerfile.rootfs`:
   - Setup `/etc/opt/chrome/` and `/etc/chromium/` policy and native-messaging-hosts directories.
   - Copy extension files, manifests, and scripts (`chmod +x`).
   - Expose port 1340.
6. Verify your implementation:
   - Run `cargo test --workspace`
   - Run `cargo clippy --workspace -- -D warnings`
   - Test Node.js scripts for syntax (`node --check`).
7. Write your handoff report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m5_1\handoff.md` and send a completion message with verification results.

## 2026-09-08T22:52:50Z
You are worker_m5_1.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m5_1.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m5_1\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and the explorer reports in .agents/explorer_m5_1/, .agents/explorer_m5_2/, .agents/explorer_m5_3/.
Implement the Inverted WebAuthn Proxy Bridge files per your exclusive write ownership.
Verify with cargo test, cargo clippy, and node --check.
Write handoff.md in your working directory and notify your parent with send_message.
