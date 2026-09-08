use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use thiserror::Error;
use ulid::Ulid;

use crate::models::AgentSessionInfo;

#[derive(Error, Debug)]
pub enum SessionError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Invalid display slot {0}: must be >= 1")]
    InvalidDisplaySlot(u16),
    #[error("Display slot {0} is already allocated")]
    SlotAlreadyAllocated(u16),
    #[error("Port overflow for {0} port computation")]
    PortOverflow(&'static str),
    #[error("Display slot pool exhausted (max 65535 slots)")]
    SlotPoolExhausted,
    #[error("Agent session '{0}' not found")]
    NotFound(String),
    #[error("Invalid agent ID '{0}': must match 'agt_<ulid>' format (30 characters)")]
    InvalidId(String),
    #[error("Block allocation size must be >= 1")]
    InvalidBlockSize,
}

pub struct AgentSessionManager;

impl AgentSessionManager {
    /// Generates an immutable, type-prefixed identifier: agt_<ulid>
    /// Guaranteed to be 30 characters: "agt_" (4 chars) + 26 uppercase Crockford Base32 characters.
    pub fn generate_agent_id() -> String {
        format!("agt_{}", Ulid::new())
    }

    /// Validates whether an agent ID strictly conforms to agt_<ulid> specification.
    pub fn is_valid_agent_id(id: &str) -> bool {
        if id.len() != 30 || !id.starts_with("agt_") {
            return false;
        }
        Ulid::from_string(&id[4..]).is_ok()
    }

    /// Extracts the 48-bit millisecond timestamp encoded in the ULID.
    pub fn extract_timestamp_ms(id: &str) -> Result<u64, SessionError> {
        if !Self::is_valid_agent_id(id) {
            return Err(SessionError::InvalidId(id.to_string()));
        }
        let u = Ulid::from_string(&id[4..])
            .map_err(|_| SessionError::InvalidId(id.to_string()))?;
        Ok(u.timestamp_ms())
    }

    /// Display Slot Allocator:
    /// Finds the lowest positive integer N >= 1 not currently assigned to an active session.
    pub fn allocate_slot(active_slots: &[u16]) -> Result<u16, SessionError> {
        let occupied: BTreeSet<u16> = active_slots.iter().copied().collect();
        for slot in 1..=u16::MAX {
            if !occupied.contains(&slot) {
                return Ok(slot);
            }
        }
        Err(SessionError::SlotPoolExhausted)
    }

    /// Allocates preferred slot if specified and unallocated, or falls back to lowest available N >= 1.
    pub fn allocate_slot_with_preference(
        active_slots: &[u16],
        preferred: Option<u16>,
    ) -> Result<u16, SessionError> {
        let occupied: BTreeSet<u16> = active_slots.iter().copied().collect();
        if let Some(p) = preferred {
            if p < 1 {
                return Err(SessionError::InvalidDisplaySlot(p));
            }
            if occupied.contains(&p) {
                return Err(SessionError::SlotAlreadyAllocated(p));
            }
            return Ok(p);
        }
        Self::allocate_slot(active_slots)
    }

    /// Allocates a contiguous block of display slots (e.g. for team isolation).
    pub fn allocate_slot_block(
        active_slots: &[u16],
        size: usize,
        base: Option<u16>,
    ) -> Result<Vec<u16>, SessionError> {
        if size == 0 {
            return Err(SessionError::InvalidBlockSize);
        }
        let occupied: BTreeSet<u16> = active_slots.iter().copied().collect();
        if let Some(b) = base {
            if b < 1 {
                return Err(SessionError::InvalidDisplaySlot(b));
            }
            let end = b
                .checked_add(size as u16)
                .ok_or(SessionError::SlotPoolExhausted)?;
            for s in b..end {
                if occupied.contains(&s) {
                    return Err(SessionError::SlotAlreadyAllocated(s));
                }
            }
            return Ok((b..end).collect());
        }

        let max_start = u16::MAX.saturating_sub(size as u16);
        for start in 1..=max_start {
            let block: Vec<u16> = (start..start + size as u16).collect();
            if block.iter().all(|s| !occupied.contains(s)) {
                return Ok(block);
            }
        }
        Err(SessionError::SlotPoolExhausted)
    }

