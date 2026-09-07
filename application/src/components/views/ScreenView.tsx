import React, { useState } from 'react';
import {
  Globe,
  Folder,
  Terminal,
  ArrowUp,
  MessageSquare,
  Radio,
  RotateCw,
} from 'lucide-react';
import { getVncUrl, DEFAULT_EC2_HOST } from '../../lib/vnc';
import { useUserStore } from '../../store/userStore';

interface ScreenViewProps {
  agentName: string;
  agentRole?: string;
  agentId?: string;
  onSwitchToChat: () => void;
  onSendCommand?: (command: string) => void;
  userId?: string;
}

export const ScreenView: React.FC<ScreenViewProps> = ({
  agentName,
  agentRole,
  agentId,
  onSwitchToChat,
  onSendCommand,
  userId: propUserId,
}) => {
  const { activeUserId, getActiveUser } = useUserStore();
  const currentUser = getActiveUser();
  const currentUserId = propUserId || currentUser.id || activeUserId || 'user1';
  const [quickCmd, setQuickCmd] = useState('');
  const [isTeaching, setIsTeaching] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);

  const userOffset = currentUserId === 'user2' ? 3 : currentUserId === 'user3' ? 6 : 0;
  const baseDisp = agentId === 'agent2'
    ? 2
    : agentId === 'agent3'
    ? 3
    : agentId === 'agent1'
    ? 1
    : (agentName.includes('2') || agentRole?.includes(':2') || agentRole?.includes(':5') || agentRole?.includes(':8'))
    ? 2
    : (agentName.includes('3') || agentRole?.includes(':3') || agentRole?.includes(':6') || agentRole?.includes(':9'))
    ? 3
    : 1;
  const displayNumber = userOffset + baseDisp;

  const agentKey: 'agent1' | 'agent2' | 'agent3' =
    baseDisp === 2 ? 'agent2' : baseDisp === 3 ? 'agent3' : 'agent1';
  const vmHost = currentUser.vmHost || DEFAULT_EC2_HOST;
  const defaultPorts: Record<'agent1' | 'agent2' | 'agent3', number> =
    currentUserId === 'user2'
      ? { agent1: 6083, agent2: 6084, agent3: 6085 }
      : currentUserId === 'user3'
      ? { agent1: 6086, agent2: 6087, agent3: 6088 }
      : { agent1: 6080, agent2: 6081, agent3: 6082 };
  const agentPort = currentUser.agentPorts?.[agentKey] || defaultPorts[agentKey];
  const execPort = currentUser.execPort || 3000;

  const vncUrl = getVncUrl(displayNumber, {
    host: vmHost,
    port: agentPort,
    scale: 'fit',
  });

  const handleLaunchApp = async (app: 'browser' | 'terminal' | 'files') => {
    const prompt =
      app === 'browser'
        ? 'open chrome'
        : app === 'terminal'
        ? 'open terminal'
        : 'launch filesystem';

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_agent_turn', {
        userId: currentUserId,
        displayNumber,
        prompt,
        vmHost,
        execPort,
      });
    } catch {
      const cmd =
        app === 'browser'
          ? "/usr/local/bin/chrome-launcher 'https://google.com' &"
          : app === 'terminal'
          ? '/usr/local/bin/terminal-launcher &'
          : '/usr/local/bin/files-launcher &';
      fetch(`http://${vmHost}:${execPort}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display: displayNumber, command: cmd, cwd: '/home/ubuntu', background: true }),
      }).catch(() => {});
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
      {/* Live Desktop Viewport taking up dynamic workspace with Fixed 16:10 aspect ratio and zero scrollbars */}
      <div className="flex-1 w-full h-full min-h-0 min-w-0 relative overflow-hidden bg-black flex items-center justify-center p-2 sm:p-3">
        <div className="w-full h-full max-w-full max-h-full aspect-[16/10] bg-black rounded-xl overflow-hidden shadow-2xl border border-zinc-800/80 flex items-center justify-center">
          <iframe
            key={`${vncUrl}-${streamEpoch}`}
            src={vncUrl}
            title={`${agentName}'s Live Display`}
            className="w-full h-full border-none block"
            sandbox="allow-scripts allow-same-origin"
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

            <button
              onClick={() => setIsTeaching((prev) => !prev)}
              className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                isTeaching
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                  : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
              }`}
              title={isTeaching ? 'Recording task demonstration...' : 'Teach a task to agent'}
            >
              <Radio className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>{isTeaching ? 'Recording...' : 'Teach Task'}</span>
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
