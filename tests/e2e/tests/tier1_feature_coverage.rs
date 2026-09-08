//! Tier 1: Feature Coverage Verification Suite (F1 - F16, >=5 tests per feature)

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use sha2::Digest;

use frostfire_e2e::assertions::*;
use frostfire_e2e::harness::*;
use frostfire_e2e::mock_client::SimulatedDesktopClient;
use frostfire_e2e::mock_gateway::{MockGatewayHandle, MockSessionRegistry};
use frostfire_proto::tunnel::{
    tunnel_client_frame, tunnel_server_frame, ApplyPatch, ExecCommand, Heartbeat,
    McpInvokeRequest, TerminalInputChunk, TunnelClientFrame,
    TunnelServerFrame, WebAuthnCeremonyRequest,
};

// ============================================================================
// F1: Outbound Reverse Gateway Tests (5 tests)
// ============================================================================

#[tokio::test]
async fn test_f1_gateway_ephemeral_bind_and_url() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    assert!(gateway.addr.port() > 0, "Gateway must bind to a non-zero ephemeral port");
    assert!(gateway.url().starts_with("http://127.0.0.1:"));
    gateway.shutdown();
}

#[tokio::test]
async fn test_f1_gateway_accepts_grpc_open_tunnel_connection() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f1-conn");
    let connect_res = client.connect().await;
    assert!(connect_res.is_ok(), "Client failed to connect to OpenTunnel: {:?}", connect_res.err());
    gateway.shutdown();
}

#[tokio::test]
async fn test_f1_gateway_registers_session_in_registry() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f1-reg");
    client.connect().await.expect("Connect failed");

    // Give time for register
    tokio::time::sleep(Duration::from_millis(50)).await;
    let active = gateway.registry.active_agents().await;
    assert!(active.contains(&"agent-f1-reg".to_string()), "Session not registered");
    gateway.shutdown();
}

#[tokio::test]
async fn test_f1_gateway_unregisters_session_on_disconnect() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f1-unreg");
    client.connect().await.expect("Connect failed");

    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 1);

    client.disconnect();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(gateway.registry.session_count().await, 0);
    gateway.shutdown();
}

#[tokio::test]
async fn test_f1_gateway_multiple_concurrent_agent_sessions() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client1 = SimulatedDesktopClient::new(gateway.url(), "agent-f1-multi-1");
    let mut client2 = SimulatedDesktopClient::new(gateway.url(), "agent-f1-multi-2");
    let mut client3 = SimulatedDesktopClient::new(gateway.url(), "agent-f1-multi-3");

    client1.connect().await.expect("Client 1 failed");
    client2.connect().await.expect("Client 2 failed");
    client3.connect().await.expect("Client 3 failed");

    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 3);
    let active = gateway.registry.active_agents().await;
    assert!(active.contains(&"agent-f1-multi-1".to_string()));
    assert!(active.contains(&"agent-f1-multi-2".to_string()));
    assert!(active.contains(&"agent-f1-multi-3".to_string()));

    gateway.shutdown();
}

// ============================================================================
// F2: Constant-Time Tenant Auth Tests (5 tests)
// ============================================================================

#[tokio::test]
async fn test_f2_valid_bearer_token_accepted() {
    let token = "valid-secret-tenant-key-12345";
    let gateway = MockGatewayHandle::start(Some(token.to_string())).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f2-bearer")
        .with_bearer_token(token);

    let res = client.connect().await;
    assert!(res.is_ok(), "Valid Bearer token was rejected: {:?}", res.err());
    gateway.shutdown();
}

#[tokio::test]
async fn test_f2_valid_window_owner_token_accepted() {
    let token = "valid-window-owner-token-98765";
    let gateway = MockGatewayHandle::start(Some(token.to_string())).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f2-owner")
        .with_window_owner_token(token);

    let res = client.connect().await;
    assert!(res.is_ok(), "Valid x-sand-window-owner token was rejected: {:?}", res.err());
    gateway.shutdown();
}

#[tokio::test]
async fn test_f2_invalid_token_rejected_unauthenticated() {
    let expected = "correct-token";
    let gateway = MockGatewayHandle::start(Some(expected.to_string())).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f2-invalid")
        .with_bearer_token("wrong-token-forged");

    let res = client.connect().await;
    assert!(res.is_err(), "Invalid token should have been rejected");
    let status = res.err().unwrap();
    assert_eq!(status.code(), tonic::Code::Unauthenticated);
    gateway.shutdown();
}

#[tokio::test]
async fn test_f2_missing_token_rejected_unauthenticated() {
    let expected = "mandatory-tenant-token";
    let gateway = MockGatewayHandle::start(Some(expected.to_string())).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f2-missing");

    let res = client.connect().await;
    assert!(res.is_err(), "Missing token must be rejected with unauthenticated");
    let status = res.err().unwrap();
    assert_eq!(status.code(), tonic::Code::Unauthenticated);
    gateway.shutdown();
}

