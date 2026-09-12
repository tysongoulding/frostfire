use chrono::Utc;
use frostfire_gateway::{
    AccountDatabase, GatewayHealthResponse, GatewayServer, InMemoryCreditStore,
    IngressTunnelBroker, LicenseAuthority, LicenseClaims,
};
use frostfire_proto::tunnel::{
    agent_tunnel_service_client::AgentTunnelServiceClient,
    tunnel_client_frame, Heartbeat, TunnelClientFrame,
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tonic::transport::Channel;
use tonic::Request;

async fn get_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}

#[tokio::test]
async fn test_gateway_server_http_and_grpc_full_lifecycle() {
    let grpc_port = get_free_port().await;
    let http_port = get_free_port().await;

    let grpc_addr: SocketAddr = format!("127.0.0.1:{grpc_port}").parse().unwrap();
    let http_addr: SocketAddr = format!("127.0.0.1:{http_port}").parse().unwrap();

    let broker = IngressTunnelBroker::new();
    let db = AccountDatabase::open_in_memory().unwrap();
    let storage = Arc::new(InMemoryCreditStore::new());
    let authority = LicenseAuthority::generate().unwrap();

    let master_token = b"secret-proxmox-window-token-12345".to_vec();

    let server = Arc::new(GatewayServer::new(
        broker.clone(),
        db.clone(),
        storage.clone(),
        authority.clone(),
        "proxmox-poc".to_string(),
        Some(master_token.clone()),
        None,
    ));

    let (shutdown_tx, shutdown_rx) = watch::channel(());

    // Spawn the gateway server
    let server_handle = tokio::spawn(async move {
        server.run(grpc_addr, http_addr, shutdown_rx).await.unwrap();
    });

    // Allow listeners to bind
    tokio::time::sleep(Duration::from_millis(150)).await;

    // =========================================================================
    // 1. Test HTTP GET /health
    // =========================================================================
    let mut http_client = TcpStream::connect(http_addr).await.unwrap();
    let req = b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    http_client.write_all(req).await.unwrap();

    let mut resp_buf = vec![0u8; 4096];
    let n = http_client.read(&mut resp_buf).await.unwrap();
    let resp_str = String::from_utf8_lossy(&resp_buf[..n]);

    assert!(resp_str.contains("HTTP/1.1 200 OK"));
    assert!(resp_str.contains("\"status\":\"healthy\""));
    assert!(resp_str.contains("\"hypervisor_mode\":\"proxmox-ve\""));
    assert!(resp_str.contains("\"environment\":\"proxmox-poc\""));

    let body_start = resp_str.find("\r\n\r\n").unwrap() + 4;
    let health_json: GatewayHealthResponse = serde_json::from_str(&resp_str[body_start..]).unwrap();
    assert_eq!(health_json.status, "healthy");
    assert_eq!(health_json.active_tunnels, 0);

    // =========================================================================
    // 2. Test HTTP POST /v1/license/verify
    // =========================================================================
    let now = Utc::now().timestamp();
    let claims = LicenseClaims {
        sub: "usr_proxmox_eval".to_string(),
        email: "admin@homelab.local".to_string(),
        stripe_customer_id: "cus_proxmox_001".to_string(),
        tier: "pro".to_string(),
        iat: now,
        exp: now + 3600,
    };
    let valid_token = authority.mint_license_jwt(&claims).unwrap();

    // 2a. Verify valid token
    let mut verify_client = TcpStream::connect(http_addr).await.unwrap();
    let body = serde_json::json!({ "token": valid_token }).to_string();
    let post_req = format!(
        "POST /v1/license/verify HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    verify_client.write_all(post_req.as_bytes()).await.unwrap();

    let mut verify_resp_buf = vec![0u8; 4096];
    let n_v = verify_client.read(&mut verify_resp_buf).await.unwrap();
    let verify_str = String::from_utf8_lossy(&verify_resp_buf[..n_v]);
    assert!(verify_str.contains("HTTP/1.1 200 OK"));
    assert!(verify_str.contains("\"valid\":true"));
    assert!(verify_str.contains("usr_proxmox_eval"));

    // 2b. Verify invalid token fails
    let mut invalid_client = TcpStream::connect(http_addr).await.unwrap();
    let bad_body = serde_json::json!({ "token": "invalid.jwt.token" }).to_string();
    let bad_req = format!(
        "POST /v1/license/verify HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        bad_body.len(),
        bad_body
    );
    invalid_client.write_all(bad_req.as_bytes()).await.unwrap();

    let mut bad_resp_buf = vec![0u8; 4096];
    let n_b = invalid_client.read(&mut bad_resp_buf).await.unwrap();
    let bad_str = String::from_utf8_lossy(&bad_resp_buf[..n_b]);
    assert!(bad_str.contains("HTTP/1.1 401 Unauthorized"));
    assert!(bad_str.contains("\"valid\":false"));

    // =========================================================================
    // 3. Test HTTP POST /v1/webhooks/stripe
    // =========================================================================
    let mut stripe_http = TcpStream::connect(http_addr).await.unwrap();
    let webhook_body = r#"{
        "id": "evt_proxmox_test_001",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": "cus_proxmox_pve_1",
                "customer_details": { "email": "proxmox@frostfire.cloud" },
                "subscription": "sub_pve_pro",
                "metadata": {
                    "user_uuid": "usr_pve-5555-6666-7777-888899990000"
                }
            }
        }
    }"#;
    let stripe_req = format!(
        "POST /v1/webhooks/stripe HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        webhook_body.len(),
        webhook_body
    );
    stripe_http.write_all(stripe_req.as_bytes()).await.unwrap();

    let mut stripe_resp_buf = vec![0u8; 4096];
    let n_s = stripe_http.read(&mut stripe_resp_buf).await.unwrap();
    let stripe_str = String::from_utf8_lossy(&stripe_resp_buf[..n_s]);
    assert!(stripe_str.contains("HTTP/1.1 200 OK"));
    assert!(stripe_str.contains("\"status\":\"provisioned\""));
    assert!(stripe_str.contains("usr_pve-5555-6666-7777-888899990000"));

    // =========================================================================
    // 4. Test gRPC OpenTunnel Connection & Heartbeat Pong
    // =========================================================================
    let channel = Channel::from_shared(format!("http://127.0.0.1:{grpc_port}"))
        .unwrap()
        .connect()
        .await
        .unwrap();

    let mut grpc_client = AgentTunnelServiceClient::new(channel);

    // Create client outbound channel
    let (client_tx, client_rx) = tokio::sync::mpsc::channel::<TunnelClientFrame>(32);
    let outbound_stream = tokio_stream::wrappers::ReceiverStream::new(client_rx);

    // Prepare gRPC request with authorization header
    let mut grpc_req = Request::new(outbound_stream);
    grpc_req.metadata_mut().insert(
        "x-frostfire-window-owner",
        "secret-proxmox-window-token-12345".parse().unwrap(),
    );
    grpc_req.metadata_mut().insert(
        "x-frostfire-tenant-id",
        "tenant-proxmox-host".parse().unwrap(),
    );

    let response = grpc_client.open_tunnel(grpc_req).await.unwrap();
    let mut server_stream = response.into_inner();

    // Verify active tunnel count increments
    assert_eq!(broker.active_tunnel_count().await, 1);

    // Send a Heartbeat ping from client
    let ping = TunnelClientFrame {
        frame_id: "ping-frame-1".to_string(),
        timestamp_unix_ms: Utc::now().timestamp_millis(),
        agent_id: "agent-pve-microvm".to_string(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 42,
            timestamp_unix_ms: Utc::now().timestamp_millis(),
            agent_id: "agent-pve-microvm".to_string(),
            is_ack: false,
        })),
    };
    client_tx.send(ping).await.unwrap();

    // Expect automated Heartbeat ACK pong from gateway
    let ack_frame = tokio::time::timeout(Duration::from_secs(2), server_stream.message())
        .await
        .expect("Timeout waiting for heartbeat pong")
        .expect("Stream error")
        .expect("Stream closed prematurely");

    match ack_frame.payload {
        Some(frostfire_proto::tunnel::tunnel_server_frame::Payload::Heartbeat(hb)) => {
            assert!(hb.is_ack);
            assert_eq!(hb.sequence, 42);
            assert_eq!(hb.agent_id, "agent-pve-microvm");
        }
        other => panic!("Expected Heartbeat ACK, got {:?}", other),
    }

    // =========================================================================
    // 5. Test Graceful Server Shutdown
    // =========================================================================
    drop(client_tx);
    drop(server_stream);
    drop(grpc_client);
    tokio::time::sleep(Duration::from_millis(100)).await;

    shutdown_tx.send(()).unwrap();

    tokio::time::timeout(Duration::from_secs(3), server_handle)
        .await
        .expect("Server failed to shut down within 3s")
        .expect("Server panicked");
}
