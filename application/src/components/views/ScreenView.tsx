import React, { useState, useEffect } from 'react';
import {
  Globe,
  Folder,
  Terminal,
  ArrowUp,
  MessageSquare,
  RotateCw,
  ArrowLeft,
  Flame,
  Snowflake,
  X,
} from 'lucide-react';
import { getVncUrl, resolveVncSession, DEFAULT_EC2_HOST } from '../../lib/vnc';
import { useUserStore } from '../../store/userStore';

interface ScreenViewProps {
  agentName: string;
  agentRole?: string;
  agentId?: string;
  displayNumber?: number;
  vncPort?: number;
  vmHost?: string;
  execPort?: number;
  onSwitchToChat: () => void;
  onSendCommand?: (command: string) => void;
  userId?: string;
}

export const ScreenView: React.FC<ScreenViewProps> = ({
  agentName,
  agentRole: _agentRole,
  agentId,
  displayNumber: propDisplayNumber,
  vncPort: propVncPort,
  vmHost: propVmHost,
  execPort: propExecPort,
  onSwitchToChat,
  onSendCommand,
  userId: propUserId,
}) => {
  const { activeUserId, getActiveUser } = useUserStore();
  const currentUser = getActiveUser();
  const currentUserId = propUserId || currentUser?.id || activeUserId || 'default';
  const [quickCmd, setQuickCmd] = useState('');
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const displayNumber = propDisplayNumber ?? 1;
  const rawVmHost = propVmHost || currentUser?.vmHost || DEFAULT_EC2_HOST;
  const vmHost = (!rawVmHost || rawVmHost === '44.242.94.86') ? DEFAULT_EC2_HOST : rawVmHost;
  const execPort = propExecPort ?? (currentUser?.execPort || 1339);
  const [resolvedPort, setResolvedPort] = useState<number | undefined>(propVncPort);

  useEffect(() => {
    let mounted = true;
    resolveVncSession(currentUserId, displayNumber, undefined, vmHost, execPort).then((info) => {
      if (mounted && info.vncPort) {
        setResolvedPort(info.vncPort);
      }
    });
    return () => {
      mounted = false;
    };
  }, [currentUserId, displayNumber, vmHost, execPort]);

  const agentPort = propVncPort ?? resolvedPort ?? (6079 + displayNumber);

  const vncUrl = getVncUrl(displayNumber, {
    host: vmHost,
    port: agentPort,
    scale: 'fit',
  });

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1800);
    return () => clearTimeout(timer);
  }, [vncUrl, streamEpoch]);

  const handleLaunchApp = async (app: 'browser' | 'terminal' | 'files') => {
    const cmd =
      app === 'browser'
        ? "/usr/local/bin/chrome-launcher 'https://google.com' &"
        : app === 'terminal'
        ? '/usr/local/bin/terminal-launcher &'
        : '/usr/local/bin/files-launcher &';

    const isLambda = vmHost.includes('lambda-url') || vmHost.startsWith('https://');
    const baseUrl = isLambda
      ? (vmHost.startsWith('http') ? vmHost : `https://${vmHost}`).replace(/\/+$/, '')
      : `http://${vmHost}:${execPort}`;
    const execUrl = `${baseUrl}/api/exec`;

    // 1. Immediate direct HTTP dispatch to remote executor (15ms latency)
    try {
      await fetch(execUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display: displayNumber, command: cmd, cwd: '/home/ubuntu', background: true }),
      });
      return;
    } catch {}

    // 2. Tauri IPC backend invocation fallback
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('execute_remote_cloud_command', {
        command: cmd,
        display: displayNumber,
        vmHost,
        execPort,
      });
      return;
    } catch {}

    // 3. Agent turn fallback
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_agent_turn', {
        userId: currentUserId,
        displayNumber,
        prompt: app === 'browser' ? 'open chrome' : app === 'terminal' ? 'open terminal' : 'launch filesystem',
        vmHost,
        execPort,
      });
      setTimeout(() => setStreamEpoch((e) => e + 1), 500);
    } catch (e) {
      console.error('Failed to launch application:', e);
    }
  };

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCmd.trim()) return;
    const cmd = quickCmd.trim();
    setQuickCmd('');
    onSendCommand?.(cmd);
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-theme-bg relative overflow-hidden select-none font-sans">
      {/* Top Left Exit Button to return to Chat */}
      <div className="absolute top-4 left-4 z-30 pointer-events-auto">
        <button
          onClick={onSwitchToChat}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-surface/90 hover:bg-theme-surface text-theme-text-primary border border-theme-border shadow-lg backdrop-blur-md text-sm font-medium transition-all cursor-pointer group"
          title="Exit to Chat"
        >
          <ArrowLeft className="w-4 h-4 text-theme-text-muted group-hover:text-theme-text-primary transition-colors" />
          <span>Exit to Chat</span>
        </button>
      </div>

      {/* Main View Space: Takes up the entire mainview space edge-to-edge with the same background as chat */}
      <div className="flex-1 w-full h-full min-h-0 min-w-0 relative overflow-hidden bg-theme-bg flex items-center justify-center">
        {/* Center Screen Loading Indicator matching LLM Working style */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-theme-bg pointer-events-none transition-opacity duration-300">
            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-theme-surface/90 border border-theme-border shadow-2xl backdrop-blur-md">
              <div className="icon-morph-container">
                <Flame className="icon-flame w-4 h-4" />
                <Snowflake className="icon-snowflake w-4 h-4" />
              </div>
              <div className="flex items-center select-none font-mono text-sm sm:text-base tracking-wide font-bold">
                <span className="animate-frostfire-text">Loading....</span>
              </div>
            </div>
          </div>
        )}

        <iframe
          key={`${vncUrl}-${streamEpoch}`}
          src={vncUrl}
          title={`${agentName}'s Live Display`}
          className="w-full h-full border-none block overflow-hidden bg-transparent"
          scrolling="no"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allow="clipboard-read; clipboard-write; autoplay; fullscreen"
          onLoad={() => {
            setTimeout(() => setIsLoading(false), 500);
          }}
        />
      </div>

      {/* Bottom Buttons Bar / Dock */}
      <div className="h-16 bg-theme-surface/95 border-t border-theme-border px-3 sm:px-6 flex items-center justify-between relative shrink-0 z-20 font-sans">
        {/* Left balance spacer */}
        <div className="hidden sm:block shrink-0 w-24" />

        {/* Center: Center-aligned Dock Controls */}
        <div className="flex items-center justify-center gap-2 sm:gap-3 flex-1 max-w-3xl mx-auto min-w-0">
          {/* App launch buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleLaunchApp('browser')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-bg hover:bg-theme-surface border border-theme-border text-sm font-medium text-theme-text-primary transition-colors cursor-pointer"
              title="Launch Google Chrome on Cloud Display"
            >
              <Globe className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Chrome</span>
            </button>

            <button
              onClick={() => handleLaunchApp('files')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-bg hover:bg-theme-surface border border-theme-border text-sm font-medium text-theme-text-primary transition-colors cursor-pointer"
              title="Launch Filesystem Manager (Thunar)"
            >
              <Folder className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="hidden sm:inline">Files</span>
            </button>

            <button
              onClick={() => handleLaunchApp('terminal')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-bg hover:bg-theme-surface border border-theme-border text-sm font-medium text-theme-text-primary transition-colors cursor-pointer"
              title="Launch XFCE Terminal"
            >
              <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="hidden sm:inline">Terminal</span>
            </button>
          </div>

          {/* Quick Command Prompt */}
          <form onSubmit={handleQuickSubmit} className="flex items-center gap-2 flex-1 max-w-sm sm:max-w-md min-w-0">
            <input
              type="text"
              value={quickCmd}
              onChange={(e) => setQuickCmd(e.target.value)}
              placeholder={`Instruct ${agentName} (Display :${displayNumber})...`}
              className="flex-1 bg-theme-bg border border-theme-border focus:border-theme-accent-primary rounded-lg px-3.5 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted outline-none transition-colors min-w-0 font-sans"
            />
            <button
              type="submit"
              disabled={!quickCmd.trim()}
              className="p-2 rounded-lg bg-theme-accent-primary hover:opacity-90 disabled:opacity-40 text-white transition-colors cursor-pointer shrink-0"
              title="Execute command"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