    /// Port computation:
    /// - VNC HTTP / noVNC: 6079 + N  (Slot 1 = 6080, Slot 2 = 6081)
    /// - Raw RFB VNC:      5900 + N  (Slot 1 = 5901, Slot 2 = 5902)
    /// - Chrome CDP:       9222 + N  (Slot 1 = 9223, Slot 2 = 9224)
    pub fn compute_ports(display_number: u16) -> Result<(u16, u16, u16), SessionError> {
        if display_number < 1 {
            return Err(SessionError::InvalidDisplaySlot(display_number));
        }
        let vnc = 6079u16
            .checked_add(display_number)
            .ok_or(SessionError::PortOverflow("VNC"))?;
        let rfb = 5900u16
            .checked_add(display_number)
            .ok_or(SessionError::PortOverflow("RFB"))?;
        let cdp = 9222u16
            .checked_add(display_number)
            .ok_or(SessionError::PortOverflow("CDP"))?;
        Ok((vnc, rfb, cdp))
    }

    /// Persists session metadata and agent persona:
    /// - agents/agt_<ulid>/profile.json
    /// - agents/agt_<ulid>/AGENTS.md
    pub fn persist_session(
        agents_dir: &Path,
        session: &AgentSessionInfo,
        system_prompt: Option<&str>,
    ) -> Result<PathBuf, SessionError> {
        if !Self::is_valid_agent_id(&session.id) {
            return Err(SessionError::InvalidId(session.id.clone()));
        }
        let session_dir = agents_dir.join(&session.id);
        std::fs::create_dir_all(&session_dir)?;

        // Write profile.json
        let profile_path = session_dir.join("profile.json");
        let profile_json = serde_json::to_string_pretty(session)?;
        std::fs::write(&profile_path, profile_json)?;

        // Write AGENTS.md
        let agents_md_path = session_dir.join("AGENTS.md");
        let prompt_content = system_prompt
            .or(session.system_prompt.as_deref())
            .unwrap_or("Autonomous execution agent operating within defined scope.");

        let agents_md = format!(
            "# Agent Persona: {}\n\
             - ID: {}\n\
             - Role: {}\n\
             - Display Slot: :{}\n\
             - Created: {}\n\n\
             ## Core Directives\n\
             {}\n\n\
             ## Invariants\n\
             - Read-only execution on host filesystem unless explicitly permitted\n\
             - Outbound-only tunnel control\n\
             - Zero credential leakage\n",
            session.name,
            session.id,
            session.role,
            session.display_number,
            session.created_at,
            prompt_content.trim()
        );
        std::fs::write(&agents_md_path, agents_md)?;

        Ok(session_dir)
    }

