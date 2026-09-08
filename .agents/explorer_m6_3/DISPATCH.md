# Dispatch: Explorer M6.3 — Ephemeral MicroVM Credential Persistence & Verification

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_3`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Inspect GrokBot Reference: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\persist-cli-auth`
- Inspect Survey 2.2 Report: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2_2\report.md`

## Objective
Analyze and specify:
1. `cloud/microvm/bin/persist-cli-auth`:
   - Porting `persist-cli-auth` to mirror `.config/gh`, `.aws`, `.config/gcloud`, `.ssh`, `.docker`, `.vercel`, `.fly`, `.netrc`, `.npmrc`, `.gitconfig`, `.git-credentials` to persistent storage (`/mnt/workspace/.frostfire/credentials`).
   - Mirroring subcommands: `backup`, `restore`, and `sync`.
   - Security: Enforcing 0700/0600 POSIX permissions on secret directories/files, size bounding (50MB cap), and pruning cache directories.
2. Verification harness design:
   - Automated test script simulating container recycling: creating files in `/mnt/workspace/test-repo`, running `snapshot`, unmounting/simulating fresh container, running `restore`, and verifying bit-for-bit file integrity.
Write your detailed findings and exact script code to `report.md` and `handoff.md`.

## 2026-09-08T23:00:05Z
You are explorer_m6_3.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_3.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_3\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and survey report at .agents/spec_miner_survey_2_2/report.md.
Analyze persist-cli-auth in cloud/microvm/bin/ and design the automated container recycling persistence test harness.
Write your analysis and recommendations to report.md and handoff.md in your working directory.
When done, notify your parent with send_message.
