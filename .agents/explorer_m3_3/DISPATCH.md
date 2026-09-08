# Dispatch: Explorer M3-3 (CloudFormation Templates Validation & Architecture)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`, `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`, and `AGENTS.md`.
Read `explorer_survey_3` handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_3\handoff.md`.
Your role is `teamwork_preview_explorer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_3`.

Your scope is Milestone 3: CloudFormation Infrastructure Validation (Feature F15):
1. Audit all CloudFormation templates:
   - `deploy/aws/cloudformation.yaml` (ECS Fargate + NLB on port 50051 for gRPC).
   - `deploy/aws/firecracker-hypervisor.yaml` (Bare-metal hypervisor `c5.metal`/`i3en.metal`, UserData, KVS WebRTC STUN/TURN).
   - `deploy/aws/poc-3user.yaml` (3-user POC).
2. Check for security invariant compliance:
   - Verify `firecracker-hypervisor.yaml` line 268 (`iptables -t nat -A POSTROUTING ... -j MASQUERADE`): must be updated to enforce isolated subnet `172.16.x.0/24` without public internet MASQUERADE.
   - Verify zero secrets in templates.
3. Validate templates with `aws cloudformation validate-template`.
4. Deliver your report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_3\report.md` and `handoff.md`.

## 2026-09-08T21:44:11Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, AGENTS.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_3\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_3.
Investigate and validate CloudFormation templates (cloudformation.yaml, firecracker-hypervisor.yaml, poc-3user.yaml), ensuring zero secrets and isolated bridge. Deliver report.md and handoff.md, then notify parent.
