import { useState } from "react";
import { ToolCallData } from "../../store/sessionStore";
import { Link2, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";

interface WebFetchCardProps {
  toolCall: ToolCallData;
}

export function WebFetchCard({ toolCall }: WebFetchCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const url = typeof toolCall.arguments.url === "string" ? toolCall.arguments.url : "";
  const isDone = toolCall.output !== undefined;

  return (
    <div className="w-full bg-[#161b22] border border-[#30363d] rounded-xl my-2 text-xs overflow-hidden shadow-sm">
      {/* Action Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1c2128] border-b border-[#30363d] select-none">
        <div className="flex items-center space-x-2 truncate">
          <Link2 className="w-4 h-4 text-[#58a6ff] flex-shrink-0" />
          <span className="text-[#8b949e]">Fetching</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-white font-mono truncate hover:underline flex items-center space-x-1"
          >
            <span>{url}</span>
            <ExternalLink className="w-3 h-3 text-[#8b949e]" />
          </a>
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
                <span>Error</span>
              </span>
            ) : (
              <span className="flex items-center space-x-1 text-green-400 text-[10px] font-semibold bg-green-950/30 px-1.5 py-0.5 rounded border border-green-800/40">
                <CheckCircle2 className="w-3 h-3" />
                <span>Extracted</span>
              </span>
            )
          ) : (
            <span className="text-yellow-400 text-[10px] font-semibold animate-pulse bg-yellow-950/30 px-1.5 py-0.5 rounded border border-yellow-800/40">
              Fetching...
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

      {isOpen && toolCall.output && (
        <div className="p-3 bg-[#0d1117] text-[11px] leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap text-[#c9d1d9]">
          {toolCall.output}
        </div>
      )}
    </div>
  );
}
