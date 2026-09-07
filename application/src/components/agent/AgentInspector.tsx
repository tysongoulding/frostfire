import { useAgentStore } from "../../store/agentStore";
import { useSessionStore } from "../../store/sessionStore";
import { AgentPersonaSelector } from "./AgentPersonaSelector";
import { Bot, Sliders, Cpu, ShieldCheck } from "lucide-react";

export function AgentInspector() {
  const { personas, activePersonaId } = useAgentStore();
  const { sessionInfo, usage } = useSessionStore();

  const activePersona =
    personas.find((p) => p.id === activePersonaId) || personas[0];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <Bot className="w-4 h-4 text-[#58a6ff]" />
          <span>Rig Agent Personas</span>
        </h2>
        <p className="text-[#8b949e]">
          Select an agent profile tailored with custom preambles, tool permissions, and reasoning budgets.
        </p>
      </div>

      <AgentPersonaSelector />

      {/* Active Agent Configuration Details */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-[#30363d] pb-3">
          <div className="flex items-center space-x-2 font-semibold text-white">
            <Sliders className="w-4 h-4 text-purple-400" />
            <span>Active Configuration: {activePersona.name}</span>
          </div>
          <span className="font-mono text-[11px] bg-[#21262d] px-2 py-0.5 rounded border border-[#30363d]">
            {sessionInfo.provider || "anthropic"} / {sessionInfo.model || "claude-3-7-sonnet"}
          </span>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1">
            System Preamble / Instructions
          </label>
          <pre className="bg-[#0d1117] p-3 rounded-lg border border-[#30363d] text-[#c9d1d9] font-mono text-[11px] whitespace-pre-wrap">
            {activePersona.systemPrompt}
          </pre>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#30363d]">
            <div className="text-[#8b949e] text-[10px] uppercase">Temperature</div>
            <div className="font-semibold text-white text-sm mt-0.5">
              {activePersona.temperature}
            </div>
          </div>
          <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#30363d]">
            <div className="text-[#8b949e] text-[10px] uppercase">Thinking Budget</div>
            <div className="font-semibold text-[#58a6ff] text-sm mt-0.5 capitalize">
              {activePersona.thinkingLevel}
            </div>
          </div>
          <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#30363d]">
            <div className="text-[#8b949e] text-[10px] uppercase">Context Usage</div>
            <div className="font-semibold text-white text-sm mt-0.5 flex items-center space-x-1">
              <Cpu className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>{usage.contextPercent?.toFixed(1) || "0.0"}%</span>
            </div>
          </div>
          <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#30363d]">
            <div className="text-[#8b949e] text-[10px] uppercase">Attached Tools</div>
            <div className="font-semibold text-white text-sm mt-0.5 flex items-center space-x-1">
              <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
              <span>{activePersona.defaultTools.length} tools</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
