# Authoritative Architectural Specification: GrokBot / Cursor Sand MicroVM Infrastructure

**Document Version**: 1.0.0-PROD  
**Target Platform**: AWS Bare-Metal (EC2 `c6i.metal` / `c5.metal` / `i3en.metal`) / Linux KVM  
**Investigator**: Specification Miner (`spec_miner_survey_1`)  
**Status**: Authoritative Reference Extraction Complete  

---

## 1. Executive Summary & Architectural Paradigm

The GrokBot / Cursor Sand microVM architecture (internally codenamed `sand` or `@anysphere/exec-daemon-runtime`) represents an autonomous, multi-tenant, hardware-isolated execution sandbox designed for cloud-hosted AI coding agents. Unlike traditional container sandboxes (Docker/Kubernetes) which share a single host kernel and lack strong multi-tenant boundaries, Sand operates monolithic Linux microVMs via **KVM (Kernel-based Virtual Machine)** and **AWS Firecracker / Cloud-Hypervisor**.

### Core Invariants
1. **Outbound-Only Ingress**: MicroVM instances possess zero exposed public listening ports. All control plane operations, interactive terminals, and UI commands traverse an outbound-only bidirectional gRPC reverse tunnel (`AgentTunnelService.OpenTunnel` over TLS 1.3 to `frostfire-gateway`).
2. **Strict Hardware Network Isolation**: Each microVM resides on an isolated point-to-point subnet (`172.16.x.0/24`). No bridging between tenant tap interfaces is permitted; all external internet egress is strictly NAT masqueraded.
3. **Interactive Priority Isolation**: System processes (X11, window manager, noVNC, window router) are prioritized via Cgroups v2 (`interactive` slice, `cpu.weight=800`) over agent compilation and code execution workloads (`agent` slice, `cpu.weight=100`), ensuring that heavy compiler bursts (`rustc`, `gcc`, `cargo`) never degrade desktop responsiveness or drop video frames.
4. **Tenant Token Verification**: Every multi-display routing request enforces constant-time security token validation (`timingSafeEqual`) to prevent timing side-channel attacks across session windows.
5. **Zero Secrets in Guest**: No AWS credentials, database keys, or private SSH keys reside in the VM image; authentication ceremonies (such as WebAuthn hardware keys) are intercepted and bridged to the user's local machine.

---

## 2. Deep Dive: The Six Core Architectural Pillars

### Pillar 1: OverlayFS Root Filesystem & CoW MicroVM Branching

#### Storage Topology & VirtIO Block Device
The microVM mounts a single block device `/dev/vda` using VirtIO (`CONFIG_VIRTIO_BLK=y`). To achieve sub-second VM spin-up and instantaneous branching without duplicating gigabytes of rootfs images, the filesystem utilizes **OverlayFS** with Copy-on-Write (CoW) branching:
- **`lowerdir` (Read-Only Base)**: A golden, immutable base ext4 rootfs (e.g. exported from `Dockerfile.rootfs`, size ~8 GB) containing Ubuntu 24.04 LTS, pre-installed desktop stacks (Xvfb, x11vnc, openbox, xfwm4, picom, tint2), Chrome, compilers (Rust, Node.js, Python), and development tools.
- **`upperdir` (Volatile / Ephemeral Branch)**: A sparse ext4 disk or RAM-backed tmpfs where all guest write operations (file edits, temporary builds, package installations) accumulate.
- **`workdir` (OverlayFS Scratch)**: Working directory on the same filesystem as `upperdir` required by OverlayFS for atomic file creation and rename operations.

```
┌───────────────────────────────────────────────────────────┐
│              Merged View (/ inside MicroVM)               │
└─────────────────────────────┬─────────────────────────────┘
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   ┌───────────────────┐             ┌───────────────────┐
   │     upperdir      │             │     lowerdir      │
   │ (Read-Write CoW)  │             │ (Read-Only Base)  │
   │  Branch / Diff    │             │  Ubuntu 24.04 +   │
   │  /workspace edits │             │  X11, Chrome, Dev │
   └───────────────────┘             └───────────────────┘
```

#### Kernel Compilation & Root Drive Configuration
In the monolithic Linux microVM kernel (`Linux 6.12.94+`), all storage and filesystem drivers are built-in (`=y`) because the kernel is booted with `nomodule`:
- `CONFIG_OVERLAY_FS=y`
- `CONFIG_VIRTIO_BLK=y`
- `CONFIG_VIRTIO_PCI=y`
- `CONFIG_EXT4_FS=y`

