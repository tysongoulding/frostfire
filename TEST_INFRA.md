# Frostfire Cloud: Test Infrastructure & Verification Architecture (Dual Track)

## 1. Executive Summary & Dual Track Architecture

Frostfire Cloud adopts a **Dual Track Test Architecture** to guarantee total independence between feature implementation and quality assurance:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PROJECT REQUIREMENTS                              │
│              (ORIGINAL_REQUEST.md / PROJECT.md / AGENTS.md)                 │
└──────────────────────┬───────────────────────────────┬──────────────────────┘
                       │                               │
                       ▼                               ▼
        ┌─────────────────────────────┐ ┌─────────────────────────────┐
        │    IMPLEMENTATION TRACK     │ │     TESTING TRACK (E2E)     │
        │                             │ │                             │
        │ • M1: Gateway & Tenant Auth │ │ • Tier 1: Feature Coverage  │
        │ • M2: MicroVM Virtualization│ │ • Tier 2: Boundary & Corner │
        │ • M3: AWS Production Infra  │ │ • Tier 3: Cross-Feature     │
        │ • M4: Hardening & Final Gate│ │ • Tier 4: Real-World Scenarios│
        └──────────────┬──────────────┘ └──────────────┬──────────────┘
                       │                               │
                       └───────────────┬───────────────┘
                                       ▼
                       ┌───────────────────────────────┐
                       │  OPAQUE-BOX VERIFICATION GATE │
                       │    cargo test --workspace     │
                       │    cargo clippy -D warnings   │
                       └───────────────────────────────┘
