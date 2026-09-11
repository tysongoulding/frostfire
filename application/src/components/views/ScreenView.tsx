import React, { useState, useEffect } from 'react';
import {
  Globe,
  Folder,
  Terminal,
  ArrowUp,
  MessageSquare,
  RotateCw,
  ArrowLeft,
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
        body: JSON.stringify({ display: displayNumber, command: cmd, cwd: '/workspace', background: true }),
      });
      // Trigger iframe reload after 350ms so window is instantly visible
      setTimeout(() => setStreamEpoch((e) => e + 1), 350);
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
      setTimeout(() => setStreamEpoch((e) => e + 1), 350);
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
    <div className="flex-1 flex flex-col h-full w-full bg-black relative overflow-hidden select-none">
      {/* Top Left Exit Button to return to Chat */}
      <div className="absolute top-4 left-4 z-30">
        <button
          onClick={onSwitchToChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/80 shadow-lg backdrop-blur-sm text-xs font-medium transition-all cursor-pointer group"
          title="Exit to Chat"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white transition-colors" />
          <span>Exit to Chat</span>
        </button>
      </div>

      {/* Live Desktop Viewport taking up dynamic workspace with Fixed 16:10 aspect ratio and zero scrollbars */}
      <div className="flex-1 w-full h-full min-h-0 min-w-0 relative overflow-hidden bg-black flex items-center justify-center p-2 sm:p-3">
        <div className="w-full h-full max-w-full max-h-full aspect-[16/10] bg-black rounded-xl overflow-hidden shadow-2xl border border-zinc-800/80 flex items-center justify-center">
          <iframe
            key={`${vncUrl}-${streamEpoch}`}
            src={vncUrl}
            title={`${agentName}'s Live Display`}
            className="w-full h-full border-none block overflow-hidden"
            scrolling="no"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="clipboard-read; clipboard-write; autoplay; fullscreen"
          />
        </div>
      </div>

      {/* Bottom Buttons Bar / Dock */}
      <div className="h-14 bg-zinc-950/95 border-t border-zinc-800 px-3 sm:px-5 flex items-center justify-between relative shrink-0 z-20">
        {/* Left balance badge with active VM host and port */}
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
            {vmHost}:{agentPort}
          </span>
        </div>

        {/* Center: Center-aligned Dock Controls */}
        <div className="flex items-center justify-center gap-1.5 sm:gap-2 flex-1 max-w-3xl mx-auto min-w-0">
          {/* App launch buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={() => handleLaunchApp('browser')}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
              title="Launch Google Chrome on Cloud Display"
            >
              <Globe className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Chrome</span>
            </button>

            <button
              onClick={() => handleLaunchApp('files')}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
              title="Launch Filesystem Manager (Thunar)"
            >
              <Folder className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="hidden sm:inline">Files</span>
            </button>

            <button
              onClick={() => handleLaunchApp('terminal')}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
              title="Launch XFCE Terminal"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="hidden sm:inline">Terminal</span>
            </button>
          </div>

          {/* Quick Command Prompt */}
          <form onSubmit={handleQuickSubmit} className="flex items-center gap-1.5 flex-1 max-w-sm sm:max-w-md min-w-0">
            <input
              type="text"
              value={quickCmd}
              onChange={(e) => setQuickCmd(e.target.value)}
              placeholder={`Instruct ${agentName} (Display :${displayNumber})...`}
              className="flex-1 bg-zinc-900 border border-zinc-800 focus:border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none transition-colors min-w-0"
            />
            <button
              type="submit"
              disabled={!quickCmd.trim()}
              className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors cursor-pointer shrink-0"
              title="Execute command"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Return to Chat */}
          <button
            onClick={onSwitchToChat}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer shrink-0"
            title="Switch back to Chat view"
          >
            <MessageSquare className="w-3.5 h-3.5 text-theme-accent-primary shrink-0" />
            <span className="hidden sm:inline">Chat</span>
          </button>
        </div>

        {/* Right: Reconnect Stream Button */}
        <div className="flex items-center justify-end gap-1.5 shrink-0 w-24">
          <button
            onClick={() => setStreamEpoch((e) => e + 1)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
            title="Reconnect / Refresh Screen Stream"
          >
            <RotateCw className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="hidden sm:inline">Reconnect</span>
          </button>
        </div>
      </div>
    </div>
  );
};