**Firecracker API Drive Configuration (`PUT /drives/rootfs`)**:
```json
{
  "drive_id": "rootfs",
  "path_on_host": "/var/lib/frostfire/disks/vm-<id>-diff.ext4",
  "is_root_device": true,
  "is_read_only": false
}
```
For branching a fresh agent session from an existing snapshot, the hypervisor creates a copy-on-write sparse disk (`qemu-img create -f qcow2 -b base.ext4 branch.qcow2` or formats an empty sparse ext4 `upperdir` mounted over `lowerdir`), permitting instantaneous VM spin-up in < 5 milliseconds.

---

### Pillar 2: Cgroups v2 Scheduling Domains & Priority Partitioning

#### Hierarchy & Boot Arguments
The microVM enforces a pure Cgroup v2 hierarchy at boot time using the kernel parameter:
```text
systemd.unified_cgroup_hierarchy=1
```
Swap is completely disabled to prevent catastrophic disk thrashing under memory pressure:
```text
systemd.setenv=SWAP_SIZE_MB=0
```

#### Dual-Slice Partitioning (`box-cgroups.sh`)
Inside `/sys/fs/cgroup`, two distinct control groups are provisioned:
1. **Interactive Slice (`/sys/fs/cgroup/interactive`)**:
   - `cpu.weight`: **800** (8x normal CPU share).
   - Assigned Processes:
     - `Xvfb` (Display servers :1, :2, :3)
     - Window Manager (`xfwm4` / `openbox`)
     - Compositor (`picom`)
     - Dock (`tint2` / `plank`)
     - VNC Daemons (`x11vnc` / `kasmvnc`)
     - WebSocket Bridges (`websockify` on 6080, 6081)
     - Multiplexer (`sand-window-router.mjs` on 1339)
2. **Agent Slice (`/sys/fs/cgroup/agent`)**:
   - `cpu.weight`: **100** (Default baseline) or **50** (Throttled under contention).
   - Assigned Processes:
     - In-VM agent daemons (`frostfire-agent`, `frostfire-daemon`, `/exec-daemon/index.js`)
     - Compilers and toolchains (`rustc`, `cargo`, `gcc`, `clang`, `npm`, `tsc`)
     - Test runners, linters, and child execution sub-processes (`sh`, `bash`, `python3`)

#### Autonomous Process Migration (`crates/frostfire-daemon/src/service.rs`)
When the Frostfire daemon boots inside the VM, it detects whether it is running on Linux and automatically migrates itself into the `agent` cgroup slice:
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
Because Linux cgroups propagate across `fork()` and `clone()`, all compilers, subshells, and background execution tasks spawned by the agent daemon automatically inherit the throttled `agent` slice. If an agent executes `cargo test -j8`, all 8 vCPUs may be utilized at 100% capacity, but the interactive desktop processes (`cpu.weight=800`) preempt the compiler instantly when user input or frame rendering occurs.

---

### Pillar 3: Multi-Display X11/VNC Routing, Token Multiplexing & noVNC Stream Delivery

#### Port Topology & Process Multiplexing
The microVM runs multiple concurrent virtual display stacks to support parallel agent tasks (e.g. Browser on Display :1, Code Editor on Display :2, Terminal on Display :3):

| Component | Port / Socket | Target Display | Description |
| :--- | :--- | :--- | :--- |
| **HTTP/WS Ingress Router** | `1339` | All | `sand-window-router.mjs`: Central ingress proxy dispatching to screen daemons |
| **Primary Agent Daemon** | `1337` | Display `:1` | Default agent daemon handling main browser / desktop session |
| **Fork Agent Daemons** | `14000 + DISPLAY_NUM` | Display `:N` | e.g. Port `14002` (:2), `14003` (:3), `14004` (:4), `14007` (:7) |
| **Fork PTY WebSockets** | `13600 + DISPLAY_NUM` | Display `:N` | Per-screen interactive terminal WebSocket servers |
| **X11 Unix Sockets** | `/tmp/.X11-unix/X<N>` | Display `:N` | Headless X virtual framebuffer sockets created by `Xvfb` |
| **VNC RFB Servers** | `5900 + DISPLAY_NUM` | Display `:N` | `x11vnc` binding to `127.0.0.1:5901`, `5902`, `5903` |
| **Primary noVNC Gateway** | `6080` | Display `:1` | Direct proxy to `127.0.0.1:5901` |
| **Token noVNC Gateway** | `6081` | Displays `:1`..`:N` | `websockify` with `TokenFile` plugin for dynamic multi-display stream routing |
| **Chrome CDP Debugging** | `9222 + DISPLAY_NUM` | Display `:N` | e.g. Port `9223` (:1), `9224` (:2), `9225` (:3) bound to `127.0.0.1` |

