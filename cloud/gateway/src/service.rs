use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::Stream;
use tonic::{Request, Response, Status, Streaming};

use frostfire_proto::tunnel::{
    self, agent_tunnel_service_server::AgentTunnelService, TunnelClientFrame, TunnelServerFrame,
};

use frostfire_orchestrator::AgentTurnEngine;
use crate::auth::TenantAuthenticator;
use crate::session::SessionRegistry;

pub struct GatewayTunnelService {
    registry: Arc<SessionRegistry>,
    client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
    authenticator: Arc<TenantAuthenticator>,
    turn_engine: Option<Arc<AgentTurnEngine>>,
}

impl GatewayTunnelService {
    pub fn new(
        registry: Arc<SessionRegistry>,
        client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
        authenticator: Arc<TenantAuthenticator>,
    ) -> Self {
        Self {
            registry,
            client_frame_tx,
            authenticator,
            turn_engine: None,
        }
    }

    pub fn new_with_default_auth(
        registry: Arc<SessionRegistry>,
        client_frame_tx: Option<mpsc::Sender<TunnelClientFrame>>,
    ) -> Self {
        Self::new(
            registry,
            client_frame_tx,
            Arc::new(TenantAuthenticator::default()),
        )
    }

    pub fn with_turn_engine(mut self, engine: Arc<AgentTurnEngine>) -> Self {
        self.turn_engine = Some(engine);
        self
    }
}

#[tonic::async_trait]
impl AgentTunnelService for GatewayTunnelService {
    type OpenTunnelStream = Pin<Box<dyn Stream<Item = Result<TunnelServerFrame, Status>> + Send + 'static>>;

    async fn open_tunnel(
        &self,
        request: Request<Streaming<TunnelClientFrame>>,
    ) -> Result<Response<Self::OpenTunnelStream>, Status> {
        // 1. Enforce constant-time tenant authentication before registering session or allocating resources
        self.authenticator.authenticate_metadata(request.metadata())?;

        // 2. Extract agent identity header
        let metadata_agent_id = request
            .metadata()
            .get("x-agent-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let mut in_stream = request.into_inner();
        let (out_tx, out_rx) = mpsc::channel(512);

        let registry = self.registry.clone();
        let event_tx = self.client_frame_tx.clone();
        let turn_engine = self.turn_engine.clone();

        tokio::spawn(async move {
            let mut current_agent_id = metadata_agent_id;
            let mut current_session_id = None;

            if let Some(ref agent_id) = current_agent_id {
                let sid = registry.register(agent_id.clone(), out_tx.clone()).await;
                current_session_id = Some(sid);
            }

            while let Ok(Some(client_frame)) = in_stream.message().await {
                let agent_id = client_frame.agent_id.clone();

                // Register session on first frame with valid agent_id if not already registered via metadata
                if current_agent_id.is_none() && !agent_id.is_empty() {
                    current_agent_id = Some(agent_id.clone());
                    let sid = registry.register(agent_id.clone(), out_tx.clone()).await;
                    current_session_id = Some(sid);
                }

                // Auto-reply to Heartbeat pings from clients
                if let Some(tunnel::tunnel_client_frame::Payload::Heartbeat(ref hb)) = client_frame.payload {
                    if !hb.is_ack {
                        let ack_frame = TunnelServerFrame {
                            frame_id: uuid::Uuid::new_v4().to_string(),
                            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                            payload: Some(tunnel::tunnel_server_frame::Payload::Heartbeat(
                                tunnel::Heartbeat {
                                    sequence: hb.sequence,
                                    timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                                    agent_id: agent_id.clone(),
                                    is_ack: true,
                                },
                            )),
                        };
                        let _ = out_tx.send(Ok(ack_frame)).await;
                    }
                }

                // Forward incoming client frame to swarm orchestrator queue if configured
                if let Some(ref tx) = event_tx {
                    let _ = tx.send(client_frame.clone()).await;
                }

                // Handle UserPrompt on the Cloud side (Zero API Key Leakage to client)
                if let Some(tunnel::tunnel_client_frame::Payload::UserPrompt(ref prompt)) = client_frame.payload {
                    if let Some(ref engine) = turn_engine {
                        let prompt_clone = prompt.clone();
                        let target_agent = agent_id.clone();
                        let tx = out_tx.clone();
                        let eng = engine.clone();

                        tokio::spawn(async move {
                            match eng.process_prompt(&prompt_clone, &target_agent).await {
                                Ok(plan) => {
                                    for frame in plan.server_frames_to_send {
                                        let _ = tx.send(Ok(frame)).await;
                                    }
                                }
                                Err(e) => {
                                    let err_msg = TunnelServerFrame {
                                        frame_id: uuid::Uuid::new_v4().to_string(),
                                        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                                        payload: Some(tunnel::tunnel_server_frame::Payload::ErrorFrame(
                                            format!("Cloud Turn Error: {}", e),
                                        )),
                                    };
                                    let _ = tx.send(Ok(err_msg)).await;
                                }
                            }
                        });
                    }
                }
            }

            // Client stream ended, unregister using session_id to avoid evicting a newly reconnected session
            if let (Some(agent_id), Some(sid)) = (current_agent_id, current_session_id) {
                registry.unregister_if_matching(&agent_id, sid).await;
            }
        });

        let out_stream = ReceiverStream::new(out_rx);
        Ok(Response::new(Box::pin(out_stream)))
    }
}
