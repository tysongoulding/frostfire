use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolApprovalRequest {
    pub request_id: String,
    pub agent_id: String,
    pub tool_name: String,
    pub parameters: serde_json::Value,
    pub rationale: String,
}

/// Deterministic Security Filter:
/// Scans manifests and removes all destructive tools before exposing to LLMs.
pub struct SecurityFilter {
    pub forbidden_patterns: Vec<String>,
}

impl Default for SecurityFilter {
    fn default() -> Self {
        Self {
            forbidden_patterns: vec![
                "delete_message".to_string(),
                "trash_message".to_string(),
                "purge".to_string(),
                "drop_table".to_string(),
                "rm".to_string(),
                "format_disk".to_string(),
                "truncate".to_string(),
            ],
        }
    }
}

impl SecurityFilter {
    pub fn new(forbidden: Vec<String>) -> Self {
        Self {
            forbidden_patterns: forbidden,
        }
    }

    pub fn is_allowed(&self, tool_name: &str) -> bool {
        let lower = tool_name.to_lowercase();
        !self.forbidden_patterns.iter().any(|pattern| lower.contains(pattern))
    }

    pub fn filter_tools(&self, tools: Vec<ToolDefinition>) -> Vec<ToolDefinition> {
        tools
            .into_iter()
            .filter(|t| self.is_allowed(&t.name))
            .collect()
    }
}

// Native Rig Tool: ReadFileTool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadFileArgs {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct ReadFileOutput {
    pub content: String,
    pub size_bytes: usize,
}

// MCP Connector abstraction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub server_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: std::collections::HashMap<String, String>,
}

pub struct McpConnector {
    pub servers: Vec<McpServerConfig>,
}

impl McpConnector {
    pub fn new() -> Self {
        Self { servers: Vec::new() }
    }

    pub fn register_server(&mut self, config: McpServerConfig) {
        self.servers.retain(|s| s.server_id != config.server_id);
        self.servers.push(config);
    }
}

impl Default for McpConnector {
    fn default() -> Self {
        Self::new()
    }
}

// -----------------------------------------------------------------------------
// Workspace Path Jailing & Native In-Process Tools (ADR-0002, ADR-0009)
// -----------------------------------------------------------------------------

#[derive(thiserror::Error, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolError {
    #[error("Workspace path jail violation: attempted path '{attempted_path}' is outside workspace jail '{jail_root}'")]
    WorkspaceJailViolation {
        attempted_path: String,
        jail_root: String,
    },

    #[error("IO error executing tool: {0}")]
    IoError(String),

    #[error("Tool execution denied: {0}")]
    ExecutionDenied(String),
}

#[derive(Debug, Clone)]
pub struct WorkspaceJail {
    root: std::path::PathBuf,
}

impl WorkspaceJail {
    pub fn new(root: impl Into<std::path::PathBuf>) -> Self {
        let root = root.into();
        let canonical = std::fs::canonicalize(&root).unwrap_or(root);
        Self { root: canonical }
    }

    pub fn root(&self) -> &std::path::Path {
        &self.root
    }

    pub fn validate_path(&self, requested_path: &str) -> Result<std::path::PathBuf, ToolError> {
        let path = std::path::Path::new(requested_path);
        let target = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.root.join(path)
        };

        let normalized = if target.exists() {
            std::fs::canonicalize(&target).map_err(|e| ToolError::IoError(e.to_string()))?
        } else if let Some(parent) = target.parent() {
            if parent.exists() {
                let canonical_parent =
                    std::fs::canonicalize(parent).map_err(|e| ToolError::IoError(e.to_string()))?;
                canonical_parent.join(target.file_name().unwrap_or_default())
            } else {
                target.clone()
            }
        } else {
            target.clone()
        };

        if !normalized.starts_with(&self.root) {
            return Err(ToolError::WorkspaceJailViolation {
                attempted_path: requested_path.to_string(),
                jail_root: self.root.display().to_string(),
            });
        }

        Ok(normalized)
    }
}

pub fn native_read_file(jail: &WorkspaceJail, path: &str) -> Result<String, ToolError> {
    let safe_path = jail.validate_path(path)?;
    std::fs::read_to_string(&safe_path).map_err(|e| ToolError::IoError(e.to_string()))
}

