use frostfire_os_lib::permissions::{
    HostPermissionDecision, HostPermissionEngine, HostSecurityAction, PermissionTier,
};
use std::env;

#[test]
fn test_terminal_safe_dev_commands_auto_allowed() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace.clone());

    let safe_commands = [
        "git status",
        "git diff HEAD~1",
        "git log -n 5",
        "cargo check --workspace",
        "cargo test",
        "npm test",
        "npm run build",
        "npm run lint",
    ];

    for cmd in safe_commands {
        let action = HostSecurityAction::ShellExecution {
            command: cmd.to_string(),
            cwd: Some(workspace.to_string_lossy().to_string()),
        };
        assert_eq!(
            engine.classify(&action),
            PermissionTier::Tier1AutoAllowed,
            "Command should be auto-allowed: {cmd}"
        );
    }
}

#[test]
fn test_terminal_arbitrary_shell_requires_approval() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace);

    let arbitrary_commands = [
        "curl https://external-api.com",
        "python script.py",
        "bash custom_tool.sh",
        "git status; rm -rf something", // Command chaining forbidden
    ];

    for cmd in arbitrary_commands {
        let action = HostSecurityAction::ShellExecution {
            command: cmd.to_string(),
            cwd: None,
        };
        assert_eq!(
            engine.classify(&action),
            PermissionTier::Tier2ModalApprovalRequired,
            "Arbitrary command should require approval: {cmd}"
        );
    }
}

#[test]
fn test_terminal_destructive_commands_blocked() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace);

    let destructive_commands = [
        "rm -rf / --no-preserve-root",
        "rmdir /s /q c:\\",
        "mkfs.ext4 /dev/sda1",
        ":(){ :|:& };:",
        "dd if=/dev/zero of=/dev/sda",
    ];

    for cmd in destructive_commands {
        let action = HostSecurityAction::ShellExecution {
            command: cmd.to_string(),
            cwd: None,
        };
        assert_eq!(
            engine.classify(&action),
            PermissionTier::Tier3Blocked,
            "Destructive command must be permanently blocked: {cmd}"
        );
    }
}

#[test]
fn test_secret_shield_protects_env_and_keys_in_workspace() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace.clone());

    // 1. Regular file in workspace -> Tier 1 Auto-Allowed
    let regular_file = workspace.join("src").join("main.rs").to_string_lossy().to_string();
    assert_eq!(
        engine.classify(&HostSecurityAction::FileRead { path: regular_file }),
        PermissionTier::Tier1AutoAllowed
    );

    // 2. Secret files located directly inside the workspace -> Tier 2 Approval Required via Secret Shield!
    let secret_files = [
        workspace.join(".env").to_string_lossy().to_string(),
        workspace.join(".env.local").to_string_lossy().to_string(),
        workspace.join(".env.production").to_string_lossy().to_string(),
        workspace.join("credentials.json").to_string_lossy().to_string(),
        workspace.join("token.json").to_string_lossy().to_string(),
        workspace.join("id_rsa").to_string_lossy().to_string(),
        workspace.join("cert.pem").to_string_lossy().to_string(),
        workspace.join("auth.key").to_string_lossy().to_string(),
    ];

    for secret in secret_files {
        let action = HostSecurityAction::FileRead { path: secret.clone() };
        assert_eq!(
            engine.classify(&action),
            PermissionTier::Tier2ModalApprovalRequired,
            "Secret shield must guard: {secret}"
        );
    }
}

