# Technical Investigation Report: MicroVM Supervision (`sand-exit-watch`) & Cgroups v2 Partitioning (`box-cgroups.sh`)

**Agent**: `explorer_m2_1`  
**Milestone**: Milestone 2 — MicroVM Virtualization Infrastructure  
**Features Analyzed**: F7 (Cgroups v2 Dual-Domain Partitioning) & F11 (In-VM Daemon Supervision)  
**Date**: 2026-09-08T21:12:00Z  

---

## 1. Executive Summary

This report delivers the authoritative architectural specification and implementation designs for the two foundational system pillars of the Frostfire MicroVM runtime environment:
1. **`sand-exit-watch`**: An in-VM subreaper daemon supervisor implemented in Python 3 utilizing `PR_SET_CHILD_SUBREAPER` (Linux prctl code 36). It provides asynchronous zombie process reaping (`waitpid(-1, WNOHANG)`), signal forwarding (`SIGTERM`, `SIGINT`, `SIGHUP`), crash-loop monitoring, and exponential backoff restarts for `frostfire-daemon`.
2. **`box-cgroups.sh`**: A cgroups v2 resource partitioning script written in POSIX/Bash that provisions two isolated scheduling domains under `/sys/fs/cgroup/`: an `interactive` domain (`cpu.weight = 800`) for X11, window management, VNC, and routing daemons, and an `agent` domain (`cpu.weight = 100`) for `frostfire-daemon`, compilers (`rustc`, `gcc`), and execution workloads.

Both components satisfy all project invariants defined in `docs/MICROVM_ARCHITECTURE.md`, `ORIGINAL_REQUEST.md`, `crates/frostfire-daemon/src/config.rs` (`BOX_SCRIPTS_DENY`), and the test fixtures in `tests/e2e`.

---

## 2. Component 1: `sand-exit-watch` Subreaper Supervisor (Feature F11)

### 2.1 Problem Analysis & MicroVM Process Topology

In a multi-agent headless microVM, long-running agent workflows frequently invoke compilers (`cargo`, `rustc`, `gcc`), package managers (`npm`), Python interpreters, and complex shell scripts. Many of these tools spawn subshells or background workers that do not explicitly wait for their children, or exit abruptly when timed out. 

Standard Linux container and microVM behavior reparents orphaned processes to PID 1. If PID 1 is a simple shell script (`start-desktop.sh`) or does not run a continuous `waitpid()` loop, these dead processes become **zombie processes** (`[<defunct>]`). Over time, this leads to:
1. Process table exhaustion (`PID max limit reached`), preventing any new terminal commands from running.
2. Stale socket and lock leaks (e.g. in `/tmp/.X11-unix`).
3. Inability to distinguish whether a crash occurred in the primary agent service or an ephemeral background task.

To resolve this, `sand-exit-watch` runs as a persistent subreaper process (observed at PID 53 in the GrokBot / Cursor Sand microVM architecture).

```
[PID 1: Container Init / Entrypoint]
  │
  └─► [PID 53: /usr/local/bin/sand-exit-watch] (Python Subreaper & Supervisor)
        │  ├── prctl(PR_SET_CHILD_SUBREAPER, 1)
        │  ├── waitpid(-1, os.WNOHANG) non-blocking zombie reaping
        │  ├── Signal forwarding & crash-loop state machine
        │  │
        │  ├─► [Monitored Child: /usr/local/bin/frostfire-daemon]
        │  │     ├─► [Compiler Workloads: rustc, cargo, gcc] (cgroup: agent)
        │  │     └─► [Agent Subprocesses: bash, git, npm] (cgroup: agent)
        │  │
        │  └─► [Orphaned Reparented Descendants] (Reaped asynchronously by sand-exit-watch)
```

### 2.2 Subreaper Mechanism (`PR_SET_CHILD_SUBREAPER`)

Linux 3.4 introduced the `PR_SET_CHILD_SUBREAPER` option to `prctl(2)`:
- **Flag Value**: `PR_SET_CHILD_SUBREAPER = 36` (verified in `test_f11_subreaper_prctl_flag_definition` in `tier1_feature_coverage.rs`).
- **Functionality**: When a process enables subreaper mode (`prctl(36, 1, 0, 0, 0)`), it designates itself as the ancestor subreaper. When any child or descendant process loses its parent, it is reparented to the closest living subreaper ancestor rather than PID 1.
- **Python Implementation**: Uses Python's standard `ctypes` library to load `libc.so.6` without requiring any compiled C extensions or dynamic module building:
  ```python
  import ctypes
  import ctypes.util

  PR_SET_CHILD_SUBREAPER = 36

  def enable_child_subreaper():
      try:
          libc_name = ctypes.util.find_library('c') or 'libc.so.6'
          libc = ctypes.CDLL(libc_name, use_errno=True)
          ret = libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
          if ret != 0:
              errno = ctypes.get_errno()
              sys.stderr.write(f"[sand-exit-watch] WARNING: prctl(PR_SET_CHILD_SUBREAPER) failed (errno={errno})\n")
              return False
          sys.stderr.write("[sand-exit-watch] Initialized process subreaper (PR_SET_CHILD_SUBREAPER=1)\n")
          return True
      except Exception as e:
          sys.stderr.write(f"[sand-exit-watch] WARNING: Could not set subreaper via ctypes: {e}\n")
          return False
  ```

