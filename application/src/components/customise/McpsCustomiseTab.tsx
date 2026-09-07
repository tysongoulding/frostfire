import { useState, useEffect } from "react";
import { PlugZap, CheckCircle2, ChevronDown, ChevronRight, Server, Wrench, FileCode } from "lucide-react";

interface McpItem {
  id: string;
  name: string;
  status: string;
  toolCount: number;
  tokens: number;
  description: string;
  tools: string[];
}

const DEFAULT_MCP_SERVERS: McpItem[] = [
  {
    id: "context-mode",
    name: "Context Mode MCP",
    status: "Connected (Lazy)",
    toolCount: 11,
    tokens: 480,
    description: "Context optimization, indexing, AST searching, and token-efficient batch execution.",
    tools: [
      "ctx_execute",
      "ctx_execute_file",
      "ctx_index",
      "ctx_search",
      "ctx_fetch_and_index",
      "ctx_batch_execute",
      "ctx_stats",
      "ctx_doctor",
      "ctx_upgrade",
      "ctx_purge",
      "ctx_insight",
    ],
  },
  {
    id: "github",
    name: "GitHub MCP",
    status: "Connected (Lazy)",
    toolCount: 25,
    tokens: 680,
    description: "GitHub repository management, pull requests, issues, commits, branches, and code reviews.",
    tools: [
      "create_or_update_file",
      "search_repositories",
      "create_repository",
      "get_file_contents",
      "push_files",
      "create_issue",
      "create_pull_request",
      "fork_repository",
      "create_branch",
      "list_commits",
      "list_issues",
      "update_issue",
      "add_issue_comment",
      "search_code",
      "search_issues",
      "search_users",
      "get_issue",
      "get_pull_request",
      "list_pull_requests",
      "create_pull_request_review",
      "merge_pull_request",
      "get_pull_request_files",
      "get_pull_request_status",
      "update_pull_request_branch",
      "get_pull_request_comments",
    ],
  },
  {
    id: "google-workspace",
    name: "Google Workspace MCP",
    status: "Connected (Lazy)",
    toolCount: 65,
    tokens: 290,
    description: "Google Docs, Sheets, Drive, Gmail, and Calendar automated document and data operations.",
    tools: [
      "readDocument",
      "listTabs",
      "appendText",
      "insertText",
      "insertTable",
      "listDriveFiles",
      "createSpreadsheet",
      "readSpreadsheet",
      "writeSpreadsheet",
      "listMessages",
      "sendEmail",
      "createDraft",
      "listEvents",
      "createEvent",
    ],
  },
  {
    id: "microsoft-365",
    name: "Microsoft 365 & Outlook MCP",
    status: "Ready to Connect",
    toolCount: 18,
    tokens: 340,
    description: "Microsoft Outlook Email, Calendar events, OneDrive files, and Teams messaging integration.",
    tools: [
      "outlook_list_messages",
      "outlook_send_mail",
      "outlook_get_calendar_events",
      "outlook_create_event",
      "teams_list_channels",
      "teams_post_message",
    ],
  },
  {
    id: "slack",
    name: "Slack MCP",
    status: "Ready to Connect",
    toolCount: 12,
    tokens: 280,
    description: "Slack channels, team direct messages, thread replies, and notification alerts.",
    tools: [
      "slack_list_channels",
      "slack_post_message",
      "slack_reply_to_thread",
      "slack_get_channel_history",
      "slack_search_messages",
    ],
  },
];

export function McpsCustomiseTab() {
  const [expandedServer, setExpandedServer] = useState<string>("context-mode");
  const [mcpServers, setMcpServers] = useState<McpItem[]>(DEFAULT_MCP_SERVERS);

  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<{ mcp_servers: Array<{ name: string; command: string; args: string[]; enabled: boolean }> }>("get_configured_plugins_and_mcps")
          .then((res) => {
            if (res && res.mcp_servers && res.mcp_servers.length > 0) {
              setMcpServers(
                res.mcp_servers.map((s) => ({
                  id: s.name,
                  name: `${s.name.charAt(0).toUpperCase() + s.name.slice(1)} MCP`,
                  status: s.enabled ? "Active" : "Disabled",
                  toolCount: s.args.length > 0 ? s.args.length : 1,
                  tokens: 320,
                  description: `Command: ${s.command} ${s.args.join(" ")}`,
                  tools: s.args,
                }))
              );
              setExpandedServer(res.mcp_servers[0].name);
            }
          })
          .catch((err) => console.warn("Failed to load MCPs from backend:", err));
      });
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5 max-w-5xl mx-auto text-xs text-[#c9d1d9]">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <PlugZap className="w-4 h-4 text-emerald-400" />
          <span>Model Context Protocol (MCP) Servers & Schemas</span>
        </h2>
        <p className="text-[#8b949e]">
          Inspect configured MCP sidecars, lazy-loaded tool schemas, and JSON argument contracts.
        </p>
      </div>

      <div className="space-y-3">
        {mcpServers.map((server) => {
          const isExpanded = expandedServer === server.id;
          return (
            <div
              key={server.id}
              className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden transition"
            >
              {/* Server Header Row */}
              <div
                onClick={() => setExpandedServer(isExpanded ? "" : server.id)}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-[#21262d]/50 transition"
              >
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-white text-xs">{server.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-950/40 border border-emerald-800 text-emerald-400 font-medium flex items-center space-x-1">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        <span>{server.status}</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-[#8b949e] mt-0.5">{server.description}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 flex-shrink-0">
                  <span className="font-mono text-[10px] text-[#8b949e] bg-[#0d1117] px-2 py-1 rounded border border-[#30363d]">
                    {server.toolCount} tools • ~{server.tokens} tok
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-[#8b949e]" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[#8b949e]" />
                  )}
                </div>
              </div>

              {/* Expanded Tool List */}
              {isExpanded && (
                <div className="p-4 pt-0 border-t border-[#30363d] bg-[#0d1117]/60 space-y-3">
                  <div className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider pt-3">
                    Exposed Tool Schemas
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {server.tools.map((tool) => (
                      <div
                        key={tool}
                        className="p-2 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center space-x-1.5 truncate"
                      >
                        <Wrench className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        <span className="font-mono text-[11px] text-white truncate">{tool}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#8b949e] pt-1">
                    <span className="flex items-center space-x-1">
                      <FileCode className="w-3 h-3" />
                      <span>Schema definitions located in ~/.gemini/antigravity/mcp/{server.id}/</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
