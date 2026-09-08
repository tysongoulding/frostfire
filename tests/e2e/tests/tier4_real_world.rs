//! Tier 4: Real-World End-to-End Application Scenarios Suite (>=5 tests)

use std::collections::HashMap;
use std::time::Duration;

use frostfire_e2e::assertions::*;
use frostfire_e2e::harness::*;
use frostfire_e2e::mock_client::SimulatedDesktopClient;
use frostfire_e2e::mock_gateway::MockGatewayHandle;
use frostfire_proto::tunnel::{
    tunnel_client_frame, tunnel_server_frame, ApplyPatch, ExecCommand,
    PatchResult, TerminalInputChunk, TerminalOutputChunk, TunnelClientFrame,
    TunnelServerFrame,
};

/// Scenario 1: Complete Developer Workflow End-to-End
/// Desktop client connects -> authenticates -> microVM receives PTY command -> applies atomic patch -> runs build -> clean teardown
#[tokio::test]
async fn test_tier4_scenario1_developer_workflow_e2e() {
    let tenant_token = "prod-tenant-token-alpha";
    let gateway = MockGatewayHandle::start(Some(tenant_token.into())).await.expect("Bind failed");

    // 1. Client connects with tenant token
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-dev-workflow")
        .with_bearer_token(tenant_token);
    client.connect().await.expect("Client authentication failed");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(gateway.registry.session_count().await, 1);

    // 2. Gateway dispatches ExecCommand (PTY interactive terminal)
    let pty_cmd = TunnelServerFrame {
        frame_id: "cmd-dev-01".into(),
        timestamp_unix_ms: 100,
        payload: Some(tunnel_server_frame::Payload::ExecCommand(ExecCommand {
            command_id: "c-dev-1".into(),
            command: "bash".into(),
            args: vec!["-l".into()],
            env: HashMap::new(),
            working_dir: "/workspace".into(),
            timeout_seconds: 30,
            pty: true,
            pty_rows: 24,
            pty_cols: 80,
        })),
    };
    gateway.registry.send_to_agent("agent-dev-workflow", pty_cmd).await.expect("Send failed");

    // Client receives ExecCommand
    let recvd_cmd = client.recv().await.expect("Recv failed").expect("Expected ExecCommand");
    match recvd_cmd.payload {
        Some(tunnel_server_frame::Payload::ExecCommand(c)) => {
            assert_eq!(c.command, "bash");
            assert!(c.pty);
        }
        _ => panic!("Expected ExecCommand payload"),
    }

    // 3. Client streams back terminal output
    let term_out = TunnelClientFrame {
        frame_id: "out-dev-01".into(),
        agent_id: "agent-dev-workflow".into(),
        timestamp_unix_ms: 105,
        payload: Some(tunnel_client_frame::Payload::TerminalOutput(TerminalOutputChunk {
            session_id: "pty-dev-1".into(),
            data: b"bash-5.2$ \n".to_vec(),
            is_stderr: false,
            is_eof: false,
            exit_code: 0,
        })),
    };
    client.send(term_out).await.expect("Send terminal output failed");

    // Gateway receives terminal output
    let recvd_out = gateway.recv_client_frame().await.expect("Gateway recv failed");
    match recvd_out.payload {
        Some(tunnel_client_frame::Payload::TerminalOutput(out)) => {
            assert_eq!(out.data, b"bash-5.2$ \n");
        }
        _ => panic!("Expected TerminalOutput chunk"),
    }

    // 4. Gateway sends ApplyPatch
    let patch_frame = TunnelServerFrame {
        frame_id: "patch-dev-01".into(),
        timestamp_unix_ms: 110,
        payload: Some(tunnel_server_frame::Payload::ApplyPatch(ApplyPatch {
            patch_id: "patch-101".into(),
            file_path: "src/lib.rs".into(),
            diff: "@@ -1 +1 @@\n-pub fn old() {}\n+pub fn new_feature() {}\n".into(),
            expected_sha256: "expected_sha_mock".into(),
            dry_run: false,
        })),
    };
    gateway.registry.send_to_agent("agent-dev-workflow", patch_frame).await.expect("Send patch failed");

    let recvd_patch = client.recv().await.expect("Recv failed").expect("Expected ApplyPatch");
    assert!(recvd_patch.payload.is_some());

    // 5. Client returns PatchResult
    let patch_res = TunnelClientFrame {
        frame_id: "res-patch-01".into(),
        agent_id: "agent-dev-workflow".into(),
        timestamp_unix_ms: 115,
        payload: Some(tunnel_client_frame::Payload::PatchResult(PatchResult {
            patch_id: "patch-101".into(),
            file_path: "src/lib.rs".into(),
            success: true,
            error_message: String::new(),
            new_sha256: "new_sha_mock".into(),
            lines_added: 1,
            lines_removed: 1,
        })),
    };
    client.send(patch_res).await.expect("Send patch result failed");

    let recvd_patch_res = gateway.recv_client_frame().await.expect("Gateway recv failed");
    match recvd_patch_res.payload {
        Some(tunnel_client_frame::Payload::PatchResult(res)) => {
            assert!(res.success);
            assert_eq!(res.lines_added, 1);
        }
        _ => panic!("Expected PatchResult"),
    }

    // 6. Clean teardown
    client.disconnect();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 0);

    gateway.shutdown();
}

