# Project: Frostfire Cloud — Phase 1 (User-Hosted VM on AWS)

## Architecture
Frostfire Cloud Phase 1 provides an ephemeral or persistent, single-user remote workspace on AWS EC2 Spot Nitro instances (`c6i.xlarge` / `c6a.xlarge`) running nested KVM (`/dev/kvm`). It hosts microVMs using Firecracker v1.10+, booted with a monolithic Linux 6.12 kernel and an 8GB Debian 13 (Trixie) rootfs appliance.

### System Components & Data Flow
1. **AWS Host Layer (EC2 Spot Nitro)**:
   - Ubuntu 24.04 LTS host with KVM enabled (`/dev/kvm`).
   - Turnkey CloudFormation template (`deploy/aws/poc-host.yaml`) and deployment automation (`scripts/deploy-poc.ps1`, `scripts/deploy-poc.sh`).
   - Security Group restricting TCP 22 (SSH), 1339 (Window Router), 6080 (primary noVNC), and 6081 (forked noVNC) to `AllowedCidr`.
   - Host Auto-Idle Daemon (`scripts/check-idle-shutdown.sh`) stopping the instance after 20 minutes of inactivity on ports 22 and 6080 (<$5/month spend).
   - Host bootstrap setup (`scripts/setup-host.sh`).
2. **Monolithic Linux 6.12 Kernel (`kernel/`)**:
   - ELF uncompressed binary `vmlinux-6.12.6` compiled with `CONFIG_MODULES=n`.
   - Built-in VirtIO drivers (`VIRTIO_BLK`, `VIRTIO_NET`, `VIRTIO_VSOCK`, `VIRTIO_CONSOLE`, `VIRTIO_BALLOON`, `VIRTIO_MMIO`, `VIRTIO_MMIO_CMDLINE_DEVICES`).
   - In-tree support for Ext4, OverlayFS, FUSE, namespaces, cgroups v2, seccomp, devtmpfs, and IP autoconfiguration (`CONFIG_IP_PNP`).
3. **Debian 13 (Trixie) Rootfs Appliance (`rootfs/`)**:
   - 8GB ext4 image (`rootfs.ext4`) containing user `box` (UID 1000) with passwordless sudo.
   - Recombined binaries: `exec-daemon/node` and `tools/origin`.
   - Complete desktop stack: Xvfb (:1), xfwm4, picom, plank dock, x11vnc (:5900), websockify (:6080/:6081).
   - Google Chrome Stable with enterprise managed policies and WebAuthn proxy extension.
   - Boot autostart systemd service: `frostfire-box.service` invoking `/usr/local/bin/start-frostfire-box`.
4. **Firecracker Hypervisor Daemon (`crates/frostfire-hypervisor`)**:
   - Host orchestrator daemon written in Rust (Tokio, Hyper, Unix Domain Sockets).
   - Provisions `tap0` (`172.30.0.1/24`), guest IP `172.30.0.2`, and dynamic host NAT iptables forwarding.
   - Manages Firecracker over `/tmp/firecracker.socket`: `/machine-config` (2 vCPUs, 4096 MiB RAM), `/boot-source`, `/drives/rootfs`, `/network-interfaces/eth0`, `/vsock`.
   - Handles `InstanceStart`, serial console logging, and clean shutdown on SIGINT.
5. **Verification Suite (`box-doctor`)**:
   - In-guest diagnostic tool verifying all 10 checks: `machine-id`, `chrome`, `chrome-fds`, `egress`, `clock`, `dbus`, `xvfb`, `x11vnc`, `novnc`, `compositor`.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | CloudFormation POC Template | Turnkey CloudFormation template (`deploy/aws/poc-host.yaml`) for EC2 Spot Nitro instance with KVM, gp3 50GB disk, and UserData. | M1 | ORIGINAL_REQUEST § R1 |
