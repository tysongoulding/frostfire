import { useState } from "react";
import { ToolCallData } from "../../store/sessionStore";
import { Terminal, Copy, Check, ChevronDown, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";

interface BashTerminalCardProps {
  toolCall: ToolCallData;
}

export function BashTerminalCard({ toolCall }: BashTerminalCardProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const command = typeof toolCall.arguments.command === "string" ? toolCall.arguments.command : "";
  const isDone = toolCall.output !== undefined;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl my-2 font-mono text-xs overflow-hidden shadow-sm">
      {/* Terminal Titlebar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-[#30363d] select-none">
        <div className="flex items-center space-x-2 truncate">
          <Terminal className="w-4 h-4 text-[#58a6ff] flex-shrink-0" />
          <span className="text-[#8b949e] font-semibold">$</span>
          <span className="font-semibold text-white truncate max-w-sm">{command}</span>
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
                <span>Exit Error</span>
              </span>
            ) : (
              <span className="flex items-center space-x-1 text-green-400 text-[10px] font-semibold bg-green-950/30 px-1.5 py-0.5 rounded border border-green-800/40">
                <CheckCircle2 className="w-3 h-3" />
                <span>Exit 0</span>
              </span>
            )
          ) : (
            <span className="text-yellow-400 text-[10px] font-semibold animate-pulse bg-yellow-950/30 px-1.5 py-0.5 rounded border border-yellow-800/40">
              Running...
            </span>
          )}

          <button
            onClick={handleCopy}
            className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] transition"
            title="Copy Command"
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </button>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] transition"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      {isOpen && (
        <div className="p-3 bg-[#080a0e] text-[11px] leading-relaxed max-h-64 overflow-y-auto font-mono">
          {toolCall.output ? (
            <pre
              className={`whitespace-pre-wrap ${
                toolCall.isError ? "text-red-300" : "text-[#7ee787]"
              }`}
            >
              {toolCall.output}
            </pre>
          ) : (
            <span className="text-[#8b949e] italic">Executing command in workspace...</span>
          )}
        </div>
      )}
    </div>
  );
}
