use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::metadata::MetadataValue;
use tonic::transport::{Certificate, Channel, ClientTlsConfig};
use tonic::Code;

use frostfire_gateway::auth::{TenantAuthenticator, UNAUTHENTICATED_MSG};
use frostfire_gateway::{GatewayServerHandle, GatewayTlsConfig};
use frostfire_proto::tunnel::agent_tunnel_service_client::AgentTunnelServiceClient;
use frostfire_proto::tunnel::*;
use frostfire_tunnel::{TunnelClient, TunnelConfig};

const TEST_CERT_PEM: &str = include_str!("fixtures/cert.pem");
const TEST_KEY_PEM: &str = include_str!("fixtures/key.pem");

// ============================================================================
// Group 1: Strict gRPC Error Invariants & Authentication Edge Cases
// ============================================================================

#[tokio::test]
async fn test_grpc_error_empty_metadata_strictly_unauthenticated() {
    let token = "expected-tenant-secret-100";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");

    let mut client = AgentTunnelServiceClient::new(channel);
    let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(16);
    let req = tonic::Request::new(ReceiverStream::new(rx));

    let res = client.open_tunnel(req).await;
    assert!(res.is_err(), "OpenTunnel with empty metadata must fail");

    let status = res.unwrap_err();
    assert_eq!(
        status.code(),
        Code::Unauthenticated,
        "Status code must strictly be Code::Unauthenticated"
    );
    assert_eq!(status.message(), UNAUTHENTICATED_MSG);

    gateway.shutdown();
}

#[tokio::test]
async fn test_grpc_error_missing_auth_with_other_headers() {
    let token = "expected-tenant-secret-101";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");

    let mut client = AgentTunnelServiceClient::new(channel);
    let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(16);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));

    // Include various normal headers but NO auth headers
    req.metadata_mut()
        .insert("x-agent-id", "agent-missing-auth".parse().unwrap());
    req.metadata_mut()
        .insert("user-agent", "frostfire-test-runner/1.0".parse().unwrap());
    req.metadata_mut()
        .insert("x-custom-meta", "some-arbitrary-value".parse().unwrap());

    let res = client.open_tunnel(req).await;
    assert!(res.is_err(), "OpenTunnel without auth headers must fail");

    let status = res.unwrap_err();
    assert_eq!(
        status.code(),
        Code::Unauthenticated,
        "Status code must strictly be Code::Unauthenticated"
    );
    assert_eq!(status.message(), UNAUTHENTICATED_MSG);

    gateway.shutdown();
}

#[tokio::test]
async fn test_grpc_error_corrupt_bearer_tokens_matrix() {
    let token = "valid-tenant-secret-404";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let corrupt_tokens = vec![
        "",
        "   ",
        "\t\r\n",
        "Bearer ",
        "Bearer   ",
        "Bearer \t\r\n",
        "bearer ",
        "BEARER ",
        "Bearer !!!@@@###$$$%%%^^^&&&***",
        "Bearer invalid_base64_====",
        "Bearer corrupted\x01\x02\x03token",
        "Basic dXNlcjpwYXNz",
        "Token some-token-string",
        "Bearer null",
        "Bearer undefined",
        "Bearer NaN",
        "Bearer false",
        "Bearer 0",
        "Bearer -1",
        "Bearer 🦀🔥⚡unicode-attack",
    ];

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");

    for candidate in corrupt_tokens {
        let mut client = AgentTunnelServiceClient::new(channel.clone());
        let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(4);
        let mut req = tonic::Request::new(ReceiverStream::new(rx));

        if let Ok(meta_val) = candidate.parse::<MetadataValue<tonic::metadata::Ascii>>() {
            req.metadata_mut().insert("authorization", meta_val);
        }

        let res = client.open_tunnel(req).await;
        assert!(
            res.is_err(),
            "Candidate token '{}' should have failed auth",
            candidate
        );

        let status = res.unwrap_err();
        assert_eq!(
            status.code(),
            Code::Unauthenticated,
            "Candidate '{}' must result in Code::Unauthenticated, got {:?}",
            candidate,
            status.code()
        );
        assert_eq!(status.message(), UNAUTHENTICATED_MSG);
    }

    gateway.shutdown();
}

