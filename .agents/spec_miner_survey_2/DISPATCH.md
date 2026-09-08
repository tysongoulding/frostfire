# Dispatch: Survey Spec Miner 2 (Client Tunnel & Ingress Gateway Specifications)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`.
Your role is to act as a Specification Miner (`teamwork_preview_spec_miner`).
Investigate the authoritative specifications for the Frostfire desktop client tunnel and gateway ingress:
- Primary references:
  - `c:\Users\tyson\.repo\personal\frostfire\crates\frostfire-tunnel` (inspect protobuf definitions, proto files, trait definitions, message payloads, error codes, authentication handshake, streaming protocols).
  - Current gateway code in `c:\Users\tyson\.repo\personal\frostfire-cloud` (specifically check `crates/frostfire-gateway` or any related crates).
- Investigate:
  1. `AgentTunnelService.OpenTunnel` gRPC / TLS 1.3 service contract.
  2. Bidirectional streaming protocols, multiplexing logic (PTY, VNC, file transfer, commands, control frames).
  3. Constant-time tenant token validation (`timingSafeEqual` / `subtle::ConstantTimeEq`, `x-sand-window-owner`).
  4. Connection recovery, keepalive, reconnection, error handling.

Deliver a comprehensive specification report in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2\report.md` and a self-contained `handoff.md` listing all extracted requirements, proto schemas, message types, invariants, and edge cases.

## 2026-09-08T20:30:13Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2.
Investigate the authoritative specifications for the Frostfire desktop client tunnel and gateway ingress:
- Primary references:
  - c:\Users\tyson\.repo\personal\frostfire\crates\frostfire-tunnel (inspect protobuf definitions, proto files, trait definitions, message payloads, error codes, authentication handshake, streaming protocols).
  - Current gateway code in c:\Users\tyson\.repo\personal\frostfire-cloud (specifically check crates/frostfire-gateway or any related crates).
- Deeply inspect:
  1. AgentTunnelService.OpenTunnel gRPC / TLS 1.3 service contract.
  2. Bidirectional streaming protocols, multiplexing logic (PTY, VNC, file transfer, commands, control frames).
  3. Constant-time tenant token validation (timingSafeEqual / subtle::ConstantTimeEq, x-sand-window-owner).
  4. Connection recovery, keepalive, reconnection, error handling.
Write your full analysis to c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2\report.md and complete a structured handoff at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2\handoff.md.
Notify parent with send_message when done.