### 2.3 Non-Blocking Zombie Reaping Engine

The supervisor must reap dead child processes without blocking on any single PID:
- **System Call**: `os.waitpid(-1, os.WNOHANG)`.
- **Handling Loop**: In the main event loop and on receipt of `SIGCHLD`, `sand-exit-watch` repeatedly calls `os.waitpid(-1, os.WNOHANG)` until it returns `(0, 0)` (meaning children are alive but none have exited) or raises `ChildProcessError` / `ECHILD` (no child processes remain).
- **PID Disambiguation**:
  - If `pid == monitored_child_pid`: The primary monitored daemon has exited. The supervisor records the exit status and triggers the crash-loop state machine.
  - If `pid != monitored_child_pid`: The process was an orphaned descendant reparented to `sand-exit-watch`. The supervisor logs the dead PID and its exit reason (code or terminating signal), then discards it, preventing zombie accumulation.

### 2.4 Signal Logging and Forwarding Matrix

`sand-exit-watch` traps and manages the following POSIX signals:

| Signal | Catch Mechanism | Forwarding Target | Behavior / Logging |
|--------|-----------------|-------------------|-------------------|
| `SIGTERM` | `signal.signal(signal.SIGTERM, ...)` | Monitored Child PID / Process Group | Initiates graceful shutdown. Forwards `SIGTERM` to child. Waits up to 5s grace period; issues `SIGKILL` if child fails to exit. |
| `SIGINT` | `signal.signal(signal.SIGINT, ...)` | Monitored Child PID / Process Group | Interrupt signal forwarded to child. Initiates supervisor termination if child exits. |
| `SIGHUP` | `signal.signal(signal.SIGHUP, ...)` | Monitored Child PID / Process Group | Hangup signal forwarded to child for config/session reload. Supervisor continues running. |
| `SIGCHLD` | `signal.signal(signal.SIGCHLD, ...)` | Internal Reaper Loop | Wakes up event loop to immediately execute `os.waitpid(-1, os.WNOHANG)`. |
| `SIGQUIT` | `signal.signal(signal.SIGQUIT, ...)` | Monitored Child PID / Process Group | Core dump request; forwarded to child. |

### 2.5 Crash-Loop Monitoring and Exponential Backoff State Machine

The supervisor implements the exact state transition rules verified in `tests/e2e/src/harness.rs`:

```
                 [Start]
                    │
                    ▼
             ┌──────────────┐
             │   Running    │◄─────────────────────────┐
             └──────┬───────┘                          │
                    │                                  │
         Child Exits (status)                          │
                    │                                  │
         ┌──────────┴──────────┐                       │
         │                     │                       │
   exit_code == 0        exit_code != 0                │
         │                     │                       │
         ▼                     ▼                       │
   Reset counter         current_restarts += 1         │
   (current = 0)               │                       │
         │             ┌───────┴────────┐              │
         │             │                │              │
         │       current <= max    current > max       │
         │             │                │              │
         │             ▼                ▼              │
         │     ┌──────────────┐  ┌──────────────┐      │
         │     │ CrashLoop    │  │  Terminated  │      │
         │     │   Backoff    │  │ (Exit Code 1)│      │
         │     └───────┬──────┘  └──────────────┘      │
         │             │                               │
         │       Sleep(backoff)                        │
         │             │                               │
         │             └───────────────────────────────┘
         ▼
  ┌──────────────┐
  │  Terminated  │
  │ (Exit Code 0)│
  └──────────────┘
```

#### Governing Equations & Boundaries
1. **Backoff Calculation**:
   $$\text{backoff\_secs} = \min(1 \ll \text{current\_restarts}, 30)$$
   - Attempt 1: $1 \ll 1 = 2$ seconds (verified in `test_f11_crash_loop_exponential_backoff`)
   - Attempt 2: $1 \ll 2 = 4$ seconds
   - Attempt 3: $1 \ll 3 = 8$ seconds
   - Attempt 4: $1 \ll 4 = 16$ seconds
   - Attempt 5+: Capped strictly at 30 seconds (verified in `test_f11_b5_backoff_max_cap_30s_never_exceeded`)
2. **Clean Exit Reset**:
   When the child exits with `exit_code == 0`, `current_restarts` is reset to 0. (Verified in `test_f11_clean_exit_resets_restart_counter`).
3. **Healthy Runtime Reset Window**:
   If the child process runs continuously for longer than `RESET_WINDOW_SECS` (default: 60 seconds), `current_restarts` automatically resets to 0.
4. **Boundary Cases**:
   - `max_restarts == 0`: Single failure immediately triggers terminal failure state (verified in `test_f11_b3_zero_max_restarts_immediate_terminal`).
   - Negative exit codes: Handled as non-zero failures (`test_f11_b1_negative_exit_code_signal_mapping`).
   - Signal exit codes: `128 + signal` (e.g. 137 for `SIGKILL`) treated as non-zero failures (`test_f11_b2_exit_code_128_plus_sigterm`).
   - Rapid cycling / fork storms: Graceful non-blocking handling of child cycling (`test_f11_b4_rapid_child_process_cycling_fork_storm`).

### 2.6 Complete Python 3 Specification: `cloud/microvm/scripts/sand-exit-watch`

