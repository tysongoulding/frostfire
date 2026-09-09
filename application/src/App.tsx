import React, { useState, useEffect, useMemo } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ResponsiveShell } from './components/layout/ResponsiveShell';
import { ChatArea } from './components/chat/ChatArea';
import { SettingsModal } from './components/modals/SettingsModal';
import { MarketplaceModal } from './components/modals/MarketplaceModal';
import { ScreenView } from './components/views/ScreenView';
import { CreateEntityModal, InitialEntityData } from './components/modals/CreateEntityModal';
import { ActiveTab, SidebarSection, SidebarItem, AgentEntity, ChatMessage, AgentSessionInfo } from './types';
import { useSessionStore } from './store/sessionStore';
import { useProviderStore } from './store/providerStore';
import { useRhoEngine } from './hooks/useRhoEngine';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useUserStore } from './store/userStore';
import { DEFAULT_EC2_HOST } from './lib/vnc';

function sessionToEntity(s: AgentSessionInfo): AgentEntity {
  const sid = s.id || s.agent_id || 'agt_default';
  const hasCustomRole = Boolean(s.role && !s.role.toLowerCase().includes('display'));
  return {
    id: sid,
    name: s.name || `Agent Slot ${s.display_number}`,
    role: hasCustomRole ? s.role! : '',
    description: s.description || '',
    notifications: true,
    displayNumber: s.display_number,
    vncPort: s.vnc_port,
    vmHost: s.vm_host,
    status: s.status,
  };
}

function sessionToSidebarItem(s: AgentSessionInfo): SidebarItem {
  const sid = s.id || s.agent_id || 'agt_default';
  const hasCustomRole = Boolean(s.role && !s.role.toLowerCase().includes('display'));
  return {
    id: sid,
    title: s.name || `Agent Slot ${s.display_number}`,
    roleTag: hasCustomRole ? s.role : undefined,
    preview: '',
    timestamp: 'Live',
    accentClass: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    isTeam: false,
    isStarred: false,
    isPinned: false,
    sectionId: 'agents',
  };
}

const INITIAL_SECTIONS: SidebarSection[] = [
  { id: 'agents', title: 'Agents' },
];

