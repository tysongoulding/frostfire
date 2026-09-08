# Comprehensive Specification Report: R2 (EFS Persistence & Worktree Sync) & R3 (Multi-Screen Display Multiplexer & Crash-Loop Defenses)

**Author:** `spec_miner_survey_2_2`  
**Target Project:** Frostfire Cloud (`frostfire-cloud`)  
**Reference Implementations:** GrokBot / Cursor Sand MicroVM (`syntropy/deploy/microvm/`), Syntropy Architecture (`syntropy/docs/GROKBOT_MICROVM_ARCHITECTURE.md`), and Frostfire Cloud (`deploy/aws/lambda-microvm.yaml`, `cloud/microvm/scripts/`, `crates/frostfire-exec/src/worktree.rs`)  
**Date:** 2026-09-08  

---

## 1. Executive Summary

This specification provides the authoritative implementation blueprints for two critical pillars of the Frostfire autonomous cloud agent infrastructure:
1. **R2: Ephemeral Lambda MicroVM State Persistence & Worktrees**:
   - Seamless integration of Amazon Elastic File System (EFS) into AWS Lambda containerized microVMs via CloudFormation (`deploy/aws/lambda-microvm.yaml`), mounting `/mnt/workspace` with zero-copy persistence across ephemeral container recycling.
   - Design and automated operation of `scripts/sync-workspace-state.sh` for shadow git worktree snapshotting, untracked artifact persistence, developer credential mirroring, and crash recovery.
