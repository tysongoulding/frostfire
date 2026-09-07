import React, { useEffect, useRef } from "react";

interface TypewriterStreamProps {
  content: string;
  isStreaming?: boolean;
}

export const TypewriterStream: React.FC<TypewriterStreamProps> = ({
  content,
  isStreaming = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div
      ref={containerRef}
      className="p-3 bg-slate-950/90 rounded-lg border border-slate-800 text-xs text-slate-300 font-mono max-h-40 overflow-y-auto leading-relaxed relative"
    >
      {content || <span className="text-slate-500 italic">Waiting for agent tokens...</span>}
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-emerald-400 ml-1 translate-y-0.5 animate-pulse" />
      )}
    </div>
  );
};
