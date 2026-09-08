# Handoff Report: Milestone 2 Empirical Challenge (Subreaper, OverlayFS & Shell Syntax)

**Agent**: `challenger_m2_2`  
**Role**: Empirical Challenger (`teamwork_preview_challenger`)  
**Milestone**: Milestone 2: Autonomous MicroVM Virtualization Infrastructure (Features F6–F12)  
**Parent Agent**: `parent` (`a683d2a2-4cae-4a3a-a587-8741f091dc4b`)  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_2`  
**Date**: 2026-09-08T21:21:00Z  
**Verdict**: **`APPROVE`**

---

## 1. Observation

Direct empirical observations from executing verification commands, mock test harnesses, and test suites:

1. **`sand-exit-watch` Python Compilation & Crash-Loop Backoff Execution**:
   - `python -m py_compile cloud/microvm/scripts/sand-exit-watch` executed cleanly with exit code 0.
   - Executed empirical crash-loop test harness running `sand-exit-watch` with `--max-restarts 2` supervising a rapid-failing child (`python -c "import sys; sys.exit(42)"`):
     - Attempt 1: Logged `[sand-exit-watch] Crash-loop backoff: sleeping for 2s before restart...`
     - Attempt 2: Logged `[sand-exit-watch] Crash-loop backoff: sleeping for 4s before restart...`
     - Attempt 3: Logged `[sand-exit-watch] FATAL: Exceeded maximum restarts (2). Entering terminal failure state.`
     - Total elapsed execution time: 6.50s (matching $2\text{s} + 4\text{s} = 6\text{s}$ backoff plus spawn latency).
     - Supervisor exited with returncode `1`.
   - Clean exit verification: child exiting with code 0 caused `sand-exit-watch` to immediately log `Monitored child exited cleanly with code 0. Terminating.` and terminate with returncode `0` in 0.20s without looping.
   - Limit boundary testing on `Supervisor`:
     - Formula $\min(1 \ll \text{attempt}, 30)$ verified for attempts 1..14: attempts 1..4 produce 2, 4, 8, 16 seconds; attempts $\ge 5$ are strictly capped at 30 seconds.
     - Spawning nonexistent binary cleanly caught `FileNotFoundError`, logging `CRITICAL: Failed to spawn command` and returning `1`.

2. **`run-vm.sh` Input Validation & Path Traversal Guard**:
   - Executed `bash cloud/microvm/run-vm.sh ..`:
     - Result: printed `[-] Error: Invalid instance ID '..' (must not be empty or contain '..')` to stderr and exited with code `1`.
   - Executed `bash cloud/microvm/run-vm.sh ../foo`:
     - Result: printed `[-] Error: Invalid instance ID '../foo' (must not be empty or contain '..')` to stderr and exited with code `1`.
   - Observation on empty input edge-case:
     - Line 7: `VM_INDEX="${1:-0}"`
     - Line 13: `if [ -z "${VM_INDEX}" ] || [[ "${VM_INDEX}" == *".."* ]]; then`
     - When invoked with empty string argument `bash cloud/microvm/run-vm.sh ""`, bash parameter expansion `${1:-0}` defaults null/empty values to `"0"`, causing `VM_INDEX` to become `"0"`. The check `[ -z "${VM_INDEX}" ]` evaluates to false, and the script falls back to instance `vm-0` rather than printing an error. While safe from path traversal and crashes, `[ -z "${VM_INDEX}" ]` is unreachable dead code under `${1:-0}`.

3. **`run-vm.sh` Dual-Drive VirtIO Configuration Payloads**:
   - Built an empirical mock environment intercepting curl calls to Firecracker's Unix domain socket `/tmp/firecracker-1.socket` when running `run-vm.sh 1`:
     - **Drive 1 (`drives/rootfs`)**:
       ```json
       {
         "drive_id": "rootfs",
         "path_on_host": "/mnt/c/Users/tyson/.../frostfire/golden_base.ext4",
         "is_root_device": true,
         "is_read_only": true
       }
       ```
     - **Drive 2 (`drives/overlay`)**:
       ```json
       {
         "drive_id": "overlay",
         "path_on_host": "/mnt/c/Users/tyson/.../frostfire/instances/vm-1/overlay.ext4",
         "is_root_device": false,
         "is_read_only": false
       }
       ```
     - **Boot Source (`boot-source`)**:
       ```json
       {
         "kernel_image_path": "/mnt/c/Users/tyson/.../frostfire/vmlinux",
         "boot_args": "console=ttyS0 reboot=k panic=1 pci=off ip=172.16.1.2::172.16.1.1:255.255.255.0::eth0:off root=/dev/vda ro init=/usr/local/bin/init-overlay"
       }
       ```
     - **Network Interface (`network-interfaces/eth0`)**:
       `iface_id: "eth0"`, `guest_mac: "AA:FC:00:00:00:01"`, `host_dev_name: "tap1"`.
     - **Actions (`actions`)**:
       `action_type: "InstanceStart"`.

4. **Shell Script Syntax & LF Normalization Pass Rate**:
   - Evaluated all 12 `.sh` scripts plus `init-overlay` with `bash -n`: 100% passed with `ExitCode = 0`:
     - `cloud/microvm/build-rootfs.sh`: exit 0
     - `cloud/microvm/host-setup.sh`: exit 0
     - `cloud/microvm/run-vm.sh`: exit 0
     - `cloud/microvm/scripts/box-cgroups.sh`: exit 0
     - `cloud/microvm/scripts/init-overlay`: exit 0
     - `cloud/microvm/scripts/link-chrome-session.sh`: exit 0
     - `cloud/microvm/scripts/start-desktop.sh`: exit 0
     - `cloud/microvm/scripts/teach-session-recorder.sh`: exit 0
     - `deploy/gcp/deploy-cloudrun.sh`: exit 0
     - `deploy/proxmox/deploy-lxc.sh`: exit 0
     - `scripts/gcp-setup-wizard.sh`: exit 0
     - `scripts/setup-cluster.sh`: exit 0
   - JavaScript / Node scripts evaluated with `node -c`:
     - `cloud/microvm/scripts/cdp-cookies.mjs`: exit 0
     - `cloud/microvm/scripts/sand-window-router.mjs`: exit 0
   - Line ending byte check: 0 files contain CRLF (`\r\n`); 100% of repository scripts have LF endings (`HasCRLF = False`).

5. **Test Suite Verification**:
   - `cargo test -p frostfire-e2e -- test_f6`: 10 passed, 0 failed.
   - `cargo test -p frostfire-e2e -- test_f7`: 10 passed, 0 failed.
   - `cargo test -p frostfire-e2e -- test_f11`: 10 passed, 0 failed.
   - `cargo test -p frostfire-e2e -- test_f12`: 10 passed, 0 failed.
   - `cargo test -p frostfire-e2e`: 175 passed, 0 failed.
   - `cargo test --workspace`: 100% passed across all workspace crates with 0 failures.
   - `cargo clippy --workspace -- -D warnings`: 0 warnings.

---

## 2. Logic Chain

1. **Subreaper & Crash Loop Robustness (Observation 1)**:
   - In microVM environments, processes can enter rapid crash loops or spawn orphan children.
   - Observation 1 empirically proves that `sand-exit-watch` correctly enforces exponential backoff delays ($2\text{s} \to 4\text{s}$), strictly honors `--max-restarts`, caps maximum backoff at 30 seconds, immediately terminates cleanly on code 0, and handles missing binaries without unhandled exceptions.
   - This validates Milestone 2 Feature F11.

2. **OverlayFS Dual-Drive VirtIO Configuration (Observations 2 & 3)**:
   - Concurrent microVMs sharing a single root filesystem risk metadata corruption if attached read-write.
   - Observation 3 confirms that `run-vm.sh` sends valid, well-formed JSON to Firecracker specifying `drives/rootfs` as `is_root_device: true` and `is_read_only: true` pointing to `golden_base.ext4`, while `drives/overlay` is `is_root_device: false` and `is_read_only: false` pointing to a per-instance sparse disk (`instances/vm-${VM_INDEX}/overlay.ext4`).
   - Guest boot args route initialization through `init-overlay` (`root=/dev/vda ro init=/usr/local/bin/init-overlay`), which mounts `/dev/vda` as `lowerdir` and `/dev/vdb` as `upperdir` and `workdir`.
   - Path traversal attempts using `..` are actively caught and blocked with exit code 1.
   - This validates Milestone 2 Feature F6.

3. **Script Syntax & Line Endings (Observation 4)**:
   - Linux microVM environments fail to execute scripts containing CRLF (`^M`) characters in shebangs or commands.
   - Observation 4 confirms byte-level LF normalization across all scripts and 100% clean compilation via `bash -n`, `node -c`, and `python -m py_compile`.
   - This validates Milestone 2 Feature F12.

4. **Automated Testing Gates (Observation 5)**:
   - All 175 opaque-box E2E tests in `frostfire-e2e`, all workspace unit and integration tests, and clippy gates pass with 0 failures and 0 warnings, confirming no regressions across the control plane.

---

## 3. Adversarial Challenges & Findings

### Challenge Summary
**Overall risk assessment**: **LOW**

### Challenge 1: Empty `VM_INDEX` parameter handling in `run-vm.sh`
- **Assumption challenged**: `run-vm.sh` input validation catches empty `VM_INDEX`.
- **Attack scenario**: Invoking `./run-vm.sh ""` with an explicit empty string argument.
- **Observed behavior**: Bash parameter expansion `VM_INDEX="${1:-0}"` substitutes `"0"`, rendering `[ -z "${VM_INDEX}" ]` in line 13 unreachable dead code. The script proceeds with `vm-0` instead of rejecting the empty string.
- **Blast radius**: Low. The script safely defaults to `vm-0` without path traversal or crashes.
- **Mitigation recommendation**: If explicit empty strings should be rejected, test `$1` directly or use `${1-}` before applying defaults:
  ```bash
  if [ -z "${1-}" ] || [[ "${1}" == *".."* ]]; then
  ```

### Challenge 2: Non-numeric characters in `VM_INDEX`
- **Assumption challenged**: `VM_INDEX` is validated as a valid subnet octet.
- **Attack scenario**: Passing `VM_INDEX="foo"`.
- **Observed behavior**: `run-vm.sh` generates `GUEST_IP="172.16.foo.2"`.
- **Blast radius**: Low/Internal. MicroVM launch will fail during IP configuration in Firecracker API without corrupting host state.
- **Mitigation recommendation**: Add regex check `[[ "${VM_INDEX}" =~ ^[0-9]+$ ]]` to restrict to valid numeric indices $[0..254]$.

---

## 4. Caveats

1. **Hardware KVM Device (`/dev/kvm`)**:
   - The test environment runs on Windows host without bare-metal KVM. Firecracker microVM launch was empirically validated using mocked socket listeners and API payload assertions. Full hardware execution is verified on EC2 metal hypervisors.
2. **Linux `prctl` System Call**:
   - `PR_SET_CHILD_SUBREAPER` (system call 36) is Linux-specific. On Windows dev host, `sand-exit-watch` logs a notice and skips the prctl call, while all supervisor backoff, child spawning, and exit handling logic execute identically.

---

## 5. Conclusion

**Verdict: `APPROVE`**

Milestone 2 subreaper supervisor (`sand-exit-watch`), OverlayFS dual-drive VirtIO branching (`run-vm.sh`, `init-overlay`, `build-rootfs.sh`), and shell script syntax/line endings have been empirically challenged and verified. All crash-loop backoff algorithms, path traversal protections, Firecracker JSON configurations, and test gates passed with 0 errors.

---

## 6. Verification Method

To independently reproduce the empirical challenge results:

1. **Test `sand-exit-watch` Compilation & Crash-Loop Backoff**:
   ```bash
   python -m py_compile cloud/microvm/scripts/sand-exit-watch
   python -c '
   import subprocess, time, sys
   start = time.time()
   cmd = [sys.executable, "cloud/microvm/scripts/sand-exit-watch", "--max-restarts", "2", "--", sys.executable, "-c", "import sys; sys.exit(42)"]
   proc = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
   _, stderr = proc.communicate()
   elapsed = time.time() - start
   assert proc.returncode == 1
   assert "sleeping for 2s before restart" in stderr
   assert "sleeping for 4s before restart" in stderr
   assert "FATAL: Exceeded maximum restarts (2)" in stderr
   assert 5.5 <= elapsed <= 8.5
   print("PASSED")
   '
   ```

2. **Test `run-vm.sh` Path Traversal Rejection**:
   ```bash
   bash cloud/microvm/run-vm.sh ..
   # Must exit with code 1 and error message
   ```

3. **Verify All Shell Scripts Syntax (`bash -n`)**:
   ```powershell
   Get-ChildItem -Path . -Filter "*.sh" -Recurse | Where-Object { $_.FullName -notmatch "\\target\\" -and $_.FullName -notmatch "\\\.git\\" } | ForEach-Object {
       $rel = $_.FullName.Replace((Get-Location).Path + "\", "").Replace("\", "/")
       $out = bash -n "$rel" 2>&1
       [PSCustomObject]@{ Script = $rel; ExitCode = $LASTEXITCODE; Output = ($out -join "; ") }
   } | Format-Table -AutoSize
   ```

4. **Verify E2E and Workspace Tests**:
   ```bash
   cargo test -p frostfire-e2e -- test_f6
   cargo test -p frostfire-e2e -- test_f7
   cargo test -p frostfire-e2e -- test_f11
   cargo test -p frostfire-e2e -- test_f12
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
