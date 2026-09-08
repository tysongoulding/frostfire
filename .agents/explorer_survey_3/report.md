# Codebase Survey & Infrastructure Baseline Report

**Repository**: `c:\Users\tyson\.repo\personal\frostfire-cloud`  
**Branch**: `production`  
**Date**: 2026-09-08  
**Investigator**: `explorer_survey_3` (Teamwork Codebase Explorer)  

---

## 1. Executive Summary

This investigation conducted a comprehensive survey of the `frostfire-cloud` repository against the requirements defined in `ORIGINAL_REQUEST.md` and the system invariants in `AGENTS.md`.

### Core Health Metrics
* **Cargo Workspace Compilation**: Clean. `cargo check --workspace` completed in 0.32s with 0 errors.
* **Unit & Integration Test Suite**: Passing. `cargo test --workspace` passed all 58 tests across 11 workspace members with 0 failures and 0 warnings.
* **Workspace Linter**: Clean. `cargo clippy --workspace -- -D warnings` completed with 0 warnings.
* **AWS CloudFormation Validation**: Passing. All 3 CloudFormation templates (`cloudformation.yaml`, `firecracker-hypervisor.yaml`, `poc-3user.yaml`) passed AWS CLI schema validation (`aws cloudformation validate-template`).
* **Secrets committed**: Clean. Zero AWS credentials, RSA/EC private keys, or API keys committed to git.

### Critical Deficiencies & Invariant Violations Identified
1. **Critical Security Invariant Violation — Guest NAT Masquerade**: `cloud/microvm/host-setup.sh` (lines 51–60) and `deploy/aws/firecracker-hypervisor.yaml` (line 268) explicitly configure `iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE` and forward all TAP traffic to the public internet. This directly violates the project invariant: *"Never bridge unauthenticated guest networks to the public internet"* and *"without unauthorized direct public egress"*.
2. **Missing Ingress Authentication & Constant-Time Validation**:
   - `frostfire-gateway` (`cloud/gateway/src/service.rs`) accepts incoming `OpenTunnel` streams without validating tenant tokens, authentication headers, or client credentials.
   - `subtle::ConstantTimeEq` is not imported or used anywhere in the Rust workspace (`subtle` is not in `Cargo.lock` or `Cargo.toml`).
   - `sand-window-router.mjs` bypasses token validation entirely for display 1 (`if (display <= 1) return { port: primaryPort };`).
   - No TLS 1.3 listener configuration is implemented in `frostfire-gateway` (binds raw TCP only).
3. **Script Line-Ending Syntax Errors (CRLF)**:
   - `cloud/microvm/run-vm.sh`, `cloud/microvm/build-rootfs.sh`, and `cloud/microvm/scripts/start-desktop.sh` have Windows CRLF (`\r\n`) line endings.
   - When run in bash, `run-vm.sh` and `start-desktop.sh` crash immediately with syntax errors: `syntax error near unexpected token $'do\r'` and `syntax error near unexpected token $'{\r'`.
4. **Missing MicroVM Architecture Modules**:
   - `sand-exit-watch` (in-VM python subreaper and crash-loop supervisor) is completely missing from the repository.
   - Cgroup v2 dual-slice partitioning (`box-cgroups.sh` with `/sys/fs/cgroup/interactive` and `/sys/fs/cgroup/agent` weight allocations) is missing.
   - OverlayFS Copy-on-Write microVM branching is not operationalized; `run-vm.sh` boots directly from a single ext4 disk image without CoW overlays.
   - `cdp-cookies.mjs` live cookie synchronization function `syncCookies()` is an empty stub.
5. **Orphan Crate in Workspace**:
   - `crates/frostfire-cli` has workspace-inherited fields (`version.workspace = true`), but is excluded from `[workspace.members]` in root `Cargo.toml`. Attempting to build `frostfire-cli` fails with Cargo error: `current package believes it's in a workspace when it's not`.
6. **Hardcoded Scripts & Legacy Divergence**:
   - `scripts/cloud-start.ps1`, `scripts/cloud-status.ps1`, and `scripts/cloud-stop.ps1` contain hardcoded instance ID `i-00970c561f6cdf7b0` in `us-west-2`.
   - `scripts/setup-cluster.sh` is a legacy Docker-based script using Python HTTP servers on port 3000 rather than Firecracker microVMs and the gRPC gateway.