/// Scenario 2: Remote Window & VNC Display Takeover End-to-End
#[tokio::test]
async fn test_tier4_scenario2_remote_window_and_vnc_takeover_e2e() {
    let mut display_tokens = HashMap::new();
    display_tokens.insert(1, "token-display-1".to_string());
    display_tokens.insert(2, "token-display-2".to_string());

    // User connects to Window Router on port 1339 requesting display 2 with token
    let decision = route_window_request(2, Some("token-display-2"), &display_tokens, true);
    assert_eq!(decision.status_code, 101); // 101 Switching Protocols
    assert!(decision.is_upgrade);
    assert_eq!(decision.target_port, Some(14002));

    // Gateway handles reverse tunnel for display event
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-vnc");
    client.connect().await.expect("Connect failed");

    let vnc_takeover = TunnelServerFrame {
        frame_id: "vnc-takeover-01".into(),
        timestamp_unix_ms: 200,
        payload: Some(tunnel_server_frame::Payload::DisplayTakeover(
            frostfire_proto::tunnel::DisplayTakeoverEvent {
                session_id: "display-session-2".into(),
                display_number: 2,
                action: frostfire_proto::tunnel::display_takeover_event::Action::UserFocused as i32,
            },
        )),
    };
    gateway.registry.send_to_agent("agent-vnc", vnc_takeover).await.expect("Send failed");

    let recvd = client.recv().await.expect("Recv failed").expect("Frame expected");
    match recvd.payload {
        Some(tunnel_server_frame::Payload::DisplayTakeover(ev)) => {
            assert_eq!(ev.display_number, 2);
            assert_eq!(ev.session_id, "display-session-2");
        }
        _ => panic!("Expected DisplayTakeover payload"),
    }

    client.disconnect();
    gateway.shutdown();
}

/// Scenario 3: Transient Network Partition & Auto-Recovery End-to-End
#[tokio::test]
async fn test_tier4_scenario3_transient_network_partition_recovery_e2e() {
    let token = "resilient-session-token";
    let gateway = MockGatewayHandle::start(Some(token.into())).await.expect("Bind failed");

    // Client connects
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-resilience")
        .with_bearer_token(token);
    client.connect().await.expect("Connect failed");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(gateway.registry.session_count().await, 1);

    // Network partition: connection dropped
    client.disconnect();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 0);

    // Client buffers pending work while disconnected
    let mut offline_queue = Vec::new();
    for i in 1..=3 {
        offline_queue.push(TunnelClientFrame {
            frame_id: format!("buffered-resilience-{}", i),
            agent_id: "agent-resilience".into(),
            timestamp_unix_ms: 300 + i,
            payload: Some(tunnel_client_frame::Payload::TerminalInput(TerminalInputChunk {
                session_id: "s-res".into(),
                data: format!("echo 'recovered {}'\n", i).into_bytes(),
                is_eof: false,
                resize: false,
                pty_rows: 24,
                pty_cols: 80,
            })),
        });
    }

    // Auto-recovery reconnect
    let mut recovered_client = SimulatedDesktopClient::new(gateway.url(), "agent-resilience")
        .with_bearer_token(token);
    recovered_client.connect().await.expect("Recovery connect failed");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(gateway.registry.session_count().await, 1);

    // Flush offline queue
    for frame in offline_queue.drain(..) {
        recovered_client.send(frame).await.expect("Flush failed");
        let recvd = gateway.recv_client_frame().await.expect("Gateway recv failed");
        assert!(recvd.payload.is_some());
    }

    recovered_client.disconnect();
    gateway.shutdown();
}

