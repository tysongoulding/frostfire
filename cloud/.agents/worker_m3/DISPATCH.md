# Dispatch: Worker M3 (Debian 13 Rootfs Appliance Pipeline)

**Identity**: `worker_m3` (Archetype: `teamwork_preview_worker`)
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m3`
**Workspace Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud`

You MUST read the authoritative user request at:
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`

Also read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md` and the survey report at:
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_2\survey_report.md`

### Write Ownership
You exclusively own:
- `rootfs/build-rootfs.sh`

Do NOT touch files in `deploy/`, `scripts/`, `kernel/`, `crates/`, or `tests/`.

### Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

### Mission & Tasks
Implement and verify R3 (Debian 13 Trixie Rootfs Appliance Image Pipeline):
1. **`rootfs/build-rootfs.sh`**:
   - Builds an 8GB raw ext4 image (`build/rootfs.ext4`) via debootstrap Debian 13 (Trixie).
   - Creates user `box` (UID 1000, GID 1000) with passwordless sudo (`chmod 0440 /etc/sudoers.d/box`).
   - Fix split binary recombination: Recombine `exec-daemon/node.part.*` into `node` and `exec-daemon/tools/origin.part.*` into `tools/origin` with `chmod +x`.
   - Copy entire `home-box/` tree (including `.config/`, `.local/`, `.profile`, `deps/`, `frostfire-host/`) to `/home/box/` and `chown -R 1000:1000`.
   - Copy `usr-share-backgrounds/` to `/usr/share/backgrounds/`.
   - Copy `etc-policies/native-messaging-hosts/` to `/etc/opt/chrome/native-messaging-hosts/` and Chrome managed policies to `/etc/opt/chrome/policies/managed/`.
   - Copy `usr-local-bin/` to `/usr/local/bin/` with `chmod +x`.
   - Install all required APT packages: `xvfb`, `xfwm4`, `picom`, `x11vnc`, `websockify`, `novnc`, `plank`, `hsetroot`, `dconf-cli`, `fuse3`, `libfuse2t64`, `google-chrome-stable`, `dbus`, `dbus-x11`, `xdotool`, `procps`, `net-tools`, `iproute2`, `curl`.
   - Install and enable `/etc/systemd/system/frostfire-box.service` systemd unit running `/usr/local/bin/start-frostfire-box` on boot.
   - Configure `/etc/resolv.conf` (`nameserver 8.8.8.8`) and static `eth0` network interface.
   - Ensure proper chroot mount hygiene: mount `/proc`, `/sys`, `/dev`, `/dev/pts` with trap cleanup, and use `/usr/sbin/policy-rc.d` (`exit 101`) guard during package installation.

Write your completion report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m3\handoff.md` and notify parent orchestrator via `send_message`.

## 2026-09-11T03:23:43Z
Implement and verify R3 (Debian 13 Rootfs Appliance Pipeline):
1. Update rootfs/build-rootfs.sh:
   - Debootstrap Debian 13 (Trixie), 8GB ext4 image.
   - User box (UID 1000) with passwordless sudo (chmod 0440 /etc/sudoers.d/box).
   - Recombine split binaries: exec-daemon/node and tools/origin.
   - Inject entire home-box/ tree (.config/, .local/, .profile, deps/, frostfire-host/) to /home/box/.
   - Inject usr-share-backgrounds/ and etc-policies/native-messaging-hosts/.
   - Install all GUI and support packages: xvfb, xfwm4, picom, x11vnc, websockify, novnc, plank, hsetroot, dconf-cli, fuse3, libfuse2t64, google-chrome-stable, dbus, dbus-x11, curl, etc.
   - Create and enable /etc/systemd/system/frostfire-box.service running start-frostfire-box on boot.
   - Configure static networking and /etc/resolv.conf (8.8.8.8).
   - Clean chroot mounts (/proc, /sys, /dev, /dev/pts) with trap cleanup and policy-rc.d guard.