7. **Missing End-to-End Verification Harness (R4)**:
   - There is no automated test simulating a Frostfire client connecting via reverse tunnel, dispatching agent tasks to an isolated microVM, streaming PTY/VNC frames, and verifying resource teardown.

---

## 2. Cargo Workspace & Crates Survey

### Root Manifest (`Cargo.toml`)
* **Resolver**: Version 2
* **Configured Members**:
  1. `crates/frostfire-proto`
  2. `crates/frostfire-tunnel`
  3. `crates/frostfire-exec`
  4. `crates/frostfire-security`
  5. `crates/frostfire-mcp`
  6. `crates/frostfire-daemon`
  7. `crates/frostfire-core`
  8. `crates/frostfire-engine`
  9. `services/swarm-orchestrator`
  10. `cloud/gateway`
  11. `cloud/agent`

### Per-Crate Architectural Breakdown

| Package / Crate | Type | Role & Capabilities | Test Status | Gaps & Issues |
| :--- | :--- | :--- | :--- | :--- |
| **`frostfire-proto`** | Library | Protocol Buffers contract (`tunnel.proto`). Defines `AgentTunnelService.OpenTunnel`, frames (`TunnelClientFrame`, `TunnelServerFrame`), multiplexed payloads (PTY, patches, WebAuthn, MCP, HITL). | 0 unit tests (code gen verified) | No token auth metadata field defined in proto messages (relies on HTTP headers). |
| **`frostfire-tunnel`** | Library | gRPC tunnel client (`TunnelClient`) and in-process mock server (`MockTunnelServer`). Implements exponential backoff reconnect, ping/pong heartbeats, and frame channels. | 4 tests pass (`tunnel_test.rs`) | Client supports `auth_token` in metadata, but gateway does not validate it. |
| **`frostfire-exec`** | Library | Execution engine: workspace jail containment (`WorkspaceJail`), unified diff applicator (`AtomicPatchApplicator`), PTY session multiplexer (`PtyMultiplexer`), semantic chunker, process inspector. | 23 tests pass | Linux cgroup process placement is passive; no direct cgroup v2 creation. |
| **`frostfire-security`** | Library | Security broker: credential persistence store (`CredentialPersistenceStore`), DPAPI/in-memory/file keystores, Merkle audit ledger (`MerkleAuditLedger`), WebAuthn ceremony signing. | 14 tests pass | No constant-time token comparison utility (`subtle::ConstantTimeEq` missing). |
| **`frostfire-mcp`** | Library | Model Context Protocol proxy: tool allowlist filtering, circuit breaker timeout, supervisor subprocess lifecycle. | 7 tests pass | Production MCP configurations need wiring with In-VM daemons. |
| **`frostfire-daemon`** | Library | In-VM agent daemon supervisor: listens for gateway instructions, applies patches, executes commands, reports terminal I/O. Places PID into `/sys/fs/cgroup/agent/cgroup.procs`. | Passes compilation & gateway test | Linux cgroup write fails gracefully if directory missing; no supervisor daemon (`sand-exit-watch`). |
| **`frostfire-core`** | Library | Core domain abstractions: Blackboard state store, sprint blueprint DAG execution, synthesis engine. | Passes all tests | Pure in-memory core. |
| **`frostfire-engine`** | Library | LLM reasoning engine: Gemini client adapter, prompt resolution, security egress/ingress canary filters, resilient failover chains. | 9 tests pass | Uses `dev_mock` for offline tests. |
| **`swarm-orchestrator`** | Binary & Lib | Orchestrator service: multi-agent turn engine, blackboard author isolation, SVG/Canvas DAG visualization renderer. | 6 tests pass | Fully functional mock turn reasoning. |
| **`frostfire-gateway`** | Binary & Lib | Edge Cloud Ingress Gateway: terminates `OpenTunnel` streams, routes frames between desktop clients and agent daemons, registers sessions. | 2 integration tests pass | **Major Gap**: No tenant token validation, no constant-time check, no TLS 1.3 termination, session reconnect does not replay buffered frames. |
| **`frostfire-agent`** | Binary | In-VM agent binary: connects outbound reverse tunnel to gateway, controls browser CDP, manages HITL pauses and teach session recording. | 2 tests pass | Reconnect loop functional; browser controller relies on local Chrome CDP ports 9222+. |
| **`frostfire-cli`** | Binary (Orphan) | Local CLI front end and browser stealth script generator. Excluded from root `Cargo.toml`. | **Compilation Error** | Not listed in `workspace.members` or `workspace.exclude`. Standalone build fails. |

