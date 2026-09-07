# Frostfire

**Local-First Autonomous Agent Desktop OS & Execution Environment**

Frostfire is a cross-platform, local-first autonomous agent platform. It pairs a native Tauri desktop interface with a high-performance Rust execution engine, virtual PTY multiplexer, canonical path jail, supervised MCP child processes, inverted credential broker, and a cryptographically verified SQLite Merkle audit ledger.

---

## 🏗️ Repository Layout

```text
frostfire/
├── Cargo.toml                    # Workspace manifest
├── .frostfire.toml                # Project & runtime configuration
├── application/                  # Desktop GUI (Tauri v2 + React + TypeScript + Tailwind)
│   ├── src/                      # React frontend interface & virtual terminal views
│   └── src-tauri/                # Tauri v2 native desktop shell bindings
└── crates/                       # Rust Core & Application Track
    ├── frostfire-cli/            # Unified CLI (`frostfire dev-server`, `frostfire daemon`, `frostfire doctor`)
    ├── frostfire-core/           # Shared domain models, agent state machines, and event schemas
    ├── frostfire-daemon/         # Background host service & multi-agent session orchestrator
    ├── frostfire-engine/         # Autonomous turn engine & LLM agent reasoning loop
    ├── frostfire-exec/           # Virtual PTY mux (portable-pty), path jail, atomic diffs, worktrees
    ├── frostfire-mcp/            # Supervised MCP child-process supervisor & capability allowlists
    ├── frostfire-proto/          # Protocol buffer definitions & Tonic gRPC codegen
    ├── frostfire-security/       # DPAPI keystore, inverted credential broker, Merkle SQLite ledger
    └── frostfire-tunnel/         # Outbound TLS gRPC tunnel manager & local mock gateway
```

---

## 💻 Subsystems

1. **Desktop Workspace OS (`application/`)**
   - React 19 + TypeScript + Vite + Tailwind CSS interface running inside Tauri v2.
   - Real-time multi-agent view, virtual screen tabs, interactive diff visualizer, and approval center.

2. **Virtual PTY Multiplexer (`crates/frostfire-exec`)**
   - Cross-platform terminal virtualization powered by `portable-pty` with native Windows ConPTY support.
   - Spawns independent agent screens (`screen_id`), broadcast ANSI streaming, and circular in-memory ring buffers for history scrollback.

3. **Workspace Containment & Atomic Patching (`crates/frostfire-exec`)**
   - `WorkspaceJail`: Canonical path verification preventing path traversal (`../`, symlinks, junctions).
   - `AtomicPatchApplicator`: Pre-commit SHA-256 validation and shadow-swap ACID atomic replacements.
   - `WorktreeManager`: Ephemeral Git worktrees (`.frostfire/worktrees/<agent_id>`) for collision-free concurrent agent builds.

4. **Security & Cryptographic Audit (`crates/frostfire-security`)**
   - **Hardware Keystore**: Windows DPAPI integration with encrypted software fallbacks.
   - **Inverted Credential Broker**: Local credential signing and injection so external processes never see raw credentials.
   - **Merkle Audit Ledger**: Append-only SQLite ledger with SHA-256 Merkle chain verification for non-repudiation.

5. **MCP Supervisor (`crates/frostfire-mcp`)**
   - Supervised child-process stdio / SSE transport with strict capability allowlists.

6. **Autonomous Turn Engine (`crates/frostfire-engine`)**
   - Self-contained execution loop coordinating LLM tool calls, PTY commands, and file edits.

---

## 🚀 Quickstart & Verification

### 1. Build and Run Workspace Tests
```bash
cargo test --workspace --exclude frostfireOS-tauri
```
Executes unit and integration tests across all engine, execution, security, MCP, and CLI crates.

### 2. Run Closed-Loop End-to-End Testbed
```bash
cargo run -p frostfire-cli -- dev-server --auto-verify
```
Starts an in-process mock gateway, connects the local daemon, and executes an automated end-to-end multi-agent test:
- Concurrent PTY command dispatch across Agent 1 & Agent 2 screens.
- Atomic file patch application.
- MCP tool invocation.
- Dual-channel signed approval handling.
- Audit ledger hash verification.

### 3. Run the Desktop Application
```bash
# In application/
cd application
npm install
npm run tauri dev
```

### 4. System Diagnostics & Audit Inspection
```bash
cargo run -p frostfire-cli -- doctor
cargo run -p frostfire-cli -- audit
```
