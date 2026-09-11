# Handoff Report — Explorer Survey 1

## 1. Observation
- **Git Branch & Working Tree**: Branch is `poc/user-hosted-vm`. `git status` reports working directory clean except for untracked metadata in `.agents/`. The two top commits are `8ffdd89 feat(poc): initialize frostfire user-hosted vm infrastructure for aws` and `6a58196 refactor(guest): rename sand-host to frostfire-host and add frostfire aliases`.
- **Cargo Workspace**: `Cargo.toml` in workspace root contains `members = ["crates/frostfire-hypervisor"]`.
- **Cargo Test & Clippy (Host Windows)**:
  - `cargo test --workspace` exited code 0: `test result: ok. 2 passed; 0 failed; 0 ignored; finished in 0.00s`.
  - `cargo clippy --release -- -D warnings` exited code 0.
- **Cargo Clippy (Linux Target)**:
  - `rustup target add x86_64-unknown-linux-gnu` succeeded.
  - `cargo clippy --target x86_64-unknown-linux-gnu -- -D warnings` exited code 1 with:
    ```
    error: unused import: `error`
      --> crates\frostfire-hypervisor\src\main.rs:19:15
       |
    19 | use tracing::{error, info};
       |               ^^^^^
       |
       = note: `-D unused-imports` implied by `-D warnings`
    ```
- **Firecracker API Configuration in Hypervisor**:
  - `crates/frostfire-hypervisor/src/main.rs` lines 136-198 configure `/boot-source`, `/drives/rootfs`, `/network-interfaces/eth0`, `/vsock`, and `/actions` (`InstanceStart`).
  - `PUT /machine-config` is omitted entirely; Firecracker defaults to 1 vCPU and 128 MiB RAM if not explicitly configured.
  - `setup_networking()` hardcodes `iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE`, which fails on EC2 hosts where the default route interface is `ens5`.
- **Rootfs Pipeline Assets**:
  - `exec-daemon/node.part.*` (size 52MB+ each) and `exec-daemon/tools/origin.part.*` are split files. `exec-daemon/node.recombine.sh` exists but `rootfs/build-rootfs.sh` lines 78-80 copies `exec-daemon/` directly without recombining them, leaving `/exec-daemon/node` missing.
  - `rootfs/build-rootfs.sh` lines 82-85 only copies `home-box/frostfire-host/`, omitting `home-box/.config/`, `home-box/.local/`, `home-box/.profile`, and `home-box/deps/`.
  - `rootfs/build-rootfs.sh` does not install any systemd service to autostart `start-frostfire-box` on microVM boot.
- **Kernel Build Script**:
  - `kernel/build-kernel.sh` applies `scripts/config` overrides manually rather than utilizing `kernel/kernel.config`, omitting `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y` and `CONFIG_DEVTMPFS_MOUNT=y`.
- **AWS Infrastructure**:
  - `aws cloudformation validate-template --template-body file://deploy/aws/poc-host.yaml` exited code 0.
  - `aws ec2 describe-key-pairs --region us-west-2` returns `"KeyPairs": []` for Account `739275475035`.

## 2. Logic Chain
1. *From Observation (Linux Clippy failure)*: Line 19 of `crates/frostfire-hypervisor/src/main.rs` imports `error` from `tracing`, but `error` is never referenced in `crates/frostfire-hypervisor`. The project directive gate (`cargo clippy --workspace -- -D warnings`) fails on Linux until this unused import is removed.
2. *From Observation (Firecracker machine-config)*: Firecracker microVM documentation dictates that if `PUT /machine-config` is not invoked before `InstanceStart`, the microVM is allocated 1 vCPU and 128 MiB RAM. Because Debian 13 with Chrome, X11, and background daemons requires significantly more memory (>1 GB), the microVM will OOM crash on early boot unless `PUT /machine-config` is added with `vcpu_count: 2, mem_size_mib: 4096`.
3. *From Observation (Split binaries)*: Node.js scripts in `usr-local-bin/` (including `frostfire-window-router.mjs`) use `#!/exec-daemon/node`. Because `exec-daemon/node` is only present as split `.part.*` chunks in git, omitting the recombine step during rootfs build causes all Node services to fail with `ENOENT`.
4. *From Observation (Guest autostart)*: Firecracker boots the Linux kernel with `root=/dev/vda rw`. The kernel initializes `/sbin/init` (systemd). Without a configured systemd unit file (e.g. `/etc/systemd/system/frostfire-box.service`) enabled in `multi-user.target`, systemd reaches target without running `start-frostfire-box`, so Xvfb, x11vnc, websockify, and box-doctor never start.
5. *From Observation (AWS KeyPair)*: CloudFormation deployment expects parameter `KeyName: Type: AWS::EC2::KeyPair::KeyName`. Because no KeyPairs exist in `us-west-2`, running `deploy-poc.ps1` or `deploy-poc.sh` without first generating or supplying a valid KeyPair will fail CloudFormation parameter validation.

## 3. Caveats
- AWS EC2 instance launch was not executed during this survey turn to avoid unnecessary EC2 Spot billing.
- Full kernel compilation (`make -j$(nproc) vmlinux`) was verified structurally and via configuration inspection rather than compiling on the local Windows machine, as Linux kernel compilation requires a Linux toolchain (`gcc/clang`, `bison`, `flex`, `libelf`).
- MicroVM live boot verification requires the Linux KVM device (`/dev/kvm`), which will be executed on the EC2 Spot Nitro host.

## 4. Conclusion
The codebase is in an advanced state with core scaffolding implemented for R1 through R4, but contains 5 critical blocking issues that must be addressed prior to or during live host execution:
1. Fix unused import `error` in `crates/frostfire-hypervisor/src/main.rs` to satisfy the Linux clippy gate.
2. Add `PUT /machine-config` (2 vCPUs, 4096 MiB RAM) to `crates/frostfire-hypervisor/src/main.rs`.
3. Add split binary recombine (`node.part.*` -> `node`) and copy full `home-box/` hierarchy in `rootfs/build-rootfs.sh`.
4. Add and enable a systemd service (`frostfire-box.service`) in `rootfs/build-rootfs.sh` so `start-frostfire-box` runs automatically on boot.
5. Provide automatic EC2 KeyPair creation or validation in `scripts/deploy-poc.ps1` and `scripts/deploy-poc.sh`.

## 5. Verification Method
1. **Clippy Gate**: Run `cargo clippy --target x86_64-unknown-linux-gnu -- -D warnings` from repo root. Must exit 0 with 0 warnings.
2. **Hypervisor Tests**: Run `cargo test --workspace`. Must pass all tests.
3. **CloudFormation Template**: Run `aws cloudformation validate-template --template-body file://deploy/aws/poc-host.yaml`. Must exit 0.
4. **Survey Artifact**: Verify `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_1\survey_report.md` exists and contains complete analysis.
