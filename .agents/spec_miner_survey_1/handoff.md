# Handoff Report: Spec Miner Survey 1 (AWS Infrastructure, Hypervisor Daemon & box-doctor)

## 1. Observation
- **`deploy/aws/poc-host.yaml`**:
  - Defines `PocSecurityGroup` (lines 34-62) with ingress on TCP ports 22 (SSH), 1339 (Window Router), 6080 (noVNC primary), and 6081 (noVNC fork), bound to `AllowedCidr`.
  - Defines `UserVmInstance` (lines 63-181) using `c6i.xlarge` Spot persistent instance (`InstanceInterruptionBehavior: stop`), root gp3 50 GB EBS volume (`DeleteOnTermination: false`), Ubuntu 24.04 LTS via SSM (`ImageId: '{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}'`).
  - Contains full UserData bootstrap (lines 83-175) configuring `/dev/kvm` permissions, `net.ipv4.ip_forward=1`, apt packages, Firecracker `v1.10.1` binary, Node.js 20 LTS, Rust stable, and auto-idle cron.
  - Outputs `InstanceId`, `PublicIp`, `SshAccessCommand`, `NoVncUrl`, `WindowRouterUrl` (lines 182-202).
- **`scripts/deploy-poc.ps1` & `scripts/deploy-poc.sh`**:
  - Auto-detects client public IP via `https://checkip.amazonaws.com` (lines 16-25 in `.ps1`, lines 19-25 in `.sh`), defaulting to `0.0.0.0/0` on error.
  - Validates template via `aws cloudformation validate-template` and deploys via `aws cloudformation deploy`.
- **`scripts/check-idle-shutdown.sh`**:
  - Queries active TCP sessions: `ACTIVE_CONNS=$(ss -nt '( sport = :22 or sport = :6080 )' | grep -v "State" | wc -l)` (line 8).
  - Maintains state in `/tmp/frostfire_idle_counter` (increments by 5). If `>= 20`, runs `sudo shutdown -h now` (lines 10-22).
- **`scripts/setup-host.sh`**:
  - Validates `/dev/kvm` device existence, exiting 1 if missing (lines 10-18).
  - Installs toolchains and Firecracker v1.10.1, sources Rust cargo env, schedules auto-idle cron.
- **`crates/frostfire-hypervisor`**:
  - `Cargo.toml`: Package `frostfire-hypervisor`, Rust 2021 edition. Dependencies: `tokio` (1.38, full, process), `serde`, `serde_json`, `anyhow`, `tracing`, `tracing-subscriber`. Unix target dependencies: `hyper` (0.14, client, http1), `hyper-unix-connector` (0.2), `nix` (0.27).
  - `src/main.rs`:
    - `FirecrackerConfig::default()` (lines 32-44): socket `/tmp/firecracker.socket`, kernel `./build/kernel/out/vmlinux-6.12.6`, rootfs `./build/rootfs.ext4`, TAP `tap0`, vsock `/tmp/vsock.sock`, guest IP `172.30.0.2`, host IP `172.30.0.1`.
    - `setup_networking()` (lines 56-86): `ip tuntap add dev tap0 mode tap`, `ip addr add 172.30.0.1/24 dev tap0`, `ip link set dev tap0 up`, iptables NAT POSTROUTING eth0 MASQUERADE, FORWARD rules.
    - `spawn_firecracker()` (lines 89-113): deletes stale socket, runs `firecracker --api-sock`, polls socket up to 50 iterations x 50ms.
    - `send_api_request()` (lines 116-134): dispatches HTTP PUT requests to Firecracker socket via `hyper_unix_connector::UnixClient`.
    - `configure_and_boot()` (lines 137-198): issues PUT `/boot-source` (`console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw quiet ip=172.30.0.2::172.30.0.1:255.255.255.0::eth0:off`), PUT `/drives/rootfs`, PUT `/network-interfaces/eth0`, PUT `/vsock` (`guest_cid: 3`), and PUT `/actions` (`InstanceStart`).
    - `main()` (lines 223-258): `tokio::select!` on `fc_proc.wait()` and `tokio::signal::ctrl_c()`.
    - Test suite: `cargo test --workspace` passed 2 tests in 0.00s. `cargo clippy --workspace -- -D warnings` passed with 0 warnings.
