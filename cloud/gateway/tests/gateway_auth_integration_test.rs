use std::time::Duration;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Channel;
use tonic::Code;

use frostfire_gateway::auth::UNAUTHENTICATED_MSG;
use frostfire_gateway::GatewayServerHandle;
use frostfire_proto::tunnel::agent_tunnel_service_client::AgentTunnelServiceClient;
use frostfire_proto::tunnel::{tunnel_client_frame, Heartbeat, TunnelClientFrame};
use frostfire_tunnel::{TunnelClient, TunnelConfig};

#[tokio::test]
async fn test_gateway_accepts_valid_bearer_token() {
    let token = "test-bearer-secret-999";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let tunnel_cfg = TunnelConfig::new(gateway.url(), "agent-bearer-ok")
        .with_auth_token(format!("Bearer {}", token))
        .with_connect_timeout(Duration::from_secs(5));

    let mut client = TunnelClient::connect(tunnel_cfg)
        .await
        .expect("TunnelClient should connect with valid bearer token");

    let hb_frame = TunnelClientFrame {
        frame_id: uuid::Uuid::new_v4().to_string(),
        agent_id: "agent-bearer-ok".into(),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 1,
            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
            agent_id: "agent-bearer-ok".into(),
            is_ack: false,
        })),
    };

    client.send(hb_frame).await.expect("Failed to send heartbeat");

    let resp = tokio::time::timeout(Duration::from_secs(3), client.recv())
        .await
        .expect("Timeout waiting for heartbeat ack")
        .expect("Expected frame from gateway");

    assert!(resp.payload.is_some(), "Gateway must respond with ack frame");
    gateway.shutdown();
}

#[tokio::test]
async fn test_gateway_accepts_valid_raw_token() {
    let token = "raw-secret-token-xyz";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let tunnel_cfg = TunnelConfig::new(gateway.url(), "agent-raw-ok")
        .with_auth_token(token)
        .with_connect_timeout(Duration::from_secs(5));

    let mut client = TunnelClient::connect(tunnel_cfg)
        .await
        .expect("TunnelClient should connect with valid raw token");

    let hb_frame = TunnelClientFrame {
        frame_id: uuid::Uuid::new_v4().to_string(),
        agent_id: "agent-raw-ok".into(),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 42,
            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
            agent_id: "agent-raw-ok".into(),
            is_ack: false,
        })),
    };

    client.send(hb_frame).await.expect("Failed to send heartbeat");

    let resp = tokio::time::timeout(Duration::from_secs(3), client.recv())
        .await
        .expect("Timeout waiting for heartbeat ack")
        .expect("Expected frame from gateway");

    assert!(resp.payload.is_some());
    gateway.shutdown();
}

#[tokio::test]
async fn test_gateway_accepts_valid_window_owner_token() {
    let token = "window-owner-secret-777";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Channel connect failed");

    let mut client = AgentTunnelServiceClient::new(channel);
    let (tx, rx) = mpsc::channel::<TunnelClientFrame>(16);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));

    req.metadata_mut()
        .insert("x-sand-window-owner", token.parse().unwrap());
    req.metadata_mut()
        .insert("x-agent-id", "window-owner-agent".parse().unwrap());

    let res = client.open_tunnel(req).await;
    assert!(res.is_ok(), "OpenTunnel should succeed with valid x-sand-window-owner header: {:?}", res.err());

    let mut stream = res.unwrap().into_inner();

    // Send a frame
    let frame = TunnelClientFrame {
        frame_id: "test-frame-1".into(),
        agent_id: "window-owner-agent".into(),
        timestamp_unix_ms: 1000,
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 1,
            timestamp_unix_ms: 1000,
            agent_id: "window-owner-agent".into(),
            is_ack: false,
        })),
    };
    tx.send(frame).await.unwrap();

    let ack = stream.message().await.unwrap();
    assert!(ack.is_some(), "Expected heartbeat ack from gateway");

    gateway.shutdown();
}

#[tokio::test]
async fn test_gateway_rejects_missing_token() {
    let token = "strict-tenant-token";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Channel connect failed");

    let mut client = AgentTunnelServiceClient::new(channel);
    let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(16);
    let req = tonic::Request::new(ReceiverStream::new(rx));

    let res = client.open_tunnel(req).await;
    assert!(res.is_err(), "OpenTunnel must fail when token is missing");

    let status = res.unwrap_err();
    assert_eq!(status.code(), Code::Unauthenticated);
    assert_eq!(status.message(), UNAUTHENTICATED_MSG);

    gateway.shutdown();
}

#[tokio::test]
async fn test_gateway_rejects_invalid_token() {
    let token = "correct-tenant-token";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Channel connect failed");

    let mut client = AgentTunnelServiceClient::new(channel);
    let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(16);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));
    req.metadata_mut()
        .insert("authorization", "Bearer forged-token".parse().unwrap());

    let res = client.open_tunnel(req).await;
    assert!(res.is_err(), "OpenTunnel must fail with invalid token");

    let status = res.unwrap_err();
    assert_eq!(status.code(), Code::Unauthenticated);
    assert_eq!(status.message(), UNAUTHENTICATED_MSG);

    gateway.shutdown();
}

#[tokio::test]
async fn test_gateway_rejects_empty_token() {
    let token = "correct-tenant-token";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind gateway");

    let channel = Channel::from_shared(gateway.url())
        .unwrap()
        .connect()
        .await
        .expect("Channel connect failed");

    let mut client = AgentTunnelServiceClient::new(channel);
    let (_tx, rx) = mpsc::channel::<TunnelClientFrame>(16);
    let mut req = tonic::Request::new(ReceiverStream::new(rx));
    req.metadata_mut()
        .insert("authorization", "Bearer ".parse().unwrap());

    let res = client.open_tunnel(req).await;
    assert!(res.is_err(), "OpenTunnel must fail with empty token");

    let status = res.unwrap_err();
    assert_eq!(status.code(), Code::Unauthenticated);
    assert_eq!(status.message(), UNAUTHENTICATED_MSG);

    gateway.shutdown();
}