#### Sand Window Router (`sand-window-router.mjs`)
The router intercepts all HTTP and WebSocket requests arriving on port 1339. It inspects two critical headers:
1. `x-sand-display`: The requested display integer (defaults to `1` if omitted).
2. `x-sand-window-owner`: An authentication secret token.

**Routing Decision Algorithm (`decideWindowRoute`)**:
```javascript
export function decideWindowRoute({ displayHeader, ownerHeader, primaryPort, execBase, lookupBoundToken }) {
  const display = parseDisplayNumber(displayHeader);
  if (display <= 1) return { port: primaryPort }; // 1337
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
  return { port: execBase + display }; // 14000 + display
}
```
**Constant-Time Token Comparison (`tokensMatch`)**:
To prevent timing side-channel attacks across tenants, the token comparison uses Node.js `crypto.timingSafeEqual`:
```javascript
export function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```
Bound tokens are persisted on disk at `/tmp/sand-window-tokens.d/<display>`.

#### Websockify Token Routing (`TokenFile`)
On port `6081`, `websockify` runs with:
```bash
websockify \
  --web=/usr/share/novnc \
  --heartbeat=30 \
  --token-plugin TokenFile \
  --token-source /tmp/sand-novnc-tokens.txt \
  0.0.0.0:6081
```
The token file `/tmp/sand-novnc-tokens.txt` dynamically maps session tokens to RFB ports:
```text
agent1: 127.0.0.1:5901
user1:  127.0.0.1:5901
agent2: 127.0.0.1:5902
user2:  127.0.0.1:5902
agent3: 127.0.0.1:5903
user3:  127.0.0.1:5903
```
A client browser connects via WebSocket: `ws://<host>:6081/websockify?token=agent2`, which transparently routes to `127.0.0.1:5902`.

#### Pure Canvas & Bidirectional Clipboard Bridge (`patch-novnc.py`)
Standard noVNC includes an intrusive control bar and unoptimized clipboard handling. Sand deploys `patch-novnc.py` to:
1. Replace `vnc.html` with a clean `desktop.html` (pure 100% canvas, no UI bars).
2. Patch `keyboard.js` (`_handleKeyDown` / `_handleKeyUp`): Intercepts `Ctrl+V` and `Ctrl+C` cleanly without transmitting duplicate stale key events to X11 before the browser paste event resolves.
3. Patch `ui.js`: Implements an automatic bidirectional clipboard sync:
   - Remote selection automatically copies to the local OS clipboard.
   - Local clipboard pastes directly into the remote X11 primary/clipboard buffer via `RFB.clipboardPasteFrom(text)`.
   - On canvas focus or pointerdown, clipboard contents are synchronized seamlessly.

---

### Pillar 4: Multi-Monitor Chrome Shared Session Architecture

#### The Problem: Chrome Single-Instance Profile Locking
By design, Chromium instances refuse to share a single `--user-data-dir`. If a second Chrome instance is launched pointing to an active user data directory, Chrome sends an IPC message to the existing process to open a new tab on the existing display, failing to launch on the secondary X11 display (`Display :2` or `:3`).

#### The Solution: "One Box, One Session" (`link-chrome-session.sh`)
Sand solves this by creating distinct profile directories per display while symlinking the SQLite authentication databases:
1. **Profile Directory Topology**:
   - Primary: `/home/box/chrome-profile/Default`
   - Secondary: `/home/box/chrome-profile-${DISPLAY_NUM}/Default` (e.g. `chrome-profile-2`, `chrome-profile-3`)
2. **Selective SQLite Database Symlinks**:
   Inside `/home/box/chrome-profile-${DISPLAY_NUM}/Default`, specific database files are replaced with symbolic links pointing to the primary profile:
   - `Cookies` ➔ `/home/box/chrome-profile/Default/Cookies`
   - `Login Data` ➔ `/home/box/chrome-profile/Default/Login Data`
   - `Login Data For Account` ➔ `/home/box/chrome-profile/Default/Login Data For Account`
3. **Isolation of State**:
   All non-session files—`Preferences`, `SingletonLock`, `SingletonCookie`, cache directories, GPU caches, and socket paths—remain completely isolated within each profile.
