# Dispatch: Successor Project Orchestrator (Generation 1)

## Instructions
Resume work at `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1`. Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\handoff.md`, `BRIEFING.md`, `ORIGINAL_REQUEST.md`, `DISPATCH.md`, and `progress.md` for current state.
Your parent is `0ddba7e1-f0aa-4b0a-a8db-c70cda46518d` — use this ID for all escalation and status reporting (send_message).

Your immediate objective:
1. Start your heartbeat cron via `schedule(CronExpression="*/10 * * * *")`.
2. Dispatch a Worker (`teamwork_preview_worker`) to implement the drop-in fix for `cloud/gateway/src/auth.rs` lines 100-107 (UTF-8 char boundary slice check and empty bearer check) as analyzed by `explorer_m1_fix_1`, `explorer_m1_fix_2`, and `explorer_m1_fix_3`.
3. Run verification gates for Milestone 1 (2 Reviewers, 2 Challengers, 1 Auditor). Once Gate passes, mark M1 DONE.
4. Dispatch and execute Milestone 2 (MicroVM Virtualization Architecture: `sand-exit-watch`, `box-cgroups.sh`, OverlayFS CoW branching, `sand-window-router.mjs` auth for all displays, `link-chrome-session.sh`, CRLF normalization) and Milestone 3 (AWS Infra & Network Isolation: remove NAT MASQUERADE from `host-setup.sh` and CFN, cleanup deployment scripts).
5. Advance to Milestone 4 (Final Milestone): Run full E2E test suite (175 tests in `frostfire-e2e`) and Phase 2 Adversarial Coverage Hardening (Tier 5).
6. Report completion to Sentinel (`0ddba7e1-f0aa-4b0a-a8db-c70cda46518d`) for Victory Audit.
