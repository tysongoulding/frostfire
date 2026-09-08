use chrono::Utc;
use frostfire_core::blackboard::{
    AgentIdentity, BlackboardError, BlackboardManifest, DeterministicInvariantEngine,
    NamespaceEntry, NamespaceInvariants, WriteAclGuard,
};
use frostfire_core::dag::{
    DumbCoordinatorNode, HybridSplitMergeDag, PromotionManifest, TaskNode, WorkstreamDag,
};

#[test]
fn test_write_acl_guard_isolation_and_freezing() {
    let sme_research = AgentIdentity::new("sme_research", "sme_research");
    let admin = AgentIdentity::new_admin("system_admin");

    // Allowed: caller writes to own namespace
    assert!(WriteAclGuard::enforce_mutation(&sme_research, "sme_research", false).is_ok());

    // Denied: caller writes to different namespace
    let err = WriteAclGuard::enforce_mutation(&sme_research, "sme_arch", false);
    assert!(matches!(
        err,
        Err(BlackboardError::UnauthorizedMutation { .. })
    ));

    // Admin override: admin can write to any namespace
    assert!(WriteAclGuard::enforce_mutation(&admin, "sme_arch", false).is_ok());

    // Frozen: cannot mutate frozen namespace unless admin
    let frozen_err = WriteAclGuard::enforce_mutation(&sme_research, "sme_research", true);
    assert!(matches!(
        frozen_err,
        Err(BlackboardError::FrozenNamespace(_))
    ));
    assert!(WriteAclGuard::enforce_mutation(&admin, "sme_research", true).is_ok());
}

#[test]
fn test_deterministic_invariant_engine_tier0() {
    let mut manifest = BlackboardManifest::new("bb://teams/appsec/pipeline-412");

    manifest.namespaces.insert(
        "sme_research".to_string(),
        NamespaceEntry {
            artifact_uri: "blobs://sha256/e3b0c442".to_string(),
            author_id: "sme_research".to_string(),
            status: "completed".to_string(),
            invariants: NamespaceInvariants {
                produces: vec!["public_endpoints".to_string(), "cve_list".to_string()],
                prohibits: vec![],
                assumes: vec![],
            },
            blob_hash: "e3b0c442".to_string(),
            summary: "Extracted CVE list and endpoints.".to_string(),
            updated_at: Utc::now(),
        },
    );

    // Contradicting team: prohibits public_endpoints
    manifest.namespaces.insert(
        "sme_sec_gate".to_string(),
        NamespaceEntry {
            artifact_uri: "blobs://sha256/7f83b165".to_string(),
            author_id: "sme_sec_gate".to_string(),
            status: "completed".to_string(),
            invariants: NamespaceInvariants {
                produces: vec!["zero_trust_zones".to_string()],
                prohibits: vec!["public_endpoints".to_string()], // CLASH
                assumes: vec!["cve_list".to_string()],
            },
            blob_hash: "7f83b165".to_string(),
            summary: "Enforced zero trust boundaries.".to_string(),
            updated_at: Utc::now(),
        },
    );

    let result = DeterministicInvariantEngine::verify(&manifest);
    assert!(!result.is_valid);
    assert_eq!(result.conflicts.len(), 1);
    assert_eq!(result.conflicts[0].rule, "public_endpoints");
    assert_eq!(result.conflicts[0].producer_namespace, "sme_research");
    assert_eq!(result.conflicts[0].prohibiter_namespace, "sme_sec_gate");
}

#[test]
fn test_dual_plane_presentation_markdown_markers() {
    let mut manifest = BlackboardManifest::new("bb://teams/core/sprint-1");
    manifest.namespaces.insert(
        "sme_code".to_string(),
        NamespaceEntry {
            artifact_uri: "blobs://sha256/7f83b165".to_string(),
            author_id: "sme_code".to_string(),
            status: "completed".to_string(),
            invariants: NamespaceInvariants::default(),
            blob_hash: "7f83b165".to_string(),
            summary: "Updated ACL middleware to reject out-of-band mutations.".to_string(),
            updated_at: Utc::now(),
        },
    );

    let markdown = manifest.compile_presentation_markdown();
    assert!(markdown.contains("<!-- BEGIN_NAMESPACE: sme_code | WRITER: sme_code -->"));
    assert!(markdown.contains("## sme_code"));
    assert!(markdown.contains("- **Status:** completed"));
    assert!(markdown.contains("- **Artifact Hash:** sha256:7f83b165"));
    assert!(markdown.contains("Updated ACL middleware to reject out-of-band mutations."));
    assert!(markdown.contains("<!-- END_NAMESPACE: sme_code -->"));
}

