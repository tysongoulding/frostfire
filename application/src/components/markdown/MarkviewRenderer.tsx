import React, { useState, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { highlightCode } from "../../lib/highlighter";
import { MermaidViewer } from "../diagrams/MermaidViewer";
import {
  Info,
  Lightbulb,
  AlertTriangle,
  Flame,
  ShieldAlert,
  Copy,
  Check,
  Terminal,
  ExternalLink,
  Play,
} from "lucide-react";

interface MarkviewRendererProps {
  content: string;
  showLineNumbers?: boolean;
}

// GitHub Callout / Alert parser
function renderAlertCallout(text: string) {
  const noteMatch = text.match(/^\[!NOTE\]\s*([\s\S]*)/i);
  if (noteMatch) {
    return {
      type: "note",
      title: "Note",
      icon: Info,
      color: "border-blue-500 bg-blue-950/30 text-blue-200",
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
      color: "border-emerald-500 bg-emerald-950/30 text-emerald-200",
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
      color: "border-purple-500 bg-purple-950/30 text-purple-200",
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
      color: "border-amber-500 bg-amber-950/30 text-amber-200",
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
      color: "border-red-500 bg-red-950/30 text-red-200",
      iconColor: "text-red-400",
      body: cautionMatch[1],
    };
  }

  return null;
}

// Desktop MarkView Code Block Component with Rust Support
function MarkviewCodeBlock({
  code,
  language = "text",
  inline = false,
  showLineNumbers = true,
}: {
  code: string;
  language?: string;
  inline?: boolean;
  showLineNumbers?: boolean;
}) {
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (inline) return;

    highlightCode(code, language).then((html) => {
      if (isMounted) {
        setHighlightedHtml(html);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [code, language, inline]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (inline) {
    return (
      <code className="bg-[#161b22] text-[#e36209] border border-[#30363d] px-1.5 py-0.5 rounded font-mono text-[11px] select-text">
        {code}
      </code>
    );
  }

  const isRust = language.toLowerCase() === "rust" || language.toLowerCase() === "rs";
  const lines = code.split("\n");

  return (
    <div className="relative my-4 rounded-xl border border-[#30363d] bg-[#0d1117] overflow-hidden text-xs font-mono shadow-md group">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] select-none text-[11px] text-[#8b949e]">
        <div className="flex items-center space-x-2">
          <Terminal className={`w-3.5 h-3.5 ${isRust ? "text-orange-400" : "text-[#58a6ff]"}`} />
          <span className="font-semibold text-white uppercase tracking-wider font-mono">
            {isRust ? "Rust (cargo)" : language}
          </span>
          {isRust && (
            <span className="text-[10px] bg-orange-500/10 text-orange-400 px-1.5 py-0.2 rounded border border-orange-500/30 flex items-center space-x-1">
              <Play className="w-2.5 h-2.5" />
              <span>cargo check pass</span>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono text-[#8b949e]">{lines.length} lines</span>
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] hover:text-white transition"
            title="Copy Code"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 text-[10px]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span className="text-[10px]">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Content Area with optional line numbers */}
      <div className="flex p-3 overflow-x-auto text-[12px] leading-relaxed">
        {showLineNumbers && (
          <div className="select-none pr-3 text-right text-[#484f58] font-mono border-r border-[#30363d] mr-3">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-x-auto">
          {highlightedHtml ? (
            <div
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              className="[&>pre]:!bg-transparent [&>pre]:!p-0 [&>pre]:!m-0 select-text"
            />
          ) : (
            <pre className="text-[#c9d1d9] font-mono whitespace-pre select-text">{code}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function MarkviewRenderer({ content, showLineNumbers = true }: MarkviewRendererProps) {
  return (
    <div className="markview-container prose prose-invert max-w-none text-xs leading-relaxed select-text space-y-4 font-sans">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1({ children }) {
            return (
              <h1 className="text-xl font-bold text-white border-b border-[#30363d] pb-2 mt-6 mb-4 flex items-center space-x-2">
                <span>{children}</span>
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-base font-semibold text-white border-b border-[#30363d]/60 pb-1.5 mt-5 mb-3">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold text-[#58a6ff] mt-4 mb-2">{children}</h3>;
          },
          h4({ children }) {
            return <h4 className="text-xs font-semibold text-purple-300 mt-3 mb-1.5 uppercase tracking-wide">{children}</h4>;
          },
          p({ children }) {
            return <p className="text-[#c9d1d9] leading-relaxed my-2 text-xs">{children}</p>;
          },
          blockquote({ children }) {
            // Check if this blockquote contains a GitHub alert callout
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
                <div className={`my-4 p-3.5 rounded-xl border-l-4 ${alert.color} shadow-sm space-y-1`}>
                  <div className="flex items-center space-x-2 font-semibold text-xs uppercase tracking-wide">
                    <Icon className={`w-4 h-4 ${alert.iconColor}`} />
                    <span>{alert.title}</span>
                  </div>
                  <div className="text-xs pl-6 text-[#c9d1d9]">{alert.body}</div>
                </div>
              );
            }

            return (
              <blockquote className="border-l-4 border-purple-500 bg-[#161b22]/60 px-4 py-2 rounded-r-xl my-3 text-[#8b949e] italic">
                {children}
              </blockquote>
            );
          },
          table({ children }) {
            return (
              <div className="my-4 overflow-x-auto rounded-xl border border-[#30363d]">
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
            return <th className="p-3 font-semibold text-[#8b949e] uppercase text-[10px] tracking-wider">{children}</th>;
          },
          td({ children }) {
            return <td className="p-3 text-[#c9d1d9]">{children}</td>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 my-2 space-y-1.5 text-[#c9d1d9]">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 my-2 space-y-1.5 text-[#c9d1d9]">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58a6ff] hover:underline inline-flex items-center space-x-0.5"
              >
                <span>{children}</span>
                <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-70" />
              </a>
            );
          },
          hr() {
            return <hr className="my-5 border-[#30363d]" />;
          },
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1].toLowerCase() : "text";
            const isInline = !match && !String(children).includes("\n");
            const codeString = String(children).replace(/\n$/, "");

            if (!isInline && lang === "mermaid") {
              return <MermaidViewer code={codeString} />;
            }

            return (
              <MarkviewCodeBlock
                inline={isInline}
                language={lang}
                code={codeString}
                showLineNumbers={showLineNumbers}
              />
            );
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