| 2 | Host UserData Bootstrap | Bootstrap script configuring KVM permissions, IP forwarding, toolchains, Firecracker v1.10.1, Node 20, Rust, and auto-idle cron. | M1 | ORIGINAL_REQUEST § R1 |
| 3 | Security Group Port Ingress | Ingress filtering for ports 22, 1339, 6080, and 6081 restricted to user public IP CIDR. | M1 | ORIGINAL_REQUEST § R1 |
| 4 | Auto-Idle Shutdown Daemon | Script (`check-idle-shutdown.sh`) monitoring sockets on ports 22 and 6080 every 5 mins, shutting down after 20 mins inactivity. | M1 | ORIGINAL_REQUEST § R1 |
| 5 | Host Dependency Setup Script | Standalone host initialization script (`scripts/setup-host.sh`) configuring KVM, Firecracker, and toolchains. | M1 | ORIGINAL_REQUEST § R1 |
| 6 | Turnkey Deploy Scripts | PowerShell (`scripts/deploy-poc.ps1`) and Bash (`scripts/deploy-poc.sh`) deployment automation with public IP auto-detection. | M1 | ORIGINAL_REQUEST § R1 |
| 7 | EC2 KeyPair Resilience | Automated detection or creation of EC2 KeyPair in deployment script for AWS account `739275475035` in `us-west-2`. | M1 | Survey Finding |
| 8 | Debian Archive Keyring | Include `debian-archive-keyring` in UserData and host setup packages for Debian 13 signature verification. | M1 | Survey Finding |
| 9 | Monolithic Linux 6.12 Kernel | Uncompressed `vmlinux-6.12.6` compiled with `CONFIG_MODULES=n`. | M2 | ORIGINAL_REQUEST § R2 |
| 10 | Static VirtIO Drivers | Static in-tree VirtIO drivers: BLK, NET, VSOCK, CONSOLE, BALLOON, MMIO, MMIO_CMDLINE. | M2 | ORIGINAL_REQUEST § R2 |
| 11 | Static Filesystems & Namespaces | Static support for Ext4 (with POSIX ACL & security), OverlayFS, FUSE, devtmpfs, namespaces (PID, NET, IPC, UTS, USER), cgroups v2. | M2 | ORIGINAL_REQUEST § R2 |
| 12 | IP Bootline Autoconfig | `CONFIG_IP_PNP=y`, `CONFIG_IP_PNP_DHCP=y`, `CONFIG_IP_PNP_BOOTP=y` to parse `ip=172.30.0.2::...` bootline. | M2 | Survey Finding |
| 13 | Hardware RNG & Entropy | `CONFIG_HW_RANDOM=y`, `CONFIG_HW_RANDOM_VIRTIO=y`, `CONFIG_RANDOM_TRUST_CPU=y` for microVM entropy. | M2 | Survey Finding |
| 14 | Cgroup v2 Scheduler & PIDs | `CONFIG_FAIR_GROUP_SCHED=y`, `CONFIG_CFS_BANDWIDTH=y`, `CONFIG_CGROUP_PIDS=y` for `box-cgroups.sh`. | M2 | Survey Finding |
| 15 | Deterministic Kernel Config | Single source of truth kernel config template in `kernel/kernel.config` consumed by `kernel/build-kernel.sh`. | M2 | ORIGINAL_REQUEST § R2 |
| 16 | Debian 13 Rootfs Generation | Script `rootfs/build-rootfs.sh` generating an 8GB raw ext4 disk image (`rootfs.ext4`) via debootstrap. | M3 | ORIGINAL_REQUEST § R3 |
| 17 | Non-Root User `box` | User `box` (UID 1000, GID 1000) with passwordless sudo (`chmod 0440 /etc/sudoers.d/box`). | M3 | ORIGINAL_REQUEST § R3 |
| 18 | Split Binary Recombination | Recombine `exec-daemon/node.part.*` into `node` and `origin.part.*` into `origin` during rootfs assembly. | M3 | Survey Finding |
| 19 | Complete User `box` Profile | Copy entire `home-box/` tree (`.config/`, `.local/`, `.profile`, `deps/`, `frostfire-host/`) to `/home/box/`. | M3 | Survey Finding |
| 20 | Wallpaper & Policies Assets | Inject `usr-share-backgrounds/` and `etc-policies/native-messaging-hosts/` into rootfs. | M3 | Survey Finding |
| 21 | Desktop & Display Stack | Install and configure Xvfb (:1), xfwm4, picom, x11vnc (:5900), websockify/novnc (:6080/:6081), plank, hsetroot, dconf-cli, fuse3. | M3 | ORIGINAL_REQUEST § R3 |
| 22 | Google Chrome Enterprise | Install Google Chrome Stable with enterprise managed policies (`frostfire.json`, `frostfire-webauthn.json`). | M3 | ORIGINAL_REQUEST § R3 |
| 23 | Guest Autostart Service | Install and enable `/etc/systemd/system/frostfire-box.service` executing `/usr/local/bin/start-frostfire-box` on boot. | M3 | Survey Finding |
| 24 | Static Networking & DNS Config | Configure `/etc/resolv.conf` (8.8.8.8) and static `eth0` network in rootfs. | M3 | Survey Finding |
| 25 | Chroot Build Hygiene | Mount `/proc`, `/sys`, `/dev`, `/dev/pts` and use `/usr/sbin/policy-rc.d` (`exit 101`) guard during chroot. | M3 | Survey Finding |
| 26 | Hypervisor Crate Compilation | Compile `crates/frostfire-hypervisor` with 0 warnings on all targets (`cargo clippy --workspace -- -D warnings`). | M4 | ORIGINAL_REQUEST § R4 |
| 27 | Fix Clippy Unused Import | Fix `unused import: error` at `crates/frostfire-hypervisor/src/main.rs:19:15` for Linux clippy gate. | M4 | Survey Finding |
| 28 | Firecracker Machine Config | Add `PUT /machine-config` allocating 2 vCPUs and 4096 MiB RAM to prevent microVM OOM crash. | M4 | Survey Finding |
| 29 | TAP Networking & Dynamic Egress | Create `tap0` (`172.30.0.1/24`), dynamically detect host gateway interface for iptables NAT masquerade. | M4 | ORIGINAL_REQUEST § R4 |
| 30 | Firecracker UDS Control | API client over `/tmp/firecracker.socket` controlling `/boot-source`, `/drives/rootfs`, `/network-interfaces/eth0`, `/vsock`. | M4 | ORIGINAL_REQUEST § R4 |
| 31 | Instance Lifecycle & Shutdown | Issue `InstanceStart`, capture serial logs to file, trap `SIGINT` (Ctrl+C) for clean kill and socket teardown. | M4 | ORIGINAL_REQUEST § R4 |
| 32 | Box-Doctor Verification | Run `/usr/local/bin/box-doctor` inside guest microVM and pass all 10 diagnostic checks cleanly. | M4 | ORIGINAL_REQUEST § R4 |
| 33 | E2E Test Suite (Tiers 1-4) | Comprehensive opaque-box test suite verifying all 32 inventoried features across host, kernel, rootfs, and hypervisor. | M-E2E | Project Pattern |
| 34 | Adversarial Hardening (Tier 5) | White-box stress tests, boundary conditions, and failure recovery harnesses. | M5 | Project Pattern |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | AWS Host & UserData Bootstrap | CloudFormation template, UserData, KeyPair resilience, deploy scripts, auto-idle daemon | none | DONE |
| M2 | Monolithic Linux 6.12 Kernel Pipeline | `kernel/kernel.config` template, `kernel/build-kernel.sh` pipeline, ELF binary | none | DONE |
| M3 | Debian 13 Rootfs Appliance Pipeline | `rootfs/build-rootfs.sh`, binary recombination, full asset injection, systemd autostart, packages, networking | none | DONE |
| M4 | Rust Firecracker Hypervisor & Diagnostics | `frostfire-hypervisor` crate clippy fix, `/machine-config`, dynamic NAT, serial logs, teardown, box-doctor verification | M1, M2, M3 | DONE |
| M-E2E | E2E Testing Track | Independent opaque-box test suite covering Tiers 1-4, publishing `TEST_READY.md` (347 tests) | none | DONE |
| M5 | Final Milestone: E2E Test Pass & Adversarial Hardening | Phase 1: 100% E2E test pass (Tiers 1-4); Phase 2: Tier 5 adversarial hardening (31 tests, total 378 passing) | M4, M-E2E | DONE |

