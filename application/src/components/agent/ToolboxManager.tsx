import { useAgentStore } from "../../store/agentStore";
import { Wrench, Shield, Check, X, Server } from "lucide-react";

export function ToolboxManager() {
  const { tools, toggleTool, toggleToolApproval } = useAgentStore();

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <Wrench className="w-4 h-4 text-[#58a6ff]" />
          <span>Rig Dynamic Tools & MCP Servers</span>
        </h2>
        <p className="text-[#8b949e]">
          Manage native tools and external Model Context Protocol (MCP) integrations attached to the runtime.
        </p>
      </div>

      <div className="space-y-2">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className="p-3 bg-[#161b22] border border-[#30363d] rounded-xl flex items-center justify-between"
          >
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-[#58a6ff]">
                {tool.source === "mcp" ? <Server className="w-4 h-4" /> : <Wrench className="w-4 h-4" />}
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white text-xs font-mono">{tool.name}</span>
                  <span
                    className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-semibold ${
                      tool.source === "mcp"
                        ? "bg-purple-950/40 text-purple-300 border border-purple-800/40"
                        : "bg-blue-950/40 text-blue-300 border border-blue-800/40"
                    }`}
                  >
                    {tool.source}
                  </span>
                </div>
                <p className="text-[11px] text-[#8b949e] mt-0.5">{tool.description}</p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {/* Requires Approval Toggle */}
              <button
                onClick={() => toggleToolApproval(tool.name)}
                className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] border transition ${
                  tool.requiresApproval
                    ? "bg-amber-950/30 border-amber-700/50 text-amber-300"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-white"
                }`}
                title="Require confirmation before executing"
              >
                <Shield className="w-3 h-3" />
                <span>{tool.requiresApproval ? "Ask Approval" : "Auto-Run"}</span>
              </button>

              {/* Tool Enable/Disable Toggle */}
              <button
                onClick={() => toggleTool(tool.name)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  tool.enabled
                    ? "bg-green-600 hover:bg-green-500 text-white"
                    : "bg-[#21262d] hover:bg-[#30363d] text-[#8b949e]"
                }`}
              >
                {tool.enabled ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                <span>{tool.enabled ? "Active" : "Disabled"}</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