#[tokio::test]
async fn test_grpc_error_corrupt_window_owner_tokens_matrix() {
    let token = "valid-tenant-secret-505";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let corrupt_owners = vec![
        "",
        "   ",
        "\t\r\n",
        "wrong-window-owner-token",
        "valid-tenant-secret-505-suffix",
        "prefix-valid-tenant-secret-505",
        "null",
        "undefined",
        "🦀🔥⚡invalid-owner",
    ];

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");

    for candidate in corrupt_owners {
        let mut client = AgentTunnelServiceClient::new(channel.clone());
        let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(4);
        let mut req = tonic::Request::new(ReceiverStream::new(rx));

        if let Ok(meta_val) = candidate.parse::<MetadataValue<tonic::metadata::Ascii>>() {
            req.metadata_mut().insert("x-sand-window-owner", meta_val);
        }

        let res = client.open_tunnel(req).await;
        assert!(
            res.is_err(),
            "Candidate window owner '{}' should have failed auth",
            candidate
        );

        let status = res.unwrap_err();
        assert_eq!(
            status.code(),
            Code::Unauthenticated,
            "Candidate '{}' must result in Code::Unauthenticated, got {:?}",
            candidate,
            status.code()
        );
        assert_eq!(status.message(), UNAUTHENTICATED_MSG);
    }

    gateway.shutdown();
}

#[tokio::test]
async fn test_grpc_error_binary_metadata_and_non_ascii_rejected() {
    let token = "valid-tenant-secret-606";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");

    let mut client = AgentTunnelServiceClient::new(channel);
    let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(4);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));

    // Insert binary metadata which standard bearer parser should never mistake for valid token
    req.metadata_mut().insert_bin(
        "authorization-bin",
        MetadataValue::from_bytes(b"\x00\x01\x02\x03\xff\xfe"),
    );

    let res = client.open_tunnel(req).await;
    assert!(res.is_err(), "Binary metadata without ASCII auth must fail");

    let status = res.unwrap_err();
    assert_eq!(
        status.code(),
        Code::Unauthenticated,
        "Status code must strictly be Code::Unauthenticated"
    );
    assert_eq!(status.message(), UNAUTHENTICATED_MSG);

    gateway.shutdown();
}

// ============================================================================
// Group 2: Large Frames, Streaming Limits, and Payload Edge Cases
// ============================================================================

