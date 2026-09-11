# Original User Request

## Initial Request — 2026-09-10T21:16:43-06:00

Build and deploy Phase 1 of Frostfire for the User-Hosted VM on AWS: an EC2 Spot host running in us-west-2 with nested KVM, a monolithic Linux 6.12 kernel, a Debian 13 (Trixie) rootfs appliance populated with Frostfire guest daemons, a bare-metal Rust Firecracker hypervisor daemon (`frostfire-hypervisor`), and automated `box-doctor` verification.

Working directory: c:\Users\tyson\.repo\personal\frostfire-cloud (branch: poc/user-hosted-vm)
Integrity mode: development

## Requirements

### R1. AWS EC2 Spot Host Infrastructure & Full UserData Bootstrap
Deploy turnkey CloudFormation deployment automation (`deploy/aws/poc-host.yaml`) for a single-user POC host in `us-west-2`:
- EC2 Spot Nitro instance (`c6i.xlarge` or `c6a.xlarge`, 4 vCPUs, 8 GiB RAM, 50 GB gp3 EBS) with nested KVM (`/dev/kvm`).
- Complete UserData automated bootstrap installing Firecracker v1.10+, KVM permissions, Node 20, Rust, and toolchains directly on boot.
- Security Group exposing port 22 (SSH), port 1339 (Window Router), and port 6080 (noVNC) restricted to the user's public IP CIDR.
- Host auto-idle daemon (`/usr/local/bin/check-idle-shutdown.sh`) checking active socket sessions on ports 22 and 6080 every 5 minutes and shutting down after 20 minutes of inactivity to keep monthly costs under $5.
- Host dependency installer (`setup-host.sh`) setting up build toolchains, Firecracker binary, QEMU tools, debootstrap, and networking.
- Execute deployment using `scripts/deploy-poc.ps1` or AWS CloudFormation CLI in `us-west-2`.

### R2. Monolithic Linux 6.12 Kernel Build Pipeline
Implement and verify `build-kernel.sh` to compile an uncompressed monolithic ELF kernel binary (`vmlinux-6.12.6`):
- `CONFIG_MODULES=n` with all VirtIO drivers built-in (`VIRTIO_BLK`, `VIRTIO_NET`, `VIRTIO_VSOCK`, `VIRTIO_CONSOLE`, `VIRTIO_BALLOON`, `VIRTIO_MMIO`).
- In-tree support for Ext4, OverlayFS, FUSE, namespaces (PID, NET, IPC, UTS, USER), cgroups v2, and seccomp.
- Deterministic kernel config template stored in `kernel/kernel.config`.

### R3. Debian 13 (Trixie) Rootfs Appliance Image Pipeline
Implement and verify `build-rootfs.sh` generating an 8GB ext4 disk image (`rootfs.ext4`):
- Debootstrap Debian 13 (Trixie) with user `box` (UID 1000) and passwordless sudo.
- X11 GUI and display stack: Xvfb (display :1), xfwm4, picom, x11vnc (port 5900), novnc/websockify (port 6080).
- Google Chrome Stable with enterprise managed policies (`frostfire.json`, `frostfire-webauthn.json`).
- Injection and permission configuration of Frostfire guest scripts and daemons from repository assets (`usr-local-bin/`, `exec-daemon/`, `home-box/frostfire-host/`, `usr-local-share/`).

### R4. Bare-Metal Rust Firecracker Hypervisor Daemon (`frostfire-hypervisor`)
Implement and verify the host orchestrator crate in Rust using Tokio, Hyper, and Unix Domain Sockets:
- Manages TAP network interface `tap0` (`172.30.0.1/24`), guest IP `172.30.0.2`, and host NAT iptables masquerade.
- Controls Firecracker over `/tmp/firecracker.socket`: configures boot-source (`vmlinux`), root drive (`/dev/vda` rootfs), network interface (`eth0`), and AF_VSOCK bridge (`/tmp/vsock.sock`, guest CID 3).
- Issues `InstanceStart`, streams serial console logs, and handles clean signal shutdown (Ctrl+C).

## Acceptance Criteria

### Infrastructure & Host Setup
- [ ] CloudFormation / deploy script validates and launches an EC2 Spot `c6i.xlarge` instance with `/dev/kvm` accessible.
- [ ] Auto-idle script properly detects idle state on ports 22 and 6080.
- [ ] Host initialization script successfully installs all required dependencies.

### Kernel & Rootfs Build
- [ ] `build-kernel.sh` compiles an uncompressed `vmlinux-6.12.6` image without external kernel modules.
- [ ] `build-rootfs.sh` generates a bootable `rootfs.ext4` containing user `box`, Chrome, X11 stack, and Frostfire guest daemons.

### Hypervisor Execution & Guest Verification
- [ ] `cargo build --release` compiles `frostfire-hypervisor` with 0 warnings.
- [ ] `frostfire-hypervisor` boots the microVM, establishes TAP networking, and starts X11 / noVNC services.
- [ ] Inside the guest VM, `/usr/local/bin/box-doctor` runs and all 10 diagnostic checks pass (machine-id, chrome, chrome-fds, egress, clock, dbus, xvfb, x11vnc, novnc, compositor).
