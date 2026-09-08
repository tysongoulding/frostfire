# Dispatch: Explorer M1-3 (Workspace Integrity, frostfire-cli, and M1 Tests)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` and `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`.
Your role is `teamwork_preview_explorer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_3`.

Your scope is Milestone 1: Cloud Gateway Hardening & Tenant Auth.
Focus on:
1. Resolving the orphan crate issue with `crates/frostfire-cli`: adding it to root `Cargo.toml` `workspace.members`, inspecting its dependencies and compilation, and ensuring `cargo check --workspace` and `cargo test --workspace` pass cleanly.
2. Formulating the concrete verification plan and test suite for Milestone 1:
   - Unit tests in `frostfire-gateway` testing token comparison (valid tokens, invalid tokens, timing safe equality).
   - Integration tests in `cloud/gateway/tests/` verifying `OpenTunnel` accepts authenticated clients and rejects unauthenticated clients with code `Unauthenticated`.
   - Verifying `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`.

Deliver your analysis and recommended implementation strategy in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_3\report.md` and `handoff.md`.
