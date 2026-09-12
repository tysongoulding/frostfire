# Frostfire

**Autonomous Agent Operating System & Cloud Virtualization Platform**

Frostfire is a full-stack, local-first autonomous agent platform. It pairs a native cross-platform desktop interface (Tauri v2 + React) with an outbound-only cloud gateway, an intelligent multi-tier LLM router, and an isolated microVM sandbox runtime (Firecracker KVM / Linux 6.12 / Debian 13).

---

## 🏛️ Architecture: The Three Areas

Frostfire is organized as a unified monorepo decomposed across three distinct operational areas:

```
+───────────────────────────────────────────────────────────────────────────────────+
│ AREA 3: APPLICATION (Desktop & Web Client)                                        │
│  - Tauri v2 + React 19 + TypeScript + Vite + Tailwind                             │
│  - Multi-agent chat interface, terminal stream cards, noVNC remote canvas         │
│  - Dynamic screen prompt injection & local host permission guardrails             │
+─────────────────────────────────────────▲─────────────────────────────────────────+
                                          │ Multiplexed gRPC / WebSocket
                                          │ TLS 1.3 (x-frostfire-window-owner)
                                          ▼
+───────────────────────────────────────────────────────────────────────────────────+
│ AREA 2: CLOUD SERVICES (Central Control Plane & Gateway)                           │
│  - Model Router (Fast Tier vs. Reasoning Tier: Bedrock, Anthropic, Gemini)        │
│  - Outbound-only reverse-tunnel broker (OpenTunnel TLS 1.3)                       │
│  - Asynchronous batched token metering (Redis + 60s Stripe sync)                  │
│  - AWS EC2 Spot infrastructure & 20-minute idle shutdown reaper                   │
+─────────────────────────────────────────▲─────────────────────────────────────────+
                                          │ Outbound Reverse Tunnel
                                          │ (No Public Ingress Ports)
                                          ▼
+───────────────────────────────────────────────────────────────────────────────────+
│ AREA 1: CLOUD MICROVM (Firecracker / KVM Hardened Sandbox)                        │
│  - Bare-metal Rust hypervisor daemon (`frostfire-hypervisor`)                     │
│  - Monolithic Linux 6.12 ELF kernel + Debian 13 (Trixie) rootfs appliance         │
│  - Rig-rs execution loop with isolated Git worktree sub-agents                    │
│  - WARM Memory (`sqlite-vec` + FTS5) & Dual-Stream Display (Xvfb :1 + noVNC 6080) │
+───────────────────────────────────────────────────────────────────────────────────+
```

---

## 📂 Repository Layout: Where Everything Lives

```text
frostfire/
├── Cargo.toml                       # Root Cargo workspace manifest
├── AGENTS.md                        # Active operational directives & verification gates
├── SYSTEM.md                        # Master Frostfire system prompt & JSON schema bridge
│
├── application/                     # AREA 3: Desktop & Web Client
│   ├── src/                         # React frontend UI (chat, terminal cards, noVNC canvas)
│   ├── src-tauri/                   # Tauri v2 native desktop shell bindings & commands.rs
│   └── package.json                 # Desktop dependencies & Vite configuration
│
├── cloud/                           # AREA 1 & 2: Cloud Infrastructure & MicroVM Appliance
│   ├── deploy/                      # Area 2: AWS CloudFormation templates (c6i.xlarge Spot)
│   ├── scripts/                     # Area 2: deploy-poc.ps1, setup-host.sh, idle daemon
│   ├── kernel/                      # Area 1: Monolithic Linux 6.12 kernel config & build pipeline
│   ├── rootfs/                      # Area 1: Debian 13 (Trixie) ext4 rootfs builder
│   ├── home-box/                    # Area 1: Guest user home directory, scripts, and policies
│   ├── usr-local-bin/               # Area 1: Launchers (chrome-launcher, terminal-launcher)
│   └── etc-policies/                # Area 1: Chrome enterprise managed policies & native hosts
│
└── crates/                          # Shared Rust Workspace Crates
    ├── frostfire-hypervisor/        # Area 1: Firecracker KVM hypervisor orchestrator
    ├── frostfire-tunnel/            # Area 2: TLS 1.3 reverse-tunnel protocols (OpenTunnel)
    ├── frostfire-engine/            # Area 2: Agent reasoning loop & Bedrock/LLM router
    ├── frostfire-proto/             # Area 3: Protocol Buffers & gRPC schema codegen
    ├── frostfire-cli/               # Area 3: Unified developer CLI (dev-server, doctor, audit)
    ├── frostfire-core/              # Shared domain models, state machines & errors
    ├── frostfire-daemon/            # Local background host service & session manager
    ├── frostfire-exec/              # Virtual PTY mux (portable-pty), path jail, worktrees
    ├── frostfire-mcp/               # Supervised MCP child-process host & allowlists
    └── frostfire-security/          # DPAPI keystore, inverted broker, Merkle SQLite ledger
```

