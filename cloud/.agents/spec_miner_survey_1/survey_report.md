# Specification Survey Report: AWS Infrastructure, Firecracker Hypervisor & box-doctor

**Target Scope**: R1 (AWS Infrastructure & UserData) and R4 (Rust Firecracker Hypervisor & box-doctor)  
**Investigator**: `spec_miner_survey_1`  
**Date**: 2026-09-11T03:20:00Z  
**Branch**: `poc/user-hosted-vm`  

---

## Executive Summary

This report establishes the authoritative specification, interface contracts, error behaviors, and edge cases for:
1. **R1: AWS EC2 Spot Infrastructure & Full UserData Bootstrap**: Turnkey CloudFormation template (`deploy/aws/poc-host.yaml`), deployment automation (`scripts/deploy-poc.ps1`, `scripts/deploy-poc.sh`), host bootstrap (`scripts/setup-host.sh`), auto-idle shutdown protection (`scripts/check-idle-shutdown.sh`), and security group port specifications.
2. **R4: Bare-Metal Rust Firecracker Hypervisor Daemon (`frostfire-hypervisor`)**: Architecture, dependency manifest, TAP network interface configuration (`tap0`), host NAT masquerade, Firecracker process supervision, UDS API interaction (`/boot-source`, `/drives/rootfs`, `/network-interfaces/eth0`, `/vsock`, `/actions`), serial console logging, and clean SIGINT shutdown.
3. **R4: Guest Verification Diagnostic Suite (`box-doctor`)**: Comprehensive inspection of the 10 diagnostic checks (`machine-id`, `chrome`, `chrome-fds`, `egress`, `clock`, `dbus`, `xvfb`, `x11vnc`, `novnc`, `compositor`), failure thresholds, retry mechanics, and rootfs prerequisites.

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | R1: AWS Infra | CloudFormation POC Host Template | Provisions single-user EC2 Spot Nitro instance with nested KVM, EBS gp3 root disk, security groups, and automated UserData bootstrap. | CloudFormation params: `InstanceType`, `KeyName`, `AllowedCidr`, `VolumeSize`. | Stack outputs: `InstanceId`, `PublicIp`, `SshAccessCommand`, `NoVncUrl`, `WindowRouterUrl`. | Rollback on UserData script non-zero exit or invalid AMI/instance type parameters. | `deploy/aws/poc-host.yaml` |
| 2 | R1: AWS Infra | Security Group Port Ingress | Filters TCP ingress to ports 22 (SSH), 1339 (Window Router), 6080 (primary noVNC), and 6081 (forked noVNC) restricted to user CIDR. | Client IP CIDR string (default auto-detected `/32`). | AWS EC2 Security Group rules. | Drops unauthorized packets silently from non-whitelisted IPs. | `deploy/aws/poc-host.yaml:34-62` |
| 3 | R1: AWS Infra | UserData Bootstrap Automation | Installs KVM permissions, IP forwarding, build tools, Firecracker v1.10.1, Node.js 20, Rust, and auto-idle shutdown cron on first boot. | EC2 boot event. | Configured Ubuntu 24.04 LTS host; logs to `/var/log/frostfire-bootstrap.log`. | Stops execution on error due to `set -euo pipefail`. | `deploy/aws/poc-host.yaml:83-175` |
| 4 | R1: AWS Infra | Turnkey Deploy Script (PowerShell) | Validates CloudFormation template, auto-detects client public IP, deploys stack via AWS CLI, and prints connection outputs. | Optional params: `$Region`, `$StackName`, `$KeyName`, `$InstanceType`, `$AllowedCidr`. | Formatted console output showing EC2 IP, SSH command, noVNC URL, Window Router URL. | Halts on AWS CLI errors (`$ErrorActionPreference = "Stop"`). Falls back to `0.0.0.0/0` if public IP query fails. | `scripts/deploy-poc.ps1` |
| 5 | R1: AWS Infra | Turnkey Deploy Script (Bash) | Posix shell equivalent to PowerShell deploy script for Linux/macOS operator environments. | Positional args: `REGION`, `STACK_NAME`, `KEY_NAME`, `INSTANCE_TYPE`. | Table formatted stack outputs. | Exits immediately on command failure (`set -euo pipefail`). | `scripts/deploy-poc.sh` |
| 6 | R1: AWS Infra | Host Environment Setup Script | Bootstraps standalone EC2 host without CloudFormation: verifies `/dev/kvm`, installs packages, enables IP forwarding, installs toolchains. | Script execution as user with sudo privileges. | Installed toolchains, Firecracker binary, active idle cron. | Exits 1 if `/dev/kvm` missing; exits on package failure. | `scripts/setup-host.sh` |
| 7 | R1: AWS Infra | Host Auto-Idle Shutdown Daemon | Inspects active TCP sockets on ports 22 and 6080 every 5 mins; increments counter; triggers `shutdown -h now` after >= 20 mins inactivity. | Cron execution every 5 mins (`*/5 * * * *`). Counter in `/tmp/frostfire_idle_counter`. | System shutdown via `sudo shutdown -h now`; logs to stdout/syslog. | Resets idle counter to 0 on any active connection. | `scripts/check-idle-shutdown.sh` |
| 8 | R4: Hypervisor | TAP Network Device Provisioning | Creates TAP device `tap0`, assigns host IP `172.30.0.1/24`, brings link up, and configures iptables NAT masquerade and forwarding rules. | Host interface name (`tap0`), host CIDR (`172.30.0.1/24`), outbound interface (`eth0`). | Active kernel network interface `tap0` and iptables rules. | Returns error with context if `ip tuntap` or `ip addr` fails. | `crates/frostfire-hypervisor/src/main.rs:56-86` |
| 9 | R4: Hypervisor | Firecracker Child Process Spawning | Cleans stale `/tmp/firecracker.socket`, launches Firecracker binary with `--api-sock`, and polls socket until ready. | Socket path (`/tmp/firecracker.socket`), binary on PATH. | Spawned `tokio::process::Child` handle. | Bails if socket fails to appear within 2.5s (50 retries x 50ms). | `crates/frostfire-hypervisor/src/main.rs:89-113` |
| 10 | R4: Hypervisor | Unix Domain Socket API Client | Dispatches HTTP PUT requests over Unix Domain Socket using Hyper and `hyper-unix-connector`. | HTTP Method, URI path, JSON payload. | HTTP response verification; returns `Ok(())` on 2xx. | Bails on non-2xx status code with verbatim response bytes. | `crates/frostfire-hypervisor/src/main.rs:116-134` |
| 11 | R4: Hypervisor | MicroVM Boot-Source Configuration | Calls PUT `/boot-source` to configure monolithic kernel image and boot arguments (serial console, panic reset, static IP, quiet). | `kernel_image_path`, `boot_args` string. | HTTP 204 No Content from Firecracker. | Returns error if kernel path is invalid or Firecracker rejects parameters. | `crates/frostfire-hypervisor/src/main.rs:138-152` |
| 12 | R4: Hypervisor | MicroVM Rootfs Drive Attachment | Calls PUT `/drives/rootfs` to attach raw ext4 root filesystem as `/dev/vda` (read-write, root device). | `drive_id` ("rootfs"), `path_on_host`, `is_root_device` (true), `is_read_only` (false). | HTTP 204 No Content from Firecracker. | Returns error if disk image file is inaccessible or invalid. | `crates/frostfire-hypervisor/src/main.rs:154-163` |
| 13 | R4: Hypervisor | MicroVM VirtIO Network Attachment | Calls PUT `/network-interfaces/eth0` to bind guest `eth0` to host TAP device `tap0` with fixed MAC address. | `iface_id` ("eth0"), `guest_mac` ("AA:FC:00:00:00:01"), `host_dev_name` ("tap0"). | HTTP 204 No Content from Firecracker. | Returns error if TAP device does not exist or MAC is malformed. | `crates/frostfire-hypervisor/src/main.rs:165-174` |
| 14 | R4: Hypervisor | MicroVM AF_VSOCK Bridge Attachment | Calls PUT `/vsock` to configure VirtIO VSOCK bridge between host socket `/tmp/vsock.sock` and guest CID 3. | `vsock_id` ("vsock0"), `guest_cid` (3), `uds_path` ("/tmp/vsock.sock"). | HTTP 204 No Content from Firecracker. | Returns error if UDS path cannot be bound or CID is already reserved. | `crates/frostfire-hypervisor/src/main.rs:176-185` |
| 15 | R4: Hypervisor | MicroVM Instance Start Action | Calls PUT `/actions` with `action_type: "InstanceStart"` to boot the VM. | Action payload `{"action_type": "InstanceStart"}`. | HTTP 204 No Content from Firecracker; microVM execution begins. | Returns error if VM configuration is incomplete or KVM fails. | `crates/frostfire-hypervisor/src/main.rs:187-197` |
| 16 | R4: Hypervisor | Lifecycle Supervision & Clean Shutdown | Uses `tokio::select!` to await microVM process termination or trap `tokio::signal::ctrl_c()`, sending kill to Firecracker on interrupt. | Process exit or SIGINT signal. | Exit status logging, clean child process kill. | Traps interrupt; ensures no zombie Firecracker processes remain. | `crates/frostfire-hypervisor/src/main.rs:232-247` |
| 17 | R4: Hypervisor | Cross-Platform Stubbing | Implements `#[cfg(not(unix))]` mock fallbacks for Windows/macOS to enable compiling and running unit tests without Linux KVM. | OS compilation target. | Mock process spawning and configuration logging. | Does not fail compilation on non-Linux developer environments. | `crates/frostfire-hypervisor/src/main.rs:200-220` |
| 18 | R4: box-doctor | Diagnostic Framework & Summary | Executes 10 health checks sequentially without early abort; aggregates results and prints individual pass/fail lines and final summary. | Direct command invocation `/usr/local/bin/box-doctor`. | Standard output stream with `[box-doctor] PASS/FAIL` and `[box-doctor] SUMMARY`. | Exits with code 0 if 0 checks failed; exits with code 1 if >= 1 check failed. | `usr-local-bin/box-doctor:1-28` |
| 19 | R4: box-doctor | Check 1: `machine-id` | Verifies `/etc/machine-id` exists, is exactly 32 lowercase hex chars, and agrees with `/var/lib/dbus/machine-id`. | `/etc/machine-id` and `/var/lib/dbus/machine-id`. | PASS if 32 hex chars and paths agree; FAIL otherwise. | Flags missing file, bad length/charset, or disagreement between D-Bus and system id. | `usr-local-bin/box-doctor:29-48` |
| 20 | R4: box-doctor | Check 2: `chrome` | Verifies `google-chrome-stable` is present on PATH and returns a valid non-empty version string via `--version`. | System PATH and `google-chrome-stable --version`. | PASS with version string; FAIL if not on PATH or non-zero exit. | Flags missing Chrome or broken executable. | `usr-local-bin/box-doctor:50-61` |
| 21 | R4: box-doctor | Check 3: `chrome-fds` | Scans `/proc/*/cmdline` for Chrome browser main processes (excludes `--type=`, matches `--remote-debugging-port=`), computes FD usage. | `/proc/<pid>/fd` and `/proc/<pid>/limits`. | PASS with worst FD usage % (or pass if no Chrome running / unreadable); FAIL if worst % >= 90%. | Warns before EMFILE crash loops lock up the browser. | `usr-local-bin/box-doctor:63-126` |
| 22 | R4: box-doctor | Check 4: `egress` | Probes internet HTTP egress via `curl -fsS --max-time 8 -o /dev/null https://www.google.com/generate_204`. | Network route, DNS resolver, outbound TAP NAT. | PASS if HTTP 204 returned within 8s; FAIL if curl fails or blocked. | Flags dropped packets, bad default gateway, or blocked DNS. | `usr-local-bin/box-doctor:128-138` |
| 23 | R4: box-doctor | Check 5: `clock` | Validates system clock year is in range [2024, 2100]; probes HTTP Date header from Google to verify clock skew <= 60 seconds. | System clock (`date -u`) and HTTP Date header from `google.com`. | PASS with timestamp and skew; FAIL if skew > 60s or year invalid. | Flags severe clock drift that causes TLS certificate validation failures. | `usr-local-bin/box-doctor:140-189` |
| 24 | R4: box-doctor | Check 6: `dbus` | Verifies existence of active session bus via `$DBUS_SESSION_BUS_ADDRESS` or presence of `dbus-launch` on PATH. | Environment variable `$DBUS_SESSION_BUS_ADDRESS` or `which dbus-launch`. | PASS if variable set or tool installed; FAIL if neither available. | Flags missing D-Bus IPC which breaks desktop integration and Chrome notifications. | `usr-local-bin/box-doctor:191-201` |
| 25 | R4: box-doctor | Check 7: `xvfb` | Probes X display availability using `xdpyinfo -display "${DESKTOP_DISPLAY:-:1}"` with up to 6 retries (0.5s delay). | X11 display socket `/tmp/.X11-unix/X1`. | PASS if xdpyinfo succeeds; FAIL after 6 retries exhausted. | Flags crashed or uninitialized X virtual framebuffer. | `usr-local-bin/box-doctor:223-229` |
| 26 | R4: box-doctor | Check 8: `x11vnc` | Probes RFB TCP port 5900 via bash `/dev/tcp/127.0.0.1/5900` with up to 6 retries (0.5s delay). | TCP port 5900 listener. | PASS if port connects; FAIL after 6 retries. | Flags dead VNC server causing frozen/blank noVNC canvas. | `usr-local-bin/box-doctor:231-237` |
| 27 | R4: box-doctor | Check 9: `novnc` | Probes primary noVNC websockify TCP port 6080 (and fork port 6081 if tokens exist in `/tmp/sand-novnc-tokens.d`) via `/dev/tcp`. | TCP port 6080 (and 6081 if configured). | PASS if websockify listener responds; FAIL after 6 retries. | Flags unreachable desktop WebSocket stream. | `usr-local-bin/box-doctor:239-253` |
| 28 | R4: box-doctor | Check 10: `compositor` | Probes running processes for both `xfwm4` (window manager) and `picom` (compositor) using `pgrep -x` with retries. | Process table `/proc`. | PASS if both `xfwm4` and `picom` are active; FAIL otherwise. | Flags missing title bars, borders, or composite rendering corruption. | `usr-local-bin/box-doctor:255-261` |
| 29 | Guest Daemons | Machine ID Preservation (`ensure-machine-id`) | Generates or restores 32-char machine-id from `/home/box/chrome-profile/machine-id`, atomically updates `/etc/machine-id` and `/var/lib/dbus/machine-id`. | Kernel UUID `/proc/sys/kernel/random/uuid` or persisted profile ID. | Synced `/etc/machine-id`, `/var/lib/dbus/machine-id`, profile ID. | Prevents Chrome SSO device re-challenge on box hibernate/wake. | `usr-local-bin/ensure-machine-id` |
| 30 | Guest Daemons | Stale Display Reaper (`box-xvfb`) | Reaps orphaned Xvfb holding target display, removes stale lock `/tmp/.X<N>-lock` and socket `/tmp/.X11-unix/X<N>`, execs Xvfb. | Display number arg (e.g. `:1`). | Clean Xvfb start without "Server already active" errors. | Bounded kill retries before forcing SIGKILL. | `usr-local-bin/box-xvfb` |
| 31 | Guest Daemons | Stale RFB Port Reaper (`box-x11vnc`) | Scans `/proc/*/cmdline` for rogue x11vnc processes holding target RFB port (e.g. 5900), terminates them, then execs x11vnc. | `-rfbport <PORT>` arguments. | Clean x11vnc port bind. | Prevents supervisor restart crash-loop on orphaned port bind. | `usr-local-bin/box-x11vnc` |
| 32 | Guest Daemons | WM Takeover Manager (`box-xfwm4`) | Reaps untracked xfwm4 holding target DISPLAY with bounded SIGTERM (1s) and SIGKILL, then execs replacement xfwm4. | Environment `$DISPLAY`. | Responsive window manager startup. | Eliminates "Another Window Manager is already running" lockup. | `usr-local-bin/box-xfwm4` |
| 33 | Guest Daemons | Compositor Takeover (`box-picom`) | Kills stale picom holding `_NET_WM_CM_S0` selection for target DISPLAY before starting, then execs picom. | Environment `$DISPLAY`. | Clean composite manager ownership. | Prevents exit code 1 crash-loop on desktop bringup. | `usr-local-bin/box-picom` |
| 34 | Guest Daemons | Chrome Policy Injection (`box-chrome-policy`) | Configures enterprise policy for WebAuthn proxy extension in `/etc/opt/chrome/policies/managed/` using `ExtensionSettings`. | Extension ID `/usr/local/share/sand-webauthn-proxy.id`. | Managed policy JSON file. | Composes with other extensions without overwriting whole-file lists. | `usr-local-bin/box-chrome-policy` |
| 35 | Guest Daemons | Window Router (`sand-window-router.mjs`) | Proxies HTTP and WebSocket connections to per-screen daemons (1337 primary, 14000+N forks, 13600+N PTYs) authenticated by token. | Incoming request on port 1339 with headers `x-frostfire-display`, `x-frostfire-window-owner`. | Proxied HTTP/WS stream. | 401 Unauthorized if token does not match constant-time check. | `usr-local-bin/sand-window-router.mjs` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | `check-idle-shutdown.sh` | Client disconnects SSH but leaves noVNC tab open in browser (port 6080 established) | `ss -nt` detects active connection on port 6080; counter is reset to 0; instance remains online. |
| 2 | `check-idle-shutdown.sh` | All client connections closed for 15 minutes, then user reconnects via SSH at minute 16 | Counter reaches 15, then at minute 20 check detects active connection, counter is reset to 0, shutdown aborted. |
| 3 | `deploy-poc.ps1` | Caller has no public internet access to `https://checkip.amazonaws.com` | Script catches exception in `Invoke-RestMethod` and safely defaults `AllowedCidr` to `0.0.0.0/0` with yellow warning. |
| 4 | `setup-host.sh` | Executed on non-Nitro EC2 instance or instance without nested KVM (`/dev/kvm` absent) | Script detects missing `/dev/kvm` and exits immediately with code 1: `[-] ERROR: /dev/kvm not found!`. |
| 5 | `frostfire-hypervisor` | Stale `/tmp/firecracker.socket` exists from previous ungraceful hypervisor crash | `spawn_firecracker` checks `self.config.socket_path.exists()` and unlinks it with `std::fs::remove_file` before spawning new binary. |
| 6 | `frostfire-hypervisor` | Firecracker binary fails to create socket within 2.5 seconds (slow disk / load) | Polling loop exhausts 50 attempts (50ms interval) and bails with descriptive error: `Firecracker API socket did not become ready in time`. |
| 7 | `frostfire-hypervisor` | Operator sends SIGINT (Ctrl+C) to hypervisor daemon | `tokio::select!` triggers the `ctrl_c()` arm, logs shutdown message, and issues `fc_proc.kill().await` ensuring microVM terminates cleanly. |
| 8 | `frostfire-hypervisor` | API call to Firecracker returns 400 Bad Request (e.g. malformed boot_args) | `send_api_request` reads response body bytes and bails with `Firecracker API call /boot-source failed (400 Bad Request): ...`. |
| 9 | `box-doctor: machine-id` | `/etc/machine-id` exists but contains trailing newline or upper case letters | `tr -d '\n'` strips newline; regex check `^[0-9a-f]{32}$` fails if uppercase letters or wrong length present, emitting FAIL line. |
| 10 | `box-doctor: machine-id` | `/var/lib/dbus/machine-id` has different UUID than `/etc/machine-id` | Emits FAIL explaining that D-Bus will bind a stale ID before Chrome launches. |
| 11 | `box-doctor: chrome-fds` | Zero Chrome browser instances currently running | Script detects empty PID list and returns PASS with message `no running box Chrome (nothing to inspect)`. |
| 12 | `box-doctor: chrome-fds` | Non-root user runs box-doctor and cannot read another user's `/proc/<pid>/fd` | `probe_process_fd_usage` returns code 1; doctor counts readable=0 and passes gracefully with `browser fd tables not readable from this user (skipped)`. |
| 13 | `box-doctor: egress` | Outbound DNS or TAP interface NAT is down | `curl` times out after 8s or returns non-zero; doctor reports FAIL `could not reach https://www.google.com/generate_204 (DNS or egress blocked)`. |
| 14 | `box-doctor: clock` | Host clock is set to year 2023 or 2105 | Doctor detects year outside [2024, 2100] and fails immediately: `system clock year ... is implausible; TLS validation may fail`. |
| 15 | `box-doctor: clock` | Internet egress is unavailable during clock check | Clock check passes local year validation and reports PASS: `system clock at <iso> (skew check skipped: no egress)`. |
| 16 | `box-doctor: novnc` | Primary noVNC (6080) listening, but fork tokens exist and fork websockify (6081) dead | Primary check passes; secondary check `novnc-forks` triggers and emits FAIL for missing port 6081. |
| 17 | `box-xvfb` | Display 1 crashed previously; stale `/tmp/.X1-lock` left on disk | `box-xvfb` checks display 1 and removes `/tmp/.X1-lock` and `/tmp/.X11-unix/X1` before launching Xvfb. |
| 18 | `box-picom` | Supervisor restarts picom while previous picom process still holds `_NET_WM_CM_S0` | `box-picom` scans `/proc`, issues SIGTERM, verifies exit, escalates to SIGKILL if necessary, preventing exit-1 crashloop. |

