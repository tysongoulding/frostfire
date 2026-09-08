# Dispatch: Explorer M5.3 — In-VM Port 1340 Bridge & Reverse Tunnel Ceremony Framing

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_3`

## Authoritative Instructions & Inputs
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` (MUST read directly)
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md`
- Inspect GrokBot Reference: `c:\Users\tyson\.repo\personal\syntropy\deploy\microvm\bin\box-contract.generated.mjs`
- Inspect Survey 2.1 Report: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2_1\report.md`
- Inspect current Frostfire proto and gateway: `crates/frostfire-proto/proto/tunnel.proto`, `cloud/gateway/src/`, `cloud/microvm/scripts/sand-window-router.mjs`

## Objective
Analyze and provide exact code specifications and implementation recommendations for:
1. In-VM HTTP bridge on port 1340: handling `POST /api/requestWebAuthnCeremony`, validating bearer token against `/tmp/sand-window-tokens.d/` or `$XDG_RUNTIME_DIR/sand-gateway-credential` using constant-time comparison, and routing to the gRPC reverse tunnel.
2. Protobuf ceremony framing: `WebAuthnCeremonyRequest` and `WebAuthnCeremonyResponse` over `TunnelServerFrame` and `TunnelClientFrame` (field 22 and 23).
3. Invariant guarantees: Zero Credential Leakage (no private keys on cloud disk), constant-time token comparison, and timeout handling.
Produce your detailed analysis in `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_3\report.md` and `handoff.md`.

## 2026-09-08T22:49:43Z
You are explorer_m5_3.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_3.
Read your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m5_3\DISPATCH.md and ORIGINAL_REQUEST.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md.
Also read PROJECT.md at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_2\PROJECT.md and survey report at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_2_1\report.md.
Analyze the in-VM port 1340 HTTP bridge, reverse tunnel ceremony frame routing (WebAuthnCeremonyRequest/Response), and the zero credential leakage invariant.
Write your analysis and recommendations to report.md and handoff.md in your working directory.
When done, notify your parent with send_message.
