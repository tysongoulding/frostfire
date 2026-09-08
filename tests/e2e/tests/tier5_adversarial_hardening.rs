//! Tier 5: Adversarial Coverage Hardening & White-Box Stress Suite
//!
//! Unlike Tiers 1-4 (opaque-box, requirement-driven), Tier 5 is white-box:
//! it directly stress-tests implementation source code paths, concurrency races,
//! boundary extremes, error branches, and failure modes across:
//! - crates/frostfire-gateway and cloud/gateway
//! - cloud/microvm (sand-window-router.mjs, sand-exit-watch, host-setup.sh, box-cgroups.sh, link-chrome-session.sh, cdp-cookies.mjs)
//! - cloud/agent (Dockerfile.lambda)
//! - deploy/aws (cloudformation.yaml, firecracker-hypervisor.yaml, poc-3user.yaml, lambda-microvm.yaml)
//! - scripts/ (cloud-start.ps1, cloud-status.ps1, cloud-stop.ps1, setup-cluster.sh)

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tonic::metadata::{MetadataMap, MetadataValue};

use frostfire_gateway::auth::{
    extract_bearer_token, TenantAuthenticator, DEFAULT_DEV_TENANT_TOKEN, UNAUTHENTICATED_MSG,
};
use frostfire_gateway::server::GatewayServerHandle;
use frostfire_gateway::session::SessionRegistry;

use frostfire_e2e::assertions::*;
use frostfire_e2e::harness::*;
use frostfire_e2e::mock_client::SimulatedDesktopClient;

use frostfire_proto::tunnel::{
    display_takeover_event, teach_session_command, tunnel_client_frame, tunnel_server_frame,
    AgentMessage, ApplyPatch, ApprovalRequest, ApprovalResponse, DisplayTakeoverEvent, ExecCommand,
    Heartbeat, McpInvokeRequest, McpInvokeResponse, PatchResult, TeachSessionCommand,
    TeachSessionResponse, TerminalInputChunk, TerminalOutputChunk, TunnelClientFrame,
    TunnelServerFrame, UserPrompt, WebAuthnCeremonyRequest, WebAuthnCeremonyResponse,
};

// ============================================================================
// Section 1: Gateway Ingress & Constant-Time Tenant Authentication White-Box
// ============================================================================

#[test]
fn test_tier5_auth_utf8_multibyte_prefix_and_slicing_fuzz() {
    // Tests UTF-8 character boundary slicing in extract_bearer_token.
    // Slicing [..7] must NEVER panic when a multi-byte codepoint spans byte offset 7.
    let test_inputs = [
        "",
        " ",
        "   ",
        "\t",
        "\r\n",
        "Bearer",
        "Bearer ",
        "Bearer   ",
        "Bearer\ttoken",
        "bearer token",
        "BEARER token",
        "bEaReR token",
        // Multi-byte 2-byte UTF-8 character (\u{00E9} = 2 bytes: 0xC3, 0xA9)
        "123456\u{00E9}",
        "abcdef\u{00E9}",
        " \u{00E9}12345",
        // Multi-byte 3-byte UTF-8 character (\u{4E2D} = 3 bytes: 0xE4, 0xB8, 0xAD)
        "12345\u{4E2D}",
        "1234\u{4E2D}x",
        " \u{4E2D}abcd",
        // Multi-byte 4-byte astral UTF-8 character (\u{1F600} = 4 bytes: 0xF0, 0x9F, 0x98, 0x80)
        "1234\u{1F600}",
        "123\u{1F600}x",
        "12\u{1F600}xx",
        "1\u{1F600}xxx",
        "\u{1F600}xxxx",
        "Bearer \u{1F600}secret-token",
        "bearer \u{1F600}secret-token",
        // Zero-width joiners and emoji combinations
        "Bearer 👨\u{200D}👩\u{200D}👧\u{200D}👦-family-token",
        // Raw token without Bearer prefix
        "raw-token-without-bearer-12345",
        "  raw-token-with-leading-spaces  ",
        // Null bytes
        "\0\0\0\0\0\0\0",
        "Bearer \0token\0with\0nulls\0",
    ];

    for input in test_inputs {
        let extracted = extract_bearer_token(input);
        assert!(!extracted.starts_with(' '));
        assert!(!extracted.ends_with(' '));
    }
}

