//! In-process gRPC test gateway implementing `AgentTunnelService` with strict tenant authentication

use std::collections::HashMap;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{mpsc, watch, Mutex, RwLock};
use tokio_stream::wrappers::{ReceiverStream, TcpListenerStream};
use tokio_stream::Stream;
use tonic::{Request, Response, Status, Streaming};

use frostfire_proto::tunnel::{
    agent_tunnel_service_server::{AgentTunnelService, AgentTunnelServiceServer},
    tunnel_client_frame, tunnel_server_frame, Heartbeat, TunnelClientFrame, TunnelServerFrame,
};

use crate::assertions::constant_time_compare;

/// Represents an active connected agent session in the mock gateway.
#[derive(Clone)]
pub struct MockSession {
    pub agent_id: String,
    pub out_tx: mpsc::Sender<Result<TunnelServerFrame, Status>>,
    pub connected_at_unix_ms: i64,
}

/// Registry holding active client sessions.
pub struct MockSessionRegistry {
    sessions: RwLock<HashMap<String, MockSession>>,
}

impl Default for MockSessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl MockSessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register(&self, agent_id: String, out_tx: mpsc::Sender<Result<TunnelServerFrame, Status>>) {
        let mut map = self.sessions.write().await;
        map.insert(
            agent_id.clone(),
            MockSession {
                agent_id,
                out_tx,
                connected_at_unix_ms: chrono::Utc::now().timestamp_millis(),
            },
        );
    }

    pub async fn unregister(&self, agent_id: &str) {
        let mut map = self.sessions.write().await;
        map.remove(agent_id);
    }

    pub async fn get(&self, agent_id: &str) -> Option<MockSession> {
        let map = self.sessions.read().await;
        map.get(agent_id).cloned()
    }

    pub async fn active_agents(&self) -> Vec<String> {
        let map = self.sessions.read().await;
        map.keys().cloned().collect()
    }

    pub async fn session_count(&self) -> usize {
        let map = self.sessions.read().await;
        map.len()
    }

    #[allow(clippy::result_large_err)]
    pub async fn send_to_agent(&self, agent_id: &str, frame: TunnelServerFrame) -> Result<(), Status> {
        let session = self.get(agent_id).await.ok_or_else(|| {
            Status::not_found(format!("Agent session '{}' not active", agent_id))
        })?;
        session
            .out_tx
            .send(Ok(frame))
            .await
            .map_err(|_| Status::unavailable("Agent session channel closed"))
    }
}

/// Configurable mock gateway service implementing `AgentTunnelService`.
pub struct AuthenticatedMockTunnelService {
    pub expected_token: Option<String>,
    pub registry: Arc<MockSessionRegistry>,
    pub client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
}

#[tonic::async_trait]
impl AgentTunnelService for AuthenticatedMockTunnelService {
    type OpenTunnelStream = Pin<Box<dyn Stream<Item = Result<TunnelServerFrame, Status>> + Send + 'static>>;

    async fn open_tunnel(
        &self,
        request: Request<Streaming<TunnelClientFrame>>,
    ) -> Result<Response<Self::OpenTunnelStream>, Status> {
        // Enforce constant-time tenant token validation if configured
        if let Some(ref expected) = self.expected_token {
            let metadata = request.metadata();
            let auth_header = metadata.get("authorization").and_then(|v| v.to_str().ok());
            let window_owner_header = metadata.get("x-sand-window-owner").and_then(|v| v.to_str().ok());

            let token = if let Some(bearer) = auth_header {
                if let Some(stripped) = bearer.strip_prefix("Bearer ") {
                    stripped
                } else {
                    bearer
                }
            } else if let Some(owner) = window_owner_header {
                owner
            } else {
                return Err(Status::unauthenticated("invalid or missing tenant token"));
            };

            if !constant_time_compare(token.as_bytes(), expected.as_bytes()) {
                return Err(Status::unauthenticated("invalid or missing tenant token"));
            }
        }

        let metadata_agent_id = request
            .metadata()
            .get("x-agent-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let mut in_stream = request.into_inner();
        let (out_tx, out_rx) = mpsc::channel(512);

        let registry = self.registry.clone();
        let event_tx = self.client_frame_tx.clone();

        tokio::spawn(async move {
            let mut current_agent_id = metadata_agent_id;
            if let Some(ref agent_id) = current_agent_id {
                registry.register(agent_id.clone(), out_tx.clone()).await;
            }

            while let Ok(Some(client_frame)) = in_stream.message().await {
                let agent_id = client_frame.agent_id.clone();

                if current_agent_id.is_none() && !agent_id.is_empty() {
                    current_agent_id = Some(agent_id.clone());
                    registry.register(agent_id.clone(), out_tx.clone()).await;
                }

                // Handle Heartbeat ping
                if let Some(tunnel_client_frame::Payload::Heartbeat(ref hb)) = client_frame.payload {
                    if !hb.is_ack {
                        let ack_frame = TunnelServerFrame {
                            frame_id: uuid::Uuid::new_v4().to_string(),
                            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                            payload: Some(tunnel_server_frame::Payload::Heartbeat(Heartbeat {
                                sequence: hb.sequence,
                                timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                                agent_id: agent_id.clone(),
                                is_ack: true,
                            })),
                        };
                        let _ = out_tx.send(Ok(ack_frame)).await;
                    }
                }

                if let Some(ref tx) = event_tx {
                    let _ = tx.send(client_frame).await;
                }
            }

            if let Some(agent_id) = current_agent_id {
                registry.unregister(&agent_id).await;
            }
        });

        let out_stream = ReceiverStream::new(out_rx);
        Ok(Response::new(Box::pin(out_stream)))
    }
}

/// Handle for running an in-process Mock Gateway server.
pub struct MockGatewayHandle {
    pub addr: SocketAddr,
    pub registry: Arc<MockSessionRegistry>,
    pub client_frame_rx: Arc<Mutex<mpsc::Receiver<TunnelClientFrame>>>,
    shutdown_tx: watch::Sender<bool>,
}

impl MockGatewayHandle {
    pub async fn start(expected_token: Option<String>) -> Result<Self, anyhow::Error> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let stream = TcpListenerStream::new(listener);

        let registry = Arc::new(MockSessionRegistry::new());
        let (client_frame_tx, client_frame_rx) = mpsc::channel(256);

        let service = AuthenticatedMockTunnelService {
            expected_token,
            registry: registry.clone(),
            client_frame_tx: Some(client_frame_tx),
        };

        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

        tokio::spawn(async move {
            let _ = tonic::transport::Server::builder()
                .add_service(AgentTunnelServiceServer::new(service))
                .serve_with_incoming_shutdown(stream, async move {
                    let _ = shutdown_rx.changed().await;
                })
                .await;
        });

        Ok(Self {
            addr,
            registry,
            client_frame_rx: Arc::new(Mutex::new(client_frame_rx)),
            shutdown_tx,
        })
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub async fn recv_client_frame(&self) -> Option<TunnelClientFrame> {
        let mut rx = self.client_frame_rx.lock().await;
        rx.recv().await
    }

    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
    }
}
