# Handoff Report: Milestone 3.5 (AWS Lambda Containerized MicroVM Runtime: Feature F17)

**Agent**: `worker_m3_5_1`  
**Recipient**: `parent` (`a683d2a2-4cae-4a3a-a587-8741f091dc4b`)  
**Type**: Hard Handoff (Implementation Complete)  
**Date**: 2026-09-08T22:19:30Z  

---

## 1. Observation

1. **`cloud/agent/Dockerfile.lambda`**:
   - Multi-stage packaging implemented:
     - Stage 1 (Line 10): `FROM public.ecr.aws/awsgsl/aws-lambda-adapter:0.9.0 AS lambda-adapter`
     - Stage 2 (Lines 16–38): `FROM rust:1.83-bookworm AS builder`, builds `frostfire-agent` with `cargo build --release --bin frostfire-agent` and strips symbols with `strip /workspace/target/release/frostfire-agent`.
     - Stage 3 (Lines 44–97): `FROM debian:bookworm-slim AS runtime`, installs `ca-certificates`, `libssl3`, `git`, `curl`, `ripgrep`, `procps`.
     - Dual LWA registration (Lines 60–63):
       ```dockerfile
       COPY --from=lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter
       RUN chmod 755 /opt/extensions/lambda-adapter && \
           mkdir -p /opt && \
           ln -s /opt/extensions/lambda-adapter /opt/bootstrap
       ```
     - Non-root user creation (Lines 70–74):
       ```dockerfile
       RUN groupadd -g 10001 frostfire && \
           useradd -u 10001 -g frostfire -m -d /tmp/frostfire -s /bin/bash frostfire
       RUN mkdir -p /workspace && chown -R 10001:10001 /workspace
       ```
     - Environment configuration (Lines 84–90):
       ```dockerfile
       ENV HOME=/tmp \
           TMPDIR=/tmp \
           PORT=8080 \
           AWS_LWA_INVOKE_MODE=response_stream \
           AWS_LWA_READ_TIMEOUT_MS=900000 \
           FROSTFIRE_SAND_MODE=lambda-microvm \
           RUST_LOG=info,frostfire_agent=debug
       ```
     - Execution context (Lines 93–97):
       ```dockerfile
       USER 10001:10001
       ENTRYPOINT ["/usr/local/bin/frostfire-agent"]
       CMD ["--gateway", "http://127.0.0.1:50051", "--agent-id", "lambda-user"]
       ```
     - Exact line endings: 0 CR bytes (pure Unix LF).

2. **`deploy/aws/lambda-microvm.yaml`**:
   - Template structure:
     - Parameters (Lines 4–40): `EnvironmentName` (default: `frostfire-lambda`), `LambdaMemorySize` (default: `10240`, allocates 6 dedicated vCPUs in Firecracker), `EphemeralStorageSize` (default: `10240`), `TimeoutSeconds` (default: `900`), `ContainerImageUri` (default: `""`), `GatewayEndpoint` (default: `"https://gateway.frostfire.internal:50051"`).
     - Resources: `AgentEcrRepository` (`AWS::ECR::Repository`), `LambdaExecutionRole` (`AWS::IAM::Role`), `LogGroup` (`AWS::Logs::LogGroup`), `AgentMicroVmFunction` (`AWS::Lambda::Function` with `PackageType: Image`, memory: 10240, timeout: 900s, LWA exec wrapper: `/opt/bootstrap`), `AgentFunctionUrl` (`AWS::Lambda::Url` with `InvokeMode: RESPONSE_STREAM`, `AuthType: NONE`), `FunctionUrlPermission` (`AWS::Lambda::Permission`).
     - Outputs (Lines 182–199): `EcrRepositoryUri`, `FunctionArn`, `FunctionUrl`.
     - Exact line endings: 0 CR bytes (pure Unix LF).

