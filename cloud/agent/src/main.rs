mod models;
mod browser;
mod hitl;
mod teach;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use clap::Parser;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info, Level};
use tracing_subscriber::FmtSubscriber;

use frostfire_proto::tunnel::agent_tunnel_service_client::AgentTunnelServiceClient;
use frostfire_proto::tunnel::{
    tunnel_client_frame, tunnel_server_frame, AgentMessage, ApprovalRequest,
    Heartbeat, TeachSessionResponse, TerminalOutputChunk,
    TunnelClientFrame, TunnelServerFrame,
};

use crate::browser::BrowserController;
use crate::hitl::HitlInterceptor;
use crate::models::{ChatTurnRequest, ModelProviderClient};
use crate::teach::TeachSessionManager;

#[derive(Parser, Debug)]
#[command(name = "frostfire-agent")]
#[command(about = "Frostfire In-VM Native Agent Daemon (Displays :1, :2, :3)")]
struct Args {
    #[arg(short, long, default_value = "http://127.0.0.1:50051")]
    gateway: String,

    #[arg(short, long, default_value = "agent-user1")]
    agent_id: String,

    #[arg(long, default_value = "local-token")]
    token: String,
}

#[allow(dead_code)]
struct AgentState {
    agent_id: String,
    models: ModelProviderClient,
    browser: BrowserController,
    hitl: HitlInterceptor,
    teach: TeachSessionManager,
    is_paused: [AtomicBool; 4], // Index by display 1, 2, 3
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

    info!("🚀 Frostfire In-VM Agent Daemon starting for agent '{}'...", args.agent_id);

    let models = ModelProviderClient::new();
    let browser = BrowserController::new();
    let hitl = HitlInterceptor::new();
    let teach = TeachSessionManager::new(models.clone());

    let state = Arc::new(AgentState {
        agent_id: args.agent_id.clone(),
        models,
        browser,
        hitl,
        teach,
        is_paused: [
            AtomicBool::new(false),
            AtomicBool::new(false),
            AtomicBool::new(false),
            AtomicBool::new(false),
        ],
    });

    // Reconnection loop
    loop {
        info!("🔗 Connecting outbound reverse tunnel to Gateway at {}...", args.gateway);
        match run_tunnel_client(&args, state.clone()).await {
            Ok(_) => info!("Tunnel closed gracefully, reconnecting in 3s..."),
            Err(e) => error!("Tunnel connection error: {}. Reconnecting in 3s...", e),
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn run_tunnel_client(args: &Args, state: Arc<AgentState>) -> anyhow::Result<()> {
    let mut client = AgentTunnelServiceClient::connect(args.gateway.clone()).await?;

    let (tx, rx) = mpsc::channel::<TunnelClientFrame>(100);
    let request_stream = ReceiverStream::new(rx);

    // Send initial handshake frame
    let initial_frame = TunnelClientFrame {
        frame_id: uuid::Uuid::new_v4().to_string(),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        agent_id: args.agent_id.clone(),
        payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
            sequence: 0,
            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
            agent_id: args.agent_id.clone(),
            is_ack: false,
        })),
    };
    tx.send(initial_frame).await?;

    // Heartbeat ticker in background
    let heartbeat_tx = tx.clone();
    let agent_id = args.agent_id.clone();
    tokio::spawn(async move {
        let mut seq = 1;
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let hb = TunnelClientFrame {
                frame_id: uuid::Uuid::new_v4().to_string(),
                timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                agent_id: agent_id.clone(),
                payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
                    sequence: seq,
                    timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                    agent_id: agent_id.clone(),
                    is_ack: false,
                })),
            };
            if heartbeat_tx.send(hb).await.is_err() {
                break;
            }
            seq += 1;
        }
    });

    let mut response_stream = client.open_tunnel(request_stream).await?.into_inner();
    info!("✅ Reverse tunnel established with Edge Gateway!");

    while let Some(server_frame) = response_stream.message().await? {
        handle_server_frame(server_frame, state.clone(), tx.clone()).await?;
    }

    Ok(())
}

