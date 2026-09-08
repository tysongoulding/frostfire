use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{info, warn};

use frostfire_proto::tunnel::TunnelServerFrame;

type FrameSender = mpsc::Sender<Result<TunnelServerFrame, tonic::Status>>;

#[derive(Debug, Clone)]
pub struct AgentSession {
    pub session_id: uuid::Uuid,
    pub agent_id: String,
    pub connected_at_unix_ms: i64,
}

#[derive(Default)]
pub struct SessionRegistry {
    sessions: Arc<RwLock<HashMap<String, (AgentSession, FrameSender)>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(&self, agent_id: String, sender: FrameSender) -> uuid::Uuid {
        let session_id = uuid::Uuid::new_v4();
        let session = AgentSession {
            session_id,
            agent_id: agent_id.clone(),
            connected_at_unix_ms: chrono::Utc::now().timestamp_millis(),
        };
        let mut map = self.sessions.write().await;
        info!(agent_id = %agent_id, session_id = %session_id, "Agent tunnel session registered in gateway");
        map.insert(agent_id, (session, sender));
        session_id
    }

    pub async fn unregister_if_matching(&self, agent_id: &str, session_id: uuid::Uuid) -> bool {
        let mut map = self.sessions.write().await;
        if let Some((session, _)) = map.get(agent_id) {
            if session.session_id == session_id {
                map.remove(agent_id);
                info!(agent_id = %agent_id, session_id = %session_id, "Agent tunnel session unregistered from gateway");
                return true;
            }
        }
        false
    }

    pub async fn unregister(&self, agent_id: &str) {
        let mut map = self.sessions.write().await;
        if map.remove(agent_id).is_some() {
            info!(agent_id = %agent_id, "Agent tunnel session unregistered from gateway");
        }
    }

    pub async fn send_to_agent(&self, agent_id: &str, frame: TunnelServerFrame) -> Result<(), String> {
        let sender = {
            let map = self.sessions.read().await;
            map.get(agent_id).map(|(_, s)| s.clone())
        };

        if let Some(sender) = sender {
            sender
                .send(Ok(frame))
                .await
                .map_err(|e| format!("Failed to send frame to agent {}: {}", agent_id, e))
        } else {
            Err(format!("Agent session not found for id: {}", agent_id))
        }
    }

    pub async fn broadcast(&self, frame: TunnelServerFrame) {
        let senders: Vec<(String, FrameSender)> = {
            let map = self.sessions.read().await;
            map.iter().map(|(id, (_, s))| (id.clone(), s.clone())).collect()
        };

        for (agent_id, sender) in senders {
            if let Err(e) = sender.send(Ok(frame.clone())).await {
                warn!(agent_id = %agent_id, error = %e, "Broadcast failed to agent");
            }
        }
    }

    pub async fn active_agents(&self) -> Vec<AgentSession> {
        let map = self.sessions.read().await;
        map.values().map(|(s, _)| s.clone()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn test_atomic_channel_replacement_preserves_new_session() {
        let registry = SessionRegistry::new();
        let (tx1, _rx1) = mpsc::channel(16);
        let (tx2, _rx2) = mpsc::channel(16);

        let sid1 = registry.register("agent-1".into(), tx1).await;
        let sid2 = registry.register("agent-1".into(), tx2).await;
        assert_ne!(sid1, sid2);

        // Old connection C1 dies and attempts to unregister with stale sid1
        let unregistered_stale = registry.unregister_if_matching("agent-1", sid1).await;
        assert!(!unregistered_stale, "Stale unregister must not succeed");

        // The session must still be active with sid2
        let active = registry.active_agents().await;
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].session_id, sid2);

        // Active connection C2 unregisters with matching sid2
        let unregistered_active = registry.unregister_if_matching("agent-1", sid2).await;
        assert!(unregistered_active, "Active unregister must succeed");
        assert!(registry.active_agents().await.is_empty());
    }
}