- **`usr-local-bin/box-doctor`**:
  - Implements 10 diagnostic checks (lines 29-261):
    1. `check_machine_id`: verifies `/etc/machine-id` (32 lowercase hex chars) matches `/var/lib/dbus/machine-id`.
    2. `check_chrome`: tests `google-chrome-stable --version`.
    3. `check_chrome_fds`: filters Chrome browser mains (`--remote-debugging-port=`, no `--type=`), checks open FDs / soft limit; fails if `>= 90%` (`CHROME_FD_FAIL_PCT=90`).
    4. `check_egress`: probes `https://www.google.com/generate_204` via `curl -fsS --max-time 8`.
    5. `check_clock`: validates year in [2024, 2100] and skew <= 60s vs Google Date header (`SKEW_THRESHOLD_S=60`).
    6. `check_dbus`: checks `$DBUS_SESSION_BUS_ADDRESS` or `dbus-launch`.
    7. `check_xvfb`: probes `xdpyinfo -display :1` with 6 retries (0.5s delay).
    8. `check_x11vnc`: probes port 5900 via `(exec 3<>"/dev/tcp/127.0.0.1/5900")` with 6 retries.
    9. `check_novnc`: probes port 6080 (and fork port 6081 if tokens present) via `/dev/tcp` with 6 retries.
    10. `check_compositor`: checks `xfwm4` and `picom` via `pgrep -x` with 6 retries.
  - Formats output as `[box-doctor] PASS/FAIL <name>: <detail>`, prints `[box-doctor] SUMMARY`, exits 0 on success, 1 on failure.

## 2. Logic Chain
1. From inspecting `ORIGINAL_REQUEST.md`, Phase 1 requires turnkey AWS deployment (R1) and hypervisor daemon + box-doctor verification (R4).
2. Direct inspection of `deploy/aws/poc-host.yaml` and `scripts/setup-host.sh` proves that host setup is completely automated: KVM permissions, network forwarding, build toolchains, Firecracker v1.10.1, Node.js 20, and Rust stable are bootstrapped into an EC2 Spot instance.
3. The idle protection script `scripts/check-idle-shutdown.sh` and cron job enforce the <$5/month requirement by querying ports 22 and 6080 every 5 minutes and triggering shutdown after 20 minutes of silence.
4. The hypervisor crate `crates/frostfire-hypervisor` fulfills all orchestration needs for Firecracker: creating TAP interface `tap0`, configuring guest IP `172.30.0.2`, bridging `/tmp/vsock.sock` to guest CID 3, configuring the monolithic kernel and rootfs, handling `InstanceStart`, and cleanly trapping SIGINT.
5. In-guest verification script `usr-local-bin/box-doctor` verifies 10 key system components, providing an exact health gate. The guest environment scripts (`usr-local-bin/ensure-machine-id`, `box-xvfb`, `box-x11vnc`, `box-xfwm4`, `box-picom`, `box-chrome-policy`, `start-desktop.sh`) satisfy all 10 checks.

## 3. Caveats
- Direct execution of `aws cloudformation deploy` and live EC2 Spot provisioning requires valid AWS credentials configured with permissions for EC2, SSM, and CloudFormation in `us-west-2`.
- Real KVM execution (`/dev/kvm`) and Linux TAP networking require a Linux host with hardware virtualization enabled; on Windows development hosts, `frostfire-hypervisor` activates mock implementations for compilation and unit test execution.

## 4. Conclusion
- All specifications, schemas, interfaces, ports, and behaviors for R1 and R4 are authoritative, coherent, and documented in detail in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\survey_report.md`.
- `crates/frostfire-hypervisor` compiles with zero warnings and passes all workspace tests.
- `box-doctor` provides a robust, zero-early-abort gate with 10 explicit checks covering machine ID, Chrome binary and file descriptors, network egress, clock synchronization, D-Bus session, Xvfb display :1, x11vnc RFB port 5900, noVNC websockify ports 6080/6081, and the xfwm4/picom compositor stack.

## 5. Verification Method
- Verify workspace tests:
  ```pwsh
  cargo test --workspace
  ```
  Expected: 2 tests passed; 0 failed; finish in ~0.00s.
- Verify workspace linter:
  ```pwsh
  cargo clippy --workspace -- -D warnings
  ```
  Expected: clean compilation, exit code 0.
- Verify survey report contents:
  Inspect `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\survey_report.md`.
