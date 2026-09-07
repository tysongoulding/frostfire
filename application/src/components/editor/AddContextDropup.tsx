import { useState, useRef, useEffect } from "react";
import {
  Plus,
  Image,
  AtSign,
  Zap,
  Globe,
  FileCode,
  Sparkles,
  Camera,
  UploadCloud,
} from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useToastStore } from "../../store/toastStore";

interface AddContextDropupProps {
  onInsertMention: (char: string) => void;
  onOpenBrowserTool: () => void;
}

export function AddContextDropup({ onInsertMention, onOpenBrowserTool }: AddContextDropupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addAttachedFile } = useWorkspaceStore();
  const { addToast } = useToastStore();

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        addAttachedFile(file.name);
      }
      addToast(`Attached ${files.length} context file(s)`, "info");
      setIsOpen(false);
    }
  };

  const contextOptions = [
    {
      id: "media",
      label: "Media & Attachments",
      desc: "Upload images, diagrams, or source files",
      icon: Image,
      color: "text-pink-400 bg-pink-500/10 border-pink-500/20",
      action: () => fileInputRef.current?.click(),
    },
    {
      id: "mentions",
      label: "Mentions (@agent / @file)",
      desc: "Reference specific files, docs, or agents",
      icon: AtSign,
      color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
      action: () => {
        onInsertMention("@");
        setIsOpen(false);
      },
    },
    {
      id: "actions",
      label: "Workflow Actions (/command)",
      desc: "Trigger /plan, /verify, /build, /wrap-up",
      icon: Zap,
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      action: () => {
        onInsertMention("/");
        setIsOpen(false);
      },
    },
    {
      id: "browser",
      label: "Browser & Web Search",
      desc: "Fetch live web docs, URLs, and search queries",
      icon: Globe,
      color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
      action: () => {
        onOpenBrowserTool();
        setIsOpen(false);
      },
    },
  ];

  return (
    <div className="relative inline-flex items-center" ref={menuRef}>
      {/* Hidden File Input for Media Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        multiple
        className="hidden"
      />

      {/* Plus Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d] transition flex items-center justify-center cursor-pointer"
        title="Add context (Media, Mentions, Actions, Browser)"
      >
        <Plus className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? "rotate-45 text-[#58a6ff]" : ""}`} />
      </button>

      {/* Dropup Menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-64 p-1.5 bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-150 select-none">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider border-b border-[#30363d]">
            Add Context to Prompt
          </div>

          <div className="space-y-0.5 pt-1">
            {contextOptions.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={opt.action}
                  className="w-full flex items-start space-x-2.5 p-2 rounded-xl hover:bg-[#21262d] transition text-left group"
                >
                  <div className={`p-1.5 rounded-lg border flex-shrink-0 mt-0.5 ${opt.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 truncate">
                    <div className="font-semibold text-white text-xs group-hover:text-[#58a6ff] transition">
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-[#8b949e] truncate leading-tight">
                      {opt.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