```

1. **Implementation Track**: Implementers build the production runtime components across Milestones M1, M2, and M3.
2. **Testing Track (Opaque-Box E2E)**: The Test Writer authors black-box/opaque-box integration suites in `tests/e2e/` strictly derived from formal interface contracts, protocol specifications (`tunnel.proto`), and architectural invariants.
3. **Progressive Testability**: Tests are designed to validate milestone capabilities cleanly, ensuring isolation, deterministic expected outputs, and actionable escalation of implementation bugs without modifying production code.

---

## 2. Test Runner & Execution Guide

All tests are executed via standard Rust `cargo test` tooling.

### Commands

| Scope | Command | Purpose |
|-------|---------|---------|
| **Full Workspace** | `cargo test --workspace` | Executes unit tests and full E2E suites |
| **All E2E Tiers** | `cargo test -p frostfire-e2e` | Runs all test tiers in `tests/e2e/` |
| **Tier 1: Feature Coverage** | `cargo test -p frostfire-e2e --test tier1_feature_coverage` | Runs Tier 1 (>=5 tests per feature across F1-F16) |
| **Tier 2: Boundary & Corner** | `cargo test -p frostfire-e2e --test tier2_boundary_corner` | Runs Tier 2 edge cases, fuzzing, and extreme inputs |
| **Tier 3: Cross-Feature** | `cargo test -p frostfire-e2e --test tier3_cross_feature` | Runs Tier 3 pairwise integration and interactions |
| **Tier 4: Real-World** | `cargo test -p frostfire-e2e --test tier4_real_world` | Runs Tier 4 end-to-end full application workflows |
| **Linter Compliance** | `cargo clippy --workspace -- -D warnings` | Enforces zero warnings gate |

---

## 3. Feature Inventory (F1 – F16)

| # | Feature ID | Name | Target Component | Formal Contract / Specification | Milestone |
|---|------------|------|------------------|----------------------------------|-----------|
| 1 | **F1** | Outbound Reverse Gateway | `frostfire-gateway` | `AgentTunnelService.OpenTunnel` bidirectional gRPC over TLS 1.3 | M1 |
| 2 | **F2** | Constant-Time Tenant Auth | `frostfire-gateway` | `subtle::ConstantTimeEq` / `timingSafeEqual` on `authorization` & `x-sand-window-owner` | M1 |
| 3 | **F3** | Multiplexed Frame Streaming | `frostfire-proto` | 17 symmetric frame payloads defined in `proto/tunnel.proto` | M1 |
| 4 | **F4** | Gateway Resilience & Recovery | `frostfire-tunnel` | Exponential backoff (0.5s–30s), pending frame buffering, heartbeat keepalive | M1 |
| 5 | **F5** | Workspace Manifest & Compilation | Workspace Root | `Cargo.toml` workspace members and dependency closure | M1 |
| 6 | **F6** | OverlayFS CoW Branching | `cloud/microvm` | Lowerdir golden base + sparse ext4 upperdir/workdir; sub-5ms branching | M2 |
| 7 | **F7** | Cgroups v2 Partitioning | `cloud/microvm` | `/sys/fs/cgroup/interactive` (weight 800) vs `/sys/fs/cgroup/agent` (weight 100) | M2 |
| 8 | **F8** | Multi-Display Window Router | `cloud/microvm` | `sand-window-router.mjs`: constant-time token check on ALL displays, WS upgrade | M2 |
| 9 | **F9** | Chrome Session Linking | `cloud/microvm` | `link-chrome-session.sh`: symlinked SQLite session databases (`Cookies`, `Login Data`) | M2 |
| 10 | **F10** | Live CDP Cookie Sync | `cloud/microvm` | `cdp-cookies.mjs`: cross-display CDP WebSocket cookie synchronization | M2 |
| 11 | **F11** | In-VM Daemon Supervision | `cloud/microvm` | `sand-exit-watch`: `PR_SET_CHILD_SUBREAPER`, zombie reaping, crash-loop prevention | M2 |
| 12 | **F12** | Script Line Ending Normalization | `cloud/microvm`, `scripts` | LF line endings across all shell scripts; `bash -n` validation | M2 |
| 13 | **F13** | Isolated Network Bridge | `cloud/microvm`, `deploy` | Subnet `172.16.x.0/24`; NO NAT masquerade; NO direct WAN forwarding | M3 |
| 14 | **F14** | Turnkey Deployment Scripts | `scripts/` | `cloud-start.ps1`, `setup-cluster.sh`: dynamic parameters, idempotency | M3 |
| 15 | **F15** | CloudFormation Validation | `deploy/aws/` | Syntactic and semantic validation of AWS CloudFormation templates | M3 |
| 16 | **F16** | End-to-End Integration Suite | `tests/e2e/` | Complete simulated desktop client -> gateway -> microVM -> teardown lifecycle | M4 |
| 17 | **F17** | Lambda Containerized MicroVM | `deploy/aws/`, `Dockerfile.lambda` | Containerized microVM per user with Lambda Web Adapter streaming & CloudFormation template | M3.5 |

---

## 4. Four-Tier Test Methodology

### Tier 1: Feature Coverage (>=5 Tests per Feature, Total >= 80 Tests)
Every feature F1 through F16 is verified with at least 5 primary behavioral tests covering:
- Happy-path execution.
- Function return values and output payloads matching the authoritative specification.
- Status code correctness (gRPC `OK`, HTTP `200`, `403 Forbidden`, `400 Bad Request`).
- Component lifecycle transitions (init -> active -> closed).
- State consistency across operations.

### Tier 2: Boundary & Corner Cases (>=5 Tests per Feature, Total >= 80 Tests)
Adversarial and boundary stress conditions for each feature:
- Token format extremes: empty token (0 bytes), 1-byte, 16KB token, null bytes, unicode/emoji strings, length mismatches.
- Side-channel resistance: variance measurement across byte prefixes to guarantee constant-time evaluation without short-circuiting.
- Network and stream extremes: zero-length frames, oversized payloads, rapid connect/disconnect churn.
- File and OS edge conditions: CRLF/LF variations, missing paths, permission denials, invalid cgroup weights, subreaper crash storms.
- Subnet boundary checks: broadcast IP (`.255`), host gateway collision (`.1`), non-routable CIDR blocks.

### Tier 3: Cross-Feature Combinations (Pairwise Coverage)
Verifies multi-module interactions across system boundaries:
1. **Tenant Authentication + Bidirectional Multiplexing**: Validated token opens stream; client simultaneously sends PTY input, receives VNC display takeover, and executes MCP tool call.
2. **Tenant Authentication + Reconnection Recovery**: Authenticated client drops TCP connection; reconnects with same credentials; verifies session continuity and channel swap in registry.
3. **Multiplexed Frame Streaming + Frame Buffering**: Client buffers frames while offline; flushes entire queue upon reconnection without frame loss or reordering.
4. **Network Bridge Isolation + Reverse Gateway Ingress**: Demonstrates that guest microVM cannot route packets directly to WAN (8.8.8.8) but successfully communicates with gateway via the reverse tunnel.
5. **OverlayFS CoW Branching + Cgroups v2 Partitioning**: MicroVM rootfs is branched via OverlayFS and all launched processes are automatically migrated to `/sys/fs/cgroup/agent`.
6. **Window Router + VNC Display Takeover**: Multi-display window router authenticates display token and forwards VNC takeover frames over websocket.
7. **In-VM Daemon Supervisor + PTY Shell + Diff Engine**: Supervisor watches agent process running PTY command, streams terminal output, and applies atomic unified diff.
8. **WebAuthn Passkey + Inverted Broker + Merkle Audit Ledger**: Inverted WebAuthn ceremony request processed over tunnel, signed, and committed to tamper-evident Merkle ledger.
9. **Chrome Multi-Display Linking + CDP Cookie Sync**: Linked SQLite profile databases updated; CDP daemon synchronizes live session cookies across displays.
10. **Turnkey Deployment Automation + CloudFormation Templates**: Validates orchestration scripts against declared CloudFormation parameter interfaces.

### Tier 4: Real-World Application Scenarios (>=5 Application-Level Tests)
Comprehensive lifecycle workflows simulating production end-user operations:
1. **Complete Developer Workflow**: Desktop client connects -> authenticates -> microVM boots -> PTY interactive terminal session opens -> file patch applied -> cargo build executes -> exit code streamed back -> session cleanly destroyed.
2. **Multi-Display Takeover & Remote VNC Streaming**: Remote user requests display takeover on display :2 -> token checked against token directory -> window router proxy upgrade -> RFB/VNC frame delivery -> user input event -> release.
3. **Transient Network Partition & Auto-Recovery**: Active interactive session experiences abrupt network drop -> gateway unregisters channel -> client buffers pending commands -> exponential backoff triggers reconnect -> session restored with zero frame loss.
4. **Multi-Tenant Session & Security Isolation**: Two separate tenants (Tenant Alpha and Tenant Beta) connect concurrently -> Tenant Alpha cannot access Tenant Beta's session or display -> network bridges `172.16.0.0/24` and `172.16.1.0/24` remain isolated.
5. **Disaster Teardown & Resource Sweep**: Sudden termination or panic inside microVM -> supervisor reaps orphaned child processes -> gateway detects disconnect -> upperdir CoW layers deleted -> sockets closed -> zero leaked resources.

---

## 5. Expected Output Derivation & Authoritative Sources

| Domain | Authoritative Source | Expected Values & Invariants |
|--------|----------------------|------------------------------|
| **gRPC Tunnel Protocol** | `crates/frostfire-proto/proto/tunnel.proto` | Frame IDs: UUIDv4. Payloads: 17 matching types. Heartbeat: `is_ack = true`, sequence match. |
| **Authentication & Timing** | `AGENTS.md`, `MICROVM_ARCHITECTURE.md` | Timing safe comparison (`timingSafeEqual` / `ConstantTimeEq`). Rejection: `tonic::Status::unauthenticated`. |
| **Network Isolation** | `ORIGINAL_REQUEST.md §R3`, `AGENTS.md` | Bridge: `172.16.x.0/24`. Host: `172.16.x.1`. Guest: `172.16.x.2`. No MASQUERADE. No WAN forward. |
| **MicroVM OverlayFS** | `docs/MICROVM_ARCHITECTURE.md §2` | Mount: `lowerdir=<golden>,upperdir=<inst/upper>,workdir=<inst/work>`. Golden layer is strictly read-only. |
| **Cgroups v2 Domains** | `docs/MICROVM_ARCHITECTURE.md §3` | `interactive` (weight 800) vs `agent` (weight 100). 8x weight ratio guarantee. |
| **Window Router** | `cloud/microvm/scripts/sand-window-router.mjs` | Display 1 -> port 1337; Display $N$ -> port $14000 + N$. Constant-time token on ALL displays. |
| **AWS CloudFormation** | `deploy/aws/cloudformation.yaml` | Port 50051 NLB listener, HTTP/2 gRPC target group, ECS Fargate service, Security Groups. |

---

## 6. Escalation Matrix for Implementation Bugs

When an opaque-box test detects a divergence between actual code and the authoritative specification, it is logged and escalated to the responsible implementing milestone:

| Defect Signature | Affected Component | Responsible Milestone | Action |
|------------------|--------------------|-----------------------|--------|
| Unauthenticated stream accepted | `cloud/gateway/src/service.rs` | Milestone 1 (F2) | Escalate to M1 implementer |
| Script CRLF line endings | Shell scripts (`.sh`) | Milestone 2 (F12) | Escalate to M2 implementer |
| Display 1 token bypass | `sand-window-router.mjs` | Milestone 2 (F8) | Escalate to M2 implementer |
| NAT MASQUERADE present on TAP | `cloud/microvm/host-setup.sh` | Milestone 3 (F13) | Escalate to M3 implementer |
| Missing `sand-exit-watch` | `cloud/microvm/scripts/` | Milestone 2 (F11) | Escalate to M2 implementer |
