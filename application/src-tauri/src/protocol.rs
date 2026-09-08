use frostfire_core::synthesis::TeamPlan;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum WorkstreamCommand {
    LaunchWorkstream {
        blueprint_id: String,
        workstream_name: String,
        params: serde_json::Value,
    },
    PauseWorkstream {
        workstream_id: String,
    },
    ApproveMilestone {
        workstream_id: String,
        milestone_id: String,
    },
    ReadBlackboard {
        uri: String,
    },
    SaveApiKey {
        provider: String,
        key: String,
    },
    GetSystemStatus,
    CalibrateFta {
        workstream_id: String,
        rating: u8,
        hours_saved: f64,
    },
    GetPromptConfig {
        role: String,
    },
    SaveCustomPrompt {
        role: String,
        content: String,
        activate: bool,
    },
    GetBlackboardManifest {
        board_id: String,
    },
    GetBlackboardPresentation {
        board_id: String,
    },
    VerifyInvariants {
        board_id: String,
    },
    WebSearch {
        query: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub snippet: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptConfigDto {
    pub role: String,
    pub is_custom: bool,
    pub display_status: String,
    pub prompt_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum WorkstreamEvent {
    SmeTaskStarted {
        task_id: String,
        agent_id: String,
        role: String,
        phase: String,
    },
    ArtifactPublished {
        uri: String,
        title: String,
        author: String,
        version: u32,
        size_bytes: usize,
    },
    TeamPlanSynthesized {
        workstream_id: String,
        plan: TeamPlan,
    },
    ToolApprovalRequest {
        request_id: String,
        agent_id: String,
        tool_name: String,
        parameters: serde_json::Value,
        rationale: String,
    },
    WorkstreamCompleted {
        workstream_id: String,
        total_hours_saved: f64,
    },
    TokenStream {
        task_id: String,
        agent_id: String,
        chunk: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    pub version: String,
    pub os: String,
    pub app_data_dir: String,
    pub extensions_dir: String,
    pub connected_providers: Vec<String>,
    pub active_workstreams_count: usize,
    pub total_labor_hours_saved: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestKeyResponse {
    pub success: bool,
    pub latency_ms: u64,
    pub message: String,
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RpcEvent {
    SessionStart {
        session_id: String,
        model: String,
        provider: String,
    },
    TurnStart {
        turn_number: usize,
        prompt: String,
    },
    TextChunk {
        content: String,
    },
    ReasoningChunk {
        content: String,
    },
    TurnEnd {
        turn_number: usize,
    },
    Error {
        code: String,
        message: String,
    },
}