4. **Rollback-Journal Concurrency**:
   Chromium's SQLite implementation operates in rollback-journal mode. Readers acquire shared read locks while writers acquire exclusive write locks with short busy-wait timeouts. Consequently, when a user logs into GitHub or Google on Screen 1, the cookies and session tokens are immediately readable by Screens 2 and 3 without requiring re-authentication.

#### Dual-Tier Live CDP Cookie Synchronization (`cdp-cookies.mjs`)
Because modern browsers cache session cookies in memory before flushing them to the SQLite `Cookies` table on disk, Sand runs an in-memory synchronization daemon (`cdp-cookies.mjs`):
- Connects to Primary Chrome CDP on port `9223` (`127.0.0.1:9223/json`).
- Polls every 1500ms for live session cookies.
- Pushes updated cookies into secondary Chrome instances on ports `9224` and `9225` using the CDP `Network.setCookies` API.

---

### Pillar 5: In-VM Agent Daemon Supervision & Crash-Loop Prevention

#### Process Hierarchy & Subreaper
Inside the microVM, processes are organized in a strict supervision hierarchy:
```
[PID 1: Container / MicroVM Entrypoint]
  │
  └─► [PID 53: /usr/local/bin/sand-exit-watch] (Python Subreaper)
        │
        ├─► [PID 167: sand-window-router.mjs] (HTTP/WS on :1339)
        ├─► [PID 139: websockify :6081] (Token Router)
        ├─► [PID 733: websockify :6080] (Display :1 Proxy)
        ├─► [PID 812: start-desktop] (Display :1 Stack: Xvfb, x11vnc, openbox, tint2)
        ├─► [PID 904: start-desktop] (Display :2 Stack)
        ├─► [PID 955: start-desktop] (Display :3 Stack)
        └─► [In-VM Agent Daemons / Exec Daemons] (Ports 1337, 14002, 14003)
```

**`sand-exit-watch` Responsibilities**:
1. **Subreaper Registration**: Invokes `prctl(PR_SET_CHILD_SUBREAPER, 1)`. When background processes daemonize or double-fork, orphaned children are re-parented to `sand-exit-watch` rather than PID 1, allowing proper monitoring.
2. **Zombie Reaping**: Implements a non-blocking `waitpid(-1, WNOHANG)` loop to harvest terminated child processes, preventing zombie accumulation from depleting the kernel PID table.
3. **Crash-Loop Backoff & Fatal Signal Logging**: Monitors exit statuses. If a core daemon exits with a fatal signal (`SIGSEGV`, `SIGABRT`, `SIGBUS`), it captures the backtrace, logs the failure, and enforces an exponential backoff before restarting to avoid CPU saturation.

#### Collision Defenses & Orphan Reapers ("The Box Suite")
When an agent or desktop stack restarts inside a long-lived microVM, leftover sockets, locks, and port bindings cause exit 1 crash loops. Sand employs targeted collision defenses:
- **`box-xvfb`**: Scans `/tmp/.X11-unix/X<N>` and `/proc/*/cmdline` using `ss` and `fuser`. It identifies processes squatting on the X11 socket, issues `SIGKILL`, and cleans stale `/tmp/.X<N>-lock` files.
- **`box-xfwm4`**: Scans for stale `xfwm4` instances on the target `DISPLAY`, sends `SIGTERM`, waits 1 second, and issues `SIGKILL`.
- **`box-picom`**: Reaps stale compositors holding the `_NET_WM_CM_S0` X11 selection before launching `picom`, eliminating the fatal "Another composite manager is already running" error.
- **`box-plank` / `tint2`**: Uses an X11 selection polling loop to wait until `_NET_WM_CM_S0` is registered before starting the dock, preventing dock transparent backgrounds from rendering as opaque black rectangles.
- **`box-x11vnc`**: Inspects RFB port `5900 + N` and frees socket squatters before binding.
- **`box-bounded-log.mjs`**: Maintains a 1 MB circular in-memory buffer ring for rotating log files, preventing chatty daemons from exhausting the microVM's ephemeral disk.

#### Protected Scripts Deny-List (`BOX_SCRIPTS_DENY`)
To prevent untrusted agent code or malicious remote code from tampering with hypervisor supervision scripts, the Frostfire daemon strictly forbids script updates to core filenames:
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

---

### Pillar 6: Network Isolation & Point-to-Point TAP Topology

