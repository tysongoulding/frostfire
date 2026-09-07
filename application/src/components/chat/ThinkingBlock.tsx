import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";

interface ThinkingBlockProps {
  reasoning: string;
}

export function ThinkingBlock({ reasoning }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!reasoning) return null;

  return (
    <div className="mb-3 border border-[#30363d] rounded-md bg-[#0d1117] overflow-hidden text-xs">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#161b22] hover:bg-[#21262d] text-[#8b949e] hover:text-white transition select-none"
      >
        <div className="flex items-center space-x-2">
          <Brain className="w-3.5 h-3.5 text-[#58a6ff]" />
          <span className="font-medium">Thinking Process</span>
        </div>
        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {isOpen && (
        <div className="p-3 whitespace-pre-wrap font-mono text-[11px] text-[#8b949e] leading-relaxed max-h-72 overflow-y-auto border-t border-[#30363d]">
          {reasoning}
        </div>
      )}
    </div>
  );
}
