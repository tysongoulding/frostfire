# Dispatch: Explorer M3-1 (Network Isolation Invariant & Host Setup)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`, `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`, and `AGENTS.md`.
Read `explorer_survey_3` handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_3\handoff.md`.
Your role is `teamwork_preview_explorer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_1`.

Your scope is Milestone 3: Network Bridge Isolation (Feature F13):
1. Audit `cloud/microvm/host-setup.sh` and `deploy/aws/firecracker-hypervisor.yaml` lines setting up iptables rules:
   - Identify lines that enable `iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE` and `FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT`.
   - Explain how these rules violate the core invariant: *"Never bridge unauthenticated guest networks to the public internet"* / *"without unauthorized direct public egress"*.
2. Formulate the exact replacement iptables and network bridge configuration:
   - Isolated `172.16.x.0/24` subnet on `br0` / tap devices (`tap0`, `tap1`, `tap2`).
   - Guest packets can ONLY reach host gateway IP `172.16.x.1` or reverse tunnel; direct forwarding to public interface `${PRIMARY_IFACE}` is explicitly dropped or rejected.
   - Zero NAT MASQUERADE on TAP interfaces.
3. Formulate automated verification checks for this invariant.
Deliver your report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_1\report.md` and `handoff.md`.

## 2026-09-08T21:44:11Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, AGENTS.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_1\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_1.
Investigate network bridge isolation (remove NAT MASQUERADE and internet forwarding on TAPs, enforce 172.16.x.0/24 isolated bridge). Deliver report.md and handoff.md, then notify parent.

