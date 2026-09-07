use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SprintPhase {
    /// Phase 1: Understand & Map (00–15m)
    UnderstandAndMap,
    /// Phase 2: Sketch & Ideate (15–30m)
    SketchAndIdeate,
    /// Phase 3: Decide & Storyboard (30–45m)
    DecideAndStoryboard,
    /// Phase 4: Prototype & Synthesize (45–60m)
    PrototypeAndSynthesize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SprintPhaseConfig {
    pub phase: SprintPhase,
    pub title: String,
    pub description: String,
    pub duration_minutes: u32,
    pub assigned_smes: Vec<String>,
    pub required_artifacts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneHourSprintBlueprint {
    pub id: String,
    pub name: String,
    pub phases: Vec<SprintPhaseConfig>,
}

impl OneHourSprintBlueprint {
    pub fn new(id: &str, name: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            phases: vec![
                SprintPhaseConfig {
                    phase: SprintPhase::UnderstandAndMap,
                    title: "Phase 1: Understand & Map (00–15m)".to_string(),
                    description: "Research SMEs ingest user briefs, extract domain entities, and emit user journey maps into the Blackboard.".to_string(),
                    duration_minutes: 15,
                    assigned_smes: vec!["sme_research".to_string(), "sme_user_advocate".to_string()],
                    required_artifacts: vec!["user_journey_map".to_string(), "domain_entities".to_string()],
                },
                SprintPhaseConfig {
                    phase: SprintPhase::SketchAndIdeate,
                    title: "Phase 2: Sketch & Ideate (15–30m)".to_string(),
                    description: "Divergent SMEs generate multiple distinct solution architectures and interaction proposals in parallel.".to_string(),
                    duration_minutes: 15,
                    assigned_smes: vec!["sme_architect".to_string(), "sme_designer".to_string()],
                    required_artifacts: vec!["solution_candidates".to_string(), "interaction_flows".to_string()],
                },
                SprintPhaseConfig {
                    phase: SprintPhase::DecideAndStoryboard,
                    title: "Phase 3: Decide & Storyboard (30–45m)".to_string(),
                    description: "Evaluator SMEs critique candidate solutions; Team PM synthesizes feedback into an executable TeamPlan.".to_string(),
                    duration_minutes: 15,
                    assigned_smes: vec!["sme_evaluator".to_string(), "team_pm".to_string()],
                    required_artifacts: vec!["critique_matrix".to_string(), "team_plan".to_string()],
                },
                SprintPhaseConfig {
                    phase: SprintPhase::PrototypeAndSynthesize,
                    title: "Phase 4: Prototype & Synthesize (45–60m)".to_string(),
                    description: "Builder SMEs generate concrete schemas, mockups, and validation briefs according to the TeamPlan.".to_string(),
                    duration_minutes: 15,
                    assigned_smes: vec!["sme_builder".to_string(), "sme_qa_verifier".to_string()],
                    required_artifacts: vec!["schema_definitions".to_string(), "validation_brief".to_string()],
                },
            ],
        }
    }
}
