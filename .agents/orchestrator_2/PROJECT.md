# Project: Frostfire Cloud — GrokBot Architecture Port & Parity (Phase 2)

## Architecture
Frostfire Cloud phase 2 operationalizes the core architectural blueprints reverse-engineered from GrokBot / Cursor Sand:
1. **Inverted WebAuthn Proxy Bridge (R1)**:
   - Headless Chrome MV3 extension (`webAuthenticationProxy`) running inside microVM guests.
   - Native messaging host (`frostfire-webauthn-proxy-host`) routing ceremony requests to an in-VM bridge (`http://127.0.0.1:1340`).
   - Reverse-tunnel gRPC ceremony frame routing (`WebAuthnCeremonyRequest` and `WebAuthnCeremonyResponse` over `AgentTunnelService.OpenTunnel`) enabling hardware tokens on local client machines (Windows Hello, Touch ID, YubiKey) to satisfy cloud ceremonies with zero cloud credential storage.
2. **Ephemeral Lambda MicroVM State Persistence & Worktrees (R2)**:
   - Amazon EFS `/mnt/workspace` integration via EFS Access Points with POSIX UID/GID 10001 mapping in `deploy/aws/lambda-microvm.yaml`.
   - Automated zero-disruption shadow worktree snapshotting and restoration in `scripts/sync-workspace-state.sh` (`git write-tree` / `git commit-tree` into `refs/frostfire/shadow/*`).
   - Ephemeral microVM credential persistence (`persist-cli-auth`) preserving developer tool authorizations across container recycling.
3. **Multi-Screen Display Multiplexer & Crash-Loop Defenses (R3)**:
   - Porting GrokBot's production crash defense daemons into `cloud/microvm/bin/`: `box-xvfb`, `box-xfwm4`, `box-picom`, `box-plank`, `box-x11vnc`, `box-bounded-log.mjs`, `box-bounded-log`, and `box-doctor`.
   - Reaping stale abstract and filesystem X11 sockets (`@/tmp/.X11-unix/X*`, `/tmp/.X*-lock`).
   - Starttime-validated window manager eviction and `_NET_WM_CM_S0` compositor conflict resolution.
   - Bounded ring-buffer logging preventing microVM disk exhaustion.