---

## 3. Build, Clippy, and Test Baseline

### Build Verification
* Command: `cargo check --workspace`
* Exit code: `0`
* Output: `Finished dev profile [unoptimized + debuginfo] target(s) in 0.32s`

### Test Suite Execution
* Command: `cargo test --workspace`
* Exit code: `0`
* Summary of test runs:
  * `frostfire-core`: 0 unit tests, 4 test binaries (all pass)
  * `frostfire-daemon`: 0 unit tests (tested via gateway)
  * `frostfire-engine`: 9 integration tests pass (resilience, routing, security, tool filters)
  * `frostfire-exec`: 23 unit and integration tests pass (diff, jail, pty_mux, worktree, semantic_chunker, process_inspector)
  * `frostfire-gateway`: 2 integration tests pass (`service_communication_test.rs`)
  * `frostfire-mcp`: 7 unit tests pass (proxy, supervisor)
  * `frostfire-orchestrator`: 6 unit tests pass (blackboard, sprint phase gate, canvas renderer, turn engine)
  * `frostfire-proto`: 0 unit tests
  * `frostfire-security`: 14 unit tests pass (broker, keystore, ledger, credential_persistence)
  * `frostfire-tunnel`: 4 integration tests pass (`tunnel_test.rs`)
  * `frostfire-agent`: 2 tests pass (`agent_test.rs`)
  * Total: **58 passed; 0 failed; 0 ignored**

### Clippy Linter Verification
* Command: `cargo clippy --workspace -- -D warnings`
* Exit code: `0`
* Output: Completed in 5.55s with 0 warnings.

---

## 4. AWS Infrastructure & Deployment Automation Audit

### 1. CloudFormation Templates
* **`deploy/aws/cloudformation.yaml`**:
  - Validates cleanly via `aws cloudformation validate-template`.
  - Provisions VPC (10.0.0.0/16), 2 Public Subnets, Internet Gateway, Security Group, ECR Repository, ECS Fargate Cluster, CloudWatch LogGroup, IAM Execution Role, Network Load Balancer (NLB) with TCP listener on port 50051, and ECS Service running `frostfire-gateway`.
  - **Deficiency**: Configures unencrypted TCP on port 50051 rather than TLS termination. Output `GatewayEndpoint` is `http://${NLB.DNSName}:50051`.
* **`deploy/aws/firecracker-hypervisor.yaml`**:
  - Validates cleanly via `aws cloudformation validate-template`.
  - Provisions Bare-Metal EC2 hypervisor (`c6i.metal` default, allows `c5.metal`), 200GB gp3 SSD, Kinesis Video Streams Signaling Channel for managed WebRTC STUN/TURN, IAM role with SSM and KVS ICE permissions, and UserData cloud-init script.
  - UserData installs Firecracker v1.10.1, verifies `/dev/kvm`, and installs ICE server helper.
  - **Deficiency**: Line 268 sets up `iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE`, creating open public egress for microVMs.
* **`deploy/aws/poc-3user.yaml`**:
  - Validates cleanly via `aws cloudformation validate-template`.
  - Single EC2 instance (`t3.xlarge` recommended) deployment for lean 3-user testing.

### 2. MicroVM Host and Guest Scripts (`cloud/microvm/`)
* **`cloud/microvm/host-setup.sh`**:
  - Installs Firecracker v1.10.1 and jailer.
  - Sets up `tap0` (172.16.0.1/24), `tap1` (172.16.1.1/24), `tap2` (172.16.2.1/24).
  - **Violation**: Lines 50–60 install NAT MASQUERADE and forward all tap interfaces to the internet.
