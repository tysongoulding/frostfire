use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Federation = 1,
    Workstream = 2,
    Team = 3,
    Sme = 4,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkstreamStatus {
    Pending,
    Running,
    Paused,
    AwaitingApproval,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub workstream_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkstreamDefinition {
    pub id: String,
    pub federation_id: String,
    pub name: String,
    pub description: String,
    pub status: WorkstreamStatus,
    pub team_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamDefinition {
    pub id: String,
    pub workstream_id: String,
    pub name: String,
    pub lead_agent_id: String,
    pub sme_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmeMetadata {
    pub id: String,
    pub team_id: String,
    pub name: String,
    pub role: String,
    pub system_prompt: String,
    pub model_tier: String,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Milestone {
    pub id: String,
    pub title: String,
    pub description: String,
    pub phase_index: usize,
    pub required_approvals: u32,
    pub current_approvals: u32,
    pub is_approved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaborMetric {
    pub workstream_id: String,
    pub agent_id: String,
    pub hours_saved: f64,
    pub estimated_cost_saved: f64,
    pub calibration_rating: Option<u8>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentSessionInfo {
    /// Immutable type-prefixed identifier: agt_<ulid>
    pub id: String,
    /// Human-readable agent display name
    pub name: String,
    /// Functional persona/role
    pub role: String,
    /// Detailed description of agent purpose
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Allocated X11 cloud display slot (:1, :2, ...)
    #[serde(alias = "display_slot")]
    pub display_number: u16,
    /// noVNC / websockify port: 6079 + N
    pub vnc_port: u16,
    /// Raw RFB port: 5900 + N
    #[serde(default)]
    pub rfb_port: u16,
    /// Chrome DevTools Protocol port: 9222 + N
    #[serde(default)]
    pub cdp_port: u16,
    /// Remote host IP or hostname
    #[serde(default = "default_vm_host")]
    pub vm_host: String,
    /// Runtime state: "idle", "running", "paused", "error"
    #[serde(default = "default_status")]
    pub status: String,
    /// Optional team grouping ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    /// ISO-8601 creation timestamp
    #[serde(default = "default_created_at")]
    pub created_at: String,
    /// Optional last update timestamp
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Optional system prompt / directives
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// Absolute or relative workspace directory path
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_dir: Option<String>,
}

fn default_vm_host() -> String {
    "44.242.94.86".to_string()
}

fn default_status() -> String {
    "idle".to_string()
}

fn default_created_at() -> String {
    Utc::now().to_rfc3339()
}
