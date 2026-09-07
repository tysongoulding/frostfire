# Frostfire Agent Directives

Cross-platform autonomous cloud agent system. Dual-track Rust monorepo.

## Verification Gates

Execute after every modification before declaring work complete:

1. **Unit & Integration Suite**: `cargo test --workspace` (must pass all tests, 0 warnings).
2. **Closed-Loop End-to-End**: `cargo run -p frostfire-cli -- dev-server --auto-verify` (verifies PTY mux, atomic diffs, MCP allowlists, approvals, and SQLite Merkle ledger).
3. **Linter**: `cargo clippy --workspace -- -D warnings`.

## Architecture Layout

- `application/`: Tauri 2 Desktop Application (React, Vite, Tailwind UI + Rust Tauri commands)
- `crates/`: Application Track & Client Core
  - `frostfire-proto`: Protocol buffer contracts (`AgentTunnelService.OpenTunnel`). Single source of truth.
  - `frostfire-tunnel`: Outbound TLS gRPC connection manager & in-process mock gateway.
  - `frostfire-exec`: Virtual PTY multiplexer (`portable-pty`), canonical path jail, atomic diff applicator, git worktree manager.
  - `frostfire-security`: Windows DPAPI / software keystore, inverted credential broker, SQLite Merkle audit ledger.
  - `frostfire-mcp`: Supervised stdio/SSE child processes with tool allowlists.
  - `frostfire-daemon`: Local background host service.
  - `frostfire-cli`: Unified CLI entrypoint (`dev-server`, `daemon`, `doctor`, `audit`).
  - `frostfire-core`: Client models, local DAG, and Blackboard client.
  - `frostfire-engine`: Client LLM provider routing, security filters, and local turn engine.

## Invariants

- **Outbound-Only Control**: Local daemon never opens listening ports. All control flows over `OpenTunnel` reverse stream.
- **Canonical Jailing**: All file writes and CWDs must pass `WorkspaceJail::resolve_path` and `validate_cwd`. Traversal (`../`) must fail.
- **Zero Credential Leakage**: Never transmit raw OAuth refresh tokens or private keys to cloud workers. Use inverted broker pattern.
- **Atomic Mutations**: File modifications must use `AtomicPatchApplicator` with shadow-file swapping.
- **Tamper Evidence**: All actions (exec, patch, mcp) append to `MerkleAuditLedger` with SHA-256 hash chaining.
