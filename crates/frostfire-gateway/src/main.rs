use clap::Parser;
use frostfire_gateway::{
    AccountDatabase, GatewayServer, InMemoryCreditStore, IngressTunnelBroker, LicenseAuthority,
};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::watch;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(
    name = "frostfire-gateway",
    about = "Frostfire Central Cloud Gateway (Area 2): OpenTunnel Broker, SaaS Metering & License Authority",
    version
)]
struct Args {
    /// Port for the Tonic gRPC OpenTunnel reverse stream broker
    #[arg(long, default_value_t = 50051, env = "GATEWAY_PORT")]
    grpc_port: u16,

    /// Port for HTTP REST management, Stripe webhooks, and health checks
    #[arg(long, default_value_t = 8080, env = "HTTP_PORT")]
    http_port: u16,

    /// Bind IP address for both gRPC and HTTP listeners
    #[arg(long, default_value = "0.0.0.0", env = "BIND_ADDR")]
    bind_addr: String,

    /// Path to the SQLite accounts and webhook audit database
    #[arg(
        long,
        default_value = "/var/lib/frostfire/accounts.db",
        env = "SQLITE_PATH"
    )]
    db_path: PathBuf,

    /// Environment identifier (e.g. production, staging, proxmox-poc)
    #[arg(long, default_value = "proxmox-poc", env = "ENVIRONMENT")]
    environment: String,

    /// Master window owner secret token for authenticating MicroVM tunnels
    #[arg(long, env = "FROSTFIRE_WINDOW_OWNER_TOKEN")]
    master_window_token: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,frostfire_gateway=debug".into()),
        )
        .init();

    let args = Args::parse();

    println!("============================================================");
    println!(">>> Starting Frostfire Central Gateway ({})", args.environment);
    println!(">>> gRPC OpenTunnel: {}:{}", args.bind_addr, args.grpc_port);
    println!(">>> HTTP Management: {}:{}", args.bind_addr, args.http_port);
    println!("============================================================");

    // 2. Resolve database directory with local fallback if root path is not writable
    let effective_db_path = if let Some(parent) = args.db_path.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            let fallback_dir = Path::new("./data");
            let _ = std::fs::create_dir_all(fallback_dir);
            let fallback_path = fallback_dir.join("accounts.db");
            warn!(
                target = %args.db_path.display(),
                fallback = %fallback_path.display(),
                "Cannot write to configured SQLite directory; using local fallback"
            );
            fallback_path
        } else {
            args.db_path
        }
    } else {
        args.db_path
    };

    // 3. Initialize SQLite Account Database
    info!(db_path = %effective_db_path.display(), "Opening SQLite Account Database");
    let db = AccountDatabase::open(&effective_db_path)
        .map_err(|e| format!("Failed to initialize database: {e}"))?;

    // 4. Initialize Credit Storage (In-memory hot cache for POC)
    let storage = Arc::new(InMemoryCreditStore::new());

    // 5. Initialize Ed25519 License Authority
    info!("Generating Ed25519 License Signing Authority");
    let authority = LicenseAuthority::generate()
        .map_err(|e| format!("Failed to generate license authority: {e}"))?;

    // 6. Initialize Ingress Tunnel Broker
    let broker = IngressTunnelBroker::new();

    let master_token_bytes = args.master_window_token.map(|t| t.into_bytes());

    // 7. Instantiate Central Gateway Server
    let server = Arc::new(GatewayServer::new(
        broker,
        db,
        storage,
        authority,
        args.environment,
        master_token_bytes,
        None, // In POC mode, Stripe flusher is idle until Stripe webhook is active
    ));

    // 8. Bind listener addresses
    let grpc_addr: SocketAddr = format!("{}:{}", args.bind_addr, args.grpc_port).parse()?;
    let http_addr: SocketAddr = format!("{}:{}", args.bind_addr, args.http_port).parse()?;

    // 9. Setup shutdown signal
    let (shutdown_tx, shutdown_rx) = watch::channel(());
    tokio::spawn(async move {
        match tokio::signal::ctrl_c().await {
            Ok(()) => {
                info!("Ctrl+C received, initiating shutdown");
                let _ = shutdown_tx.send(());
            }
            Err(err) => {
                warn!(%err, "Failed to listen for Ctrl+C");
            }
        }
    });

    server.run(grpc_addr, http_addr, shutdown_rx).await?;

    Ok(())
}
