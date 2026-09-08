# Dispatch: Worker M1-2 (Remediation of extract_bearer_token & Gate Pass)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md` and `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`.
Read the fix explorer reports:
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_fix_1\handoff.md`
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_fix_2\handoff.md`
- `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_fix_3\handoff.md`

Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1_2`.

## Write Ownership
You exclusively own:
- `cloud/gateway/src/auth.rs`
- `services/swarm-orchestrator/src/gemini.rs` (if applying the secondary hardening)
- Unit tests in `cloud/gateway/src/auth.rs`

## Tasks:
1. Update `cloud/gateway/src/auth.rs`:
   Replace `extract_bearer_token`:
   ```rust
   pub fn extract_bearer_token(auth_header: &str) -> &str {
       let trimmed_start = auth_header.trim_start();
       if let Some(prefix) = trimmed_start.get(..7) {
           if prefix.eq_ignore_ascii_case("bearer ") {
               return trimmed_start[7..].trim();
           }
       }
       if trimmed_start.eq_ignore_ascii_case("bearer") {
           return "";
       }
       auth_header.trim()
   }
   ```
2. Add unit tests in `auth.rs` testing multi-byte UTF-8 inputs across boundary index 7 (e.g. `"123456\u{00E9}"`, `"1234\u{1F600}"`, `"12345\u{4E2D}"`), `"Bearer "`, `"Bearer"`, `"bearer  token"`.
3. Verify that `services/swarm-orchestrator/src/gemini.rs:302` handles case-mapping length differences safely.
4. Run and verify:
   - `cargo test --package frostfire-gateway --test adversarial_m1_test` (MUST PASS)
   - `cargo test --package frostfire-gateway --test grpc_protocol_stress_test` (MUST PASS)
   - `cargo test -p frostfire-gateway` (MUST PASS)
   - `cargo test --workspace` (MUST PASS 100%)
   - `cargo clippy --workspace -- -D warnings` (MUST PASS with 0 warnings)
5. Write your handoff to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1_2\handoff.md` and notify parent.

## 2026-09-08T20:58:01Z
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1_2\DISPATCH.md.
Also read the fix explorer handoffs:
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_fix_1\handoff.md
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_fix_2\handoff.md
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m1_fix_3\handoff.md

Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m1_2.
Remediate extract_bearer_token in cloud/gateway/src/auth.rs, run all test suites (including adversarial_m1_test and grpc_protocol_stress_test), verify cargo test --workspace and cargo clippy --workspace -- -D warnings, and deliver handoff.md. Notify parent when done.
