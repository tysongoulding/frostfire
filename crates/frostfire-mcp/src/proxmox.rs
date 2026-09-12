use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::debug;

use crate::protocol::{
    JsonRpcError, JsonRpcRequest, JsonRpcResponse, INVALID_PARAMS, METHOD_NOT_FOUND,
};

/// Configuration required to connect to a Proxmox VE hypervisor REST API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxmoxConfig {
    /// Proxmox VE base URL (e.g. "https://192.168.1.100:8006")
    pub endpoint: String,
    /// Proxmox API Token ID (e.g. "agent@pam!frostfire")
    pub token_id: String,
    /// Proxmox API Token Secret UUID
    pub token_secret: String,
    /// Whether to enforce strict TLS verification (default false for self-signed certificates)
    #[serde(default)]
    pub verify_ssl: bool,
}

impl ProxmoxConfig {
    pub fn new(
        endpoint: impl Into<String>,
        token_id: impl Into<String>,
        token_secret: impl Into<String>,
        verify_ssl: bool,
    ) -> Self {
        Self {
            endpoint: endpoint.into().trim_end_matches('/').to_string(),
            token_id: token_id.into(),
            token_secret: token_secret.into(),
            verify_ssl,
        }
    }

    /// Generates the HTTP Authorization header string according to Proxmox API Token specification:
    /// `Authorization: PVEAPIToken=USER@REALM!TOKENID=UUID`
    pub fn auth_header_value(&self) -> String {
        format!("PVEAPIToken={}={}", self.token_id, self.token_secret)
    }
}

/// Abstract transport trait allowing unit tests to mock Proxmox VE API responses.
#[async_trait]
pub trait PveApiTransport: Send + Sync {
    async fn get(&self, path: &str) -> Result<serde_json::Value, String>;
    async fn post(&self, path: &str, body: Option<&serde_json::Value>) -> Result<serde_json::Value, String>;
}

/// Live HTTP transport communicating directly with Proxmox VE REST API v2 (`/api2/json`).
pub struct HttpPveTransport {
    config: ProxmoxConfig,
    client: reqwest::Client,
}

impl HttpPveTransport {
    pub fn new(config: ProxmoxConfig) -> Result<Self, String> {
        let mut builder = reqwest::Client::builder();
        if !config.verify_ssl {
            builder = builder.danger_accept_invalid_certs(true);
        }
        let client = builder
            .build()
            .map_err(|e| format!("Failed to build HTTP client for Proxmox: {e}"))?;

        Ok(Self { config, client })
    }
}

#[async_trait]
impl PveApiTransport for HttpPveTransport {
    async fn get(&self, path: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/api2/json{}", self.config.endpoint, path);
        debug!(url = %url, "PVE GET request");

        let res = self
            .client
            .get(&url)
            .header("Authorization", self.config.auth_header_value())
            .send()
            .await
            .map_err(|e| format!("Proxmox GET error: {e}"))?;

        let status = res.status();
        let body: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse Proxmox JSON response: {e}"))?;

        if !status.is_success() {
            return Err(format!("Proxmox API returned HTTP {status}: {body}"));
        }

        Ok(body.get("data").cloned().unwrap_or(body))
    }

    async fn post(&self, path: &str, body: Option<&serde_json::Value>) -> Result<serde_json::Value, String> {
        let url = format!("{}/api2/json{}", self.config.endpoint, path);
        debug!(url = %url, "PVE POST request");

        let mut req = self
            .client
            .post(&url)
            .header("Authorization", self.config.auth_header_value());

        if let Some(payload) = body {
            req = req.json(payload);
        }

        let res = req
            .send()
            .await
            .map_err(|e| format!("Proxmox POST error: {e}"))?;

        let status = res.status();
        let json_body: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse Proxmox JSON response: {e}"))?;

        if !status.is_success() {
            return Err(format!("Proxmox API returned HTTP {status}: {json_body}"));
        }

        Ok(json_body.get("data").cloned().unwrap_or(json_body))
    }
}

/// Proxmox Model Context Protocol (MCP) Server exposing hypervisor operations as tools.
pub struct ProxmoxMcpServer {
    transport: Arc<dyn PveApiTransport>,
}

impl ProxmoxMcpServer {
    pub fn new(transport: Arc<dyn PveApiTransport>) -> Self {
        Self { transport }
    }

    /// Handles an incoming JSON-RPC 2.0 MCP request and produces an MCP response.
    pub async fn handle_request(&self, request: &JsonRpcRequest) -> JsonRpcResponse {
        let id = request.id.clone();
        match request.method.as_str() {
            "initialize" => {
                let init_result = serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "frostfire-proxmox-mcp",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                });
                JsonRpcResponse::success(id, init_result)
            }

