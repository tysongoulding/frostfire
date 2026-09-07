import React, { useState, useMemo, useRef } from "react";
import { MessageItem as MessageItemType } from "../../store/sessionStore";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolActionCard } from "../cards/ToolActionCard";
import { CodeBlock } from "./CodeBlock";
import { MermaidViewer } from "../diagrams/MermaidViewer";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  Copy,
  Check,
  Info,
  Lightbulb,
  AlertTriangle,
  Flame,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";
import { useToastStore } from "../../store/toastStore";
import { invoke } from "@tauri-apps/api/core";

interface WebSource {
  index: number;
  title: string;
  url: string;
}

function parseWebSources(content: string): Map<number, WebSource> {
  const map = new Map<number, WebSource>();
  const numberedRegex = /(?:^|\n)\s*(\d+)\.\s*(?:\*\*)?\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)(?:\*\*)?/g;
  let match;
  while ((match = numberedRegex.exec(content)) !== null) {
    const idx = parseInt(match[1], 10);
    map.set(idx, {
      index: idx,
      title: match[2].trim(),
      url: match[3].trim(),
    });
  }

  if (map.size === 0) {
    const bulletRegex = /(?:^|\n)\s*[-*]\s*(?:\*\*)?\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)(?:\*\*)?/g;
    let bulletIdx = 1;
    while ((match = bulletRegex.exec(content)) !== null) {
      map.set(bulletIdx, {
        index: bulletIdx,
        title: match[1].trim(),
        url: match[2].trim(),
      });
      bulletIdx++;
    }
  }
  return map;
}

function preprocessCitations(text: string): string {
  const codeRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;
  const parts = text.split(codeRegex);

  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        return part;
      }
      return part.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (_match, group) => {
        const nums = group
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
        return nums.map((n: string) => `[${n}](frostfire-cite:${n})`).join(" ");
      });
    })
    .join("");
}

function cleanDisplayUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const domain = u.hostname.replace(/^www\./, "");
    const path = u.pathname.length > 24 ? u.pathname.substring(0, 24) + "…" : u.pathname;
    return domain + (path !== "/" ? path : "");
  } catch {
    return rawUrl.length > 32 ? rawUrl.substring(0, 32) + "…" : rawUrl;
  }
}

function extractCitationNumber(children: React.ReactNode, href?: string): number | null {
  if (href?.startsWith("frostfire-cite:")) {
    const parsed = parseInt(href.replace("frostfire-cite:", ""), 10);
    if (!isNaN(parsed)) return parsed;
  }
  const getText = (node: React.ReactNode): string => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(getText).join("");
    if (React.isValidElement(node) && node.props && typeof node.props === "object") {
      const props = node.props as { children?: React.ReactNode };
      return getText(props.children);
    }
    return "";
  };
  const text = getText(children).trim();
  const match = /^\[?(\d+)\]?$/.exec(text);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

interface FootnoteBadgeProps {
  number: number;
  url?: string;
  title?: string;
  onOpenUrl: (url: string) => void;
}

