use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResult {
    pub agent_id: String,
    pub role: String,
    pub summary: String,
    pub key_findings: Vec<String>,
    pub artifact_uris: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub id: String,
    pub description: String,
    pub assigned_agent_id: String,
    pub priority: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskEvaluation {
    pub risk: String,
    pub severity: String,
    pub mitigation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamPlan {
    pub workstream_id: String,
    pub team_id: String,
    pub title: String,
    pub executive_summary: String,
    pub action_items: Vec<ActionItem>,
    pub target_files: Vec<String>,
    pub execution_order: Vec<String>,
    pub identified_risks: Vec<RiskEvaluation>,
}
