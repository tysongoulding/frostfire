# Frostfire Cloud Phase 1 Architecture & Codebase Survey Report

**Survey Agent**: `explorer_survey_1`  
**Date**: 2026-09-10  
**Repository Branch**: `poc/user-hosted-vm`  
**Target Milestone**: Phase 1 — User-Hosted VM on AWS EC2 Spot with Nested KVM, Monolithic Linux 6.12 Kernel, Debian 13 Rootfs Appliance, and Rust Firecracker Hypervisor Daemon (`frostfire-hypervisor`)

---

## 1. Executive Summary & Inventory Overview

A comprehensive survey of the entire repository `c:\Users\tyson\.repo\personal\frostfire-cloud` was conducted. The codebase is currently on branch `poc/user-hosted-vm`, containing 2 commits ahead of the earlier cloud architecture:
1. `8ffdd89`: `feat(poc): initialize frostfire user-hosted vm infrastructure for aws`
2. `6a58196`: `refactor(guest): rename sand-host to frostfire-host and add frostfire aliases`

### Repository Breakdown by File Count and Directory

| Directory / Target | Tracked File Count | Description |
| :--- | :--- | :--- |
| `Cargo.toml` | 1 | Workspace root configuration (`members = ["crates/frostfire-hypervisor"]`) |
| `crates/` | 2 | `crates/frostfire-hypervisor` (Cargo.toml, src/main.rs) |
| `deploy/` | 3 | CloudFormation template (`deploy/aws/poc-host.yaml`), README, assets |
| `docs/` | 3 | `MICROVM_ARCHITECTURE.md`, `AGENT_TEAMS_SPEC.md`, `INTEGRATIONS_ATLAS.md` |
| `etc-policies/` | 8 | Chrome enterprise managed policies and Native Messaging manifests |
| `exec-daemon/` | 2,935 | Guest agent runtime (split `node.part.*`, `origin.part.*`, tmux, npm, pty) |
| `home-box/` | 97 | Guest user `box` configs (`.config`, `.local`, `.profile`, `deps/`, `frostfire-host/`) |
| `kernel/` | 2 | `build-kernel.sh` and deterministic `kernel.config` |
| `rootfs/` | 1 | `build-rootfs.sh` (Debian 13 debootstrap appliance build script) |
| `scripts/` | 4 | `check-idle-shutdown.sh`, `setup-host.sh`, `deploy-poc.ps1`, `deploy-poc.sh` |
| `usr-local-bin/` | 67 | Guest binaries/scripts (`box-doctor`, `start-desktop.sh`, `start-frostfire-box`, etc.) |
| `usr-local-share/` | 14 | WebAuthn proxy extension CRX, PEM, ID, XML update manifests |
| `usr-share-backgrounds/` | 7 | Wallpapers (`cursor-box-wallpaper.jpg`, `frostfire-wallpaper-*`) |
| Root Metadata | 5 | `AGENTS.md`, `README.md`, `.gitignore`, `.gitattributes`, `.dockerignore` |

### Baseline Verification Gate Results
- `cargo test --workspace`: **PASSED** (2 tests passed, 0 failed, 0 warnings on host platform).
- `cargo build --release`: **PASSED** (compilation succeeded in 14.29s).
- `cargo clippy --release -- -D warnings`: **PASSED** on Windows target.
- `cargo clippy --target x86_64-unknown-linux-gnu -- -D warnings`: **FAILED** due to `unused import: error` at `main.rs:19:15` on unix targets.
- `aws cloudformation validate-template`: **PASSED** on `deploy/aws/poc-host.yaml`.
- AWS Environment: AWS CLI v2.35.5 authenticated to Account `739275475035` in `us-west-2`. No existing EC2 keypairs or CloudFormation stacks currently present in `us-west-2`.

---

## 2. Requirement-by-Requirement Analysis

### R1. AWS EC2 Spot Host Infrastructure & Full UserData Bootstrap