2. **R3: Multi-Screen Display Multiplexer & Crash-Loop Defenses**:
   - Porting GrokBot's production crash-loop prevention daemons (`box-xvfb`, `box-xfwm4`, `box-picom`, `box-plank`, `box-x11vnc`, `box-bounded-log.mjs`, `box-bounded-log`, and `box-doctor`) into `cloud/microvm/bin/`.
   - Comprehensive resolution of stale X11 lock files (`/tmp/.X*-lock`), abstract socket leaks (`@/tmp/.X11-unix/X*`), dead RFB port squatters (`5900 + N`), compositor ownership conflicts (`_NET_WM_CM_S0`), and pipe buffer starvation via circular in-memory logging.

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | R2-EFS | `AWS::EFS::FileSystem` | Encrypted, elastic general-purpose EFS filesystem for persistent agent workspaces | `Encrypted: true`, `ThroughputMode: elastic`, `LifecyclePolicies` | EFS FileSystem ID, ARN | Throttles on burst credit exhaustion if not set to elastic | `syntropy/docs/GROKBOT_MICROVM_ARCHITECTURE.md` § 1, 8 |
| 2 | R2-EFS | `AWS::EFS::MountTarget` | Subnet-specific NFS mount targets (TCP 2049) across multiple availability zones | `FileSystemId`, `SubnetId`, `SecurityGroups` | Mount Target ID, IP address | Fails stack deployment if subnets in same AZ or CIDR overlaps | `deploy/aws/cloudformation.yaml`, AWS EFS Spec |
| 3 | R2-EFS | `AWS::EFS::AccessPoint` | Enforces application POSIX identity (UID/GID 10001) and restricts Lambda mount root to `/workspace` | `FileSystemId`, `PosixUser: {Uid: 10001, Gid: 10001}`, `RootDirectory: {Path: /workspace, CreationInfo}` | Access Point ARN | Prevents unauthorized root directory breakout; 403 on permission mismatch | `cloud/agent/Dockerfile.lambda`, AWS Lambda EFS Docs |
| 4 | R2-EFS | Lambda EFS Mounting (`FileSystemConfigs`) | Configures container microVM runtime to mount EFS Access Point at `/mnt/workspace` | `Arn: !GetAtt WorkspaceAccessPoint.Arn`, `LocalMountPath: /mnt/workspace` | POSIX volume at `/mnt/workspace` | Throws `ResourceConflict` if MountTargets not in Available state (`DependsOn` required) | `deploy/aws/lambda-microvm.yaml`, AWS Lambda Spec |
| 5 | R2-EFS | Dual-AZ VPC Integration (`VpcConfig`) | Attaches Lambda function to private subnets with security group allowing egress to EFS port 2049 | `SubnetIds`, `SecurityGroupIds` | ENI attachment per invocation | Cold-start penalty if ENI pre-provisioning fails; blocked egress without NAT/endpoints | `deploy/aws/cloudformation.yaml`, `lambda-microvm.yaml` |
| 6 | R2-EFS | IAM EFS Access Policies | Grants Lambda role permissions to mount and write via specific Access Point ARN | `elasticfilesystem:ClientMount`, `elasticfilesystem:ClientWrite`, `elasticfilesystem:ClientRootAccess` | IAM execution role policy | Access denied (NFS permission denied) if condition mismatch | `deploy/aws/lambda-microvm.yaml` § 2 |
| 7 | R2-Sync | Shadow Worktree Snapshot (`sync-workspace-state.sh snapshot`) | Captures staged, unstaged, and untracked changes into shadow commit/ref without dirtying working branch | CLI `--agent-id`, `--message`, workspace path | Updated shadow ref `refs/shadow-state/<agent>`, `manifest.json` | Returns code 1 if git repository corrupted; falls back to directory rsync | `crates/frostfire-exec/src/worktree.rs`, GrokBot finding 10 |
| 8 | R2-Sync | Shadow Worktree Restore (`sync-workspace-state.sh restore`) | Rehydrates working tree and untracked artifacts from EFS persistent shadow store | Snapshot ID, manifest, or latest pointer | Clean working tree matching last snapshot state | Returns code 2 on manifest checksum corruption; creates `.sync-conflict` | `crates/frostfire-exec/src/worktree.rs` |
| 9 | R2-Sync | Continuous Watcher (`sync-workspace-state.sh watch`) | Background daemon monitoring filesystem changes and auto-snapshotting every N seconds with debouncing | `--interval <secs>`, `SIGTERM`/`SIGINT` traps | Periodic snapshots, atomic `.snapshot.latest` update | Traps termination signals to flush dirty buffer before container dies | `syntropy/deploy/microvm/bin/persist-cli-auth` § save-loop |
| 10 | R2-Sync | Developer Credential Mirroring | Preserves developer CLI credentials (`.gitconfig`, `.ssh`, `.aws`, `.config/gh`) to `/mnt/workspace/.cli-config` | Local dotfiles in `$HOME`, 50MB cap | Atomic mirror with SHA-256 signatures, 0700/0600 POSIX permissions | Excludes cache/GPU dirs; skips oversized files > 50 MB | `syntropy/deploy/microvm/bin/persist-cli-auth` |
| 11 | R3-Crash | Xvfb Reaper & Launcher (`box-xvfb`) | Reaps stale Xvfb processes squatting on abstract socket `@/tmp/.X11-unix/X<N>`, deletes lock, paints background, execs Xvfb | Display arg (`:1`, `:2`), CLI flags | Live Xvfb process, active X socket | Graceful kill (5s) -> SIGKILL -> `rm -f /tmp/.X<N>-lock`; logs errors | `syntropy/deploy/microvm/bin/box-xvfb` |
| 12 | R3-Crash | XFWM4 Anti-Race Launcher (`box-xfwm4`) | Reaps untracked xfwm4 owning target DISPLAY with starttime and exe inode validation, execs replacement | `DISPLAY` environment variable | Supervised xfwm4 process | Retries mid-exec environ reads (3x); 1s SIGTERM -> 4s SIGKILL escalation | `syntropy/deploy/microvm/bin/box-xfwm4` |
| 13 | R3-Crash | Picom Compositor Reaper (`box-picom`) | Evicts stale compositors holding `_NET_WM_CM_S0` selection on DISPLAY before starting picom | `DISPLAY` environment variable | Supervised picom process | Eliminates SAND-161 "Another composite manager is already running" exit 1 crashloop | `syntropy/deploy/microvm/bin/box-picom` |
| 14 | R3-Crash | Plank Compositor Sync (`box-plank`) | Probes `libX11.so.6` via Python ctypes for `_NET_WM_CM_S0` selection owner before launching Plank dock | `DISPLAY` environment variable | Transparent composited dock | Timeout after 5.0s if compositor fails; launches anyway to preserve desktop usability | `syntropy/deploy/microvm/bin/box-plank` |
| 15 | R3-Crash | x11vnc Port Cleanser (`box-x11vnc`) | Scans TCP listeners on `-rfbport` via `ss`/`fuser`, verifies `x11vnc` cmdline, kills squatters, execs with `-skip_lockkeys` | CLI args with `-rfbport <port>` | Cleanly bound RFB server | Escalates SIGTERM -> SIGKILL over 5s; suppresses lock key bugs | `syntropy/deploy/microvm/bin/box-x11vnc` |
| 16 | R3-Crash | Bounded Log Streamer (`box-bounded-log.mjs`) | Maintains 1 MB in-memory circular buffer ring, periodically flushes to disk, safe `.1` rotation | `logPath`, `ownerPid`, `stdin` stream | Rotated bounded log files (max 2 MB total) | Silently drops chunks if write fails; discards oversized pre-existing files | `syntropy/deploy/microvm/bin/box-bounded-log.mjs` |
| 17 | R3-Crash | Bounded Log Wrapper (`box-bounded-log`) | Process-substitution wrapper executing command while streaming stdout/stderr through `flock` bounded log | `--run <log_file> -- <command...>` | Managed command running under original PID | Falls back to `cat >/dev/null` on flock contention to prevent SIGPIPE/deadlock | `syntropy/deploy/microvm/bin/box-bounded-log` |
| 18 | R3-Crash | Diagnostic Suite (`box-doctor`) | 10-point container health validation verifying machine-id, Chrome FDs, egress, clock skew, X11, VNC, and compositor | CLI environment | Structured pass/fail log and integer exit code | Exits non-zero on any check failure; outputs exact failure reasons | `syntropy/deploy/microvm/bin/box-doctor` |
| 19 | R3-Mux | Headless Multi-Screen Supervisor (`start-desktop.sh`) | Orchestrates per-display stacks (:1, :2, :3) using `box-*` launchers and bounded logs under `sand-exit-watch` subreaper | Display indices, token maps | Active desktop sessions on RFB 5901-5903, noVNC 6081 | Subreaper reaps zombie children and restarts failed desktop components | `cloud/microvm/scripts/start-desktop.sh`, GrokBot § 2 |
| 20 | R3-Mux | In-VM Subreaper Supervisor (`sand-exit-watch`) | Linux `prctl(PR_SET_CHILD_SUBREAPER, 1)` process supervisor handling crash loops with exponential backoff | `-- <command...>` | Monitored child process tree | Backs off restarts up to 30s; resets restart counter after 60s of stable runtime | `cloud/microvm/scripts/sand-exit-watch` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | `box-xvfb` | Dead Xvfb leaves `/tmp/.X11-unix/X1` file deleted, but abstract socket `@/tmp/.X11-unix/X1` still bound by zombie/orphan | Traditional `rm -f /tmp/.X1-lock` fails to free display; `box-xvfb` queries `ss -lpxH "src = @/tmp/.X11-unix/X1"`, retrieves PID, verifies cmdline contains `Xvfb`, and terminates the orphan. |
| 2 | `box-xvfb` | PID recycling occurs where an unrelated process inherits the PID of a previously killed Xvfb | `xvfb_for_display()` reads `/proc/${pid}/cmdline`, verifies executable name is `Xvfb` and argument matches `^:${n}([.][0-9]+)?$`. Non-matching processes are ignored. |
| 3 | `box-xfwm4` | Process is between `fork()` and `execve()`; `/proc/${pid}/environ` read is momentarily empty | `process_display_matches()` retries the read 3 times with 10ms delays. A non-empty environ naming another display is treated as definitive non-match. |
| 4 | `box-xfwm4` | PID is recycled during the 1-second SIGTERM grace period | `xfwm4_matches()` reads `/proc/${pid}/stat` field 22 (`starttime`) and `/proc/${pid}/exe` inode before sending SIGKILL. If starttime changed, SIGKILL is aborted. |
| 5 | `box-picom` | Supervisor restarts picom rapidly after crash; previous picom still holds `_NET_WM_CM_S0` | New picom launcher queries `pgrep -x picom` and matches `DISPLAY`, sends SIGTERM, polls for up to 5s, sends SIGKILL, then execs picom without error exit code 1. |
| 6 | `box-plank` | Plank starts before picom establishes the X11 compositing manager selection | Plank checks `_NET_WM_CM_S0` exactly once at startup. If absent, it permanently paints an opaque black slab. `box-plank` uses Python ctypes `libX11.so.6` to wait up to 5.0s for the selection owner. |
| 7 | `box-x11vnc` | Xvfb crashes but `-forever` `x11vnc` stays alive holding RFB port 5901 | New x11vnc fails with "Error: could not obtain listening port". `box-x11vnc` inspects `ss -lptnH "sport = :5901"`, matches cmdline, sends SIGTERM/SIGKILL, and binds cleanly. |
| 8 | `box-bounded-log` | Log file lock contention (another process holds `${log_file}.lock`) | `drain_bounded()` detects flock failure and immediately routes input to `cat >/dev/null 2>&1`, preventing pipe buffer fill (64 KB Linux pipe limit) from deadlocking the application. |
| 9 | `box-bounded-log.mjs` | Log file on disk already exceeds `maxBytes` (e.g., from prior unmanaged run) | `removeUnsafeOrOversized()` runs during `prepareLogs()`. If `info.size > maxBytes`, file is unlinked before the ring buffer attaches. |
| 10 | `lambda-microvm.yaml` | CloudFormation provisions Lambda before EFS MountTargets reach `Available` status | Lambda deployment fails with `ResourceConflictException`. Fixed by explicit `DependsOn: [EfsMountTarget1, EfsMountTarget2]` in `AgentMicroVmFunction`. |
| 11 | `sync-workspace-state.sh` | Lambda container receives `SIGTERM` from AWS runtime when execution nears 900s timeout | Trap intercepts `SIGTERM`, triggers immediate `snapshot_fast()`, writes `manifest.json`, updates `.snapshot.latest`, and exits cleanly before container SIGKILL. |
| 12 | `sync-workspace-state.sh` | Workspace contains uncommitted staged changes, unstaged edits, and untracked files | `git write-tree` captures staged index; `git commit-tree` creates a commit on shadow ref; untracked files are archived into `.untracked.tar.gz` on EFS. Working directory is completely untouched. |
| 13 | `sync-workspace-state.sh` | Non-git workspace (user created arbitrary directory structure) | Detects absence of `.git`; falls back to atomic directory snapshot via `tar --exclude-vcs` or `rsync` into `/mnt/workspace/snapshots/<agent-id>/`. |
| 14 | `sync-workspace-state.sh` | Multiple Lambda containers or concurrent sub-processes attempt simultaneous sync | Uses `flock -n /mnt/workspace/.sync.lock` with exponential backoff (up to 5s) to guarantee serialized atomic metadata updates. |
| 15 | `box-doctor` | Host clock is skewed by > 60 seconds relative to Google HTTP Date header | Emits `[box-doctor] FAIL clock: system clock skewed +120s vs https://www.google.com — wake/tool timestamps will be wrong`, preventing subtle TLS handshake and token expiration bugs. |

