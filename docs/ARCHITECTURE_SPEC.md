# Frostfire System Architecture Specification: Three-Area Topology

**Status:** APPROVED via `/grill-me` Design Consensus  
**Target Environments:** Cloud (microVM), Cloud (services), Application (desktop/web app)

---

## 1. System Topology Overview

```
+───────────────────────────────────────────────────────────────────────────────────+
│ AREA 3: APPLICATION (Desktop Tauri v2 / Web Client)                               │
│  - UI State, Chat Streaming, Terminal Cards & noVNC Viewport Canvas               │
│  - Dynamic Screen Context & Task Prompt Injector                                  │
│  - Host Guardrail Engine: Tiered Path & Clipboard Whitelisting Modal              │
│  - Client Transport: Multiplexed WebSocket / gRPC over TLS 1.3                   │
+─────────────────────────────────────────▲─────────────────────────────────────────+
                                          │
                        Client Session    │ Authenticated Reverse Proxy
                        Auth Token        │ (x-frostfire-window-owner)
                                          ▼
+───────────────────────────────────────────────────────────────────────────────────+
│ AREA 2: CLOUD SERVICES (Central Control Plane & Gateway)                           │
│  - Intelligent LLM Router (Fast Tier vs. Reasoning Tier)                          │
│  - Outbound-Only Ingress Tunnel Broker (OpenTunnel TLS 1.3)                       │
│  - Hybrid Compaction Engine & Prompt Normalization                                │
│  - Asynchronous Batched Metering: Redis Hot Cache + 60s Stripe API Sync           │
│  - COLD Storage Sync: Presigned S3 Snapshot Broker                                │
│  - Opt-in Trajectory Data Warehouse & Automated DPO Distillation Pipeline        │
+─────────────────────────────────────────▲─────────────────────────────────────────+
                                          │
                        Outbound TLS 1.3  │ Reverse Stream Tunnel
                        (No Open Ingress) │
                                          ▼
+───────────────────────────────────────────────────────────────────────────────────+
│ AREA 1: CLOUD MICROVM (Firecracker / KVM Isolated Runtime)                        │
│  - Agent Execution Loop: Native Rust (`rig-rs`) Core                              │
│  - Ephemeral Sub-Agent Isolation: Dedicated Git Worktrees + Linux Namespaces      │
│  - Local Memory Subsystems:                                                       │
│      ├── HOT: Active Context Buffer (75% compaction trigger to Cloud Gateway)     │
│      ├── WARM: Embedded SQLite + `sqlite-vec` + FTS5 (.system/state/warm.db)      │
│      └── COLD: S3 Snapshot unpacker on boot; encrypter/packer on shutdown         │
│  - Dual-Stream Display: Headless Xvfb (:1) + noVNC (6080) + On-Demand `scrot` API  │
│  - Local MCP Host: STDIO & SSE Tool Server Supervisor                             │
+───────────────────────────────────────────────────────────────────────────────────+
```

---

## 2. Definitive Area Breakdown & Responsibilities

### Area 1: Cloud (microVM) — Sandboxed Execution Sandbox
1. **Agent Engine (`rig-rs`)**:
   - Primary agent loop handling step planning, tool invocation, and user interaction.
   - Ephemeral sub-agent spawning for context isolation; compiles and distills heavy outputs before returning concise summaries to parent.
2. **Sub-Agent Isolation**:
   - Ephemeral Git Worktrees (`/tmp/worktrees/<task_id>`) combined with Linux cgroups and PID/network namespaces.
   - Independent verification gate (test suite, compiler exit code) before merging to main workspace.
3. **Embedded Memory Architecture**:
   - **HOT Memory**: Local token counter; triggers typed `CompactionRequest` when token watermark exceeds 75%.
   - **WARM Memory**: In-process `sqlite-vec` + FTS5 database (`warm_memory.db`) storing turn embeddings, tool traces, and temporary diffs.
   - **COLD Memory Client**: Unpacks S3 snapshot at boot; encrypts and streams diffs to S3 at session commit or idle shutdown.
