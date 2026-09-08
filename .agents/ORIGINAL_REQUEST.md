# Original User Request

## Initial Request — 2026-09-08T20:28:57Z

Build a production-ready cloud control plane, edge ingress gateway, and autonomous microVM virtualization infrastructure on AWS for the Frostfire autonomous agent solution, reverse-engineering the GrokBot / Cursor Sand microVM architecture to support multi-tenant KVM execution, display multiplexing, and secure outbound reverse-tunnel ingress for the Frostfire Tauri desktop application.

Working directory: c:\Users\tyson\.repo\personal\frostfire-cloud (branch: production)
Integrity mode: development

Reference Materials:
- GrokBot / Sand Architecture specification: `c:\Users\tyson\.repo\personal\frostfire-cloud\docs\MICROVM_ARCHITECTURE.md`
- Frostfire desktop application & client tunnel: `c:\Users\tyson\.repo\personal\frostfire` (specifically `crates/frostfire-tunnel`)

## Requirements

### R1. Production Cloud Ingress & Reverse-Tunnel Gateway
Harden and operationalize the outbound-only gRPC/TLS 1.3 edge gateway (`frostfire-gateway`) to terminate client connections from the Frostfire Tauri desktop application (`AgentTunnelService.OpenTunnel`). The gateway must support bidirectional streaming, session multiplexing, connection recovery, and constant-time tenant token validation (`timingSafeEqual`).

### R2. Autonomous MicroVM Virtualization Infrastructure (GrokBot / Sand Architecture)
Operationalize the Firecracker / KVM microVM environment reverse-engineered from GrokBot:
- OverlayFS root filesystem with Copy-on-Write microVM branching.
- Cgroup v2 scheduling domains partitioning high-priority display/window manager processes (`interactive`) from agent compilation/execution workloads (`agent`).
- Multi-display X11/VNC routing (`sand-window-router.mjs`) on port 1339, websockify token routing, and noVNC stream delivery.
- Multi-monitor Chrome shared session linking (`link-chrome-session.sh`) for isolated per-display browser sessions.
- In-VM agent daemon supervision and crash-loop monitoring (`sand-exit-watch`).

### R3. AWS Production Infrastructure & Deployment Automation
Provide complete production deployment automation for AWS:
- CloudFormation templates for EC2 bare-metal hypervisor instances (`c5.metal` or `i3en.metal`) enabling hardware KVM virtualization.
- ECS Fargate service definitions paired with a Network Load Balancer (NLB) for high-throughput HTTP/2 gRPC traffic to the gateway.
- Isolated point-to-point network tap topology (`172.16.x.0/24` bridge) preventing unauthenticated guest microVMs from accessing external networks directly.
- Host and cluster setup scripts (`scripts/cloud-start.ps1`, `scripts/setup-cluster.sh`) ensuring idempotent, turnkey deployment.

### R4. End-to-End Integration & Verification Suite
Provide an automated verification harness simulating a Frostfire Tauri client connecting to the cloud gateway, dispatching agent tasks to an isolated microVM instance, streaming PTY/VNC frames, and performing clean resource teardown.

## Acceptance Criteria

### Security & Invariant Enforcement
- [ ] All display and session routes enforce tenant token checks with constant-time comparison (`timingSafeEqual` / `subtle::ConstantTimeEq`).
- [ ] MicroVM network bridges strictly enforce isolated subnets (`172.16.x.0/24`) without unauthorized direct public egress.
- [ ] Zero secrets, private keys, or cloud credentials committed to git.

### Code Quality & Workspace Gates
- [ ] `cargo test --workspace` passes with 0 failures and 0 warnings.
- [ ] `cargo clippy --workspace -- -D warnings` completes with 0 warnings.

### Infrastructure & Deployment Verification
- [ ] CloudFormation templates validate without errors (`aws cloudformation validate-template`).
- [ ] Integration test demonstrates end-to-end client tunnel handshake, session routing, and agent lifecycle execution.
- [ ] AWS Lambda containerized MicroVM template validates with response streaming and per-user isolation.

---

