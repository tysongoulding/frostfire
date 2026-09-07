import { useState, useRef, useEffect } from "react";
import { useSubagentStore } from "../../store/subagentStore";
import { useToastStore } from "../../store/toastStore";
import {
  Bot,
  ChevronUp,
  Check,
  Zap,
  Shield,
  BookOpen,
  Crosshair,
  Wrench,
  Sparkles,
} from "lucide-react";

export function AgentDropupPicker() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { subagents, activeChatAgentId, setActiveChatAgentId } = useSubagentStore();
  const { addToast } = useToastStore();

  const activeAgent = subagents.find((a) => a.id === activeChatAgentId);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleSelectAgent = (agentId: string | null, name: string) => {
    setActiveChatAgentId(agentId);
    addToast(`Active Agent: ${name}`, "info");
    setIsOpen(false);
  };

  const getAgentIcon = (id?: string) => {
    if (!id) return <Sparkles className="w-3.5 h-3.5 text-[#58a6ff]" />;
    if (id.includes("implementer")) return <Zap className="w-3.5 h-3.5 text-amber-400" />;
    if (id.includes("qa")) return <Shield className="w-3.5 h-3.5 text-emerald-400" />;
    if (id.includes("librarian")) return <BookOpen className="w-3.5 h-3.5 text-blue-400" />;
    if (id.includes("red-team")) return <Crosshair className="w-3.5 h-3.5 text-red-400" />;
    if (id.includes("cavecrew")) return <Wrench className="w-3.5 h-3.5 text-orange-400" />;
    return <Bot className="w-3.5 h-3.5 text-purple-400" />;
  };

  return (
    <div className="relative inline-flex items-center" ref={menuRef}>
      {/* Cursor-Style Agent Pill Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1.5 py-1 px-1.5 rounded-md text-xs text-[#8b949e] hover:text-white hover:bg-[#21262d] transition cursor-pointer select-none group border border-transparent hover:border-[#30363d]"
        title={activeAgent ? `Agent: ${activeAgent.name} (${activeAgent.role})` : "General Chat / Orchestrator Mode"}
      >
        {getAgentIcon(activeAgent?.id)}
        <span className="font-medium text-xs text-[#c9d1d9] group-hover:text-white transition font-mono truncate max-w-[110px]">
          {activeAgent ? activeAgent.name : "Orchestrator"}
        </span>
        <ChevronUp className={`w-3.5 h-3.5 text-[#8b949e] group-hover:text-white transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dynamic Agent Dropup */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-80 max-h-[420px] flex flex-col bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150 select-none">
          {/* Header */}
          <div className="px-3 py-2 bg-[#0d1117]/90 border-b border-[#30363d] flex items-center justify-between flex-shrink-0 text-[11px]">
            <span className="text-[#8b949e] font-medium flex items-center space-x-1.5">
              <Bot className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-white font-semibold">Select Active Agent</span>
            </span>
            <span className="text-[10px] text-[#8b949e] bg-[#21262d] px-2 py-0.5 rounded border border-[#30363d]">
              {subagents.length + 1} Available
            </span>
          </div>

          {/* Agent Options List */}
          <div className="p-1.5 space-y-1 overflow-y-auto flex-1">
            {/* General Chat / Orchestrator Option */}
            <button
              type="button"
              onClick={() => handleSelectAgent(null, "General Orchestrator")}
              className={`w-full flex items-start justify-between p-2 rounded-xl text-left transition ${
                activeChatAgentId === null
                  ? "bg-blue-600/20 text-[#58a6ff] border border-blue-500/40"
                  : "text-[#c9d1d9] hover:bg-[#21262d] hover:text-white border border-transparent"
              }`}
            >
              <div className="flex items-start space-x-2.5 min-w-0">
                <div className="p-1 rounded bg-[#0d1117] border border-[#30363d] shrink-0 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#58a6ff]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-xs text-white">General Orchestrator</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/10 text-[#58a6ff] border border-blue-500/20 font-mono">
                      Auto-Route
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8b949e] line-clamp-1 mt-0.5">
                    Autonomous multi-agent routing across the entire codebase
                  </p>
                </div>
              </div>
              {activeChatAgentId === null && <Check className="w-4 h-4 text-blue-400 shrink-0 ml-2 mt-1" />}
            </button>

            {/* Subagents List */}
            {subagents.map((agent) => {
              const isSelected = activeChatAgentId === agent.id;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => handleSelectAgent(agent.id, agent.name)}
                  className={`w-full flex items-start justify-between p-2 rounded-xl text-left transition ${
                    isSelected
                      ? "bg-purple-600/20 text-purple-300 border border-purple-500/40"
                      : "text-[#c9d1d9] hover:bg-[#21262d] hover:text-white border border-transparent"
                  }`}
                >
                  <div className="flex items-start space-x-2.5 min-w-0">
                    <div className="p-1 rounded bg-[#0d1117] border border-[#30363d] shrink-0 mt-0.5">
                      {getAgentIcon(agent.id)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-semibold text-xs text-white font-mono">{agent.name}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#0d1117] text-[#8b949e] border border-[#30363d] uppercase font-mono">
                          {agent.model}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8b949e] line-clamp-1 mt-0.5">{agent.role}</p>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-purple-400 shrink-0 ml-2 mt-1" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
