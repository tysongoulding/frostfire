# Handoff Report: Explorer Survey 2 (Kernel & Rootfs Pipeline Specs & Assets)

## 1. Observation

1. **Kernel Build Pipeline (`kernel/build-kernel.sh` & `kernel/kernel.config`)**:
   - In `kernel/build-kernel.sh` lines 22-65:
     ```bash
     echo ">>> Generating base defconfig..."
     make defconfig

     echo ">>> Applying monolithic Firecracker kernel parameters (CONFIG_MODULES=n)..."
     scripts/config --disable CONFIG_MODULES
     ...
     make olddefconfig
     make -j"$(nproc)" vmlinux
     cp vmlinux "${OUT_DIR}/vmlinux-${KERNEL_VER}"
     ```
     `build-kernel.sh` does not copy or merge `kernel/kernel.config`. Any changes made to `kernel/kernel.config` are ignored by `build-kernel.sh`.
   - In `crates/frostfire-hypervisor/src/main.rs` lines 138-141:
     ```rust
     let boot_args = format!(
         "console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw quiet ip={}::{}:255.255.255.0::eth0:off",
         self.config.guest_ip, self.config.host_ip
     );
     ```
     Neither `kernel/kernel.config` nor `kernel/build-kernel.sh` enables `CONFIG_IP_PNP=y`. Without `CONFIG_IP_PNP=y`, the Linux kernel does not parse or configure the `ip=` boot argument at boot.
   - In `kernel/build-kernel.sh`, `CONFIG_DEVTMPFS=y` and `CONFIG_DEVTMPFS_MOUNT=y` are omitted (although present in `kernel/kernel.config`). Without `CONFIG_DEVTMPFS_MOUNT=y`, the monolithic kernel does not mount `/dev` automatically at boot.
   - In `usr-local-bin/box-cgroups.sh` lines 29-34 & 89-92:
     ```bash
     sand_cgroup_v2_cpu_available() {
         local controllers="${SAND_CGROUP_ROOT}/cgroup.controllers"
         [ -r "${controllers}" ] || return 1
         grep -qw cpu "${controllers}" 2>/dev/null || return 1
         return 0
     }
     ...
     sand_cgroup_write "${weight}" "${SAND_CGROUP_ROOT}/${group}/cpu.weight"
     ```
     In Linux cgroup v2, managing `cpu.weight` requires `CONFIG_CGROUP_SCHED=y` AND `CONFIG_FAIR_GROUP_SCHED=y`. Neither `kernel.config` nor `build-kernel.sh` explicitly enables `CONFIG_FAIR_GROUP_SCHED=y` or `CONFIG_CFS_BANDWIDTH=y`.
   - Firecracker microVMs require fast entropy at boot; neither `CONFIG_HW_RANDOM_VIRTIO=y` nor `CONFIG_RANDOM_TRUST_CPU=y` is enabled.

2. **Debian 13 Rootfs Pipeline (`rootfs/build-rootfs.sh`)**:
   - In `rootfs/build-rootfs.sh` lines 70-100:
     - No systemd unit file is generated or enabled. The rootfs relies on Debian's default `/sbin/init` (systemd), but without `/etc/systemd/system/frostfire.service`, no service starts `start-frostfire-box` or `start-desktop.sh` on boot.
     - Lines 78-80:
       ```bash
       if [ -d "${ROOT_DIR}/exec-daemon" ]; then
         sudo cp -r "${ROOT_DIR}/exec-daemon/"* "${MOUNT_DIR}/exec-daemon/"
       fi
       ```
       In `exec-daemon/`, the `node` binary is split into `node.part.aa` (52.4 MB), `node.part.ab` (52.4 MB), and `node.part.ac` (15.3 MB), and `exec-daemon/node.recombine.sh` exists:
       ```bash
       cat ./exec-daemon/node.part.* > ./exec-daemon/node && chmod +x ./exec-daemon/node
       ```
       `build-rootfs.sh` never runs this recombination. Therefore `/exec-daemon/node` does not exist in `rootfs.ext4`, breaking all Node daemons.
     - Lines 82-85:
       ```bash
       if [ -d "${ROOT_DIR}/home-box/frostfire-host" ]; then
         sudo cp -r "${ROOT_DIR}/home-box/frostfire-host/"* "${MOUNT_DIR}/home/box/frostfire-host/"
         sudo ln -sfn /home/box/frostfire-host "${MOUNT_DIR}/home/box/sand-host"
       fi
       ```
       `build-rootfs.sh` only copies `home-box/frostfire-host/*`. It omits `home-box/.config/` (XFCE, Plank, dconf, Chrome settings), `home-box/.local/` (desktop launcher files), `home-box/deps/` (native modules for host agent), and `home-box/.bashrc` / `.profile`.
     - Lines 91-95: Copies `etc-policies/policies/managed/*.json`, but omits `etc-policies/native-messaging-hosts/*.json` (which belongs in `/etc/opt/chrome/native-messaging-hosts/`).
     - Omits `usr-share-backgrounds/*` (referenced by `start-desktop.sh` line 111: `hsetroot -cover /usr/share/backgrounds/cursor-box-wallpaper.jpg`).
     - In lines 43-51 (`apt-get install`), the packages `plank` (dock), `hsetroot` (wallpaper), `fuse3` / `libfuse2t64` (for `cursor-agent-store-fuse`), and `dconf-cli` are not installed.
     - Chroot configuration does not bind mount `/proc`, `/sys`, `/dev` before running `apt-get`, and does not configure `/usr/sbin/policy-rc.d` (`exit 101`).
     - There is no static IP configuration for `eth0` or nameservers in `/etc/resolv.conf`.

