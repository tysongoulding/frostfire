import React, { useState, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useUserStore } from '../../store/userStore';
import { ThemeName, ThemeMode } from '../../types';
import {
  X,
  Settings,
  Monitor,
  BarChart3,
  Sparkles,
  User,
  Copy,
  Check,
  Server,
  Globe,
  CheckCircle2,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'cloud_vm' | 'computer' | 'billing' | 'updates';

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { theme, mode, setTheme, setMode } = useTheme();
  const { users, activeUserId, updateUserVmConfig } = useUserStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [copied, setCopied] = useState(false);
  const [hwAcceleration, setHwAcceleration] = useState(true);
  const [autoReview, setAutoReview] = useState(false);
  const [autoUpdates, setAutoUpdates] = useState(false);
  const [computerName, setComputerName] = useState('goulding-pc');
  const [execPermission, setExecPermission] = useState('Always allow');

  const [selectedVmUser, setSelectedVmUser] = useState<string>(activeUserId || 'user1');
  const [targetVmHost, setTargetVmHost] = useState('');
  const [targetPort1, setTargetPort1] = useState<number>(6080);
  const [targetPort2, setTargetPort2] = useState<number>(6081);
  const [targetPort3, setTargetPort3] = useState<number>(6082);
  const [targetExecPort, setTargetExecPort] = useState<number>(3000);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    const u = users.find((x) => x.id === selectedVmUser) || users[0];
    if (u) {
      setTargetVmHost(u.vmHost || '44.242.94.86');
      setTargetPort1(u.agentPorts?.agent1 ?? 6080);
      setTargetPort2(u.agentPorts?.agent2 ?? 6081);
      setTargetPort3(u.agentPorts?.agent3 ?? 6082);
      setTargetExecPort(u.execPort ?? 3000);
    }
  }, [selectedVmUser, users, isOpen]);

  const handleSaveVmConfig = () => {
    updateUserVmConfig(selectedVmUser, {
      vmHost: targetVmHost.trim(),
      agentPorts: {
        agent1: Number(targetPort1),
        agent2: Number(targetPort2),
        agent3: Number(targetPort3),
      },
      execPort: Number(targetExecPort),
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  if (!isOpen) return null;

  const handleCopyEmail = () => {
    navigator.clipboard.writeText('tyson.goulding@optconnect.com');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-3xl bg-theme-surface border border-theme-border rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[560px] z-10 animate-in fade-in zoom-in-95">
        {/* Left Tabs Bar */}
        <aside className="w-full md:w-56 bg-theme-bg/60 border-b md:border-b-0 md:border-r border-theme-border p-3 flex md:flex-col justify-between shrink-0">
          <div className="space-y-1 w-full flex md:flex-col gap-1 md:gap-0 overflow-x-auto">
            <span className="hidden md:block text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider px-3 pb-2 pt-1">
              Preferences
            </span>

            {[
              { id: 'general', label: 'General', icon: <Settings className="w-4 h-4" /> },
              { id: 'cloud_vm', label: 'Cloud VM & Ports', icon: <Server className="w-4 h-4" /> },
              { id: 'computer', label: 'Computer', icon: <Monitor className="w-4 h-4" /> },
              { id: 'billing', label: 'Usage & Billing', icon: <BarChart3 className="w-4 h-4" /> },
              { id: 'updates', label: 'Updates', icon: <Sparkles className="w-4 h-4" /> },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as SettingsTab)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-theme-surface text-theme-text-primary border border-theme-border shadow-xs'
                      : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface/50'
                  }`}
                >
                  <span className={isActive ? 'text-theme-accent-primary' : 'text-theme-text-muted'}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="hidden md:block p-3 text-[10px] text-theme-text-muted">
            Frostfire OS v0.44.0
          </div>
        </aside>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col h-full bg-theme-surface overflow-hidden">
          {/* Header with Close */}
          <div className="h-12 px-6 border-b border-theme-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-theme-text-primary capitalize">
              {activeTab === 'billing' ? 'Usage & Billing' : activeTab === 'cloud_vm' ? 'Cloud VM & Ports' : activeTab}
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
            {/* 1. GENERAL TAB */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                {/* Account card */}
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Account
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-theme-accent-primary to-theme-accent-secondary flex items-center justify-center text-black font-bold shrink-0">
                        <User className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="block font-semibold text-sm text-theme-text-primary truncate">
                          Tyson Goulding
                        </span>
                        <div className="flex items-center gap-1.5 text-theme-text-muted">
                          <span className="truncate">tyson.goulding@optconnect.com</span>
                          <button
                            onClick={handleCopyEmail}
                            className="hover:text-theme-text-primary cursor-pointer"
                            title="Copy email"
                          >
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <button className="px-3.5 py-1.5 rounded-lg border border-theme-border bg-theme-surface text-theme-text-primary hover:bg-theme-bg font-medium text-xs cursor-pointer">
                      Sign Out
                    </button>
                  </div>
                </div>

                {/* Appearance */}
                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Appearance
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-theme-text-primary font-medium">Theme Palette</span>
                      <select
                        value={theme}
                        onChange={(e) => setTheme(e.target.value as ThemeName)}
                        className="bg-theme-surface border border-theme-border text-theme-text-primary px-3 py-1.5 rounded-lg outline-none focus:border-theme-accent-primary cursor-pointer"
                      >
                        <option value="frostfire">Default (Frostfire)</option>
                        <option value="frost">Frost (Blue Focus)</option>
                        <option value="fire">Fire (Red Focus)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-theme-text-primary font-medium">Mode</span>
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as ThemeMode)}
                        className="bg-theme-surface border border-theme-border text-theme-text-primary px-3 py-1.5 rounded-lg outline-none focus:border-theme-accent-primary cursor-pointer"
                      >
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="system">Follow System</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* System */}
                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    System
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-theme-text-primary font-medium">Microphone</span>
                      <select className="bg-theme-surface border border-theme-border text-theme-text-primary px-3 py-1.5 rounded-lg outline-none focus:border-theme-accent-primary cursor-pointer">
                        <option>System Default</option>
                        <option>High Definition Audio</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-theme-border">
                      <span className="text-theme-text-primary font-medium">Use hardware acceleration</span>
                      <button
                        type="button"
                        onClick={() => setHwAcceleration(!hwAcceleration)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                          hwAcceleration ? 'bg-theme-accent-primary' : 'bg-theme-surface border border-theme-border'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform ${
                            hwAcceleration ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bot */}
                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Bot
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-theme-text-primary font-medium">Timezone</span>
                      <select className="bg-theme-surface border border-theme-border text-theme-text-primary px-3 py-1.5 rounded-lg outline-none focus:border-theme-accent-primary cursor-pointer">
                        <option>Auto-detect (America/Denver)</option>
                        <option>UTC</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-theme-border">
                      <div className="space-y-0.5 max-w-[80%]">
                        <span className="text-theme-text-primary font-medium block">Auto-review</span>
                        <span className="text-[11px] text-theme-text-muted block">
                          Frostfire checks each action before it runs and asks you first when needed.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoReview(!autoReview)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                          autoReview ? 'bg-theme-accent-primary' : 'bg-theme-surface border border-theme-border'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform ${
                            autoReview ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. CLOUD VM & PORTS TAB */}
            {activeTab === 'cloud_vm' && (
              <div className="space-y-6">
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Per-User AWS VM & Agent Ports
                  </span>
                  <span className="text-[11px] text-theme-text-muted block">
                    Configure the dedicated AWS VM Host/IP and agent display ports for each user account.
                  </span>
                </div>

                {/* User selection buttons */}
                <div className="grid grid-cols-3 gap-2 p-1.5 rounded-xl border border-theme-border bg-theme-bg/50">
                  {users.slice(0, 3).map((u) => {
                    const isSel = u.id === selectedVmUser;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setSelectedVmUser(u.id)}
                        className={`py-2 px-3 rounded-lg text-left transition-all cursor-pointer ${
                          isSel
                            ? 'bg-theme-accent-primary text-black font-semibold shadow-xs'
                            : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface/70'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate block font-bold text-xs">{u.name}</span>
                          <span className={`text-[9px] font-mono uppercase ${isSel ? 'text-black/80' : 'text-theme-text-muted'}`}>
                            {u.id}
                          </span>
                        </div>
                        <span className={`text-[10px] block truncate ${isSel ? 'text-black/75' : 'text-theme-text-muted'}`}>
                          {u.vmHost || '44.242.94.86'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Configuration form for selected user */}
                <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 space-y-4">
                  <div className="space-y-1">
                    <label className="text-theme-text-primary font-medium block text-xs">
                      AWS VM Public IP / Host
                    </label>
                    <div className="relative">
                      <Globe className="w-3.5 h-3.5 absolute left-3 top-2.5 text-theme-text-muted" />
                      <input
                        type="text"
                        value={targetVmHost}
                        onChange={(e) => setTargetVmHost(e.target.value)}
                        placeholder="e.g. 44.242.94.86"
                        className="w-full pl-9 pr-3 py-1.5 bg-theme-surface border border-theme-border rounded-lg text-theme-text-primary font-mono text-xs outline-none focus:border-theme-accent-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-theme-border">
                    <div className="space-y-1">
                      <label className="text-theme-text-primary font-medium block text-xs">
                        Agent 1 Port (Disp :1)
                      </label>
                      <input
                        type="number"
                        value={targetPort1}
                        onChange={(e) => setTargetPort1(Number(e.target.value))}
                        className="w-full px-3 py-1.5 bg-theme-surface border border-theme-border rounded-lg text-theme-text-primary font-mono text-xs outline-none focus:border-theme-accent-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-theme-text-primary font-medium block text-xs">
                        Agent 2 Port (Disp :2)
                      </label>
                      <input
                        type="number"
                        value={targetPort2}
                        onChange={(e) => setTargetPort2(Number(e.target.value))}
                        className="w-full px-3 py-1.5 bg-theme-surface border border-theme-border rounded-lg text-theme-text-primary font-mono text-xs outline-none focus:border-theme-accent-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-theme-text-primary font-medium block text-xs">
                        Agent 3 Port (Disp :3)
                      </label>
                      <input
                        type="number"
                        value={targetPort3}
                        onChange={(e) => setTargetPort3(Number(e.target.value))}
                        className="w-full px-3 py-1.5 bg-theme-surface border border-theme-border rounded-lg text-theme-text-primary font-mono text-xs outline-none focus:border-theme-accent-primary"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 pt-2 border-t border-theme-border">
                    <label className="text-theme-text-primary font-medium block text-xs">
                      Remote Command API Exec Port
                    </label>
                    <input
                      type="number"
                      value={targetExecPort}
                      onChange={(e) => setTargetExecPort(Number(e.target.value))}
                      className="w-36 px-3 py-1.5 bg-theme-surface border border-theme-border rounded-lg text-theme-text-primary font-mono text-xs outline-none focus:border-theme-accent-primary"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-theme-border">
                    <div className="flex items-center gap-2">
                      {savedSuccess ? (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                          <CheckCircle2 className="w-4 h-4" />
                          Configuration Saved & Applied!
                        </span>
                      ) : (
                        <span className="text-[11px] text-theme-text-muted">
                          Saves and updates screen routing immediately for this user.
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveVmConfig}
                      className="px-4 py-1.5 rounded-lg bg-theme-accent-primary text-black font-semibold text-xs hover:opacity-90 active:scale-95 transition-all cursor-pointer shadow-xs"
                    >
                      Save VM Configuration
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 3. COMPUTER TAB */}
            {activeTab === 'computer' && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Computers
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 space-y-4">
                    <div className="space-y-1">
                      <span className="text-theme-text-primary font-medium block">Current computer</span>
                      <span className="text-[11px] text-theme-text-muted block">
                        This is the computer you are using now
                      </span>
                      <div className="flex gap-2 pt-1">
                        <input
                          type="text"
                          value={computerName}
                          onChange={(e) => setComputerName(e.target.value)}
                          className="flex-1 bg-theme-surface border border-theme-border px-3 py-1.5 rounded-lg text-theme-text-primary outline-none focus:border-theme-accent-primary"
                        />
                        <button className="px-3.5 py-1.5 rounded-lg border border-theme-border bg-theme-surface hover:bg-theme-bg text-theme-text-primary font-medium cursor-pointer">
                          Save
                        </button>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-theme-border space-y-2">
                      <span className="text-theme-text-primary font-medium block">Execution on this computer</span>
                      <span className="text-[11px] text-theme-text-muted block">
                        Let Frostfire open files and run tasks on your computer. Auto-review still checks everything first.
                      </span>
                      <select
                        value={execPermission}
                        onChange={(e) => setExecPermission(e.target.value)}
                        className="w-full bg-theme-surface border border-theme-border text-theme-text-primary px-3 py-2 rounded-lg outline-none focus:border-theme-accent-primary cursor-pointer mt-1"
                      >
                        <option>Always allow</option>
                        <option>Ask each time</option>
                        <option>Never allow</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3. USAGE & BILLING TAB */}
            {activeTab === 'billing' && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Usage
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex justify-between font-medium">
                        <span className="text-theme-text-primary">Weekly usage</span>
                        <span className="text-theme-text-primary font-mono">1%</span>
                      </div>
                      <div className="w-full bg-theme-surface h-1.5 rounded-full overflow-hidden border border-theme-border">
                        <div className="h-full bg-theme-accent-primary w-[1%]" />
                      </div>
                      <span className="text-[10px] text-theme-text-muted block">Resets in 6 days</span>
                    </div>

                    <div className="pt-3 border-t border-theme-border space-y-1">
                      <div className="flex justify-between font-medium">
                        <span className="text-theme-text-primary">On-demand usage</span>
                        <span className="text-theme-text-primary font-mono">$0</span>
                      </div>
                      <span className="text-[10px] text-theme-text-muted block">Resets in 13 days</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    On-Demand
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-theme-text-primary font-medium block">On-Demand</span>
                      <span className="text-[11px] text-theme-text-muted block">
                        On-demand spend is billed through Cursor. Manage the limit in the Cursor dashboard.
                      </span>
                    </div>
                    <button className="px-3 py-1.5 rounded-lg border border-theme-border bg-theme-surface hover:bg-theme-bg text-theme-text-primary shrink-0 font-medium text-xs cursor-pointer">
                      Open Cursor Dashboard
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Manage Plan
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 flex items-center justify-between gap-4">
                    <span className="text-theme-text-primary font-medium">Request Upgrade</span>
                    <button className="px-3.5 py-1.5 rounded-lg bg-theme-accent-primary text-black font-semibold hover:opacity-90 active:scale-95 text-xs cursor-pointer">
                      Request Upgrade
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. UPDATES TAB */}
            {activeTab === 'updates' && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Frostfire Updates
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="max-w-[70%]">
                        <span className="text-theme-text-primary font-medium block">Update Track</span>
                        <span className="text-[11px] text-theme-text-muted block">
                          Stable is the safe default. Other tracks ship new builds earlier and more often.
                        </span>
                      </div>
                      <select className="bg-theme-surface border border-theme-border text-theme-text-primary px-3 py-1.5 rounded-lg outline-none cursor-pointer">
                        <option>Stable</option>
                        <option>Beta</option>
                        <option>Nightly</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-theme-border">
                      <div className="max-w-[80%]">
                        <span className="text-theme-text-primary font-medium block">Automatic Updates</span>
                        <span className="text-[11px] text-theme-text-muted block">
                          Automatically update your client while you&apos;re away.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoUpdates(!autoUpdates)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                          autoUpdates ? 'bg-theme-accent-primary' : 'bg-theme-surface border border-theme-border'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform ${
                            autoUpdates ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-theme-border">
                      <div>
                        <span className="text-theme-text-primary font-medium block">Version 0.44.0</span>
                        <span className="text-[11px] text-theme-text-muted block">
                          Updates follow the Stable track. You&apos;re up to date.
                        </span>
                      </div>
                      <button className="px-3 py-1.5 rounded-lg border border-theme-border bg-theme-surface hover:bg-theme-bg text-theme-text-primary font-medium text-xs cursor-pointer">
                        Check for Updates
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider block">
                    Frostfire Computer
                  </span>
                  <div className="p-4 rounded-xl border border-theme-border bg-theme-bg/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="max-w-[75%]">
                        <span className="text-theme-text-primary font-medium block">Update Frostfire Computer</span>
                        <span className="text-[11px] text-theme-text-muted block">
                          Updates the computer your assistants share. Your files and logins stay, but installed apps are refreshed.
                        </span>
                      </div>
                      <button className="px-3.5 py-1.5 rounded-lg border border-theme-border bg-theme-surface hover:bg-theme-bg text-theme-text-primary font-medium text-xs cursor-pointer">
                        Update
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-theme-border">
                      <div className="max-w-[75%]">
                        <span className="text-theme-text-primary font-medium block">Reset Frostfire Computer</span>
                        <span className="text-[11px] text-theme-text-muted block">
                          Start fresh if the computer gets stuck. It&apos;s rebuilt from your last saved snapshot.
                        </span>
                      </div>
                      <button className="px-3.5 py-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 font-medium text-xs shadow-xs cursor-pointer">
                        Reset
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
