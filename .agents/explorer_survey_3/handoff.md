# Handoff Report: Codebase State, AWS Infra & Build Baseline

**Author**: `explorer_survey_3` (Teamwork Codebase Explorer)  
**Recipient**: `parent` (`a683d2a2-4cae-4a3a-a587-8741f091dc4b`)  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_3`  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

Direct observations made during codebase inspection:

### 1.1 Compilation & Test Baseline
* **Command**: `cargo check --workspace`  
  **Result**: Exited 0 in 0.32s. Output: `Finished dev profile [unoptimized + debuginfo] target(s) in 0.32s`.
* **Command**: `cargo test --workspace`  
  **Result**: Exited 0. All 58 tests across 11 workspace packages passed with 0 failures, 0 warnings.
* **Command**: `cargo clippy --workspace -- -D warnings`  
  **Result**: Exited 0 in 5.55s with 0 warnings.

### 1.2 Orphan Crate (`crates/frostfire-cli`)
* **File**: `crates/frostfire-cli/Cargo.toml` lines 1–6:
  ```toml
  [package]
  name = "frostfire-cli"
  version.workspace = true
  edition.workspace = true
  authors.workspace = true
  license.workspace = true
  ```
* **File**: Root `Cargo.toml` lines 3–15 (`workspace.members`):
  Does not include `"crates/frostfire-cli"`, nor is it in `workspace.exclude`.
* **Command**: `cargo check --manifest-path crates/frostfire-cli/Cargo.toml`  
  **Result**: Exited 1 with verbatim error:
  ```text
  error: current package believes it's in a workspace when it's not:
  current:   C:\Users\tyson\.repo\personal\frostfire-cloud\crates\frostfire-cli\Cargo.toml
  workspace: C:\Users\tyson\.repo\personal\frostfire-cloud\Cargo.toml

  this may be fixable by adding `crates\frostfire-cli` to the `workspace.members` array of the manifest located at: C:\Users\tyson\.repo\personal\frostfire-cloud\Cargo.toml
  ```

### 1.3 MicroVM Network Invariant Violation (Direct Public Egress)
* **File**: `cloud/microvm/host-setup.sh` lines 50–60:
  ```bash
  # NAT MASQUERADE for outbound internet traffic
  sudo iptables -t nat -C POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE 2>/dev/null || \
    sudo iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE

  sudo iptables -C FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
    sudo iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

  for TAP in tap0 tap1 tap2; do
    sudo iptables -C FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT 2>/dev/null || \
      sudo iptables -A FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT
  done
  ```
* **File**: `deploy/aws/firecracker-hypervisor.yaml` line 268:
  ```bash
  iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE || true
  ```
* **Contrast with `AGENTS.md` Line 15**:
  ```text
  - **MicroVM Isolation**: MicroVM instances run on isolated bridge networks (`172.16.x.0/24`). Never bridge unauthenticated guest networks to the public internet.
  ```

### 1.4 Tenant Authorization & Constant-Time Validation
* **File**: `cloud/gateway/src/service.rs` lines 44–75:
  `open_tunnel` receives `request.metadata().get("x-agent-id")`, but does not inspect or validate any authorization token or tenant header.
* **Grep**: `grep_search` for `ConstantTimeEq` across the entire workspace returned 0 hits in code (only matched `ORIGINAL_REQUEST.md`). The `subtle` crate is not listed in `Cargo.lock` or any `Cargo.toml`.
* **File**: `cloud/microvm/scripts/sand-window-router.mjs` lines 39–41:
  ```javascript
  const display = parseDisplayNumber(displayHeader);
  if (display <= 1) return { port: primaryPort };
  ```
  Display <= 1 bypasses `lookupBoundToken` and `tokensMatch` checks entirely.

### 1.5 Script Syntax & CRLF Errors
* **Command**: `bash -n cloud/microvm/run-vm.sh` and `bash -n cloud/microvm/scripts/start-desktop.sh`  
  **Result**: Exited with syntax errors:
  ```text
  cloud/microvm/run-vm.sh: line 25: syntax error near unexpected token `$'do\r''
  cloud/microvm/run-vm.sh: line 25: `for _ in {1..20}; do'
  cloud/microvm/scripts/start-desktop.sh: line 25: syntax error near unexpected token `$'{\r''
  cloud/microvm/scripts/start-desktop.sh: line 25: `spawn_agent_display() {'
  ```
* **Line ending inspection**: PowerShell check confirmed `cloud\microvm\build-rootfs.sh`, `cloud\microvm\run-vm.sh`, `cloud\microvm\scripts\start-desktop.sh`, `deploy\gcp\deploy-cloudrun.sh`, `deploy\proxmox\deploy-lxc.sh`, and `scripts\gcp-setup-wizard.sh` have `HasCRLF = True`.

### 1.6 Missing Modules from GrokBot/Sand Architecture Spec
* **`sand-exit-watch`**: `find_by_name` found 0 matches in the repository. Grep confirmed it is referenced in `ORIGINAL_REQUEST.md` (line 25), `docs/MICROVM_ARCHITECTURE.md` (line 43), and `crates/frostfire-daemon/src/config.rs` (line 192), but the file does not exist.
* **`box-cgroups.sh`**: `find_by_name` found 0 matches. Neither `start-desktop.sh` nor `host-setup.sh` configures cgroup v2 hierarchies (`/sys/fs/cgroup/interactive` or `/sys/fs/cgroup/agent`).
* **OverlayFS CoW Branching**: `cloud/microvm/run-vm.sh` (lines 51–56) attaches a single ext4 file as `drives/rootfs` with `is_read_only: false`, lacking `overlayfs` layering (`lowerdir`/`upperdir`).
* **`cdp-cookies.mjs`**: Lines 43–48 contain an empty loop without extracting or setting cookies.

### 1.7 AWS CloudFormation Template Validation
* **Command**: `aws cloudformation validate-template --template-body file://deploy/aws/cloudformation.yaml`  
  **Result**: Exited 0 (Valid template: ECS Fargate + NLB on port 50051).
* **Command**: `aws cloudformation validate-template --template-body file://deploy/aws/firecracker-hypervisor.yaml`  
  **Result**: Exited 0 (Valid template: Bare-metal hypervisor + KVS WebRTC STUN/TURN).
* **Command**: `aws cloudformation validate-template --template-body file://deploy/aws/poc-3user.yaml`  
  **Result**: Exited 0 (Valid template: 3-user host POC).

### 1.8 Script Hardcoding & Legacy Workaround
* **Files**: `scripts/cloud-start.ps1`, `cloud-status.ps1`, `cloud-stop.ps1`:
  Line 3 parameter: `[string]$InstanceId = "i-00970c561f6cdf7b0"` hardcoded.
* **File**: `scripts/setup-cluster.sh`:
  Lines 213–221 run `docker run` instead of Firecracker, and lines 227–302 run a Python HTTP server on port 3000 instead of `frostfire-gateway`.

---

## 2. Logic Chain

1. **Workspace Compilation & Test Baseline**:
   - Observations 1.1 demonstrate that the core Rust crates (`frostfire-proto`, `frostfire-tunnel`, `frostfire-exec`, `frostfire-security`, `frostfire-mcp`, `frostfire-daemon`, `frostfire-core`, `frostfire-engine`, `swarm-orchestrator`, `cloud/gateway`, `cloud/agent`) form a stable, compiling baseline with zero test failures and zero clippy warnings.
   - However, Observation 1.2 proves that `crates/frostfire-cli` was left unintegrated into the Cargo workspace. Because it inherits workspace versioning, any build command targeting it directly fails. It must either be added to `workspace.members` or explicitly excluded via `workspace.exclude`.

2. **Security Invariant Violations**:
   - The project invariant in `AGENTS.md` and R3 in `ORIGINAL_REQUEST.md` mandate that microVMs execute on isolated bridge networks (`172.16.x.0/24`) without direct public internet access.
   - Observation 1.3 reveals that `host-setup.sh` and `firecracker-hypervisor.yaml` UserData explicitly enable `sysctl net.ipv4.ip_forward=1` and execute `iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE` for TAP interfaces. This creates an open egress route to the public internet, directly violating the microVM isolation invariant.
   - Observation 1.4 reveals that `frostfire-gateway` accepts connections without authenticating client requests, and `subtle::ConstantTimeEq` is not present in the workspace. In addition, `sand-window-router.mjs` allows unauthenticated access to display 1. Therefore, Acceptance Criterion "All display and session routes enforce tenant token checks with constant-time comparison" currently fails.

3. **MicroVM Architecture Completeness**:
   - R2 requires operationalizing the Firecracker/KVM microVM environment reverse-engineered from GrokBot (OverlayFS CoW branching, cgroup v2 scheduling domains, multi-display routing, Chrome session linking, and in-VM daemon supervision via `sand-exit-watch`).
   - Observations 1.5 and 1.6 prove that:
     a) Key shell scripts fail bash syntax checks due to Windows CRLF line endings.
     b) `sand-exit-watch` and `box-cgroups.sh` do not exist.
     c) Root filesystem CoW branching is not implemented in `run-vm.sh`.
     d) `cdp-cookies.mjs` cookie synchronization is stubbed.
   - Therefore, R2 is only partially implemented and cannot be deployed in its current state without remediation.