---

## 3. Specification R2: Amazon EFS Lambda Persistence Architecture

### 3.1 CloudFormation Infrastructure Blueprint (`deploy/aws/lambda-microvm.yaml`)

To provide zero-copy, persistent storage across ephemeral microVM invocations, the Lambda microVM template must be enhanced with dedicated VPC resources, an Amazon EFS filesystem, multi-AZ mount targets, an EFS Access Point, and Lambda filesystem configurations.

```yaml
# ==============================================================================
# Amazon EFS & VPC Persistence Subsystem for AWS Lambda MicroVM
# ==============================================================================

Parameters:
  VpcCIDR:
    Type: String
    Default: 10.50.0.0/16
    Description: CIDR block for the Lambda & EFS VPC

  PrivateSubnet1CIDR:
    Type: String
    Default: 10.50.1.0/24
    Description: CIDR block for Private Subnet 1 (AZ 1)

  PrivateSubnet2CIDR:
    Type: String
    Default: 10.50.2.0/24
    Description: CIDR block for Private Subnet 2 (AZ 2)

Resources:
  # ----------------------------------------------------------------------------
  # 1. VPC & Networking for Lambda + EFS
  # ----------------------------------------------------------------------------
  LambdaVpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: !Ref VpcCIDR
      EnableDnsSupport: true
      EnableDnsHostnames: true
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-vpc'

  PrivateSubnet1:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref LambdaVpc
      CidrBlock: !Ref PrivateSubnet1CIDR
      AvailabilityZone: !Select [0, !GetAZs '']
      MapPublicIpOnLaunch: false
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-private-1'

  PrivateSubnet2:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref LambdaVpc
      CidrBlock: !Ref PrivateSubnet2CIDR
      AvailabilityZone: !Select [1, !GetAZs '']
      MapPublicIpOnLaunch: false
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-private-2'

  # ----------------------------------------------------------------------------
  # 2. Security Groups
  # ----------------------------------------------------------------------------
  LambdaSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for Frostfire Lambda MicroVM
      VpcId: !Ref LambdaVpc
      SecurityGroupEgress:
        - IpProtocol: tcp
          FromPort: 2049
          ToPort: 2049
          DestinationSecurityGroupId: !Ref EfsSecurityGroup
        - IpProtocol: tcp
          FromPort: 443
          ToPort: 443
          CidrIp: 0.0.0.0/0
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-lambda-sg'

  EfsSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for EFS Mount Targets
      VpcId: !Ref LambdaVpc
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 2049
          ToPort: 2049
          SourceSecurityGroupId: !Ref LambdaSecurityGroup
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-efs-sg'

  # ----------------------------------------------------------------------------
  # 3. Amazon EFS File System & Mount Targets
  # ----------------------------------------------------------------------------
  WorkspaceFileSystem:
    Type: AWS::EFS::FileSystem
    Properties:
      Encrypted: true
      PerformanceMode: generalPurpose
      ThroughputMode: elastic
      LifecyclePolicies:
        - TransitionToIA: AFTER_30_DAYS
      FileSystemTags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-workspace-efs'

  EfsMountTarget1:
    Type: AWS::EFS::MountTarget
    Properties:
      FileSystemId: !Ref WorkspaceFileSystem
      SubnetId: !Ref PrivateSubnet1
      SecurityGroups:
        - !Ref EfsSecurityGroup

  EfsMountTarget2:
    Type: AWS::EFS::MountTarget
    Properties:
      FileSystemId: !Ref WorkspaceFileSystem
      SubnetId: !Ref PrivateSubnet2
      SecurityGroups:
        - !Ref EfsSecurityGroup

  # ----------------------------------------------------------------------------
  # 4. EFS Access Point (POSIX UID/GID 10001 Enforcement)
  # ----------------------------------------------------------------------------
  WorkspaceAccessPoint:
    Type: AWS::EFS::AccessPoint
    Properties:
      FileSystemId: !Ref WorkspaceFileSystem
      PosixUser:
        Uid: "10001"
        Gid: "10001"
      RootDirectory:
        Path: "/workspace"
        CreationInfo:
          OwnerUid: "10001"
          OwnerGid: "10001"
          Permissions: "0755"
      AccessPointTags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-workspace-ap'

  # ----------------------------------------------------------------------------
  # 5. IAM Policy Enhancements
  # ----------------------------------------------------------------------------
  # In LambdaExecutionRole:
  # ManagedPolicyArns:
  #   - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  #   - arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
  # Policies:
  #   - PolicyName: EfsClientAccessPolicy
  #     PolicyDocument:
  #       Version: '2012-10-17'
  #       Statement:
  #         - Effect: Allow
  #           Action:
  #             - elasticfilesystem:ClientMount
  #             - elasticfilesystem:ClientWrite
  #             - elasticfilesystem:ClientRootAccess
  #           Resource: !GetAtt WorkspaceFileSystem.Arn
  #           Condition:
  #             StringEquals:
  #               elasticfilesystem:AccessPointArn: !GetAtt WorkspaceAccessPoint.Arn
```

