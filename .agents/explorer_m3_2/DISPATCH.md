# Dispatch: Explorer M3-2 (Deployment Automation Scripts & Turnkey Modernization)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` and `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`.
Read `explorer_survey_3` handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_3\handoff.md`.
Your role is `teamwork_preview_explorer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_2`.

Your scope is Milestone 3: Turnkey Deployment Automation (Feature F14):
1. Audit `scripts/cloud-start.ps1`, `scripts/cloud-status.ps1`, `scripts/cloud-stop.ps1`:
   - Identify hardcoded AWS instance ID `i-00970c561f6cdf7b0`.
   - Formulate parameterization: support passing instance ID via parameter, environment variable, or automatic lookup via AWS CLI tag/name query.
2. Audit `scripts/setup-cluster.sh`:
   - Identify legacy workarounds: lines running `docker run` instead of Firecracker, and lines launching a Python HTTP server on port 3000 instead of `frostfire-gateway`.
   - Modernize script to deploy and orchestrate Firecracker microVMs and `frostfire-gateway`.
3. Formulate testing and verification methods.
Deliver your report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_2\report.md` and `handoff.md`.

## 2026-09-08T21:44:11Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_2\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_2.
Investigate deployment scripts (cloud-start.ps1, setup-cluster.sh, parameterization, Firecracker and gateway orchestration). Deliver report.md and handoff.md, then notify parent.