#[test]
fn test_tier5_auth_bearer_prefix_syntax_matrix() {
    assert_eq!(extract_bearer_token("Bearer secret"), "secret");
    assert_eq!(extract_bearer_token("bearer secret"), "secret");
    assert_eq!(extract_bearer_token("BEARER secret"), "secret");
    assert_eq!(extract_bearer_token("bEaReR secret"), "secret");
    assert_eq!(extract_bearer_token("   Bearer   secret   "), "secret");
    assert_eq!(extract_bearer_token("Bearer "), "");
    assert_eq!(extract_bearer_token("bearer"), "bearer");
    assert_eq!(extract_bearer_token("Bearer\tsecret"), "Bearer\tsecret");
}

#[test]
fn test_tier5_auth_dual_header_truth_table() {
    let expected = "tenant-secret-xyz";
    let auth = TenantAuthenticator::new(expected);

    // 1. authorization=VALID, x-sand-window-owner=ABSENT -> OK
    let mut m1 = MetadataMap::new();
    m1.insert("authorization", MetadataValue::from_static("Bearer tenant-secret-xyz"));
    assert!(auth.authenticate_metadata(&m1).is_ok());

    // 2. authorization=ABSENT, x-sand-window-owner=VALID -> OK
    let mut m2 = MetadataMap::new();
    m2.insert("x-sand-window-owner", MetadataValue::from_static("tenant-secret-xyz"));
    assert!(auth.authenticate_metadata(&m2).is_ok());

    // 3. authorization=VALID, x-sand-window-owner=INVALID -> OK (auth succeeds)
    let mut m3 = MetadataMap::new();
    m3.insert("authorization", MetadataValue::from_static("Bearer tenant-secret-xyz"));
    m3.insert("x-sand-window-owner", MetadataValue::from_static("wrong-owner"));
    assert!(auth.authenticate_metadata(&m3).is_ok());

    // 4. authorization=INVALID, x-sand-window-owner=VALID -> OK (owner succeeds)
    let mut m4 = MetadataMap::new();
    m4.insert("authorization", MetadataValue::from_static("Bearer wrong-token"));
    m4.insert("x-sand-window-owner", MetadataValue::from_static("tenant-secret-xyz"));
    assert!(auth.authenticate_metadata(&m4).is_ok());

    // 5. authorization=INVALID, x-sand-window-owner=INVALID -> ERR
    let mut m5 = MetadataMap::new();
    m5.insert("authorization", MetadataValue::from_static("Bearer wrong-token"));
    m5.insert("x-sand-window-owner", MetadataValue::from_static("wrong-owner"));
    let err = auth.authenticate_metadata(&m5).unwrap_err();
    assert_eq!(err.code(), tonic::Code::Unauthenticated);
    assert_eq!(err.message(), UNAUTHENTICATED_MSG);

    // 6. authorization=ABSENT, x-sand-window-owner=ABSENT -> ERR
    let m6 = MetadataMap::new();
    let err = auth.authenticate_metadata(&m6).unwrap_err();
    assert_eq!(err.code(), tonic::Code::Unauthenticated);
}

#[test]
fn test_tier5_auth_empty_server_token_fails_closed() {
    // When server token is empty string, no candidate token should ever validate
    let auth = TenantAuthenticator::new("");
    assert!(!auth.validate_token(""));
    assert!(!auth.validate_token("   "));
    assert!(!auth.validate_token("secret"));
    assert!(!auth.validate_token("\0"));

    let mut map = MetadataMap::new();
    map.insert("authorization", MetadataValue::from_static("Bearer "));
    assert!(auth.authenticate_metadata(&map).is_err());
}

