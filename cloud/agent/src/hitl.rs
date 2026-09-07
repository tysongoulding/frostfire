use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tracing::info;

/// Evaluates execution safety and determines whether Human-In-The-Loop approval is required.
#[derive(Clone, Debug)]
pub struct HitlInterceptor {
    readonly_commands: HashSet<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandClassification {
    pub is_safe_readonly: bool,
    pub requires_approval: bool,
    pub risk_reason: Option<String>,
}

impl HitlInterceptor {
    pub fn new() -> Self {
        let mut readonly = HashSet::new();
        for cmd in &[
            "ls", "pwd", "cat", "grep", "rg", "find", "head", "tail", "wc", "echo",
            "git status", "git diff", "git log", "git branch", "which", "whoami",
            "uptime", "ps", "uname", "env"
        ] {
            readonly.insert(cmd.to_string());
        }

        Self {
            readonly_commands: readonly,
        }
    }

    /// Classify a command before execution
    pub fn classify_command(&self, command_line: &str) -> CommandClassification {
        let trimmed = command_line.trim();

        // Check if full command matches an exact read-only entry
        if self.readonly_commands.contains(trimmed) {
            return CommandClassification {
                is_safe_readonly: true,
                requires_approval: false,
                risk_reason: None,
            };
        }

        // Check command prefix
        let first_word = trimmed.split_whitespace().next().unwrap_or("");
        if self.readonly_commands.contains(first_word) && !trimmed.contains('>') && !trimmed.contains('|') {
            return CommandClassification {
                is_safe_readonly: true,
                requires_approval: false,
                risk_reason: None,
            };
        }

        // High risk keywords
        let risk_reason = if trimmed.contains("rm ") || trimmed.starts_with("rm") {
            Some("File deletion operation detected".to_string())
        } else if trimmed.contains("sudo") {
            Some("Elevated root privileges requested".to_string())
        } else if trimmed.contains("git push") || trimmed.contains("git reset") {
            Some("Repository mutation / push operation".to_string())
        } else if trimmed.contains("curl") || trimmed.contains("wget") {
            Some("Outbound network request requires egress approval".to_string())
        } else {
            Some(format!("Command '{}' is not in read-only allowlist", first_word))
        };

        info!("🛡️ [HitlInterceptor] Command requires approval: {:?}", risk_reason);

        CommandClassification {
            is_safe_readonly: false,
            requires_approval: true,
            risk_reason,
        }
    }
}
