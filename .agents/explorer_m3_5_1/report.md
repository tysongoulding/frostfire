# Feature F17 Investigation Report: AWS Lambda Containerized MicroVM Runtime

**Author**: `explorer_m3_5_1` (Teamwork Explorer)  
**Date**: 2026-09-08T22:15:00Z  
**Target Milestone**: Milestone 3.5 (`M3.5`)  
**Status**: COMPLETE  
**Primary Focus**: AWS Lambda Web Adapter Streaming, Firecracker Tenant Isolation, and In-MicroVM Proxy Architecture

---

## Executive Summary

Feature F17 introduces a serverless, per-user microVM execution tier to Frostfire Cloud by packaging the agent runtime into an AWS Lambda container image. Instead of maintaining dedicated EC2 bare-metal hypervisor instances (`c5.metal`/`i3en.metal`) for idle tenants, Frostfire can provision on-demand Firecracker microVMs on AWS Lambda per user/invocation with sub-second spin-up, paying strictly for execution compute.

This investigation explores and resolves three core architectural dimensions:
1. **AWS Lambda Web Adapter (LWA) & Response Streaming**: Utilizing AWS Lambda's native `RESPONSE_STREAM` invocation mode to stream long-lived PTY terminal output, VNC display frames, and LLM turn chunks with millisecond initial-byte latency up to the 15-minute (900s) Lambda timeout.
2. **Native Firecracker MicroVM Isolation**: Leveraging AWS Lambda's hardware-enforced KVM virtualization, minimal VirtIO device model, host Jailer confinement, and strict multi-tenant segregation (one microVM per concurrent invocation; zero cross-tenant execution reuse).
3. **Configuration & Proxy Architecture**: Formulating the precise environment variables (`AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap`, `PORT`, `READINESS_CHECK_PATH`) and designing an in-container proxy topology that seamlessly routes incoming Function URL requests to `sand-window-router.mjs` (port 1339) and `frostfire-gateway` (port 50051) while enforcing constant-time tenant token validation (`timingSafeEqual`).

---

## 1. AWS Lambda Web Adapter Integration for Long-Lived Response Streaming

### 1.1 Architectural Role of AWS Lambda Web Adapter (LWA)
The AWS Lambda Web Adapter (`awslabs/aws-lambda-web-adapter`) is an open-source Rust-based proxy and runtime extension that allows standard HTTP web servers to run on AWS Lambda without modifying application source code.

In a standard AWS Lambda container execution:
- AWS Lambda communicates with execution environments exclusively via the HTTP **Lambda Runtime API** (`AWS_LAMBDA_RUNTIME_API`, typically `127.0.0.1:9001`).
- LWA acts as the bridge:
  1. It reads incoming invocation events from `/runtime/invocation/next`.
  2. It transforms the Lambda event (Function URL or API Gateway payload) into a standard HTTP/1.1 request.
  3. It dispatches the request to the local application over loopback (`127.0.0.1:${PORT}`).
  4. It streams the local application's HTTP response back to the Lambda Runtime API.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               AWS Lambda Firecracker MicroVM                                    │