/// Scenario 4: Multi-Tenant Session & Security Isolation End-to-End
#[tokio::test]
async fn test_tier4_scenario4_multi_tenant_isolation_e2e() {
    let token_alpha = "tenant-token-alpha-prod";
    let token_beta = "tenant-token-beta-prod";

    // Test token distinctness
    assert!(!constant_time_compare(token_alpha.as_bytes(), token_beta.as_bytes()));

    // Network bridge subnets for both tenants are strictly separated
    let bridge_alpha = NetworkBridgeSpec::for_tap(0); // tap0: 172.16.0.0/24
    let bridge_beta = NetworkBridgeSpec::for_tap(1);  // tap1: 172.16.1.0/24

    assert_eq!(bridge_alpha.subnet_cidr, "172.16.0.0/24");
    assert_eq!(bridge_beta.subnet_cidr, "172.16.1.0/24");
    assert_ne!(bridge_alpha.subnet_cidr, bridge_beta.subnet_cidr);

    // Neither bridge allows public WAN forwarding or NAT masquerade
    assert!(bridge_alpha.satisfies_isolation_invariants());
    assert!(bridge_beta.satisfies_isolation_invariants());

    // Multi-tenant display token isolation
    let mut tokens = HashMap::new();
    tokens.insert(1, token_alpha.to_string());
    tokens.insert(2, token_beta.to_string());

    // Tenant Alpha cannot access Display 2 (Beta's display)
    let cross_access = route_window_request(2, Some(token_alpha), &tokens, false);
    assert_eq!(cross_access.status_code, 403);
    assert_eq!(cross_access.target_port, None);

    // Tenant Beta accesses Display 2 successfully
    let valid_access = route_window_request(2, Some(token_beta), &tokens, false);
    assert_eq!(valid_access.status_code, 200);
    assert_eq!(valid_access.target_port, Some(14002));
}

/// Scenario 5: Disaster Teardown & Resource Sweep End-to-End
#[tokio::test]
async fn test_tier4_scenario5_disaster_teardown_and_resource_sweep_e2e() {
    let gateway = MockGatewayHandle::start(None).await.expect("Bind failed");
    let mut client = SimulatedDesktopClient::new(gateway.url(), "agent-disaster");
    client.connect().await.expect("Connect failed");

    // Simulate microVM environment with supervisor watching process
    let mut supervisor = SupervisorCrashWatcher::new(3);

    // Process receives SIGKILL / sudden panic (exit code 137)
    supervisor.record_exit(137);
    match supervisor.state {
        SupervisorState::CrashLoopBackoff { attempt, backoff_secs } => {
            assert_eq!(attempt, 1);
            assert!(backoff_secs > 0);
        }
        _ => panic!("Expected backoff on crash"),
    }

    // Teardown: Gateway unregisters session
    client.disconnect();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gateway.registry.session_count().await, 0);

    // Simulate overlayfs upperdir and workdir teardown
    let cow = OverlayFsConfig::new(std::env::temp_dir().join("disaster_test"), "vm-disaster");
    assert!(cow.instance_upperdir.ends_with("upper"));
    assert!(cow.instance_workdir.ends_with("work"));

    gateway.shutdown();
}
