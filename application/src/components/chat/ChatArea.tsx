import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../../types';
import {
  Plus,
  Mic,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Loader2,
  Flame,
  Snowflake,
} from 'lucide-react';

interface ChatAreaProps {
  agentName: string;
  agentRole?: string;
  onBack?: () => void;
  showBackButton?: boolean;
  leftSidebarOpen?: boolean;
  rightPanelOpen?: boolean;
  messages?: ChatMessage[];
  isThinking?: boolean;
  onSendMessage?: (text: string) => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  agentName,
  agentRole = 'Executive Intelligence',
  onBack,
  showBackButton = false,
  leftSidebarOpen = true,
  rightPanelOpen = true,
  messages: externalMessages,
  isThinking = false,
  onSendMessage,
}) => {
  const messages = externalMessages && externalMessages.length > 0 ? externalMessages : [
    {
      id: 'msg-welcome',
      sender: 'ai' as const,
      text: `Hello! I am ${agentName} operating on Cloud ${agentRole}.\nYou can instruct me to run terminal commands, open browser tabs, inspect files, or verify system health.`,
      timestamp: 'Just now',
    },
  ];
  const [inputText, setInputText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sizing dynamic based on side panels, ensuring main stream is wider than the input box
  const bothPanelsClosed = !leftSidebarOpen && !rightPanelOpen;
  const onePanelClosed = (!leftSidebarOpen && rightPanelOpen) || (leftSidebarOpen && !rightPanelOpen);

  const streamWidthClass = bothPanelsClosed
    ? 'max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px] px-6 sm:px-12 lg:px-16'
    : onePanelClosed
    ? 'max-w-5xl xl:max-w-6xl px-4 sm:px-8 lg:px-12'
    : 'max-w-4xl xl:max-w-5xl px-4 sm:px-6 lg:px-8';

  const inputWidthClass = bothPanelsClosed
    ? 'max-w-3xl xl:max-w-4xl'
    : onePanelClosed
    ? 'max-w-2xl sm:max-w-3xl'
    : 'max-w-xl sm:max-w-2xl';

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
    setShowScrollBottom(!isAtBottom);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollBottom(false);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isThinking) return;

    const text = inputText.trim();
    setInputText('');
    onSendMessage?.(text);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-theme-bg relative overflow-hidden">
      {/* Mobile Back / Chat Header */}
      {showBackButton && (
        <div className="h-12 border-b border-theme-border px-3 flex items-center gap-2 bg-theme-surface sm:hidden">
          <button
            onClick={onBack}
            className="p-1 rounded-md text-theme-text-muted hover:text-theme-text-primary cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-xs text-theme-text-primary truncate">
              {agentName}
            </span>
            <span className="text-[10px] text-theme-text-muted truncate">
              {agentRole}
            </span>
          </div>
        </div>
      )}

      {/* Scrollable Container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden w-full max-w-full"
      >
        {/* Centered Message History Stream */}
        <div
          className={`py-6 space-y-7 mx-auto w-full max-w-full transition-all duration-300 ease-in-out ${streamWidthClass}`}
        >
          {messages.map((msg) => {
            const isAi = msg.sender === 'ai';

            if (isAi) {
              return (
                /* AI Message: Left-aligned, NO BUBBLE (Antigravity free-flow text) */
                <div key={msg.id} className="w-full max-w-full flex flex-col items-start space-y-2 group">
                  {/* Free-flowing AI body */}
                  <div className="w-full max-w-full text-xs sm:text-sm text-theme-text-primary leading-relaxed space-y-3 font-normal break-words [overflow-wrap:anywhere]">
                    {msg.text.split('\n\n').map((paragraph, i) => {
                      const isBullet = paragraph.trim().startsWith('•') || paragraph.trim().startsWith('-');
                      return (
                        <div key={i} className={isBullet ? 'pl-2 space-y-1' : ''}>
                          {paragraph.split('\n').map((line, li) => (
                            <p key={li} className="leading-relaxed break-words [overflow-wrap:anywhere]">
                              {line.split('`').map((chunk, ci) =>
                                ci % 2 === 1 ? (
                                  <code
                                    key={ci}
                                    className="bg-theme-surface px-1.5 py-0.5 rounded text-[11px] font-mono border border-theme-border text-theme-accent-primary break-all"
                                  >
                                    {chunk}
                                  </code>
                                ) : (
                                  chunk
                                )
                              )}
                            </p>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  {/* Antigravity Action Toolbar below AI message */}
                  <div className="flex items-center gap-1.5 pt-1 text-theme-text-muted">
                    <button
                      onClick={() => handleCopy(msg.id, msg.text)}
                      className="p-1 rounded hover:text-theme-text-primary hover:bg-theme-surface transition-colors cursor-pointer"
                      title="Copy message"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      className="p-1 rounded hover:text-theme-text-primary hover:bg-theme-surface transition-colors cursor-pointer"
                      title="Good response"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1 rounded hover:text-theme-text-primary hover:bg-theme-surface transition-colors cursor-pointer"
                      title="Bad response"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            }

            /* User Message: Left-aligned IN A BUBBLE */
            return (
              <div key={msg.id} className="w-full max-w-full flex flex-col items-start space-y-1">
                <div className="bg-theme-surface border border-theme-border rounded-2xl px-4 py-3 text-xs sm:text-sm text-theme-text-primary max-w-full sm:max-w-2xl shadow-xs leading-relaxed break-words [overflow-wrap:anywhere]">
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.text}</p>
                </div>
              </div>
            );
          })}

          {/* Live Execution / Thinking Indicator */}
          {isThinking && (
            <div className="w-full flex items-center gap-3 py-2.5 px-1">
              <div className="icon-morph-container">
                <Flame className="icon-flame w-4 h-4" />
                <Snowflake className="icon-snowflake w-4 h-4" />
              </div>
              <div className="flex items-center select-none font-mono text-sm tracking-wide font-bold">
                <span className="animate-frostfire-text">Working....</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Floating Jump to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute left-1/2 -translate-x-1/2 bottom-20 z-30 w-8 h-8 rounded-full bg-theme-surface border border-theme-border text-theme-text-muted hover:text-theme-text-primary shadow-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer"
          title="Jump to latest message"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Floating Bottom Input Bar */}
      <div className="p-3 sm:p-5 pt-0 w-full max-w-full">
        <form
          onSubmit={handleSend}
          className={`relative mx-auto flex items-center gap-2 bg-theme-surface border border-theme-border rounded-xl px-3 py-2 shadow-sm focus-within:border-theme-accent-primary transition-all duration-300 ease-in-out w-full max-w-full ${inputWidthClass}`}
        >
          {/* Add Attachment Button */}
          <button
            type="button"
            className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg transition-colors shrink-0 cursor-pointer"
            title="Attach file or action"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Input text */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Message ${agentName}`}
            className="flex-1 min-w-0 bg-transparent text-xs sm:text-sm text-theme-text-primary outline-none placeholder:text-theme-text-muted/60"
          />

          {/* Right Action: Mic or Send Button */}
          {inputText.trim() ? (
            <button
              type="submit"
              className="p-1.5 rounded-lg bg-theme-accent-primary text-black font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg transition-colors cursor-pointer"
              title="Voice input"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