3. **`cloud/microvm/scripts/sand-window-router.mjs`**:
   - Lines 83–89: Unauthenticated readiness probe route:
     ```javascript
     const pathname = (req.url || "").split("?")[0].replace(/\/+$/, "") || "/";
     if (pathname === "/health" || pathname === "/ready") {
       res.writeHead(200, { "content-type": "application/json" });
       res.end(JSON.stringify({ status: "ok", mode: "lambda-microvm" }));
       req.resume();
       return;
     }
     ```
   - Constant-time token verification maintained (Lines 27–37):
     ```javascript
     export function tokensMatch(a, b) {
       if (typeof a !== "string" || typeof b !== "string") return false;
       const ab = Buffer.from(a);
       const bb = Buffer.from(b);
       if (ab.length === 0 || bb.length === 0) return false;
       if (ab.length !== bb.length) {
         timingSafeEqual(bb, bb);
         return false;
       }
       return timingSafeEqual(ab, bb);
     }
     ```
   - Display route authorization strictly enforced (Lines 44–66):
     ```javascript
     const display = parseDisplayNumber(displayHeader);
     if (display < 1) {
       return { reject: { status: 400, message: `sand-window-router: bad request (display :${display} must be >= 1)` } };
     }
     const owner = firstHeader(ownerHeader);
     const bound = lookupBoundToken(display);
     if (bound === undefined || !tokensMatch(owner, bound)) {
       return { reject: { status: 403, message: `sand-window-router: forbidden (display :${display} owner-token mismatch)` } };
     }
     ```
   - Exact line endings: 0 CR bytes (pure Unix LF).

4. **Verification Commands and Outputs**:
   - `aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml`:
     - Exited with code 0.
     - Returned valid template capabilities `["CAPABILITY_NAMED_IAM"]` and all 6 parameters.
   - `python tests/adversarial/test_lambda_microvm_cfn.py`:
     - Exited with code 0.
     - Output:
       ```
       ✓ AWS Lambda MicroVM CloudFormation template verification passed.
       ✓ AWS Lambda Agent Dockerfile verification passed.
       All Lambda MicroVM verification tests PASSED.
       ```
   - `node tests/adversarial/test_sand_window_router.mjs`:
     - Exited with code 0.
     - Output: `=== ALL sand-window-router tests PASSED successfully! ===` (500 messages across 50 concurrent WebSocket connections with 0 failures).
   - `cargo test -p frostfire-e2e`:
     - Exited with code 0 (80/80 tier1 passed, 80/80 tier2 passed, 10/10 tier3 passed, 5/5 tier4 passed — 175 total tests passed).
   - `cargo test --workspace`:
     - Exited with code 0 (100% test suites passed across all crates).
   - `cargo clippy --workspace -- -D warnings`:
     - Exited with code 0 (0 warnings).

---

## 2. Logic Chain

1. **Step 1 (LWA Packaging & Bootstrapping)**:
   - AWS Lambda native container execution invokes the container via the Lambda Runtime API.
   - Pulling `aws-lambda-adapter:0.9.0` from `public.ecr.aws/awsgsl/aws-lambda-adapter:0.9.0` (Observation 1) and placing it at `/opt/extensions/lambda-adapter` enables Lambda extension discovery.
   - Symlinking `/opt/extensions/lambda-adapter` to `/opt/bootstrap` (Observation 1) ensures `AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap` specified in `deploy/aws/lambda-microvm.yaml` (Observation 2) functions correctly on Debian Bookworm base images that lack a default `/opt/bootstrap`.

2. **Step 2 (Response Streaming & Isolation)**:
   - `deploy/aws/lambda-microvm.yaml` provisions 10,240 MB RAM (allocating 6 dedicated hardware vCPUs in Firecracker) and sets `AWS_LWA_INVOKE_MODE=response_stream` and `InvokeMode: RESPONSE_STREAM` on the Lambda Function URL (Observation 2).
   - `cloud/agent/Dockerfile.lambda` exports matching environment variables (`PORT=8080`, `AWS_LWA_INVOKE_MODE=response_stream`, `AWS_LWA_READ_TIMEOUT_MS=900000`, `FROSTFIRE_SAND_MODE=lambda-microvm`).
   - Stripping `frostfire-agent` reduces the layer footprint, minimizing Lambda container cold-start latency.
   - Creating non-root user `frostfire` (10001:10001) with `HOME=/tmp` adheres to AWS Lambda's read-only rootfs constraint (`/` read-only, `/tmp` writable).

