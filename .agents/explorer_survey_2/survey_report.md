# Survey Report: Monolithic Linux 6.12 Kernel & Debian 13 Rootfs Appliance (R2 & R3)

**Author**: `explorer_survey_2`  
**Date**: 2026-09-11  
**Scope**: Requirements R2 (Monolithic Linux 6.12 Kernel Pipeline) & R3 (Debian 13 Rootfs Appliance Image Pipeline)  
**Target Architecture**: Single-User POC on AWS EC2 Spot (`c6i.xlarge` / `c6a.xlarge`) with Firecracker v1.10+ microVM

---

## 1. Executive Summary

This investigation analyzed the repository specifications, scripts, configuration templates, and assets for **R2 (Monolithic Linux 6.12 Kernel)** and **R3 (Debian 13 Trixie Rootfs Appliance)**. 

### Core Findings
1. **Kernel Pipeline (R2)**: A working draft exists at `kernel/build-kernel.sh` and `kernel/kernel.config`. However, `build-kernel.sh` does not consume `kernel/kernel.config` directly; it runs `make defconfig` and executes individual `scripts/config` calls. Critical kernel configs are missing from the build script, notably `CONFIG_IP_PNP=y` (which allows the kernel to parse the `ip=172.30.0.2::...` bootline passed by `frostfire-hypervisor`), `CONFIG_DEVTMPFS_MOUNT=y` (required for `/dev` auto-mount at boot), and `CONFIG_FAIR_GROUP_SCHED=y` (required for cgroup v2 `cpu.weight` management in `box-cgroups.sh`).
2. **Rootfs Pipeline (R3)**: `rootfs/build-rootfs.sh` provides an initial debootstrap pipeline for Debian 13 (Trixie), creating user `box` and installing Chrome, X11 packages, and guest scripts. However, **six critical runtime blockers** were identified:
   - **No boot-time systemd service**: The rootfs has no service or script to launch the desktop or guest daemons on microVM boot; the VM would boot to an idle login prompt.
   - **Split Node.js binary**: `/exec-daemon/node` is committed as three uncombined parts (`node.part.aa`, `node.part.ab`, `node.part.ac`), but `build-rootfs.sh` never recombines them, breaking all guest Node.js daemons.
   - **Incomplete user `box` profile assets**: `home-box/.config/` (desktop, xfce4, plank, chrome settings), `home-box/.local/` (desktop launcher entries), and `home-box/deps/` (native host agent modules) are omitted by `build-rootfs.sh`.
   - **Missing wallpaper & Chrome native messaging host assets**: `usr-share-backgrounds/` and `etc-policies/native-messaging-hosts/` are omitted from the copy stage.
   - **Missing packages**: `plank` (dock), `hsetroot` (wallpaper renderer), `fuse3` / `libfuse2t64` (for `cursor-agent-store-fuse`), and `dconf-cli` are not installed.
   - **Debootstrap chroot isolation hazards**: `/proc`, `/sys`, and `/dev` are not mounted prior to running chroot commands, risking failures in package installation scripts.
3. **Diagnostic Alignment (`box-doctor`)**: The 10 diagnostic checks in `/usr/local/bin/box-doctor` (`machine-id`, `chrome`, `chrome-fds`, `egress`, `clock`, `dbus`, `xvfb`, `x11vnc`, `novnc`, `compositor`) directly map to the guest stack brought up by `start-frostfire-box` and `start-desktop.sh`. Once the identified gaps are addressed, all 10 checks can pass cleanly.

---

## 2. Monolithic Linux 6.12 Kernel Analysis (R2)

### 2.1 Component Overview
* **Build Script**: `kernel/build-kernel.sh` (68 lines)
* **Configuration Template**: `kernel/kernel.config` (61 lines)
* **Target Version**: Linux `6.12.6` (`linux-6.12.6.tar.xz` from `cdn.kernel.org`)
* **Output Format**: Monolithic ELF uncompressed binary: `build/kernel/out/vmlinux-6.12.6`
* **Consumer**: `crates/frostfire-hypervisor/src/main.rs` (`PathBuf::from("./build/kernel/out/vmlinux-6.12.6")`)

