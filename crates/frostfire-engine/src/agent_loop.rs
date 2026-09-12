use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;

use crate::compaction::{CompactionController, DEFAULT_WATERMARK_RATIO};

pub const DEFAULT_MAX_STEPS: usize = 32;
pub const DEFAULT_MAX_CONTEXT_TOKENS: usize = 128_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentLoopState {
    Idle,
    IngestPrompt,
    EvaluateContext,
    TriggerCompaction,
    AwaitCompactionRes,
    ReplaceCheckpoint,
    SlidingWindowFallback,
    ReasoningStep,
    ToolPlanExecute,
    VerificationGate,
    GoalSatisfied,
    StepLimitReached,
    HardLockHalt,
    Complete,
    HaltError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifierResult {
    pub passed: bool,
    pub exit_code: i32,
    pub diagnostics: String,
}

#[async_trait]
pub trait ProgrammaticVerifier: Send + Sync {
    async fn verify(&self, task_id: &str) -> Result<VerifierResult, String>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTurnResult {
    pub response_text: String,
    pub tool_action: Option<String>,
    pub tokens_estimate: usize,
}

#[async_trait]
pub trait EngineCompletionModel: Send + Sync {
    async fn complete(&self, context: &[String]) -> Result<ModelTurnResult, String>;
    async fn compact(&self, history: &[String]) -> Result<String, String>;
}

#[derive(Debug, Clone)]
pub struct RigAgentConfig {
    pub max_steps: usize,
    pub max_context_tokens: usize,
    pub watermark_ratio: f64,
}

impl Default for RigAgentConfig {
    fn default() -> Self {
        Self {
            max_steps: DEFAULT_MAX_STEPS,
            max_context_tokens: DEFAULT_MAX_CONTEXT_TOKENS,
            watermark_ratio: DEFAULT_WATERMARK_RATIO,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLoopSummary {
    pub final_state: AgentLoopState,
    pub steps_taken: usize,
    pub history_len: usize,
    pub final_message: String,
}

pub struct RigAgentLoop {
    pub config: RigAgentConfig,
    pub state: AgentLoopState,
    pub history: Vec<String>,
    pub step_count: usize,
    pub current_tokens: usize,
    pub is_hard_locked: bool,
    compaction: CompactionController,
    model: Arc<dyn EngineCompletionModel>,
    verifier: Arc<dyn ProgrammaticVerifier>,
}

impl RigAgentLoop {
    pub fn new(
        config: RigAgentConfig,
        model: Arc<dyn EngineCompletionModel>,
        verifier: Arc<dyn ProgrammaticVerifier>,
    ) -> Self {
        let compaction = CompactionController::new(config.max_context_tokens, config.watermark_ratio);
        Self {
            config,
            state: AgentLoopState::Idle,
            history: Vec::new(),
            step_count: 0,
            current_tokens: 0,
            is_hard_locked: false,
            compaction,
            model,
            verifier,
        }
    }

    pub fn set_hard_lock(&mut self, locked: bool) {
        self.is_hard_locked = locked;
    }

    /// Executes the multi-turn state machine loop to completion or terminal error.
    pub async fn execute_loop(
        &mut self,
        session_id: &str,
        task_id: &str,
        user_prompt: &str,
    ) -> AgentLoopSummary {
        // [ IDLE ] -> [ INGEST_PROMPT ]
        self.state = AgentLoopState::IngestPrompt;
        self.history.push(format!("USER: {user_prompt}"));
        self.current_tokens += user_prompt.len() / 4;

        loop {
            // Check for zero-balance hard lock
            if self.is_hard_locked {
                info!(session_id, "Zero-balance hard lock encountered; halting execution");
                self.state = AgentLoopState::HardLockHalt;
                return AgentLoopSummary {
                    final_state: AgentLoopState::HaltError("HARD_LOCK: Insufficient credits".to_string()),
                    steps_taken: self.step_count,
                    history_len: self.history.len(),
                    final_message: "Execution halted: credit balance depleted".to_string(),
                };
            }

            // Check step bound (max 32 steps)
            if self.step_count >= self.config.max_steps {
                info!(session_id, step = self.step_count, "Turn limit reached (>= 32)");
                self.state = AgentLoopState::StepLimitReached;
                return AgentLoopSummary {
                    final_state: AgentLoopState::HaltError("STEP_LIMIT_REACHED: Exceeded 32 turns".to_string()),
                    steps_taken: self.step_count,
                    history_len: self.history.len(),
                    final_message: "Execution halted: step limit exceeded".to_string(),
                };
            }

            // [ EVALUATE_CONTEXT ]
            self.state = AgentLoopState::EvaluateContext;
            if self.compaction.should_compact(self.current_tokens) {
                // [ TRIGGER_COMPACTION ]
                self.state = AgentLoopState::TriggerCompaction;
                info!(session_id, tokens = self.current_tokens, "Token watermark >= 0.75; triggering compaction");

                // [ AWAIT_COMPACTION_RES ]
                self.state = AgentLoopState::AwaitCompactionRes;
                match self.model.compact(&self.history).await {
                    Ok(summary) => {
                        // [ REPLACE_CHECKPOINT ]
                        self.state = AgentLoopState::ReplaceCheckpoint;
                        self.history.clear();
                        self.history.push(format!("SYSTEM CHECKPOINT: {summary}"));
                        self.current_tokens = summary.len() / 4;
                    }
                    Err(e) => {
                        // [ SLIDING_WINDOW_FALLBACK ]
                        info!(%e, "Compaction failed or timed out; applying sliding window fallback");
                        self.state = AgentLoopState::SlidingWindowFallback;
                        self.history = self.compaction.sliding_window_fallback(&self.history, 4);
                        self.current_tokens = self.history.iter().map(|s| s.len() / 4).sum();
                    }
                }
            }

            // [ REASONING_STEP ]
            self.state = AgentLoopState::ReasoningStep;
            self.step_count += 1;

            let turn = match self.model.complete(&self.history).await {
                Ok(res) => res,
                Err(err) => {
                    self.state = AgentLoopState::HaltError(err.clone());
                    return AgentLoopSummary {
                        final_state: self.state.clone(),
                        steps_taken: self.step_count,
                        history_len: self.history.len(),
                        final_message: format!("Model error: {err}"),
                    };
                }
            };

            self.history.push(format!("ASSISTANT: {}", turn.response_text));
            self.current_tokens += turn.tokens_estimate;

            // [ TOOL_PLAN_EXECUTE ]
            if let Some(tool) = turn.tool_action {
                self.state = AgentLoopState::ToolPlanExecute;
                self.history.push(format!("TOOL_ACTION: {tool}"));

                // [ VERIFICATION_GATE ]
                self.state = AgentLoopState::VerificationGate;
                match self.verifier.verify(task_id).await {
                    Ok(v_res) => {
                        if v_res.passed {
                            // [ GOAL_SATISFIED ] -> [ COMPLETE ]
                            self.state = AgentLoopState::GoalSatisfied;
                            self.state = AgentLoopState::Complete;
                            return AgentLoopSummary {
                                final_state: AgentLoopState::Complete,
                                steps_taken: self.step_count,
                                history_len: self.history.len(),
                                final_message: turn.response_text,
                            };
                        } else {
                            // Verification failed -> Append diagnostics and loop back to REASONING_STEP
                            info!(task_id, exit_code = v_res.exit_code, "Verification gate failed; retrying with diagnostics");
                            self.history.push(format!(
                                "VERIFIER_FEEDBACK (exit code {}): {}",
                                v_res.exit_code, v_res.diagnostics
                            ));
                            self.current_tokens += v_res.diagnostics.len() / 4;
                            continue;
                        }
                    }
                    Err(verr) => {
                        self.state = AgentLoopState::HaltError(verr.clone());
                        return AgentLoopSummary {
                            final_state: self.state.clone(),
                            steps_taken: self.step_count,
                            history_len: self.history.len(),
                            final_message: format!("Verifier execution error: {verr}"),
                        };
                    }
                }
            } else {
                // If model completed with no tools and verifier confirms goal, complete
                self.state = AgentLoopState::Complete;
                return AgentLoopSummary {
                    final_state: AgentLoopState::Complete,
                    steps_taken: self.step_count,
                    history_len: self.history.len(),
                    final_message: turn.response_text,
                };
            }
        }
    }
}
