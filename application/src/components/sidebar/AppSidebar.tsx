import React, { useState, useMemo } from 'react';
import { ThreadList } from './ThreadList';
import { SidebarSection, SidebarItem } from '../../types';
import {
  Search,
  LayoutGrid,
  Sliders,
  ChevronUp,
  Bot,
  Users,
} from 'lucide-react';
import { useUserStore } from '../../store/userStore';

interface AppSidebarProps {
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  selectedThreadId: string;
  onSelectThread: (id: string) => void;
  onOpenMarketplace: () => void;
  onOpenSettings: () => void;
  onNewAgent?: () => void;
  onNewTeam?: () => void;
  teamMemberCounts?: Record<string, number>;
  sections?: SidebarSection[];
  items?: Record<string, SidebarItem>;
  onToggleCollapseSection?: (sectionId: string) => void;
  onReorderSections?: (draggedSectionId: string, targetSectionId: string) => void;
  onMoveItemToSection?: (itemId: string, targetSectionId: string) => void;
  onAddSection?: (title: string, id?: string) => void;
  onRenameSection?: (sectionId: string, newTitle: string) => void;
  onDeleteSection?: (sectionId: string) => void;
  onTogglePinItem?: (id: string) => void;
  onToggleUnreadItem?: (id: string) => void;
  onEditProfileItem?: (id: string) => void;
  onDuplicateItem?: (id: string) => void;
  onCopyConversationId?: (id: string) => void;
  onHideFromSidebar?: (id: string) => void;
  onDeleteItem?: (id: string) => void;
  userName?: string;
  userSubtitle?: string;
  isWorking?: boolean;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  selectedAgentId,
  onSelectAgent,
  selectedThreadId,
  onSelectThread,
  onOpenMarketplace,
  onOpenSettings,
  onNewAgent,
  onNewTeam,
  isWorking = false,
  teamMemberCounts: _teamMemberCounts,
  sections,
  items,
  onToggleCollapseSection,
  onReorderSections,
  onMoveItemToSection,
  onAddSection,
  onRenameSection,
  onDeleteSection,
  onTogglePinItem,
  onToggleUnreadItem,
  onEditProfileItem,
  onDuplicateItem,
  onCopyConversationId,
  onHideFromSidebar,
  onDeleteItem,
  userName = 'Default User',
  userSubtitle = 'Active',
}) => {
  const { users, activeUserId, switchUser, getActiveUser } = useUserStore();
  const currentProfile = getActiveUser();
  const activeName = currentProfile?.name || userName;
  const activeSubtitle = currentProfile?.role || userSubtitle;

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const displayItems = useMemo(() => {
    if (!items) return {};
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    const filtered: Record<string, SidebarItem> = {};
    Object.entries(items).forEach(([id, item]) => {
      if (
        item.title.toLowerCase().includes(q) ||
        item.roleTag?.toLowerCase().includes(q) ||
        item.preview?.toLowerCase().includes(q)
      ) {
        filtered[id] = item;
      }
    });
    return filtered;
  }, [items, searchQuery]);

  const activeInitials =
    activeName === 'User1'
      ? 'U1'
      : activeName === 'user2'
      ? 'U2'
      : activeName === 'user3'
      ? 'U3'
      : (activeName || 'U1')
          .split(' ')
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();

  return (
    <aside className="w-full bg-theme-surface flex flex-col h-full select-none relative overflow-hidden">
      {/* Action Buttons: New Agent & New Team */}
      <div className="p-3 pb-1 grid grid-cols-2 gap-2">
        <button
          onClick={onNewAgent}
          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-theme-bg border border-theme-border hover:border-theme-accent-primary text-theme-text-primary text-xs font-semibold hover:bg-theme-surface transition-all shadow-xs active:scale-95 cursor-pointer"
        >
          <Bot className="w-3.5 h-3.5 text-theme-accent-primary" />
          <span>New Agent</span>
        </button>

        <button
          onClick={onNewTeam}
          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-theme-bg border border-theme-border hover:border-theme-accent-secondary text-theme-text-primary text-xs font-semibold hover:bg-theme-surface transition-all shadow-xs active:scale-95 cursor-pointer"
        >
          <Users className="w-3.5 h-3.5 text-theme-accent-secondary" />
          <span>New Team</span>
        </button>
      </div>

      {/* Top Search Bar */}
      <div className="px-3 pb-2 pt-1">
        <div className="relative w-full">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents & teams..."
            className="w-full bg-theme-bg border border-theme-border text-theme-text-primary text-xs pl-8 pr-3 py-1.5 rounded-lg outline-none focus:border-theme-accent-primary placeholder:text-theme-text-muted/70 transition-colors"
          />
        </div>
      </div>

      {/* Dynamic Sections & Items List */}
      <ThreadList
        isWorking={isWorking}
        sections={sections || [
          { id: 'starred', title: 'Starred', isStarSection: true, isPinnedSection: true },
          { id: 'teams', title: 'Teams' },
          { id: 'agents', title: 'Agents' },
          { id: 'unassigned', title: 'Unassigned', isDefaultSection: true, isUnassignedSection: true },
        ]}
        items={displayItems}
        selectedItemId={selectedAgentId || selectedThreadId}
        onSelectItem={(id) => {
          onSelectAgent(id);
          onSelectThread(id);
        }}
        onToggleCollapseSection={onToggleCollapseSection || (() => {})}
        onReorderSections={onReorderSections || (() => {})}
        onMoveItemToSection={onMoveItemToSection || (() => {})}
        onAddSection={onAddSection || (() => {})}
        onRenameSection={onRenameSection}
        onDeleteSection={onDeleteSection}
        onTogglePinItem={onTogglePinItem || (() => {})}
        onToggleUnreadItem={onToggleUnreadItem || (() => {})}
        onEditProfileItem={onEditProfileItem || (() => {})}
        onDuplicateItem={onDuplicateItem || (() => {})}
        onCopyConversationId={onCopyConversationId || (() => {})}
        onHideFromSidebar={onHideFromSidebar || (() => {})}
        onDeleteItem={onDeleteItem || (() => {})}
      />



      {/* Sidebar Footer: Marketplace & User Profile */}
      <div className="p-2.5 bg-theme-surface space-y-1 relative">
        <button
          onClick={onOpenMarketplace}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-theme-text-primary hover:bg-theme-bg transition-colors cursor-pointer"
        >
          <div className="w-6 h-6 rounded-lg bg-theme-bg border border-theme-border flex items-center justify-center text-theme-accent-primary">
            <LayoutGrid className="w-3.5 h-3.5" />
          </div>
          <span>Marketplace</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-theme-bg border border-theme-border hover:border-theme-accent-primary/60 transition-all text-left cursor-pointer group"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-theme-accent-primary to-theme-accent-secondary flex items-center justify-center text-black font-bold text-xs shadow-xs shrink-0 group-hover:scale-105 transition-transform">
              {activeInitials}
            </div>
            <div className="flex-1 min-w-0">
              <span className="block text-xs font-semibold text-theme-text-primary truncate">
                {activeName}
              </span>
              <span className="block text-[10px] text-theme-text-muted truncate">
                {activeSubtitle}
              </span>
            </div>
            <ChevronUp
              className={`w-3.5 h-3.5 text-theme-text-muted transition-transform shrink-0 ${
                showUserMenu ? 'rotate-180 text-theme-accent-primary' : ''
              }`}
            />
          </button>

          {/* Dropup Menu from Bottom Lefthand Settings */}
          {showUserMenu && (
            <>
              {/* Invisible Backdrop to close menus when clicking outside */}
              <div
                className="fixed inset-0 z-[9990]"
                onClick={() => setShowUserMenu(false)}
              />

              {/* Dropup container directly above the user button */}
              <div
                className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-[9995] bg-[#18181b] border border-zinc-700/90 rounded-2xl shadow-2xl p-2 space-y-1 text-xs animate-in fade-in slide-in-from-bottom-2"
                style={{ backgroundColor: '#18181b' }}
              >
                <div className="px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Select User
                </div>

                {/* Direct User List: User1, user2, user3 */}
                <div className="space-y-0.5">
                  {users.map((u) => {
                    const isActive = u.id === activeUserId;
                    const uInitials =
                      u.name === 'User1'
                        ? 'U1'
                        : u.name === 'user2'
                        ? 'U2'
                        : u.name === 'user3'
                        ? 'U3'
                        : u.name.slice(0, 2).toUpperCase();
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          switchUser(u.id);
                          setShowUserMenu(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-all cursor-pointer ${
                          isActive
                            ? 'bg-zinc-800 text-white font-medium border border-zinc-700/80 shadow-xs'
                            : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                              isActive
                                ? 'bg-gradient-to-tr from-theme-accent-primary to-theme-accent-secondary text-black shadow-xs'
                                : 'bg-zinc-900 border border-zinc-700 text-zinc-300'
                            }`}
                          >
                            {uInitials}
                          </div>
                          <span className="text-xs truncate">
                            {u.name}
                          </span>
                        </div>
                        {isActive && (
                          <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono font-medium shrink-0">
                            Active
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="h-px bg-zinc-800 my-1" />

                {/* Settings option */}
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false);
                    onOpenSettings();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-zinc-200 hover:text-white hover:bg-zinc-800/80 transition-colors cursor-pointer"
                >
                  <Sliders className="w-4 h-4 text-theme-accent-primary shrink-0" />
                  <span className="text-xs font-medium">Settings</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
};
