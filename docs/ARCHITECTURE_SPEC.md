# Frostfire System Architecture Specification: Production Systems Blueprint

**Document Version:** 2.0.0  
**Status:** APPROVED PRODUCTION BLUEPRINT  
**Target Environments:** Area 1: Cloud MicroVM (Firecracker/KVM), Area 2: Cloud Services & Central Gateway, Area 3: Desktop & Mobile Application (Tauri v2)  
**Security Invariant Version:** Strict AGENTS.md Invariant Compliance  
**Last Updated:** 2026-09-12  

---

## Section 1: Executive Overview & Architectural Invariants

### 1.1 High-Level System Topology

Frostfire is an enterprise-grade agentic operating system, microVM virtualization platform, and swarm orchestrator structured around a strict three-area separation of concerns:

```
+───────────────────────────────────────────────────────────────────────────────────────────+
│ AREA 3: APPLICATION RUNTIME (Desktop & Mobile Tauri v2 Shell)                             │
│  - Presentation Layer: React 19 + TypeScript + Tailwind CSS                               │
│  - Native Shell: Tauri v2 Core, Native IPC commands, Window Lifecycle                     │
│  - User Experience: Streaming Agent Chat, ANSI Terminal Cards, noVNC Canvas Viewport      │
│  - Dynamic Context: Screen Inspector (Active Window, App Name, Viewport Geometry)         │
│  - Host Guardrails: Tiered Security Permission Engine, Native Modal Dialog Approval Gate   │
│  - Client Transport: Multiplexed TLS 1.3 Client Connection over WebSocket/gRPC            │
+─────────────────────────────────────────────▲─────────────────────────────────────────────+
                                              │
                    Client Transport Stream   │ Authenticated Reverse Ingress
                    (Encrypted over TLS 1.3)  │ Constant-Time Token Verification
                                              │ Header: x-frostfire-window-owner
                                              ▼
+───────────────────────────────────────────────────────────────────────────────────────────+
│ AREA 2: CLOUD SERVICES & CENTRAL GATEWAY (Central Control Plane)                          │
│  - Ingress Broker: Outbound-Only OpenTunnel Reverse Stream Broker (TLS 1.3, ALPN h2)     │
│  - Tenant Authorization: Constant-Time Window Owner Token Validator (subtle::ConstantTimeEq)
│  - Intelligent LLM Router: Fast Tier (Haiku / Nova Lite) vs Reasoning Tier (Sonnet / R1) │
│  - SaaS Metering: Sub-millisecond Redis Hot Cache, Atomic Lua Deduction, Hard Locks       │
│  - Billing Sync: 60-Second Background Batch Flusher to Stripe Metered Billing API        │
│  - MicroVM Infrastructure: Ephemeral EC2 Spot Orchestrator & 20-Minute Idle Socket Reaper │
│  - Telemetry Pipeline: Opt-in Trajectory Harvester, Regex PII Scrubber, DPO Parquet Store │
+─────────────────────────────────────────────▲─────────────────────────────────────────────+
                                              │
                    Outbound TLS 1.3 Only     │ Bidirectional OpenTunnel Stream
                    (Zero Inbound Ports Open) │ Frame Multiplexing & Heartbeats (10s)
                                              ▼
+───────────────────────────────────────────────────────────────────────────────────────────+
│ AREA 1: CLOUD MICROVM RUNTIME (Firecracker / KVM Isolated In-Guest Sandbox)               │
│  - Kernel & Hypervisor: Linux 6.1+ KVM Guest, TAP Interface 172.30.0.2 / 172.16.x.0/24   │
│  - Agent Execution Loop: Native Rust rig-rs (rig-core 0.42.0) Turn State Machine          │
│  - Ephemeral Sub-Agents: Dedicated Git Worktrees (/tmp/worktrees/<task_id>) on tmpfs      │
│  - Sandboxing Rails: cgroup v2 (cpu.weight=100, memory.high=3G, pids.max=256) + namespaces│
│  - Embedded Memory Engine:                                                                │
│      ├── HOT: Active Context Buffer (Inclusive 75% Token Watermark Compaction Hook)       │
│      ├── WARM: Embedded SQLite + sqlite-vec (768-dim Cosine) + FTS5 (.system/state/warm.db)│
│      └── COLD: S3 Snapshot Boot Hydration & Cryptographic Commit Pipeline                │
│  - Display Stack: Headless Xvfb :1 (1280x800x24), picom compositor, x11vnc, websockify   │
│  - Screen Automation: On-Demand High-Resolution scrot IPC API                             │
│  - Local MCP Supervisor: Process Supervision for STDIO & SSE Transports with Allowlists   │
+───────────────────────────────────────────────────────────────────────────────────────────+
```

### 1.2 Codification of the Four Architectural Invariants

In accordance with `AGENTS.md`, four non-negotiable architectural invariants govern all code, protocols, and infrastructure across the entire repository. No feature or optimization may violate these rules under any circumstances:

| # | Architectural Invariant | Operational Specification & Enforcement Mechanism |
|---|---|---|
| **INV-1** | **Outbound-Only Ingress** | Cloud Gateway routes agents via reverse-stream `OpenTunnel`. MicroVM guest daemons establish outbound TLS 1.3 connections to the Central Gateway. **Guest microVMs never bind public listening ports, run public SSH daemons, or expose open ingress firewalls.** All remote execution commands, terminal streams, file diffs, and display frames travel over the multiplexed outbound gRPC reverse stream. |
| **INV-2** | **MicroVM Network Isolation** | MicroVM instances execute on dedicated, isolated Linux bridge or TAP networks (`172.30.0.1/24` host TAP with `172.30.0.2` guest, or tenant-segmented `172.16.x.0/24`). Host firewall rules (`iptables`/`nftables`) drop all egress packets destined for AWS Instance Metadata (`169.254.169.254`), link-local addresses (`169.254.0.0/16`), or adjacent microVM bridge networks. Unauthenticated guest networks are strictly prevented from traversing to the host loopback or host LAN. |
| **INV-3** | **Constant-Time Tenant Authorization** | All display streams, remote execution endpoints, and window routing routes must pass `x-frostfire-window-owner` token checks executed in constant time. String comparisons are executed using `subtle::ConstantTimeEq` in Rust or `crypto.timingSafeEqual` in Node.js. Length mismatches and empty tokens are rejected immediately prior to buffer comparison to eliminate timing side-channels. |
| **INV-4** | **Zero Secrets in Git** | AWS credentials, Cloudflare tokens, private encryption keys, Stripe secret keys, and LLM provider API keys must never be committed to source control or baked into guest microVM rootfs images. Secrets are injected at runtime via host environment variables, DPAPI / encrypted keystore (`frostfire-security`), or forwarded dynamically across the encrypted tunnel via the Inverted Credential Broker. |

### 1.3 Cross-Area Communication & Network Protocol Matrix

| Interface Path | Direction | Protocol / Transport | Framing / Serialization | Authentication & Security |
|---|---|---|---|---|
| Area 1 (MicroVM) -> Area 2 (Gateway) | Outbound | TLS 1.3 (ALPN `h2`) | gRPC Protobuf (`AgentTunnelService.OpenTunnel`) | Bearer JWT + Agent ULID |
| Area 3 (Desktop) -> Area 2 (Gateway) | Inbound | TLS 1.3 (WSS / HTTPS) | WebSocket Frames + JSON / Binary Protobuf | `x-frostfire-window-owner` + Session Token |
| Area 2 (Gateway) -> Stripe API | Outbound | HTTPS (TLS 1.3) | JSON REST (`/v1/billing/meter_events`) | Stripe Secret API Key + ULID Idempotency |
| Area 2 (Gateway) -> Redis Hot Cache | Internal | Redis RESP3 | RESP Commands + Lua 5.1 Bytecode | Redis AUTH Password + TLS |
| Area 1 (MicroVM) -> X11 Server | Internal | Unix Domain Socket | X11 Wire Protocol (`/tmp/.X11-unix/X1`) | X11 Cookie Auth (`.Xauthority`) |
| Area 1 (MicroVM) -> MCP Tools | In-Guest | Piped STDIO / HTTP SSE | JSON-RPC 2.0 Line-Delimited | Local Process Execution Isolation |

### 1.4 Feature Inventory Index (All 50 Features from SCOPE.md)

The 50 features defined in `SCOPE.md` map to the implementation requirements of this specification as follows:
- **Features 1–10 (Requirement 1):** Formal Protocol & Interface Schemas (Section 2).
- **Features 11–25 (Requirement 2):** Cloud Gateway & Central Services Specification (Section 3).
- **Features 26–40 (Requirement 3):** MicroVM Execution & Sandboxing Specification (Section 4).
- **Features 41–48 (Requirement 4):** Desktop Client & Host Security Rails Specification (Section 5).
- **Features 49–50 (Requirement 5):** Verification Harnesses & Distributed Sagas (Section 6).

---

## Section 2: Requirement 1 — Formal Protocol & Interface Schemas

### 2.1 Feature 1: OpenTunnel Reverse-Stream Framing Protocol & Feature 2: Reconnection & Heartbeats

The `OpenTunnel` protocol provides bidirectional, multiplexed, low-latency streaming between MicroVM guest daemons and the Central Cloud Gateway over a single outbound TLS 1.3 connection.

#### Protobuf Schema Contract (`tunnel.proto`)

