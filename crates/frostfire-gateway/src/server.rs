use chrono::Utc;
use frostfire_proto::tunnel::{
    agent_tunnel_service_server::{AgentTunnelService, AgentTunnelServiceServer},
    tunnel_client_frame, tunnel_server_frame, Heartbeat, TunnelClientFrame, TunnelServerFrame,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Server;
use tonic::{Request, Response, Status, Streaming};
use tracing::{debug, error, info, warn};

use crate::auth::LicenseAuthority;
use crate::broker::{verify_tenant_window_token, IngressTunnelBroker};
use crate::db::AccountDatabase;
use crate::error::GatewayError;
use crate::metering::CreditStorage;
use crate::stripe::{StripeBillingFlusher, StripeWebhookHandler, WebhookResult};

/// gRPC implementation of `AgentTunnelService` for the Central Gateway.
pub struct GatewayTunnelService {
    broker: IngressTunnelBroker,
    master_window_token: Option<Vec<u8>>,
}

impl GatewayTunnelService {
    pub fn new(broker: IngressTunnelBroker, master_window_token: Option<Vec<u8>>) -> Self {
        Self {
            broker,
            master_window_token,
        }
    }
}

#[tonic::async_trait]
impl AgentTunnelService for GatewayTunnelService {
    type OpenTunnelStream = ReceiverStream<Result<TunnelServerFrame, Status>>;

    async fn open_tunnel(
        &self,
        request: Request<Streaming<TunnelClientFrame>>,
    ) -> Result<Response<Self::OpenTunnelStream>, Status> {
        let metadata = request.metadata();

        // Extract tenant ID
        let tenant_id = metadata
            .get("x-frostfire-tenant-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("default-tenant")
            .to_string();

        // Authenticate window owner token (x-frostfire-window-owner)
        let token_header = metadata.get("x-frostfire-window-owner");
        let authenticated = if let Some(token_val) = token_header {
            let token_bytes = token_val.as_bytes();
            if self.broker.authenticate_connection(&tenant_id, token_bytes).await {
                true
            } else if let Some(ref master) = self.master_window_token {
                verify_tenant_window_token(token_bytes, master)
            } else {
                // If no token registered for tenant and no master set, allow connection (POC mode)
                true
            }
        } else {
            self.master_window_token.is_none()
        };

        if !authenticated {
            warn!(tenant = %tenant_id, "Rejected unauthorized tunnel connection attempt");
            return Err(Status::unauthenticated(
                "Missing or invalid x-frostfire-window-owner token",
            ));
        }

        let session_id = format!("tun_{}", uuid::Uuid::new_v4());
        info!(tenant = %tenant_id, session = %session_id, "MicroVM reverse tunnel established");

        let (broker_tx, mut broker_rx) = mpsc::channel::<TunnelServerFrame>(128);
        let (stream_tx, stream_rx) = mpsc::channel::<Result<TunnelServerFrame, Status>>(128);

        self.broker
            .register_tunnel(&tenant_id, &session_id, broker_tx)
            .await;

        // Bridge broker messages to gRPC streaming response
        let forward_tx = stream_tx.clone();
        tokio::spawn(async move {
            while let Some(frame) = broker_rx.recv().await {
                if forward_tx.send(Ok(frame)).await.is_err() {
                    break;
                }
            }
        });

        let mut in_stream = request.into_inner();
        let broker = self.broker.clone();
        let sid = session_id.clone();
        let ack_tx = stream_tx.clone();

        tokio::spawn(async move {
            while let Ok(Some(client_frame)) = in_stream.message().await {
                broker.record_heartbeat(&sid).await;

                // Handle heartbeat pings by sending immediate pong ACKs
                if let Some(tunnel_client_frame::Payload::Heartbeat(ref hb)) = client_frame.payload {
                    if !hb.is_ack {
                        let ack = TunnelServerFrame {
                            frame_id: uuid::Uuid::new_v4().to_string(),
                            timestamp_unix_ms: Utc::now().timestamp_millis(),
                            payload: Some(tunnel_server_frame::Payload::Heartbeat(Heartbeat {
                                sequence: hb.sequence,
                                timestamp_unix_ms: Utc::now().timestamp_millis(),
                                agent_id: hb.agent_id.clone(),
                                is_ack: true,
                            })),
                        };
                        let _ = ack_tx.send(Ok(ack)).await;
                    }
                }
            }
            debug!(session = %sid, "Client reverse stream closed");
            broker.remove_tunnel(&sid).await;
        });

        Ok(Response::new(ReceiverStream::new(stream_rx)))
    }
}

/// Status and health payload returned by the HTTP API.
#[derive(Debug, Serialize, Deserialize)]
pub struct GatewayHealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
    pub active_tunnels: usize,
    pub total_accounts: usize,
    pub environment: String,
    pub hypervisor_mode: String,
}

/// Request payload for license token verification.
#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyLicenseRequest {
    pub token: String,
}