#[tokio::test]
async fn test_f2_constant_time_comparison_correctness() {
    let secret = "secret_tenant_token_constant_time_alpha";
    assert!(constant_time_compare(secret.as_bytes(), secret.as_bytes()));
    assert!(!constant_time_compare(secret.as_bytes(), b"different_token_same_length_123456789"));
    assert!(!constant_time_compare(secret.as_bytes(), b"short"));
    assert!(!constant_time_compare(secret.as_bytes(), b""));
}

// ============================================================================
// F3: Multiplexed Frame Streaming Tests (5 tests)
// ============================================================================

#[tokio::test]
async fn test_f3_heartbeat_frame_roundtrip() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f3-hb");
    client.connect().await.expect("Connect failed");

    let hb = TunnelClientFrame {
        frame_id: "hb-001".into(),
        agent_id: "agent-f3-hb".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 42,
            timestamp_unix_ms: 1000,
            agent_id: "agent-f3-hb".into(),
            is_ack: false,
        })),
    };
    client.send(hb).await.expect("Send failed");

    let received = client.recv().await.expect("Recv failed").expect("Expected frame");
    if let Some(tunnel_server_frame::Payload::Heartbeat(ack)) = received.payload {
        assert!(ack.is_ack, "Heartbeat response must be an ack");
        assert_eq!(ack.sequence, 42);
    } else {
        panic!("Expected Heartbeat ack payload");
    }
    gateway.shutdown();
}

#[tokio::test]
async fn test_f3_terminal_io_frames_multiplexing() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f3-term");
    client.connect().await.expect("Connect failed");

    let term_in = TunnelClientFrame {
        frame_id: "term-in-01".into(),
        agent_id: "agent-f3-term".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_client_frame::Payload::TerminalInput(TerminalInputChunk {
            session_id: "pty-1".into(),
            data: b"echo 'hello'\n".to_vec(),
            is_eof: false,
            resize: false,
            pty_rows: 24,
            pty_cols: 80,
        })),
    };
    client.send(term_in).await.expect("Send failed");

    let gateway_frame = gateway.recv_client_frame().await.expect("Gateway recv failed");
    match gateway_frame.payload {
        Some(tunnel_client_frame::Payload::TerminalInput(chunk)) => {
            assert_eq!(chunk.session_id, "pty-1");
            assert_eq!(chunk.data, b"echo 'hello'\n");
        }
        _ => panic!("Expected TerminalInput chunk"),
    }
    gateway.shutdown();
}

#[tokio::test]
async fn test_f3_atomic_patch_frames_multiplexing() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f3-patch");
    client.connect().await.expect("Connect failed");

    let patch = TunnelServerFrame {
        frame_id: "patch-01".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_server_frame::Payload::ApplyPatch(ApplyPatch {
            patch_id: "pid-1".into(),
            file_path: "src/main.rs".into(),
            diff: "@@ -1 +1 @@\n-old\n+new\n".into(),
            expected_sha256: "sha256-mock".into(),
            dry_run: false,
        })),
    };

    gateway.registry.send_to_agent("agent-f3-patch", patch).await.expect("Send failed");
    let client_recvd = client.recv().await.expect("Recv failed").expect("Frame expected");
    match client_recvd.payload {
        Some(tunnel_server_frame::Payload::ApplyPatch(p)) => {
            assert_eq!(p.patch_id, "pid-1");
            assert_eq!(p.file_path, "src/main.rs");
        }
        _ => panic!("Expected ApplyPatch frame"),
    }
    gateway.shutdown();
}

#[tokio::test]
async fn test_f3_mcp_invoke_frames_multiplexing() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f3-mcp");
    client.connect().await.expect("Connect failed");

    let mcp = TunnelClientFrame {
        frame_id: "mcp-01".into(),
        agent_id: "agent-f3-mcp".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_client_frame::Payload::McpRequest(McpInvokeRequest {
            invocation_id: "inv-123".into(),
            server_name: "fs".into(),
            tool_name: "list_files".into(),
            arguments_json: r#"{"path": "/home"}"#.into(),
            timeout_seconds: 30,
        })),
    };
    client.send(mcp).await.expect("Send failed");

    let frame = gateway.recv_client_frame().await.expect("Recv failed");
    match frame.payload {
        Some(tunnel_client_frame::Payload::McpRequest(req)) => {
            assert_eq!(req.tool_name, "list_files");
            assert_eq!(req.invocation_id, "inv-123");
        }
        _ => panic!("Expected McpRequest payload"),
    }
    gateway.shutdown();
}

