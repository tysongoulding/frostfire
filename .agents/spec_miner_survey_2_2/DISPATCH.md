# Dispatch: Spec Miner Survey 2.2 — MicroVM Persistence & Crash Defenses

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2_2`

## Authoritative Request & References
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`
- Inspect GrokBot MicroVM multi-display & crash defenses: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm/` (specifically `box-xvfb`, `box-xfwm4`, `box-picom`, `box-plank`, `box-x11vnc`, `box-bounded-log.mjs`)
- Inspect GrokBot Architecture: `c:\Users\tyson\.repo\personal\syntropy\docs\GROKBOT_MICROVM_ARCHITECTURE.md`
- Inspect current Frostfire Lambda template: `c:\Users\tyson\.repo\personal\frostfire-cloud\deploy\aws\lambda-microvm.yaml`
- Inspect current Frostfire microVM scripts: `c:\Users\tyson\.repo\personal\frostfire-cloud\cloud\microvm/` and `scripts/`

## Objective
Analyze:
1. R2: Ephemeral Lambda MicroVM State Persistence & Worktrees:
   - Configuration of Amazon EFS mount (`/mnt/workspace`) in `deploy/aws/lambda-microvm.yaml` (FileSystem, MountTargets, AccessPoint, Lambda LocalMountPath).
   - Automated shadow worktree snapshotting and restore scripts (`scripts/sync-workspace-state.sh`).
2. R3: Multi-Screen Display Multiplexer & Crash-Loop Defenses:
   - Porting `box-xvfb`, `box-xfwm4`, `box-picom`, `box-plank`, `box-x11vnc`, `box-bounded-log.mjs` into `cloud/microvm/bin/`.
   - Stale X11 lock file cleanup (`/tmp/.X*-lock`, `/tmp/.X11-unix/X*`), dead RFB socket cleanup, and orphan process reaping across restarts.
Write your complete findings and implementation specifications to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2_2\report.md` and send a completion message with your verdict.