│                                                                                                 │
│   AWS Lambda               AWS Lambda Web Adapter              In-Container Services            │
│   Runtime API                     (LWA)                                                         │
│  [127.0.0.1:9001]              [/opt/bootstrap]                                                 │
│        │                              │                                                         │
│        │  GET /runtime/invocation/next│                                                         │
│        │◄─────────────────────────────┤                                                         │
│        │  (Receives Invocation Event) │                                                         │
│        │                              │  HTTP GET/POST (headers, stream)                        │
│        │                              ├──────────────────────────────►  Frontend Routing Proxy  │
│        │                              │                                 [:8080]                 │
│        │                              │                                     │                   │
│        │                              │  HTTP/1.1 200 OK                    ├─► /health         │
│        │                              │  Transfer-Encoding: chunked         ├─► sand-window-    │
│        │                              │◄─────────────────────────────┤          router [:1339]  │
│        │  POST /response (Stream)     │  (Incoming chunks)                  └─► frostfire-      │
│        │◄─────────────────────────────┤                                         gateway [:50051]│
│        │  Chunk 1 (Preamble / Frame)  │                                                         │
│        │  Chunk 2 (PTY / VNC Data)    │                                                         │
│        │  Chunk N (Final Frame)       │                                                         │
└────────┴──────────────────────────────┴─────────────────────────────────────────────────────────┘
```

### 1.2 Response Streaming Protocol (`RESPONSE_STREAM` Mode)
By default, AWS Lambda operates in `BUFFERED` mode, accumulating the entire HTTP response body in memory before returning a single payload (capped at 6 MB). 

For Frostfire Cloud's real-time interaction (streaming PTY terminal output, VNC RFB display frames, and token-by-token LLM completions), buffering is unacceptable. F17 activates `RESPONSE_STREAM` mode:

1. **Lambda Function URL Configuration**:
   - The CloudFormation `AWS::Lambda::Url` resource sets:
     ```yaml
     InvokeMode: RESPONSE_STREAM
     ```
   - This instructs the AWS Lambda edge router to stream response chunks back to the client using HTTP chunked transfer encoding (`Transfer-Encoding: chunked`).

2. **LWA Configuration**:
   - `AWS_LWA_INVOKE_MODE: response_stream` (case-insensitive) signals LWA to invoke Lambda Runtime API's streaming response endpoint:
     ```http
     POST http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/${AwsRequestId}/response HTTP/1.1
     Lambda-Runtime-Function-Response-Mode: streaming
     Trailer: Lambda-Runtime-Function-Error-Type, Lambda-Runtime-Function-Error-Body
     Transfer-Encoding: chunked
     ```
   - LWA writes an 8-byte delimiter preamble containing the HTTP status code and response headers as JSON metadata, immediately followed by raw binary response chunks as they emerge from the internal web service.

3. **Throughput, Latency, and Limits**:
   - **Time-to-First-Byte (TTFB)**: Sent immediately upon receipt of headers from the local server (typically < 5ms).
   - **Initial Burst**: First 100 KB is transmitted without bandwidth throttling; subsequent data streams at up to ~2 MB/s to ~16 MB/s depending on client throughput and account tier.
   - **Payload Limits**: Uncapped response size (well exceeding the 6 MB buffered limit, capable of streaming gigabytes of continuous session data across the connection).
   - **Invocation Timeout**: Up to 900 seconds (15 minutes), the hard execution ceiling of AWS Lambda.

### 1.3 Bidirectional Interaction Patterns in Serverless MicroVMs
A key nuance of AWS Lambda Function URLs with `RESPONSE_STREAM` is that **request streaming is unidirectional downstream** (Server -> Client). An HTTP client cannot hold open an HTTP/1.1 request body upload while simultaneously reading the response stream on standard Function URLs (the request body is fully received by Lambda before invocation starts).

Frostfire resolves bidirectional requirements through two production-grade topologies:

#### Pattern A: Outbound Reverse-Tunnel Ingress (Primary Invariant)
Frostfire's core directive states:
> *"Outbound-Only Ingress: Cloud Gateway routes agents via reverse-stream `OpenTunnel`. Daemons connect outbound over TLS 1.3."*

Inside the Lambda microVM, `frostfire-agent` initiates an **outbound** gRPC/TLS 1.3 connection to the central `frostfire-gateway` (`AgentTunnelService.OpenTunnel` on port 50051):
- AWS Lambda functions with internet/VPC access support arbitrary outbound TCP/TLS connections.
- Outbound gRPC streaming over HTTP/2 is **fully bidirectional**: both client frames (PTY output, VNC frames, tool results) and server frames (user prompts, terminal input, HITL approvals) flow concurrently over the same persistent HTTP/2 stream for the entire 15-minute invocation.

#### Pattern B: Dual-Channel HTTP / Function URL Ingress
When the client interacts directly with the Lambda Function URL:
- **Downstream Channel**: The client opens a persistent streaming connection (`GET /stream?session_id=...` or `GET /displays/1/vnc`) with `RESPONSE_STREAM`. LWA pipes continuous terminal updates and VNC RFB updates down to the client.
- **Upstream Channel**: Client inputs (keystrokes, mouse events, approval responses, user messages) are submitted via rapid `POST /input` or `POST /prompt` calls targeting the same session ID. The in-microVM proxy deposits them into the local event queue.

---

## 2. Native Firecracker MicroVM Tenant Isolation in AWS Lambda

### 2.1 Hardware-Enforced KVM Virtualization
Unlike standard Docker/container runtimes (which share the host Linux kernel and rely solely on namespaces and cgroups), AWS Lambda provisions an authentic, dedicated **Firecracker microVM** for each execution environment:

1. **Hardware Virtualization Layer**:
   - Firecracker utilizes Linux Kernel-based Virtual Machine (`/dev/kvm`) leveraging hardware virtualization extensions (Intel VT-x / AMD-V / ARM64 NEON).
   - The guest operating system inside the microVM runs in hardware **Ring 0** (kernel) and **Ring 3** (user space).
   - Guest code CANNOT access the host hypervisor's memory or kernel space directly. A privilege escalation or zero-day root exploit inside the container only compromises the microVM guest kernel—it remains trapped inside hardware boundaries.

2. **Minimalist Device Architecture**:
   - Firecracker strips away all legacy PC platform emulation (no ACPI, no PCI bridges, no IDE controllers, no USB, no PIC).
   - MicroVMs communicate with the hypervisor exclusively through 4 minimal, memory-mapped VirtIO drivers:
     - `virtio-net`: Network frame exchange.
     - `virtio-block`: Ephemeral root/tmp disk storage.
     - `virtio-vsock`: Hypervisor host-guest telemetry.
     - `virtio-balloon`: Memory telemetry and reclamation.
   - This reduces the VMM codebase to ~50,000 lines of Rust (compared to 1,500,000+ lines in QEMU), eliminating >99% of classic VM escape vectors.

### 2.2 Host-Side Confinement: The Firecracker Jailer
On the underlying AWS hypervisor fleet, every Firecracker process is enclosed within the **Jailer** wrapper before boot:
- **Namespaces**: Isolated PID, Mount, Network, IPC, and UTS namespaces. The VMM process cannot inspect any other microVM on the host.
- **Chroot Jail**: Locked in an empty, read-only root directory with only minimal device nodes (`/dev/kvm`, `/dev/net/tun`).
- **Seccomp Filters**: Strict Seccomp Level 2 filters allow only ~30 essential system calls (e.g., `read`, `write`, `epoll_wait`, `ioctl` on KVM vCPU fd). Any unauthorized host syscall triggers immediate process abortion (`SIGSYS`).
- **Unprivileged Execution**: Runs as an isolated UID/GID with all Linux capabilities (`cap_sys_admin`, `cap_net_admin`) dropped.

### 2.3 Strict Multi-Tenant Invariants in AWS Lambda
AWS Lambda enforces fundamental isolation guarantees critical to Frostfire's security posture:

| Isolation Dimension | Guarantee in AWS Lambda | Frostfire Architectural Protection |
|:-------------------|:------------------------|:-----------------------------------|
| **Concurrent Execution** | **Zero Cross-Request Sharing**. An execution environment handles at most ONE request at any given instant. | If Tenant A and Tenant B execute concurrently, they run in completely separate Firecracker microVMs on separate vCPUs/memory spaces. |
| **Cross-Tenant Allocation** | **Zero Cross-Tenant Reuse**. Execution environments are strictly scoped to a single AWS account and single Lambda function ARN. | MicroVMs are never reused across different tenant functions or AWS accounts. |
| **Physical Memory (RAM)** | Dedicated physical memory pages. Kernel Samepage Merging (KSM) is disabled in AWS hypervisors. | Prevents FLUSH+RELOAD, Spectre, and memory deduplication timing side-channels between tenants. |
| **CPU Cache & Branch State** | Hardware cache partitioning and vCPU thread pinning. | Hyperthreading side-channels are neutralized via core-exclusive scheduling. |
| **Ephemeral Storage (`/tmp`)** | VirtIO block device allocated up to 10,240 MB, encrypted with AWS KMS keys. | Destroyed and cryptographically erased when the microVM instance is retired. |
| **Network Tap Topology** | Hyperplane ENI creates point-to-point VPC network interfaces. | No microVM can promiscuously capture or spoof packets belonging to another microVM or host bridge. |

---

## 3. Configuration, Environment Variables, and Proxy Architecture

### 3.1 Environment Variable Specification

To operate the containerized microVM runtime reliably under AWS Lambda Web Adapter, the following environment variables are specified:

| Variable | Recommended Production Value | Critical Function & Architectural Rationale |
|:---|:---|:---|
| `AWS_LAMBDA_EXEC_WRAPPER` | `/opt/bootstrap` | Instructs the Lambda container initialization runtime to execute the Web Adapter binary as an execution wrapper. |
| `PORT` | `8080` | Internal TCP port where the local frontend reverse proxy / supervisor listens for incoming requests forwarded by LWA. |
| `READINESS_CHECK_PATH` | `/health` | HTTP probe endpoint polled by LWA during microVM cold start before traffic is accepted. Must return 2xx. |
| `READINESS_CHECK_PORT` | `8080` | Explicitly binds the readiness probe to the proxy port. |
| `READINESS_CHECK_MIN_INTERVAL_MS` | `15` | Polling frequency (15ms) during cold start to achieve sub-second readiness. |
| `READINESS_CHECK_TIMEOUT_MS` | `15000` | Maximum wait time (15s) for internal microVM processes (`Xvfb`, router, daemons) to become ready. |
| `AWS_LWA_INVOKE_MODE` | `response_stream` | Activates chunked HTTP response streaming via the Lambda Runtime API. |
| `AWS_LWA_READ_TIMEOUT_MS` | `900000` | Extends LWA's internal read timeout to 15 minutes (matching Lambda's 900s timeout) for continuous streaming. |
| `AWS_LWA_ASYNC_INIT` | `true` | Enables asynchronous initialization so background daemons can finish startup without failing the 10s init freeze. |
| `FROSTFIRE_GATEWAY_URL` | `https://gateway.frostfire.internal:50051` | Outbound reverse-tunnel gateway endpoint for persistent stream multiplexing. |
| `FROSTFIRE_SAND_MODE` | `lambda-microvm` | Informs `frostfire-agent` and microVM scripts to adapt memory buffers and process trees for Lambda. |
| `RUST_LOG` | `info,frostfire_agent=debug,frostfire_gateway=info` | Structured logging directive forwarded to CloudWatch. |

