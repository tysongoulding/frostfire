# Frostfire Cloud (User-Hosted VM & Firecracker MicroVM Infrastructure)

Host hypervisor daemon, kernel build pipeline, Debian 13 rootfs appliance, and turnkey AWS EC2 Spot deployment for the Frostfire User-Hosted VM.

## Architecture Layout

- `crates/`:
  - `frostfire-hypervisor/`: Bare-metal Rust hypervisor daemon orchestrating Firecracker microVMs over Unix Domain Sockets, TAP networking (`172.30.0.1/24`), and AF_VSOCK bridge.
- `kernel/`:
  - `build-kernel.sh`: Compiles an uncompressed monolithic Linux 6.12.6 ELF kernel (`vmlinux`, `CONFIG_MODULES=n`) with VirtIO drivers built in-tree.
  - `kernel.config`: Reproducible Firecracker kernel configuration.
- `rootfs/`:
  - `build-rootfs.sh`: Debootstrap pipeline building Debian 13 (Trixie) ext4 disk image with user `box`, X11 desktop environment, Chrome, and Frostfire guest agent daemons.
- `deploy/`:
  - `aws/poc-host.yaml`: CloudFormation template launching an EC2 Spot `c6i.xlarge` instance with nested KVM, locked Security Group, and auto-idle shutdown protection.
- `scripts/`:
  - `deploy-poc.ps1`: Automated PowerShell deployment script for AWS.
  - `deploy-poc.sh`: Automated Bash deployment script for AWS.
  - `setup-host.sh`: Host bootstrap script installing Firecracker, KVM permissions, toolchains, and networking.
  - `check-idle-shutdown.sh`: Host auto-idle daemon checking ports 22 and 6080 every 5 mins and halting instance after 20 mins inactivity (<$5/mo budget).

## Verification Gates

```bash
# Verify host hypervisor crate
cargo test --workspace
cargo clippy --workspace -- -D warnings

# Validate AWS CloudFormation template
aws cloudformation validate-template --template-body file://deploy/aws/poc-host.yaml
```