## User Directive Update — 2026-09-08T22:10:00Z
Focus on AWS Lambda with microVM per user:
- Architecture: Containerized Lambda MicroVM Runtime — package the agent runtime into an AWS Lambda container image (leveraging AWS Lambda's native Firecracker microVM per invocation/user with AWS Lambda Web Adapter for streaming).
- Deployment: AWS Lambda container function (`deploy/aws/lambda-microvm.yaml`) with response streaming, IAM tenant isolation, and VPC connectivity.
- Runtime: `cloud/agent/Dockerfile.lambda` with AWS Lambda Web Adapter.

## Follow-up — 2026-09-08T22:10:53Z

The user explicitly requested:
"we need to focus on AWS lambda with microVM per user"
Selected Architecture: Containerized Lambda MicroVM Runtime — package the agent runtime into an AWS Lambda container image (leveraging AWS Lambda's native Firecracker microVM per invocation/user with AWS Lambda Web Adapter for streaming).

Please incorporate this requirement into the architecture and project plan (F17: AWS Lambda Containerized MicroVM per user with Lambda Web Adapter streaming & CloudFormation deployment template).

## Follow-up — 2026-09-08T22:43:43Z

Resolve the 5 core cloud architecture questions for Frostfire by porting, implementing, and verifying the reverse-engineered GrokBot / Cursor Sand blueprints: Inverted WebAuthn Proxy, Multi-Screen Display Multiplexing, Ephemeral MicroVM State Persistence (AWS EFS / S3), Crash-Loop Defenses, and Tauri Client Ingress Handshake.

Working directory: c:\Users\tyson\.repo\personal\frostfire-cloud (branch: production)
Integrity mode: development

Reference Materials:
- GrokBot / Sand Architecture Specification: `c:\Users\tyson\.repo\personal\syntropy\docs\GROKBOT_MICROVM_ARCHITECTURE.md`
- GrokBot Inverted WebAuthn Extension: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\webauthn-proxy/`
- GrokBot Multi-Display & Crash Defenses: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm/`
- Frostfire Tauri Application: `c:\Users\tyson\.repo\personal\frostfire`

## Requirements

### R1. Inverted WebAuthn Proxy Bridge (GrokBot Parity)
Port and operationalize the Chrome MV3 `webAuthenticationProxy` extension and native messaging host into `cloud/microvm/webauthn-proxy/`. Wire the ceremony interceptor to route `WebAuthnCeremonyRequest` and `WebAuthnCeremonyResponse` over the gRPC reverse tunnel so that headless cloud Chrome sessions can authenticate with local hardware tokens (Windows Hello / Touch ID / YubiKey) without exposing private keys.

### R2. Ephemeral Lambda MicroVM State Persistence & Worktrees
Implement the persistence layer for AWS Lambda / microVM execution:
- Configure Amazon EFS mount (`/mnt/workspace`) in `deploy/aws/lambda-microvm.yaml` for persistent, zero-copy user state across ephemeral microVM invocations.
- Provide automated shadow worktree snapshotting and restore scripts (`scripts/sync-workspace-state.sh`).

### R3. Multi-Screen Display Multiplexer & Crash-Loop Defenses
Port GrokBot's production crash-loop prevention daemons (`box-xvfb`, `box-xfwm4`, `box-picom`, `box-plank`, `box-x11vnc`, and `box-bounded-log.mjs`) into `cloud/microvm/bin/` to guarantee clean display startup, stale lock file cleanup, and orphan process reaping across restarts.

### R4. Tauri Client Dynamic Ingress Integration
Implement the client-side configuration and handshake in `crates/frostfire-tunnel` and Tauri IPC bindings to enable seamless switching between local daemon mode and cloud Lambda microVM mode with pre-signed token authentication.

## Acceptance Criteria

### Security & Invariants
- [ ] Inverted WebAuthn proxy bridges ceremonies without writing raw credentials or private keys to cloud disk.
- [ ] Stale X11 locks (`/tmp/.X*-lock`) and dead RFB sockets are cleanly reaped on microVM boot.
- [ ] EFS volume integration preserves workspace files across simulated Lambda container recycling.

### Quality & Test Gates
- [ ] `cargo test --workspace` passes with 0 failures and 0 warnings.
- [ ] `cargo clippy --workspace -- -D warnings` completes with 0 warnings.
- [ ] Integration tests verify end-to-end WebAuthn ceremony frame roundtrip and multi-display routing.