### 3.2 In-MicroVM Process Supervision and Port Allocation
Within the containerized microVM, multiple services cooperate to deliver the full Cursor Sand / GrokBot desktop and agent experience:

```
[AWS Lambda Invocation Engine]
         │
         ▼
[LWA /opt/bootstrap] (Runtime API client on :9001)
         │
         ▼ (HTTP/1.1 Loopback)
[Front Proxy / Router on :8080]
  │
  ├───► GET /health  ──► [Immediate 200 OK Response] (Unauthenticated)
  │
  ├───► /displays/* or x-sand-display:*  (x-sand-window-owner constant-time check)
  │       │
  │       ▼
  │     [sand-window-router.mjs on :1339]
  │       ├───► Display 1 (Browser/Interactive) ──► Port 1337 / websockify 6081 (RFB 5900)
  │       └───► Display N (Agent Workspaces)    ──► Port 14000+N (RFB 5900+N, PTY 13600+N)
  │
  └───► /tunnel/* or /agent/* (Bearer Token constant-time check)
          │
          ▼
        [frostfire-gateway / frostfire-agent on :50051]
```

#### Port Assignment Matrix:
- **Port 8080 (`PORT`)**: Main Ingress / LWA target. Evaluates incoming paths and headers:
  - If `path === "/health"`: returns `200 OK {"status":"ready","mode":"lambda-microvm"}`.
  - If header `x-sand-display` is present or path starts with `/display`: passes request to `sand-window-router.mjs` on port 1339.
  - If path starts with `/tunnel` or `/agent`: passes request to `frostfire-gateway` on port 50051.