4. **Tauri Client Dynamic Ingress Integration (R4)**:
   - Dynamic ingress manager (`DynamicTunnelClient`) in `crates/frostfire-tunnel` supporting zero-restart hot switching between Local Daemon (`127.0.0.1:50051`), Cloud Gateway (`gateway:50051`), and Cloud Lambda MicroVM (`lambda-url`).
   - Authentication engine supporting constant-time tenant tokens (`subtle::ConstantTimeEq`), HMAC-SHA256 pre-signed tokens, and AWS IAM SigV4 signing.
   - Synchronized Protobuf definitions with fields 28 (`BlackboardSyncFrame`) and 29 (`DagSyncFrame`).
   - Tauri IPC command suite for seamless desktop control.

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F18 | WebAuthn MV3 Extension | Chrome MV3 extension with `webAuthenticationProxy` background worker | M5 | ORIGINAL_REQUEST §Follow-up, Survey 2.1 |
| F19 | WebAuthn Native Host | Native messaging host & JSON policy manifests in `cloud/microvm/` | M5 | ORIGINAL_REQUEST §Follow-up, Survey 2.1 |
| F20 | WebAuthn Reverse Tunnel Routing | In-VM port 1340 bridge & gRPC ceremony frame routing over OpenTunnel | M5 | ORIGINAL_REQUEST §Follow-up, Survey 2.1 |
| F21 | Amazon EFS Lambda Persistence | Configure EFS FileSystem, MountTargets, AccessPoint, & Lambda mount in CFN | M6 | ORIGINAL_REQUEST §Follow-up, Survey 2.2 |
| F22 | Shadow Worktree Sync | Script `scripts/sync-workspace-state.sh` for git shadow tree snapshots & restore | M6 | ORIGINAL_REQUEST §Follow-up, Survey 2.2 |
| F23 | CLI Credential Persistence | Port `cloud/microvm/bin/persist-cli-auth` to persist developer CLI tokens to EFS | M6 | ORIGINAL_REQUEST §Follow-up, Survey 2.2 |
| F24 | Multi-Screen Display Daemons | Port `box-xvfb`, `box-xfwm4`, `box-picom`, `box-plank`, `box-x11vnc` into `cloud/microvm/bin/` | M7 | ORIGINAL_REQUEST §Follow-up, Survey 2.2 |
| F25 | Bounded Logging & Health Diagnostics | Port `box-bounded-log.mjs`, `box-bounded-log`, `box-doctor` into `cloud/microvm/bin/` | M7 | ORIGINAL_REQUEST §Follow-up, Survey 2.2 |
| F26 | In-VM Desktop Integration | Integrate crash defenses into `start-desktop.sh` & update `Dockerfile.rootfs` | M7 | ORIGINAL_REQUEST §Follow-up, Survey 2.2 |
| F27 | Proto Schema Synchronization | Add `BlackboardSyncFrame` (28) and `DagSyncFrame` (29) to `tunnel.proto` | M8 | ORIGINAL_REQUEST §Follow-up, Survey 2.3 |
| F28 | Dynamic Ingress Tunnel Client | Implement `DynamicTunnelClient` hot-switching between Local, Gateway, and Lambda | M8 | ORIGINAL_REQUEST §Follow-up, Survey 2.3 |
| F29 | Pre-Signed Token & SigV4 Auth | Implement constant-time tokens, HMAC-SHA256 pre-signed auth, and SigV4 in tunnel | M8 | ORIGINAL_REQUEST §Follow-up, Survey 2.3 |
| F30 | Tauri IPC Ingress Bindings | Implement Tauri IPC commands and configuration schema for dynamic ingress | M8 | ORIGINAL_REQUEST §Follow-up, Survey 2.3 |
| F31 | WebAuthn & Multi-Display E2E Tests | End-to-end integration tests for WebAuthn ceremony frame roundtrip & multi-display | M9 | ORIGINAL_REQUEST §Follow-up, §Acceptance |
| F32 | Quality Gate & Invariant Verification | Verify `cargo test --workspace`, `cargo clippy`, constant-time auth, and zero secrets | M9 | ORIGINAL_REQUEST §Follow-up, §Acceptance |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M5 | Inverted WebAuthn Proxy Bridge | F18, F19, F20 | none | DONE |
| M6 | Ephemeral Lambda MicroVM State Persistence | F21, F22, F23 | none | PLANNED |
| M7 | Multi-Screen Display Multiplexer & Crash Defenses | F24, F25, F26 | none | PLANNED |
| M8 | Tauri Client Dynamic Ingress Integration | F27, F28, F29, F30 | none | PLANNED |
| M9 | Final E2E Integration Verification & Quality Gates | F31, F32 | M5, M6, M7, M8 | PLANNED |

---

## Interface Contracts

### 1. WebAuthn Proxy Bridge Contract
- **Extension ID / Host Name**: `io.frostfire.agent.webauthn_proxy`
- **Native Host Messaging Protocol**: Standard 4-byte native messaging header followed by UTF-8 JSON payload.
- **In-VM Bridge Endpoint**: `POST http://127.0.0.1:1340/api/requestWebAuthnCeremony`
- **Reverse Tunnel gRPC Payloads**:
  - `WebAuthnCeremonyRequest`: `{ ceremony_id, ceremony_type, rp_id, challenge, user_id, credential_ids, authenticator_selection, timeout_ms }`
  - `WebAuthnCeremonyResponse`: `{ ceremony_id, success, credential_id, authenticator_data, client_data_json, signature, user_handle, error_message }`
