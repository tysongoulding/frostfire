use crate::providers::ProviderType;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelTier {
    /// 90% Tier: High-throughput, low-cost models for SMEs
    SmeFast,
    /// 10% Tier: Frontier reasoning models for Leads and PMs
    ReasoningLead,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    DataParsing,
    RegexExtraction,
    ToolExecution,
    Drafting,
    PlanSynthesis,
    ConflictResolution,
    DecisionGate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProfile {
    pub task_type: TaskType,
    pub role: String,
    pub prompt_token_estimate: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRoute {
    pub tier: ModelTier,
    pub provider: ProviderType,
    pub model_name: String,
    pub temperature: f32,
    pub max_tokens: u32,
}

pub struct ModelRouter {
    pub fast_model: String,
    pub fast_provider: ProviderType,
    pub reasoning_model: String,
    pub reasoning_provider: ProviderType,
}

impl Default for ModelRouter {
    fn default() -> Self {
        Self {
            fast_model: "gemini-2.0-flash".to_string(),
            fast_provider: ProviderType::Gemini,
            reasoning_model: "gemini-1.5-pro".to_string(),
            reasoning_provider: ProviderType::Gemini,
        }
    }
}

impl ModelRouter {
    pub fn new(
        fast_model: &str,
        fast_provider: ProviderType,
        reasoning_model: &str,
        reasoning_provider: ProviderType,
    ) -> Self {
        Self {
            fast_model: fast_model.to_string(),
            fast_provider,
            reasoning_model: reasoning_model.to_string(),
            reasoning_provider,
        }
    }

    /// Asymmetric 90/10 routing rule:
    /// - 90% (SMEs, data parsing, tool executions, drafting) -> SmeFast tier
    /// - 10% (Plan synthesis, conflict resolution, decision gates, PM roles) -> ReasoningLead tier
    pub fn route(&self, profile: &TaskProfile) -> ModelRoute {
        let is_reasoning = matches!(
            profile.task_type,
            TaskType::PlanSynthesis | TaskType::ConflictResolution | TaskType::DecisionGate
        ) || profile.role.to_lowercase().contains("lead")
          || profile.role.to_lowercase().contains("pm");

        if is_reasoning {
            ModelRoute {
                tier: ModelTier::ReasoningLead,
                provider: self.reasoning_provider.clone(),
                model_name: self.reasoning_model.clone(),
                temperature: 0.2,
                max_tokens: 8192,
            }
        } else {
            ModelRoute {
                tier: ModelTier::SmeFast,
                provider: self.fast_provider.clone(),
                model_name: self.fast_model.clone(),
                temperature: 0.7,
                max_tokens: 4096,
            }
        }
    }

    /// Deterministic In-Tier Model Failover Chain (ADR-0014):
    /// Returns primary route followed by in-tier fallbacks before tripping circuit breaker.
    pub fn failover_chain(&self, profile: &TaskProfile) -> Vec<ModelRoute> {
        let primary = self.route(profile);
        match primary.tier {
            ModelTier::SmeFast => {
                vec![
                    primary,
                    ModelRoute {
                        tier: ModelTier::SmeFast,
                        provider: ProviderType::Groq,
                        model_name: "llama-3.3-70b-versatile".to_string(),
                        temperature: 0.7,
                        max_tokens: 4096,
                    },
                    ModelRoute {
                        tier: ModelTier::SmeFast,
                        provider: ProviderType::Ollama,
                        model_name: "llama-3.2-3b".to_string(),
                        temperature: 0.7,
                        max_tokens: 2048,
                    },
                ]
            }
            ModelTier::ReasoningLead => {
                vec![
                    primary,
                    ModelRoute {
                        tier: ModelTier::ReasoningLead,
                        provider: ProviderType::Anthropic,
                        model_name: "claude-3-7-sonnet".to_string(),
                        temperature: 0.2,
                        max_tokens: 8192,
                    },
                    ModelRoute {
                        tier: ModelTier::ReasoningLead,
                        provider: ProviderType::OpenAi,
                        model_name: "o3-mini".to_string(),
                        temperature: 0.2,
                        max_tokens: 8192,
                    },
                ]
            }
        }
    }
}
