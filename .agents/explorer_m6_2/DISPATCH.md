# Dispatch: Explorer M6.2 — Shadow Worktree Snapshot & Restore Automation

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_2`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Inspect Survey 2.2 Report: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2_2\report.md`
- Inspect `crates/frostfire-exec/src/worktree.rs`

## Objective
Analyze and specify the complete implementation for `scripts/sync-workspace-state.sh`:
1. Subcommands:
   - `snapshot <agent_id> [workspace_dir]`: Capture dirty staged and unstaged state using `git write-tree` and `git commit-tree` under `refs/frostfire/shadow/<agent_id>`. Archive untracked files into `.untracked.tar.gz`. Write atomic state manifest (`manifest.json`) to `/mnt/workspace/.frostfire/state/<agent_id>/`.
   - `restore <agent_id> [workspace_dir]`: Read manifest, verify checksums, extract commit tree or cherry-pick commit, unpack untracked files, and restore working copy without polluting user branches.
   - `watch <agent_id> [workspace_dir] [interval]`: Daemon loop capturing state on interval and trapping `SIGTERM`/`SIGINT` to flush dirty changes before container termination.
   - `list`: List all available shadow snapshots and manifests.
   - `clean <agent_id>`: Safely purge snapshot artifacts.
2. Invariants: Zero data loss across simulated container recycling, distributed file locking (`flock`) on `/mnt/workspace/.frostfire/locks/<agent_id>.lock`, and clean exit handling.
Write your detailed findings and exact script code to `report.md` and `handoff.md`.
