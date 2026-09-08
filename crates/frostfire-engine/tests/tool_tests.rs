use frostfire_engine::tools::{SecurityFilter, ToolDefinition};

#[test]
fn test_security_filter_strips_destructive() {
    let filter = SecurityFilter::default();

    let tools = vec![
        ToolDefinition {
            name: "read_file".to_string(),
            description: "Read contents of a file safely".to_string(),
            parameters: serde_json::json!({}),
        },
        ToolDefinition {
            name: "delete_message".to_string(),
            description: "Delete an email message".to_string(),
            parameters: serde_json::json!({}),
        },
        ToolDefinition {
            name: "trash_message".to_string(),
            description: "Move message to trash".to_string(),
            parameters: serde_json::json!({}),
        },
        ToolDefinition {
            name: "drop_table".to_string(),
            description: "Drop a database table".to_string(),
            parameters: serde_json::json!({}),
        },
        ToolDefinition {
            name: "purge_cache".to_string(),
            description: "Purge system cache".to_string(),
            parameters: serde_json::json!({}),
        },
        ToolDefinition {
            name: "summarize_document".to_string(),
            description: "Generate a markdown summary".to_string(),
            parameters: serde_json::json!({}),
        },
    ];

    let filtered = filter.filter_tools(tools);
    let allowed_names: Vec<String> = filtered.into_iter().map(|t| t.name).collect();

    assert_eq!(allowed_names, vec!["read_file", "summarize_document"]);
    assert!(!allowed_names.contains(&"delete_message".to_string()));
    assert!(!allowed_names.contains(&"trash_message".to_string()));
    assert!(!allowed_names.contains(&"drop_table".to_string()));
    assert!(!allowed_names.contains(&"purge_cache".to_string()));
}

#[test]
fn test_workspace_jail_traversal_prevention() {
    use frostfire_engine::tools::{native_read_file, native_write_file, ToolError, WorkspaceJail};

    let jail_dir = std::env::temp_dir().join(format!("frostfire_jail_test_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&jail_dir).unwrap();
    let jail = WorkspaceJail::new(&jail_dir);

    // 1. Allowed relative file write & read inside jail
    let written = native_write_file(&jail, "src/main.rs", "fn main() {}").unwrap();
    assert_eq!(written, 12);

    let content = native_read_file(&jail, "src/main.rs").unwrap();
    assert_eq!(content, "fn main() {}");

    // 2. Traversal attempt using ../ outside workspace root must fail
    let traversal_err = native_read_file(&jail, "../outside.txt");
    assert!(
        matches!(traversal_err, Err(ToolError::WorkspaceJailViolation { .. })),
        "Path traversal with '..' outside jail must trigger WorkspaceJailViolation"
    );

    // 3. Absolute path pointing outside workspace jail must fail
    #[cfg(target_os = "windows")]
    let out_of_jail_path = "C:\\Windows\\System32\\drivers\\etc\\hosts";
    #[cfg(not(target_os = "windows"))]
    let out_of_jail_path = "/etc/passwd";

    let abs_err = native_read_file(&jail, out_of_jail_path);
    assert!(
        matches!(abs_err, Err(ToolError::WorkspaceJailViolation { .. })),
        "Absolute path outside jail must trigger WorkspaceJailViolation"
    );

    let _ = std::fs::remove_dir_all(jail_dir);
}

#[test]
fn test_jit_tool_filtering_token_budget_under_500() {
    use frostfire_engine::tools::{JitToolManager, SprintPhase};

    // Phase 1: Understand (Lead and SME have read-only tools)
    let p1_tools = JitToolManager::get_tools_for_phase(SprintPhase::Understand, false);
    let p1_names: Vec<String> = p1_tools.iter().map(|t| t.name.clone()).collect();
    assert_eq!(p1_names, vec!["read_file", "list_dir"]);
    let p1_json = serde_json::to_string(&p1_tools).unwrap();
    assert!(p1_json.len() < 1000, "Manifest schema must be compact and under 500 tokens");

    // Phase 4: Prototype (Fast SME gets write tools, Lead gets verification tools)
    let sme_p4_tools = JitToolManager::get_tools_for_phase(SprintPhase::Prototype, false);
    let sme_names: Vec<String> = sme_p4_tools.iter().map(|t| t.name.clone()).collect();
    assert!(sme_names.contains(&"write_file".to_string()));

    let lead_p4_tools = JitToolManager::get_tools_for_phase(SprintPhase::Prototype, true);
    let lead_names: Vec<String> = lead_p4_tools.iter().map(|t| t.name.clone()).collect();
    assert!(!lead_names.contains(&"write_file".to_string()));
    assert!(lead_names.contains(&"evaluate_metrics".to_string()));
}
