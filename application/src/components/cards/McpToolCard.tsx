import { useState } from "react";
import { ToolCallData } from "../../store/sessionStore";
import { Server, ChevronDown, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";

interface McpToolCardProps {
  toolCall: ToolCallData;
}

export function McpToolCard({ toolCall }: McpToolCardProps) {
  const [isOpen, setIsOpen] = useState(true);
  const isDone = toolCall.output !== undefined;

  return (
    <div className="w-full bg-[#161b22] border border-[#30363d] rounded-xl my-2 text-xs font-mono overflow-hidden shadow-sm">
      {/* Action Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1c2128] border-b border-[#30363d] select-none">
        <div className="flex items-center space-x-2 truncate">
          <Server className="w-4 h-4 text-purple-400 flex-shrink-0" />
          <span className="text-[#8b949e]">Tool</span>
          <span className="font-semibold text-white truncate">{toolCall.tool}</span>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          {toolCall.durationMs !== undefined && (
            <span className="text-[10px] text-[#8b949e]">
              {toolCall.durationMs}ms
            </span>
          )}

          {isDone ? (
            toolCall.isError ? (
              <span className="flex items-center space-x-1 text-red-400 text-[10px] font-semibold bg-red-950/30 px-1.5 py-0.5 rounded border border-red-900/40">
                <AlertCircle className="w-3 h-3" />
                <span>Failed</span>
              </span>
            ) : (
              <span className="flex items-center space-x-1 text-green-400 text-[10px] font-semibold bg-green-950/30 px-1.5 py-0.5 rounded border border-green-800/40">
                <CheckCircle2 className="w-3 h-3" />
                <span>Success</span>
              </span>
            )
          ) : (
            <span className="text-yellow-400 text-[10px] font-semibold animate-pulse bg-yellow-950/30 px-1.5 py-0.5 rounded border border-yellow-800/40">
              Running...
            </span>
          )}

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] transition"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-3 space-y-2">
          <div>
            <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">
              Arguments
            </div>
            <pre className="bg-[#0d1117] p-2 rounded text-[#c9d1d9] overflow-x-auto text-[11px]">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>

          {toolCall.output && (
            <div>
              <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">
                Output
              </div>
              <pre
                className={`p-2 rounded text-[11px] max-h-60 overflow-y-auto whitespace-pre-wrap ${
                  toolCall.isError
                    ? "bg-red-950/20 text-red-400 border border-red-900/40"
                    : "bg-[#0d1117] text-[#7ee787]"
                }`}
              >
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