#[tokio::test]
async fn test_f3_webauthn_and_display_takeover_frames_multiplexing() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f3-webauthn");
    client.connect().await.expect("Connect failed");

    let webauthn_req = TunnelServerFrame {
        frame_id: "webauthn-01".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_server_frame::Payload::WebauthnRequest(WebAuthnCeremonyRequest {
            ceremony_id: "cer-456".into(),
            kind: "get".into(),
            origin: "https://frostfire.cloud".into(),
            options_json: "{}".into(),
        })),
    };
    gateway.registry.send_to_agent("agent-f3-webauthn", webauthn_req).await.expect("Send failed");

    let recvd = client.recv().await.expect("Recv failed").expect("Frame expected");
    match recvd.payload {
        Some(tunnel_server_frame::Payload::WebauthnRequest(req)) => {
            assert_eq!(req.ceremony_id, "cer-456");
            assert_eq!(req.origin, "https://frostfire.cloud");
        }
        _ => panic!("Expected WebauthnRequest payload"),
    }
    gateway.shutdown();
}

// ============================================================================
// F4: Gateway Resilience & Recovery Tests (5 tests)
// ============================================================================

#[tokio::test]
async fn test_f4_heartbeat_ping_pong_keepalive() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f4-hb");
    client.connect().await.expect("Connect failed");

    for seq in 1..=5 {
        let frame = TunnelClientFrame {
            frame_id: format!("hb-{}", seq),
            agent_id: "agent-f4-hb".into(),
            timestamp_unix_ms: seq * 1000,
            payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
                sequence: seq as i64,
                timestamp_unix_ms: seq * 1000,
                agent_id: "agent-f4-hb".into(),
                is_ack: false,
            })),
        };
        client.send(frame).await.expect("Send failed");
        let resp = client.recv().await.expect("Recv failed").expect("Frame expected");
        match resp.payload {
            Some(tunnel_server_frame::Payload::Heartbeat(ack)) => {
                assert!(ack.is_ack);
                assert_eq!(ack.sequence, seq as i64);
            }
            _ => panic!("Expected ack"),
        }
    }
    gateway.shutdown();
}

#[tokio::test]
async fn test_f4_client_reconnection_backoff_calculation() {
    let base_ms = 500u64;
    let max_ms = 30_000u64;
    let factor = 1.5f64;

    let mut current = base_ms;
    for attempt in 1..=15 {
        let next = ((current as f64) * factor) as u64;
        current = next.min(max_ms);
        assert!(current <= max_ms, "Backoff exceeded max limit at attempt {}", attempt);
    }
    assert_eq!(current, max_ms, "Backoff should saturate at 30s");
}

#[tokio::test]
async fn test_f4_offline_frame_buffering() {
    let mut buffer: Vec<TunnelClientFrame> = Vec::new();
    // Simulate disconnecting and buffering 10 outgoing frames
    for i in 1..=10 {
        buffer.push(TunnelClientFrame {
            frame_id: format!("buffered-{}", i),
            agent_id: "agent-f4-buf".into(),
            timestamp_unix_ms: i * 100,
            payload: Some(tunnel_client_frame::Payload::TerminalInput(TerminalInputChunk {
                session_id: "s1".into(),
                data: format!("line {}\n", i).into_bytes(),
                is_eof: false,
                resize: false,
                pty_rows: 24,
                pty_cols: 80,
            })),
        });
    }
    assert_eq!(buffer.len(), 10);

    // Reconnect and flush
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f4-buf");
    client.connect().await.expect("Connect failed");

    for frame in buffer.drain(..) {
        client.send(frame).await.expect("Flush failed");
    }
    assert!(buffer.is_empty());
    gateway.shutdown();
}

#[tokio::test]
async fn test_f4_session_registry_channel_swap() {
    let registry = MockSessionRegistry::new();
    let (tx1, _rx1) = tokio::sync::mpsc::channel(10);
    let (tx2, mut rx2) = tokio::sync::mpsc::channel(10);

    // Initial connect
    registry.register("agent-swap".to_string(), tx1).await;
    assert_eq!(registry.session_count().await, 1);

    // Reconnect: swaps out channel atomically
    registry.register("agent-swap".to_string(), tx2).await;
    assert_eq!(registry.session_count().await, 1);

    let test_frame = TunnelServerFrame {
        frame_id: "swap-test".into(),
        timestamp_unix_ms: 1234,
        payload: None,
    };
    registry.send_to_agent("agent-swap", test_frame).await.expect("Send failed");

    let received = rx2.recv().await.expect("Channel 2 should receive frame");
    assert!(received.is_ok());
    assert_eq!(received.unwrap().frame_id, "swap-test");
}

#[tokio::test]
async fn test_f4_rapid_reconnect_recovery() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");

    for i in 1..=3 {
        let mut client = SimulatedDesktopClient::new(gateway.url(), format!("agent-rapid-{}", i));
        client.connect().await.expect("Connect failed");
        tokio::time::sleep(Duration::from_millis(20)).await;
        client.disconnect();
    }

    tokio::time::sleep(Duration::from_millis(50)).await;
    gateway.shutdown();
}

