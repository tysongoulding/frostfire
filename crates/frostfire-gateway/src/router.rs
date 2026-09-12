use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

use crate::error::GatewayError;

static ADVERSARIAL_CONTROL_TOKENS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|<\|fim_prefix\|>|<\|fim_suffix\|>)")
        .expect("Valid regex")
});

static DIFF_HUNK_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^@@\s+-[0-9]+(,[0-9]+)?\s+\+[0-9]+(,[0-9]+)?\s+@@")
        .expect("Valid diff regex")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelTier {
    FastTier,
    ReasoningTier,
}

impl ModelTier {
    pub fn primary_model_target(&self) -> &'static str {
        match self {
            Self::FastTier => "claude-3-5-haiku-20241022",
            Self::ReasoningTier => "claude-3-7-sonnet-20250219",
        }
    }

    pub fn output_token_budget(&self) -> u32 {
        match self {
            Self::FastTier => 4096,
            Self::ReasoningTier => 64000,
        }
    }

    pub fn max_latency_ms(&self) -> u64 {
        match self {
            Self::FastTier => 500,
            Self::ReasoningTier => 8000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRequest {
    pub prompt: String,
    pub is_compaction: bool,
    pub task_type: Option<String>,
    pub explicit_tier: Option<ModelTier>,
}

pub struct LlmRouter;

impl LlmRouter {
    /// Sanitizes prompt text by neutralizing adversarial control tokens.
    pub fn sanitize_prompt(prompt: &str) -> String {
        ADVERSARIAL_CONTROL_TOKENS.replace_all(prompt, "").to_string()
    }

    /// Classifies an incoming model request deterministically into FastTier or ReasoningTier.
    pub fn route(request: &ModelRequest) -> ModelTier {
        // 1. Compaction requests are always routed to FastTier for rapid summarization
        if request.is_compaction {
            return ModelTier::FastTier;
        }

        // 2. Explicit user tier overrides automatic classification
        if let Some(tier) = request.explicit_tier {
            return tier;
        }

        // 3. Task type heuristics
        if let Some(task_type) = &request.task_type {
            let normalized = task_type.to_lowercase();
            match normalized.as_str() {
                "planning"
                | "architecture"
                | "review"
                | "compiler_error_recovery"
                | "test_failure"
                | "formal_proof" => return ModelTier::ReasoningTier,
                "tool_dispatch" | "summary" | "fast_search" => return ModelTier::FastTier,
                _ => {}
            }
        }

        // 4. Prompt analysis: multi-file diff hunks (> 3 hunks indicate complex refactor)
        let diff_hunks = DIFF_HUNK_PATTERN.find_iter(&request.prompt).count();
        if diff_hunks > 3 {
            return ModelTier::ReasoningTier;
        }

        // 5. Default tier
        ModelTier::FastTier
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderTarget {
    AnthropicDirect,
    AwsBedrock,
    TertiaryOpenRouter,
}

pub struct ProviderFailover {
    pub sequence: Vec<ProviderTarget>,
}

impl Default for ProviderFailover {
    fn default() -> Self {
        Self {
            sequence: vec![
                ProviderTarget::AnthropicDirect,
                ProviderTarget::AwsBedrock,
                ProviderTarget::TertiaryOpenRouter,
            ],
        }
    }
}

impl ProviderFailover {
    /// Execute failover across provider sequence until one succeeds or all fail.
    pub async fn execute_with_failover<F, Fut, T>(&self, mut attempt_fn: F) -> Result<T, GatewayError>
    where
        F: FnMut(ProviderTarget) -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let mut last_err = String::from("No providers configured");
        for &provider in &self.sequence {
            match attempt_fn(provider).await {
                Ok(val) => return Ok(val),
                Err(err) => {
                    tracing::warn!(?provider, %err, "Provider failed; failing over to next target");
                    last_err = err;
                }
            }
        }
        Err(GatewayError::ProviderFailed(last_err))
    }
}
