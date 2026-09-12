use clap::Parser;
use frostfire_mcp::{HttpPveTransport, JsonRpcRequest, ProxmoxConfig, ProxmoxMcpServer};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[derive(Parser, Debug)]
#[command(
    name = "frostfire-mcp-proxmox",
    about = "Model Context Protocol (MCP) Server for Proxmox VE Hypervisor Access",
    version
)]
struct Args {
    /// Proxmox VE base URL (e.g. "https://192.168.1.100:8006")
    #[arg(long, env = "PVE_ENDPOINT")]
    endpoint: String,

    /// Proxmox API Token ID (e.g. "agent@pam!frostfire")
    #[arg(long, env = "PVE_TOKEN_ID")]
    token_id: String,

    /// Proxmox API Token Secret UUID
    #[arg(long, env = "PVE_TOKEN_SECRET")]
    token_secret: String,

    /// Enforce TLS certificate verification (default false for self-signed certificates)
    #[arg(long, env = "PVE_VERIFY_SSL", default_value_t = false)]
    verify_ssl: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    let config = ProxmoxConfig::new(
        args.endpoint,
        args.token_id,
        args.token_secret,
        args.verify_ssl,
    );

    let transport = Arc::new(HttpPveTransport::new(config)?);
    let server = ProxmoxMcpServer::new(transport);

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    // Standard MCP stdio line-delimited JSON-RPC loop
    while let Ok(Some(line)) = reader.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(request) = serde_json::from_str::<JsonRpcRequest>(trimmed) {
            let response = server.handle_request(&request).await;
            if let Ok(mut resp_json) = serde_json::to_string(&response) {
                resp_json.push('\n');
                let _ = stdout.write_all(resp_json.as_bytes()).await;
                let _ = stdout.flush().await;
            }
        }
    }

    Ok(())
}