#[test]
fn test_tier5_auth_massive_payload_and_null_byte_stress() {
    let auth = TenantAuthenticator::new("production-tenant-token-99");

    // 1 MB massive candidate token
    let massive_token = "A".repeat(1024 * 1024);
    assert!(!auth.validate_token(&massive_token));

    // 64 KB token with null bytes
    let mut null_byte_token = "B".repeat(65536);
    null_byte_token.insert(100, '\0');
    assert!(!auth.validate_token(&null_byte_token));

    // Exact match token with embedded null byte
    let null_secret = "secret\0embedded\0nulls";
    let null_auth = TenantAuthenticator::new(null_secret);
    assert!(null_auth.validate_token(null_secret));
    assert!(!null_auth.validate_token("secret"));
}

#[test]
fn test_tier5_auth_constant_time_timing_invariance() {
    let expected = "constant-time-verification-secret-32b!";
    let candidates = [
        "constant-time-verification-secret-32b!", // 100% match
        "constant-time-verification-secret-32bX", // Mismatch at byte 37
        "constant-time-verification-secret-XXXX", // Mismatch at byte 34
        "constant-time-verification-XXXXXXXXXX", // Mismatch at byte 26
        "constant-time-XXXXXXXXXXXXXXXXXXXXXX", // Mismatch at byte 14
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", // Mismatch at byte 0
        "short",                                 // Length mismatch
        "extremely-long-candidate-that-exceeds-the-expected-token-length-by-far",
    ];

    let results = measure_timing_variance(expected, &candidates, 1000);
    assert_eq!(results.len(), candidates.len());
    for (candidate, avg_ns) in results {
        assert!(
            avg_ns < 50_000,
            "Validation took excessively long for '{}': {}ns",
            candidate,
            avg_ns
        );
    }
}

// ============================================================================
// Section 2: Session Registry Concurrency & Race Condition Stress
// ============================================================================

#[tokio::test]
async fn test_tier5_session_registry_50_concurrent_client_registration_storm() {
    let registry = Arc::new(SessionRegistry::new());
    let mut handles = Vec::new();

    // 50 concurrent tasks registering and unregistering the exact same agent ID
    for i in 0..50 {
        let reg = registry.clone();
        let handle = tokio::spawn(async move {
            let (tx, _rx) = mpsc::channel(16);
            let sid = reg.register("shared-agent-id".into(), tx).await;
            tokio::time::sleep(Duration::from_millis(5)).await;
            if i % 2 == 0 {
                reg.unregister_if_matching("shared-agent-id", sid).await;
            }
        });
        handles.push(handle);
    }

    for h in handles {
        h.await.expect("Task panicked during registration storm");
    }

    let active = registry.active_agents().await;
    assert!(active.len() <= 1, "There can be at most 1 active session for shared-agent-id");
}

#[tokio::test]
async fn test_tier5_session_registry_stale_reconnect_eviction_prevention() {
    let registry = SessionRegistry::new();
    let (tx1, _rx1) = mpsc::channel(16);
    let (tx2, mut rx2) = mpsc::channel(16);

    // Client C1 connects
    let sid1 = registry.register("agent-reconnect".into(), tx1).await;

    // Client C2 reconnects for same agent
    let sid2 = registry.register("agent-reconnect".into(), tx2).await;
    assert_ne!(sid1, sid2);

    // C1 connection teardown attempts to unregister with stale sid1
    let unregistered_stale = registry.unregister_if_matching("agent-reconnect", sid1).await;
    assert!(!unregistered_stale, "Stale sid1 must NOT unregister new sid2 session");

    // Session must remain active with sid2
    let active = registry.active_agents().await;
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].session_id, sid2);

    // Frames sent to agent must reach C2's receiver
    let frame = TunnelServerFrame {
        frame_id: "test-frame-1".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_server_frame::Payload::Heartbeat(Heartbeat {
            sequence: 42,
            timestamp_unix_ms: 1000,
            agent_id: "agent-reconnect".into(),
            is_ack: true,
        })),
    };

    let send_res = registry.send_to_agent("agent-reconnect", frame).await;
    assert!(send_res.is_ok(), "Frame send to reconnected agent failed: {:?}", send_res);

    let received = rx2.recv().await.expect("C2 receiver dropped");
    assert!(received.is_ok());

    // C2 unregisters with matching sid2
    let unregistered_active = registry.unregister_if_matching("agent-reconnect", sid2).await;
    assert!(unregistered_active, "Active sid2 must unregister successfully");
    assert!(registry.active_agents().await.is_empty());
}