3. **Step 3 (LWA Health/Ready Probing and Display Token Invariant)**:
   - LWA probes `/health` or `/ready` on `PORT=8080` during initialization to confirm process readiness before opening the Runtime API listener.
   - Adding unauthenticated `/health` and `/ready` handling returning HTTP 200 OK JSON (Observation 3) satisfies LWA's health checks without triggering 403 Forbidden.
   - All display and VNC/websockify routes continue through `decideWindowRoute`, where `tokensMatch` uses `timingSafeEqual` with length-mismatch constant-time padding (Observation 3), maintaining zero timing side-channel leakage across tenants.

---

## 3. Caveats

- **Live AWS Cloud Deployment**: `aws cloudformation validate-template` confirms template validity against the AWS CloudFormation engine. Actually deploying (`aws cloudformation deploy`) requires configured AWS IAM credentials and an active ECR repository push.
- **WebSocket Upgrade on Function URLs**: Function URLs natively support HTTP request/response chunked streaming (`Transfer-Encoding: chunked`), but do not support the HTTP 101 WebSocket handshake directly. External clients streaming VNC/PTY consume chunked streams or connect via the outbound reverse-tunnel gateway (`frostfire-gateway`).
- No other caveats.

---

## 4. Conclusion

Milestone 3.5 (Feature F17: AWS Lambda Containerized MicroVM Runtime) is fully implemented, verified, and ready:
1. `cloud/agent/Dockerfile.lambda`: Multi-stage build with LWA 0.9.0, stripped binary, `/opt/bootstrap` symlink, unprivileged user, and streaming environment variables.
2. `deploy/aws/lambda-microvm.yaml`: CloudFormation template with 10 GB memory (6 vCPUs), 10 GB `/tmp`, 900s timeout, response streaming Function URL, IAM role, ECR repository, and log group.
3. `cloud/microvm/scripts/sand-window-router.mjs`: Unauthenticated `/health` and `/ready` routes for LWA readiness checks; strict constant-time token comparison preserved on display routes; 0 CR bytes maintained.
4. All workspace compilation, linting (`cargo clippy --workspace -- -D warnings`), adversarial checks, and unit/integration test suites pass with 100% success and 0 warnings.

---

## 5. Verification Method

To independently verify the implementation:

1. **CloudFormation Syntax & Capability Validation**:
   ```bash
   aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml
   ```
   *Expected result*: Exit code 0, returns JSON with `CAPABILITY_NAMED_IAM` and 6 parameters.

2. **Adversarial & Structural Verification Suite**:
   ```bash
   python tests/adversarial/test_lambda_microvm_cfn.py
   ```
   *Expected result*: Exit code 0, output `All Lambda MicroVM verification tests PASSED.`

3. **Window Router Unit & Adversarial Tests**:
   ```bash
   node tests/adversarial/test_sand_window_router.mjs
   ```
   *Expected result*: Exit code 0, output `=== ALL sand-window-router tests PASSED successfully! ===`.

4. **Line Ending Verification (Unix LF Invariant)**:
   ```pwsh
   $files = @("cloud/agent/Dockerfile.lambda", "deploy/aws/lambda-microvm.yaml", "cloud/microvm/scripts/sand-window-router.mjs")
   foreach ($f in $files) {
       $cr = ([System.IO.File]::ReadAllBytes($f) | Where-Object { $_ -eq 13 }).Count
       Write-Output "$f : $cr CR bytes"
   }
   ```
   *Expected result*: `0 CR bytes` for all files.

5. **Rust Test & Lint Verification Gates**:
   ```bash
   cargo test -p frostfire-e2e
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
   *Expected result*: All suites pass with 0 failures and 0 warnings.

6. **Invalidation Conditions**:
   - If `InvokeMode` in `lambda-microvm.yaml` is reverted from `RESPONSE_STREAM`.
   - If `/health` in `sand-window-router.mjs` requires display authentication.
   - If `timingSafeEqual` in `sand-window-router.mjs` is replaced with standard equality.
   - If `Dockerfile.lambda` omits `/opt/bootstrap` or runs as `root`.
