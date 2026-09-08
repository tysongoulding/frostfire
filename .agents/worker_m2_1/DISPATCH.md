# Dispatch: Worker M2-1 (MicroVM Virtualization Infrastructure Implementation)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` and `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`.
Read the Explorer reports for Milestone 2:
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_1\handoff.md`
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_2\handoff.md`
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_3\handoff.md`

Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2_1`.

## Write Ownership
You exclusively own:
- `cloud/microvm/scripts/sand-exit-watch`
- `cloud/microvm/scripts/box-cgroups.sh`
- `cloud/microvm/scripts/sand-window-router.mjs`
- `cloud/microvm/scripts/link-chrome-session.sh`
- `cloud/microvm/scripts/cdp-cookies.mjs`
- `cloud/microvm/scripts/start-desktop.sh`
- `cloud/microvm/run-vm.sh`
- `cloud/microvm/build-rootfs.sh`
- `cloud/microvm/Dockerfile.rootfs` (if applicable)
- `.gitattributes`

## Tasks:
1. **In-VM Supervision (`cloud/microvm/scripts/sand-exit-watch`)**:
   - Implement Python subreaper supervisor using `PR_SET_CHILD_SUBREAPER` via `ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)`.
   - Implement non-blocking zombie process reaping (`os.waitpid(-1, os.WNOHANG)`).
   - Forward signals (`SIGTERM`, `SIGINT`, `SIGHUP`) to supervised children.
   - Implement crash-loop monitoring and exponential backoff restart for `frostfire-daemon`.
   - Make executable (`chmod +x` / Linux compatible).
2. **Cgroups v2 Partitioning (`cloud/microvm/scripts/box-cgroups.sh`)**:
   - Create and configure `/sys/fs/cgroup/interactive` (`cpu.weight=800`, `memory.high=4G`, `memory.max=6G`).
   - Create and configure `/sys/fs/cgroup/agent` (`cpu.weight=100`, `memory.high=10G`, `memory.max=12G`).
   - Migrate desktop processes to `interactive` slice.
   - Update `cloud/microvm/scripts/start-desktop.sh` to execute `box-cgroups.sh` and run under `sand-exit-watch`.
3. **OverlayFS CoW Rootfs Branching (`cloud/microvm/run-vm.sh` & `build-rootfs.sh`)**:
   - Implement Dual-Drive VirtIO architecture: golden base ext4 attached as read-only (`is_read_only: true`), and per-VM volatile sparse ext4 overlay attached as read-write (`is_read_only: false`).
   - Support guest OverlayFS mounting (`lowerdir`, `upperdir`, `workdir`).
4. **Multi-Display Router Hardening (`cloud/microvm/scripts/sand-window-router.mjs`)**:
   - Remove the unauthenticated bypass for display 1: ALL displays (including display 1) MUST require `x-sand-window-owner` with constant-time `tokensMatch` (`crypto.timingSafeEqual`).
   - Add `server.on('upgrade', ...)` to proxy WebSocket connections (PTY and VNC) to the target port.
   - Reject display numbers $< 1$ with HTTP 400.
5. **Chrome Session Linking (`cloud/microvm/scripts/link-chrome-session.sh`)**:
   - Guard against circular invocation (`PROFILE_DIR == SESSION_DIR`).
   - Clean up stale SQLite lock files (`-wal`, `-shm`, `-journal`).
   - Symlink `Cookies`, `Login Data`, `Login Data For Account` to secondary profile dirs. Set 0700 permissions.
6. **Live CDP Cookie Sync Daemon (`cloud/microvm/scripts/cdp-cookies.mjs`)**:
   - Implement complete daemon connecting to primary CDP port 9223, extracting cookies via `Network.getCookies`, filtering expired cookies, SHA-256 deduplicating against echo loops, stripping read-only fields, and syncing via `Network.setCookies` to ports 9224, 9225.
7. **Line-Ending Normalization (CRLF -> LF) & Verification**:
   - Convert all shell scripts (`run-vm.sh`, `build-rootfs.sh`, `start-desktop.sh`, `deploy/gcp/deploy-cloudrun.sh`, `deploy/proxmox/deploy-lxc.sh`, `scripts/gcp-setup-wizard.sh`, etc.) to Unix LF.
   - Ensure `bash -n` exits 0 on all scripts.
   - Add `.gitattributes` to preserve LF on shell and python scripts.
8. **Verification & Tests**:
   - Run `cargo test -p frostfire-e2e` (all 175 tests MUST PASS).
   - Run `cargo test --workspace` (MUST PASS 100%).
   - Run `cargo clippy --workspace -- -D warnings` (MUST PASS with 0 warnings).
9. Deliver full handoff report at `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2_1\handoff.md` and notify parent.

## 2026-09-08T21:12:00Z
Implement Milestone 2: Autonomous MicroVM Virtualization Infrastructure:
1. Implement cloud/microvm/scripts/sand-exit-watch (Python subreaper with PR_SET_CHILD_SUBREAPER, zombie reaping, crash-loop backoff).
2. Implement cloud/microvm/scripts/box-cgroups.sh (cgroup v2 interactive vs agent slices) and update start-desktop.sh.
3. Implement OverlayFS CoW branching in cloud/microvm/run-vm.sh and build-rootfs.sh.
4. Harden cloud/microvm/scripts/sand-window-router.mjs (token check on all displays via crypto.timingSafeEqual, WebSocket upgrade handling).
5. Harden cloud/microvm/scripts/link-chrome-session.sh (stale lock cleanup, circular path guard).
6. Implement live CDP cookie sync daemon in cloud/microvm/scripts/cdp-cookies.mjs.
7. Normalize CRLF line endings to LF on all shell scripts and add .gitattributes.
8. Verify cargo test -p frostfire-e2e, cargo test --workspace, and cargo clippy --workspace -- -D warnings.
Deliver handoff.md and notify parent when done.