- **Security Invariant**: Zero credentials or private keys on cloud disk. All passkey signatures performed by client authenticator hardware.

### 2. Lambda EFS Persistence Contract
- **EFS Mount Path**: `/mnt/workspace`
- **Access Point POSIX Identity**: UID `10001`, GID `10001` (matching `frostfire` runtime user in `Dockerfile.lambda`)
- **Shadow Ref**: `refs/frostfire/shadow/<agent_id>`
- **Manifest**: `/mnt/workspace/.frostfire/state/<agent_id>/manifest.json`
- **Locking**: Distributed `flock` on `/mnt/workspace/.frostfire/locks/<agent_id>.lock`

### 3. Display Supervisor & Crash Defense Contract
- **Bin Directory**: `cloud/microvm/bin/`
- **Abstract Socket Probe**: `ss -lpxH "src = @/tmp/.X11-unix/X${n}"` and `fuser "/tmp/.X11-unix/X${n}"`
- **Window Manager Starttime Check**: `/proc/${pid}/stat` field 22 validated before SIGKILL
- **Compositor Selection**: `_NET_WM_CM_S0` X11 selection monitored via `box-plank` probe
- **Circular Log Buffer**: Max 1 MB with 250ms asynchronous flush and `.1` rotation

### 4. Dynamic Ingress Tunnel Contract
- **Ingress Modes**:
  - `LocalDaemon`: `http://127.0.0.1:50051`
  - `CloudGateway`: `https://gateway.frostfire.internal:50051`
  - `CloudLambda`: `https://<id>.lambda-url.<region>.on.aws/`
- **Hot-Switching**: Persistent application channels (`app_tx`, `app_rx`) decoupled from transport workers; switching modes preserves buffered frames without client restarts.
- **Auth Tokens**: Constant-time verification (`subtle::ConstantTimeEq`) for gateway, pre-signed HMAC-SHA256, and AWS SigV4 for Lambda Function URLs.

---

## Code Layout

- `cloud/microvm/webauthn-proxy/`:
  - `manifest.json`: MV3 extension manifest
  - `background.js`: Extension background service worker intercepting WebAuthn APIs
- `cloud/microvm/etc-policies/`:
  - `native-messaging-hosts/io.frostfire.agent.webauthn_proxy.json`: Native host manifest
  - `policies/managed/frostfire-webauthn.json`: Chrome enterprise managed policy
- `cloud/microvm/bin/`:
  - `frostfire-webauthn-proxy-host`: Wrapper script launching NodeJS host
  - `webauthn-proxy-host.mjs`: Native messaging host communicating with bridge
  - `box-xvfb`, `box-xfwm4`, `box-picom`, `box-plank`, `box-x11vnc`: Display supervisor wrappers
  - `box-bounded-log.mjs`, `box-bounded-log`: Bounded circular logger
  - `box-doctor`: Diagnostic health check
  - `persist-cli-auth`: CLI credential mirror
- `cloud/microvm/scripts/start-desktop.sh`: Multi-display desktop startup using crash defense wrappers
- `cloud/microvm/Dockerfile.rootfs`: Root filesystem container definition with updated packages
- `deploy/aws/lambda-microvm.yaml`: CloudFormation template with EFS file system, access point, and Lambda mounts
- `scripts/sync-workspace-state.sh`: Zero-disruption shadow worktree snapshot and restore script
- `crates/frostfire-proto/proto/tunnel.proto`: Synchronized protobuf definitions (fields 28, 29)
- `crates/frostfire-tunnel/src/`:
  - `dynamic.rs`: `DynamicTunnelClient`, `TunnelSessionManager`, ingress modes
  - `auth.rs`: Pre-signed token generation and SigV4 authentication
  - `tauri_commands.rs`: Tauri IPC command bindings
- `tests/e2e/`:
  - `tests/webauthn_e2e_test.rs`: WebAuthn ceremony frame roundtrip test
  - `tests/multi_display_e2e_test.rs`: Multi-display routing test