### 2.2 Driver & Feature Requirements Matrix

| Subsystem / Driver | Kernel Config Symbol | Status in `kernel.config` | Status in `build-kernel.sh` | Assessment / Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **Modules Disabled** | `CONFIG_MODULES=n` | `# CONFIG_MODULES is not set` | `scripts/config --disable CONFIG_MODULES` | **Compliant**: Pure monolithic binary. |
| **KVM Guest** | `CONFIG_KVM_GUEST=y` | `CONFIG_KVM_GUEST=y` | `scripts/config --enable CONFIG_KVM_GUEST` | **Compliant**: Paravirtualized clock and KVM extensions. |
| **VirtIO Core** | `CONFIG_VIRTIO=y` | `CONFIG_VIRTIO=y` | `scripts/config --enable CONFIG_VIRTIO` | **Compliant**. |
| **VirtIO MMIO** | `CONFIG_VIRTIO_MMIO=y` | `CONFIG_VIRTIO_MMIO=y` | `scripts/config --enable CONFIG_VIRTIO_MMIO` | **Compliant**: Required for Firecracker microVMs. |
| **VirtIO MMIO Cmdline** | `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y` | `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y` | **MISSING** | **Gap**: Must be added to `build-kernel.sh`. |
| **VirtIO PCI** | `CONFIG_VIRTIO_PCI=y` | `CONFIG_VIRTIO_PCI=y` | `scripts/config --enable CONFIG_VIRTIO_PCI` | **Compliant**. |
| **VirtIO Block** | `CONFIG_VIRTIO_BLK=y` | `CONFIG_VIRTIO_BLK=y` | `scripts/config --enable CONFIG_VIRTIO_BLK` | **Compliant**: Drives rootfs on `/dev/vda`. |
| **VirtIO Net** | `CONFIG_VIRTIO_NET=y` | `CONFIG_VIRTIO_NET=y` | `scripts/config --enable CONFIG_VIRTIO_NET` | **Compliant**: Drives TAP interface on `eth0`. |
| **VirtIO VSOCK** | `CONFIG_VIRTIO_VSOCK=y`<br>`CONFIG_VSOCKETS=y` | `CONFIG_VIRTIO_VSOCK=y`<br>`CONFIG_VSOCKETS=y` | Both enabled | **Compliant**: Inter-VM vsock bridge (`CID 3`). |
| **VSOCK Loopback** | `CONFIG_VSOCKETS_LOOPBACK=y` | **MISSING** | **MISSING** | **Recommendation**: Enable for in-guest vsock testing. |
| **VirtIO Console** | `CONFIG_VIRTIO_CONSOLE=y` | `CONFIG_VIRTIO_CONSOLE=y` | `scripts/config --enable CONFIG_VIRTIO_CONSOLE` | **Compliant**: Serial console output. |
| **VirtIO Balloon** | `CONFIG_VIRTIO_BALLOON=y` | `CONFIG_VIRTIO_BALLOON=y` | `scripts/config --enable CONFIG_VIRTIO_BALLOON` | **Compliant**: Dynamic memory reclamation. |
| **VirtIO RNG & Entropy** | `CONFIG_HW_RANDOM_VIRTIO=y`<br>`CONFIG_RANDOM_TRUST_CPU=y` | **MISSING** | **MISSING** | **Critical Gap**: Needed so microVM entropy does not stall SSL/SSH/Chrome boots. |
| **Ext4 Filesystem** | `CONFIG_EXT4_FS=y`<br>`CONFIG_EXT4_FS_POSIX_ACL=y`<br>`CONFIG_EXT4_FS_SECURITY=y` | All 3 present | Only `EXT4_FS` enabled | **Gap**: Enable POSIX ACLs and security xattrs in script. |
| **OverlayFS** | `CONFIG_OVERLAY_FS=y` | `CONFIG_OVERLAY_FS=y` | `scripts/config --enable CONFIG_OVERLAY_FS` | **Compliant**: Instant CoW branching. |
| **FUSE Filesystem** | `CONFIG_FUSE_FS=y` | `CONFIG_FUSE_FS=y` | `scripts/config --enable CONFIG_FUSE_FS` | **Compliant**: Required by `cursor-agent-store-fuse`. |
| **Devtmpfs Auto-Mount** | `CONFIG_DEVTMPFS=y`<br>`CONFIG_DEVTMPFS_MOUNT=y` | Both present | **MISSING** | **Critical Gap**: Kernel must populate `/dev` at boot without an initramfs. |
| **Cgroups v2 Base** | `CONFIG_CGROUPS=y`<br>`CONFIG_MEMCG=y`<br>`CONFIG_CPUSETS=y` | All present | All present | **Compliant**. |
| **Cgroups Fair Scheduler** | `CONFIG_FAIR_GROUP_SCHED=y`<br>`CONFIG_CFS_BANDWIDTH=y` | **MISSING** | **MISSING** | **Critical Gap**: Required for `cpu.weight` in `box-cgroups.sh`. |
| **Cgroups PIDs Controller** | `CONFIG_CGROUP_PIDS=y` | **MISSING** | **MISSING** | **Recommendation**: Enforces process limits in cgroup v2. |
| **Namespaces** | `NAMESPACES`, `USER_NS`, `NET_NS`, `PID_NS`, `IPC_NS`, `UTS_NS` | All present | All present | **Compliant**. |
| **Cgroup Namespaces** | `CONFIG_CGROUP_NS=y` | **MISSING** | **MISSING** | **Recommendation**: Isolate cgroup hierarchies in guest containers. |
| **Seccomp** | `CONFIG_SECCOMP=y`<br>`CONFIG_SECCOMP_FILTER=y` | Both present | Both present | **Compliant**. |
| **IP Autoconfig** | `CONFIG_IP_PNP=y`<br>`CONFIG_IP_PNP_DHCP=y`<br>`CONFIG_IP_PNP_BOOTP=y` | **MISSING** | **MISSING** | **Critical Gap**: Required for kernel to parse `ip=172.30.0.2::...` bootline. |
| **PTY Support** | `CONFIG_UNIX98_PTYS=y` | Implicit in defconfig | Implicit in defconfig | **Explicitly pin**: Essential for `exec-daemon` pseudo-terminals. |