4. **Deployment Automation & Verification**:
   - While CloudFormation templates validate cleanly (Observation 1.7), deployment scripts are hampered by hardcoded AWS IDs and legacy Docker workarounds (Observation 1.8).
   - Furthermore, R4 (automated verification harness connecting client -> gateway -> microVM agent -> PTY/VNC streaming -> teardown) is not implemented in the current test suite.

---

## 3. Caveats

1. **No Live AWS Deployment Tested**: Validation of CloudFormation templates was performed via syntax and schema checking using `aws cloudformation validate-template`. Real resource provisioning (`c6i.metal` bare-metal host, ECS Fargate cluster, Kinesis Video WebRTC channel) was not executed in live AWS to prevent unbudgeted cloud infrastructure spend.
2. **KVM Virtualization Testing**: The current development environment is Windows 11 AMD64 without nested KVM `/dev/kvm` hardware access. Linux-specific KVM execution and Firecracker jailer runtime were inspected through script logic and code analysis rather than live hypervisor invocation.
3. **Desktop Client Repository Boundary**: `crates/frostfire-tunnel` in `c:\Users\tyson\.repo\personal\frostfire` is the client-side counterpart in the desktop app. Analysis in this report was restricted to `c:\Users\tyson\.repo\personal\frostfire-cloud`.