```protobuf
syntax = "proto3";

package frostfire.tunnel;

// Primary bidirectional tunnel service
service AgentTunnelService {
  rpc OpenTunnel(stream TunnelClientFrame) returns (stream TunnelServerFrame);
}

// Client-to-Server envelope frame
message TunnelClientFrame {
  string frame_id = 1;              // Unique UUIDv4 frame identifier
  int64 timestamp_unix_ms = 2;       // UTC timestamp in milliseconds
  uint64 ack_sequence_number = 3;   // Last acknowledged server sequence number
  string agent_id = 4;              // ULID format agent identifier (e.g., agt_01JCV8X9Y7)
  uint64 sequence_number = 5;       // Monotonically increasing sequence number

  oneof payload {
    Heartbeat heartbeat = 10;
    TerminalOutputChunk terminal_output = 11;
    PatchResult patch_result = 12;
    McpInvokeResponse mcp_response = 13;
    ApprovalResponse approval_response = 14;
    CompactionRequest compaction_request = 15;
    CaptureDisplayResponse capture_response = 16;
    AgentMessage agent_message = 17;
    BlackboardSyncFrame blackboard_sync = 18;
    DagSyncFrame dag_sync = 19;
    bytes rfb_frame = 20;
    WebAuthnCeremonyResponse webauthn_response = 21;
    string error_frame = 22;
  }
}

// Server-to-Client envelope frame
message TunnelServerFrame {
  string frame_id = 1;              // Unique UUIDv4 frame identifier
  int64 timestamp_unix_ms = 2;       // UTC timestamp in milliseconds
  uint64 sequence_number = 3;       // Monotonically increasing sequence number
  uint64 ack_sequence_number = 4;   // Last acknowledged client sequence number

  oneof payload {
    Heartbeat heartbeat = 10;
    ExecCommand exec_command = 11;
    TerminalInputChunk terminal_input = 12;
    ApplyPatch apply_patch = 13;
    McpInvokeRequest mcp_request = 14;
    ApprovalRequest approval_request = 15;
    CompactionResponse compaction_response = 16;
    CaptureDisplayRequest capture_request = 17;
    UserPrompt user_prompt = 18;
    BlackboardSyncFrame blackboard_sync = 19;
    DagSyncFrame dag_sync = 20;
    WebAuthnCeremonyRequest webauthn_request = 21;
    DisplayTakeoverEvent display_takeover = 22;
    TeachSessionCommand teach_command = 23;
    string error_frame = 24;
  }
}

// Liveness and latency monitoring payload
message Heartbeat {
  uint64 sequence = 1;              // Monotonic heartbeat ping counter
  int64 timestamp_unix_ms = 2;       // Send timestamp for RTT calculation
  string agent_id = 3;              // Echoed agent ULID
  bool is_ack = 4;                  // false = ping, true = pong acknowledgment
}

// Remote shell and PTY execution request
message ExecCommand {
  string execution_id = 1;          // Execution tracking UUID
  string command = 2;               // Executable binary path or command name
  repeated string args = 3;         // Command line arguments
  string working_dir = 4;           // Target execution directory
  map<string, string> env = 5;      // Injected environment variables
  bool pty = 6;                     // Allocate pseudo-terminal if true
  uint32 pty_rows = 7;              // Terminal row height (e.g., 24)
  uint32 pty_cols = 8;              // Terminal column width (e.g., 80)
}

// Terminal output data streaming chunk
message TerminalOutputChunk {
  string execution_id = 1;          // Corresponds to ExecCommand execution_id
  bytes data = 2;                   // Raw stdout/stderr or PTY ANSI byte buffer
  bool is_stderr = 3;               // True if output from standard error stream
  bool is_exit = 4;                 // True if child process terminated
  int32 exit_code = 5;              // Final process exit status code (0 = success)
}

// Terminal user input interactive chunk
message TerminalInputChunk {
  string execution_id = 1;          // Target execution tracking UUID
  bytes data = 2;                   // Standard input or keystroke byte buffer
}

// Unified diff file modification instruction
message ApplyPatch {
  string patch_id = 1;              // Patch tracking UUID
  string file_path = 2;             // Relative path within workspace jail
  string diff = 3;                  // Unified diff content
  string expected_sha256 = 4;       // Pre-application file hash verification
  bool dry_run = 5;                 // Validate without committing if true
}

// Patch application result
message PatchResult {
  string patch_id = 1;              // Corresponds to ApplyPatch patch_id
  bool success = 2;                 // True if patch applied cleanly
  string new_sha256 = 3;            // Post-application file SHA-256 hash
  string error_message = 4;         // Error diagnostic string if failed
}

// Human-in-the-loop approval request
message ApprovalRequest {
  string request_id = 1;            // Unique approval request ULID
  string action_type = 2;           // "clipboard_read", "fs_write", "host_shell"
  string target_resource = 3;       // Target file path, command string, etc.
  string reason = 4;                // Explanatory reasoning for the user
  int64 timeout_unix_ms = 5;        // Expiration timestamp for approval
}

// Human-in-the-loop approval response
message ApprovalResponse {
  string request_id = 1;            // Corresponds to ApprovalRequest request_id
  bool approved = 2;                // True if user authorized action
  string decision = 3;              // "allow_once", "allow_always", "deny"
  string rejection_reason = 4;      // Optional user explanation if denied
}

// Blackboard collaborative synchronization frame
message BlackboardSyncFrame {
  string uri = 1;                   // Blackboard artifact URI
  string author_id = 2;             // Author agent ULID
  bytes content = 3;                // Serialized artifact payload
  string hash = 4;                  // SHA-256 checksum of content
  string action = 5;                // "upsert", "delete", "lock"
  uint64 version = 6;               // Conflict-resolution version clock
}

// DAG workstream execution state synchronization
message DagSyncFrame {
  string workstream_id = 1;         // Workstream identifier
  string task_id = 2;               // Node task identifier
  string status = 3;                // "pending", "running", "completed", "failed"
  repeated string input_uris = 4;   // Input dependency URIs
  repeated string output_uris = 5;  // Output result URIs
  int64 updated_at_unix_ms = 6;     // Transition timestamp
}

// WebAuthn passkey ceremony request
message WebAuthnCeremonyRequest {
  string ceremony_id = 1;           // Unique ceremony tracking ID
  string kind = 2;                  // "get" or "create"
  string origin = 3;                // Relying party origin URL
  string options_json = 4;          // PublicKeyCredentialCreationOptions JSON
}

// WebAuthn passkey ceremony response
message WebAuthnCeremonyResponse {
  string ceremony_id = 1;           // Corresponds to request ceremony_id
  bool success = 2;                 // True if assertion created
  string credential_json = 3;       // PublicKeyCredential assertion JSON
  string error_message = 4;         // Hardware token error string
}

// Display takeover event notification
message DisplayTakeoverEvent {
  string session_id = 1;            // Active session identifier
  string user_id = 2;               // Intervening user identifier
  bool is_active = 3;               // True when user assumes interactive control
  int64 timestamp_unix_ms = 4;      // Event timestamp
}

// Interactive teach session command
message TeachSessionCommand {
  string session_id = 1;            // Teach session tracking UUID
  string action = 2;                // "start_recording", "stop_recording", "compile"
  string task_name = 3;             // Target skill or workflow name
}

// Interactive teach session response
message TeachSessionResponse {
  string session_id = 1;            // Corresponds to TeachSessionCommand
  bool success = 2;                 // True if recording state adjusted
  string artifact_uri = 3;          // Output trajectory or skill file URI
  string error_message = 4;         // Error string if failed
}

// User prompt submission frame
message UserPrompt {
  string prompt_id = 1;             // Unique prompt ULID
  string session_id = 2;            // Associated session identifier
  string text = 3;                  // Raw or enriched user prompt string
  map<string, string> metadata = 4; // Context tags, screen bounds, model flags
}

// MCP tool invocation request
message McpInvokeRequest {
  string invocation_id = 1;         // Unique invocation tracking ID
  string server_name = 2;           // Registered MCP server identifier
  string tool_name = 3;             // Target MCP tool identifier
  string arguments_json = 4;        // Serialized tool call arguments
  int64 timeout_ms = 5;             // Execution timeout limit
}

// MCP tool invocation response
message McpInvokeResponse {
  string invocation_id = 1;         // Corresponds to McpInvokeRequest
  bool is_error = 2;                // True if tool threw execution error
  string content_json = 3;          // Result content or structured output JSON
  string error_message = 4;         // Error diagnostic if failed
}

// Agent message streaming or concluding an agent turn
message AgentMessage {
  string turn_id = 1;               // Associated turn identifier
  string content = 2;               // Assistant message content or thought stream
  repeated string tool_calls = 3;   // Serialized tool call identifiers or payloads
  bool is_final = 4;                // True if this message concludes the turn
}

// Outbound continuous display stream frame (noVNC / RFB protocol)
message DisplayFrame {
  bytes rfb_data = 1;               // Raw RFB binary protocol frame
  int64 timestamp_unix_ms = 2;      // Frame capture timestamp in milliseconds
  uint32 screen_width = 3;          // Screen width in pixels
  uint32 screen_height = 4;         // Screen height in pixels
}
```

#### Complete Rust Struct Implementations

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelConfig {
    pub server_endpoint: String,
    pub agent_id: String,
    pub auth_token: String,
    pub connect_timeout: Duration,
    pub initial_reconnect_delay: Duration,
    pub max_reconnect_delay: Duration,
    pub backoff_factor: f64,
    pub heartbeat_interval: Duration,
    pub heartbeat_timeout: Duration,
    pub channel_capacity: usize,
    pub max_in_flight_replay: usize,
}