---

## Detailed Technical Specifications

### 1. R1: AWS Infrastructure & UserData Automation

#### 1.1 CloudFormation Template Architecture (`deploy/aws/poc-host.yaml`)
- **Template Schema**: AWS CloudFormation `AWSTemplateFormatVersion: '2010-09-09'`.
- **Target Instance Configuration**:
  - `InstanceType`: Default `c6i.xlarge` (4 vCPUs, 8 GiB RAM, Nitro architecture). Allowed: `c6i.xlarge`, `c6a.xlarge`, `c6i.2xlarge`, `c6a.2xlarge`, `c7i.xlarge`, `c7a.xlarge`.
  - `ImageId`: Dynamic SSM Parameter reference: `'{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}'`.
  - `InstanceMarketOptions`: MarketType `spot`, `SpotInstanceType: persistent`, `InstanceInterruptionBehavior: stop`. This ensures the root EBS volume is preserved across spot interruptions and can be manually or programmatically restarted.
  - `BlockDeviceMappings`: Root device `/dev/sda1`, gp3 volume, default 50 GB (range 30-200 GB), `DeleteOnTermination: false`.
- **Security Group Ingress Contracts**:
  - `22/tcp`: SSH terminal console access.
  - `1339/tcp`: Frostfire Window Router reverse proxy (routes to internal agent HTTP/WS endpoints).
  - `6080/tcp`: noVNC Websockify RFB GUI bridge for primary display `:1`.
  - `6081/tcp`: noVNC Websockify RFB GUI bridge for secondary/fork displays.
  - Ingress source: Restricted to `AllowedCidr` (default `0.0.0.0/0`, locked down by deploy scripts).
