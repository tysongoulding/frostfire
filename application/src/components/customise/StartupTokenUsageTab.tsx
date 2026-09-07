import { Coins, PlugZap, ToyBrick, Shield, Zap, Cpu, Check, Info } from "lucide-react";

export function StartupTokenUsageTab() {
  const startupItems = [
    {
      category: "System Preamble",
      icon: Cpu,
      color: "text-blue-400",
      tokens: 380,
      description: "Base harness identity, FSM streaming protocol, and tool calling runtime directives.",
      files: ["crates/rho-engine/src/prompts/system.md"],
      enabled: true,
      canToggle: false,
    },
    {
      category: "Layered Rules (@RULES)",
      icon: Shield,
      color: "text-purple-400",
      tokens: 1240,
      description: "Grounding protocol, TDD invariants, code structure (~150 lines), and Clippy lint zero-tolerance.",
      files: ["~/.gemini/GEMINI.md (@GLOBAL-RULES)", "AGENTS.md (@PROJECT-RULES)"],
      enabled: true,
      canToggle: true,
    },
    {
      category: "Skills Index & Triggers",
      icon: Zap,
      color: "text-pink-400",
      tokens: 820,
      description: "Discovered workspace skills, trigger keywords, and execution contracts.",
      files: [".claude/skills/", "~/.gemini/antigravity/builtin/skills/"],
      enabled: true,
      canToggle: true,
    },
    {
      category: "MCP Tool Schemas (Eager & Lazy)",
      icon: PlugZap,
      color: "text-emerald-400",
      tokens: 1450,
      description: "JSON Schema definitions for lazy-loaded tools (GitHub, Context-Mode, Google-Workspace).",
      files: ["~/.gemini/config/mcp_config.json"],
      enabled: true,
      canToggle: true,
    },
    {
      category: "Daemon Plugin Descriptors",
      icon: ToyBrick,
      color: "text-yellow-400",
      tokens: 280,
      description: "Hook manifests for background notification daemons and execution guards.",
      files: ["crates/rho-plugin-sdk/manifest.json"],
      enabled: true,
      canToggle: true,
    },
  ];

  const totalStartupTokens = startupItems.reduce((acc, item) => acc + (item.enabled ? item.tokens : 0), 0);
  const contextWindow = 200000;
  const startupPercent = ((totalStartupTokens / contextWindow) * 100).toFixed(2);

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <Coins className="w-4 h-4 text-yellow-400" />
          <span>LLM Startup Token Overhead & Baseline Context</span>
        </h2>
        <p className="text-[#8b949e]">
          Inspect the exact token cost injected into the model context before your first prompt turn.
        </p>
      </div>

      {/* Summary Banner */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="text-2xl font-bold text-white font-mono flex items-baseline space-x-2">
              <span>{totalStartupTokens.toLocaleString()}</span>
              <span className="text-xs text-[#8b949e] font-sans">tokens on startup</span>
            </div>
            <div className="text-[11px] text-[#8b949e] mt-0.5">
              Utilizes <span className="text-blue-400 font-semibold">{startupPercent}%</span> of total 200k context window
            </div>
          </div>

          <div className="flex items-center space-x-2 bg-[#0d1117] px-3 py-1.5 rounded-xl border border-[#30363d]">
            <Info className="w-3.5 h-3.5 text-[#58a6ff]" />
            <span className="text-[11px] text-white font-medium">Auto-compacts at 85% full</span>
          </div>
        </div>

        {/* Segmented Progress Bar */}
        <div className="space-y-1.5">
          <div className="h-3 w-full bg-[#0d1117] rounded-full overflow-hidden flex border border-[#30363d]">
            <div style={{ width: "9%" }} className="bg-blue-500" title="System Preamble (380 tok)" />
            <div style={{ width: "30%" }} className="bg-purple-500" title="Rules (1,240 tok)" />
            <div style={{ width: "20%" }} className="bg-pink-500" title="Skills Index (820 tok)" />
            <div style={{ width: "35%" }} className="bg-emerald-500" title="MCP Schemas (1,450 tok)" />
            <div style={{ width: "6%" }} className="bg-yellow-500" title="Plugins (280 tok)" />
          </div>

          <div className="flex flex-wrap gap-4 pt-1 text-[10px] text-[#8b949e]">
            <div className="flex items-center space-x-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span>Preamble (380)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-2 h-2 rounded-full bg-purple-500" />
              <span>Rules (1,240)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-2 h-2 rounded-full bg-pink-500" />
              <span>Skills (820)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>MCPs (1,450)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
              <span>Plugins (280)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Item Breakdown List */}
      <div className="space-y-3">
        <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
          Startup Layer Breakdown
        </label>

        {startupItems.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="p-4 bg-[#161b22] border border-[#30363d] rounded-xl flex items-start justify-between space-x-4"
            >
              <div className="flex items-start space-x-3 truncate">
                <div className="p-2 rounded-lg bg-[#0d1117] border border-[#30363d] flex-shrink-0 mt-0.5">
                  <Icon className={`w-4 h-4 ${item.color}`} />
                </div>
                <div className="space-y-1 truncate">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-white text-xs">{item.category}</span>
                    <span className="font-mono text-[10px] bg-[#0d1117] px-2 py-0.5 rounded border border-[#30363d] text-white">
                      ~{item.tokens} tokens
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8b949e]">{item.description}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.files.map((f, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono text-blue-300/80 bg-[#0d1117] px-2 py-0.5 rounded border border-blue-900/40"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0">
                <div className="px-2.5 py-1 rounded-lg bg-green-950/40 border border-green-800 text-green-400 font-medium text-[10px] flex items-center space-x-1">
                  <Check className="w-3 h-3" />
                  <span>Active</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
