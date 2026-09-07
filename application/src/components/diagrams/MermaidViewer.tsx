import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Copy,
  Check,
  AlertCircle,
  Code2,
  Eye,
} from "lucide-react";
import { useToastStore } from "../../store/toastStore";

interface MermaidViewerProps {
  code: string;
}

// Global cache for rendered Mermaid SVGs by code hash/string
const svgCache = new Map<string, string>();

let mermaidInitialized = false;
function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    suppressErrorRendering: true,
    themeVariables: {
      darkMode: true,
      background: "#0d1117",
      primaryColor: "#1f6feb",
      primaryTextColor: "#ffffff",
      primaryBorderColor: "#30363d",
      lineColor: "#58a6ff",
      secondaryColor: "#161b22",
      tertiaryColor: "#21262d",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    },
  });
  mermaidInitialized = true;
}

function processSvg(rawSvg: string): string {
  return rawSvg.replace(/<svg\b([^>]*)>/i, (_match, attrs) => {
    let cleanAttrs = attrs;
    let viewBox = "";
    const viewBoxMatch = cleanAttrs.match(/viewBox="([^"]+)"/i);
    if (viewBoxMatch) {
      viewBox = viewBoxMatch[1];
    } else {
      const wMatch = cleanAttrs.match(/width="([0-9.]+)(?:px)?"/i);
      const hMatch = cleanAttrs.match(/height="([0-9.]+)(?:px)?"/i);
      if (wMatch && hMatch) {
        viewBox = `0 0 ${parseFloat(wMatch[1])} ${parseFloat(hMatch[1])}`;
      }
    }

    let naturalMaxWidth = "100%";
    const styleMatch = cleanAttrs.match(/style="([^"]*)"/i);
    if (styleMatch) {
      const mwMatch = styleMatch[1].match(/max-width:\s*([0-9.]+px)/i);
      if (mwMatch) {
        naturalMaxWidth = mwMatch[1];
      }
    }
    if (naturalMaxWidth === "100%") {
      const wMatch = cleanAttrs.match(/width="([0-9.]+)(?:px)?"/i);
      if (wMatch && !cleanAttrs.includes('width="100%"')) {
        naturalMaxWidth = `${parseFloat(wMatch[1])}px`;
      }
    }

    cleanAttrs = cleanAttrs
      .replace(/\s*style="[^"]*"/gi, "")
      .replace(/\s*width="[^"]*"/gi, "")
      .replace(/\s*height="[^"]*"/gi, "")
      .replace(/\s*viewBox="[^"]*"/gi, "");

    const viewBoxAttr = viewBox ? `viewBox="${viewBox}"` : "";
    const styleAttr = `style="max-width: min(100%, ${naturalMaxWidth}); width: 100%; height: auto; display: block; margin: 0 auto;"`;
    return `<svg ${cleanAttrs.trim()} ${viewBoxAttr} ${styleAttr}>`;
  });
}

export function MermaidViewer({ code }: MermaidViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanCode = code
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  const [svgContent, setSvgContent] = useState<string>(() => svgCache.get(cleanCode) || "");
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const { addToast } = useToastStore();

  useEffect(() => {
    if (!cleanCode) return;

    if (svgCache.has(cleanCode)) {
      setSvgContent(svgCache.get(cleanCode)!);
      setError(null);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      if (!cleanCode || !isMounted) return;

      ensureMermaidInit();

      // Pre-validate syntax to prevent Mermaid from corrupting the DOM during streaming
      try {
        const isValid = await mermaid.parse(cleanCode, { suppressErrors: true });
        if (isValid === false) return;
      } catch {
        // Incomplete syntax during streaming - maintain current display without crashing or flashing error
        return;
      }

      const id = `mermaid-svg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      try {
        const { svg } = await mermaid.render(id, cleanCode);
        if (!isMounted) return;

        const responsiveSvg = processSvg(svg);
        svgCache.set(cleanCode, responsiveSvg);
        setSvgContent(responsiveSvg);
        setError(null);
      } catch (err: unknown) {
        if (isMounted && !svgContent) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        const leftover = document.getElementById(`d${id}`);
        if (leftover) leftover.remove();
        const tempSvg = document.getElementById(id);
        if (tempSvg && tempSvg.parentElement === document.body) tempSvg.remove();
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [cleanCode, svgContent]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cleanCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast("Copied Mermaid definition to clipboard", "info");
    } catch {
      addToast("Failed to copy code", "error");
    }
  };

  return (
    <div className="flex flex-col w-full max-w-full min-w-0 bg-[#0d1117] rounded-xl border border-[#30363d] overflow-hidden select-none my-3 shadow-xs">
      {/* Diagram Action Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#161b22] border-b border-[#30363d] text-xs">
        <div className="flex items-center space-x-2">
          {/* Mode Switcher */}
          <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded-lg p-0.5 space-x-0.5">
            <button
              type="button"
              onClick={() => setViewMode("diagram")}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                viewMode === "diagram"
                  ? "bg-[#21262d] text-white shadow-xs"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Diagram</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                viewMode === "code"
                  ? "bg-[#21262d] text-white shadow-xs"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              <Code2 className="w-3 h-3" />
              <span>Source</span>
            </button>
          </div>

          <span className="text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20 font-mono hidden sm:inline-block">
            Mermaid Vector
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          {/* Zoom Controls (Diagram Mode Only) */}
          {viewMode === "diagram" && !error && svgContent && (
            <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded-lg p-0.5 space-x-0.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
                className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <span className="text-[10px] font-mono px-1 text-white select-none">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
                className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
                title="Zoom In"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
                title="Reset Zoom"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-lg bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d] transition flex items-center space-x-1"
            title="Copy Mermaid Code"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div
        ref={containerRef}
        className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-auto p-4 min-h-[160px] max-h-[560px] bg-[#0d1117]"
      >
        {viewMode === "code" ? (
          <div className="w-full max-w-full min-w-0">
            <pre className="text-[#c9d1d9] font-mono text-xs p-3 rounded-lg bg-[#161b22] border border-[#30363d] overflow-x-auto whitespace-pre select-text">
              {cleanCode}
            </pre>
          </div>
        ) : error ? (
          <div className="p-3.5 bg-amber-950/20 border border-amber-900/40 rounded-xl text-amber-200 w-full max-w-full min-w-0 space-y-2 text-xs select-text">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 font-medium">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Diagram rendering in progress or syntax incomplete</span>
              </div>
              <button
                type="button"
                onClick={() => setViewMode("code")}
                className="text-[11px] text-[#58a6ff] hover:underline"
              >
                View Source Code
              </button>
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap text-[#8b949e] bg-[#161b22] p-2.5 rounded-lg border border-[#30363d] overflow-x-auto">
              {cleanCode}
            </pre>
          </div>
        ) : svgContent ? (
          <div className="w-full min-w-0 flex items-center justify-center">
            <div
              style={
                zoom !== 1
                  ? {
                      transform: `scale(${zoom})`,
                      transformOrigin: "top center",
                      transition: "transform 0.15s ease-out",
                      width: zoom > 1 ? `${zoom * 100}%` : "100%",
                    }
                  : undefined
              }
              dangerouslySetInnerHTML={{ __html: svgContent }}
              className="w-full max-w-full flex items-center justify-center min-w-0"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center py-6">
            <span className="text-[#8b949e] text-xs font-mono animate-pulse">
              Rendering vector diagram...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
