use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::metadata::{MetadataMap, MetadataValue};
use tonic::transport::Channel;
use tonic::Code;

use frostfire_gateway::auth::{
    extract_bearer_token, TenantAuthenticator, AUTH_HEADER_BEARER, AUTH_HEADER_WINDOW_OWNER,
    UNAUTHENTICATED_MSG,
};
use frostfire_gateway::GatewayServerHandle;
use frostfire_proto::tunnel::agent_tunnel_service_client::AgentTunnelServiceClient;
use frostfire_proto::tunnel::{tunnel_client_frame, Heartbeat, TunnelClientFrame};
use frostfire_tunnel::{TunnelClient, TunnelConfig};

// ============================================================================
// Group 1: Multi-Byte and Malformed Metadata Never Panics in Authenticator
// ============================================================================

#[test]
fn test_metadata_multibyte_authorization_never_panics_in_authenticator() {
    let token = "secure-tenant-key-777";
    let authenticator = TenantAuthenticator::new(token);

    // Matrix of malformed and multi-byte authorization header strings
    let malformed_auth_strings = vec![
        // Multi-byte character split exactly at byte index 7 (char spans across boundary)
        "123456\u{00E9}",                                 // 2-byte char spanning index 6..8
        "abcdef\u{00E9}",                                 // 2-byte char spanning index 6..8
        "1234\u{1F600}",                                   // 4-byte emoji spanning index 4..8
        "12345\u{4E2D}",                                   // 3-byte char spanning index 5..8
        " \u{1F600}abc",                                   // Leading space + emoji spanning index 1..5
        "b\u{1F600}xyz",                                   // 'b' + 4-byte emoji + 'xyz'
        "\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{00E9}", // Null bytes + multi-byte
        // "Bearer" variants with multi-byte chars and emojis
        "Bearer \u{1F600}",                                // Bearer + 4-byte emoji
        "bearer \u{00E9}",                                 // bearer + 2-byte char
        "BEARER \u{4E2D}\u{65E5}\u{672C}",                 // BEARER + 3-byte CJK chars
        "Bearer \u{1F525}\u{1F4A5}\u{1F980}",              // Bearer + fire/bomb/crab emojis
        "Bearer \u{FEFF}zero-width-space",                 // Bearer + BOM / zero-width space
        "Bearer \u{200B}\u{200C}\u{200D}",                 // Zero-width characters
        "Bearer \u{202E}reversed-text",                    // Right-to-left override
        "Bearer \u{00A0}non-breaking-space",               // Non-breaking space
        // Bearer prefix immediately followed by multi-byte without space
        "Bearer\u{00E9}",
        "Bearer\u{1F600}",
        "Bearer\u{4E2D}",
        // Strings shorter than 7 bytes with multi-byte chars
        "\u{1F600}",
        "\u{00E9}",
        "\u{4E2D}",
        "a\u{00E9}",
        "ab\u{00E9}",
        "abc\u{00E9}",
        "abcd\u{00E9}",
        // Edge cases
        "",
        " ",
        "       ",
        "Bearer",
        "bearer",
        "Bearer ",
        "bearer ",
        "BEARER ",
        "\0",
        "\0\0\0\0\0\0\0",
        "\t\r\n",
        "Bearer \0\0\0",
    ];

    for auth_val_str in malformed_auth_strings {
        let mut map = MetadataMap::new();

        if let Ok(meta) = MetadataValue::try_from(auth_val_str) {
            map.insert(AUTH_HEADER_BEARER, meta);
        }

        let res = std::panic::catch_unwind(AssertUnwindSafe(|| {
            authenticator.authenticate_metadata(&map)
        }));

        assert!(
            res.is_ok(),
            "authenticate_metadata panicked on authorization metadata: {:?}",
            auth_val_str
        );

        let call_res = res.unwrap();
        assert!(
            call_res.is_err(),
            "Malformed auth '{:?}' must be rejected",
            auth_val_str
        );

        let status = call_res.unwrap_err();
        assert_eq!(
            status.code(),
            Code::Unauthenticated,
            "Must return Code::Unauthenticated for auth '{:?}'",
            auth_val_str
        );
        assert_eq!(status.message(), UNAUTHENTICATED_MSG);
    }
}

#[test]
fn test_metadata_binary_headers_never_panic_in_authenticator() {
    let token = "secure-tenant-key-888";
    let authenticator = TenantAuthenticator::new(token);

    let binary_payloads: Vec<&[u8]> = vec![
        b"\x00\x01\x02\x03\x04\x05\x06\x07",
        b"\xff\xfe\xfd\xfc\xfb\xfa",
        b"Bearer \xff\xfe\xfd",
        b"Bearer \x80\x81\x82\x83",
        b"\xc3\xa9\xc3\xa8\xc3\xa0",
        b"\xf0\x9f\x98\x80",
        b"123456\xc3\xa9",
        b"12345\xe4\xb8\xad",
        b"1234\xf0\x9f\x98\x80",
        &[0xFF; 256],
        &[0x00; 128],
    ];

    for raw_bytes in binary_payloads {
        let mut map = MetadataMap::new();
        map.insert_bin("authorization-bin", MetadataValue::from_bytes(raw_bytes));
        map.insert_bin("x-sand-window-owner-bin", MetadataValue::from_bytes(raw_bytes));

        let res = std::panic::catch_unwind(AssertUnwindSafe(|| {
            authenticator.authenticate_metadata(&map)
        }));

        assert!(
            res.is_ok(),
            "authenticate_metadata panicked on binary metadata: {:?}",
            raw_bytes
        );

        let call_res = res.unwrap();
        assert!(call_res.is_err(), "Binary metadata without ASCII token must be rejected");
        let status = call_res.unwrap_err();
        assert_eq!(status.code(), Code::Unauthenticated);
        assert_eq!(status.message(), UNAUTHENTICATED_MSG);
    }
}

