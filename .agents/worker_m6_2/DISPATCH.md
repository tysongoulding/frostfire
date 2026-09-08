# Dispatch: Worker M6.2 — Workspace State Sync Remediation Implementation

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_2`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Read Challenger M6.1 Failure Report: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m6_1\handoff.md`
- Read Fix Explorer Reports:
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_1\report.md` (and `handoff.md`)
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_2\report.md` (and `handoff.md`)
  - `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_3\report.md` (and `handoff.md`)

## Exclusive Write Ownership
You exclusively own and may modify:
- `scripts/sync-workspace-state.sh`
- `tests/adversarial/test_sync_workspace_adversarial.sh`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Objective & Implementation Requirements
Implement the unified fixes in `scripts/sync-workspace-state.sh` addressing all 5 defects:
1. **Defect 1 (Worktree index crash)**: In `do_snapshot`, resolve index path using `git -C "$ws_dir" rev-parse --git-path index` instead of hardcoding `.git/index`.
2. **Defect 2 (Dangling staged tree SHA)**: In `do_snapshot`, commit the staged tree as a parent commit (`staged_commit=$(git -C "$ws_dir" commit-tree "$staged_tree" -p "$head_commit" -m "frostfire: staged shadow snapshot")`), and commit working tree with both parents (`-p "$head_commit" -p "$staged_commit"`), anchoring the staged tree into the reachable commit DAG.
3. **Defect 3 & 4 (Deleted & Renamed file pruning)**: In `do_restore`, before checkout, prune tracked files deleted or renamed relative to `head_commit` and `staged_tree` using `git diff-tree -r --name-only -z --diff-filter=D` and unlinking them.
4. **Defect 5 (Validation order)**: In `do_restore`, implement the Two-Phase Transaction. Phase 1 performs all read-only verifications (Git object reachability with `git cat-file -e`, untracked archive SHA-256 verification, and gzip stream check with `tar -tzf`) BEFORE any file or index mutations in Phase 2.
5. Verification:
   - Run `bash -n scripts/sync-workspace-state.sh`
   - Run `bash tests/adversarial/test_sync_workspace_adversarial.sh` (MUST pass 17/17 tests with 0 defects)
   - Run `bash scripts/test-container-recycling.sh` (MUST pass all 5 phases)
   - Run `cargo test --workspace` and `cargo clippy --workspace -- -D warnings`
6. Write your handoff report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_2\handoff.md` and send a completion message with verification outputs.

## 2026-09-08T23:20:12Z
<USER_REQUEST>
You are worker_m6_2.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_2.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m6_2\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md, the challenger handoff at .agents/challenger_m6_1/handoff.md, and fix explorer reports in .agents/explorer_m6_fix_1/, .agents/explorer_m6_fix_2/, .agents/explorer_m6_fix_3/.
Implement the 5 fixes in scripts/sync-workspace-state.sh.
Run bash tests/adversarial/test_sync_workspace_adversarial.sh and verify 17/17 tests pass.
Run bash scripts/test-container-recycling.sh, cargo test, and cargo clippy.
Write handoff.md in your working directory and notify your parent with send_message.
</USER_REQUEST>