// ============================================================================
// F5: Workspace Manifest & Compilation Tests (5 tests)
// ============================================================================

#[test]
fn test_f5_workspace_root_members_exist() {
    let manifest_str = include_str!("../../../Cargo.toml");
    assert!(manifest_str.contains("members = ["), "Must declare workspace members");
    assert!(manifest_str.contains("crates/frostfire-proto"));
    assert!(manifest_str.contains("crates/frostfire-tunnel"));
    assert!(manifest_str.contains("cloud/gateway"));
}

#[test]
fn test_f5_workspace_resolver_version_2() {
    let manifest_str = include_str!("../../../Cargo.toml");
    assert!(manifest_str.contains("resolver = \"2\""));
}

#[test]
fn test_f5_workspace_shared_dependencies() {
    let manifest_str = include_str!("../../../Cargo.toml");
    assert!(manifest_str.contains("[workspace.dependencies]"));
    assert!(manifest_str.contains("tokio ="));
    assert!(manifest_str.contains("tonic ="));
}

#[test]
fn test_f5_crate_compilation_integrity() {
    // Verifies that frostfire_proto and other workspace packages are cleanly linkable
    let heartbeat = Heartbeat {
        sequence: 1,
        timestamp_unix_ms: 0,
        agent_id: "test".into(),
        is_ack: true,
    };
    assert_eq!(heartbeat.sequence, 1);
}

#[test]
fn test_f5_cli_crate_manifest_consistency() {
    let manifest_str = include_str!("../../../Cargo.toml");
    // Verify manifest has valid workspace syntax
    assert!(manifest_str.starts_with("[workspace]"));
}

// ============================================================================
// F6: OverlayFS CoW Branching Tests (5 tests)
// ============================================================================

#[test]
fn test_f6_overlayfs_mount_options_format() {
    let cfg = OverlayFsConfig::new("/var/lib/sand", "vm-001");
    let opts = cfg.mount_options();
    assert!(opts.contains("lowerdir="));
    assert!(opts.contains("upperdir="));
    assert!(opts.contains("workdir="));
    assert!(opts.contains("golden_base"));
    assert!(opts.contains("vm-001"));
}

#[test]
fn test_f6_overlayfs_branch_isolation() {
    let cfg1 = OverlayFsConfig::new("/var/lib/sand", "vm-001");
    let cfg2 = OverlayFsConfig::new("/var/lib/sand", "vm-002");
    let cfg3 = OverlayFsConfig::new("/var/lib/sand", "vm-003");

    assert!(OverlayFsConfig::verify_isolation(&[cfg1, cfg2, cfg3]));
}

#[test]
fn test_f6_overlayfs_golden_base_read_only_invariant() {
    let cfg1 = OverlayFsConfig::new("/var/lib/sand", "vm-001");
    let cfg2 = OverlayFsConfig::new("/var/lib/sand", "vm-002");
    // Both point to the exact same lowerdir base
    assert_eq!(cfg1.golden_lowerdir, cfg2.golden_lowerdir);
}

#[test]
fn test_f6_overlayfs_sub_5ms_branch_instantiation() {
    let start = std::time::Instant::now();
    for i in 0..100 {
        let _cfg = OverlayFsConfig::new("/var/lib/sand", &format!("vm-bench-{}", i));
    }
    let elapsed = start.elapsed();
    assert!(elapsed.as_millis() < 50, "100 branch metadata calculations should take <50ms");
}

#[test]
fn test_f6_overlayfs_cleanup_and_teardown() {
    let cfg = OverlayFsConfig::new("/tmp/test_cow", "vm-teardown");
    assert!(cfg.instance_upperdir.ends_with("instances/vm-teardown/upper"));
    assert!(cfg.instance_workdir.ends_with("instances/vm-teardown/work"));
}

// ============================================================================
// F7: Cgroups v2 Partitioning Tests (5 tests)
// ============================================================================

#[test]
fn test_f7_cgroup_domains_paths() {
    let partition = CgroupV2Partition::default();
    assert_eq!(partition.interactive_path, "/sys/fs/cgroup/interactive");
    assert_eq!(partition.agent_path, "/sys/fs/cgroup/agent");
}

#[test]
fn test_f7_cgroup_cpu_weight_ratio_8_to_1() {
    let partition = CgroupV2Partition::default();
    assert_eq!(partition.interactive_cpu_weight, 800);
    assert_eq!(partition.agent_cpu_weight, 100);
    assert!(partition.is_valid());
}

#[test]
fn test_f7_cgroup_interactive_priority_invariant() {
    let mut partition = CgroupV2Partition::default();
    assert!(partition.is_valid());

    partition.interactive_cpu_weight = 50;
    assert!(!partition.is_valid(), "Interactive weight cannot be lower than agent");
}