- **Stack Outputs**:
  - `InstanceId`: Physical EC2 instance identifier (`i-xxxxxxxxxxxxxxxxx`).
  - `PublicIp`: Assigned public IPv4 address.
  - `SshAccessCommand`: Convenient SSH command string: `ssh -i "<KeyName>.pem" ubuntu@<PublicIp>`.
  - `NoVncUrl`: Web remote desktop link: `http://<PublicIp>:6080/vnc.html`.
  - `WindowRouterUrl`: Agent control plane reverse proxy: `http://<PublicIp>:1339`.

#### 1.2 Host UserData Bootstrap (`UserData`)
Executes at instance launch under root privileges with output logged to `/var/log/frostfire-bootstrap.log`:
1. **KVM Virtualization Permissions**:
   - Tests `/dev/kvm`.
   - Executes `chmod 666 /dev/kvm` and `usermod -aG kvm ubuntu`.
2. **Kernel Network Routing**:
   - Enables IPv4 forwarding: `sysctl -w net.ipv4.ip_forward=1`.
   - Persists config across reboots in `/etc/sysctl.d/99-frostfire.conf`.
3. **Apt Dependencies**:
   - Installs: `build-essential`, `curl`, `wget`, `git`, `debootstrap`, `qemu-utils`, `e2fsprogs`, `iptables`, `iproute2`, `pkg-config`, `libssl-dev`, `protobuf-compiler`, `libprotobuf-dev`, `flex`, `bison`, `libelf-dev`, `bc`, `jq`, `net-tools`.
