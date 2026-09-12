use serde::{Deserialize, Serialize};

pub const DEFAULT_WATERMARK_RATIO: f64 = 0.75;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionRequest {
    pub session_id: String,
    pub current_token_count: usize,
    pub max_context_tokens: usize,
    pub history_to_summarize: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionResponse {
    pub session_id: String,
    pub checkpoint_summary: String,
    pub compacted_token_count: usize,
}

#[derive(Debug, Clone)]
pub struct CompactionController {
    pub max_context_tokens: usize,
    pub watermark_ratio: f64,
}

impl CompactionController {
    pub fn new(max_context_tokens: usize, watermark_ratio: f64) -> Self {
        Self {
            max_context_tokens,
            watermark_ratio,
        }
    }

    /// Determines whether the active context has crossed the inclusive 75% token watermark.
    pub fn should_compact(&self, current_tokens: usize) -> bool {
        let watermark = (self.max_context_tokens as f64 * self.watermark_ratio) as usize;
        current_tokens >= watermark
    }

    /// Builds a compaction request from the current conversation history.
    pub fn build_compaction_request(
        &self,
        session_id: &str,
        current_tokens: usize,
        history: &[String],
    ) -> CompactionRequest {
        CompactionRequest {
            session_id: session_id.to_string(),
            current_token_count: current_tokens,
            max_context_tokens: self.max_context_tokens,
            history_to_summarize: history.to_vec(),
        }
    }

    /// Trims history with a sliding window fallback if central compaction times out or fails.
    /// Preserves the system prompt (index 0) and the most recent `window_size` messages.
    pub fn sliding_window_fallback(
        &self,
        history: &[String],
        window_size: usize,
    ) -> Vec<String> {
        let mut trimmed = Vec::with_capacity(window_size + 2);
        if let Some(system_msg) = history.first() {
            let truncated = if system_msg.len() > 200 {
                format!("{}... [TRUNCATED]", &system_msg[..200])
            } else {
                system_msg.clone()
            };
            trimmed.push(truncated);
        }
        trimmed.push("[SYSTEM: Earlier conversation truncated via sliding window fallback]".to_string());

        if history.len() > 1 {
            let start_idx = history.len().saturating_sub(window_size).max(1);
            trimmed.extend_from_slice(&history[start_idx..]);
        }
        trimmed
    }
}