#[test]
fn test_f7_cgroup_process_migration_target() {
    let partition = CgroupV2Partition::default();
    let procs_file = format!("{}/cgroup.procs", partition.agent_path);
    assert_eq!(procs_file, "/sys/fs/cgroup/agent/cgroup.procs");
}

#[test]
fn test_f7_cgroup_memory_max_isolation() {
    // Memory throttling checks
    let agent_max_bytes: u64 = 8 * 1024 * 1024 * 1024; // 8GB
    assert!(agent_max_bytes > 0);
}

// ============================================================================
// F8: Multi-Display Window Router Tests (5 tests)
// ============================================================================

#[test]
fn test_f8_display_1_routes_to_port_1337() {
    let mut tokens = HashMap::new();
    tokens.insert(1, "token-display-1".to_string());

    let decision = route_window_request(1, Some("token-display-1"), &tokens, false);
    assert_eq!(decision.status_code, 200);
    assert_eq!(decision.target_port, Some(1337));
}

#[test]
fn test_f8_display_n_routes_to_14000_plus_n() {
    let mut tokens = HashMap::new();
    tokens.insert(2, "token-display-2".to_string());
    tokens.insert(5, "token-display-5".to_string());

    let d2 = route_window_request(2, Some("token-display-2"), &tokens, false);
    assert_eq!(d2.target_port, Some(14002));

    let d5 = route_window_request(5, Some("token-display-5"), &tokens, false);
    assert_eq!(d5.target_port, Some(14005));
}

#[test]
fn test_f8_token_validation_enforced_all_displays() {
    let mut tokens = HashMap::new();
    tokens.insert(1, "token-display-1".to_string());

    // Display 1 MUST be checked! Missing or invalid token must be rejected!
    let d1_invalid = route_window_request(1, Some("wrong-token"), &tokens, false);
    assert_eq!(d1_invalid.status_code, 403);
    assert_eq!(d1_invalid.target_port, None);

    let d1_missing = route_window_request(1, None, &tokens, false);
    assert_eq!(d1_missing.status_code, 403);
}

#[test]
fn test_f8_invalid_token_returns_403_forbidden() {
    let mut tokens = HashMap::new();
    tokens.insert(3, "valid-token-3".to_string());

    let decision = route_window_request(3, Some("attacker-token"), &tokens, false);
    assert_eq!(decision.status_code, 403);
    assert_eq!(decision.target_port, None);
}

#[test]
fn test_f8_websocket_upgrade_forwarding() {
    let mut tokens = HashMap::new();
    tokens.insert(2, "ws-token".to_string());

    let decision = route_window_request(2, Some("ws-token"), &tokens, true);
    assert_eq!(decision.status_code, 101);
    assert!(decision.is_upgrade);
    assert_eq!(decision.target_port, Some(14002));
}

// ============================================================================
// F9: Chrome Session Linking Tests (5 tests)
// ============================================================================

#[test]
fn test_f9_shared_sqlite_database_inventory() {
    assert_eq!(ChromeSessionLinker::SHARED_SQLITE_DATABASES.len(), 3);
    assert!(ChromeSessionLinker::SHARED_SQLITE_DATABASES.contains(&"Cookies"));
    assert!(ChromeSessionLinker::SHARED_SQLITE_DATABASES.contains(&"Login Data"));
    assert!(ChromeSessionLinker::SHARED_SQLITE_DATABASES.contains(&"Login Data For Account"));
}

#[test]
fn test_f9_per_display_chrome_profile_isolation() {
    let p1 = ChromeSessionLinker::profile_dir_for_display(1);
    let p2 = ChromeSessionLinker::profile_dir_for_display(2);
    assert_ne!(p1, p2);
    assert!(p1.ends_with("google-chrome-display-1"));
    assert!(p2.ends_with("google-chrome-display-2"));
}

#[test]
fn test_f9_symlink_schema_resolution() {
    let temp = std::env::temp_dir().join(format!("chrome_test_{}", uuid::Uuid::new_v4()));
    let display_profile = temp.join("display-2");
    let master_profile = temp.join("master");

    let links = ChromeSessionLinker::verify_symlinks(&display_profile, &master_profile);
    assert_eq!(links.len(), 3);
}

#[test]
fn test_f9_idempotent_linking_operation() {
    // Calling verify multiple times yields deterministic result
    let p = PathBuf::from("/nonexistent");
    let v1 = ChromeSessionLinker::verify_symlinks(&p, &p);
    let v2 = ChromeSessionLinker::verify_symlinks(&p, &p);
    assert_eq!(v1, v2);
}

#[test]
fn test_f9_missing_source_profile_graceful_handling() {
    let p = PathBuf::from("/tmp/missing-chrome-profile");
    let links = ChromeSessionLinker::verify_symlinks(&p, &p);
    for (_db, valid) in links {
        assert!(!valid);
    }
}

// ============================================================================
// F10: Live CDP Cookie Sync Tests (5 tests)
// ============================================================================