### 2.3 Kernel Build Discrepancies & Recommendations
1. **Config Determinism & Pipeline Synchronization**:
   - In `kernel/build-kernel.sh`, replace the manual ad-hoc `scripts/config` calls by copying or merging `kernel/kernel.config`:
     ```bash
     # Copy template and let Kconfig reconcile dependencies
     cp "${ROOT_DIR}/kernel/kernel.config" .config
     make olddefconfig
     ```
     Or use the kernel's built-in merge tool:
     ```bash
     make defconfig
     scripts/kconfig/merge_config.sh -m .config "${ROOT_DIR}/kernel/kernel.config"
     make olddefconfig
     ```
2. **Update `kernel/kernel.config` with Missing Symbols**:
   Add the following options to `kernel/kernel.config`:
   ```ini
   # Networking IP Autoconfiguration (for ip= bootline)
   CONFIG_IP_PNP=y
   CONFIG_IP_PNP_DHCP=y
   CONFIG_IP_PNP_BOOTP=y

   # Device filesystem automounting without initramfs
   CONFIG_DEVTMPFS=y
   CONFIG_DEVTMPFS_MOUNT=y

   # Cgroup v2 fair scheduler & process limiting
   CONFIG_FAIR_GROUP_SCHED=y
   CONFIG_CFS_BANDWIDTH=y
   CONFIG_CGROUP_PIDS=y
   CONFIG_CGROUP_NS=y

   # Entropy & Hardware Random
   CONFIG_HW_RANDOM=y
   CONFIG_HW_RANDOM_VIRTIO=y
   CONFIG_RANDOM_TRUST_CPU=y

   # Terminal PTY support
   CONFIG_UNIX98_PTYS=y
   ```

