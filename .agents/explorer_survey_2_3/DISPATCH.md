# Dispatch: Explorer Survey 2.3 — Tauri Client Dynamic Ingress Integration

## Working Directory
`c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_2_3`

## Authoritative Request & References
- Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`
- Inspect Frostfire desktop application and client tunnel: `c:\Users\tyson\.repo\personal\frostfire` (specifically `crates/frostfire-tunnel`, `src-tauri/`, etc.)
- Inspect current Frostfire tunnel in `frostfire-cloud`: `c:\Users\tyson\.repo\personal\frostfire-cloud\crates\frostfire-tunnel`
- Inspect current Frostfire gateway in `frostfire-cloud`: `cloud/gateway/src/`

## Objective
Analyze:
1. R4: Tauri Client Dynamic Ingress Integration:
   - Dynamic ingress handshake and endpoint switching between local daemon mode (local gRPC/socket or localhost:50051) and cloud Lambda microVM mode (AWS Lambda streaming function URL or Cloud Gateway).
   - Pre-signed token authentication headers and credential management (e.g. constant-time verified tokens, AWS IAM pre-signed headers/tokens).
   - Tauri IPC command bindings and configuration schema in `crates/frostfire-tunnel` and Tauri backend.
   - Required changes, tests, and verification in `crates/frostfire-tunnel`.
Write your complete findings and implementation specifications to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_2_3\report.md` and send a completion message with your verdict.