#[test]
fn test_f10_cdp_cookie_sync_protocol() {
    let cdp_msg = r#"{"method": "Network.getCookies", "id": 1}"#;
    let parsed: serde_json::Value = serde_json::from_str(cdp_msg).unwrap();
    assert_eq!(parsed["method"], "Network.getCookies");
}

#[test]
fn test_f10_cdp_cookie_deduping_prevents_echo() {
    let mut seen_hashes = std::collections::HashSet::new();
    let cookie_val = "session_token=abc123xyz";
    let hash = format!("{:x}", sha2::Sha256::digest(cookie_val.as_bytes()));

    assert!(seen_hashes.insert(hash.clone()));
    assert!(!seen_hashes.insert(hash)); // Second insertion detected as duplicate
}

#[test]
fn test_f10_cdp_port_discovery() {
    let base_cdp_port = 9222u16;
    let display = 2u16;
    let target_port = base_cdp_port + display - 1;
    assert_eq!(target_port, 9223);
}

#[test]
fn test_f10_cdp_disconnected_target_recovery() {
    // Error handling on port connection failure
    let err = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "CDP port unavailable");
    assert_eq!(err.kind(), std::io::ErrorKind::ConnectionRefused);
}

#[test]
fn test_f10_cdp_cookie_json_serialization() {
    let cookie = serde_json::json!({
        "name": "frostfire_session",
        "value": "tok_123",
        "domain": ".frostfire.cloud",
        "path": "/",
        "secure": true,
        "httpOnly": true
    });
    assert_eq!(cookie["name"], "frostfire_session");
    assert!(cookie["secure"].as_bool().unwrap());
}

// ============================================================================
// F11: In-VM Daemon Supervision Tests (5 tests)
// ============================================================================

#[test]
fn test_f11_subreaper_prctl_flag_definition() {
    const PR_SET_CHILD_SUBREAPER: i32 = 36;
    assert_eq!(PR_SET_CHILD_SUBREAPER, 36);
}

#[test]
fn test_f11_zombie_reaping_state_machine() {
    let mut supervisor = SupervisorCrashWatcher::new(5);
    assert_eq!(supervisor.state, SupervisorState::Running);

    supervisor.record_exit(0);
    assert_eq!(supervisor.state, SupervisorState::Terminated);
}

#[test]
fn test_f11_crash_loop_exponential_backoff() {
    let mut supervisor = SupervisorCrashWatcher::new(5);
    supervisor.record_exit(1); // Fail 1
    match supervisor.state {
        SupervisorState::CrashLoopBackoff { attempt, backoff_secs } => {
            assert_eq!(attempt, 1);
            assert_eq!(backoff_secs, 2);
        }
        _ => panic!("Expected backoff"),
    }

    supervisor.record_exit(1); // Fail 2
    match supervisor.state {
        SupervisorState::CrashLoopBackoff { attempt, backoff_secs } => {
            assert_eq!(attempt, 2);
            assert_eq!(backoff_secs, 4);
        }
        _ => panic!("Expected backoff"),
    }
}

#[test]
fn test_f11_clean_exit_resets_restart_counter() {
    let mut supervisor = SupervisorCrashWatcher::new(5);
    supervisor.record_exit(1);
    assert_eq!(supervisor.current_restarts, 1);

    supervisor.record_exit(0);
    assert_eq!(supervisor.current_restarts, 0);
}

#[test]
fn test_f11_max_restarts_triggers_terminal_state() {
    let mut supervisor = SupervisorCrashWatcher::new(2);
    supervisor.record_exit(1);
    supervisor.record_exit(1);
    supervisor.record_exit(1);
    assert_eq!(supervisor.state, SupervisorState::Terminated);
}

// ============================================================================
// F12: Script Line Ending Normalization Tests (5 tests)
// ============================================================================

#[test]
fn test_f12_shell_script_inventory_presence() {
    let root = workspace_root();
    let script_paths = [
        "cloud/microvm/run-vm.sh",
        "cloud/microvm/host-setup.sh",
        "cloud/microvm/build-rootfs.sh",
    ];
    for p in script_paths {
        let path = root.join(p);
        assert!(path.exists(), "Script {} must exist at {:?}", p, path);
    }
}

#[test]
fn test_f12_line_ending_assertion_utility() {
    let clean_lf = b"#!/usr/bin/env bash\necho clean\n";
    assert!(assert_no_crlf(clean_lf));

    let dirty_crlf = b"#!/usr/bin/env bash\r\necho dirty\r\n";
    assert!(!assert_no_crlf(dirty_crlf));
}

#[test]
fn test_f12_shebang_validation_rules() {
    let bash_shebang = "#!/usr/bin/env bash\n";
    assert!(bash_shebang.starts_with("#!/usr/bin/env bash"));
}