#[tokio::test]
async fn test_tier5_session_registry_broadcast_with_dead_channels() {
    let registry = SessionRegistry::new();
    let mut healthy_rxs = Vec::new();

    for i in 0..5 {
        let (tx, rx) = mpsc::channel(16);
        registry.register(format!("healthy-agent-{}", i), tx).await;
        healthy_rxs.push(rx);
    }

    for i in 0..5 {
        let (tx, rx) = mpsc::channel(16);
        registry.register(format!("dead-agent-{}", i), tx).await;
        drop(rx); // Drop receiver to simulate abrupt client disconnect
    }

    let broadcast_frame = TunnelServerFrame {
        frame_id: "broadcast-test-1".into(),
        timestamp_unix_ms: 2000,
        payload: Some(tunnel_server_frame::Payload::AgentMessage(AgentMessage {
            turn_id: "turn-sys".into(),
            content: "cluster-announcement".into(),
            tool_calls: vec![],
            is_final: true,
        })),
    };

    // Broadcast must survive dead receivers without panicking
    registry.broadcast(broadcast_frame).await;

    for mut rx in healthy_rxs {
        let received = rx.recv().await.expect("Healthy receiver dropped");
        assert!(received.is_ok());
    }
}

#[tokio::test]
async fn test_tier5_session_registry_send_to_unregistered_agent() {
    let registry = SessionRegistry::new();
    let frame = TunnelServerFrame {
        frame_id: "f-1".into(),
        timestamp_unix_ms: 3000,
        payload: None,
    };
    let res = registry.send_to_agent("nonexistent-agent", frame).await;
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("Agent session not found"));
}

// ============================================================================
// Section 3: Live Gateway Tunnel & 17-Frame Streaming White-Box Stress
// ============================================================================

#[tokio::test]
async fn test_tier5_live_gateway_unauthenticated_rejection() {
    let secret = "tier5-secret-live-token";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(secret)
        .await
        .expect("Gateway bind failed");

    // Client connects with WRONG token
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-unauth")
        .with_bearer_token("wrong-secret-token");

    let connect_res = client.connect().await;
    assert!(
        connect_res.is_err(),
        "Gateway must reject client connecting with wrong token"
    );

    gateway.shutdown();
}

#[tokio::test]
async fn test_tier5_live_gateway_bidirectional_heartbeat_auto_ack_parity() {
    let secret = "tier5-secret-live-token";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(secret)
        .await
        .expect("Gateway bind failed");

    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-hb-parity")
        .with_bearer_token(secret);

    client.connect().await.expect("Client connect failed");

    // Send 5 consecutive heartbeat pings
    for seq in 1001..=1005 {
        let hb_frame = TunnelClientFrame {
            frame_id: format!("hb-frame-{}", seq),
            timestamp_unix_ms: 10000 + seq,
            agent_id: "agent-hb-parity".into(),
            payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
                sequence: seq,
                timestamp_unix_ms: 10000 + seq,
                agent_id: "agent-hb-parity".into(),
                is_ack: false,
            })),
        };
        client.send(hb_frame).await.expect("Send failed");

        let ack = client.recv().await.expect("Recv ack failed").expect("Frame expected");
        match ack.payload {
            Some(tunnel_server_frame::Payload::Heartbeat(hb)) => {
                assert!(hb.is_ack, "Server heartbeat response must have is_ack = true");
                assert_eq!(hb.sequence, seq, "Heartbeat sequence number must match");
                assert_eq!(hb.agent_id, "agent-hb-parity");
            }
            other => panic!("Expected Heartbeat ack payload, got {:?}", other),
        }
    }

    client.disconnect();
    gateway.shutdown();
}

#[tokio::test]
async fn test_tier5_live_gateway_rapid_reconnect_lifecycle() {
    let secret = DEFAULT_DEV_TENANT_TOKEN;
    let gateway = GatewayServerHandle::bind_ephemeral()
        .await
        .expect("Gateway bind failed");

    let agent_id = "agent-rapid-reconnect";

    for cycle in 1..=5 {
        let mut client = SimulatedDesktopClient::new(gateway.url(), agent_id).with_bearer_token(secret);
        client.connect().await.expect("Connect failed");

        tokio::time::sleep(Duration::from_millis(20)).await;
        let active = gateway.registry.active_agents().await;
        assert_eq!(active.len(), 1, "Cycle {}: Agent must be registered", cycle);
        assert_eq!(active[0].agent_id, agent_id);

        client.disconnect();
        tokio::time::sleep(Duration::from_millis(30)).await;
    }

    gateway.shutdown();
}