impl Default for TunnelConfig {
    fn default() -> Self {
        Self {
            server_endpoint: "https://gateway.frostfire.cloud:50051".to_string(),
            agent_id: String::new(),
            auth_token: String::new(),
            connect_timeout: Duration::from_secs(10),
            initial_reconnect_delay: Duration::from_millis(500),
            max_reconnect_delay: Duration::from_secs(30),
            backoff_factor: 1.5,
            heartbeat_interval: Duration::from_secs(10),
            heartbeat_timeout: Duration::from_secs(5),
            channel_capacity: 1024,
            max_in_flight_replay: 256,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelClientFrame {
    pub frame_id: String,
    pub timestamp_unix_ms: i64,
    pub ack_sequence_number: u64,
    pub agent_id: String,
    pub sequence_number: u64,
    pub payload: TunnelClientPayload,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum TunnelClientPayload {
    Heartbeat(HeartbeatPayload),
    TerminalOutput(TerminalOutputPayload),
    PatchResult(PatchResultPayload),
    McpResponse(McpResponsePayload),
    ApprovalResponse(ApprovalResponsePayload),
    CompactionRequest(CompactionRequestPayload),
    CaptureResponse(CaptureResponsePayload),
    AgentMessage(AgentMessagePayload),
    BlackboardSync(BlackboardSyncPayload),
    DagSync(DagSyncPayload),
    DisplayFrame(DisplayFramePayload),
    WebAuthnResponse(WebAuthnResponsePayload),
    ErrorFrame(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelServerFrame {
    pub frame_id: String,
    pub timestamp_unix_ms: i64,
    pub sequence_number: u64,
    pub ack_sequence_number: u64,
    pub payload: TunnelServerPayload,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum TunnelServerPayload {
    Heartbeat(HeartbeatPayload),
    ExecCommand(ExecCommandPayload),
    TerminalInput(TerminalInputPayload),
    ApplyPatch(ApplyPatchPayload),
    McpRequest(McpRequestPayload),
    ApprovalRequest(ApprovalRequestPayload),
    CompactionResponse(CompactionResponsePayload),
    CaptureRequest(CaptureRequestPayload),
    UserPrompt(UserPromptPayload),
    BlackboardSync(BlackboardSyncPayload),
    DagSync(DagSyncPayload),
    WebAuthnRequest(WebAuthnRequestPayload),
    DisplayTakeover(DisplayTakeoverPayload),
    TeachCommand(TeachCommandPayload),
    ErrorFrame(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayFramePayload {
    pub rfb_frame: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatPayload {
    pub sequence: u64,
    pub timestamp_unix_ms: i64,
    pub agent_id: String,
    pub is_ack: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecCommandPayload {
    pub execution_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_dir: String,
    pub env: HashMap<String, String>,
    pub pty: bool,
    pub pty_rows: u32,
    pub pty_cols: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputPayload {
    pub execution_id: String,
    pub data: Vec<u8>,
    pub is_stderr: bool,
    pub is_exit: bool,
    pub exit_code: i32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputPayload {
    pub execution_id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPatchPayload {
    pub patch_id: String,
    pub file_path: String,
    pub diff: String,
    pub expected_sha256: String,
    pub dry_run: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchResultPayload {
    pub patch_id: String,
    pub success: bool,
    pub new_sha256: String,
    pub error_message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequestPayload {
    pub request_id: String,
    pub action_type: String,
    pub target_resource: String,
    pub reason: String,
    pub timeout_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResponsePayload {
    pub request_id: String,
    pub approved: bool,
    pub decision: String,
    pub rejection_reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlackboardSyncPayload {
    pub uri: String,
    pub author_id: String,
    pub content: Vec<u8>,
    pub hash: String,
    pub action: String,
    pub version: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagSyncPayload {
    pub workstream_id: String,
    pub task_id: String,
    pub status: String,
    pub input_uris: Vec<String>,
    pub output_uris: Vec<String>,
    pub updated_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebAuthnRequestPayload {
    pub ceremony_id: String,
    pub kind: String,
    pub origin: String,
    pub options_json: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebAuthnResponsePayload {
    pub ceremony_id: String,
    pub success: bool,
    pub credential_json: String,
    pub error_message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayTakeoverPayload {
    pub session_id: String,
    pub user_id: String,
    pub is_active: bool,
    pub timestamp_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeachCommandPayload {
    pub session_id: String,
    pub action: String,
    pub task_name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPromptPayload {
    pub prompt_id: String,
    pub session_id: String,
    pub text: String,
    pub metadata: HashMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessagePayload {
    pub message_id: String,
    pub session_id: String,
    pub sender_id: String,
    pub recipient_id: String,
    pub text: String,
    pub message_type: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRequestPayload {
    pub invocation_id: String,
    pub server_name: String,
    pub tool_name: String,
    pub arguments_json: String,
    pub timeout_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpResponsePayload {
    pub invocation_id: String,
    pub is_error: bool,
    pub content_json: String,
    pub error_message: String,
}
```

#### Complete TypeScript Interface Definitions

```typescript
export interface ITunnelConfig {
  serverEndpoint: string;
  agentId: string;
  authToken: string;
  connectTimeoutMs: number;
  initialReconnectDelayMs: number;
  maxReconnectDelayMs: number;
  backoffFactor: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  channelCapacity: number;
  maxInFlightReplay: number;
}

export type TunnelClientPayloadType =
  | { type: 'heartbeat'; payload: IHeartbeatPayload }
  | { type: 'terminal_output'; payload: ITerminalOutputPayload }
  | { type: 'patch_result'; payload: IPatchResultPayload }
  | { type: 'mcp_response'; payload: IMcpResponsePayload }
  | { type: 'approval_response'; payload: IApprovalResponsePayload }
  | { type: 'compaction_request'; payload: ICompactionRequestPayload }
  | { type: 'capture_response'; payload: ICaptureResponsePayload }
  | { type: 'agent_message'; payload: IAgentMessagePayload }
  | { type: 'blackboard_sync'; payload: IBlackboardSyncPayload }
  | { type: 'dag_sync'; payload: IDagSyncPayload }
  | { type: 'display_frame'; payload: IDisplayFramePayload }
  | { type: 'webauthn_response'; payload: IWebAuthnResponsePayload }
  | { type: 'error_frame'; payload: string };

export interface ITunnelClientFrame {
  frameId: string;
  timestampUnixMs: number;
  ackSequenceNumber: number;
  agentId: string;
  sequenceNumber: number;
  payload: TunnelClientPayloadType;
}

export type TunnelServerPayloadType =
  | { type: 'heartbeat'; payload: IHeartbeatPayload }
  | { type: 'exec_command'; payload: IExecCommandPayload }
  | { type: 'terminal_input'; payload: ITerminalInputPayload }
  | { type: 'apply_patch'; payload: IApplyPatchPayload }
  | { type: 'mcp_request'; payload: IMcpRequestPayload }
  | { type: 'approval_request'; payload: IApprovalRequestPayload }
  | { type: 'compaction_response'; payload: ICompactionResponsePayload }
  | { type: 'capture_request'; payload: ICaptureRequestPayload }
  | { type: 'user_prompt'; payload: IUserPromptPayload }
  | { type: 'blackboard_sync'; payload: IBlackboardSyncPayload }
  | { type: 'dag_sync'; payload: IDagSyncPayload }
  | { type: 'webauthn_request'; payload: IWebAuthnRequestPayload }
  | { type: 'display_takeover'; payload: IDisplayTakeoverPayload }
  | { type: 'teach_command'; payload: ITeachCommandPayload }
  | { type: 'error_frame'; payload: string };

export interface ITunnelServerFrame {
  frameId: string;
  timestampUnixMs: number;
  sequenceNumber: number;
  ackSequenceNumber: number;
  payload: TunnelServerPayloadType;
}

export interface IDisplayFramePayload {
  rfbFrame: Uint8Array;
}

export interface IHeartbeatPayload {
  sequence: number;
  timestampUnixMs: number;
  agentId: string;
  isAck: boolean;
}

export interface IExecCommandPayload {
  executionId: string;
  command: string;
  args: string[];
  workingDir: string;
  env: Record<string, string>;
  pty: boolean;
  ptyRows: number;
  ptyCols: number;
}

export interface ITerminalOutputPayload {
  executionId: string;
  data: Uint8Array;
  isStderr: boolean;
  isExit: boolean;
  exitCode: number;
}

export interface ITerminalInputPayload {
  executionId: string;
  data: Uint8Array;
}

export interface IApplyPatchPayload {
  patchId: string;
  filePath: string;
  diff: string;
  expectedSha256: string;
  dryRun: boolean;
}

export interface IPatchResultPayload {
  patchId: string;
  success: boolean;
  newSha256: string;
  errorMessage: string;
}

export interface IApprovalRequestPayload {
  requestId: string;
  actionType: string;
  targetResource: string;
  reason: string;
  timeoutUnixMs: number;
}

export interface IApprovalResponsePayload {
  requestId: string;
  approved: boolean;
  decision: 'allow_once' | 'allow_always' | 'deny';
  rejectionReason: string;
}

export interface IBlackboardSyncPayload {
  uri: string;
  authorId: string;
  content: Uint8Array;
  hash: string;
  action: 'upsert' | 'delete' | 'lock';
  version: number;
}

export interface IDagSyncPayload {
  workstreamId: string;
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  inputUris: string[];
  outputUris: string[];
  updatedAtUnixMs: number;
}

export interface IWebAuthnRequestPayload {
  ceremonyId: string;
  kind: 'get' | 'create';
  origin: string;
  optionsJson: string;
}

export interface IWebAuthnResponsePayload {
  ceremonyId: string;
  success: boolean;
  credentialJson: string;
  errorMessage: string;
}

export interface IDisplayTakeoverPayload {
  sessionId: string;
  userId: string;
  isActive: boolean;
  timestampUnixMs: number;
}

export interface ITeachCommandPayload {
  sessionId: string;
  action: 'start_recording' | 'stop_recording' | 'compile';
  taskName: string;
}

export interface IUserPromptPayload {
  promptId: string;
  sessionId: string;
  text: string;
  metadata: Record<string, string>;
}

export interface IAgentMessagePayload {
  messageId: string;
  sessionId: string;
  senderId: string;
  recipientId: string;
  text: string;
  messageType: string;
}

export interface IMcpRequestPayload {
  invocationId: string;
  serverName: string;
  toolName: string;
  argumentsJson: string;
  timeoutMs: number;
}

export interface IMcpResponsePayload {
  invocationId: string;
  isError: boolean;
  contentJson: string;
  errorMessage: string;
}
```

#### Reconnection State Machine & In-Flight Replay

```
  [ DISCONNECTED ]
         │
         │ Initial Delay: 500ms
         ▼
  [ CONNECTING ] ──(TLS 1.3 Handshake Fail)──► [ BACKOFF WAIT ]
         │                                            ▲
         │ Handshake Success                          │ Current Delay = Min(Delay * 1.5, 30s)
         ▼                                            │
   [ CONNECTED ] ──(Connection Lost / 3 Drops)────────┘
         │
         ├──► Heartbeat Timer (Every 10s Ping -> Await Pong within 5s)
         ├──► Transmit Queued & Pending Replay Frames
         └──► Process Server Inbound Frames
```

The reconnection controller maintains a ring buffer of the last 256 transmitted frames (`max_in_flight_replay`). Upon stream re-establishment, the client transmits `ack_sequence_number`. The server discards acknowledged frames and requests retransmission of uncommitted sequences.

---

### 2.2 Feature 3: Context Compaction Hook (75% Watermark), Feature 4: CompactionRequest Schema, & Feature 5: CompactionResponse Schema

#### 75% Watermark Trigger Logic

Context compaction prevents catastrophic context exhaustion and maintains reasoning coherence. The trigger executes inside the microVM agent turn loop prior to issuing the next model completion request:

$$\text{Context Ratio} = \frac{\text{Current Context Tokens}}{\text{Maximum Model Context Capacity}}$$

$$\text{Trigger Condition} = \text{Context Ratio} \ge 0.75$$

When `Trigger Condition` evaluates to `true`:
1. The agent loop pauses generation and enters `COMPACTING` state.
2. The active turn history is partitioned into:
   - **Preserved Anchors:** System instructions, original user objective, project constraints, and current active task definition.
   - **Prunable Range:** Intermediate reasoning steps, verbose tool stdout/stderr outputs, and superseded code search logs.
3. The prunable messages are serialized into `CompactionRequest` and routed to the Cloud Gateway Fast Tier (Claude 3.5 Haiku / AWS Nova Lite).
4. Pruned historical turns are simultaneously archived into the local WARM SQLite database (`.system/state/warm.db`).
5. The Cloud Gateway returns a structured `CompactionResponse` containing the distilled narrative summary.
6. The agent loop substitutes the prunable range with the single summary checkpoint turn and resumes execution.

#### Protobuf Compaction Messages

```protobuf
syntax = "proto3";

package frostfire.tunnel;

// Compaction request payload
message CompactionRequest {
  string compaction_id = 1;         // Unique compaction UUIDv4
  string agent_id = 2;              // Agent ULID
  string session_id = 3;            // Session identifier
  int64 current_token_count = 4;    // Token count triggering compaction
  int64 token_limit = 5;            // Model max context capacity (e.g., 200,000)
  float compaction_ratio = 6;       // Measured ratio (>= 0.75)
  repeated MessageAnchor anchors = 7;// Pinned system/context anchors
  repeated CompactableTurn turns = 8;// Turns eligible for distillation
}

// Immutable message anchor preserved across compactions
message MessageAnchor {
  string anchor_id = 1;             // Anchor identifier
  string role = 2;                  // "system", "user", "developer"
  string content = 3;               // Anchor text content
  int64 token_count = 4;            // Pre-computed token length
  string anchor_type = 5;           // "system_prompt", "objective", "constraints"
}

// Conversation turn candidate for compaction
message CompactableTurn {
  string turn_id = 1;               // Turn identifier
  int64 sequence_index = 2;         // Turn order index
  string role = 3;                  // "user", "assistant", "tool"
  string content = 4;               // Raw turn content
  string tool_name = 5;             // Non-empty if role == "tool"
  string tool_call_id = 6;          // Associated tool call identifier
  int64 token_count = 7;            // Turn token cost
  int64 timestamp_unix_ms = 8;      // Execution timestamp
}

// Compaction response payload
message CompactionResponse {
  string compaction_id = 1;         // Corresponds to CompactionRequest
  string session_id = 2;            // Session identifier
  bool success = 3;                 // True if compaction completed
  string compacted_summary = 4;     // Distilled executive narrative checkpoint
  repeated string discarded_turn_ids = 5; // List of purged turn IDs
  int64 original_tokens = 6;        // Token count before compaction
  int64 compacted_tokens = 7;       // Token count of resulting summary
  int64 tokens_saved = 8;           // Net reduction in context tokens
  string warm_storage_uri = 9;      // SQLite WARM archive URI
  string error_message = 10;        // Error string if failed
}
```

#### Rust Typed Structs

```rust
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionRequestPayload {
    pub compaction_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub current_token_count: i64,
    pub token_limit: i64,
    pub compaction_ratio: f32,
    pub anchors: Vec<MessageAnchor>,
    pub turns: Vec<CompactableTurn>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAnchor {
    pub anchor_id: String,
    pub role: String,
    pub content: String,
    pub token_count: i64,
    pub anchor_type: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactableTurn {
    pub turn_id: String,
    pub sequence_index: i64,
    pub role: String,
    pub content: String,
    pub tool_name: String,
    pub tool_call_id: String,
    pub token_count: i64,
    pub timestamp_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionResponsePayload {
    pub compaction_id: String,
    pub session_id: String,
    pub success: bool,
    pub compacted_summary: String,
    pub discarded_turn_ids: Vec<String>,
    pub original_tokens: i64,
    pub compacted_tokens: i64,
    pub tokens_saved: i64,
    pub warm_storage_uri: String,
    pub error_message: String,
}
```

#### TypeScript Interfaces

```typescript
export interface ICompactionRequestPayload {
  compactionId: string;
  agentId: string;
  sessionId: string;
  currentTokenCount: number;
  tokenLimit: number;
  compactionRatio: number;
  anchors: IMessageAnchor[];
  turns: ICompactableTurn[];
}

export interface IMessageAnchor {
  anchorId: string;
  role: 'system' | 'user' | 'developer';
  content: string;
  tokenCount: number;
  anchorType: 'system_prompt' | 'objective' | 'constraints';
}

export interface ICompactableTurn {
  turnId: string;
  sequenceIndex: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName: string;
  toolCallId: string;
  tokenCount: number;
  timestampUnixMs: number;
}

export interface ICompactionResponsePayload {
  compactionId: string;
  sessionId: string;
  success: boolean;
  compactedSummary: string;
  discardedTurnIds: string[];
  originalTokens: number;
  compactedTokens: number;
  tokensSaved: number;
  warmStorageUri: string;
  errorMessage: string;
}
```

---

### 2.3 Feature 6: WARM Memory Relational Schema, Feature 7: Dense Vector Index, & Feature 8: Full-Text Search

WARM memory resides inside the microVM guest filesystem at `.system/state/warm.db`. It stores the complete relational record of all sessions, episodic turns, tool traces, code diffs, and compaction checkpoints, paired with dense vector search (`sqlite-vec`) and full-text search (`FTS5`).

#### Complete SQLite DDL Specification

```sql
-- SQLite WARM Memory Relational & Vector Schema
-- Database File: .system/state/warm.db
-- Extensions Required: sqlite-vec (vec0), FTS5

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- 1. Agents Table
CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    model_tier TEXT NOT NULL DEFAULT 'fast',
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

-- 2. Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    total_tokens_consumed INTEGER NOT NULL DEFAULT 0,
    created_at_unix_ms INTEGER NOT NULL,
    closed_at_unix_ms INTEGER,
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
);

-- 3. Episodic Runs Table
CREATE TABLE IF NOT EXISTS episodic_runs (
    run_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    goal_description TEXT NOT NULL,
    exit_status TEXT NOT NULL DEFAULT 'running',
    total_turns INTEGER NOT NULL DEFAULT 0,
    created_at_unix_ms INTEGER NOT NULL,
    completed_at_unix_ms INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- 4. Turns Relational Table
CREATE TABLE IF NOT EXISTS turns (
    turn_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    sequence_index INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    tool_name TEXT,
    tool_call_id TEXT,
    token_count INTEGER NOT NULL DEFAULT 0,
    is_compacted INTEGER NOT NULL DEFAULT 0,
    created_at_unix_ms INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES episodic_runs(run_id) ON DELETE CASCADE
);

-- 5. Tool Executions Table
CREATE TABLE IF NOT EXISTS tool_executions (
    execution_id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    arguments_json TEXT NOT NULL,
    stdout_text TEXT NOT NULL,
    stderr_text TEXT NOT NULL,
    exit_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    FOREIGN KEY (turn_id) REFERENCES turns(turn_id) ON DELETE CASCADE
);

-- 6. Code Diff Artifacts Table
CREATE TABLE IF NOT EXISTS diff_artifacts (
    diff_id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    before_sha256 TEXT NOT NULL,
    after_sha256 TEXT NOT NULL,
    diff_content TEXT NOT NULL,
    applied_successfully INTEGER NOT NULL DEFAULT 1,
    created_at_unix_ms INTEGER NOT NULL,
    FOREIGN KEY (turn_id) REFERENCES turns(turn_id) ON DELETE CASCADE
);

-- 7. Compaction Checkpoints Table
CREATE TABLE IF NOT EXISTS compaction_checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    discarded_turn_count INTEGER NOT NULL,
    tokens_before INTEGER NOT NULL,
    tokens_after INTEGER NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- 8. Dense Vector Index Table (sqlite-vec vec0)
-- 768-dimensional float32 vector embedding for cosine distance similarity
CREATE VIRTUAL TABLE IF NOT EXISTS turns_vec USING vec0(
    turn_id TEXT PRIMARY KEY,
    embedding FLOAT[768] DISTANCE_METRIC=cosine
);

-- 9. Full-Text Search Virtual Table (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
    turn_id UNINDEXED,
    session_id UNINDEXED,
    role,
    content,
    tool_name,
    tokenize='porter unicode61'
);

-- 10. Automated Sync Triggers for FTS5 & sqlite-vec
CREATE TRIGGER IF NOT EXISTS trg_turns_fts_insert AFTER INSERT ON turns BEGIN
    INSERT INTO turns_fts(turn_id, session_id, role, content, tool_name)
    VALUES (new.turn_id, new.session_id, new.role, new.content, new.tool_name);
END;

CREATE TRIGGER IF NOT EXISTS trg_turns_fts_delete AFTER DELETE ON turns BEGIN
    DELETE FROM turns_fts WHERE turn_id = old.turn_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_turns_fts_update AFTER UPDATE ON turns BEGIN
    UPDATE turns_fts SET
        role = new.role,
        content = new.content,
        tool_name = new.tool_name
    WHERE turn_id = old.turn_id;
END;

-- Explicit trigger to prevent orphaned vector embeddings in sqlite-vec virtual table upon turn deletion
CREATE TRIGGER IF NOT EXISTS trg_turns_vec_delete AFTER DELETE ON turns BEGIN
    DELETE FROM turns_vec WHERE turn_id = old.turn_id;
END;
-- (Note: In schema variants with integer rowid vector tables, the trigger executes: DELETE FROM turns_vec WHERE rowid = OLD.id;)

-- 11. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_episodic_runs_session ON episodic_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_session_seq ON turns(session_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_turns_run ON turns(run_id);
CREATE INDEX IF NOT EXISTS idx_tool_exec_turn ON tool_executions(turn_id);
CREATE INDEX IF NOT EXISTS idx_diff_turn ON diff_artifacts(turn_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON compaction_checkpoints(session_id);
```

#### Hybrid Search Fusion Formula & Scoring

Retrieval across WARM memory combines BM25 full-text rank scores and cosine embedding similarity via Reciprocal Rank Fusion (RRF):

$$\text{Score}(d) = \frac{0.5}{60 + \text{Rank}_{\text{FTS5}}(d)} + \frac{0.5}{60 + \text{Rank}_{\text{Vec}}(d)}$$

---

### 2.4 Feature 9: Dual-Stream Display (noVNC Framing) & Feature 10: On-Demand Scrot IPC API

The dual-stream display architecture separates continuous interactive visual monitoring from deterministic, high-resolution visual model reasoning:
1. **Continuous Interactive Stream (noVNC / RFB 3.8):** A low-latency (30 FPS), bandwidth-adaptive desktop stream rendered directly onto an HTML5 Canvas inside the desktop client over a dedicated WebSocket tunnel channel.
2. **On-Demand High-Resolution Scrot IPC API:** A discrete, synchronous frame capture interface providing pristine, uncompressed 24-bit RGB PNG snapshots for vision-capable agent reasoning turns.

#### Scrot IPC Protobuf Contract

```protobuf
syntax = "proto3";

package frostfire.tunnel;

// Screen capture request
message CaptureDisplayRequest {
  string capture_id = 1;            // Unique capture request tracking UUID
  uint32 display_number = 2;        // Target X11 display index (default: 1)
  string image_format = 3;          // "png", "jpeg", "webp" (default: "png")
  uint32 quality = 4;               // Quality level 1-100 (for jpeg/webp)
  ScreenRegion region = 5;          // Optional bounding box crop
  bool draw_cursor = 6;             // Composite mouse cursor pointer if true
}

// Screen region bounding box
message ScreenRegion {
  int32 x = 1;                      // Top-left X coordinate
  int32 y = 2;                      // Top-left Y coordinate
  uint32 width = 3;                 // Region pixel width
  uint32 height = 4;                // Region pixel height
}

// Screen capture response
message CaptureDisplayResponse {
  string capture_id = 1;            // Corresponds to CaptureDisplayRequest
  bool success = 2;                 // True if capture completed
  bytes image_data = 3;             // Raw image binary payload
  uint32 width = 4;                 // Full captured image pixel width
  uint32 height = 5;                // Full captured image pixel height
  string sha256 = 6;                // Checksum of image binary
  int64 duration_ms = 7;            // Capture and encoding latency in ms
  string error_message = 8;         // Diagnostic message if failed
}
```

#### Rust Typed Structs

```rust
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequestPayload {
    pub capture_id: String,
    pub display_number: u32,
    pub image_format: String,
    pub quality: u32,
    pub region: Option<ScreenRegion>,
    pub draw_cursor: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResponsePayload {
    pub capture_id: String,
    pub success: bool,
    pub image_data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub sha256: String,
    pub duration_ms: i64,
    pub error_message: String,
}
```

#### TypeScript Interfaces

```typescript
export interface IScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ICaptureRequestPayload {
  captureId: string;
  displayNumber: number;
  imageFormat: 'png' | 'jpeg' | 'webp';
  quality: number;
  region?: IScreenRegion;
  drawCursor: boolean;
}

export interface ICaptureResponsePayload {
  captureId: string;
  success: boolean;
  imageData: Uint8Array;
  width: number;
  height: number;
  sha256: string;
  durationMs: number;
  errorMessage: string;
}
```

#### Concurrency Lock & Capture Pipeline

To eliminate race conditions, partial writes, or corrupted frames during rapid vision-guided turn loops:
1. The scrot daemon acquires an advisory flock on `/tmp/.scrot_:display.lock` (interpolating the target display, e.g., `/tmp/.scrot_1.lock`).
2. It dynamically parses incoming `CaptureDisplayRequest` / `ICaptureRequestPayload` parameters into the `scrot` command invocation:
   - **Target Display:** Appends `--display :${display_number}` (e.g., `--display :1`).
   - **Pointer Visibility:** Conditionally appends `--pointer` if `draw_cursor == true`.
   - **Sub-Region Bounding Box:** When `region` is specified with non-zero dimensions (`x`, `y`, `width`, `height`), appends `-a ${region.x},${region.y},${region.width},${region.height}` to capture the precise sub-rectangle.
   - **Quality & Compression:** Clamps `quality` to $1 \le Q \le 100$ (default 85) and passes `--quality ${quality}`. For PNG format, maps quality to compression level `--quality 9`.
   - **Output Format Handling:** Dynamically targets `/tmp/.scrot_${display_number}_${capture_id}.${image_format}`. For `webp` targets where `scrot` lacks native WebP encoders on the guest OS, the daemon invokes `cwebp -q ${quality} /tmp/.scrot_${display_number}_${capture_id}.png -o /tmp/.scrot_${display_number}_${capture_id}.webp` or uses the in-memory Rust `image` crate.
   - **Execution Template:**
     ```bash
     scrot --display :${display_number} ${draw_cursor_flag} ${region_arg} --quality ${quality} --overwrite /tmp/.scrot_${display_number}_${capture_id}.${image_format}
     ```
3. The temporary file is read into a memory buffer and verified for format-specific magic bytes:
   - **PNG:** `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`
   - **JPEG:** `0xFF 0xD8 0xFF`
   - **WebP:** `RIFF-size-WEBP` (`0x52 0x49 0x46 0x46` header with `0x57 0x45 0x42 0x50` format marker)
   The validated binary payload is streamed back across the tunnel in `CaptureResponsePayload`.
4. The temporary file is immediately unlinked and the file lock is released. Latency SLO: Complete capture and transfer completed within $\le 150\text{ ms}$.

---

## Section 3: Requirement 2 — Cloud Gateway & Central Services (Area 2)

### 3.1 Feature 11: LLM Router Fast Tier & Feature 12: LLM Router Reasoning Tier

The Central Cloud Gateway terminates model requests from both guest microVMs and desktop clients. It applies deterministic classification rules to achieve high execution velocity and token economics.

#### Model Taxonomy & Characteristics

| Model Tier | Primary Model Targets | Fallback Providers | Latency SLO (TTFT) | Output Budget | Target Workloads |
|---|---|---|---|---|---|
| **Fast Tier** | Claude 3.5 Haiku (`claude-3-5-haiku-20241022`) | AWS Nova Lite (`amazon.nova-lite-v1:0`), Gemini 2.5 Flash | $< 500\text{ ms}$ | 4,096 tokens | Tool parameter validation, classification, context compaction, single-file search, sub-agent micro-steps |
| **Reasoning Tier** | Claude 3.7 Sonnet (Extended Thinking) | DeepSeek R1, OpenAI o1 / o3-mini | $2,000 - 8,000\text{ ms}$ | 64,000 tokens | Architectural blueprints, multi-file code generation, compiler error sagas, formal proofs, verification analysis |

#### Deterministic Classification State Machine Rules

```
                      [ Incoming Model Request ]
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      ▼                                                       ▼
[ Compaction Request? ]                               [ User Explicit Tier? ]
      │ YES                                                   │ Specified
      ▼                                                       ▼
( FAST TIER )                                         ( Use Specified Tier )
      │ NO                                                    │ None
      └───────────────────────────┬───────────────────────────┘
                                  ▼
                     [ Task Type Classification ]
                                  │
     ├── "planning" / "architecture" / "review" ──────► ( REASONING TIER )
     ├── "compiler_error_recovery" / "test_failure" ──► ( REASONING TIER )
     ├── Prompt contains > 3 unified diff hunks ──────► ( REASONING TIER )
     ├── Prompt regex matches complex logic ──────────► ( REASONING TIER )
     │
     └── Default / "tool_dispatch" / "summary" ───────► ( FAST TIER )
```

#### Prompt Sanitization & Provider Failover Sequence

1. **Prompt Sanitization:** The gateway scans input prompts using regex to neutralize adversarial control tokens (`<|im_start|>`, `<|endoftext|>`, system prompt injection patterns).
2. **Provider Failover Sequence:**
   $$\text{Primary: Anthropic Direct} \xrightarrow{\text{Status 5xx / 429}} \text{Secondary: AWS Bedrock} \xrightarrow{\text{Status 5xx / 429}} \text{Tertiary: DeepSeek / OpenRouter}$$

---

### 3.2 Feature 13: Redis Credit Balance Accounting, Feature 14: Atomic Lua Deduction Script, Feature 15: Zero-Balance Hard Lock, & Feature 16: 60-Second Stripe Billing Flush Loop

#### Redis Key Schema

```
tenant:{tenant_id}:credits              -> HASH { "balance": i64, "reserved": i64, "updated_at": i64 }
tenant:{tenant_id}:unbilled_tokens      -> HASH { "input": i64, "output": i64, "total_micro_cents": i64 }
billing:dirty_tenants                   -> SET { tenant_id_1, tenant_id_2 }
billing:meter_events_idempotency:{ulid} -> STRING "PROCESSED" (EX 86400)
```

#### Atomic Lua Token Deduction Script

```lua
-- Atomic Token Deduction & Hard-Lock Check Lua Script
-- Return codes:
--   -1  : Tenant account does not exist
--   -2  : Insufficient balance (bal < cost)
--  >= 0 : Deduction successful; returns new remaining balance
--
-- KEYS[1]: tenant credit hash (tenant:{tenant_id}:credits)
-- KEYS[2]: tenant unbilled hash (tenant:{tenant_id}:unbilled_tokens)
-- KEYS[3]: dirty tenants set (billing:dirty_tenants)
-- ARGV[1]: cost in micro-cents
-- ARGV[2]: tenant_id
-- ARGV[3]: input_tokens
-- ARGV[4]: output_tokens

local current_balance = redis.call('HGET', KEYS[1], 'balance')
if not current_balance then
    return -1 -- Tenant account does not exist
end

local bal = tonumber(current_balance)
local cost = tonumber(ARGV[1])

if bal < cost then
    return -2 -- Hard locked (insufficient credit balance)
end

-- Deduct cost from active balance
local new_bal = bal - cost
redis.call('HSET', KEYS[1], 'balance', new_bal)
redis.call('HSET', KEYS[1], 'updated_at', redis.call('TIME')[1])

-- Accumulate unbilled usage for Stripe flush
redis.call('HINCRBY', KEYS[2], 'input', tonumber(ARGV[3]))
redis.call('HINCRBY', KEYS[2], 'output', tonumber(ARGV[4]))
redis.call('HINCRBY', KEYS[2], 'total_micro_cents', cost)

-- Register tenant in dirty set for 60-second flusher
redis.call('SADD', KEYS[3], ARGV[2])

return new_bal
```

#### Zero-Balance Hard Lock Mechanism

If the Lua script returns `-2` or `-1`, the gateway immediately halts turn execution:
1. If `-1`: Halts turn with status `NOT_FOUND`, error code `TENANT_NOT_FOUND`.
2. If `-2`: Outbound LLM HTTP stream is terminated immediately:
   - Returns error frame to client: status `PERMISSION_DENIED`, error code `INSUFFICIENT_CREDITS`.
   - MicroVM execution is locked until credit replenishment occurs.

#### 60-Second Stripe Billing Flush Loop

A background worker executes every 60 seconds (`*/1 * * * *`):
1. Safely rotates the dirty set using a reliable two-phase queue: `SMOVE billing:dirty_tenants billing:flushing_tenants <tenant_id>`.
2. For each flushing tenant:
   - Reads snapshot values: `billed_micro_cents = total_micro_cents`, `billed_input = input`, `billed_output = output`.
   - If `billed_micro_cents <= 0`, removes tenant from `billing:flushing_tenants` and continues.
   - Generates an idempotent event identifier `evt_<ulid>`.
   - Dispatches a request to Stripe Metered Billing API:
     ```http
     POST /v1/billing/meter_events HTTP/1.1
     Host: api.stripe.com
     Authorization: Bearer <STRIPE_API_KEY>
     Content-Type: application/json

     {
       "event_name": "frostfire_compute_tokens",
       "payload": {
         "stripe_customer_id": "cus_12345678",
         "value": "452100"
       },
       "identifier": "evt_01JCV8X9Y7ABCDEF12345678"
     }
     ```
   - On HTTP 200 OK:
     - Atomically decrements the reported usage to eliminate race conditions with concurrent turns:
       `HINCRBY tenant:{tenant_id}:unbilled_tokens total_micro_cents -billed_micro_cents`
       `HINCRBY tenant:{tenant_id}:unbilled_tokens input -billed_input`
       `HINCRBY tenant:{tenant_id}:unbilled_tokens output -billed_output`
     - Removes tenant from `billing:flushing_tenants`.
     - Sets `billing:meter_events_idempotency:{ulid}` with 24-hour expiration.
   - On failure: Leaves tenant in `billing:flushing_tenants` and retries with exponential backoff up to 5 times.
3. **Saga Synchronization:** The saga refund coordinator uses an atomic Lua script that increments `tenant:{id}:credits balance` AND decrements `tenant:{id}:unbilled_tokens` by the exact refund amount. This guarantees that turns failing due to upstream provider 5xx errors are never billed to Stripe. If the turn was already flushed in an earlier 60-second window, a negative credit adjustment is recorded.

---

### 3.3 Feature 17: Outbound-Only Tunnel Broker, Feature 18: Multi-Tenant Tunnel Multiplexer, & Feature 19: Constant-Time Tenant Authorization

#### Ingress Broker Architecture

The Cloud Gateway runs a high-performance Tonic gRPC server terminating reverse TLS 1.3 streams on port 50051. Guest daemons connect outbound. Zero inbound ports are open on the guest.

```rust
use subtle::ConstantTimeEq;

/// Constant-time verification of x-frostfire-window-owner token
pub fn verify_tenant_window_token(provided_token: &[u8], expected_token: &[u8]) -> bool {
    if provided_token.is_empty() || expected_token.is_empty() {
        return false;
    }
    if provided_token.len() != expected_token.len() {
        return false;
    }
    provided_token.ct_eq(expected_token).into()
}
```

#### Multi-Tenant Session Multiplexer

The gateway manages concurrent streams using `DashMap<String, TenantSession>`:
- `agent_id` maps to active gRPC sender channels.
- Incoming client frames are verified against JWT claims and active display tokens.
- Mismatched tokens are immediately rejected with HTTP 403 Forbidden.

---

### 3.4 Feature 20: Ephemeral EC2 Spot Orchestrator & Feature 21: 20-Minute Idle Socket Reaper

#### EC2 Spot Configuration

- **Instance Type:** Nitro KVM-enabled instances (`c6i.xlarge`, `c6a.xlarge`, `c7i.xlarge`).
- **Spot Interruption Behavior:** `stop` (preserves EBS gp3 root volume).
- **EBS Persistence:** `DeleteOnTermination: false` preserves container rootfs and cache across stops.

#### 20-Minute Idle Socket Reaper & MicroVM Lifecycle

To guarantee $< \$5/\text{month}$ operating expenditure per idle worker, a dual-layer watchdog tracks both socket communications and in-guest runtime execution state:
1. **Meaningful Socket Activity Metrics:**
   - Incoming user prompts (`UserPrompt`), interactive command inputs (`TerminalInputChunk`), approval decisions, and discrete user mouse clicks or keystrokes.
2. **Protocol Exclusion Invariants:**
   - Periodic protocol keepalive frames (10-second `Heartbeat` pings/pongs and sequence ACKs) do **not** count as user or agent activity. Protocol heartbeats alone do not mask session idleness.
   - Continuous passive noVNC framebuffer screen updates do **not** count as active user interaction.
3. **In-Guest Execution & Background Workload Guard:**
   Before marking a session as idle, the reaper daemon inspects the in-guest runtime state:
   - **`rig-rs` State Machine:** The session is active if the agent loop is in `REASONING_STEP`, `TOOL_PLAN_EXECUTE`, or `AWAIT_COMPACTION_RES`.
   - **cgroup v2 CPU Utilization:** Queries `/sys/fs/cgroup/cpu.stat`. If 1-minute CPU utilization $\ge 5\%$, autonomous background work (such as compiler operations, `cargo` builds, or test suite execution) is actively processing, and the idle timer is suspended.
   - **Active Sub-Agent Cgroups:** Verifies that `/sys/fs/cgroup/agent/task_*/cgroup.procs` are empty (`active_subagent_cgroups == 0`).
   - **Running Worker Processes:** Verifies no background compiler or agent processes (`frostfire`, `cargo`, `rustc`, `node`, `pytest`) are actively spawned.
4. **Reaper State Machine & Actions:**
   - Evaluated on a 60-second cycle.
   - Termination Condition: `idle_duration >= 20 min` **AND** `agent_state == IDLE` **AND** `active_subagent_cgroups == 0` **AND** `cpu_utilization_1m < 5%`.
   - When the termination condition is met:
     - Issues an `AGENT_PAUSE` frame across `OpenTunnel`.
     - Flushes dirty WARM SQLite checkpoints and synchronizes git index.
     - Commits memory checkpoints and task state to S3.
     - Gracefully terminates the ephemeral spot instance via `shutdown -h now`.

---

### 3.5 Feature 22: Opt-In Trajectory Harvester, Feature 23: DPO Preference Parquet Schema, & Feature 24: PII & Secret Sanitization Engine

#### PII & Secret Sanitization Table

Before any prompt, turn, or execution output is persisted to the trajectory dataset, the gateway runs deterministic regex sanitization:

| Secret Category | Target Regex Pattern | Substitution Token |
|---|---|---|
| AWS Access Key | `(?i)(?:A3T[A-Z0-9]\|AKIA\|AGPA\|AIDA\|AROA\|AIPA\|ANPA\|ANVA\|ASIA)[A-Z0-9]{16}` | `<REDACTED_AWS_KEY>` |
| Anthropic API Key | `sk-ant-[a-zA-Z0-9_-]{32,}` | `<REDACTED_ANTHROPIC_KEY>` |
| OpenAI API Key | `sk-[a-zA-Z0-9]{20,}` | `<REDACTED_OPENAI_KEY>` |
| Stripe Live Secret Key | `sk_live_[0-9a-zA-Z]{24,}` | `<REDACTED_STRIPE_KEY>` |
| Stripe Restricted Key | `rk_live_[0-9a-zA-Z]{24,}` | `<REDACTED_STRIPE_KEY>` |
| GitHub PAT | `(?:ghp\|gho\|ghu\|ghs\|ghr)_[0-9a-zA-Z]{36}\|github_pat_[0-9a-zA-Z_]{82}` | `<REDACTED_GITHUB_TOKEN>` |
| Bearer / JWT | `ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*` | `<REDACTED_JWT>` |
| Private Key Block | `-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----` | `<REDACTED_PRIVATE_KEY>` |
| IPv4 Public Address | `\b(?:(?:25[0-5]\|2[0-4][0-9]\|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]\|2[0-4][0-9]\|[01]?[0-9][0-9]?)\b` | `<REDACTED_IP>` |
| Email Address | `[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+` | `<REDACTED_EMAIL>` |

#### DPO Preference Parquet Schema

```
Schema: frostfire_dpo_trajectories_v1
├── trajectory_id: STRING (UUIDv4)
├── tenant_id_hash: STRING (SHA-256 pseudonymized)
├── timestamp_unix_ms: INT64
├── task_prompt: STRING (Sanitized)
├── context_files: MAP<STRING, STRING> (Sanitized path -> content)
├── model_tier: STRING ("fast" | "reasoning")
├── model_name: STRING (e.g., "claude-3-7-sonnet")
├── verifier_gate: STRING ("cargo_test" | "vitest" | "pytest")
├── chosen: STRUCT
│   ├── turn_id: STRING
│   ├── content: STRING
│   ├── tool_calls: LIST<STRING>
│   ├── verifier_exit_code: INT32 (0)
│   └── verifier_output: STRING
└── rejected: STRUCT
    ├── turn_id: STRING
    ├── content: STRING
    ├── tool_calls: LIST<STRING>
    ├── verifier_exit_code: INT32 (>0)
    └── verifier_output: STRING
```

---

### 3.6 Feature 25: MicroVM Bridge Network Isolation & TAP Configuration

#### Addressing Architecture

- **Host Gateway Interface:** `tap0` bound to `172.30.0.1/24`.
- **Guest MicroVM Interface:** `eth0` bound to `172.30.0.2/24`.
- **Multi-Tenant Segmentation:** Unique `172.16.x.0/24` subnet per microVM instance.

#### Host Firewall Rules (`iptables` / `nftables`)

```bash
# Enable host IPv4 forwarding
sysctl -w net.ipv4.ip_forward=1

# Block guest from accessing host services on 172.30.0.1 (INPUT chain isolation per INV-2)
iptables -I INPUT -i tap+ -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -A INPUT -i tap+ -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i tap+ -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -i tap+ -p udp --dport 67:68 -j ACCEPT
iptables -A INPUT -i tap+ -j DROP

# Drop all IPv6 traffic from guest tap interfaces
ip6tables -I INPUT -i tap+ -j DROP
ip6tables -I FORWARD -i tap+ -j DROP

# Block microVM from accessing cloud instance metadata
iptables -I FORWARD -i tap0 -d 169.254.169.254/32 -j DROP
iptables -I FORWARD -i tap0 -d 169.254.0.0/16 -j DROP

# Block cross-tenant communication across bridge interfaces
iptables -I FORWARD -i tap+ -o tap+ -j DROP

# Masquerade outbound guest internet traffic
iptables -t nat -A POSTROUTING -s 172.30.0.0/24 -o eth0 -j MASQUERADE
iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -i tap0 -o eth0 -j ACCEPT
```

---

## Section 4: Requirement 3 — MicroVM Execution & Sandboxing (Area 1)

### 4.1 Feature 26: `rig-rs` Agent Execution Loop State Machine, Feature 27: Entry & Exit Criteria, & Feature 28: Context Compaction Integration

#### Execution State Machine

The native Rust agent runtime utilizes `rig-core = "0.42.0"` to execute deterministic multi-turn loops.

```
       [ IDLE ] ──(Receive Prompt)──► [ INGEST_PROMPT ]
                                             │
                                             ▼
                                     [ EVALUATE_CONTEXT ] ◄───────────────────────────────┐
                                             │                                            │
                     ┌───────────────────────┴───────────────────────┐                    │
                     │ Token Watermark >= 0.75                       │ Watermark < 0.75   │
                     ▼                                               ▼                    │
            [ TRIGGER_COMPACTION ]                           [ REASONING_STEP ] ◄──┐      │
                     │                                               │             │      │
                     ▼                                               ▼             │      │
          [ AWAIT_COMPACTION_RES ]                         [ TOOL_PLAN_EXECUTE ]   │      │
          ┌──────────┴──────────┐                                    │             │      │
          │ Success             │ Timeout / 5xx                      ▼             │      │
          ▼                     ▼                          [ VERIFICATION_GATE ]   │      │
[ REPLACE_CHECKPOINT ]  [ SLIDING_WINDOW_FALLBACK ]                  │             │      │
          │                     │                                    │             │      │
          └──────────┬──────────┘                                    │             │      │
                     │                                               │             │      │
                     └───────────────────────────────────────────────┼─────────────┘      │
                                                                     │                    │
                        ┌────────────────────────────────────────────┴────────────────────┘
                        │ (Iterative Loop: Tests Fail & Step < 32 OR Goal Incomplete)
                        │
                        ├─────────────────────────────┬─────────────────────────────┐
                        ▼ Goal DoD Verified           ▼ Turn Limit Exceeded (>= 32) ▼ Zero Balance / Fatal
                [ GOAL_SATISFIED ]            [ STEP_LIMIT_REACHED ]       [ HARD_LOCK_HALT ]
                        │                             │                             │
                        ▼                             ▼                             ▼
                   [ COMPLETE ]                 [ HALT_ERROR ]                [ HALT_ERROR ]
```

#### State Transition Logic & Recurrent Edges

1. **Context Compaction Recurrence:**
   - Compaction distills past conversational history into an immutable checkpoint summary.
   - Upon `REPLACE_CHECKPOINT` (or `SLIDING_WINDOW_FALLBACK` if gateway times out after 15s), the runtime immediately loops back to `REASONING_STEP` to generate the next model response. Compaction never prematurely satisfies a goal.
2. **Iterative Verification Gate:**
   - On verification failure (e.g. compiler error, test suite regression): Diagnostic output is appended to conversation history as tool feedback, and the machine loops back to `REASONING_STEP` for iterative self-correction, up to the 32-step limit.
   - On verification pass: If multi-step goal requires subsequent tasks, loops back to `EVALUATE_CONTEXT`. If all acceptance criteria are verified, transitions to `GOAL_SATISFIED -> COMPLETE`.

#### Entry & Exit Criteria

- **Entry Criteria:**
  1. Valid `UserPrompt` frame received with authenticated session ID.
  2. Workspace lock acquired.
  3. Context token count within model capacity.
- **Exit Criteria (Complete):**
  1. Goal definition of done verified by programmatic verifier gate (exit code 0).
  2. Final synthesized message returned to client.
- **Exit Criteria (Halt / Error):**
  1. Step limit reached: Turn count exceeds maximum bound of 32 iterations.
  2. Zero-balance hard lock triggered.
  3. Unrecoverable tool failure or fatal crash.

---

### 4.2 Feature 29: Sub-Agent Spawning in Worktrees, Feature 30: Linux cgroup v2 Limits, Feature 31: Linux Namespace Isolation, & Feature 32: Verification Merge Gates

#### Git Worktree Isolation on tmpfs

Sub-agents execute inside isolated ephemeral Git worktrees allocated on a tmpfs ramdisk:
- **Worktree Directory:** `/tmp/worktrees/<task_id>`
- **Creation Command:**
  ```bash
  git worktree add -b task/<task_id> /tmp/worktrees/<task_id> HEAD
  ```
- **Cleanup Policy:** On success or failure, the supervisor invokes:
  ```bash
  git worktree remove --force /tmp/worktrees/<task_id>
  git branch -D task/<task_id>
  ```

#### Linux cgroup v2 Resource Limits

All spawned sub-agent child processes are bound to a dedicated cgroup slice:
- **Cgroup Path:** `/sys/fs/cgroup/agent/task_<task_id>`
- **Resource Constraints:**
  - `cpu.weight`: `100` (interactive desktop slice has weight `800`)
  - `memory.high`: `3G` (throttles memory allocator, activates kernel swap)
  - `memory.max`: `3.5G` (hard OOM kill ceiling)
  - `pids.max`: `256` (prevents fork bomb exhaustion)

#### Linux Namespace Isolation

Untrusted code execution commands run wrapped in isolated namespaces:
```bash
unshare --pid --net --mount --ipc --fork /bin/bash -c "cargo check --workspace"
```

#### Verification Merge Gates

Sub-agent code branches cannot be merged into the main working tree until they satisfy the automated verification gate:
1. Compiler check: `cargo check --workspace` or language equivalent must return exit code `0`.
2. Test suite check: `cargo test --workspace` must return exit code `0` with 0 failures.
3. Static lint check: `cargo clippy --workspace -- -D warnings` must return exit code `0`.
4. If any gate fails, the merge is rejected and a compensating rollback is initiated.

---

### 4.3 Feature 33: Local MCP Process Supervisor, Feature 34: STDIO Supervision, Feature 35: SSE Transport, & Feature 36: Tool Allowlist

#### Architecture

The local MCP supervisor manages external tools across two transport mechanisms:
1. **STDIO Transport:** Spawns local child processes with bidirectional JSON-RPC 2.0 framing over standard input and standard output.
2. **SSE Transport:** Connects to remote or local HTTP Server-Sent Events endpoints for streaming tool execution.

#### Crash-Loop Watchdog & Circuit Breaker

- **Crash-Loop Threshold:** If an MCP process crashes 3 times within 10 seconds, the supervisor marks it degraded and applies exponential backoff ($2^n \times 1\text{ s}$).
- **Circuit Breaker:** Opens after 5 consecutive request timeouts ($10\text{ s}$ per request).

#### Capability Tool Allowlist

The supervisor evaluates each tool invocation against a whitelist:
- Default allowed tools: `fs_read`, `fs_list`, `git_status`, `git_diff`.
- Sensitive tools requiring explicit security authorization: `shell_exec`, `fs_write`, `fs_delete`.
- Blocked tools: Raw disk partition access, network interface re-configuration.

---

### 4.4 Feature 37: X11 Display `:1` Virtual Stack, Feature 38: picom Compositor, Feature 39: Standard Launcher Scripts, & Feature 40: Crash-Loop Defenses & Orphan Reaping

#### X11 Display `:1` Stack Configuration

- **Virtual Framebuffer (Xvfb):**
  ```bash
  Xvfb :1 -screen 0 1280x800x24 -ac +extension GLX +render -noreset
  ```
- **Window Manager (xfwm4):**
  ```bash
  xfwm4 --compositor=off --display=:1
  ```
- **Compositor (picom):**
  ```bash
  picom --display :1 --backend xrender --no-vsync --no-frame-pacing --no-use-damage
  ```
- **RFB VNC Server (x11vnc):**
  ```bash
  x11vnc -display :1 -rfbport 5900 -noxdamage -shared -forever -localhost -nopw
  ```
- **WebSocket Bridge (websockify):**
  ```bash
  websockify --web=/usr/share/novnc --heartbeat=30 127.0.0.1:6080 127.0.0.1:5900
  ```

#### Standard Launcher Script Contracts

| Launcher Script | Path | Standard Contract & Invocation Flags |
|---|---|---|
| `chrome-launcher` | `/usr/local/bin/chrome-launcher` | Launches Google Chrome maximized on `:1` with `--no-sandbox --disable-dev-shm-usage --password-store=basic --remote-debugging-port=9222 '<url>'`. Reuses existing window if already running. |
| `terminal-launcher` | `/usr/local/bin/terminal-launcher` | Launches XFCE Terminal maximized with 120x40 geometry and custom prompt `user@frostfire:~$`. |
| `files-launcher` | `/usr/local/bin/files-launcher` | Launches Thunar file manager centered on `/home/box/workspace`. |

#### Crash-Loop Defenses & Stale Lock Cleanup

Prior to starting services on Display `:1`, the supervisor executes orphan reaping:
1. Removes stale locks: `/tmp/.X1-lock` and `/tmp/.X11-unix/X1`.
2. Inspects port 5900 and terminates any zombie processes holding the socket.
3. Kills orphaned picom processes holding the `_NET_WM_CM_S0` window manager selection.
4. Registers the supervisor as a subreaper via `prctl(PR_SET_CHILD_SUBREAPER, 1)` to automatically reap zombie child processes.

---

## Section 5: Requirement 4 — Desktop Client & Host Security Rails (Area 3)

### 5.1 Feature 41: Tiered Host Security Permission Engine, Feature 42: Workspace Read Rails, & Feature 43: Native Modal Approval Gates

#### Three-Tier Permission Matrix

The desktop application enforces a strict security perimeter protecting the user's host workstation:

```
[ Agent Tool Execution Request ]
               │
               ▼
   [ Path & Action Classification ]
               │
               ├── TIER 1: Auto-Allowed ────────────► Execute Tool Action
               │   • Read file inside workspace root
               │   • List directories inside workspace
               │   • Git status / diff
               │
               ├── TIER 2: Modal Approval Required ─► Present Native Tauri Dialog
               │   • Host clipboard read/write       │
               │   • Write/delete file in workspace  ├─► User Approves ──► Execute
               │   • Read file outside workspace     │
               │   • Execute host shell command      └─► User Denies ────► Reject & Abort
               │
               └── TIER 3: Blocked ─────────────────► Immediately Reject (Access Denied)
                   • Access to /dev, /etc/shadow
                   • Modification of system binaries
                   • Raw network socket creation
```

Modal approvals enforce strict fail-closed security: if `timeout_unix_ms` expires before the user renders a decision, the approval controller automatically generates an `ApprovalResponse` with `approved: false` and `decision: "deny"`.

#### WorkspaceJail Path Canonicalization

```rust
use std::path::{Path, PathBuf};

pub struct WorkspaceJail {
    root_path: PathBuf,
}

impl WorkspaceJail {
    pub fn new(root_path: PathBuf) -> Self {
        Self {
            root_path: root_path.canonicalize().unwrap_or(root_path),
        }
    }

    /// Validates whether a requested path resides strictly within the workspace jail root.
    /// Safely supports both existing paths and brand new files created via write tools or patches.
    pub fn is_contained(&self, requested_path: &Path) -> bool {
        // If the path already exists on disk, canonicalize directly
        if requested_path.exists() {
            if let Ok(canonical) = requested_path.canonicalize() {
                return canonical.starts_with(&self.root_path);
            }
            return false;
        }

        // For non-existent target files, canonicalize closest existing ancestor directory
        let mut ancestor = requested_path;
        let mut trailing_components = Vec::new();
        while let Some(parent) = ancestor.parent() {
            if let Some(file_name) = ancestor.file_name() {
                trailing_components.push(file_name);
            }
            if parent.exists() {
                if let Ok(canonical_parent) = parent.canonicalize() {
                    if !canonical_parent.starts_with(&self.root_path) {
                        return false;
                    }
                    // Ensure trailing path components contain no directory traversal ('..' or '.')
                    return trailing_components.iter().all(|c| *c != ".." && *c != ".");
                }
                return false;
            }
            ancestor = parent;
        }
        false
    }
}
```

#### Persistent Permission Whitelist Schema (`.frostfire/permissions.json`)

```json
{
  "version": "1.0.0",
  "workspace_root": "c:\\Users\\tyson\\.repo\\personal\\frostfire",
  "rules": [
    {
      "rule_id": "rule_01JCV9Z",
      "action_type": "clipboard_read",
      "target_resource": "*",
      "permission": "grant_always",
      "created_at_unix_ms": 1757689200000
    },
    {
      "rule_id": "rule_01JCV9X",
      "action_type": "fs_write",
      "target_resource": "src/**/*.rs",
      "permission": "grant_always",
      "created_at_unix_ms": 1757689200000
    }
  ]
}
```

---

### 5.2 Feature 44: Dynamic Screen Context Injector & Feature 45: Screen Context Injection Grammar

#### Platform Window Query Engines

The dynamic screen context injector runs as a local background thread on the client machine:
- **Windows:** Queries `GetForegroundWindow()`, `GetWindowTextW()`, and `GetWindowRect()`.
- **macOS:** Queries `CGWindowListCopyWindowInfo()` for active app name and bounds.
- **Linux:** Inspects `_NET_ACTIVE_WINDOW` via X11 / Wayland IPC.

#### Structured Context Injection Grammar

Before each agent prompt turn is dispatched, the client prepends the structured XML block:

```xml
<screen_context>
  <focused_application>Visual Studio Code</focused_application>
  <window_title>frostfire — src/lib.rs</window_title>
  <viewport width="1920" height="1080" dpi_scale="1.0" />
  <display_slot index="1" resolution="1280x800" />
</screen_context>
```

---

### 5.3 Feature 46: Multiplexed Client Transport Manager, Feature 47: Terminal ANSI Card Rendering, & Feature 48: Secure noVNC Canvas Rendering

#### Multiplexed Client Transport Manager

A single TLS 1.3 connection to the Central Gateway handles three concurrent data streams:
1. **Chat Stream:** Bi-directional JSON/Protobuf turn messages.
2. **Terminal Stream:** Real-time ANSI chunks mapped to virtual PTY cards.
3. **Display Stream:** Authenticated noVNC binary WebSocket channel.

#### Terminal ANSI Card Rendering

The frontend component parses ANSI escape sequences into semantic React styles:
- 16 standard ANSI colors + 256 color palette + 24-bit TrueColor.
- Preserves carriage returns (`\r`) and cursor movement sequences.
- Maintains a 1,000-line virtual scroll buffer.

#### Secure noVNC Canvas Rendering

Unlike standard insecure implementations that embed an unauthenticated HTTP iframe:
- The desktop client connects directly to the authenticated tunnel display channel.
- Decodes RFB 3.8 raw framebuffer rectangles directly onto an HTML5 `<canvas>` element.
- Enforces `x-frostfire-window-owner` header validation on the WebSocket upgrade handshake.

---

## Section 6: Requirement 5 — Verification Harnesses & Sagas

### 6.1 Feature 49: Subsystem Programmatic Verification Suite

Every subsystem across Areas 1, 2, and 3 is validated by automated verification gates asserting exit codes, schemas, and performance SLOs:

| Subsystem | Target Component | Verifier Execution Command | Expected Exit Code | Quantitative SLO / Latency Ceiling |
|---|---|---|---|---|
| **Area 1: MicroVM** | Agent Turn Engine | `cargo test -p frostfire-engine --test turn_loop` | Exit `0` | Full turn loop execution $< 500\text{ ms}$ |
| **Area 1: MicroVM** | Worktree & Cgroup | `bash /usr/local/bin/test-worktree-cgroup.sh` | Exit `0` | Sub-agent spawn & worktree setup $< 200\text{ ms}$ |
| **Area 1: MicroVM** | Display & Scrot | `python3 tests/e2e/tier1/test_scrot_capture.py` | Exit `0` | Frame capture & SHA-256 calculation $< 150\text{ ms}$ |
| **Area 2: Gateway** | Tunnel Streaming | `cargo test -p frostfire-tunnel --test stream_multiplex` | Exit `0` | Frame transit latency $< 20\text{ ms}$ |
| **Area 2: Gateway** | Constant-Time Auth | `cargo test -p frostfire-gateway --test auth_timing` | Exit `0` | Token comparison timing delta $< 5\text{ ns}$ |
| **Area 2: Gateway** | Redis Metering | `cargo test -p frostfire-gateway --test redis_metering` | Exit `0` | Deduction hot path latency $< 1\text{ ms}$ |
| **Area 3: Desktop** | Workspace Jail | `cargo test -p frostfire-exec --test jail_boundaries` | Exit `0` | Path canonicalization $< 2\text{ ms}$ |
| **Area 3: Desktop** | Modal Approval | `cargo test -p frostfire-os --test modal_approval` | Exit `0` | Event dispatch latency $< 15\text{ ms}$ |

---

### 6.2 Feature 50: Distributed Saga Rollback Policies & Compensating Actions

Distributed mutations across external systems (Git repositories, process runners, cloud storage, billing accounts) are orchestrated by a Saga Coordinator enforcing compensating rollbacks on partial failure:

```
[ Step 1: Forward Action ] ──(Success)──► [ Step 2: Forward Action ] ──(Failure)
                                                    │                         │
                                                    ▼                         ▼
                                           [ Retries Exhausted ]    [ Trigger Rollback ]
                                                    │                         │
                                                    ▼                         ▼
[ Compensating Action 1 ] ◄───────────────────────────────────── [ Compensating Action 2 ]
```

#### Compensating Action Mapping Table

| Execution Domain | Forward Action (Mutation) | Failure Condition | Compensating Rollback Action |
|---|---|---|---|
| **Git Worktree** | Allocate worktree at `/tmp/worktrees/<task_id>` | Compiler check or test suite failure | Execute idempotent teardown: `git worktree remove --force /tmp/worktrees/<task_id> 2>/dev/null || true`, prune stale references via `git worktree prune`, delete task branch `git branch -D task/<task_id> 2>/dev/null || true`, and purge directory `rm -rf /tmp/worktrees/<task_id>`. |
| **Code Patch** | Apply unified diff via `git apply` | Hunk collision or syntax error | Execute idempotent restoration: restore tracked files via `git checkout -- <file_path> 2>/dev/null || true` AND execute `git clean -fdx <file_path>` (or `rm -f <file_path>`) to guarantee newly created untracked files and build artifacts are completely removed. |
| **Process Spawner** | Spawn child process in cgroup slice | Fork failure or child crash | Terminate cgroup processes via `cgroup.kill` (`echo 1 > /sys/fs/cgroup/agent/task_<task_id>/cgroup.kill`) or `SIGTERM`/`SIGKILL` to all PIDs in `cgroup.procs`, reap zombie children via `waitpid()`, confirm `cgroup.events` is `populated 0`, and remove cgroup directory. |
| **SaaS Metering** | Deduct estimated tokens from Redis balance | Upstream LLM provider returns 5xx error | Execute atomic refund Lua script: increment `tenant:{id}:credits balance` AND atomically decrement `tenant:{id}:unbilled_tokens` (`total_micro_cents`, `input`, `output`) by the refunded amount so failed turns are not billed to Stripe during the 60-second flush loop. If already flushed, record a negative credit adjustment. |
| **S3 Snapshot** | Upload COLD memory state archive | Network disconnect or S3 timeout | Abort multipart upload via `s3.abort_multipart_upload`, purge temporary local archive chunks on disk, and unpin staging memory buffers. |

---

## Section 7: Summary & Architectural Sign-Off

This specification establishes the authoritative, binding systems blueprint for the Frostfire platform. All implementations in Milestone 2 (Review & Challenge Gates) and Milestone 3 (Forensic Audit Verification) must comply fully with the schemas, structs, DDL, Lua scripts, and invariants codified herein.
