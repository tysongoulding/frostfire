# Handoff Report: Milestone 2 — Adversarial Security & Architecture Review

**Agent**: `reviewer_m2_2`  
**Role**: Reviewer & Adversarial Critic (`teamwork_preview_reviewer`)  
**Milestone**: Milestone 2: Autonomous MicroVM Virtualization Infrastructure (Features F6–F12)  
**Parent Agent**: `parent` (`a683d2a2-4cae-4a3a-a587-8741f091dc4b`)  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m2_2`  
**Date**: 2026-09-08T21:19:40Z  
**Verdict**: **APPROVE**

---

## 1. Observation

Direct observations and execution outputs from codebase inspection, adversarial stress testing, and workspace verification gates:

1. **Window Router Constant-Time Token Enforcement on Display 1 (`cloud/microvm/scripts/sand-window-router.mjs`)**:
   - `decideWindowRoute()` (lines 45–66) parses `display` into an integer and checks display boundaries:
     ```javascript
     const display = parseDisplayNumber(displayHeader);
     if (display < 1) {
       return {
         reject: {
           status: 400,
           message: `sand-window-router: bad request (display :${display} must be >= 1)`,
         },
       };
     }
     const owner = firstHeader(ownerHeader);
     const bound = lookupBoundToken(display);
     if (bound === undefined || !tokensMatch(owner, bound)) {
       return {
         reject: {
           status: 403,
           message: `sand-window-router: forbidden (display :${display} owner-token mismatch)`,
         },
       };
     }
     if (display === 1) return { port: primaryPort };
     return { port: execBase + display };
     ```
   - `tokensMatch()` (lines 26–36) uses `crypto.timingSafeEqual` with length-mismatch constant-time padding (`timingSafeEqual(bb, bb)`).
   - In `server.on('upgrade', ...)` (lines 119–182), the identical `decideWindowRoute()` security gate is evaluated prior to establishing raw TCP forwarding via `net.connect()`.
   - Live adversarial stress test confirmed:
     - Display 1 HTTP request without token: HTTP 403 Forbidden.
     - Display 1 HTTP request with invalid token: HTTP 403 Forbidden.
     - Display 1 HTTP request with valid token: HTTP 200 (routed to port 1337).
     - Display 2 HTTP request with valid token: HTTP 200 (routed to port 14002).
     - Display 0 / Display -1 HTTP request: HTTP 400 Bad Request.
     - Display 1 WebSocket upgrade without token: HTTP 403 Forbidden (socket closed).
     - Display 1 WebSocket upgrade with valid token: HTTP 101 Switching Protocols (bidirectional piping confirmed).
     - Display 2 WebSocket upgrade with valid token: HTTP 101 Switching Protocols (bidirectional piping confirmed).

2. **Golden Base Read-Only Protection & Dual-Drive VirtIO (`cloud/microvm/run-vm.sh`)**:
   - Lines 96–110 explicitly enforce `is_read_only: true` on the golden base drive and allocate a separate volatile sparse ext4 overlay drive:
     ```bash
     fc_curl PUT "drives/rootfs" "{
       \"drive_id\": \"rootfs\",
       \"path_on_host\": \"${GOLDEN_BASE}\",
       \"is_root_device\": true,
       \"is_read_only\": true
     }"

     fc_curl PUT "drives/overlay" "{
       \"drive_id\": \"overlay\",
       \"path_on_host\": \"${OVERLAY_IMG}\",
       \"is_root_device\": false,
       \"is_read_only\": false
     }"
     ```
   - Lines 13–16 guard against path traversal in VM instance indices:
     ```bash
     if [ -z "${VM_INDEX}" ] || [[ "${VM_INDEX}" == *".."* ]]; then
       echo "[-] Error: Invalid instance ID '${VM_INDEX}' (must not be empty or contain '..')" >&2
       exit 1
     fi
     ```
   - Guest early init (`cloud/microvm/scripts/init-overlay`, lines 7–17) mounts `/dev/vda` as `ro` to `/mnt/golden` and `/dev/vdb` as `rw` to `/mnt/overlay`, assembling OverlayFS with `lowerdir=/mnt/golden,upperdir=/mnt/overlay/upper,workdir=/mnt/overlay/work`.

3. **Subreaper In-VM Supervisor & Crash-Loop Backoff (`cloud/microvm/scripts/sand-exit-watch`)**:
   - Initializes Linux subreaper via `ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)` (`PR_SET_CHILD_SUBREAPER`), falling back gracefully on non-Linux environments.
   - Reaps all orphaned zombie processes asynchronously using `os.waitpid(-1, os.WNOHANG)` (lines 81–107).
   - Enforces exponential crash-loop backoff:
     $$\text{backoff\_secs} = \min(1 \ll \text{current\_restarts}, 30)$$
   - Halts execution with fatal return code 1 when `current_restarts > max_restarts` (lines 150–152).
   - Resets restart counter to 0 only after `RESET_WINDOW_SECS` (60s) of stable runtime (lines 137–139).
   - Adversarial test executing a crashing binary with `--max-restarts 2` confirmed:
     - Logged restart attempts 1/2 and 2/2 with backoff.
     - Terminated with return code 1 upon exceeding max restarts.
     - Clean exit code 0 on successful child command.

4. **Cgroups v2 Resource Partitioning (`cloud/microvm/scripts/box-cgroups.sh`)**:
   - Establishes `interactive` domain with `cpu.weight=800` and `agent` domain with `cpu.weight=100` (8:1 proportional CFS CPU share).
   - `sand_cgroup_migrate_root_procs` moves existing PIDs from `/sys/fs/cgroup/cgroup.procs` into `agent` before writing `+cpu` to `cgroup.subtree_control`, satisfying the cgroup v2 "no internal processes" kernel constraint.
   - Disables swap thrashing by writing `0` to `memory.swap.max`.

5. **Chrome Session Linking Hardening (`cloud/microvm/scripts/link-chrome-session.sh`)**:
   - Resolves canonical directory paths (`readlink -f`) and aborts cleanly (`exit 0`) if `CANONICAL_TARGET == CANONICAL_DEST`, preventing circular self-destruction of master cookie/login databases.
   - Purges stale SQLite locks (`${link}-journal`, `${link}-wal`, `${link}-shm`) before symlinking.
   - Enforces `0700` directory permissions and `0600` master database permissions.

6. **Script Syntax & Line Ending Hygiene**:
   - Verified 100% Unix LF line endings across all repository scripts (`cloud/`, `scripts/`, `deploy/`).
   - Every shell script passed `bash -n` syntax analysis with exit code 0.
   - `sand-exit-watch` passed `python -m py_compile` with exit code 0.

7. **Workspace Verification Gates**:
   - `cargo test -p frostfire-e2e`: Passed all 175 tests (80 Tier 1, 80 Tier 2, 10 Tier 3, 5 Tier 4) in 0.56s.
   - `cargo test --workspace`: Passed 100% of unit and integration tests across all workspace crates with 0 failures.
   - `cargo clippy --workspace -- -D warnings`: Completed with 0 warnings.

---

## 2. Logic Chain

1. **Display Authentication Invariant Verification**:
   - Observation 1 demonstrates that `sand-window-router.mjs` evaluates `decideWindowRoute()` before routing any request.
   - Because `display === 1` check occurs *after* the `!tokensMatch(owner, bound)` check, Display 1 can never be accessed without a valid token matching `/tmp/sand-window-tokens.d/1`.
   - Constant-time verification is guaranteed by `crypto.timingSafeEqual`, with length-mismatch padding preventing timing leakage.
   - The same validation applies to WebSocket upgrades, closing all potential display takeover attack vectors.

2. **MicroVM Storage Isolation & Immutability**:
   - Observation 2 demonstrates that the golden base disk image is attached via Firecracker with `"is_read_only": true`.
   - The guest kernel and early init (`init-overlay`) mount this block device as `ro` for `lowerdir`.
   - All guest mutations are directed into the per-instance sparse ext4 image mounted as `upperdir` and `workdir`.
   - Concurrent microVMs sharing the golden base cannot corrupt each other or the base filesystem.

3. **In-VM Supervisor & Anti-Crash-Loop Mechanics**:
   - Observation 3 proves that `sand-exit-watch` registers as a subreaper via `PR_SET_CHILD_SUBREAPER`. Any child daemon (compiler, shell, Node.js worker) that orphans its children will have them reparented to `sand-exit-watch`.
   - Non-blocking `os.waitpid(-1, os.WNOHANG)` reaps terminated processes without blocking the main event loop, preventing PID exhaustion.
   - Capping exponential backoff at 30 seconds and terminating after `max_restarts` prevents CPU pegging and infinite restart loops.

4. **Integrity & Anti-Facade Audit**:
   - Source code analysis confirmed that all implementations contain genuine, complete production logic:
     - Zero hardcoded mock results or test stubs embedded in production files.
     - Real HTTP proxy and net socket piping in `sand-window-router.mjs`.
     - Real system call invocations (`prctl`, `waitpid`) in `sand-exit-watch`.
     - Real cgroup v2 filesystem operations in `box-cgroups.sh`.
     - Real SQLite symlink management and WAL cleanup in `link-chrome-session.sh`.
     - Real CDP WebSocket commands and SHA-256 deduplication in `cdp-cookies.mjs`.
   - No evidence of self-certifying work or shortcutting.

---

## 3. Caveats

1. **Hardware Virtualization Dependency**:
   - Firecracker hardware microVM execution requires physical Linux bare-metal hypervisors with `/dev/kvm` (e.g. AWS `c5.metal` instances configured in Milestone 3). On the Windows development machine, script execution logic, API payloads, and command-line arguments were validated via static syntax analysis (`bash -n`) and the comprehensive Rust E2E test harness.
2. **Subreaper OS Boundary**:
   - `PR_SET_CHILD_SUBREAPER` is a Linux-specific `prctl` system call (code 36). On non-Linux hosts, `sand-exit-watch` logs an informational notice and proceeds without crashing.

---

## 4. Conclusion

Milestone 2 (Autonomous MicroVM Virtualization Infrastructure) successfully satisfies all functional, architectural, and security requirements without any integrity violations:
- `sand-window-router.mjs` strictly enforces constant-time `x-sand-window-owner` token verification across all displays (including Display 1) for both HTTP and WebSocket upgrade traffic.
- `run-vm.sh` strictly protects the golden base rootfs with `is_read_only: true` using Dual-Drive VirtIO OverlayFS CoW branching.
- `sand-exit-watch` prevents PID leaks via Linux subreaper zombie reaping and terminates crash loops via bounded exponential backoff.
- All workspace verification gates (`cargo test -p frostfire-e2e`, `cargo test --workspace`, `cargo clippy --workspace -- -D warnings`, `bash -n`) pass with 0 errors and 0 warnings.

**Verdict**: **APPROVE**

---

## 5. Verification Method

To independently reproduce and verify this review verdict:

1. **Verify E2E Test Suite (All 175 Tests Pass)**:
   ```powershell
   cargo test -p frostfire-e2e
   ```

2. **Verify Full Workspace Unit & Integration Tests (100% Pass)**:
   ```powershell
   cargo test --workspace
   ```

3. **Verify Linter (0 Warnings)**:
   ```powershell
   cargo clippy --workspace -- -D warnings
   ```

4. **Verify Shell Script Syntax (`bash -n`)**:
   ```powershell
   Get-ChildItem -Path "cloud", "scripts", "deploy" -Recurse -Include "*.sh", "init-overlay" | ForEach-Object {
       $p = $_.FullName.Replace((Get-Location).Path + "\", "").Replace("\", "/")
       $res = bash -n "$p" 2>&1
       if ($LASTEXITCODE -ne 0) { throw "Syntax error in $p: $res" }
   }
   ```

5. **Verify Python Supervisor Compilation**:
   ```powershell
   python -m py_compile cloud/microvm/scripts/sand-exit-watch
   ```

6. **Verify Window Router Unit & WebSocket Upgrade Handling**:
   ```powershell
   node -e '
   import("./cloud/microvm/scripts/sand-window-router.mjs").then((m) => {
     const res = m.decideWindowRoute({
       displayHeader: "1",
       ownerHeader: "wrong",
       primaryPort: 1337,
       execBase: 14000,
       lookupBoundToken: () => "valid",
     });
     if (!res.reject || res.reject.status !== 403) process.exit(1);
     console.log("Token validation on Display 1 independently confirmed!");
   });
   '
   ```

### Invalidation Conditions:
- Any failure in `cargo test -p frostfire-e2e` or `cargo test --workspace`.
- Any bypass allowing unauthenticated access to Display 1 through `sand-window-router.mjs`.
- Any configuration in `run-vm.sh` allowing write access to `golden_base.ext4`.
- Any crash loop spinning under `sand-exit-watch` without exponential backoff or restart limits.