function FootnoteBadge({ number, url, title, onOpenUrl }: FootnoteBadgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timerRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 180);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (url) {
      onOpenUrl(url);
    }
  };

  return (
    <span
      className="relative inline-block align-baseline mx-0.5"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-mono font-semibold bg-[#161b22] text-[#58a6ff] border border-[#388bfd]/30 hover:bg-[#1f6feb] hover:text-white hover:border-[#58a6ff] transition-all shadow-xs cursor-pointer select-none -translate-y-0.5"
        title={title || url || `Source [${number}]`}
        aria-label={`Source citation ${number}`}
      >
        {number}
      </button>

      {isHovered && (
        <div
          onClick={handleClick}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 max-w-xs p-2.5 rounded-lg bg-[#161b22] border border-[#30363d] shadow-2xl z-50 text-left pointer-events-auto backdrop-blur-md cursor-pointer hover:border-[#58a6ff]/60 transition-colors"
        >
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex items-center space-x-1.5 min-w-0">
              <span className="flex items-center justify-center min-w-[15px] h-[15px] px-0.5 rounded-full bg-[#58a6ff]/20 text-[#58a6ff] text-[9px] font-mono font-bold shrink-0">
                {number}
              </span>
              <span className="text-[11px] font-medium text-white truncate leading-tight">
                {title || `Source [${number}]`}
              </span>
            </div>
            <ExternalLink className="w-3 h-3 text-[#58a6ff] shrink-0 mt-0.5" />
          </div>

          {url && (
            <div className="text-[10px] text-[#8b949e] hover:text-[#58a6ff] truncate mt-1 font-mono transition-colors">
              {cleanDisplayUrl(url)}
            </div>
          )}

          <div className="mt-2 pt-1.5 border-t border-[#30363d]/60 flex items-center justify-between text-[10px]">
            <span className="text-[9px] text-[#8b949e]">Click to open in browser</span>
            <span className="text-[#58a6ff] font-medium flex items-center space-x-0.5">
              <span>Visit</span>
              <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
            </span>
          </div>
        </div>
      )}
    </span>
  );
}

interface MessageItemProps {
  message: MessageItemType;
}

// GitHub Callout / Alert parser
function renderAlertCallout(text: string) {
  const noteMatch = text.match(/^\[!NOTE\]\s*([\s\S]*)/i);
  if (noteMatch) {
    return {
      type: "note",
      title: "Note",
      icon: Info,
      color: "border-blue-500 bg-blue-950/25 text-blue-200",
      iconColor: "text-blue-400",
      body: noteMatch[1],
    };
  }

  const tipMatch = text.match(/^\[!TIP\]\s*([\s\S]*)/i);
  if (tipMatch) {
    return {
      type: "tip",
      title: "Tip",
      icon: Lightbulb,
      color: "border-emerald-500 bg-emerald-950/25 text-emerald-200",
      iconColor: "text-emerald-400",
      body: tipMatch[1],
    };
  }

  const impMatch = text.match(/^\[!IMPORTANT\]\s*([\s\S]*)/i);
  if (impMatch) {
    return {
      type: "important",
      title: "Important",
      icon: Flame,
      color: "border-purple-500 bg-purple-950/25 text-purple-200",
      iconColor: "text-purple-400",
      body: impMatch[1],
    };
  }

  const warnMatch = text.match(/^\[!WARNING\]\s*([\s\S]*)/i);
  if (warnMatch) {
    return {
      type: "warning",
      title: "Warning",
      icon: AlertTriangle,
      color: "border-amber-500 bg-amber-950/25 text-amber-200",
      iconColor: "text-amber-400",
      body: warnMatch[1],
    };
  }

  const cautionMatch = text.match(/^\[!CAUTION\]\s*([\s\S]*)/i);
  if (cautionMatch) {
    return {
      type: "caution",
      title: "Caution",
      icon: ShieldAlert,
      color: "border-red-500 bg-red-950/25 text-red-200",
      iconColor: "text-red-400",
      body: cautionMatch[1],
    };
  }

  return null;
}

export const MessageItem = React.memo(function MessageItem({ message }: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const { addToast } = useToastStore();

  const sourcesMap = useMemo(() => {
    return parseWebSources(message.content || "");
  }, [message.content]);

  const processedContent = useMemo(() => {
    if (!message.content) return "";
    return preprocessCitations(message.content);
  }, [message.content]);

  const handleOpenUrl = (url?: string) => {
    if (!url) return;
    invoke("open_external_url", { url }).catch(() => {
      window.open(url, "_blank");
    });
  };

  const handleCopy = async () => {
    try {
      const textToCopy = message.content || message.reasoning || "";
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      addToast("Copied to clipboard", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast("Failed to copy text", "error");
    }
  };

  // User prompt: Single bubble with no user or icon
  if (message.role === "user") {
    return (
      <div className="flex justify-end my-3 group">
        <div className="relative bg-[#21262d] border border-[#30363d]/80 text-[#f0f6fc] px-4 py-2.5 rounded-2xl max-w-[80%] text-xs md:text-sm whitespace-pre-wrap leading-relaxed shadow-xs select-text">
          {message.content}
          <button
            type="button"
            onClick={handleCopy}
            className="absolute -left-7 top-2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-white transition"
            title="Copy message"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  }

  // Tool call cards
  if (message.role === "tool" && message.toolCall) {
    return (
      <div className="my-2 max-w-full">
        <ToolActionCard toolCall={message.toolCall} />
      </div>
    );
  }

  // System alerts
  if (message.role === "system") {
    return (
      <div className="my-2 p-2.5 rounded-lg bg-red-950/30 border border-red-900/50 text-red-300 text-xs font-mono select-text">
        {message.content}
      </div>
    );
  }

  const isGenerating = !message.content && !!message.reasoning;

  // AI response: Responds directly to the flat back of the screen
  return (
    <div className="flex flex-col justify-start my-4 w-full max-w-full min-w-0 group select-text">
      {message.reasoning && <ThinkingBlock reasoning={message.reasoning} />}

      {message.content ? (
        <div className="markdown-content text-[#c9d1d9] text-xs md:text-sm leading-relaxed w-full max-w-full min-w-0 break-words">
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              h1({ children }) {
                return (
                  <h1 className="text-lg font-bold text-white border-b border-[#30363d] pb-1.5 mt-5 mb-2.5 flex items-center space-x-2">
                    <span>{children}</span>
                  </h1>
                );
              },
              h2({ children }) {
                return (
                  <h2 className="text-base font-semibold text-white border-b border-[#30363d]/60 pb-1 mt-4 mb-2">
                    {children}
                  </h2>
                );
              },
              h3({ children }) {
                return <h3 className="text-sm font-semibold text-[#58a6ff] mt-3.5 mb-1.5">{children}</h3>;
              },
              h4({ children }) {
                return <h4 className="text-xs font-semibold text-purple-300 mt-2.5 mb-1 uppercase tracking-wider">{children}</h4>;
              },
              blockquote({ children }) {
                const extractText = (node: React.ReactNode): string => {
                  if (typeof node === "string" || typeof node === "number") return String(node);
                  if (Array.isArray(node)) return node.map(extractText).join("");
                  if (React.isValidElement(node) && node.props && typeof node.props === "object") {
                    const props = node.props as { children?: React.ReactNode };
                    return extractText(props.children);
                  }
                  return "";
                };

                const rawText = extractText(children);
                const alert = renderAlertCallout(rawText);
                if (alert) {
                  const Icon = alert.icon;
                  return (
                    <div className={`my-3 p-3 rounded-xl border-l-4 ${alert.color} shadow-xs space-y-1 select-text`}>
                      <div className="flex items-center space-x-2 font-semibold text-xs uppercase tracking-wide">
                        <Icon className={`w-3.5 h-3.5 ${alert.iconColor}`} />
                        <span>{alert.title}</span>
                      </div>
                      <div className="text-xs pl-5 text-[#c9d1d9] leading-relaxed">{alert.body}</div>
                    </div>
                  );
                }

                return (
                  <blockquote className="border-l-2 border-[#58a6ff]/70 bg-[#161b22]/40 pl-3 py-1.5 rounded-r my-2.5 text-[#8b949e] italic text-xs">
                    {children}
                  </blockquote>
                );
              },
              table({ children }) {
                return (
                  <div className="my-3 overflow-x-auto rounded-lg border border-[#30363d] bg-[#0d1117] select-text">
                    <table className="w-full text-left border-collapse text-xs">{children}</table>
                  </div>
                );
              },
              thead({ children }) {
                return <thead className="bg-[#161b22] text-white border-b border-[#30363d]">{children}</thead>;
              },
              tbody({ children }) {
                return <tbody className="divide-y divide-[#30363d]/50 bg-[#0d1117]">{children}</tbody>;
              },
              th({ children }) {
                return <th className="p-2.5 font-semibold text-[#8b949e] uppercase text-[10px] tracking-wider">{children}</th>;
              },
              td({ children }) {
                return <td className="p-2.5 text-[#c9d1d9]">{children}</td>;
              },
              tr({ children }) {
                return <tr className="hover:bg-[#161b22]/30 transition-colors">{children}</tr>;
              },
              a({ href, children }) {
                const citationNum = extractCitationNumber(children, href);
                if (citationNum !== null) {
                  const source = sourcesMap.get(citationNum);
                  const targetUrl = source?.url || (href && !href.startsWith("frostfire-cite:") ? href : undefined);
                  const targetTitle = source?.title;
                  return (
                    <FootnoteBadge
                      number={citationNum}
                      url={targetUrl}
                      title={targetTitle}
                      onOpenUrl={handleOpenUrl}
                    />
                  );
                }

                return (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      handleOpenUrl(href);
                    }}
                    title={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#58a6ff] hover:text-[#79c0ff] underline inline-flex items-center space-x-0.5 cursor-pointer font-medium"
                  >
                    <span>{children}</span>
                    <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-70 shrink-0" />
                  </a>
                );
              },
              ul({ children }) {
                return <ul className="list-disc pl-5 my-2 space-y-1 text-[#c9d1d9]">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal pl-5 my-2 space-y-1.5 text-[#c9d1d9]">{children}</ol>;
              },
              li({ children }) {
                return <li className="leading-relaxed">{children}</li>;
              },
              input({ type, checked, disabled }) {
                if (type === "checkbox") {
                  return (
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      readOnly
                      className="rounded border-[#30363d] bg-[#161b22] text-[#58a6ff] focus:ring-0 mr-2 align-middle cursor-default"
                    />
                  );
                }
                return <input type={type} />;
              },
              hr() {
                return <hr className="my-4 border-[#30363d]" />;
              },
              code({ className, children }) {
                const match = /language-(\w+)/.exec(className || "");
                const lang = match ? match[1].toLowerCase() : "text";
                const isInline = !match && !String(children).includes("\n");
                const codeString = String(children).replace(/\n$/, "");

                if (!isInline && lang === "mermaid") {
                  return (
                    <div className="my-3 w-full max-w-full min-w-0 overflow-hidden">
                      <MermaidViewer code={codeString} />
                    </div>
                  );
                }

                return (
                  <CodeBlock
                    inline={isInline}
                    language={lang}
                    code={codeString}
                  />
                );
              },
            }}
          >
            {processedContent}
          </Markdown>
        </div>
      ) : isGenerating ? (
        <div className="flex items-center space-x-2 text-[#8b949e] py-2 text-xs font-mono animate-pulse">
          <span className="w-2 h-2 rounded-full bg-[#58a6ff] animate-ping" />
          <span>Synthesizing response...</span>
        </div>
      ) : null}

      {/* Subtle action bar below response */}
      {message.content && (
        <div className="flex items-center space-x-2 mt-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity select-none">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#161b22] border border-transparent hover:border-[#30363d] transition"
            title="Copy response"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
});

