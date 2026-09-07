import React, { useState } from 'react';
import { ActiveTab, SidebarSection, SidebarItem } from '../../types';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useTheme } from '../../context/ThemeContext';
import { HeaderBar } from './HeaderBar';
import { AppSidebar } from '../sidebar/AppSidebar';
import { RightPanel, TeamMember } from '../sidebar/RightPanel';
import { DeviceSimulatorWrapper } from './DeviceSimulatorWrapper';

interface ResponsiveShellProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  selectedThreadId: string;
  onSelectThread: (id: string) => void;
  agentName: string;
  agentRole: string;
  isTeam?: boolean;
  teamMembers?: TeamMember[];
  availableAgents?: TeamMember[];
  onAddTeamMember?: (agentId: string) => void;
  onRemoveTeamMember?: (agentId: string) => void;
  missionObjective?: string;
  teamMemberCounts?: Record<string, number>;
  onOpenMarketplace: () => void;
  onOpenSettings: () => void;
  onOpenScreenModal: () => void;
  onNewAgent?: () => void;
  onNewTeam?: () => void;
  leftSidebarOpen?: boolean;
  onToggleLeftSidebar?: () => void;
  rightPanelOpen?: boolean;
  onToggleRightPanel?: () => void;
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
  description?: string;
  children: React.ReactNode;
}

