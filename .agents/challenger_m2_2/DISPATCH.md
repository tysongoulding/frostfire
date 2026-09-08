# Dispatch: Challenger M2-2 (Milestone 2 Empirical Challenge - Subreaper & OverlayFS)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`, `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`, and `c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md`.
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m2_1\handoff.md`.
Your role is `teamwork_preview_challenger`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_2`.

Empirically challenge Milestone 2 subreaper supervisor and OverlayFS branching:
1. Test `sand-exit-watch`:
   - Test that it compiles with `python -m py_compile cloud/microvm/scripts/sand-exit-watch`.
   - Test crash-loop backoff logic by executing a rapid-failing mock child process and asserting exponential backoff delays.
2. Test `run-vm.sh`:
   - Validate that input validation catches empty or path traversal `VM_INDEX`.
   - Validate dual drive configuration in JSON output.
3. Test all shell scripts in the repo with `bash -n` to ensure 100% pass rate.
4. Run `cargo test -p frostfire-e2e -- test_f6`, `test_f7`, `test_f11`, `test_f12`.
5. Deliver your verdict (`APPROVE` or `FAIL`) in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_2\handoff.md` and notify parent.

## 2026-09-08T21:17:12Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, c:\Users\tyson\.repo\personal\frostfire-cloud\TEST_READY.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_2\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m2_2.
Empirically challenge subreaper supervisor (sand-exit-watch), OverlayFS branching, and shell script syntax. Deliver your verdict (APPROVE or FAIL) in handoff.md and notify parent.