#### Subnet Addressing & TAP Configuration
Each microVM is allocated a dedicated point-to-point tap interface on the hypervisor:
- **Tenant Tap Interface**: `tap<VM_INDEX>` (e.g. `tap0`, `tap1`, `tap2`).
- **Host Gateway IP**: `172.16.<VM_INDEX>.1/24` (e.g. `172.16.0.1`, `172.16.1.1`, `172.16.2.1`).
- **Guest MicroVM IP**: `172.16.<VM_INDEX>.2/24` (e.g. `172.16.0.2`, `172.16.1.2`, `172.16.2.2`).
- **Guest MAC Address**: `AA:FC:00:00:00:0<VM_INDEX>`.
- **Static Kernel Boot String**:
  ```text
  ip=172.16.<VM_INDEX>.2::172.16.<VM_INDEX>.1:255.255.255.0::eth0:off
  ```

#### Host Routing, NAT & Cross-Tenant Isolation
The host network setup (`cloud/microvm/host-setup.sh`) strictly enforces that guest microVMs cannot communicate with each other:
1. **IPv4 Forwarding**: `net.ipv4.ip_forward = 1` enabled on host.
2. **NAT Masquerade**: Outbound traffic exiting the physical WAN interface (`PRIMARY_IFACE`) is masqueraded:
   ```bash
   iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE
   ```
3. **Stateful Forwarding**:
   ```bash
   iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
   iptables -A FORWARD -i tap0 -o "${PRIMARY_IFACE}" -j ACCEPT
   iptables -A FORWARD -i tap1 -o "${PRIMARY_IFACE}" -j ACCEPT
   iptables -A FORWARD -i tap2 -o "${PRIMARY_IFACE}" -j ACCEPT
   ```
4. **Cross-Tenant Isolation Invariant**:
   Direct traffic between `tap<i>` and `tap<j>` is dropped by the default `FORWARD` policy (`DROP`). MicroVM 0 (`172.16.0.2`) cannot ping or connect to MicroVM 1 (`172.16.1.2`).
5. **No Inbound Public Egress**:
   No public ports are mapped to guest IPs. MicroVMs can only receive commands via the outbound-only reverse gRPC tunnel connected to the central gateway.

#### Spec Discrepancy Note
`docs/MICROVM_ARCHITECTURE.md` references `ip=172.30.0.2::172.30.0.1:255.255.255.0::eth0:off`. However, the project's authoritative rules (`AGENTS.md`), deployment templates (`cloudformation.yaml`, `firecracker-hypervisor.yaml`), and setup scripts (`host-setup.sh`, `run-vm.sh`) mandate **`172.16.x.0/24`**. The authoritative specification is `172.16.x.0/24`.

---

## 3. Discovered Related Features (Pillars 7 – 11)

During deep inspection of the architecture and codebase, five additional critical subsystem capabilities were discovered:

### Pillar 7: Inverted WebAuthn Passkey Hardware Key Bridge
- **Problem**: Headless cloud microVMs cannot access a developer's physical YubiKey, Apple Touch ID, or Windows Hello biometric authenticator.
- **Solution**:
  1. Chrome managed policy (`/etc/opt/chrome/policies/managed/sand-webauthn.json`) force-installs extension ID `pkjakndclmokfbgfnpgjieoebnbghhgb`.
  2. The extension intercepts `navigator.credentials.get(...)` and `create(...)` ceremonies.
  3. Relays ceremony payloads via Native Messaging to `sand-webauthn-proxy-host` (`webauthn-proxy-host.mjs`).
  4. The host packages the request into `WebAuthnCeremonyRequest` and streams it over the reverse gRPC tunnel to the client machine.
  5. The developer touches their hardware key on their local laptop; the signature is returned via `WebAuthnCeremonyResponse` and completed in the cloud Chrome session. Private keys never leave the developer's physical device.

### Pillar 8: Anti-Bot Fingerprint Governor & Stealth CDP
- In-VM scripts (`sand-fingerprint-profiles.mjs`, `sand-ua-governor.mjs`, `crates/frostfire-cli/src/browser.rs`) inject stealth runtime modifications before pages load.
- Overrides:
  - `navigator.webdriver = false`
  - Spoofs WebGL `UNMASKED_VENDOR_WEBGL` / `UNMASKED_RENDERER_WEBGL` (e.g. Intel Iris / NVIDIA GeForce instead of LLVMpipe)
  - Spoofs `navigator.plugins`, `navigator.languages`, and AudioContext fingerprint hashes.