#[test]
fn test_file_access_in_workspace_vs_outside() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace.clone());

    // Inside workspace read/write -> Auto-Allowed
    let in_workspace = workspace.join("app.config").to_string_lossy().to_string();
    assert_eq!(
        engine.classify(&HostSecurityAction::FileRead { path: in_workspace.clone() }),
        PermissionTier::Tier1AutoAllowed
    );
    assert_eq!(
        engine.classify(&HostSecurityAction::FileWrite {
            path: in_workspace,
            content_len: Some(100)
        }),
        PermissionTier::Tier1AutoAllowed
    );

    // Outside workspace -> Requires Approval
    let outside_path = if cfg!(windows) {
        "D:\\Personal\\Documents\\note.txt".to_string()
    } else {
        "/home/user/documents/note.txt".to_string()
    };
    assert_eq!(
        engine.classify(&HostSecurityAction::FileRead { path: outside_path.clone() }),
        PermissionTier::Tier2ModalApprovalRequired
    );

    // System directories -> Permanently Blocked
    let system_path = if cfg!(windows) {
        "C:\\Windows\\System32\\drivers\\etc\\hosts".to_string()
    } else {
        "/etc/shadow".to_string()
    };
    assert_eq!(
        engine.classify(&HostSecurityAction::FileRead { path: system_path }),
        PermissionTier::Tier3Blocked
    );
}

#[test]
fn test_network_loopback_and_registries_auto_allowed() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace);

    let allowed_requests = [
        ("http://localhost:3000/api", "localhost"),
        ("http://127.0.0.1:8080/health", "127.0.0.1"),
        ("https://github.com/tysongoulding/frostfire", "github.com"),
        ("https://api.github.com/repos", "api.github.com"),
        ("https://crates.io/api/v1/crates/tokio", "crates.io"),
        ("https://registry.npmjs.org/react", "registry.npmjs.org"),
    ];

    for (url, domain) in allowed_requests {
        let action = HostSecurityAction::NetworkRequest {
            url: url.to_string(),
            method: "GET".to_string(),
            domain: domain.to_string(),
        };
        assert_eq!(
            engine.classify(&action),
            PermissionTier::Tier1AutoAllowed,
            "Developer network request should be auto-allowed: {url}"
        );
    }
}

#[test]
fn test_network_external_domain_requires_approval_and_raw_sockets_blocked() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace);

    // External domain -> Requires Approval
    let ext_action = HostSecurityAction::NetworkRequest {
        url: "https://api.stripe.com/v1/charges".to_string(),
        method: "POST".to_string(),
        domain: "api.stripe.com".to_string(),
    };
    assert_eq!(
        engine.classify(&ext_action),
        PermissionTier::Tier2ModalApprovalRequired
    );

    // Raw socket connect -> Blocked
    let socket_action = HostSecurityAction::RawSocketConnect {
        host: "44.242.94.86".to_string(),
        port: 4444,
    };
    assert_eq!(
        engine.classify(&socket_action),
        PermissionTier::Tier3Blocked
    );
}

#[tokio::test]
async fn test_session_grant_caching_and_revocation() {
    let workspace = env::temp_dir();
    let engine = HostPermissionEngine::new(workspace);

    let ext_net = HostSecurityAction::NetworkRequest {
        url: "https://api.openai.com/v1/models".to_string(),
        method: "GET".to_string(),
        domain: "api.openai.com".to_string(),
    };

    // 1. Initial evaluate -> Requires Approval
    let dec1 = engine.evaluate(&ext_net).await;
    let req_id = match dec1 {
        HostPermissionDecision::ApprovalRequired { request_id, .. } => request_id,
        other => panic!("Expected ApprovalRequired, got {other:?}"),
    };

    // 2. Submit decision with grant_session: true
    let approved = engine.submit_decision(&req_id, true, true).await;
    assert!(approved.is_ok());

    // 3. Subsequent evaluate -> Auto Allowed via session grant!
    let dec2 = engine.evaluate(&ext_net).await;
    assert_eq!(dec2, HostPermissionDecision::Allowed);

    // 4. Verify in active grants list
    let grants = engine.list_session_grants().await;
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].action_type, "network:api.openai.com");

    // 5. Revoke session grant
    let revoked = engine.revoke_session_grant(&grants[0].grant_id).await;
    assert!(revoked);

    // 6. After revocation, evaluate requires approval again!
    let dec3 = engine.evaluate(&ext_net).await;
    match dec3 {
        HostPermissionDecision::ApprovalRequired { .. } => {}
        other => panic!("Expected ApprovalRequired after revocation, got {other:?}"),
    }
}
