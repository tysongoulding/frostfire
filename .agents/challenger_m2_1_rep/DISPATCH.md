# Dispatch: Replacement Challenger M2-1 (Display & Chrome Challenge)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`, `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`, and `c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md`.
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2_1\handoff.md`.
Your role is `teamwork_preview_challenger`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_1_rep`.

Empirically challenge Milestone 2 display multiplexing and Chrome session linking:
1. Run and verify `node .agents/explorer_m2_3/test_upgrade.mjs` and test that Display 1 rejects unauthorized requests with HTTP 403.
2. Test `sand-window-router.mjs` WebSocket upgrade proxying under concurrent load.
3. Test `link-chrome-session.sh` against edge cases (circular destination, stale lock files, missing source).
4. Run `cargo test -p frostfire-e2e -- test_f8` and `cargo test -p frostfire-e2e -- test_f9`.
5. Deliver your verdict (`APPROVE` or `FAIL`) in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_1_rep\handoff.md` and notify parent.

## 2026-09-08T21:40:12Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_1_rep\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_1_rep.
Empirically challenge display routing (sand-window-router.mjs) and Chrome session linking. Deliver your verdict (APPROVE or FAIL) in handoff.md and notify parent.

