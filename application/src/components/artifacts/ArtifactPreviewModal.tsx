import { useState, useEffect } from "react";
import { ArtifactItem, useArtifactStore } from "../../store/artifactStore";
import { useToastStore } from "../../store/toastStore";
import { MarkviewDocumentView } from "../markdown/MarkviewDocumentView";
import { MarkviewRenderer } from "../markdown/MarkviewRenderer";
import { MermaidViewer } from "../diagrams/MermaidViewer";
import { DrawioViewer } from "../diagrams/DrawioViewer";
import { SlidesViewer } from "../diagrams/SlidesViewer";
import {
  X,
  Eye,
  Code2,
  Columns,
  Save,
  Copy,
  Check,
  Globe,
  FileText,
  FileCode,
  Database,
  Image as ImageIcon,
  Sparkles,
  Layers,
  Presentation,
} from "lucide-react";

interface ArtifactPreviewModalProps {
  artifact: ArtifactItem | null;
  initialMode?: "preview" | "code" | "split";
  onClose: () => void;
  onOpenRevise?: () => void;
}

export function ArtifactPreviewModal({
  artifact,
  initialMode = "preview",
  onClose,
  onOpenRevise,
}: ArtifactPreviewModalProps) {
  const { updateArtifact } = useArtifactStore();
  const { addToast } = useToastStore();

  const [mode, setMode] = useState<"preview" | "code" | "split">(initialMode);
  const [editedCode, setEditedCode] = useState<string>("");
  const [editedName, setEditedName] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  useEffect(() => {
    if (artifact) {
      setEditedCode(artifact.content);
      setEditedName(artifact.name);
      setMode(initialMode);
      setIsDirty(false);
    }
  }, [artifact, initialMode]);

  if (!artifact) return null;

  const handleSave = () => {
    updateArtifact(artifact.id, editedCode, editedName);
    setIsDirty(false);
    addToast(`Saved changes to ${editedName}`, "success");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast("Copied artifact code to clipboard", "info");
    } catch {
      addToast("Failed to copy code", "error");
    }
  };

  const ext = artifact.extension.toLowerCase();
  const isMarkdown = ext === "md";
  const isMermaid = ext === "mmd" || ext === "mermaid";
  const isDrawio = ext === "drawio" || (ext === "xml" && editedCode.includes("<mxfile"));
  const isSlides = ext === "deck" || ext === "slides";

  const getExtensionColor = (extension: string) => {
    switch (extension.toLowerCase()) {
      case "html":
        return "text-orange-400 bg-orange-500/10 border-orange-500/30";
      case "md":
        return "text-blue-400 bg-blue-500/10 border-blue-500/30";
      case "mmd":
      case "mermaid":
        return "text-purple-400 bg-purple-500/10 border-purple-500/30";
      case "drawio":
        return "text-amber-400 bg-amber-500/10 border-amber-500/30";
      case "deck":
      case "slides":
        return "text-pink-400 bg-pink-500/10 border-pink-500/30";
      case "svg":
        return "text-purple-400 bg-purple-500/10 border-purple-500/30";
      case "json":
        return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
      case "sql":
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
      default:
        return "text-gray-400 bg-gray-500/10 border-gray-500/30";
    }
  };

  const renderFileIcon = (extension: string) => {
    switch (extension.toLowerCase()) {
      case "html":
        return <Globe className="w-4 h-4 text-orange-400" />;
      case "md":
        return <FileText className="w-4 h-4 text-blue-400" />;
      case "mmd":
      case "mermaid":
        return <Layers className="w-4 h-4 text-purple-400" />;
      case "drawio":
        return <Layers className="w-4 h-4 text-amber-400" />;
      case "deck":
      case "slides":
        return <Presentation className="w-4 h-4 text-pink-400" />;
      case "svg":
        return <ImageIcon className="w-4 h-4 text-purple-400" />;
      case "sql":
        return <Database className="w-4 h-4 text-emerald-400" />;
      default:
        return <FileCode className="w-4 h-4 text-gray-400" />;
    }
  };

  const lineCount = editedCode.split("\n").length;

  const renderLiveViewComponent = () => {
    if (ext === "html") {
      return (
        <iframe
          title={artifact.name}
          srcDoc={editedCode}
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="w-full h-full bg-white border-0"
        />
      );
    }
    if (isMermaid) {
      return <MermaidViewer code={editedCode} />;
    }
    if (isDrawio) {
      return <DrawioViewer content={editedCode} name={editedName} />;
    }
    if (isSlides) {
      return <SlidesViewer content={editedCode} title={editedName} />;
    }
    if (isMarkdown) {
      return <MarkviewDocumentView content={editedCode} title={editedName} />;
    }
    if (ext === "svg") {
      return (
        <div
          className="w-full h-full flex items-center justify-center p-8 bg-[#0d1117] overflow-auto"
          dangerouslySetInnerHTML={{ __html: editedCode }}
        />
      );
    }
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <pre className="p-5 bg-[#161b22] rounded-xl border border-[#30363d] font-mono text-xs text-[#c9d1d9] overflow-x-auto whitespace-pre-wrap">
          {editedCode}
        </pre>
      </div>
    );
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 select-none animate-in fade-in duration-150"
    >
      {/* 80-85% Screen Modal Window */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[88vw] h-[85vh] max-w-7xl max-h-[90vh] bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs animate-in zoom-in-95 duration-150"
      >
        {/* Modal Top Navigation & Actions Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#30363d] bg-[#0d1117] flex-shrink-0">
          {/* File Info */}
          <div className="flex items-center space-x-3 truncate mr-4">
            <div className="p-1.5 rounded-lg bg-[#161b22] border border-[#30363d]">
              {renderFileIcon(artifact.extension)}
            </div>
            <div className="truncate">
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => {
                    setEditedName(e.target.value);
                    setIsDirty(true);
                  }}
                  className="bg-transparent font-mono text-xs font-semibold text-white outline-none border-b border-transparent focus:border-[#58a6ff] hover:border-[#30363d] transition py-0.5"
                />
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border uppercase ${getExtensionColor(
                    artifact.extension
                  )}`}
                >
                  .{artifact.extension}
                </span>
                {isDirty && (
                  <span className="w-2 h-2 rounded-full bg-yellow-400" title="Unsaved changes" />
                )}
              </div>
              <div className="text-[10px] text-[#8b949e]">
                {lineCount} lines • {new Blob([editedCode]).size} bytes • Updated{" "}
                {new Date(artifact.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>

          {/* View Modes & Action Buttons */}
          <div className="flex items-center space-x-2 flex-shrink-0">
            {/* View Mode Switcher */}
            <div className="flex items-center bg-[#161b22] border border-[#30363d] rounded-lg p-0.5 space-x-0.5">
              <button
                onClick={() => setMode("preview")}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition font-medium text-[11px] ${
                  mode === "preview"
                    ? "bg-[#1f6feb] text-white shadow-sm"
                    : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
                }`}
                title="Live Rendered Display (HTML / Mermaid / Draw.io / Slides)"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>
                  {isMarkdown
                    ? "MarkView"
                    : isMermaid
                    ? "Diagram"
                    : isDrawio
                    ? "Draw.io"
                    : isSlides
                    ? "Slides"
                    : "Live View"}
                </span>
              </button>

              <button
                onClick={() => setMode("code")}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition font-medium text-[11px] ${
                  mode === "code"
                    ? "bg-[#1f6feb] text-white shadow-sm"
                    : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
                }`}
                title="Raw code editor"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Code Editor</span>
              </button>

              <button
                onClick={() => setMode("split")}
                className={`hidden md:flex items-center space-x-1 px-2.5 py-1 rounded-md transition font-medium text-[11px] ${
                  mode === "split"
                    ? "bg-[#1f6feb] text-white shadow-sm"
                    : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
                }`}
                title="Split code editor and live preview side-by-side"
              >
                <Columns className="w-3.5 h-3.5" />
                <span>Split View</span>
              </button>
            </div>

            {/* AI Revise Button */}
            {onOpenRevise && (
              <button
                onClick={onOpenRevise}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs shadow-sm transition"
                title="Open AI Revision assistant with version control and git diffs"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                <span>Revise</span>
              </button>
            )}

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium text-xs transition ${
                isDirty
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow"
                  : "bg-[#21262d] text-[#8b949e] opacity-60 cursor-not-allowed"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>

            {/* Copy Button */}
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg bg-[#161b22] hover:bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d] transition"
              title="Copy code"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#161b22] hover:bg-red-950/40 text-[#8b949e] hover:text-red-400 border border-[#30363d] transition ml-1"
              title="Close modal (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Main Viewport (80% screen content area) */}
        <div className="flex-1 overflow-hidden flex min-h-0 bg-[#0d1117]">
          {/* Split Mode: Code on Left, Live View on Right */}
          {mode === "split" && (
            <div className="flex-1 flex divide-x divide-[#30363d] overflow-hidden">
              {/* Left Code Editor Panel */}
              <div className="w-1/2 flex flex-col min-h-0">
                <div className="px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] text-[10px] text-[#8b949e] font-mono flex items-center justify-between">
                  <span>Source Definition (Editable)</span>
                  <span>{lineCount} lines</span>
                </div>
                <textarea
                  value={editedCode}
                  onChange={(e) => {
                    setEditedCode(e.target.value);
                    setIsDirty(true);
                  }}
                  className="flex-1 p-4 bg-[#0d1117] text-[#c9d1d9] font-mono text-xs leading-relaxed outline-none resize-none overflow-y-auto selection:bg-blue-600/30"
                  spellCheck={false}
                />
              </div>

              {/* Right Live Preview Panel */}
              <div className="w-1/2 flex flex-col min-h-0 bg-[#0d1117] overflow-hidden">
                <div className="px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] text-[10px] text-[#8b949e] font-mono flex items-center justify-between">
                  <span className="flex items-center space-x-1">
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    <span>Live Output</span>
                  </span>
                  <span className="text-emerald-400">Interactive</span>
                </div>
                <div className="flex-1 overflow-auto p-4 flex flex-col">
                  {isMermaid ? (
                    <MermaidViewer code={editedCode} />
                  ) : isDrawio ? (
                    <DrawioViewer content={editedCode} name={editedName} />
                  ) : isSlides ? (
                    <SlidesViewer content={editedCode} title={editedName} />
                  ) : isMarkdown ? (
                    <div className="p-4 bg-[#161b22] rounded-xl border border-[#30363d]">
                      <MarkviewRenderer content={editedCode} showLineNumbers={false} />
                    </div>
                  ) : ext === "html" ? (
                    <iframe
                      title={artifact.name}
                      srcDoc={editedCode}
                      sandbox="allow-scripts allow-same-origin allow-popups"
                      className="w-full h-full min-h-[500px] bg-white rounded-xl border border-[#30363d]"
                    />
                  ) : (
                    <div className="p-4 bg-[#161b22] rounded-xl border border-[#30363d] font-mono text-xs text-[#c9d1d9] whitespace-pre-wrap">
                      {editedCode}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Full Code Mode */}
          {mode === "code" && (
            <div className="flex-1 flex flex-col min-h-0">
              <textarea
                value={editedCode}
                onChange={(e) => {
                  setEditedCode(e.target.value);
                  setIsDirty(true);
                }}
                className="flex-1 p-5 bg-[#0d1117] text-[#c9d1d9] font-mono text-xs leading-relaxed outline-none resize-none overflow-y-auto selection:bg-blue-600/30"
                spellCheck={false}
              />
            </div>
          )}

          {/* Full Live Preview Mode */}
          {mode === "preview" && (
            <div className="flex-1 flex flex-col min-h-0 bg-[#0d1117] overflow-hidden">
              {renderLiveViewComponent()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