---

## Interface Contracts

### Host ↔ Hypervisor
- **Socket Path**: `/tmp/firecracker.socket`
- **Serial Log**: `/tmp/firecracker-serial.log`
- **VSOCK UDS Path**: `/tmp/vsock.sock` (Guest CID: 3)
- **TAP Device**: `tap0` (Host IP: `172.30.0.1/24`, Guest IP: `172.30.0.2`, Guest MAC: `AA:FC:00:00:00:01`)
- **NAT Masquerade**: Outbound traffic forwarded via dynamically detected host default route interface (`ens5` or `eth0`).

### Hypervisor ↔ Kernel Boot
- **Kernel Image**: Uncompressed ELF binary `build/kernel/out/vmlinux-6.12.6`
- **Boot Arguments**: `console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw quiet ip=172.30.0.2::172.30.0.1:255.255.255.0::eth0:off`

### Kernel ↔ Rootfs Appliance
- **Root Drive**: `/dev/vda` formatted as ext4 (8GB raw image `build/rootfs.ext4`)
- **Init System**: `/sbin/init` (systemd 256+ on Debian 13 Trixie)
- **Autostart Service**: `/etc/systemd/system/frostfire-box.service` executing `/usr/local/bin/start-frostfire-box`

### Guest Services ↔ Host Ports
- **Primary noVNC**: TCP 6080 (websockify bridging to X11VNC port 5900 on display :1)
- **Secondary noVNC**: TCP 6081 (websockify bridging to fork displays)
- **Window Router**: TCP 1339 (Node.js reverse proxy)
- **SSH**: TCP 22 (Host access)