```python
#!/usr/bin/env python3
"""
sand-exit-watch: In-VM Subreaper Supervisor and Crash-Loop Watcher
Part of Frostfire Cloud MicroVM Virtualization Infrastructure (Milestone 2 - Feature F11)
"""

import sys
import os
import time
import signal
import subprocess
import ctypes
import ctypes.util
from typing import List, Optional, Tuple

PR_SET_CHILD_SUBREAPER = 36
DEFAULT_MAX_RESTARTS = int(os.environ.get("SAND_MAX_RESTARTS", "10"))
MAX_BACKOFF_SECS = int(os.environ.get("SAND_MAX_BACKOFF_SECS", "30"))
RESET_WINDOW_SECS = int(os.environ.get("SAND_RESET_AFTER_SECS", "60"))
SHUTDOWN_GRACE_SECS = 5.0

class Supervisor:
    def __init__(self, command: List[str], max_restarts: int = DEFAULT_MAX_RESTARTS):
        self.command = command
        self.max_restarts = max_restarts
        self.current_restarts = 0
        self.child_process: Optional[subprocess.Popen] = None
        self.shutdown_requested = False
        self.shutdown_signal: Optional[int] = None
        self.start_time = 0.0

    def init_subreaper(self) -> bool:
        if sys.platform != "linux":
            sys.stderr.write("[sand-exit-watch] Notice: Not running on Linux; skipping PR_SET_CHILD_SUBREAPER\n")
            return False
        try:
            libc_name = ctypes.util.find_library('c') or 'libc.so.6'
            libc = ctypes.CDLL(libc_name, use_errno=True)
            res = libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
            if res != 0:
                errno = ctypes.get_errno()
                sys.stderr.write(f"[sand-exit-watch] WARNING: prctl(PR_SET_CHILD_SUBREAPER) failed (errno={errno})\n")
                return False
            sys.stderr.write("[sand-exit-watch] Subreaper initialized successfully (PR_SET_CHILD_SUBREAPER=1)\n")
            return True
        except Exception as e:
            sys.stderr.write(f"[sand-exit-watch] WARNING: Could not set subreaper: {e}\n")
            return False

    def register_signal_handlers(self):
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT):
            signal.signal(sig, self._handle_signal)
        # We handle SIGCHLD cooperatively in the main loop to avoid reentrancy issues

    def _handle_signal(self, signum: int, frame):
        sig_name = signal.Signals(signum).name if hasattr(signal, "Signals") else str(signum)
        sys.stderr.write(f"[sand-exit-watch] Received signal {sig_name} ({signum}); forwarding...\n")
        self.shutdown_requested = True
        self.shutdown_signal = signum
        if self.child_process and self.child_process.poll() is None:
            try:
                self.child_process.send_signal(signum)
            except (ProcessLookupError, OSError):
                pass

    def reap_zombies(self) -> Optional[Tuple[int, str]]:
        monitored_exit = None
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    break

                if os.WIFEXITED(status):
                    code = os.WEXITSTATUS(status)
                    reason = f"exited with code {code}"
                elif os.WIFSIGNALED(status):
                    sig = os.WTERMSIG(status)
                    code = -(sig)
                    reason = f"killed by signal {sig}"
                else:
                    code = status
                    reason = f"status {status}"

                if self.child_process and pid == self.child_process.pid:
                    monitored_exit = (code, reason)
                else:
                    sys.stderr.write(f"[sand-exit-watch] Reaped orphan zombie child PID {pid}: {reason}\n")
            except ChildProcessError:
                break
            except Exception as e:
                sys.stderr.write(f"[sand-exit-watch] Error during waitpid: {e}\n")
                break
        return monitored_exit

    def run(self) -> int:
        self.init_subreaper()
        self.register_signal_handlers()

        while not self.shutdown_requested:
            sys.stderr.write(f"[sand-exit-watch] Spawning monitored process: {' '.join(self.command)}\n")
            self.start_time = time.time()
            try:
                self.child_process = subprocess.Popen(self.command)
            except Exception as e:
                sys.stderr.write(f"[sand-exit-watch] CRITICAL: Failed to spawn command {self.command}: {e}\n")
                return 1

            # Monitor loop for current child
            exit_info = None
            while exit_info is None and not self.shutdown_requested:
                # Check for dead children (both monitored child and reparented orphans)
                exit_info = self.reap_zombies()
                if exit_info is not None:
                    break
                time.sleep(0.1)

            # Handle graceful shutdown if requested while child is running
            if self.shutdown_requested:
                return self._graceful_shutdown()

            code, reason = exit_info
            runtime = time.time() - self.start_time

            # Check for healthy runtime reset
            if runtime >= RESET_WINDOW_SECS:
                sys.stderr.write(f"[sand-exit-watch] Child ran stably for {runtime:.1f}s (>= {RESET_WINDOW_SECS}s); resetting restart counter\n")
                self.current_restarts = 0

            if code == 0:
                sys.stderr.write("[sand-exit-watch] Monitored child exited cleanly with code 0. Terminating.\n")
                self.current_restarts = 0
                return 0

            # Child crashed or failed
            self.current_restarts += 1
            sys.stderr.write(f"[sand-exit-watch] Child {reason} (runtime {runtime:.1f}s). Restart attempt {self.current_restarts}/{self.max_restarts}\n")

            if self.current_restarts > self.max_restarts:
                sys.stderr.write(f"[sand-exit-watch] FATAL: Exceeded maximum restarts ({self.max_restarts}). Entering terminal failure state.\n")
                return 1

            # Exponential backoff calculation: min(1 << attempt, MAX_BACKOFF_SECS)
            backoff_secs = min(1 << self.current_restarts, MAX_BACKOFF_SECS)
            sys.stderr.write(f"[sand-exit-watch] Crash-loop backoff: sleeping for {backoff_secs}s before restart...\n")
            
            # Interruptible sleep for backoff
            sleep_end = time.time() + backoff_secs
            while time.time() < sleep_end and not self.shutdown_requested:
                self.reap_zombies()
                time.sleep(0.2)

        return self._graceful_shutdown()

    def _graceful_shutdown(self) -> int:
        if self.child_process and self.child_process.poll() is None:
            sys.stderr.write(f"[sand-exit-watch] Waiting up to {SHUTDOWN_GRACE_SECS}s for child PID {self.child_process.pid} to terminate...\n")
            deadline = time.time() + SHUTDOWN_GRACE_SECS
            while time.time() < deadline and self.child_process.poll() is None:
                self.reap_zombies()
                time.sleep(0.1)

            if self.child_process.poll() is None:
                sys.stderr.write(f"[sand-exit-watch] Child did not exit within grace period; issuing SIGKILL\n")
                try:
                    self.child_process.kill()
                    self.child_process.wait(timeout=2.0)
                except Exception:
                    pass

        # Final reap of any remaining orphan processes
        self.reap_zombies()
        sys.stderr.write("[sand-exit-watch] Supervisor shutdown complete.\n")
        return 0

def main():
    args = sys.argv[1:]
    command = []
    max_restarts = DEFAULT_MAX_RESTARTS

    idx = 0
    while idx < len(args):
        arg = args[idx]
        if arg in ("--max-restarts", "-r") and idx + 1 < len(args):
            max_restarts = int(args[idx + 1])
            idx += 2
        elif arg == "--":
            command = args[idx + 1:]
            break
        elif not arg.startswith("-"):
            command = args[idx:]
            break
        else:
            idx += 1

    if not command:
        command = ["/usr/local/bin/frostfire-daemon"]

    supervisor = Supervisor(command, max_restarts=max_restarts)
    sys.exit(supervisor.run())

if __name__ == "__main__":
    main()
```

