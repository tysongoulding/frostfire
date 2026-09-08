# Orchestrator Dispatch — 2026-09-08T22:43:43Z

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2`

## Workspace
`c:\Users\tyson\.repo\personal\frostfire-cloud`

## Authoritative Request
See `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (specifically section `## Follow-up — 2026-09-08T22:43:43Z`).

## Reference Materials
- GrokBot / Sand Architecture Specification: `c:\Users\tyson\.repo\personal\syntropy\docs\GROKBOT_MICROVM_ARCHITECTURE.md`
- GrokBot Inverted WebAuthn Extension: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\webauthn-proxy/`
- GrokBot Multi-Display & Crash Defenses: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm/`
- Frostfire Tauri Application: `c:\Users\tyson\.repo\personal\frostfire` (specifically `crates/frostfire-tunnel`)
- Prior milestone artifacts in `.agents/`

## Core Requirements to Address
1. R1: Inverted WebAuthn Proxy Bridge (Chrome MV3 extension in `cloud/microvm/webauthn-proxy/`, native messaging host, gRPC reverse tunnel ceremony frame routing).
2. R2: Ephemeral Lambda MicroVM State Persistence & Worktrees (EFS `/mnt/workspace` in `deploy/aws/lambda-microvm.yaml`, shadow worktree snapshot/restore in `scripts/sync-workspace-state.sh`).
3. R3: Multi-Screen Display Multiplexer & Crash-Loop Defenses (Port `box-xvfb`, `box-xfwm4`, `box-picom`, `box-plank`, `box-x11vnc`, `box-bounded-log.mjs` into `cloud/microvm/bin/` with stale lock cleanup and process reaping).
4. R4: Tauri Client Dynamic Ingress Integration (Tauri client tunnel in `crates/frostfire-tunnel` and IPC bindings to enable seamless switching between local daemon mode and cloud Lambda microVM mode with pre-signed token authentication).

## Gates & Acceptance Criteria
- Security & Invariants: constant-time token comparison, no raw credentials or private keys on cloud disk, stale X11 lock reaping, EFS persistence across simulated container recycling.
- `cargo test --workspace` passes with 0 failures and 0 warnings.
- `cargo clippy --workspace -- -D warnings` completes with 0 warnings.
- End-to-end integration tests verify WebAuthn ceremony frame roundtrip and multi-display routing.
