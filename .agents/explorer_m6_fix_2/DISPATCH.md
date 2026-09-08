# Dispatch: Explorer M6 Fix 2 — Deleted & Renamed File Pruning Remediation

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_2`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Read Challenger M6.1 Handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m6_1\handoff.md`
- Inspect `scripts/sync-workspace-state.sh` lines 380-400

## Objective
Analyze and specify drop-in fixes for:
1. **Defect 3 (Deleted Files Resurrected / Reverted)** and **Defect 4 (Renamed Files Duplicated as Zombies)**:
   In `do_restore`, `git read-tree "$working_tree"` + `git checkout-index -a -f` writes files to disk but never removes files that were deleted or renamed.
   Design the exact pruning mechanism to detect and remove tracked files that existed prior to restore but are absent in `$working_tree`, or use `git read-tree -u --reset "$working_tree"` with isolated index, or compute deleted files via `git diff-tree --diff-filter=D` and unlink them.
Write your findings and exact code diffs to `report.md` and `handoff.md`.

## 2026-09-08T23:15:50Z
You are explorer_m6_fix_2.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_2.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_2\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and challenger handoff at .agents/challenger_m6_1/handoff.md.
Analyze remediation for Defect 3 (Deleted file resurrection) and Defect 4 (Renamed file duplication) in do_restore.
Write your analysis and recommendations to report.md and handoff.md in your working directory.
When done, notify your parent with send_message.
