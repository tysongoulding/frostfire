use frostfire_os_lib::permissions::{
    HostPermissionDecision, HostPermissionEngine, HostSecurityAction, PermissionTier,
};
use frostfire_os_lib::screen_context::ScreenContextInfo;
use std::env;

#[test]
fn test_screen_context_xml_serialization() {
    let ctx = ScreenContextInfo {
        focused_application: "Visual Studio Code".to_string(),
        window_title: "frostfire — src/lib.rs".to_string(),
        viewport_width: 1920,
        viewport_height: 1080,
        dpi_scale: 1.0,
        display_slot_index: 1,
        display_resolution: "1280x800".to_string(),
    };

    let xml = ctx.to_xml_grammar();
    assert!(xml.starts_with("<screen_context>"));
    assert!(xml.ends_with("</screen_context>"));
    assert!(xml.contains("<focused_application>Visual Studio Code</focused_application>"));
    assert!(xml.contains("<window_title>frostfire — src/lib.rs</window_title>"));
    assert!(xml.contains("<viewport width=\"1920\" height=\"1080\" dpi_scale=\"1.0\" />"));
    assert!(xml.contains("<display_slot index=\"1\" resolution=\"1280x800\" />"));
}

#[test]
fn test_screen_context_capture_current() {
    let ctx = ScreenContextInfo::capture_current();
    assert!(!ctx.focused_application.is_empty());
    assert!(!ctx.window_title.is_empty());
    assert!(ctx.viewport_width > 0);
    assert!(ctx.viewport_height > 0);
}

#[test]
fn test_permission_classifier_tier1_auto_allowed() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace.clone());

    assert_eq!(
        engine.classify(&HostSecurityAction::GitStatus),
        PermissionTier::Tier1AutoAllowed
    );
    assert_eq!(
        engine.classify(&HostSecurityAction::GitDiff),
        PermissionTier::Tier1AutoAllowed
    );

    let inside_path = workspace.join("src").join("main.rs").to_string_lossy().to_string();
    assert_eq!(
        engine.classify(&HostSecurityAction::FileRead { path: inside_path }),
        PermissionTier::Tier1AutoAllowed
    );
}

#[test]
fn test_permission_classifier_tier2_modal_approval() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace.clone());

    assert_eq!(
        engine.classify(&HostSecurityAction::ClipboardRead),
        PermissionTier::Tier2ModalApprovalRequired
    );
    assert_eq!(
        engine.classify(&HostSecurityAction::ClipboardWrite),
        PermissionTier::Tier2ModalApprovalRequired
    );
    let outside_shell = if cfg!(windows) {
        "D:\\Tools\\custom.exe".to_string()
    } else {
        "/opt/custom/tool".to_string()
    };
    assert_eq!(
        engine.classify(&HostSecurityAction::ShellExecution {
            command: outside_shell,
            cwd: None,
        }),
        PermissionTier::Tier2ModalApprovalRequired
    );

    let outside_path = if cfg!(windows) {
        "D:\\Other\\Cargo.toml".to_string()
    } else {
        "/tmp/outside/Cargo.toml".to_string()
    };
    assert_eq!(
        engine.classify(&HostSecurityAction::FileWrite {
            path: outside_path,
            content_len: None
        }),
        PermissionTier::Tier2ModalApprovalRequired
    );
}

#[test]
fn test_permission_classifier_tier3_blocked() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace);

    assert_eq!(
        engine.classify(&HostSecurityAction::FileRead {
            path: "/etc/shadow".to_string()
        }),
        PermissionTier::Tier3Blocked
    );
    assert_eq!(
        engine.classify(&HostSecurityAction::FileWrite {
            path: "C:\\Windows\\System32\\drivers\\etc\\hosts".to_string(),
            content_len: None,
        }),
        PermissionTier::Tier3Blocked
    );
    assert_eq!(
        engine.classify(&HostSecurityAction::RawSocketConnect {
            host: "10.0.0.1".to_string(),
            port: 8080
        }),
        PermissionTier::Tier3Blocked
    );
    assert_eq!(
        engine.classify(&HostSecurityAction::ShellExecution {
            command: "rm -rf / --no-preserve-root".to_string(),
            cwd: None,
        }),
        PermissionTier::Tier3Blocked
    );
}

#[tokio::test]
async fn test_permission_evaluation_and_approval_workflow() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace);

    let action = HostSecurityAction::ClipboardRead;

    // First evaluation: Requires modal/HITL approval
    let decision = engine.evaluate(&action).await;
    let request_id = match decision {
        HostPermissionDecision::ApprovalRequired { request_id, action_type, .. } => {
            assert_eq!(action_type, "clipboard_read");
            request_id
        }
        other => panic!("Expected ApprovalRequired, got {other:?}"),
    };

    // Rejecting a bad request ID fails
    assert!(engine.submit_decision("invalid_id", true, false).await.is_err());

    // Approving with grant_always: true
    let approved_action = engine.submit_decision(&request_id, true, true).await.unwrap();
    assert_eq!(approved_action, action);

    // Second evaluation: Automatically allowed due to persistent grant_always rule!
    let second_decision = engine.evaluate(&action).await;
    assert_eq!(second_decision, HostPermissionDecision::Allowed);

    // Test rejection
    let shell_action = HostSecurityAction::ShellExecution {
        command: "cat /etc/passwd".to_string(),
        cwd: None,
    };
    let shell_decision = engine.evaluate(&shell_action).await;
    if let HostPermissionDecision::ApprovalRequired { request_id, .. } = shell_decision {
        let res = engine.submit_decision(&request_id, false, false).await;
        assert!(res.is_err());
    } else {
        panic!("Expected ApprovalRequired for shell execution");
    }
}
