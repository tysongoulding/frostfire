use async_trait::async_trait;
use frostfire_engine::{
    AgentLoopState, EngineCompletionModel, ModelTurnResult, ProgrammaticVerifier, RigAgentConfig,
    RigAgentLoop, VerifierResult,
};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

struct MockModel {
    responses: Mutex<Vec<ModelTurnResult>>,
    default_tool: Mutex<Option<String>>,
    compact_calls: AtomicUsize,
    compact_should_fail: AtomicBool,
}

impl MockModel {
    fn new(responses: Vec<ModelTurnResult>) -> Self {
        Self {
            responses: Mutex::new(responses),
            default_tool: Mutex::new(None),
            compact_calls: AtomicUsize::new(0),
            compact_should_fail: AtomicBool::new(false),
        }
    }

    fn with_default_tool(self, tool: String) -> Self {
        Self {
            responses: self.responses,
            default_tool: Mutex::new(Some(tool)),
            compact_calls: self.compact_calls,
            compact_should_fail: self.compact_should_fail,
        }
    }
}

#[async_trait]
impl EngineCompletionModel for MockModel {
    async fn complete(&self, _context: &[String]) -> Result<ModelTurnResult, String> {
        let mut guard = self.responses.lock().await;
        if guard.is_empty() {
            let tool = self.default_tool.lock().await.clone();
            Ok(ModelTurnResult {
                response_text: "Default response".to_string(),
                tool_action: tool,
                tokens_estimate: 10,
            })
        } else {
            Ok(guard.remove(0))
        }
    }

    async fn compact(&self, _history: &[String]) -> Result<String, String> {
        self.compact_calls.fetch_add(1, Ordering::SeqCst);
        if self.compact_should_fail.load(Ordering::SeqCst) {
            Err("Compaction timeout".to_string())
        } else {
            Ok("Synthesized checkpoint of past conversation".to_string())
        }
    }
}

struct MockVerifier {
    results: Mutex<Vec<VerifierResult>>,
    verify_calls: AtomicUsize,
    always_fail: AtomicBool,
}

impl MockVerifier {
    fn new(results: Vec<VerifierResult>) -> Self {
        Self {
            results: Mutex::new(results),
            verify_calls: AtomicUsize::new(0),
            always_fail: AtomicBool::new(false),
        }
    }

    fn with_always_fail(self) -> Self {
        Self {
            results: self.results,
            verify_calls: self.verify_calls,
            always_fail: AtomicBool::new(true),
        }
    }
}

#[async_trait]
impl ProgrammaticVerifier for MockVerifier {
    async fn verify(&self, _task_id: &str) -> Result<VerifierResult, String> {
        self.verify_calls.fetch_add(1, Ordering::SeqCst);
        if self.always_fail.load(Ordering::SeqCst) {
            return Ok(VerifierResult {
                passed: false,
                exit_code: 1,
                diagnostics: "Persistent failure".to_string(),
            });
        }
        let mut guard = self.results.lock().await;
        if guard.is_empty() {
            Ok(VerifierResult {
                passed: true,
                exit_code: 0,
                diagnostics: "All checks passed".to_string(),
            })
        } else {
            Ok(guard.remove(0))
        }
    }
}

#[tokio::test]
async fn test_happy_path_single_turn() {
    let model = Arc::new(MockModel::new(vec![ModelTurnResult {
        response_text: "Generated code fix".to_string(),
        tool_action: Some("apply_patch(diff)".to_string()),
        tokens_estimate: 50,
    }]));
    let verifier = Arc::new(MockVerifier::new(vec![VerifierResult {
        passed: true,
        exit_code: 0,
        diagnostics: "Tests passed: 10 ok".to_string(),
    }]));

    let config = RigAgentConfig::default();
    let mut agent = RigAgentLoop::new(config, model, verifier);

    let summary = agent
        .execute_loop("session_1", "task_1", "Fix the bug in parser.rs")
        .await;

    assert_eq!(summary.final_state, AgentLoopState::Complete);
    assert_eq!(summary.steps_taken, 1);
    assert!(summary.final_message.contains("Generated code fix"));
}

