use std::net::SocketAddr;
use std::sync::Arc;
use clap::Parser;
use tonic::transport::{Identity, Server, ServerTlsConfig};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use frostfire_gateway::auth::{TenantAuthenticator, DEFAULT_DEV_TENANT_TOKEN};
use frostfire_gateway::{GatewayTunnelService, SessionRegistry};
use frostfire_orchestrator::{AgentTurnEngine, GeminiClient};
use frostfire_proto::tunnel::agent_tunnel_service_server::AgentTunnelServiceServer;

#[derive(Parser, Debug)]
#[command(name = "frostfire-gateway")]
#[command(about = "Frostfire Edge Cloud Gateway: Ingress control plane for agent daemons")]
struct Args {
    #[arg(short, long, default_value = "0.0.0.0:50051")]
    bind: String,

    /// Tenant authorization token for ingress verification
    #[arg(long, env = "FROSTFIRE_TENANT_TOKEN")]
    tenant_token: Option<String>,

    /// Path to TLS server certificate PEM file (enables TLS 1.3)
    #[arg(long, env = "FROSTFIRE_TLS_CERT")]
    tls_cert: Option<String>,

    /// Path to TLS server private key PEM file
    #[arg(long, env = "FROSTFIRE_TLS_KEY")]
    tls_key: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let args = Args::parse();

    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .compact()
        .finish();
    tracing::subscriber::set_global_default(subscriber).ok();

    let addr: SocketAddr = args.bind.parse()?;
    let registry = Arc::new(SessionRegistry::new());
    let gemini = Arc::new(GeminiClient::from_env());
    let turn_engine = Arc::new(AgentTurnEngine::new(gemini));

    let token = args
        .tenant_token
        .or_else(|| std::env::var("FROSTFIRE_TENANT_TOKEN").ok())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_DEV_TENANT_TOKEN.to_string());

    let authenticator = Arc::new(TenantAuthenticator::new(token));
    let service = GatewayTunnelService::new(registry.clone(), None, authenticator)
        .with_turn_engine(turn_engine);

    let mut server_builder = Server::builder().tcp_nodelay(true);

    if let (Some(cert_path), Some(key_path)) = (args.tls_cert, args.tls_key) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let cert_pem = tokio::fs::read(cert_path).await?;
        let key_pem = tokio::fs::read(key_path).await?;
        let identity = Identity::from_pem(cert_pem, key_pem);
        let tls_config = ServerTlsConfig::new().identity(identity);
        server_builder = server_builder.tls_config(tls_config)?;
        info!("🔒 TLS 1.3 listener enabled on gateway");
    }

    info!("🚀 Frostfire Cloud Gateway starting on {}", addr);

    server_builder
        .add_service(AgentTunnelServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