#[test]
fn test_metadata_multibyte_window_owner_never_panics_in_authenticator() {
    let token = "secure-tenant-key-999";
    let authenticator = TenantAuthenticator::new(token);

    let malformed_window_owners = vec![
        "\u{1F600}",
        "\u{00E9}",
        "\u{4E2D}\u{65E5}\u{672C}",
        "window-owner-\u{1F525}-token",
        "  \u{1F600}  ",
        "null",
        "undefined",
        "",
        " ",
        "\0",
        "\t\r\n",
        "secure-tenant-key-999\u{00E9}",
        "\u{00E9}secure-tenant-key-999",
    ];

    for owner_str in malformed_window_owners {
        let mut map = MetadataMap::new();
        if let Ok(meta) = MetadataValue::try_from(owner_str) {
            map.insert(AUTH_HEADER_WINDOW_OWNER, meta);
        }

        let res = std::panic::catch_unwind(AssertUnwindSafe(|| {
            authenticator.authenticate_metadata(&map)
        }));

        assert!(
            res.is_ok(),
            "authenticate_metadata panicked on window owner: {:?}",
            owner_str
        );

        let call_res = res.unwrap();
        assert!(call_res.is_err());
        assert_eq!(call_res.unwrap_err().code(), Code::Unauthenticated);
    }
}

// ============================================================================
// Group 2: Live Network gRPC Client with Malformed & Multi-Byte Metadata Matrix
// ============================================================================

#[tokio::test]
async fn test_grpc_server_live_network_multibyte_metadata_matrix() {
    let token = "live-network-tenant-token-2026";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Channel connect failed");

    let client_attempts = vec![
        ("authorization", "Bearer \u{1F600}"),
        ("authorization", "123456\u{00E9}"),
        ("authorization", "abcdef\u{00E9}"),
        ("authorization", "1234\u{1F600}"),
        ("authorization", "12345\u{4E2D}"),
        ("authorization", "Bearer "),
        ("authorization", "Bearer"),
        ("authorization", "bearer "),
        ("authorization", "BEARER "),
        ("x-sand-window-owner", "\u{1F600}"),
        ("x-sand-window-owner", "window-owner-\u{4E2D}"),
        ("x-sand-window-owner", "wrong-owner"),
    ];

    for (header_name, header_val) in client_attempts {
        let mut client = AgentTunnelServiceClient::new(channel.clone());
        let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(4);
        let mut req = tonic::Request::new(ReceiverStream::new(rx));

        if let Ok(meta_val) = MetadataValue::try_from(header_val) {
            req.metadata_mut().insert(header_name, meta_val);
        }

        let res = client.open_tunnel(req).await;
        assert!(
            res.is_err(),
            "Expected error for header {} = {:?}",
            header_name,
            header_val
        );

        let status = res.unwrap_err();
        assert_eq!(
            status.code(),
            Code::Unauthenticated,
            "Header {} = {:?} must return Code::Unauthenticated, got {:?}",
            header_name,
            header_val,
            status.code()
        );
        assert_eq!(status.message(), UNAUTHENTICATED_MSG);
    }

    // Verify the gateway is still healthy and responsive after all malformed attempts
    let mut verification_client = AgentTunnelServiceClient::new(channel);
    let (tx, rx) = mpsc::channel::<TunnelClientFrame>(4);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));
    req.metadata_mut()
        .insert("authorization", format!("Bearer {}", token).parse().unwrap());
    req.metadata_mut()
        .insert("x-agent-id", "agent-health-check".parse().unwrap());

    let res = verification_client.open_tunnel(req).await;
    assert!(res.is_ok(), "Gateway must remain responsive: {:?}", res.err());

    let mut stream = res.unwrap().into_inner();
    let hb = TunnelClientFrame {
        frame_id: "hb-verify".into(),
        timestamp_unix_ms: 100,
        agent_id: "agent-health-check".into(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 1,
            timestamp_unix_ms: 100,
            agent_id: "agent-health-check".into(),
            is_ack: false,
        })),
    };
    tx.send(hb).await.unwrap();

    let ack = tokio::time::timeout(Duration::from_secs(3), stream.message())
        .await
        .expect("Timeout waiting for heartbeat ack")
        .expect("Expected frame")
        .expect("Stream should not end");

    assert!(ack.payload.is_some());
    gateway.shutdown();
}