- Prevents cloud IP and headless Chrome detection from triggering Cloudflare Turnstile or reCAPTCHA barriers during agent research.

### Pillar 9: Teach Session Recording & Gemini Flash SOP Compilation
- Script `/usr/local/bin/teach-session-recorder` (`cloud/microvm/scripts/teach-session-recorder.sh`) provides automated human-to-agent SOP training:
  1. **Video Capture**: Records display N at 1280x800, 15fps using FFmpeg `x11grab` (`demo.mp4`).
  2. **Telemetry Capture**: Queries `xdotool` every 500ms, capturing active window titles, classes, and mouse coordinates into `session-events.jsonl`.
  3. **Multimodal SOP Compilation**: In-VM agent (`TeachSessionManager` in `cloud/agent/src/teach.rs`) uploads video and event telemetry to Google Gemini 3.8 Flash, generating an actionable, step-by-step Standard Operating Procedure in Markdown (`SOP.md`).

### Pillar 10: Human-in-the-Loop (HITL) Execution Safety Gate
- Implemented in `cloud/agent/src/hitl.rs` (`HitlInterceptor`):
  - Read-only allowlist: `ls`, `pwd`, `cat`, `grep`, `rg`, `find`, `git status`, `git diff`, `git log`, etc.
  - High-risk operations (`rm`, `sudo`, `git push`, `git reset`, `curl`, `wget`) trigger an `ApprovalRequest` frame over the reverse tunnel.
  - Commands remain suspended until the user grants explicit approval via the Tauri desktop UI.

### Pillar 11: Display Takeover & Agent Interactivity Synchronization
- Implemented in `cloud/agent/src/main.rs`:
  - When a human user focuses and clicks into a display in noVNC, the gateway dispatches `DisplayTakeover { action: 0, display_number }`.
  - The in-VM agent immediately pauses autonomous mouse/keyboard operations on that display (`state.is_paused[display].store(true)`).
  - When the user clicks away or releases the session, `DisplayTakeover { action: 2, display_number }` resumes agent execution.

---

## 4. Authoritative Specifications & Interface Contracts

### Monolithic MicroVM Kernel Command-Line (`/proc/cmdline`)
```text
console=ttyS0 root=/dev/vda random.trust_cpu=on ip=172.16.0.2::172.16.0.1:255.255.255.0::eth0:off rw loglevel=7 earlyprintk=ttyS0 print-fatal-signals=1 systemd.unified_cgroup_hierarchy=1 systemd.setenv=SWAP_SIZE_MB=0 reboot=k panic=1 nomodule i8042.noaux=1 i8042.nomux=1 i8042.dumbkbd=1 clocksource=kvm-clock tsc=unstable nosoftlockup
```

### Virtualization & Hardware Specifications
| Parameter | Authoritative Value | Rationale |
| :--- | :--- | :--- |
| **Hypervisor** | KVM via AWS Firecracker v1.10.1 | Minimalist microVM monitor, memory-safe Rust, <5ms boot time |
| **vCPUs** | 4 to 8 vCPUs (Intel Xeon / AMD EPYC) | High-concurrency compiler and browser workloads |
| **Memory** | 4096 MB to 32768 MB | Sufficient for multi-display Chromium and language servers |
| **Swap** | 0 MB (`SWAP_SIZE_MB=0`) | Prevents disk I/O thrashing and latency degradation |
| **Root Device** | `/dev/vda` (VirtIO-Block) | High-performance paravirtualized block I/O |
| **Screen Resolution** | 1280x800 @ 24-bit depth | Optimized for Anthropic Computer Use and VNC bandwidth |
| **Default Display** | `:1` | Primary user/agent interface |
| **Subnet Scheme** | `172.16.x.0/24` | Strict point-to-point tap allocation per microVM |

---

