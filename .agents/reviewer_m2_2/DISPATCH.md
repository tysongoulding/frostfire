# Dispatch: Reviewer M2-2 (Milestone 2 Adversarial Review)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`, `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`, `docs/MICROVM_ARCHITECTURE.md`, and `c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md`.
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2_1\handoff.md`.
Your role is `teamwork_preview_reviewer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m2_2`.

Independently review Milestone 2:
1. Examine security and isolation invariants:
   - Does `sand-window-router.mjs` strictly require `x-sand-window-owner` with constant-time check on Display 1?
   - Does `run-vm.sh` protect the golden base with `is_read_only: true`?
   - Does `sand-exit-watch` prevent PID leaks and infinite restart loops?
2. Run verification commands:
   - `cargo test -p frostfire-e2e`
   - `cargo test --workspace`
   - `cargo clippy --workspace -- -D warnings`
Deliver your verdict (`APPROVE` or `REQUEST_CHANGES`) in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m2_2\handoff.md` and notify parent.

## 2026-09-08T21:17:12Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m2_2\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\reviewer_m2_2.
Independently review Milestone 2 architecture and security invariants. Deliver your verdict (APPROVE or REQUEST_CHANGES) in handoff.md and notify parent.