* **`cloud/microvm/run-vm.sh`**:
  - Starts Firecracker with Unix domain socket REST API, configures boot-source, rootfs drive, network interface, and machine config (4 vCPUs, 4096 MB RAM).
  - **Issue 1**: Windows CRLF line endings trigger syntax error at line 25 (`for _ in {1..20}; do\r`).
  - **Issue 2**: Boots directly from single ext4 drive in read-write mode without Copy-on-Write OverlayFS.
* **`cloud/microvm/build-rootfs.sh`**:
  - Compiles `Dockerfile.rootfs` and exports to sparse ext4 image.
  - **Issue**: CRLF line endings.
* **`cloud/microvm/scripts/start-desktop.sh`**:
  - Starts websockify token router (port 6081), displays :1, :2, :3 (Xvfb + x11vnc), `cdp-cookies.mjs`, and `sand-window-router.mjs`.
  - **Issue 1**: Windows CRLF line endings trigger syntax error at line 25 (`spawn_agent_display() {\r`).
  - **Issue 2**: Lacks cgroup v2 classification (`box-cgroups.sh`).
  - **Issue 3**: Spawns processes in the background with `&` without `sand-exit-watch` subreaper or crash-loop recovery.
* **`cloud/microvm/scripts/sand-window-router.mjs`**:
  - Node HTTP router on port 1339.
  - Uses `timingSafeEqual` for tokens on displays > 1.
  - **Issue 1**: Display <= 1 bypasses token check: `if (display <= 1) return { port: primaryPort };`.
  - **Issue 2**: No WebSocket `upgrade` handling implemented; only handles HTTP requests.
* **`cloud/microvm/scripts/link-chrome-session.sh`**:
  - Symlinks `Cookies`, `Login Data`, `Login Data For Account` across Chrome profiles. Clean LF endings.
* **`cloud/microvm/scripts/cdp-cookies.mjs`**:
  - Polling loop runs every 1500ms, but `syncCookies()` is an empty stub.
* **`cloud/microvm/scripts/patch-novnc.py`**:
  - Deploys pure minimal `desktop.html` and clipboard synchronization bridge into noVNC.
* **`cloud/microvm/scripts/teach-session-recorder.sh`**:
  - FFmpeg screen capture + xdotool telemetry logger. Clean LF endings.

### 3. Management Scripts (`scripts/`)
* **`scripts/cloud-start.ps1`, `cloud-status.ps1`, `cloud-stop.ps1`**:
  - Hardcoded EC2 instance ID `i-00970c561f6cdf7b0` in `us-west-2`. Not parameter-driven or linked to CloudFormation stack outputs.
* **`scripts/setup-cluster.sh`**:
  - Divergent legacy script: runs Docker containers and custom Python gateway/exec servers instead of Firecracker microVMs and the Rust `frostfire-gateway`.

---

## 5. Security & Invariant Audit

| Invariant / Security Policy | Status | Evidence / Observation | Remediations Needed |
| :--- | :--- | :--- | :--- |
| **Outbound-Only Ingress via Reverse Stream** | **PARTIAL** | Gateway implements tonic `open_tunnel` streaming; agents connect outbound. However, no TLS 1.3 configuration or encryption is enforced on the server. | Add rustls / `ServerTlsConfig` to `frostfire-gateway` server and configure certificates. |
| **MicroVM Subnet Isolation (`172.16.x.0/24`)** | **FAIL (VIOLATION)** | `cloud/microvm/host-setup.sh:51-60` and `deploy/aws/firecracker-hypervisor.yaml:268` actively configure `iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE` and forward tap packets to internet. | Remove MASQUERADE and public egress FORWARD rules. Route all agent traffic exclusively through the internal gateway reverse tunnel. |
| **Tenant Authorization via Constant-Time Token Check** | **FAIL (VIOLATION)** | 1. `frostfire-gateway` does not validate tenant tokens on `OpenTunnel`.<br>2. `sand-window-router.mjs:40` bypasses token validation for display <= 1.<br>3. `subtle::ConstantTimeEq` is not used in the Rust codebase. | 1. Add tenant token extraction and constant-time validation (`subtle::ConstantTimeEq`) in `GatewayTunnelService::open_tunnel`.<br>2. Require token validation for all displays in `sand-window-router.mjs`.<br>3. Add `subtle = "0.2"` to workspace dependencies. |
| **Zero Secrets in Git** | **PASS** | Grep searches for AWS keys (`AKIA...`), RSA/EC private keys (`BEGIN ... PRIVATE KEY`), and `.env` files returned zero matches. | Maintain existing pre-commit / CI hygiene. |