const MainApp: React.FC = () => {
  const { activeUserId, getActiveUser } = useUserStore();
  const currentUser = getActiveUser();

  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [agents, setAgents] = useState<Record<string, AgentEntity>>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState<boolean>(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(true);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);
  const [sections, setSections] = useState<SidebarSection[]>(INITIAL_SECTIONS);
  const [sidebarItems, setSidebarItems] = useState<Record<string, SidebarItem>>({});
  const [messagesByUser, setMessagesByUser] = useState<Record<string, Record<string, ChatMessage[]>>>({});
  const [isThinking, setIsThinking] = useState<boolean>(false);

  const [createModalState, setCreateModalState] = useState<{
    isOpen: boolean;
    type: 'agent' | 'team';
  }>({
    isOpen: false,
    type: 'agent',
  });
  const [editModalState, setEditModalState] = useState<{
    isOpen: boolean;
    type: 'agent' | 'team';
    data: InitialEntityData | null;
  }>({
    isOpen: false,
    type: 'agent',
    data: null,
  });

  const { addUserMessage: _addUserMessage } = useSessionStore();
  const { prompt: _prompt } = useRhoEngine();
  const { syncKeysToBackend, loadKeysFromSharedAuthFile, loadCachedModelsFromBackend, fetchAllProviderModels } = useProviderStore();

  useGlobalShortcuts();

  useEffect(() => {
    let isMounted = true;
    async function loadSessions() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        let sessionsList = await invoke<AgentSessionInfo[]>('list_agent_sessions');
        if (!sessionsList || sessionsList.length === 0) {
          const seeded = await invoke<AgentSessionInfo>('create_agent_session', {
            teamId: null,
            preferredSlot: 1,
          });
          sessionsList = [seeded];
        }
        if (!isMounted) return;

        const newAgents: Record<string, AgentEntity> = {};
        const newItems: Record<string, SidebarItem> = {};
        for (const s of sessionsList) {
          const sid = s.id || s.agent_id || 'agt_default';
          newAgents[sid] = sessionToEntity(s);
          newItems[sid] = sessionToSidebarItem(s);
        }
        setAgents(newAgents);
        setSidebarItems(newItems);
        if (sessionsList.length > 0) {
          const firstSid = sessionsList[0].id || sessionsList[0].agent_id || '';
          setSelectedAgentId((prev) => (prev && newAgents[prev] ? prev : firstSid));
        }
      } catch (err) {
        console.warn('Failed to load agent sessions:', err);
        const fallbackId = 'agt_default_01';
        const fallbackSession: AgentSessionInfo = {
          id: fallbackId,
          agent_id: fallbackId,
          display_number: 1,
          display_slot: 1,
          vnc_port: 6080,
          rfb_port: 5901,
          cdp_port: 9223,
          vm_host: currentUser?.vmHost || DEFAULT_EC2_HOST,
          status: 'ready',
          created_at: new Date().toISOString(),
        };
        const newAgents = { [fallbackId]: sessionToEntity(fallbackSession) };
        const newItems = { [fallbackId]: sessionToSidebarItem(fallbackSession) };
        setAgents(newAgents);
        setSidebarItems(newItems);
        setSelectedAgentId(fallbackId);
      }
    }
    loadSessions();
    return () => {
      isMounted = false;
    };
  }, [activeUserId, currentUser?.vmHost]);

  useEffect(() => {
    import('./lib/settingsSync').then(({ loadSettingsFromDisk }) => {
      loadSettingsFromDisk();
    }).catch(() => {});
    loadCachedModelsFromBackend().catch(() => {});
    loadKeysFromSharedAuthFile().then(() => {
      syncKeysToBackend().then(() => {
        fetchAllProviderModels().catch(() => {});
      });
    }).catch(() => {});
  }, [loadKeysFromSharedAuthFile, syncKeysToBackend, loadCachedModelsFromBackend, fetchAllProviderModels]);

  const handleToggleLeftSidebar = () => {
    setLeftSidebarOpen((prev) => !prev);
  };

  const handleToggleRightPanel = () => {
    setRightPanelOpen((prev) => !prev);
  };

  const handleToggleCollapseSection = (sectionId: string) => {
    setSections((prev) =>
      prev.map((sec) => (sec.id === sectionId ? { ...sec, isCollapsed: !sec.isCollapsed } : sec))
    );
  };

  const handleReorderSections = (draggedSectionId: string, targetSectionId: string) => {
    if (draggedSectionId === targetSectionId) return;
    setSections((prev) => {
      const starSection = prev.find((s) => s.isStarSection || s.isPinnedSection);
      const unassignedSection = prev.find((s) => s.isUnassignedSection || s.isDefaultSection);
      const movableSections = prev.filter(
        (s) => !s.isStarSection && !s.isPinnedSection && !s.isUnassignedSection && !s.isDefaultSection
      );
      const fromIndex = movableSections.findIndex((s) => s.id === draggedSectionId);
      const toIndex = movableSections.findIndex((s) => s.id === targetSectionId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const updated = [...movableSections];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);

      const result: SidebarSection[] = [];
      if (starSection) result.push(starSection);
      result.push(...updated);
      if (unassignedSection) result.push(unassignedSection);
      return result;
    });
  };

  const handleMoveItemToSection = (itemId: string, targetSectionId: string) => {
    setSidebarItems((prev) => {
      const item = prev[itemId];
      if (!item) return prev;
      if (targetSectionId === 'starred' || targetSectionId === 'pinned') {
        return {
          ...prev,
          [itemId]: { ...item, isStarred: true, isPinned: true },
        };
      }
      return {
        ...prev,
        [itemId]: { ...item, sectionId: targetSectionId, isStarred: false, isPinned: false },
      };
    });
  };

  const handleAddSection = (title: string, id?: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const newId = id || `section-${Date.now()}`;
    setSections((prev) => {
      const unassignedSection = prev.find((s) => s.isUnassignedSection || s.isDefaultSection);
      const others = prev.filter((s) => s !== unassignedSection);
      const newSec: SidebarSection = { id: newId, title: trimmed };
      return unassignedSection ? [...others, newSec, unassignedSection] : [...others, newSec];
    });
  };

  const handleRenameSection = (sectionId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setSections((prev) =>
      prev.map((sec) => (sec.id === sectionId ? { ...sec, title: trimmed } : sec))
    );
  };

  const handleDeleteSection = (sectionId: string) => {
    setSections((prev) => prev.filter((sec) => sec.id !== sectionId));
    setSidebarItems((prev) => {
      const updated = { ...prev };
      Object.entries(updated).forEach(([id, item]) => {
        if (item.sectionId === sectionId) {
          updated[id] = { ...item, sectionId: 'unassigned' };
        }
      });
      return updated;
    });
  };

  const handleTogglePinItem = (id: string) => {
    setSidebarItems((prev) => {
      const item = prev[id];
      if (!item) return prev;
      const nextVal = !(item.isStarred ?? item.isPinned);
      return {
        ...prev,
        [id]: { ...item, isStarred: nextVal, isPinned: nextVal },
      };
    });
  };

  const handleToggleUnreadItem = (id: string) => {
    setSidebarItems((prev) => {
      const item = prev[id];
      if (!item) return prev;
      return {
        ...prev,
        [id]: { ...item, isUnread: !item.isUnread },
      };
    });
  };

  const handleEditProfileItem = (id: string) => {
    const a = agents[id];
    const item = sidebarItems[id];
    if (!a && !item) return;
    setEditModalState({
      isOpen: true,
      type: (a?.isTeam || item?.isTeam) ? 'team' : 'agent',
      data: {
        id,
        name: a?.name || item?.title || '',
        role: a?.role || item?.roleTag || '',
        description: a?.description || a?.missionObjective || item?.preview || '',
        notifications: a?.notifications ?? true,
        selectedAgentIds: a?.memberIds || [],
      },
    });
  };

  const handleSaveEditedEntity = (
    id: string,
    name: string,
    role: string,
    description?: string,
    notifications?: boolean,
    selectedAgentIds?: string[]
  ) => {
    setAgents((prev) => {
      const existing = prev[id];
      if (!existing) return prev;
      const isTeamEntity = existing.isTeam;
      return {
        ...prev,
        [id]: {
          ...existing,
          name,
          role,
          description: isTeamEntity ? undefined : description,
          missionObjective: isTeamEntity ? description : undefined,
          notifications,
          memberIds: isTeamEntity ? selectedAgentIds || existing.memberIds : undefined,
        },
      };
    });

    setSidebarItems((prev) => {
      const item = prev[id];
      if (!item) return prev;
      return {
        ...prev,
        [id]: {
          ...item,
          title: name,
          roleTag: role,
          preview: description || item.preview,
          memberCount: selectedAgentIds ? selectedAgentIds.length : item.memberCount,
        },
      };
    });
    setEditModalState({ isOpen: false, type: 'agent', data: null });
  };

  const handleDuplicateItem = (id: string) => {
    const origItem = sidebarItems[id];
    const origAgent = agents[id];
    if (!origItem) return;
    const copyId = `copy-${Date.now()}`;
    const copyTitle = `${origItem.title} (Copy)`;

    if (origAgent) {
      setAgents((prev) => ({
        ...prev,
        [copyId]: {
          ...origAgent,
          name: copyTitle,
        },
      }));
    }

    setSidebarItems((prev) => ({
      ...prev,
      [copyId]: {
        ...origItem,
        id: copyId,
        title: copyTitle,
        isPinned: false,
        isStarred: false,
        sectionId: 'unassigned',
        timestamp: 'Just now',
      },
    }));
    setSelectedAgentId(copyId);
  };

  const handleCopyConversationId = (id: string) => {
    navigator.clipboard.writeText(id).catch(() => {});
  };

  const handleHideFromSidebar = (id: string) => {
    setSidebarItems((prev) => {
      const item = prev[id];
      if (!item) return prev;
      return {
        ...prev,
        [id]: { ...item, isHidden: true },
      };
    });
  };

  const handleDeleteItem = (id: string) => {
    setSidebarItems((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setAgents((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (selectedAgentId === id) {
      setSelectedAgentId('netassistant');
    }
  };

  const currentAgent = agents[selectedAgentId] || {
    name: 'NetAssistant',
    role: 'Executive Intelligence',
  };
  const isTeam = Boolean(currentAgent.isTeam);

  const teamMembers = (currentAgent.memberIds || [])
    .map((id) => {
      const a = agents[id];
      if (!a) return null;
      return { id, name: a.name, role: a.role };
    })
    .filter(Boolean) as { id: string; name: string; role: string }[];

  const availableCandidateAgents = Object.entries(agents)
    .filter(([id, a]) => !a.isTeam && id !== selectedAgentId)
    .map(([id, a]) => ({ id, name: a.name, role: a.role }));

  const teamMemberCounts: Record<string, number> = {};
  Object.entries(agents).forEach(([id, a]) => {
    if (a.isTeam) {
      teamMemberCounts[id] = a.memberIds?.length || 0;
    }
  });

  const handleAddTeamMember = (agentId: string) => {
    setAgents((prev) => {
      const team = prev[selectedAgentId];
      if (!team || !team.isTeam) return prev;
      const currentMembers = team.memberIds || [];
      if (currentMembers.length >= 6 || currentMembers.includes(agentId)) return prev;
      return {
        ...prev,
        [selectedAgentId]: {
          ...team,
          memberIds: [...currentMembers, agentId],
        },
      };
    });
    setSidebarItems((prev) => {
      const item = prev[selectedAgentId];
      if (!item) return prev;
      return {
        ...prev,
        [selectedAgentId]: {
          ...item,
          memberCount: (item.memberCount || 0) + 1,
        },
      };
    });
  };

  const handleRemoveTeamMember = (agentId: string) => {
    setAgents((prev) => {
      const team = prev[selectedAgentId];
      if (!team || !team.isTeam) return prev;
      return {
        ...prev,
        [selectedAgentId]: {
          ...team,
          memberIds: (team.memberIds || []).filter((id) => id !== agentId),
        },
      };
    });
    setSidebarItems((prev) => {
      const item = prev[selectedAgentId];
      if (!item) return prev;
      return {
        ...prev,
        [selectedAgentId]: {
          ...item,
          memberCount: Math.max(0, (item.memberCount || 1) - 1),
        },
      };
    });
  };

  const handleCreateEntity = async (
    name: string,
    role: string,
    description?: string,
    notifications?: boolean,
    selectedAgentIds?: string[]
  ) => {
    const isNewTeam =
      createModalState.type === 'team' ||
      Boolean(selectedAgentIds && selectedAgentIds.length >= 2);

    let createdId = `custom-${Date.now()}`;
    let createdDisplay = 1;
    let createdVncPort = 6080;
    let createdVmHost = currentUser?.vmHost || DEFAULT_EC2_HOST;

    if (!isNewTeam) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const session = await invoke<AgentSessionInfo>('create_agent_session', {
          teamId: null,
          preferredSlot: null,
        });
        createdId = session.id || session.agent_id || createdId;
        createdDisplay = session.display_number;
        createdVncPort = session.vnc_port;
        createdVmHost = session.vm_host;
      } catch (err) {
        console.warn('Failed to create agent session via Tauri:', err);
      }
    }

    setAgents((prev) => ({
      ...prev,
      [createdId]: {
        name,
        role,
        description: isNewTeam ? undefined : description,
        missionObjective: isNewTeam ? description : undefined,
        notifications,
        isTeam: isNewTeam,
        memberIds: isNewTeam ? selectedAgentIds || [] : undefined,
        displayNumber: createdDisplay,
        vncPort: createdVncPort,
        vmHost: createdVmHost,
      },
    }));

    setSidebarItems((prev) => ({
      ...prev,
      [createdId]: {
        id: createdId,
        title: name,
        roleTag: role,
        preview: description || (isNewTeam ? 'Team ready for coordination.' : ''),
        timestamp: 'Just now',
        accentClass: isNewTeam
          ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20'
          : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        isTeam: isNewTeam,
        memberCount: isNewTeam ? (selectedAgentIds?.length || 0) : undefined,
        isPinned: false,
        isStarred: false,
        sectionId: 'unassigned',
      },
    }));

    setSelectedAgentId(createdId);
    setActiveTab('chat');
  };

  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessagesByUser((prev) => {
      const userThreads = prev[activeUserId] || {};
      return {
        ...prev,
        [activeUserId]: {
          ...userThreads,
          [selectedAgentId]: [...(userThreads[selectedAgentId] || []), userMsg],
        },
      };
    });

    setIsThinking(true);

    const targetAgent = agents[selectedAgentId];
    const displayNumber = targetAgent?.displayNumber ?? 1;
    const vmHost = targetAgent?.vmHost || currentUser.vmHost || DEFAULT_EC2_HOST;
    const execPort = currentUser.execPort || 3000;

    try {
      let res: any = null;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        res = await invoke('send_agent_turn', {
          userId: activeUserId,
          displayNumber,
          prompt: text,
          vmHost,
          execPort,
        });
      } catch {
        // Direct fallback to EC2 agent turn API if running outside Tauri
        try {
          const resp = await fetch(`http://${vmHost}:${execPort}/agent/turn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: activeUserId,
              display: displayNumber,
              prompt: text,
            }),
          });
          if (resp.ok) {
            res = await resp.json();
          }
        } catch {
          // Fall back to direct /exec
        }

        if (!res) {
          const resp = await fetch(`http://${vmHost}:${execPort}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              display: displayNumber,
              command: text,
              cwd: '/home/ubuntu',
              background: false,
            }),
          });
          const execData = await resp.json();
          res = {
            reply: execData.stdout
              ? `Output on Display :${displayNumber}:\n\n\`\`\`\n${execData.stdout.trim()}\n\`\`\``
              : `Action executed on Display :${displayNumber}.`,
            toolCalls: ['bash_exec'],
          };
        }
      }

      const aiReply: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: res?.reply || `Action completed on Display :${displayNumber}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolCalls: res?.toolCalls || [],
      };

      setMessagesByUser((prev) => {
        const userThreads = prev[activeUserId] || {};
        return {
          ...prev,
          [activeUserId]: {
            ...userThreads,
            [selectedAgentId]: [...(userThreads[selectedAgentId] || []), aiReply],
          },
        };
      });
    } catch (err: any) {
      const errReply: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'ai',
        text: `Error executing on Display :${displayNumber}: ${err?.message || String(err)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessagesByUser((prev) => {
        const userThreads = prev[activeUserId] || {};
        return {
          ...prev,
          [activeUserId]: {
            ...userThreads,
            [selectedAgentId]: [...(userThreads[selectedAgentId] || []), errReply],
          },
        };
      });
    } finally {
      setIsThinking(false);
    }
  };

  const itemsWithLastMessage = useMemo(() => {
    const userMessages = messagesByUser[activeUserId] || {};
    const updated: Record<string, SidebarItem> = {};
    for (const [id, item] of Object.entries(sidebarItems)) {
      const threadMsgs = userMessages[id];
      const lastMsg = threadMsgs && threadMsgs.length > 0 ? threadMsgs[threadMsgs.length - 1] : undefined;
      updated[id] = {
        ...item,
        preview: lastMsg?.text || item.preview || '',
        timestamp: lastMsg?.timestamp || item.timestamp || 'Live',
      };
    }
    return updated;
  }, [sidebarItems, messagesByUser, activeUserId]);

  return (
    <>
      <ResponsiveShell
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        selectedThreadId={selectedThreadId}
        onSelectThread={setSelectedThreadId}
        agentName={currentAgent.name}
        agentRole={currentAgent.role}
        description={currentAgent.description}
        userName={currentUser.name}
        isTeam={isTeam}
        teamMembers={teamMembers}
        availableAgents={availableCandidateAgents}
        onAddTeamMember={handleAddTeamMember}
        onRemoveTeamMember={handleRemoveTeamMember}
        missionObjective={currentAgent.missionObjective}
        teamMemberCounts={teamMemberCounts}
        onOpenMarketplace={() => setIsMarketplaceOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenScreenModal={() => {
          if (!isTeam) setActiveTab('screen');
        }}
        onNewAgent={() => setCreateModalState({ isOpen: true, type: 'agent' })}
        onNewTeam={() => setCreateModalState({ isOpen: true, type: 'team' })}
        leftSidebarOpen={leftSidebarOpen}
        onToggleLeftSidebar={handleToggleLeftSidebar}
        rightPanelOpen={rightPanelOpen}
        onToggleRightPanel={handleToggleRightPanel}
        sections={sections}
        items={itemsWithLastMessage}
        onToggleCollapseSection={handleToggleCollapseSection}
        onReorderSections={handleReorderSections}
        onMoveItemToSection={handleMoveItemToSection}
        onAddSection={handleAddSection}
        onRenameSection={handleRenameSection}
        onDeleteSection={handleDeleteSection}
        onTogglePinItem={handleTogglePinItem}
        onToggleUnreadItem={handleToggleUnreadItem}
        onEditProfileItem={handleEditProfileItem}
        onDuplicateItem={handleDuplicateItem}
        onCopyConversationId={handleCopyConversationId}
        onHideFromSidebar={handleHideFromSidebar}
        onDeleteItem={handleDeleteItem}
        displayNumber={currentAgent.displayNumber}
        vncPort={currentAgent.vncPort}
        vmHost={currentAgent.vmHost}
        isWorking={isThinking}
      >
        {activeTab === 'screen' && !isTeam ? (
          <ScreenView
            agentId={selectedAgentId}
            agentName={currentAgent.name}
            agentRole={currentAgent.role}
            displayNumber={currentAgent.displayNumber}
            vncPort={currentAgent.vncPort}
            vmHost={currentAgent.vmHost}
            userId={activeUserId}
            onSwitchToChat={() => setActiveTab('chat')}
            onSendCommand={handleSendMessage}
          />
        ) : (
          <ChatArea
            agentName={currentAgent.name}
            agentRole={currentAgent.role}
            showBackButton={false}
            onBack={() => setActiveTab('agents')}
            leftSidebarOpen={leftSidebarOpen}
            rightPanelOpen={rightPanelOpen}
            messages={
              (messagesByUser[activeUserId] || {})[selectedAgentId] ||
              []
            }
            isThinking={isThinking}
            onSendMessage={handleSendMessage}
          />
        )}
      </ResponsiveShell>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Marketplace Modal */}
      <MarketplaceModal
        isOpen={isMarketplaceOpen}
        onClose={() => setIsMarketplaceOpen(false)}
      />

      {/* Create Entity Modal */}
      <CreateEntityModal
        isOpen={createModalState.isOpen}
        entityType={createModalState.type}
        availableAgents={availableCandidateAgents}
        onClose={() => setCreateModalState({ ...createModalState, isOpen: false })}
        onCreate={handleCreateEntity}
      />

      {/* Edit Profile Modal */}
      <CreateEntityModal
        isOpen={editModalState.isOpen}
        entityType={editModalState.type}
        mode="edit"
        initialData={editModalState.data}
        availableAgents={availableCandidateAgents}
        onClose={() => setEditModalState({ isOpen: false, type: 'agent', data: null })}
        onCreate={() => {}}
        onSave={handleSaveEditedEntity}
      />
    </>
  );
};

export function App() {
  return (
    <ThemeProvider>
      <MainApp />
    </ThemeProvider>
  );
}

export default App;