---

## 4. Conclusion

The `frostfire-cloud` repository contains a well-structured, compiling Rust workspace with 58 passing unit and integration tests and zero clippy warnings. However, the repository has several blockers preventing production readiness:

1. **Security Invariant Non-Compliance**: Open NAT masquerading in `host-setup.sh` and lack of constant-time tenant token validation in `frostfire-gateway` and `sand-window-router.mjs` violate core isolation invariants.
2. **Script Syntax Failure**: CRLF line endings on microVM scripts (`run-vm.sh`, `start-desktop.sh`, `build-rootfs.sh`) prevent them from executing under Linux bash.
3. **Missing Architecture Artifacts**: `sand-exit-watch`, `box-cgroups.sh`, OverlayFS CoW rootfs branching, and live CDP cookie synchronization are missing or stubbed.
4. **Missing Verification Harness (R4)**: An end-to-end integration test proving client tunnel handshake, tenant token gating, microVM dispatch, and teardown has not yet been implemented.

---

## 5. Verification Method

To independently verify these findings, run the following commands in pwsh from `c:\Users\tyson\.repo\personal\frostfire-cloud`:

```powershell
# 1. Verify Rust workspace compilation and test suite (Passes: 58 tests)
cargo test --workspace
cargo clippy --workspace -- -D warnings

# 2. Verify orphan crate build failure (Fails with workspace manifest error)
cargo check --manifest-path crates/frostfire-cli/Cargo.toml

# 3. Verify CloudFormation template validity (Passes: AWS CLI schema check)
aws cloudformation validate-template --template-body file://deploy/aws/cloudformation.yaml
aws cloudformation validate-template --template-body file://deploy/aws/firecracker-hypervisor.yaml
aws cloudformation validate-template --template-body file://deploy/aws/poc-3user.yaml

# 4. Verify script CRLF syntax failures (Fails: syntax errors in bash)
bash -n cloud/microvm/run-vm.sh
bash -n cloud/microvm/scripts/start-desktop.sh

# 5. Verify security invariant violation (Inspect NAT masquerade rule)
grep -n "MASQUERADE" cloud/microvm/host-setup.sh deploy/aws/firecracker-hypervisor.yaml

# 6. Verify missing sand-exit-watch script
Get-ChildItem -Recurse -Filter "*sand-exit-watch*"
```

**Invalidation Conditions**:
- If `cargo test --workspace` fails or generates compiler warnings, this baseline report is invalidated.
- If `bash -n cloud/microvm/run-vm.sh` exits 0 without error, line endings have been corrected.
- If `cloud/microvm/host-setup.sh` has MASQUERADE rules removed and TAP interfaces isolated from public routing, the security invariant violation is resolved.