---

## 6. Gap Analysis Against ORIGINAL_REQUEST.md

| Requirement | Spec Item | Implementation Status | Detailed Findings & Gaps |
| :--- | :--- | :--- | :--- |
| **R1. Production Cloud Ingress & Reverse-Tunnel Gateway** | Outbound-only gRPC / TLS 1.3 edge gateway (`frostfire-gateway`) | **Partial** | Gateway runs gRPC `OpenTunnel`, but TLS 1.3 is not configured on the listener (runs raw HTTP/2 cleartext). |
| | Terminate client connections from Frostfire Tauri desktop app (`AgentTunnelService.OpenTunnel`) | **Implemented** | Contract matches proto in `crates/frostfire-proto`. Handshake works. |
| | Bidirectional streaming & session multiplexing | **Implemented** | Full frame multiplexing (PTY, Patch, MCP, Approval, Heartbeat, Prompt) implemented in `crates/frostfire-tunnel` and `cloud/gateway`. |
| | Connection recovery | **Partial** | Client has exponential backoff reconnect; gateway replaces session upon reconnect, but does not buffer frames for delivery during reconnect windows. |
| | Constant-time tenant token validation (`timingSafeEqual` / `subtle::ConstantTimeEq`) | **Missing** | Gateway does not validate tokens. `subtle` crate is not in workspace. |
| **R2. Autonomous MicroVM Virtualization (GrokBot/Sand)** | OverlayFS root filesystem with Copy-on-Write microVM branching | **Missing** | `run-vm.sh` attaches a single raw ext4 drive directly without OverlayFS `lowerdir`/`upperdir` CoW layers. |
| | Cgroup v2 scheduling domains (`interactive` vs `agent`) | **Missing** | `box-cgroups.sh` is missing. No CPU weights (`cpu.weight=800` vs `100`) or cgroup hierarchies are provisioned in host/guest scripts. |
| | Multi-display X11/VNC routing (`sand-window-router.mjs` on port 1339) | **Partial** | HTTP routing works for display > 1, but display <= 1 bypasses auth, and WebSocket `upgrade` proxying is not implemented. |
| | Websockify token routing & noVNC stream delivery | **Implemented** | `start-desktop.sh` configures websockify with `sand-novnc-tokens.txt`. |
| | Multi-monitor Chrome shared session linking (`link-chrome-session.sh`) | **Partial** | `link-chrome-session.sh` symlinks SQLite files, but `cdp-cookies.mjs` live cookie sync is an empty stub. |
| | In-VM agent daemon supervision & crash-loop monitoring (`sand-exit-watch`) | **Missing** | `sand-exit-watch` script does not exist in the codebase. |
| **R3. AWS Production Infrastructure & Automation** | CloudFormation for EC2 bare-metal hypervisor (`c5.metal` or `i3en.metal`) | **Implemented** | `deploy/aws/firecracker-hypervisor.yaml` includes `c5.metal`, `c6i.metal`, `c7i.metal`. Validates cleanly. |
| | ECS Fargate service definitions paired with NLB for gRPC | **Implemented** | `deploy/aws/cloudformation.yaml` provisions ECS Fargate + NLB + TCP/50051. Validates cleanly. |
| | Isolated point-to-point network tap topology (`172.16.x.0/24` bridge) without direct public egress | **Failed / Inverted** | TAP interfaces configured, but scripts actively install NAT MASQUERADE allowing direct unauthenticated public egress. |
| | Host and cluster setup scripts (`scripts/cloud-start.ps1`, `scripts/setup-cluster.sh`) | **Partial / Broken** | `cloud-start.ps1` has hardcoded instance ID. `setup-cluster.sh` uses Docker instead of Firecracker. MicroVM shell scripts have CRLF syntax errors. |
| **R4. End-to-End Integration Suite** | Verification harness simulating Tauri client connecting to gateway, dispatching agent tasks to microVM, streaming PTY/VNC, clean teardown | **Missing** | `service_communication_test.rs` tests local gateway <-> daemon command execution, but no full end-to-end client-to-microVM integration test exists. |

