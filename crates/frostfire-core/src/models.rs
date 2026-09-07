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
