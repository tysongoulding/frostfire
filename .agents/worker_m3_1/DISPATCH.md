## 2026-09-08T21:48:15Z

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, and AGENTS.md.
Read the explorer handoffs:
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_1\handoff.md
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_2\handoff.md
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_3\handoff.md

Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m3_1.
Implement Milestone 3: AWS Production Infrastructure & Network Isolation:
1. Enforce network bridge isolation in cloud/microvm/host-setup.sh and deploy/aws/firecracker-hypervisor.yaml (remove NAT MASQUERADE and internet forwarding on TAPs, block IMDS, enforce 172.16.x.0/24 isolated bridge).
2. Parameterize scripts/cloud-start.ps1, cloud-status.ps1, cloud-stop.ps1.
3. Modernize scripts/setup-cluster.sh to orchestrate Firecracker microVMs and frostfire-gateway with isolated network.
4. Validate CloudFormation templates with aws cloudformation validate-template.
5. Verify cargo test -p frostfire-e2e, cargo test --workspace, and cargo clippy --workspace -- -D warnings.
Deliver handoff.md and notify parent when done.