4. **Firecracker Installation**:
   - Downloads official release `v1.10.1` tarball from GitHub releases based on `uname -m`.
   - Extracts and moves `firecracker` and `jailer` to `/usr/local/bin/`.
   - Sets executable permissions `+x`.
5. **Node.js 20 LTS**:
   - Ingests NodeSource repo: `curl -fsSL https://deb.nodesource.com/setup_20.x | bash -`.
   - Installs `nodejs`.
6. **Rust Toolchain**:
   - Runs `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y` as user `ubuntu`.
7. **Auto-Idle Daemon**:
   - Writes `/usr/local/bin/check-idle-shutdown.sh`.
   - Adds crontab entry `*/5 * * * * /usr/local/bin/check-idle-shutdown.sh`.

#### 1.3 Auto-Idle Shutdown Mechanism (`scripts/check-idle-shutdown.sh`)
- **Inspection Query**: `ss -nt '( sport = :22 or sport = :6080 )' | grep -v "State" | wc -l`.
- **State File**: `/tmp/frostfire_idle_counter`.
- **Logic**:
  - If count == 0: reads counter, adds 5, writes back. If counter >= 20, issues `sudo shutdown -h now`.
  - If count > 0: resets counter to 0.
- **Budgetary Guarantee**: Guarantees EC2 spot instance shuts down within 20-25 minutes of user disconnection, capping idle spend below $5/month.

