# Dispatch: Explorer M1-1 (Gateway Tenant Authentication & Constant-Time Security)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` and `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`.
Your role is `teamwork_preview_explorer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1`.

Your scope is Milestone 1: Cloud Gateway Hardening & Tenant Auth.
Focus on:
1. Hardening `open_tunnel` in `cloud/gateway/src/service.rs` to extract `authorization: Bearer <token>` and `x-sand-window-owner: <token>` metadata headers.
2. Integrating the `subtle` crate (`subtle::ConstantTimeEq`) into `Cargo.toml` / workspace dependencies for constant-time comparison against the configured tenant token (`GatewayConfig.tenant_token`).
3. Rejecting unauthorized or malformed requests with `tonic::Status::unauthenticated("Invalid or missing tenant token")` without timing leakage.
4. Designing unit and integration test strategies for verifying constant-time rejection and valid session admission.

Deliver your analysis and recommended implementation strategy in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\report.md` and `handoff.md`.

## 2026-09-08T20:35:45Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1.
Investigate Milestone 1 implementation details:
- Adding subtle crate to Cargo workspace and cloud/gateway
- Extracting and verifying authorization / x-sand-window-owner metadata in cloud/gateway/src/service.rs using subtle::ConstantTimeEq
- Rejecting unauthenticated requests with tonic::Status::unauthenticated
Write your report to c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\report.md and handoff to c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_1\handoff.md. Notify parent when done.
