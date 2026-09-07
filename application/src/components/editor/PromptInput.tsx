import { useState, useRef, useEffect, useCallback } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useSubagentStore } from "../../store/subagentStore";
import { useUiStore } from "../../store/uiStore";
import { useToastStore } from "../../store/toastStore";
import { useRhoEngine } from "../../hooks/useRhoEngine";
import { useTurnQueue } from "../../hooks/useTurnQueue";
import { AutocompleteMenu } from "./AutocompleteMenu";
import { ContextRingGauge } from "./ContextRingGauge";
import { ContextWindowModal } from "../modals/ContextWindowModal";
import { AddContextDropup } from "./AddContextDropup";
import { AgentDropupPicker } from "./AgentDropupPicker";
import { ModelDropupPicker } from "./ModelDropupPicker";
import {
  Send,
  Square,
  FileCode,
  X,
  BarChart3,
  Mic,
  Globe,
} from "lucide-react";

interface PromptInputProps {
  placeholder?: string;
}

export function PromptInput({ placeholder }: PromptInputProps = {}) {
  const [text, setText] = useState("");
  const [isWebSearch, setIsWebSearch] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState("");
  const [showContextModal, setShowContextModal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isRunning, addUserMessage } = useSessionStore();
  const { attachedFiles, removeAttachedFile, clearAttachedFiles } = useWorkspaceStore();
  const { subagents, activeChatAgentId } = useSubagentStore();
  const { setActiveWorkbenchTab, setWorkbenchOpen, setIsTransitioningToChat } = useUiStore();
  const { addToast } = useToastStore();
  const { prompt, abort } = useRhoEngine();
  const { enqueue } = useTurnQueue();

  const activeAgent = subagents.find((a) => a.id === activeChatAgentId);

  // Auto-expand textarea height fluidly up to 180px as user types
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 32), 180)}px`;
    }
  }, [text]);

  const handleSend = useCallback(async () => {
    let content = text.trim();
    if (!content && attachedFiles.length === 0) return;

    if (attachedFiles.length > 0) {
      const fileTags = attachedFiles.map((f) => `@${f}`).join(" ");
      content = content ? `${fileTags}\n${content}` : fileTags;
    }

    if (isRunning) {
      enqueue(content);
      setText("");
      clearAttachedFiles();
      return;
    }

    if (messages.length === 0 && !activeAgent) {
      setIsTransitioningToChat(true);
      setTimeout(() => {
        setIsTransitioningToChat(false);
      }, 400);
    }

    setText("");
    clearAttachedFiles();
    setShowAutocomplete(false);
    addUserMessage(content);
    await prompt(content, isWebSearch);
  }, [text, attachedFiles, isRunning, enqueue, addUserMessage, prompt, clearAttachedFiles, isWebSearch, messages.length, activeAgent, setIsTransitioningToChat]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      if (showAutocomplete) {
        setShowAutocomplete(false);
      } else if (isRunning) {
        abort();
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPos);
    const triggerMatch = textBeforeCursor.match(/(?:^|\s)([@/][\w-./]*)$/);

    if (triggerMatch) {
      setShowAutocomplete(true);
      setAutocompleteFilter(triggerMatch[1]);
    } else {
      setShowAutocomplete(false);
    }
  };

  const handleInsertChar = (char: string) => {
    setText((prev) => `${prev}${prev.endsWith(" ") || prev === "" ? "" : " "}${char}`);
    if (char === "@" || char === "/") {
      setShowAutocomplete(true);
      setAutocompleteFilter(char);
    }
    textareaRef.current?.focus();
  };

  const handleOpenBrowserTool = () => {
    setIsWebSearch(true);
    addToast("Live Web Search enabled for this prompt", "info");
    textareaRef.current?.focus();
  };

  const handleOpenUsageWorkbench = () => {
    setActiveWorkbenchTab("usage");
    setWorkbenchOpen(true);
  };

  return (
    <div className="relative w-full">
      {/* Attached Files Pills */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2 px-1">
          {attachedFiles.map((file) => (
            <span
              key={file}
              className="flex items-center space-x-1.5 bg-[#18181b] border border-[#2e2e34] text-[#58a6ff] px-2.5 py-0.5 rounded-lg text-[11px] font-mono shadow-sm"
            >
              <FileCode className="w-3 h-3" />
              <span>{file}</span>
              <button
                onClick={() => removeAttachedFile(file)}
                className="hover:text-red-400 p-0.5 rounded transition"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Autocomplete Dropdown */}
      {showAutocomplete && (
        <AutocompleteMenu
          filter={autocompleteFilter}
          onSelect={(item) => {
            const updated = text.replace(/(?:^|\s)([@/][\w-./]*)$/, ` ${item.label} `);
            setText(updated.trimStart());
            setShowAutocomplete(false);
            textareaRef.current?.focus();
          }}
        />
      )}

      {/* Unified Compact Minimalist Prompt Card */}
      <div className="bg-[#18181b] border border-[#2e2e34] rounded-2xl py-2.5 px-3.5 focus-within:border-[#58a6ff]/70 shadow-2xl transition-all space-y-2">
        {/* Full-Width Top Input Textarea */}
        <div className="w-full">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || "Ask anything, @ to mention, / for actions"}
            className="w-full bg-transparent border-none resize-none outline-none text-xs md:text-sm text-[#e6edf3] placeholder-[#7d8590] min-h-[32px] max-h-48 py-1 px-1 leading-relaxed overflow-y-auto"
          />
        </div>

        {/* Bottom Toolbar Row */}
        <div className="flex items-center justify-between pt-1 text-xs text-[#8b949e]">
          {/* Left: Plus Context Dropup + Model Name ^ + Search + Usage */}
          <div className="flex items-center space-x-2">
            <AddContextDropup
              onInsertMention={handleInsertChar}
              onOpenBrowserTool={handleOpenBrowserTool}
            />

            <AgentDropupPicker />

            <ModelDropupPicker />

            {/* Web Search Toggle Button */}
            <button
              type="button"
              onClick={() => {
                setIsWebSearch((prev) => {
                  const next = !prev;
                  addToast(next ? "Live Web Search enabled" : "Live Web Search disabled", "info");
                  return next;
                });
              }}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer border ${
                isWebSearch
                  ? "bg-[#58a6ff]/15 text-[#58a6ff] border-[#58a6ff]/40 shadow-sm shadow-[#58a6ff]/10"
                  : "text-[#8b949e] hover:text-white hover:bg-[#27272a] border-transparent"
              }`}
              title={isWebSearch ? "Web Search active (live internet groundings & sources)" : "Toggle live web search (DuckDuckGo / Google Search)"}
            >
              <Globe className={`w-3 h-3 ${isWebSearch ? "text-[#58a6ff]" : "text-[#8b949e]"}`} />
              <span>Search</span>
              {isWebSearch && <span className="w-1.5 h-1.5 rounded-full bg-[#58a6ff] animate-pulse" />}
            </button>

            <button
              type="button"
              onClick={handleOpenUsageWorkbench}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-[#8b949e] hover:text-white hover:bg-[#27272a] transition cursor-pointer"
              title="Open Token Usage & Cost Ledger"
            >
              <BarChart3 className="w-3 h-3 text-emerald-400" />
              <span>Usage</span>
            </button>
          </div>

          {/* Right: Context Ring Gauge + Mic Voice + Red Stop / Send Button */}
          <div className="flex items-center space-x-2">
            <ContextRingGauge onClick={() => setShowContextModal(true)} />

            <button
              type="button"
              onClick={() => addToast("Voice dictation ready (web speech API)", "info")}
              className="p-1 rounded-md text-[#7d8590] hover:text-white hover:bg-[#27272a] transition cursor-pointer"
              title="Voice Input (Dictation)"
            >
              <Mic className="w-3.5 h-3.5" />
            </button>

            {isRunning ? (
              <button
                type="button"
                onClick={abort}
                className="w-7 h-7 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] flex items-center justify-center text-white transition shadow-sm border border-[#3f3f46]"
                title="Stop Generation (Esc)"
              >
                <div className="w-2.5 h-2.5 bg-red-500 rounded-sm" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!text.trim() && attachedFiles.length === 0}
                className="w-7 h-7 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-30 flex items-center justify-center text-white transition shadow-sm border border-[#3f3f46]"
                title="Send Message (Enter)"
              >
                <Send className="w-3.5 h-3.5 text-[#c9d1d9]" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Context Window Diagnostics Modal */}
      {showContextModal && (
        <ContextWindowModal onClose={() => setShowContextModal(false)} />
      )}
    </div>
  );
}