### 3.2 Lambda Function Configuration Updates
Under `AgentMicroVmFunction`:
1. Add `DependsOn`:
   ```yaml
   DependsOn:
     - LogGroup
     - LambdaExecutionRole
     - EfsMountTarget1
     - EfsMountTarget2
   ```
2. Add `VpcConfig`:
   ```yaml
   VpcConfig:
     SubnetIds:
       - !Ref PrivateSubnet1
       - !Ref PrivateSubnet2
     SecurityGroupIds:
       - !Ref LambdaSecurityGroup
   ```
3. Add `FileSystemConfigs`:
   ```yaml
   FileSystemConfigs:
     - Arn: !GetAtt WorkspaceAccessPoint.Arn
       LocalMountPath: /mnt/workspace
   ```
4. Add Environment Variables:
   ```yaml
   WORKSPACE_DIR: /mnt/workspace
   FROSTFIRE_PERSIST_ROOT: /mnt/workspace
   ```

---

## 4. Specification R2: Automated Shadow Worktree Snapshotting & Restore Script (`scripts/sync-workspace-state.sh`)

### 4.1 Script Architecture & CLI Interface
The script `scripts/sync-workspace-state.sh` executes inside the container microVM or during host sync tasks:
* **Primary Subcommands**:
  - `init`: Prepares `/mnt/workspace` directories, links agent-store backing, and validates write readiness.
  - `snapshot`: Atomic capture of working tree state (staged, unstaged, untracked).
  - `restore`: Hydrates working tree from latest or specified snapshot.
  - `watch`: Background daemon taking debounced snapshots every `SYNC_INTERVAL_SECS` (default: 15s).
  - `status`: Emits JSON status report of dirty state, snapshot history, and EFS storage utilization.
  - `prune`: Prunes snapshots older than N days.

