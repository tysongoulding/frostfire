# BRIEFING — 2026-09-08T20:39:55Z

## Mission
Investigate Milestone 1 implementation details for Cloud Gateway tenant authentication and constant-time security (subtle crate, metadata extraction, timing-safe validation, rejection).

## 🔒 My Identity
- Archetype: explorer
- Roles: teamwork_preview_explorer
- Working directory: c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1
- Original parent: a683d2a2-4cae-4a3a-a587-8741f091dc4b
- Milestone: M1 (Cloud Gateway Hardening & Tenant Auth)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement changes in source tree
- Output report.md and handoff.md in working directory
- Send message to parent (a683d2a2-4cae-4a3a-a587-8741f091dc4b) when done

## Current Parent
- Conversation ID: a683d2a2-4cae-4a3a-a587-8741f091dc4b
- Updated: not yet

## Investigation State
- **Explored paths**: Cargo.toml, Cargo.lock, cloud/gateway/*, crates/frostfire-tunnel/*, crates/frostfire-daemon/*, cloud/agent/*, tests/e2e/*, docs/MICROVM_ARCHITECTURE.md
- **Key findings**:
  1. `subtle v2.6.1` is already locked in Cargo.lock and compiles cleanly.
  2. `members` in root Cargo.toml needs `crates/frostfire-cli` added (F5).
  3. `cloud/gateway` needs `subtle = { workspace = true }`.
  4. `GatewayConfig` should be created with `tenant_token: Option<String>` to support backward-compatible tests while strictly enforcing constant-time auth when configured.
  5. `service.rs` must extract `authorization` (stripping "Bearer ") and `x-sand-window-owner`, comparing via `subtle::ConstantTimeEq` and rejecting invalid/missing tokens with `tonic::Status::unauthenticated("invalid or missing tenant token")`.
- **Unexplored areas**: None for M1 scope; implementation to be done by implementer.

## Key Decisions Made
- Use `Option<String>` for `tenant_token` on `GatewayTunnelService` and `GatewayConfig`. When `Some`, enforce constant-time check. When `None`, allow unauthenticated dev mode to prevent regressions in existing tests.
- Support both `authorization: Bearer <token>` / `authorization: <token>` and `x-sand-window-owner: <token>`.
- Fully documented in report.md and handoff.md.

## Artifact Index
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\BRIEFING.md — Working memory and context tracking
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\progress.md — Liveness heartbeat
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\report.md — Detailed investigation report
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\handoff.md — 5-component handoff report
