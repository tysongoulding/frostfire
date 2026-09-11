# Dispatch: Worker M1 (AWS Host Infrastructure & UserData)

**Identity**: `worker_m1` (Archetype: `teamwork_preview_worker`)
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1`
**Workspace Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud`

You MUST read the authoritative user request at:
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`

Also read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md` and the survey reports at:
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\survey_report.md`
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_1\survey_report.md`

### Write Ownership
You exclusively own:
- `deploy/aws/poc-host.yaml`
- `scripts/setup-host.sh`
- `scripts/check-idle-shutdown.sh`
- `scripts/deploy-poc.ps1`
- `scripts/deploy-poc.sh`

Do NOT touch files in `kernel/`, `rootfs/`, `crates/`, or `tests/`.

### Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

### Mission & Tasks
Implement, fix, and verify all components for R1:
1. **`deploy/aws/poc-host.yaml`**:
   - Verify EC2 Spot Nitro instance (`c6i.xlarge` / `c6a.xlarge`) with nested KVM (`/dev/kvm`), 50GB gp3 root volume (`DeleteOnTermination: false`).
   - Security Group exposing ports 22, 1339, 6080, 6081 restricted to `AllowedCidr`.
   - Complete UserData bootstrap: KVM permissions, IP forwarding (`net.ipv4.ip_forward=1`), package toolchains (`build-essential`, `debootstrap`, `debian-archive-keyring`, `qemu-utils`, `flex`, `bison`, `libelf-dev`, `iptables`, etc.), Firecracker v1.10.1, Node.js 20 LTS, Rust, and auto-idle cron.
2. **`scripts/check-idle-shutdown.sh`**:
   - Inspect active TCP sockets on ports 22 and 6080 using `ss -nt '( sport = :22 or sport = :6080 )'`.
   - Update `/tmp/frostfire_idle_counter`, shutdown after 20 mins inactivity (<$5/month spend guarantee).
3. **`scripts/setup-host.sh`**:
   - Standalone bootstrap ensuring `/dev/kvm`, IP forwarding, Firecracker v1.10.1, toolchains, and idle daemon.
4. **`scripts/deploy-poc.ps1` & `scripts/deploy-poc.sh`**:
   - Auto-detect public IP via `https://checkip.amazonaws.com` with fallback.
   - Handle EC2 KeyPair check/creation if missing in AWS account.
   - Validate CloudFormation template via AWS CLI and format stack outputs.
5. Validate template with `aws cloudformation validate-template`.

Write your completion report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1\handoff.md` and notify parent orchestrator via `send_message`.

## 2026-09-11T03:23:43Z
Initial dispatch received:
Implement and verify R1 (AWS Infrastructure & UserData):
1. Update deploy/aws/poc-host.yaml (KVM, ports 22, 1339, 6080, 6081, UserData bootstrap, debian-archive-keyring, Node 20, Rust, Firecracker v1.10.1, auto-idle).
2. Validate scripts/check-idle-shutdown.sh (monitor ports 22 and 6080, 20m shutdown).
3. Update scripts/setup-host.sh (standalone installer).
4. Update scripts/deploy-poc.ps1 and scripts/deploy-poc.sh (public IP auto-detect, EC2 KeyPair handling).
5. Validate template with AWS CLI.