### 4.2 Git Plumbing Strategy for Zero Disruption
To avoid modifying the agent's checked-out branch pointer or disrupting in-flight terminal commands:
1. **Staged Changes**:
   ```bash
   TREE_SHA=$(git write-tree)
   ```
2. **Commit Object Creation**:
   ```bash
   PARENT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
   COMMIT_MSG="frostfire-shadow: auto-snapshot $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
   if [ -n "$PARENT_COMMIT" ]; then
     SHADOW_COMMIT=$(git commit-tree "$TREE_SHA" -p "$PARENT_COMMIT" -m "$COMMIT_MSG")
   else
     SHADOW_COMMIT=$(git commit-tree "$TREE_SHA" -m "$COMMIT_MSG")
   fi
   git update-ref "refs/frostfire/shadow/${AGENT_ID}" "$SHADOW_COMMIT"
   ```
3. **Untracked Files Capture**:
   Untracked files are archived to an atomic tarball on EFS:
   ```bash
   git ls-files --others --exclude-standard -z | \
     tar -czf "${EFS_DIR}/untracked_${SHADOW_COMMIT}.tar.gz" --null -T -
   ```
4. **Metadata Manifest (`manifest.json`)**:
   Written atomically via temporary file and `mv`:
   ```json
   {
     "agent_id": "lambda-user",
     "timestamp_utc": "2026-09-08T22:45:00Z",
     "head_commit": "3a8f9b2c...",
     "branch": "feature/agent-swarm",
     "shadow_commit": "7b1c4e0d...",
     "dirty": true,
     "untracked_count": 4,
     "sha256_manifest": "d41d8cd98f00b204e9800998ecf8427e..."
   }
   ```