#[tokio::test]
async fn test_verification_retry_self_correction() {
    let model = Arc::new(MockModel::new(vec![
        ModelTurnResult {
            response_text: "First attempt: patched function".to_string(),
            tool_action: Some("apply_patch(v1)".to_string()),
            tokens_estimate: 40,
        },
        ModelTurnResult {
            response_text: "Second attempt: fixed syntax error based on feedback".to_string(),
            tool_action: Some("apply_patch(v2)".to_string()),
            tokens_estimate: 45,
        },
    ]));

    let verifier = Arc::new(MockVerifier::new(vec![
        VerifierResult {
            passed: false,
            exit_code: 1,
            diagnostics: "error[E0425]: cannot find value `x` in this scope".to_string(),
        },
        VerifierResult {
            passed: true,
            exit_code: 0,
            diagnostics: "Compilation succeeded, 15 tests passed".to_string(),
        },
    ]));

    let config = RigAgentConfig::default();
    let mut agent = RigAgentLoop::new(config, model, verifier.clone());

    let summary = agent
        .execute_loop("session_2", "task_2", "Implement feature")
        .await;

    assert_eq!(summary.final_state, AgentLoopState::Complete);
    assert_eq!(summary.steps_taken, 2);
    assert_eq!(verifier.verify_calls.load(Ordering::SeqCst), 2);

    // Verify history contains feedback for self-correction
    let history_joined = agent.history.join("\n");
    assert!(history_joined.contains("VERIFIER_FEEDBACK (exit code 1)"));
    assert!(history_joined.contains("cannot find value `x`"));
}

#[tokio::test]
async fn test_compaction_75_percent_watermark_trigger() {
    let model = Arc::new(MockModel::new(vec![ModelTurnResult {
        response_text: "Done after compaction".to_string(),
        tool_action: None,
        tokens_estimate: 20,
    }]));
    let verifier = Arc::new(MockVerifier::new(vec![]));

    // max 100 tokens, watermark 0.75 => threshold is 75 tokens
    let config = RigAgentConfig {
        max_steps: 10,
        max_context_tokens: 100,
        watermark_ratio: 0.75,
    };
    let mut agent = RigAgentLoop::new(config, model.clone(), verifier);

    // Inject a prompt long enough to cross the 75-token watermark (320 chars = 80 tokens)
    let long_prompt = "A".repeat(320);
    let summary = agent.execute_loop("session_3", "task_3", &long_prompt).await;

    assert_eq!(summary.final_state, AgentLoopState::Complete);
    assert_eq!(model.compact_calls.load(Ordering::SeqCst), 1);

    // Verify checkpoint replaced earlier history
    assert!(agent.history[0].contains("SYSTEM CHECKPOINT: Synthesized checkpoint"));
}

#[tokio::test]
async fn test_compaction_sliding_window_fallback_on_error() {
    let model = Arc::new(MockModel::new(vec![ModelTurnResult {
        response_text: "Done after fallback".to_string(),
        tool_action: None,
        tokens_estimate: 20,
    }]));
    model.compact_should_fail.store(true, Ordering::SeqCst);

    let verifier = Arc::new(MockVerifier::new(vec![]));
    let config = RigAgentConfig {
        max_steps: 10,
        max_context_tokens: 100,
        watermark_ratio: 0.75,
    };
    let mut agent = RigAgentLoop::new(config, model, verifier);

    let long_prompt = "B".repeat(320);
    let summary = agent.execute_loop("session_4", "task_4", &long_prompt).await;

    assert_eq!(summary.final_state, AgentLoopState::Complete);
    let history_joined = agent.history.join("\n");
    assert!(history_joined.contains("Earlier conversation truncated via sliding window fallback"));
}

#[tokio::test]
async fn test_step_limit_reached() {
    let model = Arc::new(MockModel::new(vec![]).with_default_tool("retry_patch".to_string()));
    let verifier = Arc::new(MockVerifier::new(vec![]).with_always_fail());

    let config = RigAgentConfig {
        max_steps: 3,
        max_context_tokens: 128_000,
        watermark_ratio: 0.75,
    };
    let mut agent = RigAgentLoop::new(config, model, verifier);

    let summary = agent.execute_loop("session_5", "task_5", "Do impossible task").await;

    match summary.final_state {
        AgentLoopState::HaltError(msg) => assert!(msg.contains("STEP_LIMIT_REACHED")),
        other => panic!("Expected HaltError, got {other:?}"),
    }
    assert_eq!(summary.steps_taken, 3);
}

#[tokio::test]
async fn test_zero_balance_hard_lock() {
    let model = Arc::new(MockModel::new(vec![]));
    let verifier = Arc::new(MockVerifier::new(vec![]));

    let config = RigAgentConfig::default();
    let mut agent = RigAgentLoop::new(config, model, verifier);
    agent.set_hard_lock(true);

    let summary = agent.execute_loop("session_6", "task_6", "Run task").await;

    match summary.final_state {
        AgentLoopState::HaltError(msg) => assert!(msg.contains("HARD_LOCK")),
        other => panic!("Expected HaltError, got {other:?}"),
    }
    assert_eq!(summary.steps_taken, 0);
}