#### Implemented Components
1. **CloudFormation Template (`deploy/aws/poc-host.yaml`)**:
   - Instance configuration: Parameters support `c6i.xlarge` (default), `c6a.xlarge`, `c6i.2xlarge`, `c6a.2xlarge`, `c7i.xlarge`, `c7a.xlarge`.
   - AMI: Canonical Ubuntu 24.04 LTS via SSM dynamic parameter `{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}`.
   - Storage: 50 GB gp3 EBS root volume (`DeleteOnTermination: false`).
   - Spot market: `SpotInstanceType: persistent`, `InstanceInterruptionBehavior: stop`.
   - Security Group: Ingress rules for port 22 (SSH), 1339 (Window Router), 6080 (noVNC primary), and 6081 (noVNC secondary), restricted to parameter `AllowedCidr`.
   - UserData:
     - Configures `/dev/kvm` mode `0666` and adds `ubuntu` to `kvm` group.
     - Enables IP forwarding: `sysctl -w net.ipv4.ip_forward=1` and `/etc/sysctl.d/99-frostfire.conf`.
     - Installs system build toolchains and utilities (`build-essential`, `debootstrap`, `qemu-utils`, `flex`, `bison`, `libelf-dev`, `iptables`, etc.).
     - Installs official Firecracker v1.10.1 (`/usr/local/bin/firecracker`, `/usr/local/bin/jailer`).
     - Installs Node.js 20+ LTS via NodeSource repository.
     - Installs Rust stable toolchain via `rustup` for user `ubuntu`.
     - Injects `/usr/local/bin/check-idle-shutdown.sh` and schedules cron every 5 minutes.
2. **Auto-Idle Shutdown Protection (`scripts/check-idle-shutdown.sh`)**:
   - Probes active sockets on ports 22 and 6080 using `ss -nt '( sport = :22 or sport = :6080 )'`.
   - Tracks idle duration in `/tmp/frostfire_idle_counter`. If no active sessions for >= 20 minutes, safely shuts down the host (`shutdown -h now`) to preserve budget.
3. **Host Setup Script (`scripts/setup-host.sh`)**:
   - Mirrors UserData operations for manual execution or non-CloudFormation host provisioning.
4. **Deploy Scripts (`scripts/deploy-poc.ps1` and `scripts/deploy-poc.sh`)**:
   - Auto-detects caller public IP via `https://checkip.amazonaws.com` to lock down `AllowedCidr` to `my_ip/32`.
   - Validates template and executes `aws cloudformation deploy`.
   - Displays CloudFormation outputs (InstanceId, PublicIp, SSH command, URLs).

#### Identified Gaps & Recommendations for R1
- **EC2 KeyPair Dependency**: `deploy/aws/poc-host.yaml` declares `KeyName: Type: AWS::EC2::KeyPair::KeyName`. In `us-west-2`, AWS account `739275475035` currently has 0 KeyPairs (`KeyPairs: []`). Deploy scripts should provide a flag to generate or import an EC2 KeyPair if not already present.
- **Repository Hydration on Host**: UserData provisions toolchains but does not clone the repository onto the EC2 host. The deployment workflow must include syncing or cloning `frostfire-cloud` to `/home/ubuntu/frostfire-cloud`.
- **Apt Keyring Dependency**: In `scripts/setup-host.sh` and UserData, `debian-archive-keyring` should be installed alongside `debootstrap` to guarantee signature verification for Debian 13 (Trixie).

---

### R2. Monolithic Linux 6.12 Kernel Build Pipeline