---

## 🌿 Working in this Repo: Branching & Workflow

### 1. Branch Naming Conventions
To ensure clear ownership and traceability across all three areas, **branches must start with an area prefix**:

| Area | Prefix | Example Branches | Scope |
|---|---|---|---|
| **Area 1: Cloud (microVM)** | `cloud-vm/` | `cloud-vm/kernel-6.12-virtio`<br>`cloud-vm/rootfs-chroot-fix`<br>`cloud-vm/hypervisor-vsock-tap` | Linux kernel, Debian rootfs, Firecracker hypervisor, guest daemons, Xvfb/display stack. |
| **Area 2: Cloud (services)** | `cloud-svc/` | `cloud-svc/stripe-metered-billing`<br>`cloud-svc/bedrock-model-routing`<br>`cloud-svc/spot-host-bootstrap` | Central Gateway, LLM router, CloudFormation, reverse-tunnel broker, billing, S3 sync. |
| **Area 3: Application (desktop/web)** | `app/` | `app/terminal-stream-card`<br>`app/novnc-canvas-resize`<br>`app/prompt-screen-context` | Tauri UI, React components, desktop commands, host permission guardrails, CLI tools. |
| **Cross-Cutting / Protocol** | `cross/` or `proto/` | `proto/compaction-schema`<br>`cross/workspace-unification` | Changes modifying shared schemas (`frostfire-proto`) or multi-area features. |

*(Alternative suffix style: `feature-name-vm`, `feature-name-svc`, `feature-name-app` is also recognized, but prefix notation `area/...` is strongly preferred for git autocomplete).*

### 2. Verification Gates (Non-Negotiable)
Before committing or opening a pull request, you **must** execute and pass all verification gates:

```bash
# 1. Full Workspace Unit & Integration Tests (must pass 100%, 0 failures)
cargo test --workspace

# 2. Strict Workspace Linter (must produce 0 warnings)
cargo clippy --workspace -- -D warnings
```

### 3. Core Architectural Invariants
1. **Outbound-Only Ingress**: Cloud Gateway routes agents via reverse-stream `OpenTunnel`. MicroVMs never expose public open inbound ports; daemons connect outbound over TLS 1.3.
2. **MicroVM Network Isolation**: Guest instances run on isolated bridge networks (`172.16.x.0/24` or TAP `172.30.0.1/24`). Never bridge unauthenticated guest networks to the public internet.
3. **Tenant Authorization**: All display/RPC routes must pass `x-frostfire-window-owner` token checks with constant-time comparison (`timingSafeEqual`).
4. **Zero Secrets in Git**: Never commit AWS credentials, private keys, or API tokens to the repository.

---

## 🛠️ Development & Quickstart

### Area 3: Running the Desktop Application
```bash
cd application
npm install
npm run tauri dev
```

### Area 2: Testing Cloud Gateway & Model Routing
```bash
# Run unit & live integration tests for the reasoning engine
cargo test -p frostfire-engine
cargo test -p frostfire-tunnel
```

### Area 1: Building & Testing the Hypervisor Daemon
```bash
# Test the Firecracker orchestrator
cargo test -p frostfire-hypervisor

# Build release binary for Linux KVM host
cargo build -p frostfire-hypervisor --release
```

### Running the End-to-End Testbed
```bash
cargo run -p frostfire-cli -- dev-server --auto-verify
```
Starts an in-process mock gateway, connects the local daemon, and executes an automated end-to-end multi-agent test:
- Concurrent PTY command dispatch across Agent 1 & Agent 2 screens.
- Atomic file patch application and workspace jail checks.
- Supervised MCP tool invocation.
- Merkle audit ledger cryptographic verification.
