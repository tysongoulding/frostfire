use frostfire_engine::routing::{ModelRouter, ModelTier, TaskProfile, TaskType};

#[test]
fn test_90_10_tier_routing() {
    let router = ModelRouter::default();

    // SME tasks -> 90% Fast Tier
    let parsing_task = TaskProfile {
        task_type: TaskType::DataParsing,
        role: "sme_research".to_string(),
        prompt_token_estimate: 500,
    };
    let parsing_route = router.route(&parsing_task);
    assert_eq!(parsing_route.tier, ModelTier::SmeFast);
    assert!(
        parsing_route.model_name.contains("flash")
            || parsing_route.model_name.contains("groq")
            || parsing_route.model_name.contains("mini")
    );

    let drafting_task = TaskProfile {
        task_type: TaskType::Drafting,
        role: "sme_builder".to_string(),
        prompt_token_estimate: 1200,
    };
    let drafting_route = router.route(&drafting_task);
    assert_eq!(drafting_route.tier, ModelTier::SmeFast);

    // PM and Lead tasks -> 10% Reasoning Tier
    let synthesis_task = TaskProfile {
        task_type: TaskType::PlanSynthesis,
        role: "team_pm".to_string(),
        prompt_token_estimate: 4000,
    };
    let synthesis_route = router.route(&synthesis_task);
    assert_eq!(synthesis_route.tier, ModelTier::ReasoningLead);
    assert!(
        synthesis_route.model_name.contains("pro") || synthesis_route.model_name.contains("sonnet")
    );

    let conflict_task = TaskProfile {
        task_type: TaskType::ConflictResolution,
        role: "lead_architect".to_string(),
        prompt_token_estimate: 3500,
    };
    let conflict_route = router.route(&conflict_task);
    assert_eq!(conflict_route.tier, ModelTier::ReasoningLead);
}

#[test]
fn test_deterministic_failover_chains() {
    let router = ModelRouter::default();

    let fast_task = TaskProfile {
        task_type: TaskType::ToolExecution,
        role: "sme_developer".to_string(),
        prompt_token_estimate: 800,
    };
    let fast_chain = router.failover_chain(&fast_task);
    assert!(
        fast_chain.len() >= 3,
        "Fast tier must have at least 3 failover stages"
    );
    assert_eq!(fast_chain[0].model_name, "gemini-2.0-flash");
    assert_eq!(fast_chain[1].model_name, "llama-3.3-70b-versatile");
    assert_eq!(fast_chain[2].model_name, "llama-3.2-3b");

    let lead_task = TaskProfile {
        task_type: TaskType::PlanSynthesis,
        role: "principal_architect".to_string(),
        prompt_token_estimate: 4000,
    };
    let lead_chain = router.failover_chain(&lead_task);
    assert!(
        lead_chain.len() >= 3,
        "Reasoning tier must have failover options"
    );
    assert_eq!(lead_chain[0].model_name, "gemini-1.5-pro");
    assert_eq!(lead_chain[1].model_name, "claude-3-7-sonnet");
    assert_eq!(lead_chain[2].model_name, "o3-mini");
}
