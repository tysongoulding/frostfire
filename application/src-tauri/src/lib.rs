pub mod commands;
pub mod keystore;
pub mod oauth;
pub mod paths;
pub mod permissions;
pub mod protocol;
pub mod screen_context;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::RwLock;

use commands::{
    close_window, create_agent_session, delete_agent_session, evaluate_host_security,
    execute_command, execute_remote_cloud_command, fetch_all_provider_models, fetch_provider_models,
    get_blackboard_manifest, get_blackboard_presentation, get_cached_models, get_cloud_agents,
    get_dag_state, get_dynamic_screen_context, get_prompt_config, get_saved_auth_keys,
    get_tunnel_status, list_active_session_grants, list_agent_sessions, load_lota_settings,
    minimize_window, open_external_url, open_local_path,
    respond_hitl_approval, revoke_session_grant, save_custom_prompt, save_lota_settings,
    search_web, send_agent_turn, send_rpc_command, set_display_takeover, start_drag_window,
    start_oauth_login, submit_host_security_decision, sync_provider_keys, test_provider_key,
    toggle_maximize_window, trigger_teach_session, update_dag_task_status, verify_invariants,
    AppState,
};
use frostfire_core::blackboard::BlackboardStore;
use frostfire_core::dag::WorkstreamDag;
use frostfire_engine::resilience::CircuitBreaker;
use frostfire_engine::routing::ModelRouter;
use frostfire_proto::tunnel::{
    blackboard_sync_frame, tunnel_client_frame, tunnel_server_frame, BlackboardSyncFrame,
    TunnelClientFrame,
};
use frostfire_tunnel::{TunnelClient, TunnelConfig};
use keystore::SecureKeystore;
use paths::AppPaths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = AppPaths::resolve().expect("Failed to resolve app paths");
    let _ = paths.ensure_directories();

    let blackboard = Arc::new(BlackboardStore::new_with_persistence(
        paths.blackboard_dir.clone(),
    ));
    let keystore = SecureKeystore::new();
    let router = ModelRouter::default();
    let circuit_breaker = CircuitBreaker::default();
    let total_hours_saved = Arc::new(RwLock::new(0.0));

    // Resolve cloud gateway URL and agent id for reverse tunnel
    let server_url = std::env::var("FROSTFIRE_SERVER_URL")
        .or_else(|_| std::env::var("EC2_AGENT_HOST").map(|h| format!("http://{}:50051", h)))
        .unwrap_or_else(|_| "http://44.242.94.86:50051".to_string());
    let agent_id = format!("desktop-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);

    let tunnel_config = TunnelConfig::new(&server_url, &agent_id)
        .with_heartbeat_interval(Some(std::time::Duration::from_secs(10)))
        .with_reconnect_policy(
            std::time::Duration::from_millis(500),
            std::time::Duration::from_secs(30),
            1.5,
            None,
        );

    let tunnel = TunnelClient::start(tunnel_config).expect("Failed to start tunnel client");
    let (outbound_tx, mut inbound_rx, tunnel_handle) = tunnel.split();

    let dag_store = Arc::new(RwLock::new(HashMap::<String, WorkstreamDag>::new()));
    let recent_remote_hashes = Arc::new(RwLock::new(HashSet::<String>::new()));
    let tunnel_handle_arc = Arc::new(RwLock::new(Some(tunnel_handle)));

    let workspace_root = std::env::current_dir().unwrap_or_else(|_| paths.app_data_dir.clone());
    let permissions = Arc::new(permissions::HostPermissionEngine::new(workspace_root));

    let app_state = AppState {
        paths,
        keystore,
        blackboard: blackboard.clone(),
        dag_store: dag_store.clone(),
        router,
        circuit_breaker,
        total_hours_saved,
        tunnel_tx: outbound_tx.clone(),
        tunnel_handle: tunnel_handle_arc.clone(),
        recent_remote_hashes: recent_remote_hashes.clone(),
        cloud_server_url: server_url.clone(),
        permissions,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(move |app| {
            // Task A: Outbound Blackboard Signal Bridge
            let mut signal_rx = blackboard.subscribe_signals();
            let tx_clone = outbound_tx.clone();
            let bb_clone = blackboard.clone();
            let remote_hashes_clone = recent_remote_hashes.clone();
            let agent_id_clone = agent_id.clone();

            tokio::spawn(async move {
                while let Ok(signal) = signal_rx.recv().await {
                    // Echo Loop Suppression
                    {
                        let mut hashes = remote_hashes_clone.write().await;
                        if hashes.remove(&signal.content_hash) {
                            tracing::debug!(hash = %signal.content_hash, "Echo loop suppressed for cloud-originated artifact");
                            continue;
                        }
                    }

                    if let Ok(art) = bb_clone.get(&signal.uri).await {
                        let frame = TunnelClientFrame {
                            frame_id: format!("bb-sync-{}", uuid::Uuid::new_v4()),
                            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                            agent_id: agent_id_clone.clone(),
                            payload: Some(tunnel_client_frame::Payload::BlackboardSync(
                                BlackboardSyncFrame {
                                    uri: art.uri,
                                    author_id: art.author_id,
                                    title: art.title,
                                    content: art.content,
                                    mime_type: art.mime_type,
                                    version: art.version,
                                    hash: art.hash,
                                    timestamp_unix_ms: art.created_at.timestamp_millis(),
                                    action: blackboard_sync_frame::Action::Published as i32,
                                },
                            )),
                        };
                        let _ = tx_clone.send(frame).await;
                    }
                }
            });

            // Task B: Inbound Server Frame Processor
            let bb_inbound = blackboard.clone();
            let dag_inbound = dag_store.clone();
            let remote_hashes_inbound = recent_remote_hashes.clone();
            let app_handle = app.handle().clone();

            tokio::spawn(async move {
                while let Some(server_frame) = inbound_rx.recv().await {
                    let Some(payload) = server_frame.payload else { continue; };
                    match payload {
                        tunnel_server_frame::Payload::BlackboardSync(sync) => {
                            {
                                let mut hashes = remote_hashes_inbound.write().await;
                                hashes.insert(sync.hash.clone());
                            }

                            if let Ok(art) = frostfire_core::blackboard::BlackboardArtifact::new(
                                &sync.uri,
                                &sync.author_id,
                                &sync.title,
                                &sync.content,
                                &sync.mime_type,
                            ) {
                                let _ = bb_inbound.publish(&sync.author_id, art).await;
                            }

                            let _ = app_handle.emit("frostfire://blackboard-signal", serde_json::json!({
                                "uri": sync.uri,
                                "author_id": sync.author_id,
                                "title": sync.title,
                                "version": sync.version,
                                "hash": sync.hash,
                                "action": sync.action,
                            }));
                        }
                        tunnel_server_frame::Payload::DagSync(sync) => {
                            let status = match sync.status {
                                1 => frostfire_core::dag::TaskStatus::Ready,
                                2 => frostfire_core::dag::TaskStatus::Running,
                                3 => frostfire_core::dag::TaskStatus::Completed,
                                4 => frostfire_core::dag::TaskStatus::Failed,
                                _ => frostfire_core::dag::TaskStatus::Pending,
                            };

                            {
                                let mut map = dag_inbound.write().await;
                                let dag = map.entry(sync.workstream_id.clone()).or_insert_with(|| {
                                    frostfire_core::dag::WorkstreamDag::new(&sync.workstream_id)
                                });
                                if let Some(node) = dag.nodes.get_mut(&sync.task_id) {
                                    node.status = status;
                                } else {
                                    let mut node = frostfire_core::dag::TaskNode::new(&sync.task_id, &sync.title, &sync.agent_id);
                                    node.status = status;
                                    node.input_uris = sync.input_uris.clone();
                                    node.output_uris = sync.output_uris.clone();
                                    dag.add_node(node);
                                }
                            }

                            let _ = app_handle.emit("frostfire://dag-event", serde_json::json!({
                                "workstream_id": sync.workstream_id,
                                "task_id": sync.task_id,
                                "title": sync.title,
                                "agent_id": sync.agent_id,
                                "status": sync.status,
                                "input_uris": sync.input_uris,
                                "output_uris": sync.output_uris,
                            }));
                        }
                        tunnel_server_frame::Payload::AgentMessage(msg) => {
                            let _ = app_handle.emit("frostfire://agent-message", serde_json::json!({
                                "turn_id": msg.turn_id,
                                "content": msg.content,
                                "tool_calls": msg.tool_calls,
                                "is_final": msg.is_final,
                            }));
                        }
                        tunnel_server_frame::Payload::ApprovalRequest(req) => {
                            let _ = app_handle.emit("frostfire://approval-request", serde_json::json!({
                                "request_id": req.request_id,
                                "action_type": req.action_type,
                                "description": req.description,
                                "details_json": req.details_json,
                                "requested_by": req.requested_by,
                                "created_at_unix": req.created_at_unix,
                            }));
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            execute_command,
            start_drag_window,
            minimize_window,
            toggle_maximize_window,
            close_window,
            open_local_path,
            open_external_url,
            sync_provider_keys,
            get_saved_auth_keys,
            test_provider_key,
            fetch_provider_models,
            fetch_all_provider_models,
            get_cached_models,
            start_oauth_login,
            load_lota_settings,
            save_lota_settings,
            search_web,
            send_rpc_command,
            get_prompt_config,
            save_custom_prompt,
            get_blackboard_manifest,
            get_blackboard_presentation,
            verify_invariants,
            get_cloud_agents,
            set_display_takeover,
            trigger_teach_session,
            respond_hitl_approval,
            send_agent_turn,
            list_agent_sessions,
            create_agent_session,
            delete_agent_session,
            execute_remote_cloud_command,
            get_tunnel_status,
            get_dag_state,
            update_dag_task_status,
            get_dynamic_screen_context,
            evaluate_host_security,
            submit_host_security_decision,
            list_active_session_grants,
            revoke_session_grant,
        ])
        .run(tauri::generate_context!())
        .expect("error while running frostfireOS desktop application");
}
