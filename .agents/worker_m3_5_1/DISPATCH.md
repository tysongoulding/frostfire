## 2026-09-08T22:16:07Z

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\PROJECT.md, and AGENTS.md.
Read the explorer reports and handoffs:
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_5_1\handoff.md
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_5_2\handoff.md
- c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_5_3\handoff.md
- Proposed Dockerfile: c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_5_2\proposed_Dockerfile.lambda
- Unified Patch: c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_5_2\Dockerfile.lambda.patch

Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\worker_m3_5_1.

You exclusively own these files:
- cloud/agent/Dockerfile.lambda
- deploy/aws/lambda-microvm.yaml
- cloud/microvm/scripts/sand-window-router.mjs

Implement Milestone 3.5 (AWS Lambda Containerized MicroVM Runtime: Feature F17):
1. cloud/agent/Dockerfile.lambda:
   - Implement the multi-stage packaging recommended by explorer_m3_5_2:
     - Stage 1: Retrieve AWS Lambda Web Adapter (LWA) from public.ecr.aws/awsgsl/aws-lambda-adapter:0.9.0 (or awslambda/aws-lambda-adapter:0.8.4).
     - Stage 2: Rust builder (rust:1.83-bookworm) building frostfire-agent, stripping symbols to reduce image size.
     - Stage 3: Runtime debian:bookworm-slim with git, curl, ripgrep, procps.
     - Copy /lambda-adapter to /opt/extensions/lambda-adapter AND symlink to /opt/bootstrap so AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap works on debian base.
     - Create unprivileged non-root user (UID 10001, GID 10001) frostfire with HOME=/tmp, TMPDIR=/tmp.
     - Environment: PORT=8080, AWS_LWA_INVOKE_MODE=response_stream, AWS_LWA_READ_TIMEOUT_MS=900000, FROSTFIRE_SAND_MODE=lambda-microvm.
     - USER 10001:10001, ENTRYPOINT ["/usr/local/bin/frostfire-agent"], CMD ["--gateway", "http://127.0.0.1:50051", "--agent-id", "lambda-user"].
2. deploy/aws/lambda-microvm.yaml:
   - Ensure the template conforms to explorer_m3_5_3 specification:
     - Parameters: ContainerImageUri, LambdaMemorySize (10240 MB), TimeoutSeconds (900s), EnvironmentName, EphemeralStorageSize (10240 MB), GatewayEndpoint.
     - Resources: AWS::Lambda::Function with PackageType: Image, AWS::Lambda::Url with InvokeMode: RESPONSE_STREAM, AWS::Lambda::Permission, AWS::IAM::Role, AWS::ECR::Repository, AWS::Logs::LogGroup.
     - Outputs: FunctionUrl, FunctionArn, EcrRepositoryUri.
3. cloud/microvm/scripts/sand-window-router.mjs:
   - Add unauthenticated /health (and /ready) route returning HTTP 200 OK (e.g. {"status":"ok","mode":"lambda-microvm"}) to handle LWA readiness probing.
   - Maintain strict constant-time token comparison (crypto.timingSafeEqual) on all display routes.
   - Keep Unix LF line endings (0 CR bytes).
4. Verification:
   - Run aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml (must exit 0).
   - Run python tests/adversarial/test_lambda_microvm_cfn.py (must pass all tests).
   - Run cargo test -p frostfire-e2e (must pass 100%).
   - Run cargo test --workspace (must pass 100%, 0 failures).
   - Run cargo clippy --workspace -- -D warnings (must pass with 0 warnings).

Deliver your handoff.md following the Handoff Protocol, and notify parent via send_message when done.