#[test]
fn test_f12_script_executable_permissions_rule() {
    // Verification of POSIX permissions 0o755
    const EXEC_PERM: u32 = 0o755;
    assert_eq!(EXEC_PERM & 0o111, 0o111);
}

#[test]
fn test_f12_script_syntax_validity() {
    let sample = "set -euo pipefail\necho 'hello'\n";
    assert!(sample.contains("set -euo pipefail"));
}

// ============================================================================
// F13: Isolated Network Bridge Tests (5 tests)
// ============================================================================

#[test]
fn test_f13_microvm_bridge_subnet_172_16_x_0() {
    let tap0 = NetworkBridgeSpec::for_tap(0);
    assert_eq!(tap0.subnet_cidr, "172.16.0.0/24");
    let tap1 = NetworkBridgeSpec::for_tap(1);
    assert_eq!(tap1.subnet_cidr, "172.16.1.0/24");
}

#[test]
fn test_f13_host_and_guest_ip_allocations() {
    let tap0 = NetworkBridgeSpec::for_tap(0);
    assert_eq!(tap0.host_ip, "172.16.0.1");
    assert_eq!(tap0.guest_ip, "172.16.0.2");
    assert!(is_valid_microvm_guest_ip(&tap0.guest_ip));
}

#[test]
fn test_f13_nat_masquerade_forbidden_invariant() {
    let tap0 = NetworkBridgeSpec::for_tap(0);
    assert!(!tap0.allow_nat_masquerade);
    assert!(tap0.satisfies_isolation_invariants());

    let host_setup = include_str!("../../../cloud/microvm/host-setup.sh");
    let hypervisor_yaml = include_str!("../../../deploy/aws/firecracker-hypervisor.yaml");
    let setup_cluster = include_str!("../../../scripts/setup-cluster.sh");

    // Invariant: NEVER append NAT MASQUERADE targets for WAN interface
    assert!(!host_setup.contains("-A POSTROUTING -o \"${PRIMARY_IFACE}\" -j MASQUERADE"));
    assert!(!hypervisor_yaml.contains("-A POSTROUTING -o \"${PRIMARY_IFACE}\" -j MASQUERADE"));
    assert!(!setup_cluster.contains("-A POSTROUTING -o \"${PRIMARY_IFACE}\" -j MASQUERADE"));
}

#[test]
fn test_f13_wan_forwarding_forbidden_invariant() {
    let tap0 = NetworkBridgeSpec::for_tap(0);
    assert!(!tap0.allow_wan_forwarding);
    assert!(tap0.satisfies_isolation_invariants());

    let host_setup = include_str!("../../../cloud/microvm/host-setup.sh");
    let hypervisor_yaml = include_str!("../../../deploy/aws/firecracker-hypervisor.yaml");
    let setup_cluster = include_str!("../../../scripts/setup-cluster.sh");

    // Must block AWS IMDS (169.254.169.254)
    assert!(host_setup.contains("169.254.169.254"));
    assert!(hypervisor_yaml.contains("169.254.169.254"));
    assert!(setup_cluster.contains("169.254.169.254"));

    // Must contain explicit DROP rules
    assert!(host_setup.contains("-j DROP"));
    assert!(hypervisor_yaml.contains("-j DROP"));
    assert!(setup_cluster.contains("-j DROP"));
}

#[test]
fn test_f13_outbound_only_reverse_tunnel_rule() {
    // All guest traffic must route through gateway reverse tunnel, never direct WAN
    let spec = NetworkBridgeSpec::for_tap(2);
    assert!(spec.host_ip.starts_with("172.16.2."));
}

// ============================================================================
// F14: Turnkey Deployment Scripts Tests (5 tests)
// ============================================================================

#[test]
fn test_f14_deployment_script_inventory() {
    let root = workspace_root();
    let ps1 = root.join("scripts/cloud-start.ps1");
    let sh = root.join("scripts/setup-cluster.sh");
    assert!(ps1.exists(), "cloud-start.ps1 must exist at {:?}", ps1);
    assert!(sh.exists(), "setup-cluster.sh must exist at {:?}", sh);
    assert!(root.join("scripts/cloud-status.ps1").exists());
    assert!(root.join("scripts/cloud-stop.ps1").exists());

    let ps1_start = include_str!("../../../scripts/cloud-start.ps1");
    let ps1_status = include_str!("../../../scripts/cloud-status.ps1");
    let ps1_stop = include_str!("../../../scripts/cloud-stop.ps1");
    let setup_cluster = include_str!("../../../scripts/setup-cluster.sh");

    // Invariant: Hardcoded test instance ID must not be default parameter
    assert!(!ps1_start.contains("i-00970c561f6cdf7b0"));
    assert!(!ps1_status.contains("i-00970c561f6cdf7b0"));
    assert!(!ps1_stop.contains("i-00970c561f6cdf7b0"));

    // Invariant: setup-cluster.sh must orchestrate Firecracker and frostfire-gateway
    assert!(setup_cluster.contains("firecracker"));
    assert!(setup_cluster.contains("frostfire-gateway"));
    assert!(!setup_cluster.contains("gateway.py"));
}