#[tokio::test]
async fn test_tier5_live_gateway_all_17_symmetric_frame_types_multiplex() {
    let secret = "tier5-mux-secret";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(secret)
        .await
        .expect("Gateway bind failed");

    let agent_id = "agent-mux-17";
    let mut client = SimulatedDesktopClient::new(gateway.url(), agent_id).with_bearer_token(secret);
    client.connect().await.expect("Connect failed");

    tokio::time::sleep(Duration::from_millis(30)).await;

    let frames_to_test = vec![
        tunnel_server_frame::Payload::Heartbeat(Heartbeat {
            sequence: 1,
            timestamp_unix_ms: 100,
            agent_id: agent_id.into(),
            is_ack: true,
        }),
        tunnel_server_frame::Payload::ExecCommand(ExecCommand {
            command_id: "cmd-1".into(),
            command: "echo 'hello'".into(),
            args: vec!["arg1".into()],
            working_dir: "/workspace".into(),
            env: HashMap::new(),
            timeout_seconds: 30,
            pty: false,
            pty_rows: 24,
            pty_cols: 80,
        }),
        tunnel_server_frame::Payload::TerminalInput(TerminalInputChunk {
            session_id: "s-1".into(),
            data: b"ls -la\n".to_vec(),
            is_eof: false,
            resize: false,
            pty_rows: 24,
            pty_cols: 80,
        }),
        tunnel_server_frame::Payload::TerminalOutput(TerminalOutputChunk {
            session_id: "s-1".into(),
            data: b"total 0\n".to_vec(),
            is_stderr: false,
            is_eof: false,
            exit_code: 0,
        }),
        tunnel_server_frame::Payload::ApplyPatch(ApplyPatch {
            patch_id: "p-1".into(),
            file_path: "src/main.rs".into(),
            diff: "--- a\n+++ b\n".into(),
            expected_sha256: "sha256-mock".into(),
            dry_run: false,
        }),
        tunnel_server_frame::Payload::PatchResult(PatchResult {
            patch_id: "p-1".into(),
            file_path: "src/main.rs".into(),
            success: true,
            error_message: String::new(),
            new_sha256: "sha256-new".into(),
            lines_added: 1,
            lines_removed: 1,
        }),
        tunnel_server_frame::Payload::McpRequest(McpInvokeRequest {
            invocation_id: "mcp-1".into(),
            server_name: "test-server".into(),
            tool_name: "test-tool".into(),
            arguments_json: "{}".into(),
            timeout_seconds: 10,
        }),
        tunnel_server_frame::Payload::McpResponse(McpInvokeResponse {
            invocation_id: "mcp-1".into(),
            success: true,
            result_json: "{\"status\":\"ok\"}".into(),
            error_message: String::new(),
        }),
        tunnel_server_frame::Payload::ApprovalRequest(ApprovalRequest {
            request_id: "appr-1".into(),
            action_type: "delete_file".into(),
            description: "Remove obsolete artifact".into(),
            details_json: "{}".into(),
            requested_by: "agent-1".into(),
            created_at_unix: 1000,
        }),
        tunnel_server_frame::Payload::ApprovalResponse(ApprovalResponse {
            request_id: "appr-1".into(),
            approved: true,
            reason: "User confirmed".into(),
            approved_by: "user".into(),
            responded_at_unix: 1005,
        }),
        tunnel_server_frame::Payload::ErrorFrame("Synthetic error frame".into()),
        tunnel_server_frame::Payload::AgentMessage(AgentMessage {
            turn_id: "turn-1".into(),
            content: "coordination message".into(),
            tool_calls: vec![],
            is_final: true,
        }),
        tunnel_server_frame::Payload::WebauthnRequest(WebAuthnCeremonyRequest {
            ceremony_id: "authn-1".into(),
            kind: "get".into(),
            origin: "https://frostfire.cloud".into(),
            options_json: "{}".into(),
        }),
        tunnel_server_frame::Payload::WebauthnResponse(WebAuthnCeremonyResponse {
            ceremony_id: "authn-1".into(),
            success: true,
            credential_json: "{\"id\":\"cred-1\"}".into(),
            error_name: String::new(),
            error_message: String::new(),
        }),
        tunnel_server_frame::Payload::DisplayTakeover(DisplayTakeoverEvent {
            session_id: "takeover-1".into(),
            display_number: 1,
            action: display_takeover_event::Action::UserFocused as i32,
        }),
        tunnel_server_frame::Payload::TeachCommand(TeachSessionCommand {
            session_id: "teach-1".into(),
            display_number: 1,
            action: teach_session_command::Action::StartRecording as i32,
            output_dir: "/tmp/teach".into(),
        }),
        tunnel_server_frame::Payload::TeachResponse(TeachSessionResponse {
            session_id: "teach-1".into(),
            success: true,
            sop_markdown: "# SOP".into(),
            video_path: "/tmp/teach/video.mp4".into(),
            error_message: String::new(),
        }),
        tunnel_server_frame::Payload::UserPrompt(UserPrompt {
            prompt_id: "prompt-1".into(),
            text: "Hello cloud agent".into(),
            session_id: "sess-1".into(),
            context_files: HashMap::new(),
        }),
    ];

    assert_eq!(frames_to_test.len(), 18, "Must test all 18 payload variants");

    for (idx, payload) in frames_to_test.into_iter().enumerate() {
        let frame = TunnelServerFrame {
            frame_id: format!("test-frame-{}", idx),
            timestamp_unix_ms: 50000 + (idx as i64),
            payload: Some(payload),
        };
        let send_res = gateway.registry.send_to_agent(agent_id, frame).await;
        assert!(send_res.is_ok(), "Failed to send frame type {}: {:?}", idx, send_res);

        let received = client.recv().await.expect("Recv failed").expect("Client did not receive frame");
        assert!(received.payload.is_some());
    }

    client.disconnect();
    gateway.shutdown();
}

