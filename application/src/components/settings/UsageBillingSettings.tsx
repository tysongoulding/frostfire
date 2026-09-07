import { CreditCard, DollarSign, Activity, PieChart, ArrowUpRight } from "lucide-react";
import { useSessionStore } from "../../store/sessionStore";

export function UsageBillingSettings() {
  const { usage } = useSessionStore();

  const inputTokens = usage.inputTokens || 9800;
  const outputTokens = usage.outputTokens || 4450;
  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = (
    (inputTokens / 1_000_000) * 3.0 +
    (outputTokens / 1_000_000) * 15.0
  ).toFixed(4);

  const modelRates = [
    { model: "Claude 3.7 Sonnet", provider: "Anthropic", input: "$3.00 / 1M", output: "$15.00 / 1M", status: "Active" },
    { model: "GPT-4o", provider: "OpenAI", input: "$2.50 / 1M", output: "$10.00 / 1M", status: "Available" },
    { model: "Grok 2", provider: "xAI (SpaceX)", input: "$2.00 / 1M", output: "$10.00 / 1M", status: "Available" },
    { model: "Gemini 2.0 Flash", provider: "Google", input: "$0.10 / 1M", output: "$0.40 / 1M", status: "Available" },
    { model: "DeepSeek V3", provider: "DeepSeek", input: "$0.14 / 1M", output: "$0.28 / 1M", status: "Available" },
    { model: "Llama 3.3 70B", provider: "Ollama (Local)", input: "Free ($0.00)", output: "Free ($0.00)", status: "Local Engine" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <CreditCard className="w-4 h-4 text-[#58a6ff]" />
          <span>Usage, Token Metrics & Cost Estimation</span>
        </h2>
        <p className="text-[#8b949e]">
          Monitor real-time token consumption, reasoning budget utilization, and provider pricing tiers.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-[#8b949e] flex items-center justify-between">
            <span>Total Tokens</span>
            <Activity className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">{totalTokens.toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e]">Combined session tokens</div>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-[#8b949e] flex items-center justify-between">
            <span>Prompt (Input)</span>
            <PieChart className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">{inputTokens.toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e]">Context + @file attachments</div>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-[#8b949e] flex items-center justify-between">
            <span>Completion (Output)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-green-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">{outputTokens.toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e]">Generated code + reasoning</div>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-[#8b949e] flex items-center justify-between">
            <span>Estimated Cost</span>
            <DollarSign className="w-3.5 h-3.5 text-yellow-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">${estimatedCost}</div>
          <div className="text-[10px] text-[#8b949e]">Based on active provider tier</div>
        </div>
      </div>

      {/* Provider Pricing Table */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
          Model Provider Pricing Reference
        </label>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#30363d] text-[10px] text-[#8b949e] uppercase">
                <th className="pb-2 font-semibold">Model</th>
                <th className="pb-2 font-semibold">Provider</th>
                <th className="pb-2 font-semibold">Input / 1M</th>
                <th className="pb-2 font-semibold">Output / 1M</th>
                <th className="pb-2 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d] font-mono text-[11px]">
              {modelRates.map((row, idx) => (
                <tr key={idx} className="hover:bg-[#0d1117]/50 transition">
                  <td className="py-2.5 font-sans font-semibold text-white">{row.model}</td>
                  <td className="py-2.5 text-[#8b949e] font-sans">{row.provider}</td>
                  <td className="py-2.5 text-[#c9d1d9]">{row.input}</td>
                  <td className="py-2.5 text-[#c9d1d9]">{row.output}</td>
                  <td className="py-2.5 text-right font-sans">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] ${
                        row.status === "Active"
                          ? "bg-green-950/40 text-green-400 border border-green-800"
                          : row.status === "Local Engine"
                          ? "bg-purple-950/40 text-purple-400 border border-purple-800"
                          : "bg-[#21262d] text-[#8b949e]"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