---

## 3. Debian 13 (Trixie) Rootfs Appliance Analysis (R3)

### 3.1 Component Overview
* **Build Script**: `rootfs/build-rootfs.sh` (101 lines)
* **Target OS**: Debian 13 (Trixie) `amd64`
* **Target Image**: 8192 MB (8 GiB) ext4 image (`build/rootfs.ext4`)
* **Default User**: `box` (UID: 1000, GID: 1000) with passwordless `sudo`
* **Host Consumer**: `frostfire-hypervisor` attaches drive at `/dev/vda`

### 3.2 Display Stack & Process Hierarchy
When properly orchestrated, the guest VM process tree executes as follows:
```
systemd (PID 1)
  └─► frostfire.service (systemd unit)
        └─► /usr/local/bin/start-frostfire-box
              ├─► /usr/local/bin/start-desktop.sh (Display :1)
              │     ├─► box-xvfb :1 (1280x800x24)
              │     ├─► box-x11vnc (port 5900)
              │     ├─► websockify 0.0.0.0:6080 -> localhost:5900
              │     ├─► box-xfwm4 --compositor=off
              │     ├─► box-picom --backend xrender --no-vsync --no-use-damage
              │     └─► box-plank --name dock1
              ├─► websockify 0.0.0.0:6081 (tokenized multi-display VNC)
              ├─► sand-window-router.mjs (port 1339)
              ├─► sand-session-sync.mjs (CDP session sync across displays)
              ├─► sand-ua-governor.mjs (anti-bot user-agent governor)
              ├─► sand-cookie-persist.mjs (cookie snapshot persistence)
              ├─► supervise-exec-daemon (port 1337)
              │     └─► /exec-daemon/exec-daemon serve ...
              ├─► /usr/local/bin/box-doctor (health verification suite)
              └─► sand-exit-watch (Python subreaper & crash telemetry)
```

### 3.3 Rootfs Pipeline Gap Analysis

#### Gap 1: No Boot-Time Systemd Unit for Frostfire Services (Critical)
* **Observation**: `rootfs/build-rootfs.sh` populates `/usr/local/bin/` and `/exec-daemon/`, but defines zero systemd services, init scripts, or `/etc/rc.local`.
* **Impact**: The microVM will boot to `/sbin/init` (systemd), start `agetty` on `ttyS0`, and sit idle. No X11, VNC, noVNC, or exec-daemon will ever start. `box-doctor` will fail.
* **Resolution**: In `build-rootfs.sh`, create and enable `/etc/systemd/system/frostfire.service`:
  ```ini
  [Unit]
  Description=Frostfire MicroVM Autonomous Agent & Desktop Supervisor
  After=network-online.target dbus.service
  Wants=network-online.target

  [Service]
  Type=simple
  User=root
  WorkingDirectory=/workspace
  Environment=HOME=/root
  Environment=SAND_USER_NON_ROOT=1
  ExecStart=/usr/local/bin/start-frostfire-box
  Restart=always
  RestartSec=3
  StandardOutput=journal+console
  StandardError=journal+console

  [Install]
  WantedBy=multi-user.target
  ```
  And inside chroot: `systemctl enable frostfire.service`.

#### Gap 2: Node.js Binary in `exec-daemon/` Is Split and Not Recombined (Critical)
* **Observation**: In `exec-daemon/`, the repository contains:
  - `node.part.aa` (52.4 MB)
  - `node.part.ab` (52.4 MB)
  - `node.part.ac` (15.3 MB)
  - `node.recombine.sh` (`cat ./exec-daemon/node.part.* > ./exec-daemon/node && chmod +x ./exec-daemon/node`)
  There is NO `node` binary present in `exec-daemon/`.
