# Dispatch: Worker M2 (Monolithic Linux 6.12 Kernel Build Pipeline)

**Identity**: `worker_m2` (Archetype: `teamwork_preview_worker`)
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2`
**Workspace Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud`

You MUST read the authoritative user request at:
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`

Also read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md` and the survey report at:
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_2\survey_report.md`

### Write Ownership
You exclusively own:
- `kernel/kernel.config`
- `kernel/build-kernel.sh`

Do NOT touch files in `deploy/`, `scripts/`, `rootfs/`, `crates/`, or `tests/`.

### Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

### Mission & Tasks
Implement and verify R2 (Monolithic Linux 6.12 Kernel Build Pipeline):
1. **`kernel/kernel.config`**:
   - Single source of truth kernel configuration template.
   - `CONFIG_MODULES is not set` (`CONFIG_MODULES=n`).
   - Static VirtIO drivers: `VIRTIO_BLK`, `VIRTIO_NET`, `VIRTIO_VSOCK`, `VIRTIO_CONSOLE`, `VIRTIO_BALLOON`, `VIRTIO_MMIO`, `VIRTIO_MMIO_CMDLINE_DEVICES`.
   - Static filesystems: Ext4 (with POSIX ACL & security), OverlayFS, FUSE, devtmpfs (`CONFIG_DEVTMPFS=y`, `CONFIG_DEVTMPFS_MOUNT=y`).
   - Static namespaces (PID, NET, IPC, UTS, USER) and cgroups v2 (`CONFIG_FAIR_GROUP_SCHED=y`, `CONFIG_CFS_BANDWIDTH=y`, `CONFIG_CGROUP_PIDS=y`, `CONFIG_CGROUP_NS=y`).
   - Hardware RNG & entropy: `CONFIG_HW_RANDOM=y`, `CONFIG_HW_RANDOM_VIRTIO=y`, `CONFIG_RANDOM_TRUST_CPU=y`.
   - IP Autoconfig: `CONFIG_IP_PNP=y`, `CONFIG_IP_PNP_DHCP=y`, `CONFIG_IP_PNP_BOOTP=y` (to parse `ip=172.30.0.2::...` bootline).
   - Seccomp: `CONFIG_SECCOMP=y`, `CONFIG_SECCOMP_FILTER=y`.
   - PTY support: `CONFIG_UNIX98_PTYS=y`.
2. **`kernel/build-kernel.sh`**:
   - Refactor to consume `kernel/kernel.config` as the deterministic source of truth (`scripts/kconfig/merge_config.sh -m .config "${ROOT_DIR}/kernel/kernel.config"` or `cp` + `make olddefconfig`).
   - Target kernel version: Linux 6.12.6.
   - Output binary: uncompressed ELF binary at `build/kernel/out/vmlinux-6.12.6`.
   - Add verification checks inside script to ensure no kernel modules are built and all required static config symbols are active in final `.config`.

Write your completion report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2\handoff.md` and notify parent orchestrator via `send_message`.

## 2026-09-11T03:23:43Z
You are worker_m2.
Your working directory is: c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2
The workspace directory is: c:\Users\tyson\.repo\personal\frostfire-cloud

You MUST read the authoritative user request at:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md

Read your full dispatch instructions at:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2\DISPATCH.md

Your exclusive write ownership:
- kernel/kernel.config
- kernel/build-kernel.sh

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement and verify R2 (Monolithic Linux 6.12 Kernel Build Pipeline):
1. Update kernel/kernel.config with all required symbols: CONFIG_MODULES=n, VirtIO (BLK, NET, VSOCK, CONSOLE, BALLOON, MMIO, MMIO_CMDLINE), Ext4 (POSIX ACL, security), OverlayFS, FUSE, devtmpfs (DEVTMPFS, DEVTMPFS_MOUNT), namespaces, cgroups v2 (FAIR_GROUP_SCHED, CFS_BANDWIDTH, CGROUP_PIDS, CGROUP_NS), entropy (HW_RANDOM, HW_RANDOM_VIRTIO, RANDOM_TRUST_CPU), IP autoconfig (IP_PNP, IP_PNP_DHCP, IP_PNP_BOOTP), PTYs (UNIX98_PTYS), seccomp.
2. Refactor kernel/build-kernel.sh to use kernel/kernel.config deterministically.
3. Add verification assertions in build-kernel.sh to ensure monolithic ELF binary build.

Write your handoff report to:
c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2\handoff.md
And notify the parent orchestrator via send_message.