pub fn native_write_file(
    jail: &WorkspaceJail,
    path: &str,
    content: &str,
) -> Result<usize, ToolError> {
    let safe_path = jail.validate_path(path)?;
    if let Some(parent) = safe_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ToolError::IoError(e.to_string()))?;
    }
    std::fs::write(&safe_path, content).map_err(|e| ToolError::IoError(e.to_string()))?;
    Ok(content.len())
}

pub fn native_list_dir(jail: &WorkspaceJail, path: &str) -> Result<Vec<String>, ToolError> {
    let safe_path = jail.validate_path(path)?;
    let entries =
        std::fs::read_dir(&safe_path).map_err(|e| ToolError::IoError(e.to_string()))?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        if let Ok(name) = entry.file_name().into_string() {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

// -----------------------------------------------------------------------------
// Role-Scoped JIT Tool Injection (ADR-0005)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SprintPhase {
    Understand,
    Sketch,
    Decide,
    Prototype,
}

pub struct JitToolManager;

impl JitToolManager {
    /// JIT filter keeping prompt tool schemas strictly under 500 tokens (ADR-0005)
    pub fn get_tools_for_phase(phase: SprintPhase, is_lead: bool) -> Vec<ToolDefinition> {
        match phase {
            SprintPhase::Understand => vec![
                ToolDefinition {
                    name: "read_file".to_string(),
                    description: "Read contents of a workspace file".to_string(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "Relative path to file" }
                        },
                        "required": ["path"]
                    }),
                },
                ToolDefinition {
                    name: "list_dir".to_string(),
                    description: "List directory contents safely".to_string(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "Relative directory path" }
                        },
                        "required": ["path"]
                    }),
                },
            ],
            SprintPhase::Sketch => vec![
                ToolDefinition {
                    name: "read_file".to_string(),
                    description: "Read contents of a workspace file".to_string(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": { "path": { "type": "string" } },
                        "required": ["path"]
                    }),
                },
                ToolDefinition {
                    name: "list_dir".to_string(),
                    description: "List directory contents safely".to_string(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": { "path": { "type": "string" } },
                        "required": ["path"]
                    }),
                },
                ToolDefinition {
                    name: "search_files".to_string(),
                    description: "Search file names and contents in workspace".to_string(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": {
                            "query": { "type": "string" }
                        },
                        "required": ["query"]
                    }),
                },
            ],
            SprintPhase::Decide => vec![
                ToolDefinition {
                    name: "read_file".to_string(),
                    description: "Read contents of a workspace file".to_string(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": { "path": { "type": "string" } },
                        "required": ["path"]
                    }),
                },
                ToolDefinition {
                    name: "compare_artifacts".to_string(),
                    description: "Compare two artifact versions on Blackboard".to_string(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": {
                            "uri_a": { "type": "string" },
                            "uri_b": { "type": "string" }
                        },
                        "required": ["uri_a", "uri_b"]
                    }),
                },
            ],
            SprintPhase::Prototype => {
                if is_lead {
                    vec![
                        ToolDefinition {
                            name: "read_file".to_string(),
                            description: "Read contents of a workspace file".to_string(),
                            parameters: serde_json::json!({
                                "type": "object",
                                "properties": { "path": { "type": "string" } },
                                "required": ["path"]
                            }),
                        },
                        ToolDefinition {
                            name: "evaluate_metrics".to_string(),
                            description: "Evaluate deliverables against test and invariant suites"
                                .to_string(),
                            parameters: serde_json::json!({
                                "type": "object",
                                "properties": { "suite": { "type": "string" } },
                                "required": ["suite"]
                            }),
                        },
                    ]
                } else {
                    vec![
                        ToolDefinition {
                            name: "read_file".to_string(),
                            description: "Read contents of a workspace file".to_string(),
                            parameters: serde_json::json!({
                                "type": "object",
                                "properties": { "path": { "type": "string" } },
                                "required": ["path"]
                            }),
                        },
                        ToolDefinition {
                            name: "write_file".to_string(),
                            description: "Write code deliverables safely to workspace".to_string(),
                            parameters: serde_json::json!({
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string" },
                                    "content": { "type": "string" }
                                },
                                "required": ["path", "content"]
                            }),
                        },
                        ToolDefinition {
                            name: "list_dir".to_string(),
                            description: "List directory contents safely".to_string(),
                            parameters: serde_json::json!({
                                "type": "object",
                                "properties": { "path": { "type": "string" } },
                                "required": ["path"]
                            }),
                        },
                    ]
                }
            }
        }
    }
}