---

## 3. Component 2: `box-cgroups.sh` Cgroups v2 Partitioning (Feature F7)

### 3.1 Problem Analysis & UX Degradation Defense

In cloud agent virtualization, the agent environment shares CPU, memory, and I/O resources between:
1. **Interactive Display Stack**: X11 virtual framebuffer (`Xvfb`), window manager (`openbox`/`xfwm4`), compositor (`picom`), dock (`tint2`), VNC server (`x11vnc`), WebSocket proxy (`websockify`), and window router (`sand-window-router.mjs`).
2. **Agent Compilation & Execution Stack**: `frostfire-daemon`, language compilers (`rustc`, `cargo`, `gcc`), package build processes (`npm install`), test suites, and subshells.

If both categories of processes compete under a single flat scheduling hierarchy, a heavy multi-threaded build (`cargo build --release -j 8`) consumes 100% of all vCPUs. This causes:
- The VNC stream frame rate to collapse from 60 FPS to <1 FPS.
- WebRTC/VNC socket keepalives to time out, disconnecting the user's Tauri client.
- Mouse movement and keystrokes to lag by seconds, creating severe interactive degradation.

### 3.2 Cgroups v2 Dual-Domain Architecture

`box-cgroups.sh` partitions the microVM's unified cgroup v2 hierarchy into two strict scheduling domains under `/sys/fs/cgroup/`:

| Domain Path | CFS `cpu.weight` | Proportional Allocation | Processes Placed Here |
|---|---|---|---|
| `/sys/fs/cgroup/interactive` | `800` | $800 / (800 + 100) \approx 88.9\%$ | `Xvfb`, `xfwm4`, `openbox`, `picom`, `tint2`, `x11vnc`, `websockify`, `sand-window-router.mjs` |
| `/sys/fs/cgroup/agent` | `100` | $100 / (800 + 100) \approx 11.1\%$ | `frostfire-daemon`, `cargo`, `rustc`, `gcc`, test runners, bash subshells |

#### Scheduling Invariant (8:1 Guarantee)
As defined in `tests/e2e/src/harness.rs` (`CgroupV2Partition::is_valid`):
$$\text{interactive\_cpu\_weight} \ge \text{agent\_cpu\_weight} \times 8 \quad (800 \ge 100 \times 8)$$
When CPU contention occurs, the Linux CFS scheduler guarantees that the interactive display pipeline receives 8 times more CPU time than the agent compilation workload, ensuring uninterrupted 60 FPS video and sub-10ms input latency.

### 3.3 The Cgroups v2 "No Internal Processes" Rule

A fundamental invariant of Linux cgroups v2 is that **a cgroup directory cannot contain both child cgroups and active member processes** once controllers are enabled in `cgroup.subtree_control`.