#[tokio::test]
async fn test_grpc_streaming_large_frames_up_to_16mb_no_crash() {
    let token = "large-frame-tenant-token-707";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");

    // Configure client with 32MB max encoding and decoding limits
    let mut client = AgentTunnelServiceClient::new(channel.clone())
        .max_encoding_message_size(32 * 1024 * 1024)
        .max_decoding_message_size(32 * 1024 * 1024);

    let (tx, rx) = mpsc::channel::<TunnelClientFrame>(32);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));
    req.metadata_mut()
        .insert("authorization", format!("Bearer {}", token).parse().unwrap());
    req.metadata_mut()
        .insert("x-agent-id", "agent-large-frames".parse().unwrap());

    let res = client.open_tunnel(req).await;
    assert!(res.is_ok(), "OpenTunnel should succeed with valid auth");
    let _server_stream = res.unwrap().into_inner();

    // Test a progressive series of frame sizes up to 16MB:
    // 64KB, 512KB, 1MB, 2MB, 4MB, 8MB, 16MB
    let sizes_bytes = [
        64 * 1024,
        512 * 1024,
        1024 * 1024,
        2 * 1024 * 1024,
        4 * 1024 * 1024,
        8 * 1024 * 1024,
        16 * 1024 * 1024,
    ];

    for (idx, &size) in sizes_bytes.iter().enumerate() {
        let large_frame = TunnelClientFrame {
            frame_id: format!("large-frame-{}", idx),
            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
            agent_id: "agent-large-frames".into(),
            payload: Some(tunnel_client_frame::Payload::TerminalOutput(
                TerminalOutputChunk {
                    session_id: format!("sess-{}", idx),
                    data: vec![0x5A; size],
                    is_stderr: false,
                    is_eof: false,
                    exit_code: 0,
                },
            )),
        };

        let send_res = tx.send(large_frame).await;
        if send_res.is_err() {
            // Stream was terminated by server due to frame size limit (e.g. Tonic default 4MB)
            // Verify that this is a clean stream closure and NOT a server crash
            break;
        }

        // Give a short window for processing
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // CRITICAL INVARIANT: The gateway MUST NOT crash or panic.
    // Verify by creating a brand new client connection to the gateway and executing a heartbeat ping/pong.
    let mut verification_client = AgentTunnelServiceClient::new(channel);
    let (v_tx, v_rx) = mpsc::channel::<TunnelClientFrame>(4);
    let mut v_req = tonic::Request::new(ReceiverStream::new(v_rx));
    v_req
        .metadata_mut()
        .insert("authorization", format!("Bearer {}", token).parse().unwrap());
    v_req
        .metadata_mut()
        .insert("x-agent-id", "agent-verification".parse().unwrap());

    let v_res = verification_client.open_tunnel(v_req).await;
    assert!(
        v_res.is_ok(),
        "Gateway must remain fully operational and accept new connections after 16MB frames: {:?}",
        v_res.err()
    );

    let mut v_stream = v_res.unwrap().into_inner();
    let hb = TunnelClientFrame {
        frame_id: "post-stress-heartbeat".into(),
        timestamp_unix_ms: 1000,
        agent_id: "agent-verification".into(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 999,
            timestamp_unix_ms: 1000,
            agent_id: "agent-verification".into(),
            is_ack: false,
        })),
    };

    v_tx.send(hb).await.expect("Failed to send post-stress heartbeat");
    let ack = tokio::time::timeout(Duration::from_secs(3), v_stream.message())
        .await
        .expect("Timeout waiting for heartbeat ack after stress test")
        .expect("Expected frame")
        .expect("Stream should not have ended");

    assert!(ack.payload.is_some(), "Gateway responded normally to heartbeat");
    gateway.shutdown();
}

