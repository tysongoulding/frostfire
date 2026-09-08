use std::sync::Arc;
use std::time::Duration;
use tonic::transport::{Certificate, ClientTlsConfig};

use frostfire_gateway::auth::TenantAuthenticator;
use frostfire_gateway::{GatewayServerHandle, GatewayTlsConfig};
use frostfire_proto::tunnel::{tunnel_client_frame, Heartbeat, TunnelClientFrame};
use frostfire_tunnel::{TunnelClient, TunnelConfig};

const TEST_CERT_PEM: &str = include_str!("fixtures/cert.pem");
const TEST_KEY_PEM: &str = include_str!("fixtures/key.pem");

#[tokio::test]
async fn test_gateway_tls13_tunnel_connection() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let token = "tls-secret-token-123";
    let tls_config = GatewayTlsConfig::new(
        TEST_CERT_PEM.as_bytes().to_vec(),
        TEST_KEY_PEM.as_bytes().to_vec(),
    );
    let authenticator = Arc::new(TenantAuthenticator::new(token));

    let gateway = GatewayServerHandle::bind_ephemeral_tls(tls_config, authenticator)
        .await
        .expect("Failed to bind TLS gateway");

    assert!(gateway.url().starts_with("https://"));

    // Configure client with custom CA cert so self-signed cert is accepted
    let client_tls = ClientTlsConfig::new()
        .ca_certificate(Certificate::from_pem(TEST_CERT_PEM))
        .domain_name("localhost");

    let tunnel_cfg = TunnelConfig::new(gateway.url(), "agent-tls-client")
        .with_auth_token(format!("Bearer {}", token))
        .with_tls_config(client_tls)
        .with_connect_timeout(Duration::from_secs(5));

    let mut client = TunnelClient::connect(tunnel_cfg)
        .await
        .expect("Failed to connect via TLS 1.3");

    // Send a Heartbeat frame over TLS
    let hb_frame = TunnelClientFrame {
        frame_id: uuid::Uuid::new_v4().to_string(),
        agent_id: "agent-tls-client".into(),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 100,
            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
            agent_id: "agent-tls-client".into(),
            is_ack: false,
        })),
    };

    client.send(hb_frame).await.expect("Failed to send frame over TLS");

    let resp = tokio::time::timeout(Duration::from_secs(3), client.recv())
        .await
        .expect("Timeout waiting for TLS heartbeat ack")
        .expect("Expected frame from TLS gateway");

    assert!(resp.payload.is_some());
    gateway.shutdown();
}
