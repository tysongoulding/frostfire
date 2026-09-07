import { useState, useEffect } from "react";
import { highlightCode } from "../../lib/highlighter";
import { Copy, Check, Terminal } from "lucide-react";
import { MermaidViewer } from "../diagrams/MermaidViewer";

interface CodeBlockProps {
  code: string;
  language?: string;
  inline?: boolean;
}

export function CodeBlock({ code, language = "text", inline = false }: CodeBlockProps) {
  if (!inline && language.toLowerCase() === "mermaid") {
    return <MermaidViewer code={code} />;
  }

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
      <code className="bg-[#161b22] text-[#58a6ff] border border-[#30363d] px-1.5 py-0.5 rounded font-mono text-[11px]">
        {code}
      </code>
    );
  }

  return (
    <div className="relative my-3 rounded-xl border border-[#30363d] bg-[#0d1117] overflow-hidden text-xs font-mono shadow-sm group">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] select-none text-[11px] text-[#8b949e]">
        <div className="flex items-center space-x-1.5">
          <Terminal className="w-3.5 h-3.5 text-[#58a6ff]" />
          <span className="font-semibold text-white uppercase tracking-wider">{language}</span>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] hover:text-white transition"
          title="Copy Code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-400" />
              <span className="text-green-400 text-[10px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span className="text-[10px]">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content Area */}
      <div className="p-3 overflow-x-auto text-[12px] leading-relaxed">
        {highlightedHtml ? (
          <div
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            className="[&>pre]:!bg-transparent [&>pre]:!p-0 [&>pre]:!m-0"
          />
        ) : (
          <pre className="text-[#c9d1d9] font-mono">{code}</pre>
        )}
      </div>
    </div>
  );
}
