# Project: Frostfire Cloud Control Plane & MicroVM Virtualization Infrastructure

## Architecture
Frostfire Cloud provides an outbound-only cloud edge ingress gateway, AWS bare-metal/ECS virtualization infrastructure, and an autonomous microVM sandbox environment reverse-engineered from GrokBot / Cursor Sand.

### High-Level Topology
1. **Edge Ingress Gateway (`frostfire-gateway`)**:
   - Outbound-only reverse-tunnel gRPC/TLS 1.3 service (`AgentTunnelService.OpenTunnel`).
   - Constant-time tenant authentication (`subtle::ConstantTimeEq` on `authorization` / `x-sand-window-owner`).
   - Bidirectional multiplexing of 17 frame types (PTY terminal, VNC display takeover, atomic patch application, MCP tool invocations, HITL approvals, inverted WebAuthn passkey ceremonies, teach sessions, and swarm turns).
   - Session registry with atomic channel swaps and reconnect recovery.

2. **Autonomous MicroVM Virtualization Infrastructure (GrokBot / Cursor Sand)**:
   - OverlayFS Copy-on-Write root filesystem: read-only golden base (`lowerdir`) with sparse ext4 (`upperdir` + `workdir`) allowing sub-5ms branching.
   - Cgroups v2 dual-domain partitioning: `/sys/fs/cgroup/interactive` (`cpu.weight=800`) for X11, window manager, compositor, dock, VNC, and websockify; `/sys/fs/cgroup/agent` (`cpu.weight=100`) for agent daemon, compilers, and test runners.
   - Multi-display routing (`sand-window-router.mjs` on port 1339): constant-time token validation on ALL displays; WebSocket upgrade handling for PTY and VNC connections.
   - Websockify (port 6081) token-based RFB port multiplexing.
   - Multi-monitor Chrome shared session linking (`link-chrome-session.sh`): separate profile directories with symlinked SQLite session databases (`Cookies`, `Login Data`, `Login Data For Account`).
   - Live CDP cookie synchronization (`cdp-cookies.mjs`): syncing session cookies across CDP ports.
   - In-VM daemon supervisor (`sand-exit-watch`): Python subreaper (`PR_SET_CHILD_SUBREAPER`), zombie reaping, signal logging, and crash-loop backoff.

3. **AWS Production Infrastructure & Network Isolation**:
   - Hardware KVM hypervisors on `c5.metal` / `c6i.metal` / `i3en.metal` via CloudFormation.
   - Gateway ECS Fargate tasks behind an AWS Network Load Balancer (NLB) for gRPC HTTP/2 traffic.
   - Strict network isolation: point-to-point TAP topology (`172.16.x.0/24` bridge); guest microVMs have NO direct internet access (no NAT masquerade); all external traffic routes through the outbound reverse-tunnel gateway.
   - Turnkey automation scripts (`scripts/cloud-start.ps1`, `scripts/setup-cluster.sh`).

4. **Containerized Lambda MicroVM Runtime (F17)**:
   - Native AWS Firecracker microVM execution per user/invocation.
   - AWS Lambda Web Adapter (`AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap`) enabling continuous response streaming (`RESPONSE_STREAM`).
   - `Dockerfile.lambda` container image definition for the Lambda microVM runtime.
   - CloudFormation template `deploy/aws/lambda-microvm.yaml` provisioning containerized Lambda functions with streaming Function URLs and IAM policies.

