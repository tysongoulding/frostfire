import { useState } from "react";
import { ToolCallData } from "../../store/sessionStore";
import { DiffViewer } from "../chat/DiffViewer";
import { FileEdit, ChevronDown, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";

interface FileEditCardProps {
  toolCall: ToolCallData;
}

export function FileEditCard({ toolCall }: FileEditCardProps) {
  const [isOpen, setIsOpen] = useState(true);

  const filePath = typeof toolCall.arguments.file_path === "string" ? toolCall.arguments.file_path : "file";
  const targetContent = typeof toolCall.arguments.target_content === "string" ? toolCall.arguments.target_content : "";
  const replacementContent = typeof toolCall.arguments.replacement_content === "string" ? toolCall.arguments.replacement_content : "";
  const startLine = typeof toolCall.arguments.start_line === "number" ? toolCall.arguments.start_line : 1;

  const isDone = toolCall.output !== undefined;

  return (
    <div className="w-full bg-[#161b22] border border-[#30363d] rounded-xl my-2 text-xs overflow-hidden shadow-sm">
      {/* Action Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1c2128] border-b border-[#30363d] select-none">
        <div className="flex items-center space-x-2 truncate">
          <FileEdit className="w-4 h-4 text-purple-400 flex-shrink-0" />
          <span className="text-[#8b949e]">Editing</span>
          <span className="font-semibold text-white font-mono truncate">{filePath}</span>
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
                <span>Applied</span>
              </span>
            )
          ) : (
            <span className="text-yellow-400 text-[10px] font-semibold animate-pulse bg-yellow-950/30 px-1.5 py-0.5 rounded border border-yellow-800/40">
              Applying...
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
        <div className="p-3">
          <DiffViewer
            filePath={filePath}
            targetContent={targetContent}
            replacementContent={replacementContent}
            startLine={startLine}
          />
        </div>
      )}
    </div>
  );
}