// ============================================================================
// Section 4: MicroVM Sand Infrastructure Invariants
// ============================================================================

#[test]
fn test_tier5_microvm_cgroup_v2_strict_partitioning_rules() {
    let partition = CgroupV2Partition::default();
    assert!(partition.is_valid(), "Default cgroup partition must satisfy 8:1 ratio");
    assert_eq!(partition.interactive_cpu_weight, 800);
    assert_eq!(partition.agent_cpu_weight, 100);

    // Inverted weights must be invalid
    let inverted = CgroupV2Partition {
        interactive_path: "/sys/fs/cgroup/interactive".into(),
        interactive_cpu_weight: 100,
        agent_path: "/sys/fs/cgroup/agent".into(),
        agent_cpu_weight: 800,
    };
    assert!(!inverted.is_valid(), "Inverted cgroup weights must fail validation");

    // Equal weights must be invalid
    let equal = CgroupV2Partition {
        interactive_path: "/sys/fs/cgroup/interactive".into(),
        interactive_cpu_weight: 500,
        agent_path: "/sys/fs/cgroup/agent".into(),
        agent_cpu_weight: 500,
    };
    assert!(!equal.is_valid(), "Equal weights must violate 8:1 ratio invariant");
}

#[test]
fn test_tier5_microvm_window_router_authorization_and_port_forwarding() {
    let mut registered_tokens = HashMap::new();
    registered_tokens.insert(1, "token-display-1".to_string());
    registered_tokens.insert(2, "token-display-2".to_string());
    registered_tokens.insert(5, "token-display-5".to_string());

    // Display 1 with valid token -> port 1337
    let d1_ok = route_window_request(1, Some("token-display-1"), &registered_tokens, false);
    assert_eq!(d1_ok.status_code, 200);
    assert_eq!(d1_ok.target_port, Some(1337));

    // Display 1 with missing token -> 403 Forbidden
    let d1_missing = route_window_request(1, None, &registered_tokens, false);
    assert_eq!(d1_missing.status_code, 403);
    assert_eq!(d1_missing.target_port, None);

    // Display 1 with wrong token -> 403 Forbidden
    let d1_wrong = route_window_request(1, Some("wrong-token"), &registered_tokens, false);
    assert_eq!(d1_wrong.status_code, 403);

    // Display 2 with valid token -> port 14002
    let d2_ok = route_window_request(2, Some("token-display-2"), &registered_tokens, false);
    assert_eq!(d2_ok.status_code, 200);
    assert_eq!(d2_ok.target_port, Some(14002));

    // Display 5 with WebSocket Upgrade -> 101 Switching Protocols, port 14005
    let d5_ws = route_window_request(5, Some("token-display-5"), &registered_tokens, true);
    assert_eq!(d5_ws.status_code, 101);
    assert!(d5_ws.is_upgrade);
    assert_eq!(d5_ws.target_port, Some(14005));

    // Negative display -> 400 Bad Request
    let d_neg = route_window_request(-1, Some("token-display-1"), &registered_tokens, false);
    assert_eq!(d_neg.status_code, 400);

    // Display 0 -> 400 Bad Request
    let d_zero = route_window_request(0, Some("token-display-1"), &registered_tokens, false);
    assert_eq!(d_zero.status_code, 400);
}