#[tokio::test]
async fn test_grpc_streaming_invalid_frame_payloads_no_crash() {
    let token = "invalid-payload-tenant-token-808";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Failed to connect channel");

    let mut client = AgentTunnelServiceClient::new(channel.clone());
    let (tx, rx) = mpsc::channel::<TunnelClientFrame>(32);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));
    req.metadata_mut()
        .insert("authorization", format!("Bearer {}", token).parse().unwrap());
    req.metadata_mut()
        .insert("x-agent-id", "agent-invalid-payloads".parse().unwrap());

    let res = client.open_tunnel(req).await;
    assert!(res.is_ok());
    let mut stream = res.unwrap().into_inner();

    // 1. Frame with payload: None
    let frame_none = TunnelClientFrame {
        frame_id: "".into(),
        timestamp_unix_ms: 0,
        agent_id: "".into(),
        payload: None,
    };
    tx.send(frame_none).await.unwrap();

    // 2. Frame with extreme timestamp values
    let frame_min_time = TunnelClientFrame {
        frame_id: "time-min".into(),
        timestamp_unix_ms: i64::MIN,
        agent_id: "agent-invalid-payloads".into(),
        payload: None,
    };
    tx.send(frame_min_time).await.unwrap();

    let frame_max_time = TunnelClientFrame {
        frame_id: "time-max".into(),
        timestamp_unix_ms: i64::MAX,
        agent_id: "agent-invalid-payloads".into(),
        payload: None,
    };
    tx.send(frame_max_time).await.unwrap();

    // 3. TerminalOutput with empty session and invalid exit code
    let frame_term = TunnelClientFrame {
        frame_id: "term-invalid".into(),
        timestamp_unix_ms: -100,
        agent_id: "agent-invalid-payloads".into(),
        payload: Some(tunnel_client_frame::Payload::TerminalOutput(
            TerminalOutputChunk {
                session_id: "".into(),
                data: vec![],
                is_stderr: true,
                is_eof: true,
                exit_code: -99999,
            },
        )),
    };
    tx.send(frame_term).await.unwrap();

    // 4. ApplyPatch with malformed sha256 and diff
    let frame_patch = TunnelClientFrame {
        frame_id: "patch-invalid".into(),
        timestamp_unix_ms: 12345,
        agent_id: "agent-invalid-payloads".into(),
        payload: Some(tunnel_client_frame::Payload::ApplyPatch(ApplyPatch {
            patch_id: "".into(),
            file_path: "/etc/passwd".into(),
            diff: "bogus diff content not a patch".into(),
            expected_sha256: "not-a-valid-sha".into(),
            dry_run: false,
        })),
    };
    tx.send(frame_patch).await.unwrap();

    // 5. McpInvokeRequest with corrupt JSON arguments
    let frame_mcp = TunnelClientFrame {
        frame_id: "mcp-corrupt-json".into(),
        timestamp_unix_ms: 54321,
        agent_id: "agent-invalid-payloads".into(),
        payload: Some(tunnel_client_frame::Payload::McpRequest(McpInvokeRequest {
            invocation_id: "inv-1".into(),
            server_name: "test-server".into(),
            tool_name: "test-tool".into(),
            arguments_json: "{corrupted json syntax without closing".into(),
            timeout_seconds: 0,
        })),
    };
    tx.send(frame_mcp).await.unwrap();

    // 6. ApprovalRequest with malformed details JSON
    let frame_approval = TunnelClientFrame {
        frame_id: "approval-malformed".into(),
        timestamp_unix_ms: 9999,
        agent_id: "agent-invalid-payloads".into(),
        payload: Some(tunnel_client_frame::Payload::ApprovalRequest(
            ApprovalRequest {
                request_id: "".into(),
                action_type: "UNKNOWN".into(),
                description: "".into(),
                details_json: "<<<XML NOT JSON>>>".into(),
                requested_by: "".into(),
                created_at_unix: -1,
            },
        )),
    };
    tx.send(frame_approval).await.unwrap();

    // 7. DisplayTakeoverEvent with out-of-range action enum
    let frame_display = TunnelClientFrame {
        frame_id: "display-bad-action".into(),
        timestamp_unix_ms: 100,
        agent_id: "agent-invalid-payloads".into(),
        payload: Some(tunnel_client_frame::Payload::DisplayTakeover(
            DisplayTakeoverEvent {
                session_id: "".into(),
                display_number: 9999,
                action: 999, // out of enum bounds
            },
        )),
    };
    tx.send(frame_display).await.unwrap();

    // 8. UserPrompt with empty fields
    let frame_prompt = TunnelClientFrame {
        frame_id: "prompt-empty".into(),
        timestamp_unix_ms: 200,
        agent_id: "agent-invalid-payloads".into(),
        payload: Some(tunnel_client_frame::Payload::UserPrompt(UserPrompt {
            prompt_id: "".into(),
            text: "".into(),
            session_id: "".into(),
            context_files: Default::default(),
        })),
    };
    tx.send(frame_prompt).await.unwrap();

    // Verify stream is still alive and gateway responds to heartbeat ping
    let hb = TunnelClientFrame {
        frame_id: "liveness-check".into(),
        timestamp_unix_ms: 500,
        agent_id: "agent-invalid-payloads".into(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 1,
            timestamp_unix_ms: 500,
            agent_id: "agent-invalid-payloads".into(),
            is_ack: false,
        })),
    };
    tx.send(hb).await.unwrap();

    let ack = tokio::time::timeout(Duration::from_secs(3), stream.message())
        .await
        .expect("Timeout waiting for heartbeat ack after invalid frames")
        .expect("Expected frame")
        .expect("Stream should be active");

    assert!(ack.payload.is_some());
    gateway.shutdown();
}