#### Implemented Components
1. **Kernel Config Template (`kernel/kernel.config`)**:
   - Explicitly sets `CONFIG_MODULES is not set` (`CONFIG_MODULES=n`).
   - VirtIO drivers enabled statically in-tree:
     - `CONFIG_VIRTIO=y`
     - `CONFIG_VIRTIO_PCI=y`
     - `CONFIG_VIRTIO_MMIO=y`
     - `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y`
     - `CONFIG_VIRTIO_BALLOON=y`
     - `CONFIG_VIRTIO_BLK=y`
     - `CONFIG_VIRTIO_NET=y`
     - `CONFIG_VIRTIO_VSOCK=y`
     - `CONFIG_VSOCKETS=y`
     - `CONFIG_VIRTIO_CONSOLE=y`
   - Filesystem support: `CONFIG_EXT4_FS=y`, `CONFIG_OVERLAY_FS=y`, `CONFIG_FUSE_FS=y`, `CONFIG_NET_9P=y`, `CONFIG_TMPFS=y`, `CONFIG_DEVTMPFS=y`, `CONFIG_DEVTMPFS_MOUNT=y`.
   - Namespaces & Cgroups v2: `CONFIG_NAMESPACES=y`, `CONFIG_USER_NS=y`, `CONFIG_NET_NS=y`, `CONFIG_PID_NS=y`, `CONFIG_IPC_NS=y`, `CONFIG_UTS_NS=y`, `CONFIG_CGROUPS=y`, `CONFIG_MEMCG=y`, `CONFIG_CPUSETS=y`.
   - Security: `CONFIG_SECURITY=y`, `CONFIG_SECCOMP=y`, `CONFIG_SECCOMP_FILTER=y`.
2. **Kernel Build Script (`kernel/build-kernel.sh`)**:
   - Downloads Linux kernel 6.12.6 source (`linux-6.12.6.tar.xz`).
   - Generates `defconfig` and executes `scripts/config` overrides.
   - Compiles uncompressed `vmlinux` with `make -j$(nproc) vmlinux`.
   - Exports binary to `${ROOT_DIR}/build/kernel/out/vmlinux-6.12.6`.

#### Identified Gaps & Recommendations for R2
- **Config Synchronization**: `kernel/build-kernel.sh` invokes `scripts/config` individually for ~35 options instead of utilizing `kernel/kernel.config` as the source of truth. As a result, critical flags present in `kernel/kernel.config` (such as `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y` and `CONFIG_DEVTMPFS_MOUNT=y`) are omitted from `build-kernel.sh`.
  - *Recommendation*: Use `scripts/kconfig/merge_config.sh -m .config "${ROOT_DIR}/kernel/kernel.config"` or merge `kernel.config` directly prior to `make olddefconfig`.

---

### R3. Debian 13 (Trixie) Rootfs Appliance Image Pipeline

#### Implemented Components
1. **Image Generation & Partitioning (`rootfs/build-rootfs.sh`)**:
   - Creates an 8GB (`8192 MB`) raw ext4 image: `dd if=/dev/zero of=rootfs.ext4 bs=1M count=8192` + `mkfs.ext4 -F -b 4096 rootfs.ext4`.
   - Mounts via loopback to `/mnt/frostfire-rootfs`.
2. **Debootstrap Base Setup**:
   - Bootstraps Debian 13 (Trixie) `amd64`.
   - Configures `/etc/hostname` (`frostfire-box`) and `/etc/hosts`.
   - Configures Debian apt sources (main, contrib, non-free, non-free-firmware).
   - Installs GUI stack: `xvfb`, `xfwm4`, `picom`, `x11vnc`, `websockify`, `novnc`, `dbus`, `dbus-x11`, `xdotool`, `procps`, `net-tools`, `iproute2`.
   - Installs Google Chrome Stable from official Google apt repository.
   - Creates non-root user `box` (UID 1000) with passwordless sudo (`/etc/sudoers.d/box`).
   - Initializes `/etc/machine-id` and `/var/lib/dbus/machine-id`.
3. **Guest Daemons & Diagnostics**:
   - Copies `usr-local-bin/` (including `box-doctor`, `start-desktop.sh`, `start-frostfire-box`).
   - Copies `etc-policies/policies/managed/` to `/etc/opt/chrome/policies/managed/`.
   - Diagnostic suite `usr-local-bin/box-doctor` implements all 10 checks: `machine-id`, `chrome`, `chrome-fds`, `egress`, `clock`, `dbus`, `xvfb`, `x11vnc`, `novnc`, `compositor`.