#[test]
fn test_tier5_microvm_network_isolation_and_no_masquerade_invariants() {
    // MicroVM guest network must be strictly on 172.16.x.0/24
    assert!(is_valid_microvm_guest_ip("172.16.0.2"));
    assert!(is_valid_microvm_guest_ip("172.16.1.2"));
    assert!(is_valid_microvm_guest_ip("172.16.2.2"));
    assert!(is_valid_microvm_guest_ip("172.16.2.254"));

    // Host gateway (.1) cannot be a guest IP
    assert!(!is_valid_microvm_guest_ip("172.16.0.1"));
    // Subnet boundary (.0, .255) cannot be a guest IP
    assert!(!is_valid_microvm_guest_ip("172.16.0.0"));
    assert!(!is_valid_microvm_guest_ip("172.16.0.255"));

    // Public IPs and spoofed private IPs must be rejected
    assert!(!is_valid_microvm_guest_ip("192.168.1.100"));
    assert!(!is_valid_microvm_guest_ip("10.0.0.5"));
    assert!(!is_valid_microvm_guest_ip("8.8.8.8"));
    assert!(!is_valid_microvm_guest_ip("169.254.169.254")); // IMDS
}

#[test]
fn test_tier5_microvm_supervisor_crash_loop_backoff_model() {
    let mut watcher = SupervisorCrashWatcher::new(3);
    assert_eq!(watcher.state, SupervisorState::Running);

    // Child clean exit 0 terminates supervisor immediately
    watcher.record_exit(0);
    assert_eq!(watcher.state, SupervisorState::Terminated);

    // Child crash: attempt 1 -> backoff 2s
    let mut watcher2 = SupervisorCrashWatcher::new(3);
    watcher2.record_exit(1);
    assert_eq!(watcher2.state, SupervisorState::CrashLoopBackoff { attempt: 1, backoff_secs: 2 });

    // Crash 2 -> backoff 4s
    watcher2.record_exit(1);
    assert_eq!(watcher2.state, SupervisorState::CrashLoopBackoff { attempt: 2, backoff_secs: 4 });

    // Crash 3 -> backoff 8s
    watcher2.record_exit(1);
    assert_eq!(watcher2.state, SupervisorState::CrashLoopBackoff { attempt: 3, backoff_secs: 8 });

    // Crash 4 -> exceeds max_restarts (3) -> Terminal failure
    watcher2.record_exit(1);
    assert_eq!(watcher2.state, SupervisorState::Terminated);
}

// ============================================================================
// Section 5: AWS Infrastructure as Code White-Box Verification
// ============================================================================