    /// Lists all persisted sessions from agents_dir, sorted chronologically.
    pub fn list_sessions(agents_dir: &Path) -> Result<Vec<AgentSessionInfo>, SessionError> {
        if !agents_dir.exists() {
            return Ok(Vec::new());
        }
        let mut sessions = Vec::new();
        for entry in std::fs::read_dir(agents_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if dir_name.starts_with("agt_") {
                    let profile_path = path.join("profile.json");
                    if profile_path.exists() {
                        match std::fs::read_to_string(&profile_path) {
                            Ok(content) => match serde_json::from_str::<AgentSessionInfo>(&content) {
                                Ok(info) => sessions.push(info),
                                Err(e) => {
                                    tracing::warn!(
                                        "Failed to parse profile at {:?}: {}",
                                        profile_path,
                                        e
                                    );
                                }
                            },
                            Err(e) => {
                                tracing::warn!(
                                    "Failed to read profile at {:?}: {}",
                                    profile_path,
                                    e
                                );
                            }
                        }
                    }
                }
            }
        }
        // Sort chronologically by ID (ULIDs are lexicographically chronological)
        sessions.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(sessions)
    }

    /// Deletes an agent session directory and frees its display slot.
    pub fn delete_session(agents_dir: &Path, id: &str) -> Result<(), SessionError> {
        if !Self::is_valid_agent_id(id) {
            return Err(SessionError::InvalidId(id.to_string()));
        }
        let session_dir = agents_dir.join(id);
        if !session_dir.exists() {
            return Err(SessionError::NotFound(id.to_string()));
        }
        std::fs::remove_dir_all(&session_dir)?;
        Ok(())
    }

    /// High-level coordinator: allocates lowest available slot, computes ports, and persists files.
    pub fn create_session(
        agents_dir: &Path,
        name: String,
        role: String,
        description: Option<String>,
        system_prompt: Option<String>,
        vm_host: Option<String>,
        team_id: Option<String>,
    ) -> Result<AgentSessionInfo, SessionError> {
        let existing = Self::list_sessions(agents_dir)?;
        let active_slots: Vec<u16> = existing.iter().map(|s| s.display_number).collect();
        let slot = Self::allocate_slot(&active_slots)?;
        let (vnc_port, rfb_port, cdp_port) = Self::compute_ports(slot)?;

        let id = Self::generate_agent_id();
        let created_at = chrono::Utc::now().to_rfc3339();
        let host = vm_host.unwrap_or_else(|| "44.242.94.86".to_string());
        let session_dir_str = agents_dir.join(&id).to_string_lossy().to_string();

        let session = AgentSessionInfo {
            id,
            name,
            role,
            description,
            display_number: slot,
            vnc_port,
            rfb_port,
            cdp_port,
            vm_host: host,
            status: "idle".to_string(),
            created_at,
            team_id,
            updated_at: None,
            system_prompt: system_prompt.clone(),
            workspace_dir: Some(session_dir_str),
        };

        Self::persist_session(agents_dir, &session, system_prompt.as_deref())?;
        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ulid_generation_and_validation() {
        let id = AgentSessionManager::generate_agent_id();
        assert_eq!(id.len(), 30);
        assert!(id.starts_with("agt_"));
        assert!(AgentSessionManager::is_valid_agent_id(&id));

        assert!(!AgentSessionManager::is_valid_agent_id("agent_123"));
        assert!(!AgentSessionManager::is_valid_agent_id("agt_short"));

        let ts = AgentSessionManager::extract_timestamp_ms(&id);
        assert!(ts.is_ok());
        assert!(ts.unwrap() > 0);
    }

    #[test]
    fn test_display_slot_allocator() {
        assert_eq!(AgentSessionManager::allocate_slot(&[]).unwrap(), 1);
        assert_eq!(AgentSessionManager::allocate_slot(&[1, 2]).unwrap(), 3);
        assert_eq!(AgentSessionManager::allocate_slot(&[1, 3]).unwrap(), 2);
        assert_eq!(AgentSessionManager::allocate_slot(&[2, 3]).unwrap(), 1);

        // With preference
        assert_eq!(
            AgentSessionManager::allocate_slot_with_preference(&[1, 2], Some(5)).unwrap(),
            5
        );
        assert!(AgentSessionManager::allocate_slot_with_preference(&[1, 2], Some(1)).is_err());
        assert!(AgentSessionManager::allocate_slot_with_preference(&[1, 2], Some(0)).is_err());

        // Block allocation
        let block = AgentSessionManager::allocate_slot_block(&[1, 2], 3, Some(10)).unwrap();
        assert_eq!(block, vec![10, 11, 12]);
    }

    #[test]
    fn test_port_computation() {
        let (vnc, rfb, cdp) = AgentSessionManager::compute_ports(1).unwrap();
        assert_eq!(vnc, 6080);
        assert_eq!(rfb, 5901);
        assert_eq!(cdp, 9223);

        let (vnc2, rfb2, cdp2) = AgentSessionManager::compute_ports(2).unwrap();
        assert_eq!(vnc2, 6081);
        assert_eq!(rfb2, 5902);
        assert_eq!(cdp2, 9224);

        assert!(AgentSessionManager::compute_ports(0).is_err());
    }

    #[test]
    fn test_session_lifecycle_and_persistence() {
        let temp_dir = std::env::temp_dir().join(format!("frostfire_test_{}", AgentSessionManager::generate_agent_id()));
        let agents_dir = temp_dir.join("agents");

        // 1. Create session 1
        let s1 = AgentSessionManager::create_session(
            &agents_dir,
            "Agent Alpha".to_string(),
            "Researcher".to_string(),
            Some("Description A".to_string()),
            Some("System prompt here".to_string()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(s1.display_number, 1);
        assert_eq!(s1.vnc_port, 6080);
        assert!(agents_dir.join(&s1.id).join("profile.json").exists());
        assert!(agents_dir.join(&s1.id).join("AGENTS.md").exists());

        // 2. Create session 2
        let s2 = AgentSessionManager::create_session(
            &agents_dir,
            "Agent Beta".to_string(),
            "Engineer".to_string(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(s2.display_number, 2);

        // 3. List sessions
        let list = AgentSessionManager::list_sessions(&agents_dir).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, s1.id);
        assert_eq!(list[1].id, s2.id);

        // 4. Delete session 1
        AgentSessionManager::delete_session(&agents_dir, &s1.id).unwrap();
        assert!(!agents_dir.join(&s1.id).exists());

        let list_after = AgentSessionManager::list_sessions(&agents_dir).unwrap();
        assert_eq!(list_after.len(), 1);
        assert_eq!(list_after[0].id, s2.id);

        // 5. Create session 3 -> recycles slot 1!
        let s3 = AgentSessionManager::create_session(
            &agents_dir,
            "Agent Gamma".to_string(),
            "Specialist".to_string(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(s3.display_number, 1);

        // Clean up
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