---

## 7. Actionable Recommendations & Implementation Roadmap

To achieve full compliance with `ORIGINAL_REQUEST.md` and satisfy all acceptance criteria, subsequent implementation agents should execute the following ordered plan:

### Step 1: Fix Formatting & Syntax Errors (Immediate Gate Unblocker)
1. Convert all shell scripts in `cloud/microvm/` and `scripts/` to LF line endings (`dos2unix` / `.replace("\r\n", "\n")`).
2. Verify with `bash -n` across all scripts to ensure zero syntax errors.
3. Either add `crates/frostfire-cli` to `workspace.members` in `Cargo.toml` or add it to `workspace.exclude` so that building `frostfire-cli` or running workspace tools is deterministic.

### Step 2: Enforce MicroVM Network Isolation (Security Invariant)
1. In `cloud/microvm/host-setup.sh` and `deploy/aws/firecracker-hypervisor.yaml`, remove all `iptables ... -j MASQUERADE` and internet forwarding rules for TAP devices.
2. Ensure guest microVMs (`172.16.x.0/24`) can only communicate with the host hypervisor IP (`172.16.x.1`) and cloud gateway, strictly preventing direct public egress.

### Step 3: Implement Gateway Tenant Authentication & TLS 1.3
1. Add `subtle = "2.6"` to `Cargo.toml` `workspace.dependencies`.
2. In `frostfire-gateway` (`cloud/gateway/src/service.rs`), extract `x-tenant-token` or `authorization` header from incoming gRPC `Request`.
3. Validate the token against configured tenant tokens using `subtle::ConstantTimeEq`. Reject unauthorized connections with `tonic::Status::unauthenticated`.
4. In `cloud/gateway/src/server.rs` and `main.rs`, add support for TLS 1.3 termination using `tonic::transport::ServerTlsConfig`.

### Step 4: Harden MicroVM Architecture Scripts
1. **Implement `sand-exit-watch`**: Create the Python subreaper script (`cloud/microvm/scripts/sand-exit-watch.py` or bash) to reap zombie processes, supervise background agent daemons, log crashes to a circular buffer, and restart failed workers.
2. **Implement `box-cgroups.sh`**: Create cgroup v2 domains `/sys/fs/cgroup/interactive` (`cpu.weight=800`) and `/sys/fs/cgroup/agent` (`cpu.weight=100`) and configure `start-desktop.sh` to classify desktop and agent processes into their respective slices.
3. **Operationalize OverlayFS CoW Branching**: Update `cloud/microvm/run-vm.sh` to configure rootfs branching using `overlayfs` with a read-only base image (`lowerdir`) and volatile ephemeral directory (`upperdir`).
4. **Harden `sand-window-router.mjs`**: Require valid `x-sand-window-owner` token check for display 1 (do not bypass when `display <= 1`). Add WebSocket `upgrade` proxy handler.
5. **Complete `cdp-cookies.mjs`**: Implement actual cookie synchronization via CDP `Network.getCookies` and `Network.setCookies`.

### Step 5: Parameterize Deployment Scripts
1. Update `scripts/cloud-start.ps1`, `scripts/cloud-status.ps1`, and `scripts/cloud-stop.ps1` to accept stack name or fetch instance ID dynamically from AWS CloudFormation (`aws cloudformation describe-stacks`).
2. Update or align `scripts/setup-cluster.sh` to execute the production Firecracker setup rather than the legacy Docker container workaround.

### Step 6: End-to-End Integration Test (R4)
1. Create `tests/e2e_cloud_microvm_test.rs` (or extend `cloud/gateway/tests/`) that:
   - Starts the `frostfire-gateway` with tenant token authentication.
   - Connects a simulated `frostfire-tunnel` client with valid and invalid tenant tokens (verifying constant-time rejection).
   - Simulates agent task dispatch, receives PTY output frames, and verifies clean session unregistration upon disconnect.
