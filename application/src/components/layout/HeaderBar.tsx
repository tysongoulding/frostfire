import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { ActiveTab, DevicePreview } from '../../types';
import {
  Share2,
  Minus,
  Square,
  X,
  Bot,
  Users,
  PanelLeft,
  PanelRight,
  Flame,
  Snowflake,
} from 'lucide-react';
import {
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
} from '../../lib/windowControls';

interface HeaderBarProps {
  onToggleDrawer?: () => void;
  activeAgentName: string;
  agentRole?: string;
  isTeam?: boolean;
  onToggleLeftSidebar: () => void;
  leftSidebarOpen: boolean;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
  activeTab?: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  isWorking?: boolean;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  onToggleDrawer: _onToggleDrawer,
  activeAgentName,
  agentRole,
  isTeam = false,
  onToggleLeftSidebar,
  leftSidebarOpen,
  onToggleRightPanel,
  rightPanelOpen,
  activeTab: _activeTab = 'chat',
  onSelectTab: _onSelectTab,
  isWorking = false,
}) => {
  const { theme, devicePreview, setDevicePreview } = useTheme();
  const isFireTheme = theme === 'fire';
  const dotColor = isFireTheme ? 'bg-[#FF3366]' : 'bg-[#38BDF8]';
  const { isPhone, isTablet } = useBreakpoint();
  const isPhoneView = isPhone || devicePreview.startsWith('phone');
  const isTabletView = isTablet || devicePreview.startsWith('tablet');
  const isConstrainedView = isPhoneView || isTabletView;

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await minimizeWindow();
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleMaximizeWindow();
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await closeWindow();
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={toggleMaximizeWindow}
      className="w-full max-w-full border-b border-theme-border bg-theme-surface sticky top-0 z-30 select-none overflow-hidden"
    >
      <div className="w-full px-3 sm:px-4 h-11 flex items-center justify-between gap-2 sm:gap-3 text-xs relative overflow-hidden pointer-events-none">
        {/* Left: [Icon] Frostfire (desktop/fluid) + Left Panel Toggle + View Mode + POC User Switcher */}
        <div className="flex items-center gap-2 sm:gap-2.5 z-10 shrink-0 pointer-events-auto">
          {/* Logo & Title: [Icon] Frostfire (desktop & fluid only, hidden on tablet and phone) */}
          {!isConstrainedView && (
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-lg bg-gradient-to-tr from-theme-accent-primary to-theme-accent-secondary flex items-center justify-center text-black font-bold shadow-xs shrink-0">
                <Flame className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-black fill-current" />
              </div>
              <span className="font-bold text-xs sm:text-sm tracking-tight text-theme-text-primary">
                Frostfire
              </span>
            </div>
          )}

          {/* Left Sidebar Toggle Button */}
          <button
            onClick={onToggleLeftSidebar}
            className={`p-1.5 rounded-lg border border-theme-border transition-colors cursor-pointer ${
              leftSidebarOpen
                ? 'bg-theme-bg text-theme-accent-primary'
                : 'bg-theme-surface text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg'
            }`}
            title="Toggle left sidebar"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>

          {/* View Mode Dropdown (fluid page) */}
          {devicePreview === 'fluid' && !isConstrainedView && (
            <select
              value={devicePreview}
              onChange={(e) => setDevicePreview(e.target.value as DevicePreview)}
              className="bg-theme-bg text-theme-text-primary border border-theme-border px-1.5 sm:px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-medium outline-none cursor-pointer hover:border-theme-text-muted focus:border-theme-accent-primary transition-colors"
              title="Switch device preview"
            >
              <option value="fluid">View: Fluid</option>
              <option value="desktop-windows">Desktop-windows</option>
              <option value="desktop-linux">Desktop-Linux</option>
              <option value="desktop-mac">Desktop-mac</option>
              <option value="tablet-android">Tablet-android</option>
              <option value="tablet-ios">Tablet-iOS</option>
              <option value="phone-android">Phone-android</option>
              <option value="phone-ios">Phone-iOS</option>
            </select>
          )}
        </div>

        {/* Center: Center Aligned to the Chat - Name of the Agent / Team */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 sm:gap-2 z-0">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
              isTeam
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
            }`}
          >
            {isTeam ? <Users className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
          </div>
          <span className="font-semibold text-theme-text-primary text-xs sm:text-sm tracking-tight truncate max-w-[100px] xs:max-w-[140px] sm:max-w-[280px]">
            {activeAgentName}
          </span>
          {agentRole && !agentRole.toLowerCase().includes('display') && (
            <span className="hidden xs:inline-block text-[10px] text-theme-text-muted bg-theme-bg px-1.5 py-0.5 rounded border border-theme-border font-mono">
              {agentRole}
            </span>
          )}
          {/* Top Bar Status Indicator: Idle Green Dot -> Fire/Frost Shift when Actively Working */}
          {isWorking ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-theme-bg/80 border border-theme-border shadow-xs" title="Agent actively working in Cloud microVM">
              <div className="icon-morph-container w-3.5 h-3.5">
                <Flame className="icon-flame w-3.5 h-3.5" />
                <Snowflake className="icon-snowflake w-3.5 h-3.5" />
              </div>
              <span className="animate-frostfire-text font-mono font-bold text-[10px] tracking-wide">
                Working....
              </span>
            </div>
          ) : (
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor} theme-status-dot hidden sm:inline-block`} title="Ready" />
          )}
        </div>

        {/* Right: Share + Right Panel Toggle + Window Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 z-10 shrink-0 ml-auto pointer-events-auto">
          {/* Share Button */}
          <button
            className="flex items-center gap-1.5 px-2 py-1 sm:px-2.5 rounded-lg border border-theme-border bg-theme-surface hover:bg-theme-bg text-theme-text-primary hover:border-theme-text-muted text-[11px] font-medium transition-all shadow-xs active:scale-95 cursor-pointer"
            title="Share thread"
          >
            {!isPhoneView && <span className="hidden sm:inline">Share</span>}
            <Share2 className="w-3 h-3 text-theme-text-muted" />
          </button>

          {/* Right Panel Toggle Button */}
          <button
            onClick={onToggleRightPanel}
            className={`p-1.5 rounded-lg border border-theme-border transition-colors cursor-pointer ${
              rightPanelOpen
                ? 'bg-theme-bg text-theme-accent-primary'
                : 'bg-theme-surface text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg'
            }`}
            title="Toggle side panel (Screen & Workflows)"
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>

          {/* Window Controls (min/max/exit - hidden on phone and tablet) */}
          {!isConstrainedView && (
            <div className="hidden sm:flex items-center gap-1.5 text-theme-text-muted pl-1">
              <button onClick={handleMinimize} className="p-1 hover:text-theme-text-primary cursor-pointer" title="Minimize">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleMaximize} className="p-1 hover:text-theme-text-primary cursor-pointer" title="Maximize">
                <Square className="w-3 h-3" />
              </button>
              <button onClick={handleClose} className="p-1 hover:text-rose-400 cursor-pointer" title="Exit">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