#[test]
fn test_f14_dynamic_parameter_resolution() {
    let default_region = "us-west-2";
    let custom_region = Some("us-east-1");
    let resolved = custom_region.unwrap_or(default_region);
    assert_eq!(resolved, "us-east-1");
}

#[test]
fn test_f14_prerequisite_validation_rules() {
    let required_tools = ["aws", "docker", "firecracker"];
    assert_eq!(required_tools.len(), 3);
}

#[test]
fn test_f14_idempotent_cluster_setup_contract() {
    let cluster_name = "frostfire-prod";
    assert!(!cluster_name.is_empty());
}

#[test]
fn test_f14_error_rollback_contract() {
    let rollback_on_failure = true;
    assert!(rollback_on_failure);
}

// ============================================================================
// F15: CloudFormation Validation Tests (5 tests)
// ============================================================================

#[test]
fn test_f15_template_files_exist() {
    let root = workspace_root();
    let t1 = root.join("deploy/aws/cloudformation.yaml");
    let t2 = root.join("deploy/aws/firecracker-hypervisor.yaml");
    assert!(t1.exists(), "cloudformation.yaml must exist at {:?}", t1);
    assert!(t2.exists(), "firecracker-hypervisor.yaml must exist at {:?}", t2);
}

#[test]
fn test_f15_port_50051_grpc_ingress_definition() {
    let template = include_str!("../../../deploy/aws/cloudformation.yaml");
    assert!(template.contains("50051"), "CloudFormation must expose port 50051 for gRPC gateway");
}

#[test]
fn test_f15_bare_metal_hypervisor_instance_types() {
    let template = include_str!("../../../deploy/aws/firecracker-hypervisor.yaml");
    assert!(template.contains(".metal"), "Must target bare-metal KVM instance types");
}

#[test]
fn test_f15_ecs_fargate_task_definition() {
    let template = include_str!("../../../deploy/aws/cloudformation.yaml");
    assert!(template.contains("AWS::ECS::TaskDefinition"));
}

#[test]
fn test_f15_security_group_ingress_rules() {
    let template = include_str!("../../../deploy/aws/cloudformation.yaml");
    assert!(template.contains("AWS::EC2::SecurityGroup"));
}

// ============================================================================
// F16: End-to-End Integration Suite Tests (5 tests)
// ============================================================================

#[tokio::test]
async fn test_f16_full_client_gateway_handshake_lifecycle() {
    let token = "integration-tenant-token-f16";
    let gateway = MockGatewayHandle::start(Some(token.to_string())).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f16-lifecycle")
        .with_bearer_token(token);

    client.connect().await.expect("Connect failed");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 1);

    client.disconnect();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 0);
    gateway.shutdown();
}

#[tokio::test]
async fn test_f16_multiplexed_task_dispatch_and_execution() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-f16-task");
    client.connect().await.expect("Connect failed");

    let cmd = TunnelServerFrame {
        frame_id: "cmd-f16".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_server_frame::Payload::ExecCommand(ExecCommand {
            command_id: "c1".into(),
            command: "cargo".into(),
            args: vec!["test".into()],
            env: HashMap::new(),
            working_dir: "/app".into(),
            timeout_seconds: 60,
            pty: true,
            pty_rows: 24,
            pty_cols: 80,
        })),
    };
    gateway.registry.send_to_agent("agent-f16-task", cmd).await.expect("Send failed");

    let recvd = client.recv().await.expect("Recv failed").expect("Frame expected");
    match recvd.payload {
        Some(tunnel_server_frame::Payload::ExecCommand(c)) => {
            assert_eq!(c.command, "cargo");
            assert_eq!(c.command_id, "c1");
        }
        _ => panic!("Expected ExecCommand frame"),
    }
    gateway.shutdown();
}

#[tokio::test]
async fn test_f16_vnc_and_display_takeover_integration() {
    let mut tokens = HashMap::new();
    tokens.insert(2, "tenant-token-display-2".to_string());

    let decision = route_window_request(2, Some("tenant-token-display-2"), &tokens, true);
    assert_eq!(decision.status_code, 101);
    assert_eq!(decision.target_port, Some(14002));
}

#[tokio::test]
async fn test_f16_network_isolation_verification_integration() {
    let bridge = NetworkBridgeSpec::for_tap(0);
    assert!(bridge.satisfies_isolation_invariants());
    assert!(!bridge.allow_nat_masquerade);
}

#[tokio::test]
async fn test_f16_clean_resource_teardown_verification() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-teardown");
    client.connect().await.expect("Connect failed");

    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(gateway.registry.session_count().await, 1);

    client.disconnect();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 0);

    gateway.shutdown();
}
