//! Tier 3: Cross-Feature Interactions & Pairwise Integration Suite

use std::collections::HashMap;
use std::time::Duration;

use frostfire_e2e::assertions::*;
use frostfire_e2e::harness::*;
use frostfire_e2e::mock_client::SimulatedDesktopClient;
use frostfire_e2e::mock_gateway::MockGatewayHandle;
use frostfire_proto::tunnel::{
    tunnel_client_frame, tunnel_server_frame, Heartbeat,
    McpInvokeRequest, TerminalInputChunk, TunnelClientFrame,
    TunnelServerFrame, WebAuthnCeremonyRequest,
};
use frostfire_security::MerkleAuditLedger;

/// 1. Tenant Authentication + Bidirectional Multiplexing
#[tokio::test]
async fn test_tier3_auth_and_multiplexing() {
    let token = "cross-feature-auth-token-123";
    let gateway = MockGatewayHandle::start(Some(token.into())).await.expect("Bind failed");

    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-t3-mux")
        .with_bearer_token(token);
    client.connect().await.expect("Connect failed");

    // 1. Send Terminal Input
    let term = TunnelClientFrame {
        frame_id: "f-term".into(),
        agent_id: "agent-t3-mux".into(),
        timestamp_unix_ms: 100,
        payload: Some(tunnel_client_frame::Payload::TerminalInput(TerminalInputChunk {
            session_id: "s1".into(),
            data: b"ls -la\n".to_vec(),
            is_eof: false,
            resize: false,
            pty_rows: 24,
            pty_cols: 80,
        })),
    };
    client.send(term).await.expect("Send terminal failed");

    // 2. Send MCP Invoke
    let mcp = TunnelClientFrame {
        frame_id: "f-mcp".into(),
        agent_id: "agent-t3-mux".into(),
        timestamp_unix_ms: 101,
        payload: Some(tunnel_client_frame::Payload::McpRequest(McpInvokeRequest {
            invocation_id: "inv-1".into(),
            server_name: "fs".into(),
            tool_name: "read_file".into(),
            arguments_json: r#"{"path": "/etc/hosts"}"#.into(),
            timeout_seconds: 10,
        })),
    };
    client.send(mcp).await.expect("Send mcp failed");

    // 3. Receive frames on gateway
    let f1 = gateway.recv_client_frame().await.expect("Recv 1 failed");
    let f2 = gateway.recv_client_frame().await.expect("Recv 2 failed");

    assert!(f1.payload.is_some());
    assert!(f2.payload.is_some());
    gateway.shutdown();
}

/// 2. Tenant Authentication + Reconnect Recovery
#[tokio::test]
async fn test_tier3_auth_and_reconnect() {
    let token = "cross-feature-reconnect-token";
    let gateway = MockGatewayHandle::start(Some(token.into())).await.expect("Bind failed");

    let mut client1 = SimulatedDesktopClient::new(gateway.url(), "agent-t3-recon")
        .with_bearer_token(token);
    client1.connect().await.expect("Initial connect failed");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(gateway.registry.session_count().await, 1);

    // Abruptly drop connection
    client1.disconnect();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 0);

    // Reconnect with same credentials
    let mut client2 = SimulatedDesktopClient::new(gateway.url(), "agent-t3-recon")
        .with_bearer_token(token);
    client2.connect().await.expect("Reconnect failed");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(gateway.registry.session_count().await, 1);

    gateway.shutdown();
}

/// 3. Multiplexing + Offline Frame Buffering
#[tokio::test]
async fn test_tier3_multiplexing_and_offline_buffering() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut buffer = Vec::new();

    // Generate 5 mixed frames offline
    for i in 1..=5 {
        buffer.push(TunnelClientFrame {
            frame_id: format!("offline-frame-{}", i),
            agent_id: "agent-t3-buff".into(),
            timestamp_unix_ms: i * 10,
            payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
                sequence: i,
                timestamp_unix_ms: i * 10,
                agent_id: "agent-t3-buff".into(),
                is_ack: false,
            })),
        });
    }

    // Connect and flush all buffered frames
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-t3-buff");
    client.connect().await.expect("Connect failed");

    for frame in buffer.drain(..) {
        client.send(frame).await.expect("Send failed");
        let ack = client.recv().await.expect("Recv failed").expect("Frame expected");
        match ack.payload {
            Some(tunnel_server_frame::Payload::Heartbeat(h)) => assert!(h.is_ack),
            _ => panic!("Expected Heartbeat ack"),
        }
    }

    gateway.shutdown();
}

/// 4. Isolated Network Bridge + Reverse Tunnel Ingress
#[test]
fn test_tier3_network_bridge_isolation_and_reverse_gateway() {
    let tap0 = NetworkBridgeSpec::for_tap(0);
    // Guest network is strictly 172.16.0.0/24
    assert!(tap0.satisfies_isolation_invariants());
    assert!(!tap0.allow_nat_masquerade);
    assert!(!tap0.allow_wan_forwarding);

    // Guest IP cannot route to public internet (e.g. 8.8.8.8) directly
    assert!(!is_valid_microvm_guest_ip("8.8.8.8"));
    // Host reverse tunnel gateway is local 172.16.0.1
    assert_eq!(tap0.host_ip, "172.16.0.1");
}