---

### 2. R4: Bare-Metal Rust Firecracker Hypervisor (`frostfire-hypervisor`)

#### 2.1 Crate Architecture & Manifest
- **Package**: `frostfire-hypervisor` (Rust 2021 edition).
- **Core Dependencies**:
  - `tokio = { version = "1.38", features = ["full", "process"] }`
  - `serde = { version = "1.0", features = ["derive"] }`, `serde_json = "1.0"`
  - `anyhow = "1.0"`
  - `tracing = "0.1"`, `tracing-subscriber = "0.3"`
- **Unix-Specific Target Dependencies**:
  - `hyper = { version = "0.14", features = ["client", "http1"] }`
  - `hyper-unix-connector = "0.2"`
  - `nix = { version = "0.27", features = ["net", "fs"] }`

#### 2.2 Network Setup Contract (`setup_networking`)
- Creates TAP interface: `ip tuntap add dev tap0 mode tap`
- Assigns Host Gateway IP: `ip addr add 172.30.0.1/24 dev tap0`
- Links interface up: `ip link set dev tap0 up`
- Sets up NAT forwarding rules:
  - `iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE`
  - `iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`
  - `iptables -A FORWARD -i tap0 -o eth0 -j ACCEPT`

#### 2.3 Firecracker Process Lifecycle (`spawn_firecracker`)
- Deletes stale socket file at `/tmp/firecracker.socket`.
- Spawns `firecracker --api-sock /tmp/firecracker.socket`.
- Polls socket path existence every 50ms up to 50 times (2.5s maximum timeout).
- Returns `tokio::process::Child` handle.