* **Impact**: All guest supervisor scripts (`start-frostfire-box`, `supervise-exec-daemon`, `sand-window-router.mjs`, `sand-session-sync.mjs`, `sand-ua-governor.mjs`) explicitly invoke `/exec-daemon/node`. Without recombination, every script fails with `No such file or directory`.
* **Resolution**: In `build-rootfs.sh`, after copying `exec-daemon/`, concatenate the parts:
  ```bash
  cat "${MOUNT_DIR}/exec-daemon/node.part."* > "${MOUNT_DIR}/exec-daemon/node"
  chmod +x "${MOUNT_DIR}/exec-daemon/node"
  chmod +x "${MOUNT_DIR}/exec-daemon/exec-daemon"
  ```

#### Gap 3: Missing Dotfiles and User Assets from `home-box/` (High)
* **Observation**: `build-rootfs.sh` lines 82-85 only copy `home-box/frostfire-host/*`. It omits:
  - `home-box/.config/` (contains XFCE4 desktop themes, Plank configurations, dconf profiles, Google Chrome default preferences)
  - `home-box/.local/share/applications/box-chrome.desktop` (application shortcut for Chrome)
  - `home-box/deps/` (native modules `@anysphere`, `tree-sitter`, `cursor-proclist`)
  - `home-box/.bashrc` & `.profile`
* **Impact**: The desktop environment lacks proper window decoration configurations, dock launchers, and runtime dependencies for the host agent.
* **Resolution**: Copy the entire `home-box/` tree:
  ```bash
  sudo cp -r "${ROOT_DIR}/home-box/." "${MOUNT_DIR}/home/box/"
  sudo ln -sfn /home/box/frostfire-host "${MOUNT_DIR}/home/box/sand-host"
  sudo chown -R 1000:1000 "${MOUNT_DIR}/home/box"
  ```

#### Gap 4: Missing Wallpaper Background Assets (Medium)
* **Observation**: `start-desktop.sh` line 111 falls back to `hsetroot -cover /usr/share/backgrounds/cursor-box-wallpaper.jpg`.
* **Impact**: The script attempts to set wallpaper from `/usr/share/backgrounds/cursor-box-wallpaper.jpg`, but `build-rootfs.sh` never copies `usr-share-backgrounds/`.
* **Resolution**:
  ```bash
  sudo mkdir -p "${MOUNT_DIR}/usr/share/backgrounds"
  sudo cp -r "${ROOT_DIR}/usr-share-backgrounds/"* "${MOUNT_DIR}/usr/share/backgrounds/"
  ```

#### Gap 5: Chrome Native Messaging Hosts Configuration (Medium)
* **Observation**: `etc-policies/native-messaging-hosts/` holds `co.anysphere.frostfire.webauthn_proxy.json` and `co.anysphere.sand.webauthn_proxy.json`.
* **Impact**: Chrome expects native messaging host manifests in `/etc/opt/chrome/native-messaging-hosts/`. Without them, the WebAuthn proxy bridge cannot connect to `/usr/local/bin/frostfire-webauthn-proxy-host`.
* **Resolution**:
  ```bash
  sudo mkdir -p "${MOUNT_DIR}/etc/opt/chrome/native-messaging-hosts"
  sudo cp "${ROOT_DIR}/etc-policies/native-messaging-hosts/"*.json "${MOUNT_DIR}/etc/opt/chrome/native-messaging-hosts/"
  ```