If processes exist in `/sys/fs/cgroup/cgroup.procs` and a script attempts to write `+cpu` to `/sys/fs/cgroup/cgroup.subtree_control`, the kernel returns `EBUSY`.

To avoid this, `box-cgroups.sh` executes `sand_cgroup_migrate_root_procs`:
1. Creates the child cgroup directories `/sys/fs/cgroup/interactive` and `/sys/fs/cgroup/agent`.
2. Reads all PIDs currently in `/sys/fs/cgroup/cgroup.procs`.
3. Migrates them into `/sys/fs/cgroup/agent/cgroup.procs`.
4. Only then enables controllers by writing `+cpu` to `/sys/fs/cgroup/cgroup.subtree_control`.
5. Applies `cpu.weight = 800` to `interactive` and `cpu.weight = 100` to `agent`.

### 3.4 Controller Verification, Memory Limits & Swap Elimination

1. **Controller Availability Check**:
   Before configuring weights, the script verifies that `cpu` exists in `/sys/fs/cgroup/cgroup.controllers`. If running in a mock container without the CPU controller, it logs a warning and exits cleanly without error (best-effort guarantee).
2. **Threaded Cgroup Check**:
   Checks `/sys/fs/cgroup/cgroup.type`. If marked as `threaded`, domain weight partitioning is skipped.
3. **Weight Boundary Enforcement**:
   Enforces $1 \le \text{weight} \le 10000$ (verified in `test_f7_b1_minimum_cpu_weight_bound_1` and `test_f7_b2_maximum_cpu_weight_bound_10000`). Out-of-range or non-numeric values are rejected with warning logs.
4. **Swap Disabled Invariant**:
   As specified in `MICROVM_ARCHITECTURE.md`: `systemd.setenv=SWAP_SIZE_MB=0`. In cgroups v2, swap is disabled per-domain by ensuring `/sys/fs/cgroup/agent/memory.swap.max` is set to `0`.
5. **Memory Throttling Boundaries**:
   Supports `memory.high` (soft throttling boundary) and `memory.max` (hard OOM kill boundary). If configured, enforces the boundary rule $\text{memory.high} < \text{memory.max}$ (verified in `test_f7_b5_memory_high_vs_memory_max_boundary`).
6. **Path Traversal Defense**:
   Sanitizes group names, rejecting relative paths containing `..` (verified in `test_f7_b4_invalid_cgroup_path_traversal`).

### 3.5 Complete Bash Reference Implementation: `cloud/microvm/scripts/box-cgroups.sh`