3. **Box-Doctor Diagnostic Checks (`usr-local-bin/box-doctor`)**:
   - `box-doctor` evaluates 10 checks:
     1. `check_machine_id`: verifies `/etc/machine-id` (32 hex characters) and agrees with `/var/lib/dbus/machine-id`.
     2. `check_chrome`: verifies `google-chrome-stable --version`.
     3. `check_chrome_fds`: verifies browser process open fd count < 90% soft limit.
     4. `check_egress`: curls `https://www.google.com/generate_204`.
     5. `check_clock`: verifies year is 2024-2100 and clock skew vs Google HTTP Date header is <= 60 seconds.
     6. `check_dbus`: verifies `DBUS_SESSION_BUS_ADDRESS` or `dbus-launch`.
     7. `check_xvfb`: verifies `xdpyinfo -display :1` responds.
     8. `check_x11vnc`: verifies TCP listening on port 5900.
     9. `check_novnc`: verifies TCP listening on port 6080.
     10. `check_compositor`: verifies `pgrep -x xfwm4` and `pgrep -x picom`.
   - All 10 checks will pass if the rootfs and kernel gaps identified above are resolved and `start-frostfire-box` runs on boot.

---

## 2. Logic Chain

1. **Kernel Configuration**:
   - Firecracker boots Linux by loading an uncompressed ELF kernel into memory and passing command line arguments:
     `console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw quiet ip=172.30.0.2::172.30.0.1:255.255.255.0::eth0:off` (from `crates/frostfire-hypervisor/src/main.rs:139`).
   - The Linux kernel only parses `ip=` if `CONFIG_IP_PNP=y` is compiled into the monolithic kernel. Without it, the network interface `eth0` remains unconfigured unless userspace network daemons configure it.
   - Because `CONFIG_MODULES=n`, no drivers can be dynamically loaded via `.ko` modules. Every driver (`VIRTIO_BLK`, `VIRTIO_NET`, `VIRTIO_MMIO`, `EXT4_FS`, `OVERLAY_FS`, `FUSE_FS`, `DEVTMPFS`, etc.) must have `=y`.
   - `build-kernel.sh` must merge `kernel/kernel.config` rather than maintaining a duplicate and out-of-sync list of `scripts/config` calls.

2. **Rootfs Construction**:
   - Debian 13 (Trixie) installed via `debootstrap` provides a minimal systemd base system.
   - When Firecracker boots the guest kernel with `root=/dev/vda rw`, the kernel starts `/sbin/init` (systemd).
   - If no systemd service is installed and enabled, systemd reaches `multi-user.target` without starting any user services.
   - For X11, noVNC, and `exec-daemon` to run automatically, a systemd service (`frostfire.service`) must be installed in `/etc/systemd/system/` and enabled via `systemctl enable`.
   - The primary entrypoint `/usr/local/bin/start-frostfire-box` calls `start-desktop.sh`, which launches Xvfb on `:1`, `x11vnc` on port 5900, `websockify` on port 6080, `xfwm4`, `picom`, and `box-plank`.
   - Because `/exec-daemon/node` is called repeatedly throughout the startup sequence (lines 275, 280, 282, 286, 290, 298, 303, 305, 333, 337, 405, 423 of `start-frostfire-box`), `node.part.*` must be concatenated into an executable `node` binary during the rootfs build.
   - `home-box/.config`, `.local`, `deps`, and dotfiles must be copied so that `box` user desktop environments and node dependencies exist.

