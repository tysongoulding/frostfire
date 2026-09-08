use frostfire_core::blueprints::sprint::{OneHourSprintBlueprint, SprintPhase};

#[test]
fn test_one_hour_sprint_phases() {
    let sprint = OneHourSprintBlueprint::new("sprint-mvp", "FrostfireOS V6 Acceleration");

    assert_eq!(sprint.phases.len(), 4);
    assert_eq!(sprint.phases[0].phase, SprintPhase::UnderstandAndMap);
    assert_eq!(sprint.phases[1].phase, SprintPhase::SketchAndIdeate);
    assert_eq!(sprint.phases[2].phase, SprintPhase::DecideAndStoryboard);
    assert_eq!(sprint.phases[3].phase, SprintPhase::PrototypeAndSynthesize);

    // Verify duration totals 60 minutes
    let total_minutes: u32 = sprint.phases.iter().map(|p| p.duration_minutes).sum();
    assert_eq!(total_minutes, 60);

    // Verify all phases have assigned SMEs
    for phase in &sprint.phases {
        assert!(!phase.assigned_smes.is_empty(), "Phase {:?} must have assigned SMEs", phase.phase);
    }
}