// ============================================================================
// Group 3: Extreme Concurrent Reconnect Storm (250 Rapid Cycles Under Load)
// ============================================================================

#[tokio::test]
async fn test_grpc_server_live_concurrent_reconnect_storm() {
    let token = "reconnect-storm-token-secret-123";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind ephemeral gateway");

    let agent_id = "agent-storm-target";
    let concurrency = 25;
    let iterations_per_task = 10;

    let successful_cycles = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();

    for task_id in 0..concurrency {
        let gateway_url = gateway.url();
        let agent_id_str = agent_id.to_string();
        let token_str = token.to_string();
        let success_counter = successful_cycles.clone();

        let handle = tokio::spawn(async move {
            for iter in 0..iterations_per_task {
                let tunnel_cfg = TunnelConfig::new(&gateway_url, &agent_id_str)
                    .with_auth_token(format!("Bearer {}", token_str))
                    .with_connect_timeout(Duration::from_secs(5));

                match TunnelClient::connect(tunnel_cfg).await {
                    Ok(mut client) => {
                        let hb = TunnelClientFrame {
                            frame_id: format!("hb-{}-{}-{}", task_id, iter, uuid::Uuid::new_v4()),
                            agent_id: agent_id_str.clone(),
                            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                            payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
                                sequence: (task_id * 1000 + iter) as i64,
                                timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                                agent_id: agent_id_str.clone(),
                                is_ack: false,
                            })),
                        };

                        if client.send(hb).await.is_ok() {
                            let _ = tokio::time::timeout(Duration::from_millis(500), client.recv()).await;
                        }

                        client.close().await;
                        success_counter.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        eprintln!("Task {} iter {} connect failed: {:?}", task_id, iter, e);
                    }
                }
            }
        });

        handles.push(handle);
    }

    for h in handles {
        h.await.expect("Concurrent task panicked");
    }

    let total = successful_cycles.load(Ordering::SeqCst);
    println!(
        "[CONCURRENT RECONNECT STORM] Completed {} / {} successful cycles under heavy contention",
        total,
        concurrency * iterations_per_task
    );

    assert!(
        total >= (concurrency * iterations_per_task * 85 / 100),
        "At least 85% of rapid reconnect cycles must succeed under contention (got {}/{})",
        total,
        concurrency * iterations_per_task
    );

    // Allow graceful unregistration to complete
    tokio::time::sleep(Duration::from_millis(800)).await;

    // Verify SessionRegistry is completely clean
    let active = gateway.registry.active_agents().await;
    println!("[SESSION REGISTRY] Active agents remaining after storm: {}", active.len());
    assert!(
        active.is_empty(),
        "All sessions must be cleanly unregistered when clients disconnect, found: {:?}",
        active
    );

    gateway.shutdown();
}

// ============================================================================
// Group 4: Fuzzing 5,000 Randomized Metadata Configurations for Panics
// ============================================================================

#[test]
fn test_grpc_metadata_fuzz_5000_combinations_never_panics() {
    let auth = TenantAuthenticator::new("fuzz-expected-tenant-token");

    let mut rng_seed: u64 = 0xdead_beef_cafe_1234;
    let mut xorshift = move || -> u64 {
        rng_seed ^= rng_seed << 13;
        rng_seed ^= rng_seed >> 7;
        rng_seed ^= rng_seed << 17;
        rng_seed
    };

    let sample_chars: Vec<char> = "Bearerbearer 0123456789\t\n\r\0éñαλщ中日€語😀🔥🦀🛡\u{FEFF}\u{200B}"
        .chars()
        .collect();

    let mut tested = 0;
    for _ in 0..5000 {
        let len = (xorshift() % 35) as usize;
        let mut s = String::with_capacity(len * 4);
        for _ in 0..len {
            let idx = (xorshift() as usize) % sample_chars.len();
            s.push(sample_chars[idx]);
        }

        // Test extract_bearer_token directly
        let res_extract = std::panic::catch_unwind(AssertUnwindSafe(|| {
            extract_bearer_token(&s)
        }));
        assert!(res_extract.is_ok(), "extract_bearer_token panicked on: {:?}", s);

        // Test validate_token
        let res_validate = std::panic::catch_unwind(AssertUnwindSafe(|| {
            auth.validate_token(&s)
        }));
        assert!(res_validate.is_ok(), "validate_token panicked on: {:?}", s);

        // Test authenticate_metadata with generated string
        let mut map = MetadataMap::new();
        if let Ok(meta) = MetadataValue::try_from(s.as_str()) {
            map.insert(AUTH_HEADER_BEARER, meta.clone());
            map.insert(AUTH_HEADER_WINDOW_OWNER, meta);
        }

        let res_auth = std::panic::catch_unwind(AssertUnwindSafe(|| {
            auth.authenticate_metadata(&map)
        }));
        assert!(res_auth.is_ok(), "authenticate_metadata panicked on: {:?}", s);

        tested += 1;
    }

    println!("[METADATA FUZZING] Successfully fuzzed {} randomized metadata configurations with 0 panics", tested);
}