/// Standalone Central Gateway Server managing gRPC OpenTunnel and HTTP REST APIs.
pub struct GatewayServer {
    pub broker: IngressTunnelBroker,
    pub db: AccountDatabase,
    pub storage: Arc<dyn CreditStorage>,
    pub authority: LicenseAuthority,
    pub stripe_handler: StripeWebhookHandler,
    pub flusher: Option<Arc<StripeBillingFlusher>>,
    pub environment: String,
    pub master_window_token: Option<Vec<u8>>,
    start_time: std::time::Instant,
}

impl GatewayServer {
    pub fn new(
        broker: IngressTunnelBroker,
        db: AccountDatabase,
        storage: Arc<dyn CreditStorage>,
        authority: LicenseAuthority,
        environment: String,
        master_window_token: Option<Vec<u8>>,
        flusher: Option<Arc<StripeBillingFlusher>>,
    ) -> Self {
        let stripe_handler = StripeWebhookHandler::new(storage.clone(), db.clone(), authority.clone());
        Self {
            broker,
            db,
            storage,
            authority,
            stripe_handler,
            flusher,
            environment,
            master_window_token,
            start_time: std::time::Instant::now(),
        }
    }

    /// Runs the gateway services until shutdown signal is received.
    pub async fn run(
        self: Arc<Self>,
        grpc_addr: SocketAddr,
        http_addr: SocketAddr,
        mut shutdown_rx: watch::Receiver<()>,
    ) -> Result<(), GatewayError> {
        info!(
            %grpc_addr,
            %http_addr,
            env = %self.environment,
            "Starting Frostfire Central Gateway"
        );

        // 1. Start gRPC Server
        let tunnel_service = GatewayTunnelService::new(
            self.broker.clone(),
            self.master_window_token.clone(),
        );
        let (grpc_shutdown_tx, grpc_shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        let grpc_handle = tokio::spawn(async move {
            if let Err(e) = Server::builder()
                .add_service(AgentTunnelServiceServer::new(tunnel_service))
                .serve_with_shutdown(grpc_addr, async {
                    let _ = grpc_shutdown_rx.await;
                })
                .await
            {
                error!(error = %e, "gRPC server error");
            }
        });

        // 2. Start HTTP Server
        let http_listener = TcpListener::bind(http_addr)
            .await
            .map_err(|e| GatewayError::Internal(format!("Failed to bind HTTP {http_addr}: {e}")))?;

        let server_clone = self.clone();
        let (http_shutdown_tx, mut http_shutdown_rx) = tokio::sync::watch::channel(false);

        let http_handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept_res = http_listener.accept() => {
                        match accept_res {
                            Ok((socket, remote_addr)) => {
                                let s = server_clone.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = s.handle_http_connection(socket, remote_addr).await {
                                        debug!(error = %e, "HTTP connection error");
                                    }
                                });
                            }
                            Err(e) => {
                                debug!(error = %e, "HTTP accept error");
                            }
                        }
                    }
                    _ = http_shutdown_rx.changed() => {
                        break;
                    }
                }
            }
        });

        // 3. Optional 60-second Stripe Billing Flusher loop
        let flusher_clone = self.flusher.clone();
        let mut flusher_shutdown = shutdown_rx.clone();
        let flusher_handle = tokio::spawn(async move {
            if let Some(flusher) = flusher_clone {
                let mut interval = tokio::time::interval(Duration::from_secs(60));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            match flusher.flush_once().await {
                                Ok(count) => {
                                    if count > 0 {
                                        info!(flushed = count, "Flushed batched meter events to Stripe");
                                    }
                                }
                                Err(e) => {
                                    warn!(error = %e, "Error in background Stripe meter flusher");
                                }
                            }
                        }
                        _ = flusher_shutdown.changed() => {
                            break;
                        }
                    }
                }
            }
        });

        // Wait for shutdown signal
        let _ = shutdown_rx.changed().await;
        info!("Shutdown signal received. Stopping Frostfire Gateway...");

        self.broker.clear_all_tunnels().await;
        let _ = grpc_shutdown_tx.send(());
        let _ = http_shutdown_tx.send(true);

        let _ = tokio::join!(grpc_handle, http_handle, flusher_handle);
        info!("Frostfire Gateway stopped cleanly");
        Ok(())
    }

    /// Handles a single HTTP client connection.
    async fn handle_http_connection(
        &self,
        mut stream: tokio::net::TcpStream,
        _peer_addr: SocketAddr,
    ) -> Result<(), GatewayError> {
        let mut buffer = [0u8; 8192];
        let bytes_read = stream
            .read(&mut buffer)
            .await
            .map_err(|e| GatewayError::Internal(format!("Read error: {e}")))?;

        if bytes_read == 0 {
            return Ok(());
        }

        let request_str = String::from_utf8_lossy(&buffer[..bytes_read]);
        let mut lines = request_str.lines();
        let request_line = lines.next().unwrap_or("");
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("");

        // Extract body if present (after empty line \r\n\r\n)
        let body = if let Some(idx) = request_str.find("\r\n\r\n") {
            &request_str[idx + 4..]
        } else {
            ""
        };

        match (method, path) {
            ("GET", "/health") | ("GET", "/status") => {
                let active_tunnels = self.broker.active_tunnel_count().await;
                let total_accounts = self.db.count_accounts().unwrap_or(0);
                let uptime_seconds = self.start_time.elapsed().as_secs();

                let resp = GatewayHealthResponse {
                    status: "healthy".to_string(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    uptime_seconds,
                    active_tunnels,
                    total_accounts,
                    environment: self.environment.clone(),
                    hypervisor_mode: "proxmox-ve".to_string(),
                };

                let json_bytes = serde_json::to_vec(&resp)
                    .map_err(|e| GatewayError::Internal(e.to_string()))?;

                let headers = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                    json_bytes.len()
                );
                stream.write_all(headers.as_bytes()).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                stream.write_all(&json_bytes).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
            }

            ("POST", "/v1/license/verify") => {
                let verify_req: Result<VerifyLicenseRequest, _> = serde_json::from_str(body);
                match verify_req {
                    Ok(req) => match self.authority.verify_own_jwt(&req.token) {
                        Ok(claims) => {
                            let json_res = serde_json::json!({
                                "valid": true,
                                "claims": claims
                            });
                            let payload = serde_json::to_vec(&json_res).unwrap();
                            let headers = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                                payload.len()
                            );
                            stream.write_all(headers.as_bytes()).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                            stream.write_all(&payload).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                        }
                        Err(err) => {
                            let json_res = serde_json::json!({
                                "valid": false,
                                "error": format!("{err}")
                            });
                            let payload = serde_json::to_vec(&json_res).unwrap();
                            let headers = format!(
                                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                                payload.len()
                            );
                            stream.write_all(headers.as_bytes()).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                            stream.write_all(&payload).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                        }
                    },
                    Err(_) => {
                        let msg = b"{\"error\":\"Invalid JSON body; expected { token: string }\"}";
                        let headers = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            msg.len()
                        );
                        stream.write_all(headers.as_bytes()).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                        stream.write_all(msg).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                    }
                }
            }

            ("POST", "/v1/webhooks/stripe") => {
                match self.stripe_handler.handle_webhook_payload(body).await {
                    Ok(result) => {
                        let json_res = match result {
                            WebhookResult::AccountProvisioned { user_uuid, license_jwt } => {
                                serde_json::json!({
                                    "status": "provisioned",
                                    "user_uuid": user_uuid,
                                    "license_jwt": license_jwt
                                })
                            }
                            WebhookResult::SubscriptionUpdated { user_uuid, status } => {
                                serde_json::json!({
                                    "status": "subscription_updated",
                                    "user_uuid": user_uuid,
                                    "subscription_status": status
                                })
                            }
                            WebhookResult::SubscriptionCanceled { user_uuid } => {
                                serde_json::json!({
                                    "status": "subscription_canceled",
                                    "user_uuid": user_uuid
                                })
                            }
                            WebhookResult::InvoicePaid { user_uuid, refreshed_credits } => {
                                serde_json::json!({
                                    "status": "invoice_paid",
                                    "user_uuid": user_uuid,
                                    "refreshed_credits": refreshed_credits
                                })
                            }
                            WebhookResult::PaymentFailed { user_uuid } => {
                                serde_json::json!({
                                    "status": "payment_failed",
                                    "user_uuid": user_uuid
                                })
                            }
                            WebhookResult::IgnoredDuplicate => {
                                serde_json::json!({
                                    "status": "ignored_duplicate"
                                })
                            }
                            WebhookResult::IgnoredEventType(event_type) => {
                                serde_json::json!({
                                    "status": "ignored_event_type",
                                    "event_type": event_type
                                })
                            }
                        };
                        let payload = serde_json::to_vec(&json_res).unwrap();
                        let headers = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            payload.len()
                        );
                        stream.write_all(headers.as_bytes()).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                        stream.write_all(&payload).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                    }
                    Err(e) => {
                        let msg = format!("{{\"error\":\"{}\"}}", e);
                        let headers = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            msg.len()
                        );
                        stream.write_all(headers.as_bytes()).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                        stream.write_all(msg.as_bytes()).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                    }
                }
            }

            ("GET", "/v1/tunnels") => {
                let sessions = self.broker.list_sessions().await;
                let json_bytes = serde_json::to_vec(&sessions)
                    .map_err(|e| GatewayError::Internal(e.to_string()))?;
                let headers = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                    json_bytes.len()
                );
                stream.write_all(headers.as_bytes()).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
                stream.write_all(&json_bytes).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
            }

            _ => {
                let not_found = b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found";
                stream.write_all(not_found).await.map_err(|e| GatewayError::Internal(e.to_string()))?;
            }
        }

        stream.flush().await.map_err(|e| GatewayError::Internal(e.to_string()))?;
        Ok(())
    }
}
