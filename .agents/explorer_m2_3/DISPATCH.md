# Dispatch: Explorer M2-3 (Display Routing, Chrome Linking & Live CDP Cookie Sync)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`, `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`, and `docs/MICROVM_ARCHITECTURE.md`.
Read `spec_miner_survey_1` handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\handoff.md`.
Your role is `teamwork_preview_explorer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_3`.

Your scope is Milestone 2: MicroVM Virtualization Infrastructure (Display & Browser Multiplexing):
1. Investigate hardening `cloud/microvm/scripts/sand-window-router.mjs`:
   - Eliminate the unauthenticated bypass on display 1: ALL displays (including display 1) MUST validate `x-sand-window-owner` using constant-time `crypto.timingSafeEqual` (`tokensMatch`).
   - Add WebSocket upgrade handler (`server.on('upgrade', ...)`) so PTY WebSockets and VNC WebSockets are correctly forwarded to the backend without dropping connections.
2. Investigate `cloud/microvm/scripts/link-chrome-session.sh`:
   - Review multi-monitor Chrome shared session linking via selective SQLite symlinks (`Cookies`, `Login Data`, `Login Data For Account`).
   - Ensure handling of profile directory creation, permissions, and rollback-journal concurrency.
3. Investigate `cloud/microvm/scripts/cdp-cookies.mjs`:
   - Replace empty stub with functional CDP cookie synchronization daemon polling primary port 9223 and syncing session cookies via `Network.getCookies` / `Network.setCookies` to secondary CDP ports (9224, 9225).
4. Formulate exact implementation steps and test verifications.
Deliver your report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_3\report.md` and `handoff.md`.

## 2026-09-08T21:06:35Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, docs/MICROVM_ARCHITECTURE.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_3\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_3.
Investigate sand-window-router.mjs (token auth on all displays + WebSocket upgrade), link-chrome-session.sh, and live CDP cookie sync in cdp-cookies.mjs. Deliver report.md and handoff.md, then notify parent.