- **Port 1339**: `sand-window-router.mjs` reverse proxy. Validates `x-sand-window-owner` via `crypto.timingSafeEqual` against `/tmp/sand-window-tokens.d/<display>`.
- **Port 1337**: Display 1 primary agent/desktop interface.
- **Port 6081**: `websockify` token multiplexer for RFB VNC streaming.
- **Ports 14000 + N**: Per-screen agent daemons (Displays 2–7).
- **Ports 13600 + N**: Per-screen PTY WebSockets.
- **Port 50051**: `frostfire-gateway` gRPC/HTTP/2 service.

### 3.3 Security: Constant-Time Token Enforcement on All Routed Paths
Frostfire Cloud invariants mandate that no tenant session or display route can be accessed without constant-time authentication:
1. **Window Router (`sand-window-router.mjs`)**:
   - `x-sand-window-owner` is checked using `crypto.timingSafeEqual`:
     ```javascript
     export function tokensMatch(a, b) {
       if (typeof a !== "string" || typeof b !== "string") return false;
       const ab = Buffer.from(a);
       const bb = Buffer.from(b);
       if (ab.length === 0 || bb.length === 0) return false;
       if (ab.length !== bb.length) {
         timingSafeEqual(bb, bb); // Equalize execution time
         return false;
       }
       return timingSafeEqual(ab, bb);
     }
     ```
   - Enforced on ALL displays, including Display 1.