            "notifications/initialized" => {
                JsonRpcResponse::success(id, serde_json::json!({}))
            }

            "tools/list" => {
                let tools = self.list_tools();
                JsonRpcResponse::success(id, serde_json::json!({ "tools": tools }))
            }

            "tools/call" => {
                let params = match request.params.as_ref() {
                    Some(p) => p,
                    None => {
                        return JsonRpcResponse::error(
                            id,
                            JsonRpcError::new(INVALID_PARAMS, "Missing params for tools/call"),
                        );
                    }
                };

                let tool_name = match params.get("name").and_then(|v| v.as_str()) {
                    Some(n) => n,
                    None => {
                        return JsonRpcResponse::error(
                            id,
                            JsonRpcError::new(INVALID_PARAMS, "Missing 'name' in tool call params"),
                        );
                    }
                };

                let empty_args = serde_json::json!({});
                let arguments = params.get("arguments").unwrap_or(&empty_args);

                match self.execute_tool(tool_name, arguments).await {
                    Ok(text_output) => {
                        let content = serde_json::json!({
                            "content": [
                                {
                                    "type": "text",
                                    "text": text_output
                                }
                            ]
                        });
                        JsonRpcResponse::success(id, content)
                    }
                    Err(err_msg) => {
                        let err_content = serde_json::json!({
                            "isError": true,
                            "content": [
                                {
                                    "type": "text",
                                    "text": format!("Error: {err_msg}")
                                }
                            ]
                        });
                        JsonRpcResponse::success(id, err_content)
                    }
                }
            }

