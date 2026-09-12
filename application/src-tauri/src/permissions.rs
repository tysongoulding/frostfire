use frostfire_exec::jail::WorkspaceJail;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "payload")]
pub enum HostSecurityAction {
    FileRead { path: String },
    FileWrite { path: String },
    FileDelete { path: String },
    DirectoryList { path: String },
    GitStatus,
    GitDiff,
    ClipboardRead,
    ClipboardWrite,
    ShellExecution { command: String },
    RawSocketConnect { host: String, port: u16 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionTier {
    Tier1AutoAllowed,
    Tier2ModalApprovalRequired,
    Tier3Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status")]
pub enum HostPermissionDecision {
    Allowed,
    ApprovalRequired {
        request_id: String,
        action_type: String,
        description: String,
        tier: PermissionTier,
    },
    Denied {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    pub rule_id: String,
    pub action_type: String,
    pub target_resource: String,
    pub permission: String, // "grant_always", "deny"
    pub created_at_unix_ms: i64,
}

#[derive(Clone)]
pub struct HostPermissionEngine {
    workspace_root: PathBuf,
    jail: Option<WorkspaceJail>,
    rules: Arc<RwLock<HashMap<String, PermissionRule>>>,
    pending_approvals: Arc<RwLock<HashMap<String, HostSecurityAction>>>,
}

impl HostPermissionEngine {
    pub fn new(workspace_root: PathBuf) -> Self {
        let jail = WorkspaceJail::new(&workspace_root).ok();
        Self {
            workspace_root,
            jail,
            rules: Arc::new(RwLock::new(HashMap::new())),
            pending_approvals: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Classifies an action into Tier 1, Tier 2, or Tier 3 according to Section 5.1.
    pub fn classify(&self, action: &HostSecurityAction) -> PermissionTier {
        match action {
            // TIER 3: Blocked
            HostSecurityAction::RawSocketConnect { .. } => PermissionTier::Tier3Blocked,
            HostSecurityAction::FileRead { path }
            | HostSecurityAction::FileWrite { path }
            | HostSecurityAction::FileDelete { path } => {
                let p = path.to_lowercase();
                if p.contains("/etc/shadow")
                    || p.contains("/dev/")
                    || p.contains("windows\\system32")
                    || p.contains("windows/system32")
                {
                    return PermissionTier::Tier3Blocked;
                }

                // Check containment in workspace jail
                let is_in_jail = self.is_path_in_jail(Path::new(path));
                match action {
                    HostSecurityAction::FileRead { .. } => {
                        if is_in_jail {
                            PermissionTier::Tier1AutoAllowed
                        } else {
                            PermissionTier::Tier2ModalApprovalRequired
                        }
                    }
                    _ => PermissionTier::Tier2ModalApprovalRequired,
                }
            }
            HostSecurityAction::ShellExecution { command } => {
                let cmd_lower = command.to_lowercase();
                if cmd_lower.contains("rm -rf /")
                    || cmd_lower.contains(":(){ :|:& };:")
                    || cmd_lower.contains("mkfs")
                {
                    PermissionTier::Tier3Blocked
                } else {
                    PermissionTier::Tier2ModalApprovalRequired
                }
            }
            HostSecurityAction::DirectoryList { path } => {
                if self.is_path_in_jail(Path::new(path)) {
                    PermissionTier::Tier1AutoAllowed
                } else {
                    PermissionTier::Tier2ModalApprovalRequired
                }
            }
            HostSecurityAction::GitStatus | HostSecurityAction::GitDiff => {
                PermissionTier::Tier1AutoAllowed
            }
            HostSecurityAction::ClipboardRead | HostSecurityAction::ClipboardWrite => {
                PermissionTier::Tier2ModalApprovalRequired
            }
        }
    }

    fn is_path_in_jail(&self, path: &Path) -> bool {
        if let Some(ref jail) = self.jail {
            jail.is_contained(path)
        } else {
            path.starts_with(&self.workspace_root)
        }
    }

    /// Evaluates a requested action, checking rules and determining if modal approval is required.
    pub async fn evaluate(&self, action: &HostSecurityAction) -> HostPermissionDecision {
        let tier = self.classify(action);
        match tier {
            PermissionTier::Tier3Blocked => HostPermissionDecision::Denied {
                reason: "Access denied by security perimeter: action is blocked".to_string(),
            },
            PermissionTier::Tier1AutoAllowed => HostPermissionDecision::Allowed,
            PermissionTier::Tier2ModalApprovalRequired => {
                // Check if an existing grant_always rule covers this action
                let action_key = self.get_action_key(action);
                let guard = self.rules.read().await;
                if let Some(rule) = guard.get(&action_key) {
                    if rule.permission == "grant_always" {
                        return HostPermissionDecision::Allowed;
                    } else if rule.permission == "deny" {
                        return HostPermissionDecision::Denied {
                            reason: "Previously denied by policy rule".to_string(),
                        };
                    }
                }

                // Register pending approval
                let request_id = format!("req_{}", Uuid::new_v4().simple());
                let mut pending = self.pending_approvals.write().await;
                pending.insert(request_id.clone(), action.clone());

                HostPermissionDecision::ApprovalRequired {
                    request_id,
                    action_type: action_key,
                    description: self.format_action_description(action),
                    tier,
                }
            }
        }
    }

    /// Submits a user approval decision for a pending request.
    pub async fn submit_decision(
        &self,
        request_id: &str,
        approved: bool,
        grant_always: bool,
    ) -> Result<HostSecurityAction, String> {
        let mut pending = self.pending_approvals.write().await;
        let action = pending
            .remove(request_id)
            .ok_or_else(|| format!("No pending approval for ID '{request_id}'"))?;

        if approved && grant_always {
            let action_key = self.get_action_key(&action);
            let mut rules_guard = self.rules.write().await;
            rules_guard.insert(
                action_key.clone(),
                PermissionRule {
                    rule_id: format!("rule_{}", Uuid::new_v4().simple()),
                    action_type: action_key,
                    target_resource: "*".to_string(),
                    permission: "grant_always".to_string(),
                    created_at_unix_ms: chrono::Utc::now().timestamp_millis(),
                },
            );
        }

        if approved {
            Ok(action)
        } else {
            Err("User rejected permission request".to_string())
        }
    }

    fn get_action_key(&self, action: &HostSecurityAction) -> String {
        match action {
            HostSecurityAction::FileRead { .. } => "file_read".to_string(),
            HostSecurityAction::FileWrite { .. } => "file_write".to_string(),
            HostSecurityAction::FileDelete { .. } => "file_delete".to_string(),
            HostSecurityAction::DirectoryList { .. } => "dir_list".to_string(),
            HostSecurityAction::GitStatus => "git_status".to_string(),
            HostSecurityAction::GitDiff => "git_diff".to_string(),
            HostSecurityAction::ClipboardRead => "clipboard_read".to_string(),
            HostSecurityAction::ClipboardWrite => "clipboard_write".to_string(),
            HostSecurityAction::ShellExecution { .. } => "shell_execution".to_string(),
            HostSecurityAction::RawSocketConnect { .. } => "raw_socket".to_string(),
        }
    }

    fn format_action_description(&self, action: &HostSecurityAction) -> String {
        match action {
            HostSecurityAction::FileRead { path } => format!("Read file at: {path}"),
            HostSecurityAction::FileWrite { path } => format!("Write file at: {path}"),
            HostSecurityAction::FileDelete { path } => format!("Delete file at: {path}"),
            HostSecurityAction::DirectoryList { path } => format!("List directory at: {path}"),
            HostSecurityAction::GitStatus => "Inspect git repository status".to_string(),
            HostSecurityAction::GitDiff => "Inspect git repository diff".to_string(),
            HostSecurityAction::ClipboardRead => "Read contents from system clipboard".to_string(),
            HostSecurityAction::ClipboardWrite => "Write contents to system clipboard".to_string(),
            HostSecurityAction::ShellExecution { command } => {
                format!("Execute host shell command: {command}")
            }
            HostSecurityAction::RawSocketConnect { host, port } => {
                format!("Connect raw network socket to {host}:{port}")
            }
        }
    }
}