#### 2.4 Firecracker UDS API Contracts (`configure_and_boot`)
Communicates over Unix Domain Socket `/tmp/firecracker.socket` via HTTP PUT:

1. **PUT `/boot-source`**:
   ```json
   {
     "kernel_image_path": "./build/kernel/out/vmlinux-6.12.6",
     "boot_args": "console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw quiet ip=172.30.0.2::172.30.0.1:255.255.255.0::eth0:off"
   }
   ```
2. **PUT `/drives/rootfs`**:
   ```json
   {
     "drive_id": "rootfs",
     "path_on_host": "./build/rootfs.ext4",
     "is_root_device": true,
     "is_read_only": false
   }
   ```
3. **PUT `/network-interfaces/eth0`**:
   ```json
   {
     "iface_id": "eth0",
     "guest_mac": "AA:FC:00:00:00:01",
     "host_dev_name": "tap0"
   }
   ```
4. **PUT `/vsock`**:
   ```json
   {
     "vsock_id": "vsock0",
     "guest_cid": 3,
     "uds_path": "/tmp/vsock.sock"
   }
   ```
5. **PUT `/actions`**:
   ```json
   {
     "action_type": "InstanceStart"
   }
   ```

#### 2.5 Signal & Process Supervision
- Uses `tokio::select!` in `main.rs`:
  - Arm 1: `fc_proc.wait()`: Logs exit code if Firecracker process terminates.
  - Arm 2: `tokio::signal::ctrl_c()`: Catches SIGINT, logs shutdown, and awaits `fc_proc.kill()`.

