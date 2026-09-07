import { useState, useMemo } from "react";
import { MarkviewRenderer } from "./MarkviewRenderer";
import {
  List,
  PanelLeftClose,
  PanelLeft,
  Binary,
  Maximize2,
  Minimize2,
  BookOpen,
  Hash,
} from "lucide-react";

interface MarkviewDocumentViewProps {
  content: string;
  title?: string;
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

export function MarkviewDocumentView({ content, title }: MarkviewDocumentViewProps) {
  const [tocOpen, setTocOpen] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [fullWidth, setFullWidth] = useState(false);

  // Extract headings for Table of Contents
  const toc = useMemo<TocItem[]>(() => {
    const lines = content.split("\n");
    const items: TocItem[] = [];
    lines.forEach((line) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        const id = text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
        items.push({ id, text, level });
      }
    });
    return items;
  }, [content]);

  // Statistics
  const wordCount = useMemo(() => content.trim().split(/\s+/).filter(Boolean).length, [content]);
  const readingTime = Math.ceil(wordCount / 200);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] min-w-0 overflow-hidden text-xs">
      {/* MarkView Desktop Control Toolbar */}
      <div className="px-5 py-2.5 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between flex-shrink-0 select-none">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setTocOpen(!tocOpen)}
            className={`p-1.5 rounded-lg border transition flex items-center space-x-1.5 text-xs ${
              tocOpen
                ? "bg-[#1f6feb]/20 text-[#58a6ff] border-blue-500/40"
                : "bg-[#0d1117] text-[#8b949e] border-[#30363d] hover:text-white"
            }`}
            title="Toggle Outline / Table of Contents"
          >
            {tocOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeft className="w-3.5 h-3.5" />}
            <span className="text-[11px] font-medium hidden sm:inline">Outline</span>
          </button>

          {title && (
            <div className="font-mono text-xs font-semibold text-white pl-2 truncate max-w-xs border-l border-[#30363d]">
              {title}
            </div>
          )}
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center space-x-2">
          {/* Toggle Code Line Numbers */}
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            className={`p-1.5 rounded-lg border transition flex items-center space-x-1 text-xs ${
              showLineNumbers
                ? "bg-[#21262d] text-white border-[#30363d]"
                : "bg-[#0d1117] text-[#8b949e] border-[#30363d] hover:text-white"
            }`}
            title="Toggle code line numbers"
          >
            <Binary className="w-3.5 h-3.5" />
            <span className="text-[10px] hidden md:inline">Line Numbers</span>
          </button>

          {/* Toggle Reading Width */}
          <button
            onClick={() => setFullWidth(!fullWidth)}
            className="p-1.5 rounded-lg bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white transition flex items-center space-x-1"
            title={fullWidth ? "Reading view (constrained)" : "Full width view"}
          >
            {fullWidth ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="text-[10px] hidden md:inline">{fullWidth ? "Constrain" : "Expand"}</span>
          </button>

          {/* Stats Badge */}
          <div className="hidden lg:flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-[#0d1117] border border-[#30363d] text-[#8b949e] font-mono text-[10px]">
            <BookOpen className="w-3 h-3 text-[#58a6ff]" />
            <span>{wordCount} words</span>
            <span>•</span>
            <span>~{readingTime} min read</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Collapsible Document Outline (TOC) */}
        {tocOpen && toc.length > 0 && (
          <aside className="w-56 border-r border-[#30363d] bg-[#161b22]/40 overflow-y-auto p-3 space-y-1 select-none flex-shrink-0 animate-in slide-in-from-left-4 duration-150">
            <div className="flex items-center space-x-1.5 text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider px-2 py-1">
              <List className="w-3 h-3" />
              <span>Document Outline</span>
            </div>

            <nav className="space-y-0.5 pt-1">
              {toc.map((item, idx) => (
                <div
                  key={idx}
                  className={`px-2 py-1 rounded-md text-[11px] text-[#c9d1d9] hover:text-white hover:bg-[#21262d] transition truncate cursor-pointer flex items-center space-x-1 ${
                    item.level === 1
                      ? "font-semibold text-white"
                      : item.level === 2
                      ? "pl-4 text-[#8b949e]"
                      : "pl-7 text-[#8b949e]/80 text-[10px]"
                  }`}
                  title={item.text}
                >
                  <Hash className="w-2.5 h-2.5 text-[#58a6ff] flex-shrink-0" />
                  <span className="truncate">{item.text}</span>
                </div>
              ))}
            </nav>
          </aside>
        )}

        {/* Markdown Reader Body */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 min-h-0 bg-[#0d1117]">
          <div className={fullWidth ? "w-full" : "max-w-4xl mx-auto"}>
            <MarkviewRenderer content={content} showLineNumbers={showLineNumbers} />
          </div>
        </main>
      </div>
    </div>
  );
}