5. **Credential Persistence Integration**:
   Executes `persist-cli-auth save` to sync GitHub, AWS, SSH, and npm credentials to `/mnt/workspace/.cli-config`.

---

## 5. Specification R3: Multi-Screen Display Multiplexer & Crash-Loop Defenses

### 5.1 Porting Table (`syntropy/deploy/microvm/bin/` ➔ `cloud/microvm/bin/`)

| Source Binary in Syntropy | Target Path in Frostfire | Language | Core Crash-Loop Defense Logic |
|---|---|---|---|
| `box-xvfb` | `cloud/microvm/bin/box-xvfb` | Bash | Detects abstract/filesystem socket squatters (`@/tmp/.X11-unix/X<N>`) via `ss -lpxH` and `fuser`; kills orphaned Xvfb instances; cleans `/tmp/.X<N>-lock`; executes background wallpaper painter; execs `Xvfb`. |
| `box-xfwm4` | `cloud/microvm/bin/box-xfwm4` | Bash | Inspects `/proc/${pid}/environ` for exact `DISPLAY`; verifies process starttime (`/proc/${pid}/stat` item 20) and inode (`stat -Lc '%d-%i'`) to prevent PID recycling races; 1s SIGTERM -> 4s SIGKILL escalation; execs `xfwm4`. |
| `box-picom` | `cloud/microvm/bin/box-picom` | Bash | Identifies stale picom holding `_NET_WM_CM_S0` selection on DISPLAY; sends SIGTERM/SIGKILL over 5s timeout; turns SAND-161 exit 1 crashloop into clean takeover; execs `picom`. |
| `box-plank` | `cloud/microvm/bin/box-plank` | Bash + Python3 | Opens `libX11.so.6` via Python ctypes; polls `XGetSelectionOwner(dpy, "_NET_WM_CM_S0")` up to 5.0s; prevents Plank from rendering an opaque slab when compositor initializes late; execs `plank`. |
| `box-x11vnc` | `cloud/microvm/bin/box-x11vnc` | Bash | Parses `-rfbport`; queries listening TCP sockets via `ss -lptnH` and `fuser`; kills squatter x11vnc processes; injects `-skip_lockkeys`; execs `x11vnc`. |
| `box-bounded-log.mjs` | `cloud/microvm/bin/box-bounded-log.mjs` | Node.js | In-memory 1 MB circular Buffer ring (`capacity = maxBytes * 2`); asynchronous periodic flush every 250ms; writes `.1` rotated files with mode `0600`; unlinks oversized files; acquires `${logPath}.lock`. |
| `box-bounded-log` | `cloud/microvm/bin/box-bounded-log` | Bash | Process substitution launcher `exec "$@" > >(drain_bounded) 2>&1`; acquires `flock -n "${log_file}.lock"`; falls back to `cat >/dev/null` on contention to guarantee constant drain without SIGPIPE. |
| `box-doctor` | `cloud/microvm/bin/box-doctor` | Bash | 10-point container health suite: `machine-id`, `chrome`, `chrome-fds`, `egress`, `clock`, `dbus`, `xvfb`, `x11vnc`, `novnc`, `compositor`. |