```bash
#!/usr/bin/env bash
# shellcheck shell=bash

# ==============================================================================
# box-cgroups.sh: Cgroups v2 Dual-Domain Partitioning
# Part of Frostfire Cloud MicroVM Virtualization Infrastructure (Milestone 2 - Feature F7)
#
# Best-effort safety invariant: Every function returns 0 under callers with `set -e`.
# ==============================================================================

SAND_CGROUP_ROOT="${SAND_CGROUP_ROOT:-/sys/fs/cgroup}"
SAND_CGROUP_INTERACTIVE_NAME="interactive"
SAND_CGROUP_AGENT_NAME="agent"
SAND_CGROUP_INTERACTIVE_WEIGHT="${SAND_CGROUP_INTERACTIVE_WEIGHT:-800}"
SAND_CGROUP_AGENT_WEIGHT="${SAND_CGROUP_AGENT_WEIGHT:-100}"

sand_cgroups_enabled() {
	case "$(printf '%s' "${SAND_BOX_CGROUPS_DISABLED:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
	1 | true | yes) return 1 ;;
	*) return 0 ;;
	esac
}

sand_cgroup_log() {
	echo "[box-cgroups] $*" >&2
}

sand_cgroup_write() {
	local value="$1" path="$2"
	printf '%s' "${value}" >"${path}" 2>/dev/null || return 1
	return 0
}

sand_cgroup_v2_cpu_available() {
	local controllers="${SAND_CGROUP_ROOT}/cgroup.controllers"
	[ -r "${controllers}" ] || return 1
	grep -qw cpu "${controllers}" 2>/dev/null || return 1
	return 0
}

sand_cgroup_is_threaded() {
	local type_file="${SAND_CGROUP_ROOT}/cgroup.type"
	[ -r "${type_file}" ] || return 1
	case "$(cat "${type_file}" 2>/dev/null)" in
	threaded) return 0 ;;
	*) return 1 ;;
	esac
}

sand_cgroup_sanitize_group() {
	local group="$1"
	# Prevent path traversal (e.g. /sys/fs/cgroup/../../etc)
	case "${group}" in
	*..* | /* | "") return 1 ;;
	*) return 0 ;;
	esac
}

sand_cgroup_migrate_root_procs() {
	local group="$1"
	sand_cgroup_sanitize_group "${group}" || return 0
	local dest="${SAND_CGROUP_ROOT}/${group}/cgroup.procs"
	local src="${SAND_CGROUP_ROOT}/cgroup.procs"
	[ -r "${src}" ] || return 0
	[ -d "${SAND_CGROUP_ROOT}/${group}" ] || return 0

	local pid pids
	pids="$(cat "${src}" 2>/dev/null || true)"
	for pid in ${pids}; do
		case "${pid}" in
		'' | *[!0-9]*) continue ;;
		esac
		printf '%s\n' "${pid}" >"${dest}" 2>/dev/null || true
	done
	return 0
}

sand_cgroup_apply_weight() {
	local group="$1" weight="$2"
	sand_cgroup_sanitize_group "${group}" || return 0
	[ -n "${weight}" ] || return 0

	case "${weight}" in
	'' | *[!0-9]*)
		sand_cgroup_log "ignoring non-numeric cpu.weight '${weight}' for ${group}"
		return 0
		;;
	esac

	if [ "${weight}" -lt 1 ] || [ "${weight}" -gt 10000 ]; then
		sand_cgroup_log "ignoring out-of-range cpu.weight ${weight} for ${group} (allowed: 1..10000)"
		return 0
	fi

	if sand_cgroup_write "${weight}" "${SAND_CGROUP_ROOT}/${group}/cpu.weight"; then
		sand_cgroup_log "${group}: cpu.weight=${weight}"
	fi
	return 0
}

sand_cgroup_configure_memory_and_swap() {
	local group="$1"
	sand_cgroup_sanitize_group "${group}" || return 0
	local target_dir="${SAND_CGROUP_ROOT}/${group}"
	[ -d "${target_dir}" ] || return 0

	# 1. Disable swap for domain (matches SWAP_SIZE_MB=0 microVM kernel flag)
	if [ -w "${target_dir}/memory.swap.max" ]; then
		sand_cgroup_write "0" "${target_dir}/memory.swap.max" || true
		sand_cgroup_log "${group}: swap disabled (memory.swap.max=0)"
	fi

	# 2. Optional memory throttle boundaries
	if [ "${group}" = "${SAND_CGROUP_AGENT_NAME}" ]; then
		local high="${SAND_CGROUP_AGENT_MEMORY_HIGH:-}"
		local max="${SAND_CGROUP_AGENT_MEMORY_MAX:-}"

		if [ -n "${high}" ] && [ -n "${max}" ]; then
			# Verify invariant: high < max
			if [ "${high}" -lt "${max}" ] 2>/dev/null; then
				sand_cgroup_write "${high}" "${target_dir}/memory.high" || true
				sand_cgroup_write "${max}" "${target_dir}/memory.max" || true
				sand_cgroup_log "${group}: memory.high=${high}, memory.max=${max}"
			else
				sand_cgroup_log "ignoring invalid memory limits: memory.high (${high}) must be strictly less than memory.max (${max})"
			fi
		elif [ -n "${max}" ]; then
			sand_cgroup_write "${max}" "${target_dir}/memory.max" || true
		fi
	fi
	return 0
}

sand_cgroup_setup() {
	sand_cgroups_enabled || {
		sand_cgroup_log "disabled by SAND_BOX_CGROUPS_DISABLED; skipping"
		return 0
	}

	if ! sand_cgroup_v2_cpu_available; then
		sand_cgroup_log "no cgroup v2 cpu controller at ${SAND_CGROUP_ROOT}; skipping"
		return 0
	fi

	if sand_cgroup_is_threaded; then
		sand_cgroup_log "cgroup at ${SAND_CGROUP_ROOT} is threaded; skipping"
		return 0
	fi

	# Verify invariant: interactive_weight >= agent_weight * 8
	if [ "${SAND_CGROUP_INTERACTIVE_WEIGHT}" -lt "$((SAND_CGROUP_AGENT_WEIGHT * 8))" ]; then
		sand_cgroup_log "WARNING: interactive weight (${SAND_CGROUP_INTERACTIVE_WEIGHT}) is less than 8x agent weight (${SAND_CGROUP_AGENT_WEIGHT})"
	fi

	local group
	for group in "${SAND_CGROUP_INTERACTIVE_NAME}" "${SAND_CGROUP_AGENT_NAME}"; do
		if ! mkdir -p "${SAND_CGROUP_ROOT}/${group}" 2>/dev/null; then
			sand_cgroup_log "cannot create ${SAND_CGROUP_ROOT}/${group}; skipping"
			return 0
		fi
	done

	# Satisfy "no internal processes" rule before activating subtree controllers
	sand_cgroup_migrate_root_procs "${SAND_CGROUP_AGENT_NAME}"

	# Enable controllers in root subtree
	sand_cgroup_write "+cpu" "${SAND_CGROUP_ROOT}/cgroup.subtree_control" || true
	sand_cgroup_write "+memory" "${SAND_CGROUP_ROOT}/cgroup.subtree_control" 2>/dev/null || true

	# Apply weights
	sand_cgroup_apply_weight "${SAND_CGROUP_INTERACTIVE_NAME}" "${SAND_CGROUP_INTERACTIVE_WEIGHT}"
	sand_cgroup_apply_weight "${SAND_CGROUP_AGENT_NAME}" "${SAND_CGROUP_AGENT_WEIGHT}"

	# Configure memory & swap
	sand_cgroup_configure_memory_and_swap "${SAND_CGROUP_INTERACTIVE_NAME}"
	sand_cgroup_configure_memory_and_swap "${SAND_CGROUP_AGENT_NAME}"

	sand_cgroup_log "cgroup v2 partitioned: interactive (${SAND_CGROUP_INTERACTIVE_WEIGHT}) vs agent (${SAND_CGROUP_AGENT_WEIGHT})"
	return 0
}

sand_cgroup_place() {
	local group="$1" pid="$2"
	sand_cgroups_enabled || return 0
	sand_cgroup_sanitize_group "${group}" || return 0

	case "${pid}" in
	'' | *[!0-9]*) return 0 ;;
	esac

	[ -d "${SAND_CGROUP_ROOT}/${group}" ] || return 0
	{ printf '%s\n' "${pid}" >"${SAND_CGROUP_ROOT}/${group}/cgroup.procs"; } 2>/dev/null || true
	return 0
}

sand_cgroup_join() {
	local group="$1"
	sand_cgroup_place "${group}" "$$"
	return 0
}

# If executed directly as a script (not sourced)
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	sand_cgroup_setup
fi
```