export const ResponsiveShell: React.FC<ResponsiveShellProps> = ({
  activeTab,
  onSelectTab,
  selectedAgentId,
  onSelectAgent,
  selectedThreadId,
  onSelectThread,
  agentName,
  agentRole,
  isTeam = false,
  teamMembers = [],
  availableAgents = [],
  onAddTeamMember,
  onRemoveTeamMember,
  missionObjective,
  description,
  userName = 'User 1',
  teamMemberCounts,
  onOpenMarketplace,
  onOpenSettings,
  onOpenScreenModal,
  onNewAgent,
  onNewTeam,
  leftSidebarOpen = true,
  onToggleLeftSidebar,
  rightPanelOpen = true,
  onToggleRightPanel,
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
  children,
}) => {
  const [takeoverPanel, setTakeoverPanel] = useState<'chat' | 'left' | 'right'>('chat');

  const { isPhone, isTablet } = useBreakpoint();
  const { devicePreview } = useTheme();

  // Constrained viewports: Tablet and Phone panels take over screen space.
  // Desktop and Fluid keep persistent side panels.
  const isTakeoverView =
    devicePreview.startsWith('phone') ||
    devicePreview.startsWith('tablet') ||
    (devicePreview === 'fluid' && (isPhone || isTablet));

  const handleToggleLeft = () => {
    if (isTakeoverView) {
      setTakeoverPanel((prev) => (prev === 'left' ? 'chat' : 'left'));
    } else {
      onToggleLeftSidebar?.();
    }
  };

  const handleToggleRight = () => {
    if (isTakeoverView) {
      setTakeoverPanel((prev) => (prev === 'right' ? 'chat' : 'right'));
    } else {
      onToggleRightPanel?.();
    }
  };

  const effectiveLeftOpen = isTakeoverView ? takeoverPanel === 'left' : leftSidebarOpen;
  const effectiveRightOpen = isTakeoverView ? takeoverPanel === 'right' : rightPanelOpen;

  return (
    <div className="h-screen w-full max-w-full overflow-hidden flex flex-col bg-theme-bg select-none">
      <DeviceSimulatorWrapper>
        <div className="h-full w-full max-w-full flex flex-col bg-theme-bg text-theme-text-primary transition-colors overflow-hidden relative">
          {/* Top Window Chrome / App Header */}
          <HeaderBar
            activeAgentName={agentName}
            agentRole={agentRole}
            isTeam={isTeam}
            onToggleDrawer={() => {}}
            onToggleLeftSidebar={handleToggleLeft}
            leftSidebarOpen={effectiveLeftOpen}
            onToggleRightPanel={handleToggleRight}
            rightPanelOpen={effectiveRightOpen}
            activeTab={activeTab}
            onSelectTab={onSelectTab}
          />

          {isTakeoverView ? (
            /* Tablet & Phone: Panels take over the screen space when toggled */
            <div className="flex-1 w-full h-full overflow-hidden relative">
              {/* Left Panel */}
              <div
                className={`absolute inset-0 z-20 transition-all duration-300 ease-in-out ${
                  takeoverPanel === 'left'
                    ? 'opacity-100 translate-x-0 pointer-events-auto'
                    : 'opacity-0 -translate-x-full pointer-events-none'
                }`}
              >
                <div className="w-full h-full flex justify-center bg-theme-surface">
                  <div className="w-full max-w-2xl h-full flex flex-col">
                    <AppSidebar
                      selectedAgentId={selectedAgentId}
                      onSelectAgent={(id) => {
                        onSelectAgent(id);
                        setTakeoverPanel('chat');
                      }}
                      selectedThreadId={selectedThreadId}
                      onSelectThread={(id) => {
                        onSelectThread(id);
                        setTakeoverPanel('chat');
                      }}
                      onOpenMarketplace={onOpenMarketplace}
                      onOpenSettings={onOpenSettings}
                      onNewAgent={onNewAgent}
                      onNewTeam={onNewTeam}
                      teamMemberCounts={teamMemberCounts}
                      sections={sections}
                      items={items}
                      onToggleCollapseSection={onToggleCollapseSection}
                      onReorderSections={onReorderSections}
                      onMoveItemToSection={onMoveItemToSection}
                      onAddSection={onAddSection}
                      onRenameSection={onRenameSection}
                      onDeleteSection={onDeleteSection}
                      onTogglePinItem={onTogglePinItem}
                      onToggleUnreadItem={onToggleUnreadItem}
                      onEditProfileItem={onEditProfileItem}
                      onDuplicateItem={onDuplicateItem}
                      onCopyConversationId={onCopyConversationId}
                      onHideFromSidebar={onHideFromSidebar}
                      onDeleteItem={onDeleteItem}
                      userName={userName}
                    />
                  </div>
                </div>
              </div>

              {/* Main Chat Area */}
              <div
                className={`w-full h-full flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${
                  takeoverPanel === 'chat'
                    ? 'opacity-100 scale-100 pointer-events-auto'
                    : 'opacity-0 scale-98 pointer-events-none'
                }`}
              >
                {children}
              </div>

              {/* Right Panel */}
              <div
                className={`absolute inset-0 z-20 transition-all duration-300 ease-in-out ${
                  takeoverPanel === 'right'
                    ? 'opacity-100 translate-x-0 pointer-events-auto'
                    : 'opacity-0 translate-x-full pointer-events-none'
                }`}
              >
                <div className="w-full h-full flex justify-center bg-theme-surface">
                  <div className="w-full max-w-2xl h-full flex flex-col">
                    {takeoverPanel === 'right' && (
                      <RightPanel
                        isOpen={takeoverPanel === 'right'}
                        onClose={() => setTakeoverPanel('chat')}
                        agentName={agentName}
                        agentRole={agentRole}
                        description={description}
                        isTeam={isTeam}
                        teamMembers={teamMembers}
                        availableAgents={availableAgents}
                        onAddTeamMember={onAddTeamMember}
                        onRemoveTeamMember={onRemoveTeamMember}
                        missionObjective={missionObjective}
                        onOpenScreenModal={onOpenScreenModal}
                        activeTab={activeTab}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Desktop & Fluid: Multi-panel side panels with dynamic center chat */
            <div className="flex-1 flex w-full h-full overflow-hidden relative">
              {/* Left Sidebar */}
              <div
                className={`h-full shrink-0 transition-all duration-300 ease-in-out relative z-30 ${
                  leftSidebarOpen ? 'w-72 lg:w-80 opacity-100 overflow-visible' : 'w-0 opacity-0 pointer-events-none overflow-hidden'
                }`}
              >
                <div
                  className={`w-72 lg:w-80 h-full shrink-0 transition-transform duration-300 ease-in-out border-r border-theme-border relative z-30 ${
                    leftSidebarOpen ? 'translate-x-0 overflow-visible' : '-translate-x-full overflow-hidden'
                  }`}
                >
                  <AppSidebar
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={onSelectAgent}
                    selectedThreadId={selectedThreadId}
                    onSelectThread={onSelectThread}
                    onOpenMarketplace={onOpenMarketplace}
                    onOpenSettings={onOpenSettings}
                    onNewAgent={onNewAgent}
                    onNewTeam={onNewTeam}
                    teamMemberCounts={teamMemberCounts}
                    sections={sections}
                    items={items}
                    onToggleCollapseSection={onToggleCollapseSection}
                    onReorderSections={onReorderSections}
                    onMoveItemToSection={onMoveItemToSection}
                    onAddSection={onAddSection}
                    onRenameSection={onRenameSection}
                    onDeleteSection={onDeleteSection}
                    onTogglePinItem={onTogglePinItem}
                    onToggleUnreadItem={onToggleUnreadItem}
                    onEditProfileItem={onEditProfileItem}
                    onDuplicateItem={onDuplicateItem}
                    onCopyConversationId={onCopyConversationId}
                    onHideFromSidebar={onHideFromSidebar}
                    onDeleteItem={onDeleteItem}
                    userName={userName}
                  />
                </div>
              </div>

              {/* Main Chat Area */}
              <div className="flex-1 flex flex-col h-full overflow-hidden transition-all duration-300 ease-in-out">
                {children}
              </div>

              {/* Right Panel */}
              <div
                className={`h-full shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${
                  rightPanelOpen ? 'w-72 lg:w-80 opacity-100' : 'w-0 opacity-0 pointer-events-none'
                }`}
              >
                <div
                  className={`w-72 lg:w-80 h-full shrink-0 transition-transform duration-300 ease-in-out border-l border-theme-border ${
                    rightPanelOpen ? 'translate-x-0' : 'translate-x-full'
                  }`}
                >
                  {rightPanelOpen && (
                    <RightPanel
                      isOpen={rightPanelOpen}
                      onClose={handleToggleRight}
                      agentName={agentName}
                      agentRole={agentRole}
                      description={description}
                      isTeam={isTeam}
                      teamMembers={teamMembers}
                      availableAgents={availableAgents}
                      onAddTeamMember={onAddTeamMember}
                      onRemoveTeamMember={onRemoveTeamMember}
                      missionObjective={missionObjective}
                      onOpenScreenModal={onOpenScreenModal}
                      activeTab={activeTab}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DeviceSimulatorWrapper>
    </div>
  );
};