#[tokio::test]
async fn test_grpc_streaming_raw_garbage_socket_disconnect_resilience() {
    let token = "raw-socket-tenant-token-909";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    // 1. Connect raw TCP stream and send arbitrary garbage bytes
    let mut tcp = TcpStream::connect(gateway.addr)
        .await
        .expect("Failed to connect TCP stream");
    let garbage = vec![0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x11, 0x22, 0x33, 0x44];
    let _ = tcp.write_all(&garbage).await;
    let _ = tcp.shutdown().await;
    drop(tcp);

    // 2. Connect another TCP stream and abruptly close without sending anything
    let tcp2 = TcpStream::connect(gateway.addr).await;
    drop(tcp2);

    // 3. Verify gateway is still completely healthy and accepts valid gRPC traffic
    let tunnel_cfg = TunnelConfig::new(gateway.url(), "agent-healthy-after-raw")
        .with_auth_token(format!("Bearer {}", token))
        .with_connect_timeout(Duration::from_secs(5));

    let mut client = TunnelClient::connect(tunnel_cfg)
        .await
        .expect("TunnelClient must connect successfully after raw garbage attacks");

    let hb = TunnelClientFrame {
        frame_id: "hb-verify".into(),
        agent_id: "agent-healthy-after-raw".into(),
        timestamp_unix_ms: 100,
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 1,
            timestamp_unix_ms: 100,
            agent_id: "agent-healthy-after-raw".into(),
            is_ack: false,
        })),
    };
    client.send(hb).await.expect("Failed to send heartbeat");

    let ack = tokio::time::timeout(Duration::from_secs(3), client.recv())
        .await
        .expect("Timeout waiting for ack")
        .expect("Expected frame");

    assert!(ack.payload.is_some());
    gateway.shutdown();
}

// ============================================================================
// Group 3: TLS 1.3 Handshake Failures and Certificate Validation
// ============================================================================

#[tokio::test]
async fn test_tls_rejects_plain_http_connection() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let token = "tls-secret-token-test-1";
    let tls_config = GatewayTlsConfig::new(
        TEST_CERT_PEM.as_bytes().to_vec(),
        TEST_KEY_PEM.as_bytes().to_vec(),
    );
    let authenticator = Arc::new(TenantAuthenticator::new(token));

    let gateway = GatewayServerHandle::bind_ephemeral_tls(tls_config, authenticator)
        .await
        .expect("Failed to bind TLS gateway");

    // Attempt plain HTTP gRPC request to TLS server
    let plain_url = format!("http://{}", gateway.addr);
    let channel = Channel::from_shared(plain_url)
        .unwrap()
        .connect_timeout(Duration::from_secs(2))
        .connect()
        .await
        .expect("TCP level connection succeeds");

    let mut client = AgentTunnelServiceClient::new(channel);
    let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(4);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));
    req.metadata_mut()
        .insert("authorization", format!("Bearer {}", token).parse().unwrap());

    let rpc_res = client.open_tunnel(req).await;
    assert!(
        rpc_res.is_err(),
        "Plain HTTP gRPC request to TLS endpoint must be rejected at TLS layer"
    );

    gateway.shutdown();
}

#[tokio::test]
async fn test_tls_rejects_untrusted_ca_certificate() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let token = "tls-secret-token-test-2";
    let tls_config = GatewayTlsConfig::new(
        TEST_CERT_PEM.as_bytes().to_vec(),
        TEST_KEY_PEM.as_bytes().to_vec(),
    );
    let authenticator = Arc::new(TenantAuthenticator::new(token));

    let gateway = GatewayServerHandle::bind_ephemeral_tls(tls_config, authenticator)
        .await
        .expect("Failed to bind TLS gateway");

    // Connect via HTTPS without trusting self-signed cert (using native roots)
    let tunnel_cfg = TunnelConfig::new(gateway.url(), "agent-untrusted-ca")
        .with_auth_token(format!("Bearer {}", token))
        .with_connect_timeout(Duration::from_secs(2));

    let res = TunnelClient::connect(tunnel_cfg).await;
    assert!(
        res.is_err(),
        "Connecting without self-signed CA cert must fail TLS verification"
    );

    gateway.shutdown();
}