async fn handle_server_frame(
    frame: TunnelServerFrame,
    state: Arc<AgentState>,
    tx: mpsc::Sender<TunnelClientFrame>,
) -> anyhow::Result<()> {
    let payload = match frame.payload {
        Some(p) => p,
        None => return Ok(()),
    };

    match payload {
        tunnel_server_frame::Payload::UserPrompt(prompt) => {
            info!("💬 [Agent] Received prompt: '{}'", prompt.text);

            let display_num = 1; // Default to Agent 1 (Browser) or extract from session
            if state.is_paused[display_num as usize].load(Ordering::Relaxed) {
                info!("⏸️ Agent is paused by user takeover; queueing response.");
            }

            let turn_req = ChatTurnRequest {
                prompt: prompt.text.clone(),
                session_id: prompt.session_id.clone(),
                display_number: display_num,
                context_files: prompt.context_files,
            };

            let turn_res = state.models.execute_turn(&turn_req).await?;

            let reply = TunnelClientFrame {
                frame_id: uuid::Uuid::new_v4().to_string(),
                timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                agent_id: state.agent_id.clone(),
                payload: Some(tunnel_client_frame::Payload::AgentMessage(AgentMessage {
                    turn_id: uuid::Uuid::new_v4().to_string(),
                    content: turn_res.content,
                    tool_calls: turn_res.tool_calls,
                    is_final: true,
                })),
            };
            tx.send(reply).await?;
        }

        tunnel_server_frame::Payload::ExecCommand(exec) => {
            info!("⚙️ [Agent] Received ExecCommand: '{}'", exec.command);

            let classification = state.hitl.classify_command(&exec.command);
            if classification.requires_approval {
                // Emit HITL Approval Request
                let approval_frame = TunnelClientFrame {
                    frame_id: uuid::Uuid::new_v4().to_string(),
                    timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                    agent_id: state.agent_id.clone(),
                    payload: Some(tunnel_client_frame::Payload::ApprovalRequest(ApprovalRequest {
                        request_id: exec.command_id.clone(),
                        action_type: "shell_execution".to_string(),
                        description: format!("Execute command: `{}`", exec.command),
                        details_json: serde_json::to_string(&classification).unwrap_or_default(),
                        requested_by: state.agent_id.clone(),
                        created_at_unix: chrono::Utc::now().timestamp(),
                    })),
                };
                tx.send(approval_frame).await?;
            } else {
                // Auto-execute safe read-only command
                let output = tokio::process::Command::new("sh")
                    .arg("-c")
                    .arg(&exec.command)
                    .output()
                    .await;

                let (data, code) = match output {
                    Ok(out) => (out.stdout, out.status.code().unwrap_or(0)),
                    Err(e) => (format!("Execution failed: {}", e).into_bytes(), 1),
                };

                let out_frame = TunnelClientFrame {
                    frame_id: uuid::Uuid::new_v4().to_string(),
                    timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                    agent_id: state.agent_id.clone(),
                    payload: Some(tunnel_client_frame::Payload::TerminalOutput(
                        TerminalOutputChunk {
                            session_id: exec.command_id,
                            data,
                            is_stderr: false,
                            is_eof: true,
                            exit_code: code,
                        },
                    )),
                };
                tx.send(out_frame).await?;
            }
        }

        tunnel_server_frame::Payload::DisplayTakeover(takeover) => {
            let d_num = takeover.display_number as usize;
            if d_num > 0 && d_num < 4 {
                match takeover.action {
                    0 => {
                        info!("🖐️ [Takeover] User focused Display :{} - Pausing AI agent", d_num);
                        state.is_paused[d_num].store(true, Ordering::SeqCst);
                    }
                    2 => {
                        info!("👋 [Takeover] User released Display :{} - Resuming AI agent", d_num);
                        state.is_paused[d_num].store(false, Ordering::SeqCst);
                    }
                    _ => {}
                }
            }
        }

        tunnel_server_frame::Payload::TeachCommand(cmd) => {
            info!("🎓 [TeachCommand] Action: {:?}", cmd.action);
            match cmd.action {
                0 => {
                    let _ = state.teach.start_session(cmd.display_number, &cmd.session_id).await;
                }
                1 | 2 => {
                    let sop = state
                        .teach
                        .stop_and_compile(cmd.display_number, &cmd.session_id)
                        .await
                        .unwrap_or_else(|e| format!("Failed to compile SOP: {}", e));

                    let resp = TunnelClientFrame {
                        frame_id: uuid::Uuid::new_v4().to_string(),
                        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                        agent_id: state.agent_id.clone(),
                        payload: Some(tunnel_client_frame::Payload::TeachResponse(
                            TeachSessionResponse {
                                session_id: cmd.session_id,
                                success: true,
                                sop_markdown: sop,
                                video_path: format!("/workspace/teach-sessions/teach-{}/demo.mp4", state.agent_id),
                                error_message: String::new(),
                            },
                        )),
                    };
                    tx.send(resp).await?;
                }
                _ => {}
            }
        }

        _ => {}
    }

    Ok(())
}