2. **Gateway (`frostfire-gateway/src/auth.rs`)**:
   - `authorization` / `x-sand-window-owner` checked via `subtle::ConstantTimeEq`. If missing or invalid, immediately rejects with `tonic::Status::unauthenticated`.
3. **Readiness Probe Bypass Guard**:
   - LWA's internal readiness check (`GET /health`) MUST be the ONLY route permitted without tenant token verification, strictly restricted to returning health metadata from localhost.

---

## 4. Analysis of Existing Codebase Artifacts & Recommendations

### 4.1 Audit of `deploy/aws/lambda-microvm.yaml`
- **Sizing**: Default memory `10240 MB` (10 GB) allocates 6 dedicated vCPUs in Firecracker; ephemeral storage `10240 MB` (10 GB /tmp) satisfies build and compilation needs.
- **Function URL**: Correctly configured with `InvokeMode: RESPONSE_STREAM` and `AuthType: NONE` (delegating token validation to in-VM constant-time verifiers).
- **Environment**: Includes `AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap`, `AWS_LWA_INVOKE_MODE: response_stream`, `PORT: "8080"`.
- **Status**: Validates successfully with `aws cloudformation validate-template` and passes adversarial test `tests/adversarial/test_lambda_microvm_cfn.py`.

### 4.2 Audit of `cloud/agent/Dockerfile.lambda` & Critical Finding
During the investigation, an essential runtime compatibility detail was identified:
- In `cloud/agent/Dockerfile.lambda`:
  - Line 6: `FROM public.ecr.aws/awslambda/aws-lambda-adapter:0.8.4 AS lambda-adapter`
  - Line 29: `FROM debian:bookworm-slim AS runtime`
  - Line 42: `COPY --from=lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter`
  - Line 56: `CMD ["frostfire-agent", ...]`
- **Observation**:
  - In `deploy/aws/lambda-microvm.yaml`, the function environment sets `AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap`.
  - However, in `Dockerfile.lambda`, `/lambda-adapter` was copied to `/opt/extensions/lambda-adapter`, and `/opt/bootstrap` does NOT exist in the image!
  - Furthermore, `debian:bookworm-slim` is a standard Linux image, not an AWS Lambda official base image. Standard Debian does not have `/var/runtime/bootstrap` or the Lambda Runtime Interface Client (RIC).
- **Impact**:
  - If deployed as-is with `AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap`, the container init will fail on cold start with `fork/exec /opt/bootstrap: no such file or directory`.
- **Recommendation for Implementers**:
  In `Dockerfile.lambda`, create `/opt/bootstrap` directly from the adapter:
  ```dockerfile
  COPY --from=lambda-adapter /lambda-adapter /opt/bootstrap
  RUN chmod +x /opt/bootstrap
  ```
  Or symlink `/opt/bootstrap` -> `/opt/extensions/lambda-adapter`.
  When `/opt/bootstrap` is present, LWA serves as the wrapper and boots the underlying command seamlessly on non-AWS base images.

### 4.3 Readiness Endpoint Integration in Front Proxy
- Since LWA polls `GET /health` on port 8080 during container start, `sand-window-router.mjs` (or an integrated proxy) must handle `GET /health` without rejecting with 403.
- In `sand-window-router.mjs`:
  Lines 82–97 currently reject any request missing `x-sand-window-owner`.
  Adding a 3-line check:
  ```javascript
  if (req.url === "/health" || req.url === "/ready") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "sand-window-router" }));
    return;
  }
  ```
  ensures the readiness probe passes instantly within 15ms.

---

## 5. Conclusion & Actionable Next Steps
The AWS Lambda Containerized MicroVM runtime (F17) delivers a secure, cost-effective serverless execution environment that mirrors the Cursor Sand / GrokBot multi-display virtualization architecture. By combining AWS Lambda's native Firecracker microVM hardware isolation with the AWS Lambda Web Adapter's `RESPONSE_STREAM` protocol, Frostfire can stream bidirectional desktop displays and agent interactions per user with enterprise-grade tenant isolation.
