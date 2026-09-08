use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{mpsc, watch, Mutex};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::transport::{Identity, Server, ServerTlsConfig};

use frostfire_proto::tunnel::agent_tunnel_service_server::AgentTunnelServiceServer;
use frostfire_proto::tunnel::TunnelClientFrame;

use frostfire_orchestrator::{AgentTurnEngine, GeminiClient};
use crate::auth::TenantAuthenticator;
use crate::service::GatewayTunnelService;
use crate::session::SessionRegistry;

/// TLS certificate and private key configuration for the Cloud Gateway.
#[derive(Clone)]
pub struct GatewayTlsConfig {
    pub cert_pem: Vec<u8>,
    pub key_pem: Vec<u8>,
}

impl GatewayTlsConfig {
    pub fn new(cert_pem: impl Into<Vec<u8>>, key_pem: impl Into<Vec<u8>>) -> Self {
        Self {
            cert_pem: cert_pem.into(),
            key_pem: key_pem.into(),
        }
    }
}

/// Handle for a running in-process or managed Gateway server.
pub struct GatewayServerHandle {
    pub addr: SocketAddr,
    pub is_tls: bool,
    pub registry: Arc<SessionRegistry>,
    pub client_frame_rx: Arc<Mutex<mpsc::Receiver<TunnelClientFrame>>>,
    shutdown_tx: watch::Sender<bool>,
}

impl GatewayServerHandle {
    /// Binds an ephemeral local TCP port (127.0.0.1:0) and starts the gateway service with default turn engine and dev token.
    pub async fn bind_ephemeral() -> Result<Self, anyhow::Error> {
        let gemini = Arc::new(GeminiClient::from_env());
        let engine = Arc::new(AgentTurnEngine::new(gemini));
        let authenticator = Arc::new(TenantAuthenticator::default());
        Self::bind_with_options("127.0.0.1:0", Some(engine), authenticator, None).await
    }

    /// Binds an ephemeral local TCP port with an explicit tenant token and default turn engine.
    pub async fn bind_ephemeral_with_token(token: &str) -> Result<Self, anyhow::Error> {
        let gemini = Arc::new(GeminiClient::from_env());
        let engine = Arc::new(AgentTurnEngine::new(gemini));
        let authenticator = Arc::new(TenantAuthenticator::new(token));
        Self::bind_with_options("127.0.0.1:0", Some(engine), authenticator, None).await
    }

    /// Binds an ephemeral local port with TLS 1.3 enabled and explicit tenant token.
    pub async fn bind_ephemeral_tls(
        tls: GatewayTlsConfig,
        authenticator: Arc<TenantAuthenticator>,
    ) -> Result<Self, anyhow::Error> {
        let gemini = Arc::new(GeminiClient::from_env());
        let engine = Arc::new(AgentTurnEngine::new(gemini));
        Self::bind_with_options("127.0.0.1:0", Some(engine), authenticator, Some(tls)).await
    }

    /// Binds to a specific address and starts the gateway service with default turn engine and dev token.
    pub async fn bind(addr_str: &str) -> Result<Self, anyhow::Error> {
        let gemini = Arc::new(GeminiClient::from_env());
        let engine = Arc::new(AgentTurnEngine::new(gemini));
        let authenticator = Arc::new(TenantAuthenticator::default());
        Self::bind_with_options(addr_str, Some(engine), authenticator, None).await
    }

    /// Binds to an address with an optional explicit turn engine and default dev token.
    pub async fn bind_with_engine(
        addr_str: &str,
        turn_engine: Option<Arc<AgentTurnEngine>>,
    ) -> Result<Self, anyhow::Error> {
        let authenticator = Arc::new(TenantAuthenticator::default());
        Self::bind_with_options(addr_str, turn_engine, authenticator, None).await
    }

    /// Full builder: binds to an address with explicit turn engine, tenant authenticator, and optional TLS 1.3 config.
    pub async fn bind_with_options(
        addr_str: &str,
        turn_engine: Option<Arc<AgentTurnEngine>>,
        authenticator: Arc<TenantAuthenticator>,
        tls: Option<GatewayTlsConfig>,
    ) -> Result<Self, anyhow::Error> {
        let listener = tokio::net::TcpListener::bind(addr_str).await?;
        let addr = listener.local_addr()?;
        let stream = TcpListenerStream::new(listener);

        let registry = Arc::new(SessionRegistry::new());
        let (client_frame_tx, client_frame_rx) = mpsc::channel(256);
        let mut service = GatewayTunnelService::new(registry.clone(), Some(client_frame_tx), authenticator);
        if let Some(engine) = turn_engine {
            service = service.with_turn_engine(engine);
        }

        let is_tls = tls.is_some();
        let mut server_builder = Server::builder().tcp_nodelay(true);

        if let Some(tls_cfg) = tls {
            let _ = rustls::crypto::ring::default_provider().install_default();
            let identity = Identity::from_pem(tls_cfg.cert_pem, tls_cfg.key_pem);
            let tls_config = ServerTlsConfig::new().identity(identity);
            server_builder = server_builder.tls_config(tls_config)?;
        }

        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

        tokio::spawn(async move {
            let _ = server_builder
                .add_service(AgentTunnelServiceServer::new(service))
                .serve_with_incoming_shutdown(stream, async move {
                    let _ = shutdown_rx.changed().await;
                })
                .await;
        });

        Ok(Self {
            addr,
            is_tls,
            registry,
            client_frame_rx: Arc::new(Mutex::new(client_frame_rx)),
            shutdown_tx,
        })
    }

    /// Returns the URL (http:// or https://) of the bound gateway.
    pub fn url(&self) -> String {
        if self.is_tls {
            format!("https://{}", self.addr)
        } else {
            format!("http://{}", self.addr)
        }
    }

    /// Receives the next incoming client frame forwarded by the gateway.
    pub async fn recv_client_frame(&self) -> Option<TunnelClientFrame> {
        let mut rx = self.client_frame_rx.lock().await;
        rx.recv().await
    }

    /// Triggers graceful shutdown of the gateway server.
    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
    }
}