#[test]
fn test_dumb_coordinator_node_parses_frontmatter() {
    let frontmatter = r#"
---
team_id: team_infra
artifact_uri: blackboard://ws-104/team_infra/sme_arch/topology@v1
status: completed
blob_hash: abcdef123456
produces: ["vpc_network", "subnets"]
prohibits: ["unencrypted_egress"]
assumes: ["aws_creds"]
---
# Topology Report
"#;

    let manifest = DumbCoordinatorNode::parse_frontmatter_manifest(frontmatter).unwrap();
    assert_eq!(manifest.team_id, "team_infra");
    assert_eq!(
        manifest.artifact_uri,
        "blackboard://ws-104/team_infra/sme_arch/topology@v1"
    );
    assert_eq!(manifest.status, "completed");
    assert_eq!(manifest.blob_hash, "abcdef123456");
    assert_eq!(manifest.invariants.produces, vec!["vpc_network", "subnets"]);
    assert_eq!(manifest.invariants.prohibits, vec!["unencrypted_egress"]);
    assert_eq!(manifest.invariants.assumes, vec!["aws_creds"]);
}

#[test]
fn test_hybrid_split_merge_dag_convergence_barrier_and_synthesis() {
    let mut hybrid_dag = HybridSplitMergeDag::new("fed-global-1");

    // Team 1: Infra
    let mut infra_dag = WorkstreamDag::new("team_infra");
    infra_dag.add_node(TaskNode::new("task-infra-1", "Deploy VPC", "sme_infra"));
    hybrid_dag.add_team_branch("team_infra", infra_dag);

    // Team 2: AppSec
    let mut appsec_dag = WorkstreamDag::new("team_appsec");
    appsec_dag.add_node(TaskNode::new("task-appsec-1", "Security Audit", "sme_sec"));
    hybrid_dag.add_team_branch("team_appsec", appsec_dag);

    // Barrier check before finalization: should fail
    assert!(hybrid_dag.check_convergence_barrier().is_err());
    assert!(hybrid_dag.merge_synthesis_gate().is_err());

    // Finalize Team 1
    hybrid_dag
        .finalize_team_branch(
            "team_infra",
            PromotionManifest {
                team_id: "team_infra".to_string(),
                artifact_uri: "blackboard://ws-1/team_infra/sme_infra/vpc@v1".to_string(),
                status: "completed".to_string(),
                blob_hash: "hash_infra".to_string(),
                invariants: NamespaceInvariants::default(),
            },
        )
        .unwrap();

    // Still missing Team 2: barrier still blocks
    assert!(hybrid_dag.check_convergence_barrier().is_err());

    // Finalize Team 2
    hybrid_dag
        .finalize_team_branch(
            "team_appsec",
            PromotionManifest {
                team_id: "team_appsec".to_string(),
                artifact_uri: "blackboard://ws-1/team_appsec/sme_sec/audit@v1".to_string(),
                status: "completed".to_string(),
                blob_hash: "hash_appsec".to_string(),
                invariants: NamespaceInvariants::default(),
            },
        )
        .unwrap();

    // Now barrier passes and synthesis gate merges URI pointers
    assert!(hybrid_dag.check_convergence_barrier().is_ok());
    let merged = hybrid_dag.merge_synthesis_gate().unwrap();
    assert_eq!(merged.len(), 2);
    assert!(merged.contains(&"blackboard://ws-1/team_infra/sme_infra/vpc@v1".to_string()));
    assert!(merged.contains(&"blackboard://ws-1/team_appsec/sme_sec/audit@v1".to_string()));
}