#### Critical Gaps & Recommendations for R3
1. **Split Binary Recombination**:
   - `exec-daemon/node` is split into `node.part.aa`, `node.part.ab`, `node.part.ac`.
   - `exec-daemon/tools/origin` is split into `origin.part.aa`, `origin.part.ab`.
   - `build-rootfs.sh` copies files without executing `node.recombine.sh` or `origin.recombine.sh`. Consequently, `/exec-daemon/node` is missing, breaking `frostfire-window-router.mjs` and all Node-based guest services.
   - *Fix*: Execute `cat node.part.* > node && chmod +x node` and `cat tools/origin.part.* > tools/origin && chmod +x tools/origin` inside `exec-daemon` before or during rootfs assembly.
2. **Missing Dotfiles and Dependencies in `home-box/`**:
   - `build-rootfs.sh` line 83 only copies `${ROOT_DIR}/home-box/frostfire-host/`.
   - It omits `home-box/.config/` (contains Plank launchers, xfwm4 shortcuts, Thunar config), `home-box/.local/` (`box-chrome.desktop`), `home-box/.profile`, and `home-box/deps/` (native Node addon binaries: `@anysphere/tree-chunk-napi`, `cursor-proclist`, `tree-sitter`).
   - *Fix*: Copy all contents of `home-box/` (including hidden files and `deps/`) to `/home/box/`.
3. **Missing Systemd Service / Guest Autostart**:
   - In Linux monolithic boot with `root=/dev/vda rw`, systemd starts PID 1.
   - Currently, `build-rootfs.sh` creates NO systemd service to run `start-frostfire-box` on boot. Without an autostart service, the guest microVM boots into a console login prompt without starting Xvfb, x11vnc, websockify, window-router, or box-doctor.
   - *Fix*: Install `/etc/systemd/system/frostfire-box.service`:
     ```ini
     [Unit]
     Description=Frostfire MicroVM Guest Services
     After=network.target dbus.service

     [Service]
     Type=simple
     User=root
     WorkingDirectory=/home/box
     ExecStart=/usr/local/bin/start-frostfire-box
     Restart=always
     RestartSec=2
     Environment=HOME=/home/box
     Environment=DISPLAY=:1
     Environment=USER=box

     [Install]
     WantedBy=multi-user.target
     ```
     And execute `systemctl enable frostfire-box.service` inside chroot.
4. **Missing Native Messaging Host and Wallpaper Assets**:
   - `etc-policies/native-messaging-hosts/` is not copied to `/etc/opt/chrome/native-messaging-hosts/`.
   - `usr-share-backgrounds/` is not copied to `/usr/share/backgrounds/`.
5. **Sudoers File Permissions**:
   - `/etc/sudoers.d/box` is created with default permissions. Sudo requires `0440` (`chmod 0440 /etc/sudoers.d/box`), otherwise sudo rejects the override.

---

### R4. Bare-Metal Rust Firecracker Hypervisor Daemon (`frostfire-hypervisor`)

#### Implemented Components
1. **Crate Architecture (`crates/frostfire-hypervisor`)**:
   - Config struct `FirecrackerConfig` with defaults:
     - `socket_path`: `/tmp/firecracker.socket`
     - `kernel_path`: `./build/kernel/out/vmlinux-6.12.6`
     - `rootfs_path`: `./build/rootfs.ext4`
     - `tap_device`: `tap0`
     - `guest_ip`: `172.30.0.2`
     - `host_ip`: `172.30.0.1`
     - `vsock_path`: `/tmp/vsock.sock`