### 5.2 Refactored Headless Multi-Screen Supervisor (`cloud/microvm/scripts/start-desktop.sh`)
The current `start-desktop.sh` uses raw `pkill -f Xvfb` and unmanaged `openbox`. The refactored version must:
1. Initialize subreaper supervision via `sand-exit-watch`.
2. Configure cgroup v2 interactive slice (`box-cgroups.sh`).
3. Clean stale locks `/tmp/.X*-lock` and `/tmp/.X11-unix/*`.
4. Launch websockify token multiplexer on port 6081 with bounded logging.
5. In `spawn_agent_display`:
   - Launch Xvfb using `/usr/local/bin/box-bounded-log --run "${LOG_DIR}/xvfb_${D}.log" -- /usr/local/bin/box-xvfb ":${D}" -screen 0 1280x800x24 -ac +extension GLX +render -noreset &`
   - Wait for `/tmp/.X11-unix/X${D}` socket (up to 3s).
   - Launch window manager: `DISPLAY=":${D}" /usr/local/bin/box-bounded-log --run "${LOG_DIR}/xfwm4_${D}.log" -- /usr/local/bin/box-xfwm4 --compositor=off &`
   - Launch compositor: `DISPLAY=":${D}" /usr/local/bin/box-bounded-log --run "${LOG_DIR}/picom_${D}.log" -- /usr/local/bin/box-picom --backend xrender --no-vsync &`
   - Launch dock: `DISPLAY=":${D}" /usr/local/bin/box-bounded-log --run "${LOG_DIR}/plank_${D}.log" -- /usr/local/bin/box-plank --name "dock${D}" &`
   - Launch x11vnc: `/usr/local/bin/box-bounded-log --run "${LOG_DIR}/x11vnc_${D}.log" -- /usr/local/bin/box-x11vnc -display ":${D}" -localhost -nopw -shared -forever -noxdamage -rfbport "${RFB}" -quiet &`
   - Register websockify token in `/tmp/sand-novnc-tokens.d/${TOKEN}.token`.
