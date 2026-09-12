# Dispatch: Worker M4 (Rust Firecracker Hypervisor Daemon & box-doctor)

**Identity**: `worker_m4` (Archetype: `teamwork_preview_worker`)
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m4`
**Workspace Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud`

You MUST read the authoritative user request at:
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`

Also read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md` and the survey reports at:
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\survey_report.md`
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_1\survey_report.md`

### Write Ownership
You exclusively own:
- `crates/frostfire-hypervisor/` (Cargo.toml, src/main.rs, any modules/tests)

Do NOT touch files in `deploy/`, `scripts/`, `kernel/`, `rootfs/`, or `tests/`.

### Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

### Mission & Tasks
Implement, fix, and verify R4 (`frostfire-hypervisor` crate):
1. **Fix Clippy Gate**:
   - Resolve `unused import: error` at `crates/frostfire-hypervisor/src/main.rs:19:15` so that `cargo clippy --workspace -- -D warnings` and `cargo clippy --target x86_64-unknown-linux-gnu -- -D warnings` pass with 0 warnings.
2. **Add Firecracker `/machine-config`**:
   - In `configure_and_boot()`, call `PUT /machine-config` allocating 2 vCPUs and 4096 MiB RAM (`vcpu_count: 2, mem_size_mib: 4096, smt: false`) prior to `/boot-source` to prevent microVM OOM crash.
3. **Dynamic Host Gateway Interface for NAT**:
   - In `setup_networking()`, dynamically detect host default network interface via `ip route show default` (with fallback to `eth0` / `ens5`) for iptables masquerade and forwarding rules.
4. **Serial Console Logging**:
   - Pipe/tee microVM serial console logs (`console=ttyS0`) to `/tmp/firecracker-serial.log` for guest boot observation.
5. **Teardown & Cleanup**:
   - Ensure clean unlinking of `/tmp/firecracker.socket` and `/tmp/vsock.sock`, and clean release on SIGINT.
6. **Verification Gates**:
   - Run `cargo test --workspace` (must pass all tests, 0 warnings).
   - Run `cargo clippy --workspace -- -D warnings` (must pass with 0 warnings).
   - Verify non-unix mock stubs compile and pass on Windows.

Write your completion report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m4\handoff.md` and notify parent orchestrator via `send_message`.

## 2026-09-10T21:23:43Z
Implement, fix, and verify R4 (frostfire-hypervisor crate):
1. Fix unused import error in main.rs:19:15 to satisfy clippy gate on Linux and Windows.
2. Add PUT /machine-config with 2 vCPUs and 4096 MiB RAM prior to /boot-source.
3. Dynamically detect host gateway interface for iptables MASQUERADE.
4. Stream serial console logs to /tmp/firecracker-serial.log.
5. Ensure clean teardown of sockets and tap0 on SIGINT.
6. Verify: cargo test --workspace and cargo clippy --workspace -- -D warnings pass with 0 warnings.
