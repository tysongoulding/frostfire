use frostfire_exec::jail::WorkspaceJail;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

pub const PENDING_APPROVAL_TIMEOUT_MS: i64 = 60_000; // 60 seconds fail-closed timeout

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "payload")]
pub enum HostSecurityAction {
    FileRead { path: String },
    FileWrite { path: String, content_len: Option<usize> },
    FileDelete { path: String },
    SecretRead { path: String, secret_type: String },
    DirectoryList { path: String },
    GitStatus,
    GitDiff,
    ClipboardRead,
    ClipboardWrite,
    ShellExecution { command: String, cwd: Option<String> },
    NetworkRequest { url: String, method: String, domain: String },
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
        timeout_unix_ms: i64,
    },
    Denied {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionGrantInfo {
    pub grant_id: String,
    pub action_type: String,
    pub target_pattern: String,
    pub granted_at_unix_ms: i64,
}

#[derive(Debug, Clone)]
struct PendingApprovalItem {
    action: HostSecurityAction,
    created_at_unix_ms: i64,
}

#[derive(Clone)]
pub struct HostPermissionEngine {
    workspace_root: PathBuf,
    jail: Option<WorkspaceJail>,
    session_grants: Arc<RwLock<HashMap<String, SessionGrantInfo>>>,
    pending_approvals: Arc<RwLock<HashMap<String, PendingApprovalItem>>>,
}

impl HostPermissionEngine {
    pub fn new(workspace_root: PathBuf) -> Self {
        let jail = WorkspaceJail::new(&workspace_root).ok();
        Self {
            workspace_root,
            jail,
            session_grants: Arc::new(RwLock::new(HashMap::new())),
            pending_approvals: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Secret Shield: Detects sensitive files (.env, credentials, private keys).
    pub fn is_secret_file(path_str: &str) -> Option<&'static str> {
        let path = Path::new(path_str);
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();

        if file_name.starts_with(".env") {
            return Some("Environment Configuration (.env)");
        }
        if file_name == "credentials.json" || file_name == "token.json" {
            return Some("OAuth & Service Credentials");
        }
        if file_name.ends_with(".pem")
            || file_name.ends_with(".key")
            || file_name.starts_with("id_rsa")
            || file_name.starts_with("id_ed25519")
        {
            return Some("Cryptographic Private Key");
        }
        None
    }

    /// Checks if a shell command is a known safe developer read/test command.
    pub fn is_safe_dev_command(command: &str) -> bool {
        let trimmed = command.trim();
        let safe_prefixes = [
            "git status",
            "git diff",
            "git log",
            "git branch",
            "cargo check",
            "cargo test",
            "cargo build",
            "cargo clippy",
            "npm test",
            "npm run build",
            "npm run lint",
            "npm run test",
            "pnpm test",
            "yarn test",
        ];

        // Ensure the command starts with a safe prefix and contains no chaining operators
        if safe_prefixes.iter().any(|p| trimmed.starts_with(p)) {
            let has_chaining = trimmed.contains(';')
                || trimmed.contains('&')
                || trimmed.contains('|')
                || trimmed.contains('>');
            return !has_chaining;
        }
        false
    }

    /// Developer Domain Allowlist: Check if domain is safe dev registry or local loopback.
    pub fn is_allowed_dev_network(domain: &str) -> bool {
        let lower = domain.trim().to_lowercase();
        let allowed_domains = [
            "localhost",
            "127.0.0.1",
            "::1",
            "0.0.0.0",
            "github.com",
            "api.github.com",
            "raw.githubusercontent.com",
            "crates.io",
            "static.crates.io",
            "index.crates.io",
            "npmjs.org",
            "registry.npmjs.org",
        ];

        allowed_domains.iter().any(|d| lower == *d || lower.ends_with(&format!(".{d}")))
    }

    /// Classifies an action into Tier 1, Tier 2, or Tier 3 according to the Hybrid Scoped Policy.
    pub fn classify(&self, action: &HostSecurityAction) -> PermissionTier {
        match action {
            // TIER 3: Blocked (unbound sockets, system-level destruction)
            HostSecurityAction::RawSocketConnect { .. } => PermissionTier::Tier3Blocked,

            HostSecurityAction::FileRead { path }
            | HostSecurityAction::FileWrite { path, .. }
            | HostSecurityAction::FileDelete { path } => {
                let p = path.to_lowercase();
                if p.contains("/etc/shadow")
                    || p.contains("/dev/")
                    || p.contains("windows\\system32")
                    || p.contains("windows/system32")
                    || p.contains("/usr/bin")
                {
                    return PermissionTier::Tier3Blocked;
                }

                // Secret Shield: Secret files always require explicit HITL approval
                if Self::is_secret_file(path).is_some() {
                    return PermissionTier::Tier2ModalApprovalRequired;
                }

                let in_jail = self.is_path_in_jail(Path::new(path));
                match action {
                    HostSecurityAction::FileRead { .. } => {
                        if in_jail {
                            PermissionTier::Tier1AutoAllowed
                        } else {
                            PermissionTier::Tier2ModalApprovalRequired
                        }
                    }
                    HostSecurityAction::FileWrite { .. } => {
                        if in_jail {
                            // In-workspace write is allowed under workspace scope
                            PermissionTier::Tier1AutoAllowed
                        } else {
                            PermissionTier::Tier2ModalApprovalRequired
                        }
                    }
                    HostSecurityAction::FileDelete { .. } => {
                        PermissionTier::Tier2ModalApprovalRequired
                    }
                    _ => PermissionTier::Tier2ModalApprovalRequired,
                }
            }

            HostSecurityAction::SecretRead { .. } => PermissionTier::Tier2ModalApprovalRequired,

            HostSecurityAction::ShellExecution { command, cwd } => {
                let cmd_lower = command.to_lowercase();
                if cmd_lower.contains("rm -rf /")
                    || cmd_lower.contains("rmdir /s /q c:")
                    || cmd_lower.contains("mkfs")
                    || cmd_lower.contains(":(){ :|:& };:")
                    || cmd_lower.contains("dd if=/dev/zero")
                {
                    return PermissionTier::Tier3Blocked;
                }

                // Check safe dev command in workspace
                let cwd_in_workspace = match cwd {
                    Some(c) => self.is_path_in_jail(Path::new(c)),
                    None => true,
                };

                if cwd_in_workspace && Self::is_safe_dev_command(command) {
                    PermissionTier::Tier1AutoAllowed
                } else {
                    PermissionTier::Tier2ModalApprovalRequired
                }
            }

            HostSecurityAction::NetworkRequest { domain, .. } => {
                if Self::is_allowed_dev_network(domain) {
                    PermissionTier::Tier1AutoAllowed
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

    /// Evaluates an action against active session grants and classifier.
    pub async fn evaluate(&self, action: &HostSecurityAction) -> HostPermissionDecision {
        // Automatically classify into tier
        let tier = self.classify(action);
        match tier {
            PermissionTier::Tier3Blocked => HostPermissionDecision::Denied {
                reason: "Operation permanently blocked by Frostfire host security perimeter".to_string(),
            },
            PermissionTier::Tier1AutoAllowed => HostPermissionDecision::Allowed,
            PermissionTier::Tier2ModalApprovalRequired => {
                // Check if active session grant exists for this action
                let action_key = self.get_action_key(action);
                let grants = self.session_grants.read().await;
                if grants.contains_key(&action_key) {
                    return HostPermissionDecision::Allowed;
                }

                // Clean up expired pending approvals (> 60s)
                let now = chrono::Utc::now().timestamp_millis();
                let mut pending = self.pending_approvals.write().await;
                pending.retain(|_, item| (now - item.created_at_unix_ms) < PENDING_APPROVAL_TIMEOUT_MS);

                let request_id = format!("req_{}", Uuid::new_v4().simple());
                pending.insert(
                    request_id.clone(),
                    PendingApprovalItem {
                        action: action.clone(),
                        created_at_unix_ms: now,
                    },
                );

                HostPermissionDecision::ApprovalRequired {
                    request_id,
                    action_type: action_key,
                    description: self.format_action_description(action),
                    tier,
                    timeout_unix_ms: now + PENDING_APPROVAL_TIMEOUT_MS,
                }
            }
        }
    }

    /// Submits approval or denial for a pending request.
    pub async fn submit_decision(
        &self,
        request_id: &str,
        approved: bool,
        grant_session: bool,
    ) -> Result<HostSecurityAction, String> {
        let now = chrono::Utc::now().timestamp_millis();
        let mut pending = self.pending_approvals.write().await;
        let item = pending
            .remove(request_id)
            .ok_or_else(|| format!("Pending approval request '{request_id}' not found or expired"))?;

        // Fail-closed timeout check (60 seconds)
        if (now - item.created_at_unix_ms) >= PENDING_APPROVAL_TIMEOUT_MS {
            return Err("Approval request timed out (fail-closed after 60s)".to_string());
        }

        if approved {
            if grant_session {
                let action_key = self.get_action_key(&item.action);
                let mut grants = self.session_grants.write().await;
                grants.insert(
                    action_key.clone(),
                    SessionGrantInfo {
                        grant_id: format!("grant_{}", Uuid::new_v4().simple()),
                        action_type: action_key,
                        target_pattern: "*".to_string(),
                        granted_at_unix_ms: now,
                    },
                );
            }
            Ok(item.action)
        } else {
            Err("Action denied by user".to_string())
        }
    }

    /// Lists all active session grants.
    pub async fn list_session_grants(&self) -> Vec<SessionGrantInfo> {
        let guard = self.session_grants.read().await;
        guard.values().cloned().collect()
    }

    /// Revokes an active session grant by ID or action type.
    pub async fn revoke_session_grant(&self, grant_id: &str) -> bool {
        let mut guard = self.session_grants.write().await;
        let found = guard
            .iter()
            .find(|(_, g)| g.grant_id == grant_id || g.action_type == grant_id)
            .map(|(k, _)| k.clone());

        if let Some(key) = found {
            guard.remove(&key);
            true
        } else {
            false
        }
    }

    fn get_action_key(&self, action: &HostSecurityAction) -> String {
        match action {
            HostSecurityAction::FileRead { path } => {
                if let Some(st) = Self::is_secret_file(path) {
                    format!("secret_read:{st}")
                } else {
                    "file_read".to_string()
                }
            }
            HostSecurityAction::SecretRead { secret_type, .. } => format!("secret_read:{secret_type}"),
            HostSecurityAction::FileWrite { .. } => "file_write".to_string(),
            HostSecurityAction::FileDelete { .. } => "file_delete".to_string(),
            HostSecurityAction::DirectoryList { .. } => "dir_list".to_string(),
            HostSecurityAction::GitStatus => "git_status".to_string(),
            HostSecurityAction::GitDiff => "git_diff".to_string(),
            HostSecurityAction::ClipboardRead => "clipboard_read".to_string(),
            HostSecurityAction::ClipboardWrite => "clipboard_write".to_string(),
            HostSecurityAction::ShellExecution { command, .. } => {
                let first_word = command.split_whitespace().next().unwrap_or("shell");
                format!("shell:{first_word}")
            }
            HostSecurityAction::NetworkRequest { domain, .. } => format!("network:{domain}"),
            HostSecurityAction::RawSocketConnect { .. } => "raw_socket".to_string(),
        }
    }

    fn format_action_description(&self, action: &HostSecurityAction) -> String {
        match action {
            HostSecurityAction::FileRead { path } => {
                if let Some(secret_name) = Self::is_secret_file(path) {
                    format!("[SECRET SHIELD] Access sensitive {secret_name} at: {path}")
                } else {
                    format!("Read file outside workspace: {path}")
                }
            }
            HostSecurityAction::SecretRead { path, secret_type } => {
                format!("[SECRET SHIELD] Access {secret_type} at: {path}")
            }
            HostSecurityAction::FileWrite { path, content_len } => match content_len {
                Some(len) => format!("Write {len} bytes to file: {path}"),
                None => format!("Write to file: {path}"),
            },
            HostSecurityAction::FileDelete { path } => format!("Delete file at: {path}"),
            HostSecurityAction::DirectoryList { path } => format!("List directory outside workspace: {path}"),
            HostSecurityAction::GitStatus => "Inspect git status".to_string(),
            HostSecurityAction::GitDiff => "Inspect git diff".to_string(),
            HostSecurityAction::ClipboardRead => "Read system clipboard".to_string(),
            HostSecurityAction::ClipboardWrite => "Write to system clipboard".to_string(),
            HostSecurityAction::ShellExecution { command, cwd } => match cwd {
                Some(c) => format!("Execute shell command '{command}' in '{c}'"),
                None => format!("Execute shell command: {command}"),
            },
            HostSecurityAction::NetworkRequest { url, method, domain } => {
                format!("Outbound {method} request to external domain '{domain}': {url}")
            }
            HostSecurityAction::RawSocketConnect { host, port } => {
                format!("Connect raw network socket to {host}:{port}")
            }
        }
    }
}