5. **Verification & Testing Track**:
   - Independent opaque-box test suite (Tiers 1-4) derived from user specifications.
   - End-to-end integration test harness validating client tunnel handshake, constant-time token verification, microVM task dispatch, PTY/VNC streaming, and clean teardown.
   - White-box adversarial hardening (Tier 5).

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Outbound Reverse Gateway | Harden `frostfire-gateway` gRPC service implementing `AgentTunnelService.OpenTunnel` with TLS 1.3 | M1 | ORIGINAL_REQUEST §R1, tunnel.proto |
| F2 | Constant-Time Tenant Auth | Enforce constant-time token validation (`subtle::ConstantTimeEq`) in `frostfire-gateway` | M1 | ORIGINAL_REQUEST §R1, §Acceptance |
| F3 | Multiplexed Frame Streaming | Support 17 bidirectional frame payloads over `OpenTunnel` (PTY, VNC, Patch, MCP, etc.) | M1 | ORIGINAL_REQUEST §R1, spec_miner_2 |
| F4 | Gateway Resilience & Recovery | Exponential backoff reconnect, pending frame buffering, and heartbeat keepalive | M1 | ORIGINAL_REQUEST §R1, client.rs |
| F5 | Workspace Manifest Fix | Integrate `crates/frostfire-cli` into `workspace.members` ensuring clean compilation | M1 | explorer_survey_3 |
| F6 | OverlayFS CoW Branching | Implement Copy-on-Write microVM branching with lowerdir golden base and upperdir overlay | M2 | ORIGINAL_REQUEST §R2, MICROVM_ARCHITECTURE.md |
| F7 | Cgroups v2 Partitioning | Implement `box-cgroups.sh` with `interactive` (800) and `agent` (100) scheduling domains | M2 | ORIGINAL_REQUEST §R2, MICROVM_ARCHITECTURE.md |
| F8 | Multi-Display Window Router | Harden `sand-window-router.mjs`: enforce token on all displays, add WebSocket upgrade | M2 | ORIGINAL_REQUEST §R2, MICROVM_ARCHITECTURE.md |
| F9 | Chrome Session Linking | Multi-monitor Chrome shared session linking via SQLite symlinks (`link-chrome-session.sh`) | M2 | ORIGINAL_REQUEST §R2, MICROVM_ARCHITECTURE.md |
| F10 | Live CDP Cookie Sync | Implement cookie synchronization daemon across CDP debug ports in `cdp-cookies.mjs` | M2 | ORIGINAL_REQUEST §R2, MICROVM_ARCHITECTURE.md |
| F11 | In-VM Daemon Supervision | Implement `sand-exit-watch` subreaper with zombie reaping, crash-loop prevention | M2 | ORIGINAL_REQUEST §R2, MICROVM_ARCHITECTURE.md |
| F12 | Script Line Ending Normalization | Convert CRLF to LF across all shell scripts; ensure `bash -n` validation passes | M2 | explorer_survey_3 |
| F13 | Isolated Network Bridge | Enforce `172.16.x.0/24` isolation: remove NAT masquerade and internet forwarding for TAPs | M3 | ORIGINAL_REQUEST §R3, §Acceptance, AGENTS.md |
| F14 | Turnkey Deployment Scripts | Refactor `scripts/cloud-start.ps1` and `setup-cluster.sh` to remove hardcoded IDs and legacy stubs | M3 | ORIGINAL_REQUEST §R3, explorer_survey_3 |
| F15 | CloudFormation Validation | Ensure CloudFormation templates (`cloudformation.yaml`, `firecracker-hypervisor.yaml`, `poc-3user.yaml`) validate | M3 | ORIGINAL_REQUEST §R3, §Acceptance |
| F16 | End-to-End Integration Suite | Automated verification harness: client tunnel handshake, token check, microVM task, teardown | M4 | ORIGINAL_REQUEST §R4, §Acceptance |
| F17 | Lambda Containerized MicroVM | AWS Lambda containerized microVM per user with Lambda Web Adapter streaming & CloudFormation deployment template | M3.5 | ORIGINAL_REQUEST §Follow-up |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Cloud Gateway Hardening & Tenant Auth | F1, F2, F3, F4, F5 | none | DONE |
| M2 | MicroVM Virtualization Architecture | F6, F7, F8, F9, F10, F11, F12 | none | DONE |
| M3 | AWS Production Infra & Network Isolation | F13, F14, F15 | none | DONE |
| M3.5 | AWS Lambda Containerized MicroVM Runtime | F17 | M1, M2, M3 | DONE |
| M4 | Final Milestone: E2E Integration & Verification | F16 (Pass 100% E2E tests + Tier 5 Hardening) | M1, M2, M3, M3.5, TEST_READY.md | PLANNED |

---

## Interface Contracts

### Client / Ingress Gateway Contract (`frostfire-proto` / `frostfire-tunnel` / `frostfire-gateway`)
- **Protocol**: gRPC over HTTP/2 with TLS 1.3.
- **Service**: `AgentTunnelService.OpenTunnel(stream TunnelClientFrame) returns (stream TunnelServerFrame)`
- **Headers**:
  - `authorization: Bearer <tenant-token>` OR `x-sand-window-owner: <tenant-token>`
  - `x-agent-id: <agent-uuid>`
