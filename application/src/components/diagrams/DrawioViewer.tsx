import { useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Copy, Check, LayoutGrid, Layers, Download } from "lucide-react";
import { useToastStore } from "../../store/toastStore";

interface DrawioViewerProps {
  content: string;
  name?: string;
}

export function DrawioViewer({ content, name = "diagram.drawio" }: DrawioViewerProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const { addToast } = useToastStore();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast("Copied Draw.io XML definition", "info");
    } catch {
      addToast("Failed to copy", "error");
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    addToast(`Downloaded ${name}`, "success");
  };

  // If content is an SVG or contains embedded SVG graphics
  const isSvg = content.trim().startsWith("<svg") || content.includes("<svg");

  return (
    <div className="flex flex-col h-full w-full bg-[#0d1117] rounded-xl border border-[#30363d] overflow-hidden select-none">
      {/* Top Diagram Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] text-xs">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-orange-400" />
          <span className="font-semibold text-white font-mono text-[11px]">Draw.io Architecture Diagram</span>
          <span className="text-[10px] text-orange-300 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/30">
            XML Vector Model
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Grid Toggle */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1.5 rounded-lg border transition flex items-center space-x-1 ${
              showGrid
                ? "bg-[#1f6feb]/20 border-blue-500 text-[#58a6ff]"
                : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-white"
            }`}
            title="Toggle Background Grid"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded-lg p-0.5 space-x-0.5">
            <button
              onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}
              className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono px-1.5 text-white">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
              className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom(1)}
              className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
              title="Reset Zoom"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Download XML */}
          <button
            onClick={handleDownload}
            className="p-1.5 rounded-lg bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d] transition"
            title="Download .drawio XML"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d] transition"
            title="Copy Draw.io XML"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Vector Rendering Canvas */}
      <div
        className={`flex-1 overflow-auto p-8 flex items-center justify-center min-h-[400px] relative ${
          showGrid
            ? "bg-[#0d1117] [background-image:radial-gradient(#30363d_1px,transparent_1px)] [background-size:16px_16px]"
            : "bg-[#0d1117]"
        }`}
      >
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: "center center", transition: "transform 0.15s ease-out" }}
          className="max-w-4xl w-full bg-[#161b22] border border-[#30363d] rounded-2xl p-6 shadow-2xl space-y-4"
        >
          {isSvg ? (
            <div dangerouslySetInnerHTML={{ __html: content }} className="flex justify-center [&>svg]:max-w-full" />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#30363d] pb-3">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-orange-500" />
                  <span className="font-semibold text-white text-sm">Kubernetes & Tokio Runtime Topology</span>
                </div>
                <span className="text-[10px] font-mono text-[#8b949e]">Schema v24.1</span>
              </div>

              {/* Graphical Visual Mock representation of the XML diagram */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-[#0d1117] border border-blue-500/40 text-center space-y-1">
                  <div className="font-semibold text-white text-xs">React LotA Client</div>
                  <div className="text-[10px] text-blue-400 font-mono">Port 5173 • SSE Consumer</div>
                </div>

                <div className="p-4 rounded-xl bg-[#0d1117] border border-purple-500/40 text-center space-y-1">
                  <div className="font-semibold text-white text-xs">Rust Rho Engine</div>
                  <div className="text-[10px] text-purple-400 font-mono">Tokio FSM • Rig Core</div>
                </div>

                <div className="p-4 rounded-xl bg-[#0d1117] border border-emerald-500/40 text-center space-y-1">
                  <div className="font-semibold text-white text-xs">MCP Server Cluster</div>
                  <div className="text-[10px] text-emerald-400 font-mono">GitHub • Ctx • Workspace</div>
                </div>
              </div>

              <div className="p-3 bg-[#0d1117] rounded-xl border border-[#30363d] text-[10px] font-mono text-[#8b949e] overflow-hidden line-clamp-3">
                {content}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