## 5. Discovered Features Matrix

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Storage | OverlayFS Rootfs | CoW layering over immutable base image | Base ext4 image (`lowerdir`), ephemeral diff (`upperdir`) | Merged root `/` block device | Mount failure if workdir on distinct fs | `MICROVM_ARCHITECTURE.md`, `build-rootfs.sh` |
| 2 | Scheduling | Cgroups v2 Slices | Dual-slice priority partitioning | `systemd.unified_cgroup_hierarchy=1` | `/sys/fs/cgroup/interactive` and `/agent` | Fallback to unified root slice if missing | `MICROVM_ARCHITECTURE.md`, `service.rs` |
| 3 | Scheduling | Auto-Migration | Migrates agent daemon PID to `/agent` slice | Daemon process PID | Writes PID to `cgroup.procs` | Ignored if path does not exist (`#[cfg(target_os="linux")]`) | `service.rs` |
| 4 | Routing | Display Multiplexer | HTTP/WS proxy on port 1339 | `x-sand-display`, `x-sand-window-owner` | Proxies to port 1337 or `14000 + N` | 403 Forbidden on token mismatch, 502 on upstream error | `sand-window-router.mjs` |
| 5 | Security | Constant-Time Token Match | Prevents timing attacks on display tokens | Client token string, bound token string | Boolean match result | Rejection if lengths differ or values mismatch | `sand-window-router.mjs` (`timingSafeEqual`) |
| 6 | Display | Websockify Token Router | Maps dynamic tokens to internal VNC RFB | Token query string (`?token=agent2`) | Proxies WebSocket to `127.0.0.1:5902` | Disconnects client if token not found in token file | `start-desktop.sh`, `firecracker-hypervisor.yaml` |
| 7 | Display | noVNC Clean Canvas | Strips control bar, provides pure canvas | HTTP query parameters (`host`, `port`, `path`) | Full-viewport RFB canvas | Black screen fallback on WS disconnect | `patch-novnc.py` |
| 8 | Display | Clipboard Bridge | Bidirectional local/remote clipboard sync | Local paste / remote copy events | Synchronized clipboard text & toast UI | Fails gracefully if navigator.clipboard denied | `patch-novnc.py` |
| 9 | Browser | Chrome Session Linking | Symlinks SQLite Cookies/Login Data | Secondary profile directory path | Active symlinks in `Default/` | Skips if already linked or directory missing | `link-chrome-session.sh` |
| 10 | Browser | Live CDP Cookie Sync | Polls primary Chrome CDP, pushes to secondary | CDP ports `9223` (source), `9224`, `9225` (targets) | Synchronized in-memory cookies | Silent retry on connection refused | `cdp-cookies.mjs` |
| 11 | Supervision | Python Subreaper | Reaps orphaned child processes, catches exits | Process execution tree | Clean process reaping, crash telemetry | Exponential backoff on rapid restart loops | `MICROVM_ARCHITECTURE.md` (`sand-exit-watch`) |
| 12 | Supervision | Collision Defenses | Cleans stale X11 sockets, locks, compositors | `/tmp/.X11-unix/X*`, `/tmp/.X*-lock` | Terminated orphan processes, unlinked locks | Force SIGKILL if SIGTERM times out | `MICROVM_ARCHITECTURE.md` (`box-xvfb`, `box-picom`) |
| 13 | Supervision | Bounded RAM Logging | 1 MB circular in-memory buffer ring | Process stdout/stderr streams | Rotated log files in RAM | Drops oldest records when buffer fills | `MICROVM_ARCHITECTURE.md` (`box-bounded-log.mjs`) |
| 14 | Security | Protected Scripts Deny-List | Rejects updates to core init/supervision scripts | Script filename string | Boolean `is_allowed` | Rejects update request with error | `crates/frostfire-daemon/src/config.rs` |
| 15 | Networking | Point-to-Point TAP | Isolated /24 tap network per microVM | VM Index integer (0, 1, 2) | Interface `tap<N>`, Host `172.16.N.1`, Guest `172.16.N.2` | Setup fails if `/dev/net/tun` missing | `host-setup.sh`, `run-vm.sh` |
| 16 | Networking | Host NAT Masquerade | Routes guest internet egress through WAN | Outbound packet stream on tap interfaces | NAT-masqueraded packets on physical WAN | Packets dropped if ip_forward disabled | `host-setup.sh` |
| 17 | Auth | Inverted WebAuthn Bridge | Bridges hardware keys from local laptop to VM | `navigator.credentials.get` / `create` | Signed WebAuthn ceremony assertion | User cancellation or timeout returned to Chrome | `MICROVM_ARCHITECTURE.md` |
| 18 | Automation | Anti-Bot Fingerprint Spoof | Overrides bot-detection variables in Chrome | CDP target page initialization | Modifies `navigator.webdriver`, WebGL vendor | Fails silently if CDP unavailable | `MICROVM_ARCHITECTURE.md`, `browser.rs` |
| 19 | Multimodal | Teach Session Recording | Records X11 screen and interaction telemetry | Display number, session ID | `demo.mp4`, `session-events.jsonl` | Graceful SIGINT termination on stop | `teach-session-recorder.sh` |
| 20 | Multimodal | Gemini Flash SOP Compiler | Compiles video + events into Markdown SOP | `demo.mp4`, `session-events.jsonl` | Structured Markdown `SOP.md` | Returns error string if API key missing | `teach.rs` |
| 21 | Safety | HITL Command Interceptor | Classifies shell commands before execution | Shell command string | `CommandClassification` (safe or approval required) | Blocks execution until approval received | `hitl.rs` |
| 22 | Coordination| Display Takeover Pause | Pauses agent when human interacts with display | `DisplayTakeover` protocol frame | Sets atomic boolean `is_paused` for display | Unpaused upon release action | `cloud/agent/src/main.rs` |

