# Dispatch: Survey Spec Miner 1 (MicroVM Architecture & Sand Reverse Engineering)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`.
Your role is to act as a Specification Miner (`teamwork_preview_spec_miner`).
Investigate the authoritative specifications for the GrokBot / Cursor Sand microVM architecture:
- Primary reference: `c:\Users\tyson\.repo\personal\frostfire-cloud\docs\MICROVM_ARCHITECTURE.md` (and any other files in `docs/`).
- Examine how GrokBot / Cursor Sand microVM infrastructure works:
  1. OverlayFS root filesystem with Copy-on-Write microVM branching.
  2. Cgroups v2 scheduling domains partitioning high-priority display/window manager processes (`interactive`) from agent compilation/execution workloads (`agent`).
  3. Multi-display X11/VNC routing (`sand-window-router.mjs`) on port 1339, websockify token routing, and noVNC stream delivery.
  4. Multi-monitor Chrome shared session linking (`link-chrome-session.sh`) for isolated per-display browser sessions.
  5. In-VM agent daemon supervision and crash-loop monitoring (`sand-exit-watch`).
  6. Network isolation requirements (172.16.x.0/24 bridge, tap devices).

Deliver a comprehensive specification report in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\report.md` and a self-contained `handoff.md` listing all extracted requirements, components, parameters, invariants, error handling, and dependencies.

## 2026-09-08T20:30:13Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1.
Investigate the authoritative specifications for the GrokBot / Cursor Sand microVM architecture:
- Primary reference: c:\Users\tyson\.repo\personal\frostfire-cloud\docs\MICROVM_ARCHITECTURE.md (and any other files in docs/).
- Deeply inspect:
  1. OverlayFS root filesystem with Copy-on-Write microVM branching.
  2. Cgroups v2 scheduling domains partitioning high-priority display/window manager processes (interactive) from agent compilation/execution workloads (agent).
  3. Multi-display X11/VNC routing (sand-window-router.mjs) on port 1339, websockify token routing, and noVNC stream delivery.
  4. Multi-monitor Chrome shared session linking (link-chrome-session.sh) for isolated per-display browser sessions.
  5. In-VM agent daemon supervision and crash-loop monitoring (sand-exit-watch).
  6. Network isolation requirements (172.16.x.0/24 bridge, tap devices).
Write your full analysis to c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\report.md and complete a structured handoff at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\handoff.md.
Notify parent with send_message when done.