#### Gap 6: Debootstrap Chroot Isolation & Mount Management (High)
* **Observation**: `build-rootfs.sh` runs `chroot "${MOUNT_DIR}"` to execute `apt-get` without mounting `/proc`, `/sys`, or `/dev`.
* **Impact**: Modern Debian packages (especially `dbus`, `systemd`, `ca-certificates`, `google-chrome-stable`) rely on `/proc` and `/dev/urandom` during post-installation scripts (`postinst`). Running without them can cause subtle failures or hang during package configuration. Additionally, running background daemons during apt can prevent unmounting.
* **Resolution**:
  1. Add `/usr/sbin/policy-rc.d` with `exit 101` during the build to prevent daemons from auto-starting during package installation:
     ```bash
     echo '#!/bin/sh' | sudo tee "${MOUNT_DIR}/usr/sbin/policy-rc.d"
     echo 'exit 101' | sudo tee -a "${MOUNT_DIR}/usr/sbin/policy-rc.d"
     sudo chmod +x "${MOUNT_DIR}/usr/sbin/policy-rc.d"
     ```
  2. Bind-mount virtual filesystems prior to chroot:
     ```bash
     sudo mount -t proc proc "${MOUNT_DIR}/proc"
     sudo mount -t sysfs sys "${MOUNT_DIR}/sys"
     sudo mount --bind /dev "${MOUNT_DIR}/dev"
     sudo mount --bind /dev/pts "${MOUNT_DIR}/dev/pts"
     ```
  3. Ensure the exit trap unmounts in reverse order (`dev/pts`, `dev`, `sys`, `proc`, and rootfs loop mount), and removes `/usr/sbin/policy-rc.d`.

#### Gap 7: Missing Required Packages in `apt-get install` (Medium)
* **Observation**: `start-desktop.sh` and guest daemons invoke `plank`, `hsetroot`, `dconf`, and `cursor-agent-store-fuse`.
* **Impact**:
  - `plank` (dock): missing from package list.
  - `hsetroot` (wallpaper renderer): missing from package list.
  - `fuse3` / `libfuse2t64`: missing from package list, needed for FUSE filesystem mounts.
  - `dconf-cli`: needed by `start-desktop.sh` to configure Plank dock items.
* **Resolution**: Append `plank hsetroot fuse3 libfuse2t64 dconf-cli` to the `apt-get install` list in `build-rootfs.sh`.

#### Gap 8: Static Guest Networking & DNS Configuration (High)
* **Observation**: The hypervisor assigns `eth0: 172.30.0.2/24` with gateway `172.30.0.1`. If the kernel does not use `CONFIG_IP_PNP`, userspace must bring up `eth0`. Furthermore, `/etc/resolv.conf` is not explicitly set in the rootfs.
* **Impact**: `box-doctor` check 4 (`check_egress`) will fail with DNS or routing errors.
* **Resolution**:
  1. Populate `/etc/resolv.conf`:
     ```bash
     nameserver 8.8.8.8
     nameserver 1.1.1.1
     ```
  2. Configure `/etc/network/interfaces` or `/etc/systemd/network/10-eth0.network`:
     ```ini
     [Match]
     Name=eth0

     [Network]
     Address=172.30.0.2/24
     Gateway=172.30.0.1
     DNS=8.8.8.8 1.1.1.1
     ```
  3. Enable `systemd-networkd` inside the chroot: `systemctl enable systemd-networkd`.

---

## 4. Guest Daemons & Scripts Asset Inventory

The repository provides a rich set of guest utilities in `usr-local-bin/`. Below is the survey of essential daemons and their roles:

| Asset Name | Path | Size | Interpreter / Runtime | Function / Role |
| :--- | :--- | :--- | :--- | :--- |
| `start-frostfire-box` | `usr-local-bin/start-frostfire-box` | 20 KB | Bash | Primary guest supervisor entrypoint; orchestrates desktop bringup, cgroup isolation, session sync, exec-daemon, and telemetry. |
| `start-desktop.sh` | `usr-local-bin/start-desktop.sh` | 24 KB | Bash | Launches Xvfb (:1), x11vnc (:5900), novnc/websockify (:6080), xfwm4, picom, plank dock, and generates `box-chrome`. |
| `box-doctor` | `usr-local-bin/box-doctor` | 9.1 KB | Bash | 10-point diagnostic health check gating VM readiness. |
| `box-xvfb` | `usr-local-bin/box-xvfb` | 3.0 KB | Bash | Xvfb wrapper with stale lock and socket reaping defenses. |
| `box-xfwm4` | `usr-local-bin/box-xfwm4` | 3.6 KB | Bash | Window manager launcher with stale instance reaping. |
| `box-picom` | `usr-local-bin/box-picom` | 1.8 KB | Bash | Compositor launcher verifying `_NET_WM_CM_S0` selection owner. |
| `box-x11vnc` | `usr-local-bin/box-x11vnc` | 1.8 KB | Bash | VNC server launcher with port-holding socket reaper. |
| `box-plank` | `usr-local-bin/box-plank` | 1.1 KB | Bash / Python ctypes | Dock launcher waiting for compositor registration to prevent opaque slab rendering. |
| `box-chrome` | `usr-local-bin/box-chrome` | 8.6 KB | Bash | Google Chrome wrapper enforcing `--no-sandbox`, basic password store, CDP port assignment, and session symlinks. |
| `box-cgroups.sh` | `usr-local-bin/box-cgroups.sh` | 5.2 KB | Bash | Partitions cgroup v2 into `interactive` (weight 800) and `agent` slices. |
| `ensure-machine-id` | `usr-local-bin/ensure-machine-id` | 3.7 KB | Bash | Enforces valid 32-char hex UUID in `/etc/machine-id` and synchronizes `/var/lib/dbus/machine-id`. |
| `persist-cli-auth` | `usr-local-bin/persist-cli-auth` | 12 KB | Bash | Restores and mirrors developer credentials (`.ssh`, `.aws`, `.npmrc`, `.config/gh`) with strict 0700/0600 permissions. |
| `sand-exit-watch` / `frostfire-exit-watch` | `usr-local-bin/sand-exit-watch` | 9.7 KB | Python 3 | Subreaper and crash recorder; logs involuntary exits and signals. |
| `supervise-exec-daemon` | `usr-local-bin/supervise-exec-daemon` | 6.2 KB | Bash | Supervises the primary `exec-daemon` process on port 1337 with auto-restart and liveness checks. |
| `frostfire-window-router.mjs` | `usr-local-bin/frostfire-window-router.mjs` | 3.9 KB | Node.js | HTTP/WS multiplexer on port 1339 routing screens to per-display daemons (`14000 + N`). |
| `cursor-agent-store-fuse` | `usr-local-bin/cursor-agent-store-fuse` | 8.9 MB | ELF Binary | Remote FUSE agent storage driver. |
| `uv` / `uvx` | `usr-local-bin/uv` | 49 MB | ELF Binary | Fast Python package manager. |
| `exec-daemon` bundle | `exec-daemon/` | ~250 MB | Node.js / C++ addons | Core agent runtime (port 1337) with Computer Use, PTY, and Ripgrep search. |

---

## 5. `box-doctor` 10-Point Diagnostic Verification Matrix

Every check in `/usr/local/bin/box-doctor` has been traced to its specific underlying verification mechanism and system prerequisite:

