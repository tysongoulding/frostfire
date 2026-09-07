import { useState, useMemo } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { useProviderStore } from "../../store/providerStore";
import { useSubagentStore } from "../../store/subagentStore";
import { useToastStore } from "../../store/toastStore";
import { getModelContextLimit } from "../../lib/modelLimits";
import {
  X,
  Cpu,
  Layers,
  Sparkles,
  Zap,
  Trash2,
  HardDrive,
  ShieldCheck,
  TrendingDown,
  Info,
  Archive,
  CheckCircle2,
} from "lucide-react";

interface ContextWindowModalProps {
  onClose: () => void;
}

export function ContextWindowModal({ onClose }: ContextWindowModalProps) {
  const { usage, sessionInfo, messages, compaction, triggerCompaction, resetSession } =
    useSessionStore();
  const { activeProviderId, activeModel, providers } = useProviderStore();
  const { subagents, activeChatAgentId } = useSubagentStore();
  const { addToast } = useToastStore();
  const [isCompacting, setIsCompacting] = useState(false);

  const activeAgent = subagents.find((a) => a.id === activeChatAgentId);

  // 1. Resolve Real Active Provider & Model
  const resolvedProviderId = sessionInfo.provider || activeProviderId || "gemini";
  const resolvedModel =
    sessionInfo.model ||
    (activeAgent && activeAgent.model !== "inherit" ? activeAgent.model : activeModel) ||
    "gemini-flash-latest";

  const modelLimit = useMemo(
    () => getModelContextLimit(resolvedModel, resolvedProviderId),
    [resolvedModel, resolvedProviderId]
  );

  // 2. Real Live Token Estimation from Active Session
  const { systemTokens, toolTokens, historyTokens, totalActiveTokens } = useMemo(() => {
    // A. System Prompt & Preamble
    const systemPromptText = activeAgent?.systemPrompt || "You are an expert autonomous software engineer.";
    const sysTokens = Math.max(650, Math.round(systemPromptText.length / 3.8));

    // B. MCP Tools Schemas
    const toolCount = activeAgent ? (activeAgent.enableMcpTools ? 25 : 4) : 15;
    const tTokens = toolCount * 38;

    // C. Turn History from actual messages
    const messageChars = messages.reduce((acc, m) => acc + m.content.length + (m.reasoning?.length || 0), 0);
    const calculatedHistoryTokens = Math.round(messageChars / 3.8);
    const histTokens = Math.max(calculatedHistoryTokens, (usage.inputTokens || 0) + (usage.outputTokens || 0));

    const total = sysTokens + tTokens + histTokens;
    return {
      systemTokens: sysTokens,
      toolTokens: tTokens,
      historyTokens: histTokens,
      totalActiveTokens: total,
    };
  }, [messages, usage, activeAgent]);

  const maxCapacity = modelLimit.maxTokens;
  const remainingHeadroom = Math.max(0, maxCapacity - totalActiveTokens);
  const activePercent = Math.min(100, (totalActiveTokens / maxCapacity) * 100);
  const compactedTokens = compaction.totalTokensSaved;
  const compactedPercent = Math.min(100, (compactedTokens / maxCapacity) * 100);

  // Format Helper for Large Numbers
  const formatTokens = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  const handleRunCompaction = () => {
    setIsCompacting(true);
    setTimeout(() => {
      const saved = triggerCompaction("Pruned redundant AST buffers & compressed turn dialogues");
      setIsCompacting(false);
      addToast(`Context compacted! Reclaimed ${saved.toLocaleString()} tokens.`, "success");
    }, 350);
  };

  const handleClearContext = () => {
    resetSession();
    addToast("Cleared conversation context window", "info");
    onClose();
  };

  const getColorClass = (val: number) => {
    if (val > 85) return "text-red-400 stroke-red-500 bg-red-500/10 border-red-500/30";
    if (val > 65) return "text-amber-400 stroke-amber-500 bg-amber-500/10 border-amber-500/30";
    return "text-emerald-400 stroke-emerald-500 bg-emerald-500/10 border-emerald-500/30";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl space-y-0 text-xs text-[#c9d1d9]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]/70 flex-shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className={`p-1.5 rounded-lg border ${getColorClass(activePercent)}`}>
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">Context Window Diagnostics</h2>
              <p className="text-[11px] text-[#8b949e]">
                Live memory utilization across full {formatTokens(maxCapacity)} capacity
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#30363d] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Section 1: Live Hardware / Model Context Overview */}
          <div className="flex items-center space-x-5 p-4 bg-[#0d1117] border border-[#30363d] rounded-xl">
            {/* Circular Gauge */}
            <div className="relative w-20 h-20 flex-shrink-0 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-[#21262d] stroke-current"
                  strokeWidth="3"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className={`${getColorClass(activePercent).split(" ")[1]} stroke-current transition-all duration-500`}
                  strokeDasharray={`${activePercent.toFixed(2)}, 100`}
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-sm font-bold text-white font-mono">
                  {activePercent < 0.1 && totalActiveTokens > 0 ? "<0.1%" : `${activePercent.toFixed(1)}%`}
                </span>
                <span className="text-[9px] text-[#8b949e] uppercase">Filled</span>
              </div>
            </div>

            {/* Provider, Model, Context Window & Headroom */}
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[#8b949e]">Provider:</span>
                <span className="font-medium text-white">{modelLimit.providerName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#8b949e]">Model:</span>
                <span className="font-semibold text-white font-mono">{resolvedModel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#8b949e]">Context Window:</span>
                <span className="font-mono text-white font-semibold">{maxCapacity.toLocaleString()} tokens</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#8b949e]">Headroom:</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {remainingHeadroom.toLocaleString()} tokens ({((remainingHeadroom / maxCapacity) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Relative Total Context Window Bar (100% Full Capacity) */}
          <div className="space-y-2.5 p-4 bg-[#0d1117] border border-[#30363d] rounded-xl">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-white">Total Context Window Allocation</span>
              <span className="text-[#8b949e] font-mono">
                {totalActiveTokens.toLocaleString()} / {maxCapacity.toLocaleString()} Total Tokens
              </span>
            </div>

            {/* Full 100% Capacity Scale Bar */}
            <div className="h-3 w-full bg-[#161b22] rounded-full overflow-hidden flex border border-[#30363d] relative">
              {/* System / Preamble Segment */}
              <div
                style={{ width: `${Math.max(0.5, (systemTokens / maxCapacity) * 100)}%` }}
                className="bg-blue-500 h-full transition-all duration-300"
                title={`System Prompt & Instructions: ${systemTokens.toLocaleString()} tokens`}
              />
              {/* MCP Tools Schemas Segment */}
              <div
                style={{ width: `${Math.max(0.5, (toolTokens / maxCapacity) * 100)}%` }}
                className="bg-purple-500 h-full transition-all duration-300"
                title={`MCP Tool Definitions: ${toolTokens.toLocaleString()} tokens`}
              />
              {/* Active Turn History Segment */}
              <div
                style={{ width: `${Math.max(0.5, (historyTokens / maxCapacity) * 100)}%` }}
                className="bg-emerald-500 h-full transition-all duration-300"
                title={`Active Conversation Turn History: ${historyTokens.toLocaleString()} tokens`}
              />
              {/* Compacted Reclaimed Memory Segment */}
              {compactedTokens > 0 && (
                <div
                  style={{ width: `${Math.min((compactedTokens / maxCapacity) * 100, 100 - activePercent)}%` }}
                  className="bg-amber-500/40 border-r border-amber-400/80 h-full transition-all duration-300"
                  title={`Compacted Memory Reclaimed: ${compactedTokens.toLocaleString()} tokens`}
                />
              )}
            </div>

            {/* Allocation Legend with Percentages vs Total Window */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[10px]">
              <div className="p-2 rounded-lg bg-[#161b22] border border-[#30363d] space-y-0.5">
                <div className="flex items-center space-x-1 text-[#8b949e]">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>System / Preamble</span>
                </div>
                <div className="font-mono text-white font-semibold">
                  {systemTokens.toLocaleString()} tokens
                </div>
              </div>

              <div className="p-2 rounded-lg bg-[#161b22] border border-[#30363d] space-y-0.5">
                <div className="flex items-center space-x-1 text-[#8b949e]">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <span>MCP Tools</span>
                </div>
                <div className="font-mono text-white font-semibold">
                  {toolTokens.toLocaleString()} tokens
                </div>
              </div>

              <div className="p-2 rounded-lg bg-[#161b22] border border-[#30363d] space-y-0.5">
                <div className="flex items-center space-x-1 text-[#8b949e]">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Turn History</span>
                </div>
                <div className="font-mono text-white font-semibold">
                  {historyTokens.toLocaleString()} tokens
                </div>
              </div>

              <div className="p-2 rounded-lg bg-[#161b22] border border-[#30363d] space-y-0.5">
                <div className="flex items-center space-x-1 text-[#8b949e]">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Compacted Saved</span>
                </div>
                <div className="font-mono text-amber-400 font-semibold">
                  {compactedTokens.toLocaleString()} tokens
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Context Compaction Telemetry */}
          <div className="p-4 bg-[#0d1117] border border-[#30363d] rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  <Archive className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-xs">Context Compaction Telemetry</h3>
                  <p className="text-[10px] text-[#8b949e]">
                    Automated token compression, history pruning, and buffer compaction
                  </p>
                </div>
              </div>

              <button
                onClick={handleRunCompaction}
                disabled={isCompacting}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-[11px] font-medium transition disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3 text-purple-400" />
                <span>{isCompacting ? "Compacting..." : "Compact Context Now"}</span>
              </button>
            </div>

            {/* Compaction Key Metric Cards */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 bg-[#161b22] border border-[#30363d] rounded-lg flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#8b949e]">Times Compacted</span>
                  <div className="text-sm font-bold text-white font-mono">
                    {compaction.count} {compaction.count === 1 ? "time" : "times"}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">
                  {compaction.count > 0 ? "Active" : "None"}
                </span>
              </div>

              <div className="p-2.5 bg-[#161b22] border border-[#30363d] rounded-lg flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-[#8b949e]">Total Tokens Reclaimed</span>
                  <div className="text-sm font-bold text-emerald-400 font-mono">
                    {compaction.totalTokensSaved.toLocaleString()}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  Saved
                </span>
              </div>
            </div>

            {/* Compaction History Log */}
            {compaction.history.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">
                  Compaction Pass Log
                </span>
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {compaction.history.map((record, idx) => (
                    <div
                      key={record.id || idx}
                      className="p-2 bg-[#161b22] border border-[#30363d] rounded-lg flex items-center justify-between text-[11px]"
                    >
                      <div className="space-y-0.5 truncate mr-2">
                        <div className="flex items-center space-x-1.5">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                          <span className="font-medium text-white truncate">{record.strategy}</span>
                        </div>
                        <span className="text-[9px] text-[#8b949e]">{record.timestamp}</span>
                      </div>

                      <div className="flex items-center space-x-1.5 flex-shrink-0">
                        <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                          -{record.tokensReclaimed.toLocaleString()} tokens
                        </span>
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          {record.reductionPercent}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-[#30363d] bg-[#161b22]/70 flex items-center justify-between flex-shrink-0">
          <button
            onClick={handleClearContext}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 hover:border-red-500/30 border border-transparent transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Context</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition shadow"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