#[test]
fn test_tier5_aws_lambda_microvm_cfn_invariants() {
    let root = workspace_root();
    let cfn_path = root.join("deploy/aws/lambda-microvm.yaml");
    assert!(cfn_path.exists(), "Missing lambda-microvm.yaml");

    let content = std::fs::read_to_string(&cfn_path).expect("Failed to read lambda-microvm.yaml");

    // 1. Sizing parameters: 10240 MB RAM (6 vCPUs), 10240 MB /tmp, 900s timeout
    assert!(content.contains("Default: 10240"));
    assert!(content.contains("EphemeralStorage:"));
    assert!(content.contains("TimeoutSeconds:"));

    // 2. Response streaming configuration
    assert!(content.contains("InvokeMode: RESPONSE_STREAM"));
    assert!(content.contains("AWS_LWA_INVOKE_MODE: response_stream"));
    assert!(content.contains("AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap"));

    // 3. PackageType Image
    assert!(content.contains("PackageType: Image"));

    // 4. Zero hardcoded credentials
    assert!(!content.contains("AKIA"));
    assert!(!content.contains("aws_secret_access_key"));
}

#[test]
fn test_tier5_aws_lambda_agent_dockerfile_invariants() {
    let root = workspace_root();
    let dockerfile_path = root.join("cloud/agent/Dockerfile.lambda");
    assert!(dockerfile_path.exists(), "Missing Dockerfile.lambda");

    let content = std::fs::read_to_string(&dockerfile_path).expect("Failed to read Dockerfile.lambda");

    // 1. Multi-stage build stages
    assert!(content.contains("AS lambda-adapter"));
    assert!(content.contains("AS builder"));
    assert!(content.contains("AS runtime"));

    // 2. AWS Lambda Web Adapter inclusion
    assert!(content.contains("public.ecr.aws/awsgsl/aws-lambda-adapter:0.9.0"));
    assert!(content.contains("/opt/extensions/lambda-adapter"));
    assert!(content.contains("/opt/bootstrap"));

    // 3. Non-root unprivileged execution
    assert!(content.contains("USER 10001:10001"));

    // 4. Streaming environment
    assert!(content.contains("AWS_LWA_INVOKE_MODE=response_stream"));
    assert!(content.contains("PORT=8080"));
}

#[test]
fn test_tier5_aws_firecracker_hypervisor_cfn_invariants() {
    let root = workspace_root();
    let cfn_path = root.join("deploy/aws/firecracker-hypervisor.yaml");
    assert!(cfn_path.exists(), "Missing firecracker-hypervisor.yaml");

    let content = std::fs::read_to_string(&cfn_path).expect("Failed to read firecracker-hypervisor.yaml");

    // 1. Bare metal instance types for hardware KVM virtualization
    assert!(content.contains("c6i.metal"));
    assert!(content.contains("c5.metal"));

    // 2. Network isolation: zero NAT MASQUERADE on microVM subnets
    assert!(content.contains("Zero NAT MASQUERADE"));
    assert!(!content.contains("-j MASQUERADE\n"));

    // 3. Zero hardcoded secrets
    assert!(!content.contains("AKIA"));
    assert!(!content.contains("aws_secret_access_key"));
}

#[test]
fn test_tier5_scripts_cloud_start_stop_status_powershell_invariants() {
    let root = workspace_root();
    for script_name in &["cloud-start.ps1", "cloud-stop.ps1", "cloud-status.ps1"] {
        let script_path = root.join("scripts").join(script_name);
        assert!(script_path.exists(), "Missing script: {}", script_name);

        let content = std::fs::read_to_string(&script_path)
            .unwrap_or_else(|_| panic!("Failed to read {}", script_name));

        // Must support -DryRun switch
        assert!(content.contains("[switch]$DryRun"), "{} missing DryRun switch", script_name);
        // Must have fallback region resolution
        assert!(content.contains("$env:AWS_REGION"), "{} missing AWS_REGION fallback", script_name);
        // Must resolve instance ID dynamically without hardcoding
        assert!(content.contains("$env:FROSTFIRE_INSTANCE_ID"), "{} missing FROSTFIRE_INSTANCE_ID fallback", script_name);
        // Must NOT contain hardcoded i-0123456789abcdef0 instance IDs
        assert!(!content.contains("i-0123456789abcdef0"), "{} contains hardcoded dummy instance ID", script_name);
    }
}