### Guest Verification (`box-doctor`)
- **Executable**: `/usr/local/bin/box-doctor`
- **Checks (10)**:
  1. `machine-id`: `/etc/machine-id` and `/var/lib/dbus/machine-id` valid 32 lowercase hex characters and identical.
  2. `chrome`: `google-chrome-stable --version` exits 0 with non-empty version.
  3. `chrome-fds`: Chrome main processes consume < 90% soft file descriptor limit.
  4. `egress`: `curl -fsS --max-time 8 https://www.google.com/generate_204` succeeds.
  5. `clock`: Year is [2024, 2100] and skew vs HTTP Date header is <= 60s.
  6. `dbus`: `$DBUS_SESSION_BUS_ADDRESS` is set or `dbus-launch` on PATH.
  7. `xvfb`: `xdpyinfo -display :1` exits 0.
  8. `x11vnc`: TCP port 5900 accepts connections.
  9. `novnc`: TCP port 6080 accepts connections.
  10. `compositor`: Both `xfwm4` and `picom` active in process table.

---

## Code Layout
```
frostfire-cloud/
├── Cargo.toml                              # Workspace manifest
├── AGENTS.md                               # Workspace directives & verification gates
├── crates/
│   └── frostfire-hypervisor/               # Rust Firecracker hypervisor daemon crate
│       ├── Cargo.toml
│       └── src/
│           └── main.rs                     # Hypervisor manager, UDS client, TAP setup, lifecycle
├── deploy/
│   └── aws/
│       └── poc-host.yaml                   # CloudFormation template for EC2 Spot Nitro host
├── kernel/
│   ├── build-kernel.sh                     # Monolithic Linux 6.12 kernel build pipeline
│   └── kernel.config                       # Kernel configuration template
├── rootfs/
│   └── build-rootfs.sh                     # Debian 13 (Trixie) rootfs debootstrap appliance builder
├── scripts/
│   ├── check-idle-shutdown.sh              # Auto-idle shutdown daemon
│   ├── setup-host.sh                       # Standalone host dependency installer
│   ├── deploy-poc.ps1                      # Turnkey PowerShell deployment script
│   └── deploy-poc.sh                       # Turnkey Bash deployment script
├── usr-local-bin/                          # Guest utilities, desktop wrappers, box-doctor
├── exec-daemon/                            # Guest agent runtime bundle
├── home-box/                               # Guest user `box` profile, configs, and deps
├── etc-policies/                           # Chrome managed policies & native messaging hosts
└── tests/                                  # Independent E2E integration test suite (378 tests)
```