- **Authentication**: Constant-time token verification using `subtle::ConstantTimeEq`. If header is missing or token does not match configured tenant token, gateway immediately aborts the stream with `tonic::Status::unauthenticated("invalid or missing tenant token")`.
- **Multiplexing**: Symmetric 17-frame payload union (`Heartbeat`, `ExecCommand`, `TerminalInputChunk`, `ApplyPatch`, `McpInvokeRequest`, `ApprovalResponse`, `ApprovalRequest`, `TerminalOutputChunk`, `PatchResult`, `McpInvokeResponse`, `error_frame`, `AgentMessage`, `WebAuthnCeremonyRequest`, `WebAuthnCeremonyResponse`, `DisplayTakeoverEvent`, `TeachSessionCommand`, `TeachSessionResponse`, `UserPrompt`).

### Window Router & Display Contract (`sand-window-router.mjs`)
- **Port**: 1339.
- **Headers**: `x-sand-display: <number>`, `x-sand-window-owner: <token>`.
- **Validation**: Constant-time `crypto.timingSafeEqual` against `/tmp/sand-window-tokens.d/<display>`. Required for ALL displays (including display 1).
- **Target Routing**: Display 1 -> port 1337; Display $N$ ($N \ge 2$) -> port $14000 + N$.
- **WebSocket Upgrade**: Forward `Upgrade: websocket` requests to target backend without terminating connection.

### MicroVM Host & Guest Isolation Contract
- **Bridge Network**: `172.16.x.0/24`. Host IP: `172.16.x.1/24`, Guest IP: `172.16.x.2/24`.
- **Firewall Invariant**: Forwarding of guest TAP packets to public WAN interface is FORBIDDEN. No `iptables -t nat -A POSTROUTING -o <WAN> -j MASQUERADE` for TAP subnets. MicroVM guest egress is strictly outbound-only via the reverse tunnel to `frostfire-gateway`.

### AWS Lambda Containerized MicroVM Contract
- **Isolation Mechanism**: AWS Lambda native microVM isolation per user invocation.
- **Streaming Adapter**: AWS Lambda Web Adapter (`public.ecr.aws/awsgsl/aws-lambda-adapter:0.9.0` or `/opt/bootstrap`) enabling continuous response streaming (`RESPONSE_STREAM`).
- **Endpoint Delivery**: AWS Lambda Function URL configured with `InvokeMode: RESPONSE_STREAM` and `AuthType: NONE` (token authentication delegated to `frostfire-gateway` via constant-time token checks).
- **Containerization**: `Dockerfile.lambda` packaging compiled `frostfire-gateway`, web adapter, and runtime assets.
- **Infrastructure as Code**: `deploy/aws/lambda-microvm.yaml` CloudFormation template.

---

## Code Layout

- `crates/frostfire-proto`: Protobuf schemas and generated gRPC traits.
- `crates/frostfire-tunnel`: Client reverse-tunnel implementation with exponential backoff and frame buffering.
- `crates/frostfire-gateway` (under `cloud/gateway`): Edge ingress gateway service, session registry, tenant authentication.
- `crates/frostfire-daemon`: In-VM agent execution daemon and cgroup auto-migration.
- `crates/frostfire-cli`: Command-line management tool.
- `cloud/microvm/`: MicroVM runtime scripts:
  - `run-vm.sh`: Firecracker VM launcher with OverlayFS CoW branching.
  - `build-rootfs.sh`: Rootfs build script.
  - `host-setup.sh`: Host network and tap configuration with strict isolation.
  - `scripts/sand-exit-watch`: In-VM supervisor and crash-loop watcher.
  - `scripts/box-cgroups.sh`: Cgroup v2 partitioning script.
  - `scripts/sand-window-router.mjs`: Multi-display reverse proxy with constant-time token check.
  - `scripts/link-chrome-session.sh`: Chrome multi-display session linker.
  - `scripts/cdp-cookies.mjs`: Live CDP cookie synchronizer.
  - `scripts/start-desktop.sh`: In-VM desktop initialization.
- `deploy/aws/`: CloudFormation templates (`cloudformation.yaml`, `firecracker-hypervisor.yaml`, `poc-3user.yaml`, `lambda-microvm.yaml`).
- `Dockerfile.lambda`: Containerfile packaging the AWS Lambda microVM runtime with AWS Lambda Web Adapter.
- `scripts/`: Host and cluster orchestration scripts (`cloud-start.ps1`, `setup-cluster.sh`).
- `tests/e2e/`: Automated end-to-end integration and verification suite.