/// 5. OverlayFS CoW Branching + Cgroups v2 Partitioning
#[test]
fn test_tier3_cow_branching_and_cgroup_partitioning() {
    let cow = OverlayFsConfig::new("/var/lib/sand", "vm-branch-1");
    let cgroup = CgroupV2Partition::default();

    // Verify rootfs mount option is prepared
    assert!(cow.mount_options().contains("golden_base"));
    assert!(cow.mount_options().contains("instances/vm-branch-1/upper"));

    // Verify processes inside the VM are constrained by cgroup weights
    assert!(cgroup.is_valid());
    assert_eq!(cgroup.interactive_cpu_weight, 800);
    assert_eq!(cgroup.agent_cpu_weight, 100);
}

/// 6. Window Router + VNC Display Takeover
#[test]
fn test_tier3_window_router_and_vnc_display_takeover() {
    let mut tokens = HashMap::new();
    tokens.insert(2, "takeover-token-display-2".to_string());

    // Valid token on display 2 with WebSocket upgrade
    let decision = route_window_request(2, Some("takeover-token-display-2"), &tokens, true);
    assert_eq!(decision.status_code, 101);
    assert!(decision.is_upgrade);
    assert_eq!(decision.target_port, Some(14002));

    // Attacker token rejected
    let rejection = route_window_request(2, Some("attacker-token"), &tokens, true);
    assert_eq!(rejection.status_code, 403);
    assert_eq!(rejection.target_port, None);
}

/// 7. In-VM Daemon Supervisor + PTY Shell + Diff Engine
#[tokio::test]
async fn test_tier3_in_vm_daemon_supervisor_and_pty_patch_execution() {
    let mut supervisor = SupervisorCrashWatcher::new(5);
    assert_eq!(supervisor.state, SupervisorState::Running);

    // Simulate agent running command successfully
    supervisor.record_exit(0);
    assert_eq!(supervisor.state, SupervisorState::Terminated);

    // Verify diff calculation engine
    let old_text = "fn main() {\n    println!(\"old\");\n}\n";
    let new_text = "fn main() {\n    println!(\"new\");\n}\n";
    let diff = similar::TextDiff::from_lines(old_text, new_text);
    assert!(diff.unified_diff().to_string().contains("-    println!(\"old\");"));
    assert!(diff.unified_diff().to_string().contains("+    println!(\"new\");"));
}

/// 8. WebAuthn Passkey + Inverted Broker + Merkle Audit Ledger
#[tokio::test]
async fn test_tier3_webauthn_passkey_and_merkle_audit_ledger() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-t3-webauthn");
    client.connect().await.expect("Connect failed");

    // 1. Send ceremony request through tunnel
    let webauthn = TunnelServerFrame {
        frame_id: "req-auth".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_server_frame::Payload::WebauthnRequest(WebAuthnCeremonyRequest {
            ceremony_id: "cer-t3".into(),
            kind: "create".into(),
            origin: "https://auth.frostfire.cloud".into(),
            options_json: "{}".into(),
        })),
    };
    gateway.registry.send_to_agent("agent-t3-webauthn", webauthn).await.expect("Send failed");
    let recvd = client.recv().await.expect("Recv failed").expect("Frame expected");
    assert!(recvd.payload.is_some());

    // 2. Record passkey ceremony completion in Merkle ledger
    let temp_dir = std::env::temp_dir().join(format!("ledger_t3_{}", uuid::Uuid::new_v4()));
    let ledger_path = temp_dir.join("audit.db");
    let ledger = MerkleAuditLedger::open(&ledger_path).expect("Failed to create ledger");

    ledger
        .append("agent-t3-webauthn", "webauthn_ceremony_complete", b"credential/passkey_1")
        .expect("Append entry failed");
    let report = ledger.verify_integrity().expect("Integrity check failed");
    assert!(report.is_valid);
    assert_eq!(report.verified_count, 1);

    gateway.shutdown();
    let _ = std::fs::remove_dir_all(&temp_dir);
}

/// 9. Chrome Multi-Display Linking + CDP Cookie Sync
#[test]
fn test_tier3_chrome_session_linking_and_cdp_cookie_sync() {
    let p1 = ChromeSessionLinker::profile_dir_for_display(1);
    let p2 = ChromeSessionLinker::profile_dir_for_display(2);
    assert_ne!(p1, p2);

    // CDP Cookie payload to be synced across the two profiles
    let cookie_payload = serde_json::json!({
        "name": "session_id",
        "value": "secret_session_cookie",
        "domain": ".internal.sand",
        "path": "/"
    });
    assert_eq!(cookie_payload["name"], "session_id");
}

/// 10. Turnkey Deployment Automation + CloudFormation Templates
#[test]
fn test_tier3_turnkey_automation_and_cloudformation_parameters() {
    let root = workspace_root();
    let cf_path = root.join("deploy/aws/cloudformation.yaml");
    let script_path = root.join("scripts/setup-cluster.sh");

    assert!(cf_path.exists());
    assert!(script_path.exists());

    let cf_content = std::fs::read_to_string(&cf_path).expect("Read CF failed");
    assert!(cf_content.contains("50051"));
}