| # | Check Name | Target Resource / Probe | Condition for PASS | Underlying Cause if FAILED |
|---|---|---|---|---|
| **1** | `machine-id` | `/etc/machine-id` & `/var/lib/dbus/machine-id` | File exists, exactly 32 lowercase hex chars, and `/var/lib/dbus/machine-id` identical. | Missing `/etc/machine-id`, length != 32, or D-Bus machine-id mismatch. Fixed by `ensure-machine-id`. |
| **2** | `chrome` | `google-chrome-stable --version` | Binary on PATH, exits 0, and prints non-empty version string. | Chrome not installed via Google apt repo or missing shared libraries (`libnss3`, etc.). |
| **3** | `chrome-fds` | `/proc/<pid>/fd` & `/limits` | All running Chrome main processes consume < 90% of soft fd limit (or no Chrome running). | File descriptor leak in Chrome browser or unreadable `/proc`. |
| **4** | `egress` | `curl -fsS --max-time 8 "https://www.google.com/generate_204"` | HTTP request returns success within 8 seconds. | No default route, TAP interface down, host NAT masquerade inactive, or `/etc/resolv.conf` DNS broken. |
| **5** | `clock` | System clock year & Date header from `https://www.google.com` | Year 2024–2100, and system time skew vs HTTP Date header is within ±60 seconds. | Kernel clock drift or RTC not initialized from host KVM clock (`CONFIG_KVM_CLOCK=y`). |
| **6** | `dbus` | `DBUS_SESSION_BUS_ADDRESS` or `dbus-launch` | Session bus address is set OR `dbus-launch` command is available on PATH. | Neither `dbus-daemon` session bus nor `dbus-x11` package is present. |
| **7** | `xvfb` | `xdpyinfo -display :1` | Command exits 0 (X display responds). | Xvfb failed to start, crashed, or stale lock `/tmp/.X1-lock` blocks startup. |
| **8** | `x11vnc` | TCP port 5900 (`/dev/tcp/127.0.0.1/5900`) | Port 5900 open and accepting TCP connections. | `x11vnc` not running or crashed due to display connection error. |
| **9** | `novnc` | TCP port 6080 (`/dev/tcp/127.0.0.1/6080`) | Port 6080 open and accepting TCP connections. | `websockify` not running or port 6080 already bound. |
| **10** | `compositor` | `pgrep -x xfwm4` AND `pgrep -x picom` | Both processes active in process table. | `xfwm4` crashed or `picom` failed to initialize (`--backend xrender` required on GPU-less Xvfb). |

---

## 6. Concrete Recommendations for Implementer Agent

### R2 (Kernel Implementation Plan):
1. **Update `kernel/kernel.config`**:
   Add missing symbols: `CONFIG_IP_PNP=y`, `CONFIG_IP_PNP_DHCP=y`, `CONFIG_IP_PNP_BOOTP=y`, `CONFIG_DEVTMPFS=y`, `CONFIG_DEVTMPFS_MOUNT=y`, `CONFIG_FAIR_GROUP_SCHED=y`, `CONFIG_CFS_BANDWIDTH=y`, `CONFIG_CGROUP_PIDS=y`, `CONFIG_CGROUP_NS=y`, `CONFIG_HW_RANDOM=y`, `CONFIG_HW_RANDOM_VIRTIO=y`, `CONFIG_RANDOM_TRUST_CPU=y`, `CONFIG_UNIX98_PTYS=y`.
2. **Refactor `kernel/build-kernel.sh`**:
   - Use `make defconfig` followed by `scripts/kconfig/merge_config.sh -m .config "${ROOT_DIR}/kernel/kernel.config"` and `make olddefconfig`.
   - Ensure the output path `${ROOT_DIR}/build/kernel/out/vmlinux-6.12.6` matches the `FirecrackerConfig` default path in `frostfire-hypervisor`.

### R3 (Rootfs Implementation Plan):
1. **Refactor `rootfs/build-rootfs.sh`**:
   - Install additional packages: `plank`, `hsetroot`, `fuse3`, `libfuse2t64`, `dconf-cli`.
   - Set up `/etc/systemd/system/frostfire.service` pointing to `/usr/local/bin/start-frostfire-box` and execute `systemctl enable frostfire.service` inside chroot.
   - Recombine `/exec-daemon/node` from `node.part.*` and `chmod +x`.
   - Copy entire `home-box/` directory into `/home/box/` and fix ownership (`box:box`).
   - Copy `usr-share-backgrounds/` to `/usr/share/backgrounds/`.
   - Copy `etc-policies/native-messaging-hosts/` to `/etc/opt/chrome/native-messaging-hosts/`.
   - Configure `/etc/resolv.conf` with `nameserver 8.8.8.8` and configure `eth0` static IP in `/etc/systemd/network/10-eth0.network`.
   - Wrap chroot commands with proper `/proc`, `/sys`, `/dev` bind mounts and `policy-rc.d` guard.
   - Create `/workspace` directory owned by `box:box`.

---
*Report completed by `explorer_survey_2` for Phase 1 POC implementation.*
