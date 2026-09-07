import { useState } from "react";
import { parseEditDiff } from "../../lib/diff";
import { Columns, AlignJustify, Copy, Check, FileCode } from "lucide-react";

interface DiffViewerProps {
  filePath?: string;
  targetContent: string;
  replacementContent: string;
  startLine?: number;
}

export function DiffViewer({
  filePath,
  targetContent,
  replacementContent,
  startLine = 1,
}: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [copied, setCopied] = useState(false);

  const diffLines = parseEditDiff(targetContent, replacementContent, startLine);
  const additions = diffLines.filter((l) => l.type === "add").length;
  const deletions = diffLines.filter((l) => l.type === "delete").length;

  const handleCopyNew = async () => {
    try {
      await navigator.clipboard.writeText(replacementContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="my-3 rounded-xl border border-[#30363d] bg-[#0d1117] overflow-hidden text-xs font-mono shadow-sm">
      {/* Diff Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-[#30363d] select-none">
        <div className="flex items-center space-x-2">
          <FileCode className="w-3.5 h-3.5 text-[#58a6ff]" />
          <span className="font-semibold text-white truncate max-w-xs">{filePath || "file edit"}</span>
          <div className="flex items-center space-x-1.5 text-[10px] font-semibold">
            <span className="text-green-400 bg-green-950/30 px-1.5 py-0.5 rounded border border-green-800/40">
              +{additions}
            </span>
            <span className="text-red-400 bg-red-950/30 px-1.5 py-0.5 rounded border border-red-800/40">
              -{deletions}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Mode Switcher */}
          <div className="flex bg-[#0d1117] p-0.5 rounded border border-[#30363d]">
            <button
              onClick={() => setViewMode("unified")}
              className={`p-1 rounded transition ${
                viewMode === "unified" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-white"
              }`}
              title="Unified View"
            >
              <AlignJustify className="w-3 h-3" />
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`p-1 rounded transition ${
                viewMode === "split" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-white"
              }`}
              title="Side-by-Side View"
            >
              <Columns className="w-3 h-3" />
            </button>
          </div>

          <button
            onClick={handleCopyNew}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] hover:text-white transition text-[11px]"
            title="Copy Replacement"
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>

      {/* Diff Table */}
      {viewMode === "unified" ? (
        <div className="overflow-x-auto max-h-72 p-2 text-[11px] leading-relaxed">
          {diffLines.map((line, idx) => (
            <div
              key={idx}
              className={`flex items-start px-2 py-0.5 rounded ${
                line.type === "add"
                  ? "bg-green-950/20 text-[#7ee787]"
                  : line.type === "delete"
                  ? "bg-red-950/20 text-[#ff7b72]"
                  : "text-[#8b949e]"
              }`}
            >
              <span className="w-8 select-none text-right pr-2 text-[#484f58] flex-shrink-0">
                {line.oldLineNumber ?? ""}
              </span>
              <span className="w-8 select-none text-right pr-3 text-[#484f58] flex-shrink-0">
                {line.newLineNumber ?? ""}
              </span>
              <span className="w-4 select-none text-center font-bold flex-shrink-0">
                {line.type === "add" ? "+" : line.type === "delete" ? "-" : " "}
              </span>
              <span className="flex-1 whitespace-pre-wrap">{line.content}</span>
            </div>
          ))}
        </div>
      ) : (
        /* Split View */
        <div className="grid grid-cols-2 divide-x divide-[#30363d] overflow-x-auto max-h-72 text-[11px] leading-relaxed">
          {/* Left: Original */}
          <div className="p-2 space-y-0.5">
            <div className="text-[10px] uppercase font-semibold text-red-400 mb-1 px-1">Original</div>
            {targetContent.split("\n").map((line, idx) => (
              <div key={idx} className="flex px-1 bg-red-950/20 text-[#ff7b72] rounded">
                <span className="w-6 text-right pr-2 text-[#484f58] select-none">{startLine + idx}</span>
                <span className="whitespace-pre-wrap">{line}</span>
              </div>
            ))}
          </div>

          {/* Right: Replacement */}
          <div className="p-2 space-y-0.5">
            <div className="text-[10px] uppercase font-semibold text-green-400 mb-1 px-1">Replacement</div>
            {replacementContent.split("\n").map((line, idx) => (
              <div key={idx} className="flex px-1 bg-green-950/20 text-[#7ee787] rounded">
                <span className="w-6 text-right pr-2 text-[#484f58] select-none">{startLine + idx}</span>
                <span className="whitespace-pre-wrap">{line}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