3. **Diagnostic Passing (`box-doctor`)**:
   - Egress requires `eth0` configured to `172.30.0.2`, gateway `172.30.0.1`, and working DNS in `/etc/resolv.conf`.
   - Clock skew requires paravirtual KVM clock (`CONFIG_KVM_CLOCK=y`).
   - Display checks (Xvfb, x11vnc, novnc, compositor) require the services spawned by `start-desktop.sh`.
   - Machine ID requires `/etc/machine-id` and `/var/lib/dbus/machine-id` to exist and agree.

---

## 3. Caveats

1. **Kernel Compilation Time**: Compiling Linux 6.12.6 from source on an EC2 `c6i.xlarge` instance (4 vCPUs) takes ~8-12 minutes. The build script must use `make -j$(nproc)` and should avoid rebuilding if `build/kernel/out/vmlinux-6.12.6` already exists.
2. **Debootstrap Architecture**: `build-rootfs.sh` uses `debootstrap --arch=amd64 trixie`. Debian 13 (Trixie) is the current testing distribution; package versions may update upstream, so packages should be installed from `http://deb.debian.org/debian`.
3. **No Code Modifications**: Per the Teamwork explorer role, no source code or scripts in the repository have been modified. All findings and proposed changes are documented in `survey_report.md` and this handoff.

---

## 4. Conclusion

The existing `build-kernel.sh` and `build-rootfs.sh` scripts provide a strong foundation, but require specific, high-impact fixes before Phase 1 POC can boot and pass `box-doctor`:
1. **Kernel**:
   - Sync `kernel/build-kernel.sh` to merge `kernel/kernel.config`.
   - Add `CONFIG_IP_PNP=y`, `CONFIG_DEVTMPFS_MOUNT=y`, `CONFIG_FAIR_GROUP_SCHED=y`, `CONFIG_CFS_BANDWIDTH=y`, `CONFIG_CGROUP_PIDS=y`, `CONFIG_HW_RANDOM_VIRTIO=y`, and `CONFIG_RANDOM_TRUST_CPU=y` to `kernel/kernel.config`.
2. **Rootfs**:
   - Add `frostfire.service` systemd unit and enable it on boot.
   - Recombine `exec-daemon/node.part.*` into `/exec-daemon/node` (`chmod +x`).
   - Copy entire `home-box/` tree (`.config`, `.local`, `deps`, dotfiles), `usr-share-backgrounds/`, and `etc-policies/native-messaging-hosts/`.
   - Add packages: `plank`, `hsetroot`, `fuse3`, `libfuse2t64`, `dconf-cli`.
   - Bind-mount `/proc`, `/sys`, `/dev` in chroot and set `/usr/sbin/policy-rc.d`.
   - Configure `/etc/resolv.conf` and static network config for `eth0`.

---

## 5. Verification Method

To independently verify these findings:
1. **Inspect Kernel Config Discrepancy**:
   - Run: `diff <(grep -E "^CONFIG_" kernel/kernel.config | sort) <(grep -E "scripts/config --enable" kernel/build-kernel.sh | awk '{print $3"=y"}' | sort)`
   - Observe that `CONFIG_DEVTMPFS`, `CONFIG_DEVTMPFS_MOUNT`, and `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES` appear in `kernel.config` but are missing in `build-kernel.sh`.
   - Observe that `CONFIG_IP_PNP` is missing in both files.
2. **Verify Node Split State**:
   - Inspect: `ls -la exec-daemon/node*`
   - Observe `node.part.aa`, `node.part.ab`, `node.part.ac`, and `node.recombine.sh`, but no `node` binary.
3. **Verify Rootfs Asset Copy Scope**:
   - Inspect: `rootfs/build-rootfs.sh` lines 70-98.
   - Observe that `home-box/.config`, `usr-share-backgrounds`, and `etc-policies/native-messaging-hosts` are never copied, and no systemd service is created.
4. **Diagnostic Verification in Guest**:
   - After applying fixes and compiling kernel/rootfs, execute `/usr/local/bin/box-doctor` inside the guest microVM.
   - Expected output: `[box-doctor] SUMMARY: 10 checks, 0 failed` with exit code `0`.
