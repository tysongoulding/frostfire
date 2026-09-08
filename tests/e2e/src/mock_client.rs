//! Simulated Frostfire desktop client connecting over gRPC to `AgentTunnelService`

use std::time::Duration;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::metadata::MetadataValue;
use tonic::transport::Channel;

use frostfire_proto::tunnel::{
    agent_tunnel_service_client::AgentTunnelServiceClient,
    TunnelClientFrame, TunnelServerFrame,
};

/// Configurable test client for `AgentTunnelService.OpenTunnel`.
pub struct SimulatedDesktopClient {
    pub server_url: String,
    pub agent_id: String,
    pub auth_token: Option<String>,
    pub use_window_owner_header: bool,
    outbound_tx: Option<mpsc::Sender<TunnelClientFrame>>,
    inbound_rx: Option<tonic::Streaming<TunnelServerFrame>>,
}

impl SimulatedDesktopClient {
    pub fn new(server_url: impl Into<String>, agent_id: impl Into<String>) -> Self {
        Self {
            server_url: server_url.into(),
            agent_id: agent_id.into(),
            auth_token: None,
            use_window_owner_header: false,
            outbound_tx: None,
            inbound_rx: None,
        }
    }

    pub fn with_bearer_token(mut self, token: impl Into<String>) -> Self {
        self.auth_token = Some(token.into());
        self.use_window_owner_header = false;
        self
    }

    pub fn with_window_owner_token(mut self, token: impl Into<String>) -> Self {
        self.auth_token = Some(token.into());
        self.use_window_owner_header = true;
        self
    }

    /// Establishes the gRPC connection and calls `OpenTunnel`.
    #[allow(clippy::result_large_err)]
    pub async fn connect(&mut self) -> Result<(), tonic::Status> {
        let endpoint = Channel::from_shared(self.server_url.clone())
            .map_err(|e| tonic::Status::invalid_argument(e.to_string()))?;

        let channel = endpoint
            .connect_timeout(Duration::from_secs(5))
            .connect()
            .await
            .map_err(|e| tonic::Status::unavailable(e.to_string()))?;

        let mut grpc_client = AgentTunnelServiceClient::new(channel);

        let (outbound_tx, outbound_rx) = mpsc::channel(256);
        let outbound_stream = ReceiverStream::new(outbound_rx);
        let mut request = tonic::Request::new(outbound_stream);

        // Populate metadata headers
        if let Some(ref token) = self.auth_token {
            if self.use_window_owner_header {
                if let Ok(meta_val) = MetadataValue::try_from(token.as_str()) {
                    request.metadata_mut().insert("x-sand-window-owner", meta_val);
                }
            } else {
                let bearer = format!("Bearer {}", token);
                if let Ok(meta_val) = MetadataValue::try_from(bearer.as_str()) {
                    request.metadata_mut().insert("authorization", meta_val);
                }
            }
        }

        if let Ok(meta_val) = MetadataValue::try_from(self.agent_id.as_str()) {
            request.metadata_mut().insert("x-agent-id", meta_val);
        }

        let response = grpc_client.open_tunnel(request).await?;
        self.inbound_rx = Some(response.into_inner());
        self.outbound_tx = Some(outbound_tx);

        Ok(())
    }

    /// Sends a frame from client to server.
    pub async fn send(&self, frame: TunnelClientFrame) -> Result<(), anyhow::Error> {
        if let Some(ref tx) = self.outbound_tx {
            tx.send(frame).await.map_err(|_| anyhow::anyhow!("Outbound stream closed"))?;
            Ok(())
        } else {
            Err(anyhow::anyhow!("Client not connected"))
        }
    }

    /// Receives the next frame from the server stream.
    #[allow(clippy::result_large_err)]
    pub async fn recv(&mut self) -> Result<Option<TunnelServerFrame>, tonic::Status> {
        if let Some(ref mut rx) = self.inbound_rx {
            rx.message().await
        } else {
            Ok(None)
        }
    }

    /// Disconnects the client stream.
    pub fn disconnect(&mut self) {
        self.outbound_tx = None;
        self.inbound_rx = None;
    }
}
