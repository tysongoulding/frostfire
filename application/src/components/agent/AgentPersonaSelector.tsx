import { useAgentStore } from "../../store/agentStore";
import { Bot, Check, Shield, Search, Terminal, Sparkles } from "lucide-react";

export function AgentPersonaSelector() {
  const { personas, activePersonaId, setActivePersona } = useAgentStore();

  const getIcon = (id: string) => {
    switch (id) {
      case "coder":
        return <Terminal className="w-4 h-4 text-[#58a6ff]" />;
      case "architect":
        return <Bot className="w-4 h-4 text-purple-400" />;
      case "researcher":
        return <Search className="w-4 h-4 text-emerald-400" />;
      case "reviewer":
        return <Shield className="w-4 h-4 text-amber-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-blue-400" />;
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
      {personas.map((persona) => {
        const isSelected = persona.id === activePersonaId;
        return (
          <button
            key={persona.id}
            onClick={() => setActivePersona(persona.id)}
            className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
              isSelected
                ? "bg-[#161b22] border-blue-500 shadow-md shadow-blue-500/10"
                : "bg-[#0d1117] border-[#30363d] hover:bg-[#161b22]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  {getIcon(persona.id)}
                  <span className="font-semibold text-white text-xs md:text-sm">
                    {persona.name}
                  </span>
                </div>
                {isSelected && (
                  <span className="flex items-center text-blue-400 text-xs">
                    <Check className="w-3.5 h-3.5 mr-0.5" />
                    Active
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[#8b949e] font-medium mb-1">
                {persona.role}
              </div>
              <p className="text-xs text-[#8b949e] line-clamp-2">
                {persona.description}
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-[#30363d] flex items-center justify-between text-[10px] text-[#8b949e]">
              <div className="flex items-center space-x-1">
                <span>Tools:</span>
                <span className="font-mono text-white">
                  {persona.defaultTools.join(", ")}
                </span>
              </div>
              <div>
                <span>Thinking: </span>
                <span className="capitalize text-[#58a6ff]">
                  {persona.thinkingLevel}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