4. **Display & Automation**:
   - X11 Display `:1` with Xvfb, picom compositor, and `x11vnc`.
   - On-Demand frame capture API via `scrot` for AI vision models.
   - Local MCP Server Supervisor (STDIO & SSE transports).

---

### Area 2: Cloud (services) — Gateway, Router, Billing & Learning
1. **LLM Gateway & Model Router**:
   - Routes requests to Fast Tier (Claude 3.5 Haiku / Nova Lite) for classification, compaction, and sub-agent steps.
   - Routes to Reasoning Tier (Claude 3.7 Sonnet / DeepSeek R1 / o1) for architecture, multi-file refactoring, and error recovery.
   - Central prompt injection sanitization and schema verification.
2. **Reverse Tunnel Broker**:
   - Terminate outbound TLS 1.3 streams from microVM daemons (`OpenTunnel`).
   - Constant-time verification (`timingSafeEqual`) of `x-frostfire-window-owner` tenant tokens.
3. **Usage Metering & Stripe SaaS**:
   - Sub-millisecond balance check in Redis on the hot path (zero added LLM latency).
   - Local credit balance decrement with immediate hard lock on $\le 0$ balance.
   - Periodic 60-second flush to Stripe Metered Billing API (`/v1/billing/meter_events`).
4. **Tenant Lifecycle & Storage**:
   - EC2 Spot / Firecracker orchestrator with automated 20-minute idle shutdown reaper.
   - S3 bucket management for tenant COLD snapshots.
5. **Recursive Training Pipeline (Post-MVP)**:
   - Opt-in trajectory collector with client-side PII scrubbing.
   - Verifier-gated filtering: pairs passing trajectories (chosen) against initial failed attempts (rejected) into DPO Parquet datasets.

---

### Area 3: Application (desktop/web app) — Client Experience & Host Rails
1. **Desktop Shell & UI**:
   - Cross-platform Tauri v2 (Rust + React/TypeScript) with embedded webview.
   - Interactive chat stream, terminal emulator cards, diff viewers, and noVNC remote desktop canvas.
2. **Screen Context & Prompt Injector**:
   - Gathers active window metadata, focused app name, and screen bounds; prepends metadata into agent turns dynamically.
3. **Host Security Rails**:
   - Tiered permission engine: Auto-permits reads inside the configured workspace.
   - Triggers native modal approval for host clipboard access, reading outside workspace paths, or running host commands.
   - Remembers "Always allow for this workspace" whitelist rules.
4. **Transport Client**:
   - Connects to Cloud Gateway over secure WebSockets / gRPC.
   - Multiplexes user keystrokes/mouse events and receives display frame updates.

---

## 3. Implementation Roadmap by Area

| Phase | Cloud (microVM) | Cloud (services) | Application (desktop/web) |
|---|---|---|---|
| **Phase 1: Foundation (Weeks 1-4)** | • Rig-rs agent runtime<br>• Basic MCP STDIO runner<br>• Xvfb + noVNC setup | • Outbound tunnel broker<br>• LLM Gateway proxy<br>• EC2 Spot bootstrap script | • Tauri v2 desktop shell<br>• Chat & terminal stream UI<br>• Tunnel client connection |
| **Phase 2: Context & Memory (Weeks 5-8)** | • Git worktree sub-agents<br>• SQLite + sqlite-vec engine<br>• HOT 75% compaction hook | • Model tier router (Fast vs. Deep)<br>• Gateway compaction handler<br>• S3 COLD snapshot sync | • Dynamic screen prompt injection<br>• Host permission dialog modal<br>• Interactive diff visualizer |
| **Phase 3: Production & Metering (Weeks 9-12)**| • vsock hardware bridge<br>• Box-doctor test assertions<br>• Hardened cgroup jail | • Redis + 60s Stripe metering<br>• Automated 20m idle reaper<br>• Trajectory DPO harvester | • Multi-platform production builds<br>• Native OS credential storage<br>• Beta distribution packaging |