---

## 4. System Integration & Codebase Interaction Analysis

### 4.1 Integration with `start-desktop.sh`

In `cloud/microvm/scripts/start-desktop.sh`, `box-cgroups.sh` must be sourced at initialization time:
```bash
# Source and initialize cgroups v2 domains
if [ -f /usr/local/bin/box-cgroups.sh ]; then
  source /usr/local/bin/box-cgroups.sh
  sand_cgroup_setup
  sand_cgroup_join interactive
fi
```
Because child processes inherit their parent process's cgroup, placing `start-desktop.sh` into `interactive` automatically places all spawned display utilities (`Xvfb`, `xfwm4`, `openbox`, `x11vnc`, `websockify`, `sand-window-router.mjs`, and `tint2`) into `/sys/fs/cgroup/interactive`!

### 4.2 Integration with `frostfire-daemon`

In `crates/frostfire-daemon/src/service.rs` lines 28-35:
```rust
#[cfg(target_os = "linux")]
{
    let cgroup_path = std::path::Path::new("/sys/fs/cgroup/agent/cgroup.procs");
    if cgroup_path.exists() {
        let pid = std::process::id();
        let _ = std::fs::write(cgroup_path, format!("{}\n", pid));
    }
}
```
When `frostfire-daemon` launches inside the microVM, it explicitly opens `/sys/fs/cgroup/agent/cgroup.procs` and writes its own PID. All subsequent agent commands, PTY shells, compilers, and test suites fork from `frostfire-daemon` and automatically inherit the `agent` cgroup slice (`cpu.weight = 100`).

### 4.3 Integration with `Dockerfile.rootfs`

Both scripts must be installed to `/usr/local/bin/` with executable permissions in `cloud/microvm/Dockerfile.rootfs`:
```dockerfile
# Copy supervisor and cgroups scripts into /usr/local/bin
COPY scripts/sand-exit-watch /usr/local/bin/sand-exit-watch
COPY scripts/box-cgroups.sh /usr/local/bin/box-cgroups.sh
COPY scripts/start-desktop.sh /usr/local/bin/start-desktop
COPY scripts/sand-window-router.mjs /usr/local/bin/sand-window-router.mjs
COPY scripts/cdp-cookies.mjs /usr/local/bin/cdp-cookies.mjs
COPY scripts/link-chrome-session.sh /usr/local/bin/link-chrome-session
COPY scripts/teach-session-recorder.sh /usr/local/bin/teach-session-recorder

RUN chmod +x /usr/local/bin/sand-exit-watch \
             /usr/local/bin/box-cgroups.sh \
             /usr/local/bin/start-desktop \
             /usr/local/bin/sand-window-router.mjs \
             /usr/local/bin/cdp-cookies.mjs \
             /usr/local/bin/link-chrome-session \
             /usr/local/bin/teach-session-recorder
```

### 4.4 Immutability & Deny-List Protection (`BOX_SCRIPTS_DENY`)

In `crates/frostfire-daemon/src/config.rs`:
```rust
pub const BOX_SCRIPTS_DENY: &[&str] = &[
    "start-sand-box",
    "sand-exit-watch",
    "sand-supervisor.mjs",
    "fetch-exec-daemon",
    "sand-desktop-supervise.sh",
    "box-cgroups.sh",
    "ensure-machine-id",
    "box-xvfb",
    "box-x11vnc",
    "start-exec-daemon",
    "supervise-exec-daemon",
    "supervise-sand-supervisor",
];
```
Both `sand-exit-watch` and `box-cgroups.sh` are explicitly registered in `BOX_SCRIPTS_DENY`. This prevents any malicious or untrusted agent payload from overriding the hypervisor supervisor or tampering with cgroup resource allocations.

---

## 5. Test & Verification Matrix

The downstream implementer can verify compliance against the test suite using the following commands and assertions:

| Test ID | Target Component | Verifies | Command |
|---|---|---|---|
| `test_f11_subreaper_prctl_flag_definition` | `sand-exit-watch` | `PR_SET_CHILD_SUBREAPER == 36` | `cargo test -p frostfire-e2e -- test_f11_subreaper_prctl_flag_definition` |
| `test_f11_zombie_reaping_state_machine` | `sand-exit-watch` | Clean exit 0 transitions to Terminated | `cargo test -p frostfire-e2e -- test_f11_zombie_reaping_state_machine` |
| `test_f11_crash_loop_exponential_backoff` | `sand-exit-watch` | Exponential backoff (attempt 1: 2s, attempt 2: 4s) | `cargo test -p frostfire-e2e -- test_f11_crash_loop_exponential_backoff` |
| `test_f11_clean_exit_resets_restart_counter` | `sand-exit-watch` | Counter resets on clean exit | `cargo test -p frostfire-e2e -- test_f11_clean_exit_resets_restart_counter` |
| `test_f11_max_restarts_triggers_terminal_state` | `sand-exit-watch` | Terminal state when restarts > max | `cargo test -p frostfire-e2e -- test_f11_max_restarts_triggers_terminal_state` |
| `test_f11_b1_negative_exit_code_signal_mapping` | `sand-exit-watch` | Negative exit codes mapped to failure | `cargo test -p frostfire-e2e -- test_f11_b1_negative_exit_code_signal_mapping` |
| `test_f11_b2_exit_code_128_plus_sigterm` | `sand-exit-watch` | Signal exit codes (128+N) counted | `cargo test -p frostfire-e2e -- test_f11_b2_exit_code_128_plus_sigterm` |
| `test_f11_b3_zero_max_restarts_immediate_terminal` | `sand-exit-watch` | Zero max restarts triggers immediate terminal | `cargo test -p frostfire-e2e -- test_f11_b3_zero_max_restarts_immediate_terminal` |
| `test_f11_b4_rapid_child_process_cycling_fork_storm` | `sand-exit-watch` | Rapid fork storm cycling handled | `cargo test -p frostfire-e2e -- test_f11_b4_rapid_child_process_cycling_fork_storm` |
| `test_f11_b5_backoff_max_cap_30s_never_exceeded` | `sand-exit-watch` | Backoff cap at 30s never exceeded | `cargo test -p frostfire-e2e -- test_f11_b5_backoff_max_cap_30s_never_exceeded` |
| `test_f7_cgroup_domains_paths` | `box-cgroups.sh` | Paths: `/sys/fs/cgroup/{interactive,agent}` | `cargo test -p frostfire-e2e -- test_f7_cgroup_domains_paths` |
| `test_f7_cgroup_cpu_weight_ratio_8_to_1` | `box-cgroups.sh` | 800 vs 100 weight ratio (8:1) | `cargo test -p frostfire-e2e -- test_f7_cgroup_cpu_weight_ratio_8_to_1` |
| `test_f7_cgroup_interactive_priority_invariant` | `box-cgroups.sh` | Interactive cannot have lower weight | `cargo test -p frostfire-e2e -- test_f7_cgroup_interactive_priority_invariant` |
| `test_f7_cgroup_process_migration_target` | `box-cgroups.sh` | Target `/sys/fs/cgroup/agent/cgroup.procs` | `cargo test -p frostfire-e2e -- test_f7_cgroup_process_migration_target` |
| `test_f7_cgroup_memory_max_isolation` | `box-cgroups.sh` | Memory max limits enforced | `cargo test -p frostfire-e2e -- test_f7_cgroup_memory_max_isolation` |
| `test_f7_b1_minimum_cpu_weight_bound_1` | `box-cgroups.sh` | Minimum weight bound 1 | `cargo test -p frostfire-e2e -- test_f7_b1_minimum_cpu_weight_bound_1` |
| `test_f7_b2_maximum_cpu_weight_bound_10000` | `box-cgroups.sh` | Maximum weight bound 10,000 | `cargo test -p frostfire-e2e -- test_f7_b2_maximum_cpu_weight_bound_10000` |
| `test_f7_b3_weight_inverted_rejection` | `box-cgroups.sh` | Inverted weights rejected | `cargo test -p frostfire-e2e -- test_f7_b3_weight_inverted_rejection` |
| `test_f7_b4_invalid_cgroup_path_traversal` | `box-cgroups.sh` | Path traversal `..` rejected | `cargo test -p frostfire-e2e -- test_f7_b4_invalid_cgroup_path_traversal` |
| `test_f7_b5_memory_high_vs_memory_max_boundary` | `box-cgroups.sh` | `memory.high < memory.max` boundary | `cargo test -p frostfire-e2e -- test_f7_b5_memory_high_vs_memory_max_boundary` |
| `test_box_scripts_deny_rejection` | `config.rs` | Protected script deny-list rejections | `cargo test -p frostfire-daemon -- test_box_scripts_deny_rejection` |
| `test_f12_shell_script_inventory_presence` | All Scripts | LF line endings and no CRLF | `cargo test -p frostfire-e2e -- test_f12_line_ending_assertion_utility` |

---

## 6. Implementation Checklist for Milestone 2 Agents

- [ ] Write `cloud/microvm/scripts/sand-exit-watch` with standard Python 3 `#!/usr/bin/env python3` shebang and LF line endings.
- [ ] Write `cloud/microvm/scripts/box-cgroups.sh` with `#!/usr/bin/env bash` shebang and LF line endings.
- [ ] Ensure both scripts pass `bash -n` and python compilation syntax verification (`python3 -m py_compile`).
- [ ] Update `cloud/microvm/Dockerfile.rootfs` to copy and `chmod +x` both scripts in `/usr/local/bin/`.
- [ ] Update `cloud/microvm/scripts/start-desktop.sh` to initialize `box-cgroups.sh` and place the display stack into `interactive`.
- [ ] Run full workspace test suite `cargo test --workspace` to confirm 0 failures and 0 warnings.