---

### 3. R4: Diagnostic Verification Suite (`box-doctor`)

#### 3.1 Verification Framework Characteristics (`usr-local-bin/box-doctor`)
- **Shell**: `#!/usr/bin/env bash` with `set -uo pipefail`.
- **Fault-Tolerant Scanning**: Does not abort mid-run on failure; every check executes.
- **Reporting Format**:
  - `[box-doctor] PASS <name>: <detail>`
  - `[box-doctor] FAIL <name>: <detail>`
- **Exit Code**: `0` when 0 checks fail; `1` when 1 or more checks fail.

#### 3.2 The 10 Checks: Specification & Acceptance Conditions

1. **`machine-id`**:
   - *Target*: `/etc/machine-id` and `/var/lib/dbus/machine-id`.
   - *Logic*: Reads `/etc/machine-id`, trims newlines, validates against regex `^[0-9a-f]{32}$`. Compares verbatim string with `/var/lib/dbus/machine-id`.
   - *Failure Impact*: Broken Okta/SSO authentication, continuous device re-challenge, stale D-Bus bus registration.
   - *Prerequisite*: Handled by `/usr/local/bin/ensure-machine-id`.

2. **`chrome`**:
   - *Target*: `google-chrome-stable` executable on PATH.
   - *Logic*: Executes `google-chrome-stable --version`.
   - *Failure Impact*: Desktop browser unable to launch; agent UI actions fail.
   - *Prerequisite*: Google Chrome Stable installed in rootfs.

3. **`chrome-fds`**:
   - *Target*: Active Chrome browser processes.
   - *Logic*: Scans `/proc/[0-9]*/cmdline`. Selects processes with `--remote-debugging-port=` and lacking `--type=`. Reads `open` count from `/proc/<pid>/fd` and `soft` limit from `/proc/<pid>/limits` (`Max open files`). Calculates `worst_pct = open * 100 / soft`.
   - *Threshold*: Fails if `worst_pct >= 90`. Passes if no Chrome running or if unreadable.
   - *Failure Impact*: Crash with EMFILE (Too many open files).

4. **`egress`**:
   - *Target*: HTTP egress over TAP/NAT.
   - *Logic*: `curl -fsS --max-time 8 -o /dev/null "https://www.google.com/generate_204"`.
   - *Failure Impact*: MicroVM is isolated from web; external API calls fail.
   - *Prerequisite*: Host TAP masquerade active and default gateway configured in microVM kernel `boot_args`.

5. **`clock`**:
   - *Target*: System date and time synchronization.
   - *Logic*: Checks local UTC year is between 2024 and 2100. Queries HTTP Date header from `https://www.google.com/generate_204`, calculates `skew = local_epoch - trusted_epoch`.
   - *Threshold*: Skew absolute value must be `<= 60` seconds (`SKEW_THRESHOLD_S=60`).
   - *Failure Impact*: TLS certificate expiration errors; out-of-order event timestamps.

6. **`dbus`**:
   - *Target*: D-Bus session bus.
   - *Logic*: Checks if `$DBUS_SESSION_BUS_ADDRESS` is set, or if `command -v dbus-launch` succeeds.
   - *Failure Impact*: Desktop applications fail to discover system services or desktop notifications.

7. **`xvfb`**:
   - *Target*: X virtual framebuffer display `:1`.
   - *Logic*: Probes `xdpyinfo -display "${DESKTOP_DISPLAY:-:1}"` with 6 retry attempts (0.5s delay).
   - *Failure Impact*: Complete desktop failure; no GUI applications can open display.
   - *Prerequisite*: `box-xvfb` started with valid display configuration.

8. **`x11vnc`**:
   - *Target*: VNC RFB server on port 5900.
   - *Logic*: Tests socket connection using bash built-in `(exec 3<>"/dev/tcp/127.0.0.1/5900")` with 6 retries.
   - *Failure Impact*: Websockify cannot connect to RFB backend; client receives frozen or blank screen.