2. **TAP Networking Setup (`setup_networking`)**:
   - Configures `tap0` via `ip tuntap add dev tap0 mode tap`.
   - Assigns `172.30.0.1/24` and brings up interface.
   - Sets up iptables MASQUERADE and FORWARD rules for guest egress.
3. **Firecracker Process Management & Unix Domain Socket API**:
   - Spawns `firecracker --api-sock /tmp/firecracker.socket`.
   - Waits for API socket readiness.
   - Dispatches Hyper HTTP client requests over Unix Domain Socket (`UnixClient`):
     - `PUT /boot-source`: configures kernel path and `boot_args` (`console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw quiet ip=172.30.0.2::172.30.0.1:255.255.255.0::eth0:off`).
     - `PUT /drives/rootfs`: mounts `rootfs.ext4` as `/dev/vda` root drive (`is_root_device: true, is_read_only: false`).
     - `PUT /network-interfaces/eth0`: attaches `tap0` to guest `eth0` with MAC `AA:FC:00:00:00:01`.
     - `PUT /vsock`: attaches `vsock0` to `/tmp/vsock.sock` with guest CID `3`.
     - `PUT /actions`: issues `InstanceStart`.
4. **Shutdown Signal Handling**:
   - Listens for `tokio::signal::ctrl_c()` and terminates Firecracker child process.

#### Critical Gaps & Recommendations for R4
1. **Linux Compilation Gate Failure (`cargo clippy`)**:
   - Line 19 of `crates/frostfire-hypervisor/src/main.rs`: `use tracing::{error, info};`.
   - `error` is unused. When compiled for Linux (`--target x86_64-unknown-linux-gnu`), rustc emits `warning: unused import: error`, which fails the verification gate `cargo clippy --workspace -- -D warnings`.
   - *Fix*: Change line 19 to `use tracing::info;` (or utilize `error!` in failure handling).
2. **Missing Firecracker Machine Configuration (`/machine-config`)**:
   - `configure_and_boot()` currently omits `PUT /machine-config`.
   - Firecracker default when `/machine-config` is omitted is **1 vCPU and 128 MiB RAM**.
   - A Debian 13 system running X11, Chromium, websockify, and Node daemons requires at least 2 vCPUs and 4096 MiB RAM. Without `PUT /machine-config`, the microVM will immediately kernel panic or OOM crash during early boot.
   - *Fix*: Add `PUT /machine-config` before `/boot-source`:
     ```json
     {
         "vcpu_count": 2,
         "mem_size_mib": 4096,
         "smt": false
     }
     ```
3. **Hardcoded Host Network Interface in `setup_networking`**:
   - `setup_networking` hardcodes `iptables ... -o eth0 -j MASQUERADE`.
   - On AWS Nitro instances running Ubuntu 24.04, the primary network interface is typically `ens5`. Hardcoding `eth0` will result in failed packet forwarding, causing `check_egress` in `box-doctor` to fail.
   - *Fix*: Dynamically detect the host default gateway interface via `ip route show default` (fallback to `eth0`).
4. **Serial Console Log Streaming**:
   - Firecracker emits microVM kernel and serial console output (`console=ttyS0`) to stdout/stderr.
   - Capturing child stdout/stderr and piping or teeing to `/tmp/firecracker-serial.log` provides vital visibility into guest boot stages and `box-doctor` progress.
5. **Graceful Teardown & Socket Cleanup**:
   - When the hypervisor shuts down or restarts, stale sockets `/tmp/firecracker.socket` and `/tmp/vsock.sock` must be unlinked, and `tap0` interface cleanly released.

---

## 3. Test Targets, CI Configurations & Workspace Members

### Workspace Members
`Cargo.toml` defines a single workspace member:
```toml
[workspace]
resolver = "2"
members = [
    "crates/frostfire-hypervisor",
]
```

### Existing Tests
- In `crates/frostfire-hypervisor/src/main.rs`:
  - `tests::test_default_config`: Verifies default paths, TAP device name (`tap0`), and IP allocation (`172.30.0.2` / `172.30.0.1`).
  - `tests::test_manager_instantiation`: Verifies hypervisor manager instantiation and network setup mock.
  - Test command: `cargo test --workspace` (2 passed).

