# Dispatch: Explorer M2-1 (MicroVM Supervision & Cgroups v2 Architecture)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`, `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`, and `docs/MICROVM_ARCHITECTURE.md`.
Read `spec_miner_survey_1` handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\handoff.md`.
Your role is `teamwork_preview_explorer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_1`.

Your scope is Milestone 2: MicroVM Virtualization Infrastructure (Supervision & Cgroups v2):
1. Investigate the design and implementation for `cloud/microvm/scripts/sand-exit-watch`:
   - Subreaper supervision (`PR_SET_CHILD_SUBREAPER` in Python or C).
   - Reaping orphaned zombie processes (`waitpid(-1, ...)`).
   - Signal logging and forwarding (`SIGTERM`, `SIGINT`, `SIGHUP`).
   - Crash-loop monitoring and exponential backoff restart for `frostfire-daemon`.
2. Investigate `cloud/microvm/scripts/box-cgroups.sh`:
   - Cgroups v2 hierarchy setup under `/sys/fs/cgroup/`.
   - Creating `/sys/fs/cgroup/interactive` with `cpu.weight = 800` (X11, window manager, picom, x11vnc, websockify, window router).
   - Creating `/sys/fs/cgroup/agent` with `cpu.weight = 100` (frostfire-daemon, compilers, execution workloads).
   - Verification of `cgroup.controllers`, memory limits, swap disabled.
3. Formulate exact implementation specifications and test verifications.


## 2026-09-08T21:06:35Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, docs/MICROVM_ARCHITECTURE.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_1\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_1.
Investigate sand-exit-watch subreaper supervisor and box-cgroups.sh cgroups v2 partitioning. Deliver report.md and handoff.md, then notify parent.