#[tokio::test]
async fn test_tls_rejects_wrong_domain_name() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let token = "tls-secret-token-test-3";
    let tls_config = GatewayTlsConfig::new(
        TEST_CERT_PEM.as_bytes().to_vec(),
        TEST_KEY_PEM.as_bytes().to_vec(),
    );
    let authenticator = Arc::new(TenantAuthenticator::new(token));

    let gateway = GatewayServerHandle::bind_ephemeral_tls(tls_config, authenticator)
        .await
        .expect("Failed to bind TLS gateway");

    // Configure client with custom CA cert but an invalid domain name (SAN mismatch)
    let client_tls = ClientTlsConfig::new()
        .ca_certificate(Certificate::from_pem(TEST_CERT_PEM))
        .domain_name("attacker.unauthorized.domain.org");

    let tunnel_cfg = TunnelConfig::new(gateway.url(), "agent-wrong-domain")
        .with_auth_token(format!("Bearer {}", token))
        .with_tls_config(client_tls)
        .with_connect_timeout(Duration::from_secs(2));

    let res = TunnelClient::connect(tunnel_cfg).await;
    assert!(
        res.is_err(),
        "Connecting with mismatched domain name must fail TLS verification"
    );

    gateway.shutdown();
}

#[tokio::test]
async fn test_tls_server_survives_garbage_client_hello_and_serves_valid_client() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let token = "tls-secret-token-test-4";
    let tls_config = GatewayTlsConfig::new(
        TEST_CERT_PEM.as_bytes().to_vec(),
        TEST_KEY_PEM.as_bytes().to_vec(),
    );
    let authenticator = Arc::new(TenantAuthenticator::new(token));

    let gateway = GatewayServerHandle::bind_ephemeral_tls(tls_config, authenticator)
        .await
        .expect("Failed to bind TLS gateway");

    // 1. Send garbage bytes to TLS port (simulating malformed ClientHello or port scanner)
    let mut tcp = TcpStream::connect(gateway.addr)
        .await
        .expect("Failed to connect TCP to TLS port");
    let garbage_tls = vec![0x16, 0x03, 0x01, 0x00, 0x05, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    let _ = tcp.write_all(&garbage_tls).await;
    let _ = tcp.shutdown().await;
    drop(tcp);

    // Give server event loop a moment to handle the TLS handshake error
    tokio::time::sleep(Duration::from_millis(50)).await;

    // 2. Connect a legitimate TLS 1.3 client with correct CA, domain, and token
    let client_tls = ClientTlsConfig::new()
        .ca_certificate(Certificate::from_pem(TEST_CERT_PEM))
        .domain_name("localhost");

    let tunnel_cfg = TunnelConfig::new(gateway.url(), "agent-valid-tls")
        .with_auth_token(format!("Bearer {}", token))
        .with_tls_config(client_tls)
        .with_connect_timeout(Duration::from_secs(5));

    let mut client = TunnelClient::connect(tunnel_cfg)
        .await
        .expect("Legitimate TLS client must connect after TLS handshake failures");

    let hb = TunnelClientFrame {
        frame_id: "tls-liveness-check".into(),
        agent_id: "agent-valid-tls".into(),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 555,
            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
            agent_id: "agent-valid-tls".into(),
            is_ack: false,
        })),
    };

    client.send(hb).await.expect("Failed to send TLS frame");
    let ack = tokio::time::timeout(Duration::from_secs(3), client.recv())
        .await
        .expect("Timeout waiting for TLS ack")
        .expect("Expected frame");

    assert!(ack.payload.is_some(), "TLS gateway responded with ack");
    gateway.shutdown();
}