### CI / Automation State
- No `.github/workflows/` directory exists in the repository.
- Verification gates are defined in `AGENTS.md` and enforced locally:
  1. `cargo test --workspace` (must pass with 0 warnings).
  2. `cargo clippy --workspace -- -D warnings` (must pass with 0 warnings).

---

## 4. Verification & Diagnostic Mapping (`box-doctor`)

The 10 diagnostic checks executed by `/usr/local/bin/box-doctor` inside the guest VM and their root causes / dependencies are mapped below:

| # | Check Name | Target Resource / Probe | Condition for PASS |
|---|---|---|---|
| 1 | `machine-id` | `/etc/machine-id` and `/var/lib/dbus/machine-id` | Both files exist, hold 32 hex chars, and match exactly. |
| 2 | `chrome` | `google-chrome-stable --version` | Google Chrome binary is installed on `PATH` and outputs version string. |
| 3 | `chrome-fds` | `/proc/<pid>/fd` for Chrome browser mains | Chrome open file descriptors remain below 90% of soft ulimit. |
| 4 | `egress` | `curl -fsS --max-time 8 https://www.google.com/generate_204` | Host TAP NAT routing (`172.30.0.1` -> host interface) and DNS resolution functional. |
| 5 | `clock` | `date -u +%Y` and HTTP Date skew check vs `google.com` | Host/guest paravirtualized kvm-clock in sync within 60s skew threshold. |
| 6 | `dbus` | `DBUS_SESSION_BUS_ADDRESS` or `dbus-launch` | D-Bus session bus active for user `box`. |
| 7 | `xvfb` | `xdpyinfo -display :1` | Xvfb virtual framebuffer listening on `:1` (1280x800x24). |
| 8 | `x11vnc` | TCP probe on port `5900` | x11vnc server listening and serving RFB stream on port 5900. |
| 9 | `novnc` | TCP probe on port `6080` | Websockify bridge listening on port 6080 and proxying to port 5900. |
| 10 | `compositor` | `pgrep -x xfwm4` and `pgrep -x picom` | Window manager (`xfwm4`) and XRender compositor (`picom`) running. |

---

## 5. Recommended Implementation Roadmap & File Changes

To satisfy Acceptance Criteria across R1–R4, the following targeted changes are recommended:

1. **`crates/frostfire-hypervisor/src/main.rs` & `Cargo.toml`**:
   - Fix `unused import: error` on line 19.
   - Add `PUT /machine-config` allocating 2 vCPUs and 4096 MiB RAM.
   - Detect host default interface for iptables NAT instead of hardcoding `eth0`.
   - Add serial console log capture/streaming.
   - Clean up socket files and TAP device on shutdown.
2. **`rootfs/build-rootfs.sh`**:
   - Add split binary recombination (`node.part.*` -> `node`, `origin.part.*` -> `origin`).
   - Copy entire `home-box/` hierarchy (`.config`, `.local`, `.profile`, `deps/`, `frostfire-host/`).
   - Copy `usr-share-backgrounds/` and `etc-policies/native-messaging-hosts/`.
   - Install and enable `frostfire-box.service` systemd unit for automatic boot startup.
   - Set `chmod 0440 /etc/sudoers.d/box`.
3. **`kernel/build-kernel.sh`**:
   - Ensure all options from `kernel/kernel.config` (including `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y` and `CONFIG_DEVTMPFS_MOUNT=y`) are applied deterministically.
4. **`scripts/` & `deploy/aws/poc-host.yaml`**:
   - Add `debian-archive-keyring` to package lists in UserData and `setup-host.sh`.
   - Provide helper logic in `deploy-poc.ps1` / `deploy-poc.sh` for EC2 KeyPair handling in `us-west-2`.
