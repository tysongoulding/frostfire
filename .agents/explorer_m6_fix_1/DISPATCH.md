# Dispatch: Explorer M6 Fix 1 — Git Worktree & Object Reachability Remediation

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_1`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Read Challenger M6.1 Handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m6_1\handoff.md`
- Inspect `scripts/sync-workspace-state.sh` lines 165-210

## Objective
Analyze and specify drop-in fixes for:
1. **Defect 1 (Git Worktree Crash)**: Line 169 tests `[ -f "${ws_dir}/.git/index" ]`, which fails in linked git worktrees where `.git` is a file. Replace with `git -C "$ws_dir" rev-parse --git-path index` or `git rev-parse --git-dir`.
2. **Defect 2 (Dangling Staged Tree SHA)**: Staged tree is an unreferenced loose object that fails on remote fetch or git gc. Design a ref update for staged state, e.g. `refs/frostfire/shadow/<agent_id>/staged`, or creating a companion shadow commit.
Write your findings and exact code diffs to `report.md` and `handoff.md`.

## 2026-09-08T23:15:50Z
You are explorer_m6_fix_1.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_1.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_fix_1\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and challenger handoff at .agents/challenger_m6_1/handoff.md.
Analyze remediation for Defect 1 (Git worktree index resolution) and Defect 2 (Dangling staged tree SHA reachability).
Write your analysis and recommendations to report.md and handoff.md in your working directory.
When done, notify your parent with send_message.