---

## 6. Edge Cases & Boundary Conditions

| # | Feature | Input / Condition | Observed Behavior |
|---|---------|-------------------|-------------------|
| 1 | `sand-window-router.mjs` | Display number omitted or non-numeric (`x-sand-display: abc`) | `parseDisplayNumber` parses with `parseInt(val, 10)`, fails `isInteger`, defaults safely to `1` (Port 1337). |
| 2 | `sand-window-router.mjs` | Primary display `:1` requested with invalid or missing owner token | Route decision checks `display <= 1` and returns `{ port: primaryPort }` immediately. Token validation is only enforced for fork screens (`display > 1`). |
| 3 | `sand-window-router.mjs` | Fork display requested (`x-sand-display: 2`), token file missing in `/tmp/sand-window-tokens.d/2` | `readBoundToken` catches filesystem error, returns `undefined`. `tokensMatch` fails. Returns `403 Forbidden` (`owner-token mismatch`). |
| 4 | `sand-window-router.mjs` | Tokens have mismatched string lengths (e.g. 32 bytes vs 16 bytes) | `tokensMatch` checks `ab.length !== bb.length` and returns `false` immediately without calling `timingSafeEqual`, preventing Node.js buffer length exception. |
| 5 | `sand-window-router.mjs` | WebSocket `Upgrade` request arrives on port 1339 | **Critical Gap**: `sand-window-router.mjs` only attaches `http.createServer((req, res) => ...)`. It does not listen on `'upgrade'`, dropping WebSocket upgrades intended for PTY terminals on port 1339. Downstream agents must implement `server.on('upgrade', ...)`. |
| 6 | `link-chrome-session.sh` | Target symlink already points to the correct session file | Script tests `readlink "${link}" = "${target}"` and continues without unlinking, preventing SQLite lock corruption. |
| 7 | `link-chrome-session.sh` | Multiple Chrome displays write to `Cookies` simultaneously | SQLite rollback-journal mode handles concurrent access; writers acquire short-duration exclusive locks while readers retry during busy periods. |
| 8 | `box-picom` | Previous compositor crashed leaving X11 selection owner active | Scans for `_NET_WM_CM_S0`, sends `SIGKILL` to orphan owner, unlinks stale socket before starting new `picom`, preventing exit 1 crash. |
| 9 | `host-setup.sh` | Multiple VMs provisioned simultaneously | Unique tap interface (`tap0`, `tap1`, `tap2`) and distinct `/24` subnets (`172.16.0.0/24`, `172.16.1.0/24`, `172.16.2.0/24`) prevent ARP collisions and cross-talk. |
| 10 | `service.rs` | Executed on non-Linux platform (e.g. macOS / Windows host in dev mode) | Guarded by `#[cfg(target_os = "linux")]`; completely compiles out on Windows/macOS, preventing build or runtime failures. |

---

## 7. Downstream Implementation Plan & Recommendations

1. **Window Router WebSocket Upgrade**: Update `sand-window-router.mjs` to implement `server.on('upgrade', (req, socket, head) => ...)` to route terminal PTY WebSockets (`13600 + DISPLAY_NUM`) seamlessly through port 1339.
2. **Cgroup Slice Creation Daemon**: Ensure `box-cgroups.sh` is invoked during container/VM init before starting `start-desktop` or `frostfire-agent` to guarantee `/sys/fs/cgroup/interactive` and `/sys/fs/cgroup/agent` exist.
3. **Automated Rootfs Build Validation**: Integrate `cloud/microvm/build-rootfs.sh` into CI with automated syntax checking (`bash -n`) and container export dry-runs.
4. **Tenant Token Provisioning**: When spawning a new display dynamically, the orchestrator must atomically generate a 32-byte cryptographic token, write it to `/tmp/sand-window-tokens.d/<display>`, and transmit the token to the authorized client Tauri instance over gRPC.
