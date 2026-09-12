import React, { useState } from 'react';
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
} from 'lucide-react';
import { UsageBillingSettings } from '../settings/UsageBillingSettings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'computer' | 'billing' | 'updates';

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { theme, mode, setTheme, setMode } = useTheme();
  const { getActiveUser } = useUserStore();
  const activeUser = getActiveUser();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [copied, setCopied] = useState(false);
  const [hwAcceleration, setHwAcceleration] = useState(true);
  const [autoReview, setAutoReview] = useState(false);
  const [autoUpdates, setAutoUpdates] = useState(false);
  const [computerName, setComputerName] = useState('frostfire-node');
  const [execPermission, setExecPermission] = useState('Always allow');

  if (!isOpen) return null;

  const handleCopyEmail = () => {
    if (activeUser?.email) {
      navigator.clipboard.writeText(activeUser.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
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
              {activeTab === 'billing' ? 'Usage & Billing' : activeTab}
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
                          {activeUser?.name || 'Active User'}
                        </span>
                        <div className="flex items-center gap-1.5 text-theme-text-muted">
                          <span className="truncate">{activeUser?.email || 'user@frostfire.local'}</span>
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

            {/* 2. COMPUTER TAB */}
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
              <UsageBillingSettings />
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