            unknown => JsonRpcResponse::error(
                id,
                JsonRpcError::new(METHOD_NOT_FOUND, format!("Method not found: {unknown}")),
            ),
        }
    }

    /// Declares the tool catalog exposed by this MCP server.
    pub fn list_tools(&self) -> Vec<serde_json::Value> {
        vec![
            serde_json::json!({
                "name": "proxmox_list_nodes",
                "description": "Lists all Proxmox cluster nodes with status, CPU, memory, and uptime metrics.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            }),
            serde_json::json!({
                "name": "proxmox_list_vms",
                "description": "Lists all QEMU virtual machines on a specific node or cluster-wide.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "node": {
                            "type": "string",
                            "description": "Node name (e.g. 'pve'). Required if querying node-specific resources."
                        }
                    },
                    "required": ["node"]
                }
            }),
            serde_json::json!({
                "name": "proxmox_list_lxcs",
                "description": "Lists all LXC containers on a specific Proxmox node.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "node": {
                            "type": "string",
                            "description": "Node name (e.g. 'pve')."
                        }
                    },
                    "required": ["node"]
                }
            }),
            serde_json::json!({
                "name": "proxmox_get_vm_status",
                "description": "Retrieves the real-time operational status, CPU, RAM, and disk utilization of a VM or container.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "node": { "type": "string", "description": "Proxmox node name" },
                        "vmid": { "type": "integer", "description": "Virtual Machine or Container ID" },
                        "is_lxc": { "type": "boolean", "description": "Set to true if target is an LXC container, false for QEMU VM." }
                    },
                    "required": ["node", "vmid"]
                }
            }),
            serde_json::json!({
                "name": "proxmox_vm_power",
                "description": "Executes power state operations (start, stop, shutdown, reboot) on a VM or LXC container.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "node": { "type": "string", "description": "Proxmox node name" },
                        "vmid": { "type": "integer", "description": "Target VMID" },
                        "action": {
                            "type": "string",
                            "enum": ["start", "stop", "shutdown", "reboot"],
                            "description": "Power action to execute"
                        },
                        "is_lxc": { "type": "boolean", "description": "Set to true if target is an LXC container, false for QEMU VM." }
                    },
                    "required": ["node", "vmid", "action"]
                }
            }),
            serde_json::json!({
                "name": "proxmox_create_snapshot",
                "description": "Creates a snapshot of a VM or LXC container before making modifications.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "node": { "type": "string", "description": "Proxmox node name" },
                        "vmid": { "type": "integer", "description": "Target VMID" },
                        "snapname": { "type": "string", "description": "Identifier for the snapshot (e.g. 'pre-patch-backup')" },
                        "description": { "type": "string", "description": "Optional human-readable description" },
                        "is_lxc": { "type": "boolean", "description": "Set to true if target is an LXC container, false for QEMU VM." }
                    },
                    "required": ["node", "vmid", "snapname"]
                }
            }),
            serde_json::json!({
                "name": "proxmox_list_storage",
                "description": "Lists all storage pools and available disk capacity on a Proxmox node.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "node": { "type": "string", "description": "Proxmox node name" }
                    },
                    "required": ["node"]
                }
            }),
            serde_json::json!({
                "name": "proxmox_get_task_status",
                "description": "Checks the status of an asynchronous Proxmox background task by UPID.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "node": { "type": "string", "description": "Proxmox node name" },
                        "upid": { "type": "string", "description": "Task UPID string returned by a mutating action" }
                    },
                    "required": ["node", "upid"]
                }
            })
        ]
    }

    /// Dispatches a tool execution to the appropriate Proxmox VE API endpoint.
    pub async fn execute_tool(
        &self,
        tool_name: &str,
        arguments: &serde_json::Value,
    ) -> Result<String, String> {
        match tool_name {
            "proxmox_list_nodes" => {
                let res = self.transport.get("/nodes").await?;
                Ok(serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()))
            }

            "proxmox_list_vms" => {
                let node = arguments
                    .get("node")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing required parameter 'node'".to_string())?;
                let res = self.transport.get(&format!("/nodes/{node}/qemu")).await?;
                Ok(serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()))
            }

            "proxmox_list_lxcs" => {
                let node = arguments
                    .get("node")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing required parameter 'node'".to_string())?;
                let res = self.transport.get(&format!("/nodes/{node}/lxc")).await?;
                Ok(serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()))
            }

            "proxmox_get_vm_status" => {
                let node = arguments.get("node").and_then(|v| v.as_str()).ok_or("Missing 'node'")?;
                let vmid = arguments.get("vmid").and_then(|v| v.as_u64()).ok_or("Missing 'vmid'")?;
                let is_lxc = arguments.get("is_lxc").and_then(|v| v.as_bool()).unwrap_or(false);

                let kind = if is_lxc { "lxc" } else { "qemu" };
                let res = self
                    .transport
                    .get(&format!("/nodes/{node}/{kind}/{vmid}/status/current"))
                    .await?;
                Ok(serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()))
            }

            "proxmox_vm_power" => {
                let node = arguments.get("node").and_then(|v| v.as_str()).ok_or("Missing 'node'")?;
                let vmid = arguments.get("vmid").and_then(|v| v.as_u64()).ok_or("Missing 'vmid'")?;
                let action = arguments.get("action").and_then(|v| v.as_str()).ok_or("Missing 'action'")?;
                let is_lxc = arguments.get("is_lxc").and_then(|v| v.as_bool()).unwrap_or(false);

                let valid_actions = ["start", "stop", "shutdown", "reboot"];
                if !valid_actions.contains(&action) {
                    return Err(format!("Invalid power action '{action}'. Supported: {valid_actions:?}"));
                }

                let kind = if is_lxc { "lxc" } else { "qemu" };
                let res = self
                    .transport
                    .post(&format!("/nodes/{node}/{kind}/{vmid}/status/{action}"), None)
                    .await?;

                Ok(format!(
                    "Power action '{action}' initiated on {kind} {vmid}. UPID: {}",
                    res.as_str().unwrap_or(&res.to_string())
                ))
            }

            "proxmox_create_snapshot" => {
                let node = arguments.get("node").and_then(|v| v.as_str()).ok_or("Missing 'node'")?;
                let vmid = arguments.get("vmid").and_then(|v| v.as_u64()).ok_or("Missing 'vmid'")?;
                let snapname = arguments.get("snapname").and_then(|v| v.as_str()).ok_or("Missing 'snapname'")?;
                let description = arguments.get("description").and_then(|v| v.as_str()).unwrap_or("");
                let is_lxc = arguments.get("is_lxc").and_then(|v| v.as_bool()).unwrap_or(false);

                let kind = if is_lxc { "lxc" } else { "qemu" };
                let payload = serde_json::json!({
                    "snapname": snapname,
                    "description": description
                });

                let res = self
                    .transport
                    .post(&format!("/nodes/{node}/{kind}/{vmid}/snapshot"), Some(&payload))
                    .await?;

                Ok(format!(
                    "Snapshot '{snapname}' creation initiated for {kind} {vmid}. UPID: {}",
                    res.as_str().unwrap_or(&res.to_string())
                ))
            }

            "proxmox_list_storage" => {
                let node = arguments.get("node").and_then(|v| v.as_str()).ok_or("Missing 'node'")?;
                let res = self.transport.get(&format!("/nodes/{node}/storage")).await?;
                Ok(serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()))
            }

            "proxmox_get_task_status" => {
                let node = arguments.get("node").and_then(|v| v.as_str()).ok_or("Missing 'node'")?;
                let upid = arguments.get("upid").and_then(|v| v.as_str()).ok_or("Missing 'upid'")?;
                let res = self
                    .transport
                    .get(&format!("/nodes/{node}/tasks/{upid}/status"))
                    .await?;
                Ok(serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()))
            }

            other => Err(format!("Unknown tool '{other}'")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MockPveTransport {
        get_responses: Mutex<std::collections::HashMap<String, serde_json::Value>>,
        post_responses: Mutex<std::collections::HashMap<String, serde_json::Value>>,
    }

    impl MockPveTransport {
        fn new() -> Self {
            Self {
                get_responses: Mutex::new(std::collections::HashMap::new()),
                post_responses: Mutex::new(std::collections::HashMap::new()),
            }
        }

        fn register_get(&self, path: &str, response: serde_json::Value) {
            self.get_responses.lock().unwrap().insert(path.to_string(), response);
        }

        fn register_post(&self, path: &str, response: serde_json::Value) {
            self.post_responses.lock().unwrap().insert(path.to_string(), response);
        }
    }

    #[async_trait]
    impl PveApiTransport for MockPveTransport {
        async fn get(&self, path: &str) -> Result<serde_json::Value, String> {
            let guard = self.get_responses.lock().unwrap();
            guard
                .get(path)
                .cloned()
                .ok_or_else(|| format!("Mock GET 404: {path}"))
        }

        async fn post(&self, path: &str, _body: Option<&serde_json::Value>) -> Result<serde_json::Value, String> {
            let guard = self.post_responses.lock().unwrap();
            guard
                .get(path)
                .cloned()
                .ok_or_else(|| format!("Mock POST 404: {path}"))
        }
    }

    #[tokio::test]
    async fn test_mcp_initialize_and_tools_list() {
        let transport = Arc::new(MockPveTransport::new());
        let server = ProxmoxMcpServer::new(transport);

        // 1. Test initialize
        let init_req = JsonRpcRequest::new(Some(serde_json::json!(1)), "initialize", None);
        let init_res = server.handle_request(&init_req).await;
        assert!(init_res.is_success());
        let res_val = init_res.result.unwrap();
        assert_eq!(res_val["serverInfo"]["name"], "frostfire-proxmox-mcp");

        // 2. Test tools/list
        let list_req = JsonRpcRequest::new(Some(serde_json::json!(2)), "tools/list", None);
        let list_res = server.handle_request(&list_req).await;
        assert!(list_res.is_success());
        let tools = list_res.result.unwrap()["tools"].as_array().unwrap().clone();
        assert_eq!(tools.len(), 8);

        let tool_names: Vec<&str> = tools
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(tool_names.contains(&"proxmox_list_nodes"));
        assert!(tool_names.contains(&"proxmox_list_vms"));
        assert!(tool_names.contains(&"proxmox_list_lxcs"));
        assert!(tool_names.contains(&"proxmox_vm_power"));
        assert!(tool_names.contains(&"proxmox_create_snapshot"));
    }

    #[tokio::test]
    async fn test_mcp_execute_proxmox_tools() {
        let transport = Arc::new(MockPveTransport::new());

        // Mock GET /nodes
        transport.register_get(
            "/nodes",
            serde_json::json!([
                {
                    "node": "pve-node-1",
                    "status": "online",
                    "cpu": 0.12,
                    "maxcpu": 8,
                    "mem": 8589934592u64,
                    "maxmem": 34359738368u64,
                    "uptime": 123456
                }
            ]),
        );

        // Mock POST /nodes/pve-node-1/qemu/100/status/start
        transport.register_post(
            "/nodes/pve-node-1/qemu/100/status/start",
            serde_json::json!("UPID:pve-node-1:00001234:00005678:start:100:root@pam:"),
        );

        let server = ProxmoxMcpServer::new(transport);

        // 1. Call proxmox_list_nodes
        let list_nodes_req = JsonRpcRequest::tool_call(
            Some(serde_json::json!(10)),
            "proxmox_list_nodes",
            serde_json::json!({}),
        );
        let resp = server.handle_request(&list_nodes_req).await;
        assert!(resp.is_success());
        let text = resp.result.unwrap()["content"][0]["text"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(text.contains("pve-node-1"));
        assert!(text.contains("online"));

        // 2. Call proxmox_vm_power start
        let start_vm_req = JsonRpcRequest::tool_call(
            Some(serde_json::json!(11)),
            "proxmox_vm_power",
            serde_json::json!({
                "node": "pve-node-1",
                "vmid": 100,
                "action": "start"
            }),
        );
        let start_resp = server.handle_request(&start_vm_req).await;
        assert!(start_resp.is_success());
        let start_text = start_resp.result.unwrap()["content"][0]["text"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(start_text.contains("Power action 'start' initiated on qemu 100"));
        assert!(start_text.contains("UPID:pve-node-1"));
    }
}
