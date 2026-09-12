use frostfire_proto::tunnel::TunnelServerFrame;
use std::collections::HashMap;
use std::sync::Arc;
use subtle::ConstantTimeEq;
use tokio::sync::{mpsc, RwLock};

use crate::error::GatewayError;

/// Constant-time verification of `x-frostfire-window-owner` token.
pub fn verify_tenant_window_token(provided_token: &[u8], expected_token: &[u8]) -> bool {
    if provided_token.is_empty() || expected_token.is_empty() {
        return false;
    }
    if provided_token.len() != expected_token.len() {
        return false;
    }
    provided_token.ct_eq(expected_token).into()
}

pub struct ActiveTunnelSession {
    pub tenant_id: String,
    pub session_id: String,
    pub tx: mpsc::Sender<TunnelServerFrame>,
    pub last_heartbeat_unix_ms: i64,
}

#[derive(Clone, Default)]
pub struct IngressTunnelBroker {
    tunnels: Arc<RwLock<HashMap<String, ActiveTunnelSession>>>,
    tenant_tokens: Arc<RwLock<HashMap<String, Vec<u8>>>>,
}

impl IngressTunnelBroker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers the authoritative window token for a tenant.
    pub async fn register_tenant_token(&self, tenant_id: &str, expected_token: &[u8]) {
        let mut guard = self.tenant_tokens.write().await;
        guard.insert(tenant_id.to_string(), expected_token.to_vec());
    }

    /// Authenticates incoming reverse stream using constant-time comparison.
    pub async fn authenticate_connection(&self, tenant_id: &str, provided_token: &[u8]) -> bool {
        let guard = self.tenant_tokens.read().await;
        if let Some(expected) = guard.get(tenant_id) {
            verify_tenant_window_token(provided_token, expected)
        } else {
            false
        }
    }

    /// Registers an active reverse tunnel stream established by a guest MicroVM.
    pub async fn register_tunnel(
        &self,
        tenant_id: &str,
        session_id: &str,
        tx: mpsc::Sender<TunnelServerFrame>,
    ) {
        let mut guard = self.tunnels.write().await;
        guard.insert(
            session_id.to_string(),
            ActiveTunnelSession {
                tenant_id: tenant_id.to_string(),
                session_id: session_id.to_string(),
                tx,
                last_heartbeat_unix_ms: chrono::Utc::now().timestamp_millis(),
            },
        );
    }

    /// Dispatches a server frame to a connected MicroVM reverse stream.
    pub async fn send_to_microvm(
        &self,
        session_id: &str,
        frame: TunnelServerFrame,
    ) -> Result<(), GatewayError> {
        let guard = self.tunnels.read().await;
        if let Some(session) = guard.get(session_id) {
            session
                .tx
                .send(frame)
                .await
                .map_err(|e| GatewayError::TunnelError(format!("Channel send error: {e}")))
        } else {
            Err(GatewayError::TunnelError(format!(
                "No active tunnel for session '{session_id}'"
            )))
        }
    }

    /// Updates heartbeat timestamp upon receiving client Ping or Frame.
    pub async fn record_heartbeat(&self, session_id: &str) {
        let mut guard = self.tunnels.write().await;
        if let Some(session) = guard.get_mut(session_id) {
            session.last_heartbeat_unix_ms = chrono::Utc::now().timestamp_millis();
        }
    }

    /// Removes tunnels that have timed out (heartbeat older than timeout_ms).
    pub async fn reap_dead_tunnels(&self, timeout_ms: i64) -> Vec<String> {
        let now = chrono::Utc::now().timestamp_millis();
        let mut guard = self.tunnels.write().await;
        let dead: Vec<String> = guard
            .iter()
            .filter(|(_, session)| (now - session.last_heartbeat_unix_ms) >= timeout_ms)
            .map(|(id, _)| id.clone())
            .collect();

        for id in &dead {
            guard.remove(id);
        }
        dead
    }

    /// Removes a specific tunnel session.
    pub async fn remove_tunnel(&self, session_id: &str) {
        let mut guard = self.tunnels.write().await;
        guard.remove(session_id);
    }

    /// Clears all active tunnel sessions.
    pub async fn clear_all_tunnels(&self) {
        let mut guard = self.tunnels.write().await;
        guard.clear();
    }

    /// Returns the number of currently active reverse tunnel streams.
    pub async fn active_tunnel_count(&self) -> usize {
        self.tunnels.read().await.len()
    }

    /// Lists active session IDs and their corresponding tenant IDs.
    pub async fn list_sessions(&self) -> Vec<(String, String)> {
        let guard = self.tunnels.read().await;
        guard
            .values()
            .map(|s| (s.tenant_id.clone(), s.session_id.clone()))
            .collect()
    }
}