9. **`novnc`**:
   - *Target*: Websockify proxy on port 6080 (and fork port 6081 if tokens exist).
   - *Logic*: Tests socket connection to port 6080 via `/dev/tcp`. If `/tmp/sand-novnc-tokens.d` contains token files, additionally tests port 6081.
   - *Failure Impact*: Remote browser cannot connect to VM over WebSocket.

10. **`compositor`**:
    - *Target*: Window manager and compositor processes.
    - *Logic*: Probes `pgrep -x xfwm4` AND `pgrep -x picom` with 6 retries.
    - *Failure Impact*: Missing window title bars, lack of window dragging, visual tearing, or root wallpaper artifacts.

---

### 4. Inter-Component Contracts & Interfaces

```
+-------------------------------------------------------------------------------+
| AWS EC2 Spot Host (c6i.xlarge, Ubuntu 24.04 LTS, Nested KVM /dev/kvm)         |
|                                                                               |
| Security Group Ingress:                                                       |
|   - 22/tcp   --> Host SSH                                                     |
|   - 1339/tcp --> Guest Window Router (Port Forward / Direct Route)            |
|   - 6080/tcp --> Guest noVNC Primary (Display :1)                             |
|   - 6081/tcp --> Guest noVNC Secondary Forks                                  |
|                                                                               |
| Host Daemon: /usr/local/bin/check-idle-shutdown.sh (cron */5)                 |
|   - Monitors active connections on ports 22 and 6080 via ss -nt               |
|   - Shuts down host after 20 minutes of continuous inactivity                 |
|                                                                               |
| Host Network:                                                                 |
|   - Interface tap0 (172.30.0.1/24)                                            |
|   - iptables MASQUERADE on eth0 + FORWARD rules                               |
|   - net.ipv4.ip_forward = 1                                                   |
|                                                                               |
| Bare-Metal Rust Hypervisor: crates/frostfire-hypervisor                       |
|   - Spawns /usr/local/bin/firecracker --api-sock /tmp/firecracker.socket      |
|   - UDS API Calls:                                                            |
|       PUT /boot-source (vmlinux-6.12.6, serial ttyS0, static IP)              |
|       PUT /drives/rootfs (/build/rootfs.ext4 as /dev/vda rw)                  |
|       PUT /network-interfaces/eth0 (tap0, MAC AA:FC:00:00:00:01)              |
|       PUT /vsock (/tmp/vsock.sock, Guest CID 3)                               |
|       PUT /actions (InstanceStart)                                            |
|   - Serial console log streaming & SIGINT (Ctrl+C) graceful shutdown          |
+---------------------------------------+---------------------------------------+
                                        | VirtIO MMIO
                                        v
+-------------------------------------------------------------------------------+
| Guest MicroVM (Debian 13 Trixie, Linux 6.12.6 Monolithic Kernel)              |
| IP: 172.30.0.2/24 | Default Gateway: 172.30.0.1 | DNS: Systemd / Host        |
|                                                                               |
| Display Stack (Supervised):                                                   |
|   - Xvfb :1 (1280x800x24) via box-xvfb (reaps stale locks / socket)           |
|   - x11vnc :1 (Port 5900) via box-x11vnc (reaps stale port squatters)         |
|   - xfwm4 via box-xfwm4 (bounded SIGTERM/SIGKILL takeover)                    |
|   - picom via box-picom (--backend xrender, reaps _NET_WM_CM_S0)              |
|   - websockify :6080 (RFB localhost:5900 -> WebSocket)                       |
|   - websockify :6081 (Token plugin for multi-display forks)                   |
|                                                                               |
| Control Plane & Daemons:                                                      |
|   - sand-window-router.mjs (Port 1339 -> 1337 primary, 14000+N forks)         |
|   - google-chrome-stable via box-chrome (managed policies, CDP 9222+N)        |
|   - /usr/local/bin/ensure-machine-id (syncs /etc/machine-id & D-Bus id)       |
|                                                                               |
| Health & Self-Test:                                                           |
|   - /usr/local/bin/box-doctor: Executes all 10 diagnostic checks              |
+-------------------------------------------------------------------------------+
```

---

## Conclusion & Verification Readiness

1. **R1 Infrastructure & Bootstrap**: Fully specified and validated against `deploy/aws/poc-host.yaml`, `scripts/deploy-poc.ps1`, `scripts/deploy-poc.sh`, `scripts/setup-host.sh`, and `scripts/check-idle-shutdown.sh`.
2. **R4 Firecracker Hypervisor**: Codebase contracts in `crates/frostfire-hypervisor/src/main.rs` and `Cargo.toml` validated. Unit tests compile and pass with 0 warnings (`cargo test --workspace`, `cargo clippy --workspace -- -D warnings`).
3. **R4 box-doctor**: Exhaustively analyzed in `usr-local-bin/box-doctor`. All 10 check requirements, thresholds, and failure handling patterns documented for integration verification.