6. Start `sand-window-router.mjs` on port 1339 and `sand-session-sync.mjs`.
7. Wait on processes with signal trapping.

### 5.3 RootFS Build Specification Updates (`cloud/microvm/Dockerfile.rootfs`)
To support the crash-defense toolchain, `cloud/microvm/Dockerfile.rootfs` must be updated:
1. **Package Additions** to `apt-get install`:
   - `picom`: Compositor required by `box-picom`.
   - `plank`: Dock required by `box-plank`.
   - `psmisc`: Provides `fuser`, required by `box-xvfb` and `box-x11vnc`.
   - `hsetroot`: Wallpaper setter used in `box-xvfb` `paint_root_when_ready`.
   - `libx11-6`: Dynamic library loaded via ctypes in `box-plank`.
2. **Binary Installation**:
   - `COPY bin/ /usr/local/bin/`
   - `RUN chmod +x /usr/local/bin/box-*`

---

## 6. Verification and Validation Plan

### 6.1 CloudFormation Template Validation
```bash
aws cloudformation validate-template \
  --template-body file://deploy/aws/lambda-microvm.yaml \
  --region us-east-1
```
*Criteria*: Must return valid template description with 0 errors.

### 6.2 Worktree State Sync Validation
1. Initialize test git repo in `/workspace`.
2. Create staged changes, unstaged changes, and untracked files.
3. Run `scripts/sync-workspace-state.sh snapshot`.
4. Verify `refs/frostfire/shadow/test-agent` ref is created and untracked tarball exists on `/mnt/workspace`.
5. Run `git reset --hard HEAD~1` and `git clean -fd`.
6. Run `scripts/sync-workspace-state.sh restore`.
7. Verify all staged, unstaged, and untracked files are restored byte-for-byte.

### 6.3 Display Crash-Loop & Orphan Reaping Validation
1. Start Xvfb on `:2` in background and simulate orphan process squatting on `/tmp/.X11-unix/X2`.
2. Run `box-xvfb :2`. Verify orphan PID is reaped, stale lock is deleted, and new Xvfb starts without exit 1.
3. Start rogue picom instance on `:1`. Run `box-picom`. Verify rogue picom is reaped and replacement starts.
4. Run `box-doctor`. Verify 10-point health suite exits with code 0:
   `[box-doctor] SUMMARY: 10 checks, 0 failed`.
