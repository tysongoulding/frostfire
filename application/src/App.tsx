import React, { useState, useEffect } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ResponsiveShell } from './components/layout/ResponsiveShell';
import { ChatArea } from './components/chat/ChatArea';
import { SettingsModal } from './components/modals/SettingsModal';
import { MarketplaceModal } from './components/modals/MarketplaceModal';
import { ScreenView } from './components/views/ScreenView';
import { CreateEntityModal, InitialEntityData } from './components/modals/CreateEntityModal';
import { ActiveTab, SidebarSection, SidebarItem, AgentEntity, ChatMessage } from './types';
import { useSessionStore } from './store/sessionStore';
import { useProviderStore } from './store/providerStore';
import { useRhoEngine } from './hooks/useRhoEngine';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useUserStore, UserProfile, POC_USERS } from './store/userStore';
import { DEFAULT_EC2_HOST } from './lib/vnc';

const getUserAgents = (user: UserProfile): Record<string, AgentEntity> => {
  const first = user.name ? user.name.split(' ')[0] : 'User';
  const ports = user.agentPorts || { agent1: 6080, agent2: 6081, agent3: 6082 };
  if (user.id === 'user2') {
    return {
      agent1: {
        name: `${first}'s Agent 1`,
        role: `Display :4 (Port ${ports.agent1}) · Ops & Workflow Lead`,
        description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent1} managing operational workflows and orchestration for ${user.name}.`,
        notifications: true,
      },
      agent2: {
        name: `${first}'s Agent 2`,
        role: `Display :5 (Port ${ports.agent2}) · Automation & Pipeline`,
        description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent2} executing cloud automation scripts and deployments for ${user.name}.`,
        notifications: true,
      },
      agent3: {
        name: `${first}'s Agent 3`,
        role: `Display :6 (Port ${ports.agent3}) · Performance & Health`,
        description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent3} tracking health metrics, uptime, and diagnostics for ${user.name}.`,
        notifications: true,
      },
    };
  }
  if (user.id === 'user3') {
    return {
      agent1: {
        name: `${first}'s Agent 1`,
        role: `Display :7 (Port ${ports.agent1}) · Architecture & Review`,
        description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent1} reviewing repository architecture and dependencies for ${user.name}.`,
        notifications: true,
      },
      agent2: {
        name: `${first}'s Agent 2`,
        role: `Display :8 (Port ${ports.agent2}) · Principal Dev & Compiler`,
        description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent2} compiling, refactoring, and debugging codebases for ${user.name}.`,
        notifications: true,
      },
      agent3: {
        name: `${first}'s Agent 3`,
        role: `Display :9 (Port ${ports.agent3}) · Verification Matrix`,
        description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent3} running regression suites and closed-loop verification for ${user.name}.`,
        notifications: true,
      },
    };
  }
  return {
    agent1: {
      name: `${first}'s Agent 1`,
      role: `Display :1 (Port ${ports.agent1}) · Browser & Research`,
      description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent1} running sandboxed Chrome and web research for ${user.name}.`,
      notifications: true,
    },
    agent2: {
      name: `${first}'s Agent 2`,
      role: `Display :2 (Port ${ports.agent2}) · Terminal & Dev`,
      description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent2} executing terminal commands and builds for ${user.name}.`,
      notifications: true,
    },
    agent3: {
      name: `${first}'s Agent 3`,
      role: `Display :3 (Port ${ports.agent3}) · QA & System Testing`,
      description: `Autonomous cloud agent on ${user.vmHost}:${ports.agent3} running test suites and closed-loop verification for ${user.name}.`,
      notifications: true,
    },
  };
};

const getUserSidebarItems = (user: UserProfile): Record<string, SidebarItem> => {
  const ag = getUserAgents(user);
  const ports = user.agentPorts || { agent1: 6080, agent2: 6081, agent3: 6082 };
  const d1 = user.id === 'user2' ? 4 : user.id === 'user3' ? 7 : 1;
  const d2 = user.id === 'user2' ? 5 : user.id === 'user3' ? 8 : 2;
  const d3 = user.id === 'user2' ? 6 : user.id === 'user3' ? 9 : 3;
  return {
    agent1: {
      id: 'agent1',
      title: ag.agent1.name,
      roleTag: `Display :${d1} (Port ${ports.agent1})`,
      preview: `${user.vmHost} · ${ag.agent1.role}`,
      timestamp: 'Just now',
      accentClass: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
      isTeam: false,
      isStarred: false,
      isPinned: false,
      sectionId: 'agents',
    },
    agent2: {
      id: 'agent2',
      title: ag.agent2.name,
      roleTag: `Display :${d2} (Port ${ports.agent2})`,
      preview: `${user.vmHost} · ${ag.agent2.role}`,
      timestamp: 'Just now',
      accentClass: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      isTeam: false,
      isStarred: false,
      isPinned: false,
      sectionId: 'agents',
    },
    agent3: {
      id: 'agent3',
      title: ag.agent3.name,
      roleTag: `Display :${d3} (Port ${ports.agent3})`,
      preview: `${user.vmHost} · ${ag.agent3.role}`,
      timestamp: 'Just now',
      accentClass: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      isTeam: false,
      isStarred: false,
      isPinned: false,
      sectionId: 'agents',
    },
  };
};

const INITIAL_AGENTS = getUserAgents(POC_USERS[0]);

const INITIAL_SECTIONS: SidebarSection[] = [
  { id: 'agents', title: 'Agents' },
];

const INITIAL_SIDEBAR_ITEMS = getUserSidebarItems(POC_USERS[0]);

const createInitialMessages = (user: UserProfile): Record<string, ChatMessage[]> => {
  const first = user.name ? user.name.split(' ')[0] : 'User';
  const ports = user.agentPorts || { agent1: 6080, agent2: 6081, agent3: 6082 };
  const d1 = user.id === 'user2' ? 4 : user.id === 'user3' ? 7 : 1;
  const d2 = user.id === 'user2' ? 5 : user.id === 'user3' ? 8 : 2;
  const d3 = user.id === 'user2' ? 6 : user.id === 'user3' ? 9 : 3;
  return {
    agent1: [
      {
        id: 'init-agent1',
        sender: 'ai',
        text: `Hello ${first}! I am Agent 1 operating on Cloud Display :${d1} (Port ${ports.agent1} @ ${user.vmHost}).\nI can launch Google Chrome, navigate to websites, inspect elements, and run research workflows.`,
        timestamp: 'Just now',
        toolCalls: ['browser_cdp', 'desktop_gui'],
      },
    ],
    agent2: [
      {
        id: 'init-agent2',
        sender: 'ai',
        text: `Hello ${first}! I am Agent 2 operating on Cloud Display :${d2} (Port ${ports.agent2} @ ${user.vmHost}).\nI can execute bash commands, manage git repositories, edit source files, and inspect terminals.`,
        timestamp: 'Just now',
        toolCalls: ['bash_exec', 'terminal_launch'],
      },
    ],
    agent3: [
      {
        id: 'init-agent3',
        sender: 'ai',
        text: `Hello ${first}! I am Agent 3 operating on Cloud Display :${d3} (Port ${ports.agent3} @ ${user.vmHost}).\nI can run automated tests, linting, health checks, and verification suites.`,
        timestamp: 'Just now',
        toolCalls: ['qa_verify', 'system_monitor'],
      },
    ],
  };
};

const INITIAL_MESSAGES = createInitialMessages(POC_USERS[0]);

const MainApp: React.FC = () => {
  const { activeUserId, getActiveUser, users } = useUserStore();
  const currentUser = getActiveUser();

  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [agents, setAgents] = useState<Record<string, AgentEntity>>(INITIAL_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('agent1');
  const [selectedThreadId, setSelectedThreadId] = useState<string>('agent1');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState<boolean>(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(true);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);
  const [sections, setSections] = useState<SidebarSection[]>(INITIAL_SECTIONS);
  const [sidebarItems, setSidebarItems] = useState<Record<string, SidebarItem>>(INITIAL_SIDEBAR_ITEMS);
  const [messagesByUser, setMessagesByUser] = useState<Record<string, Record<string, ChatMessage[]>>>({
    user1: createInitialMessages(POC_USERS[0]),
    user2: createInitialMessages(POC_USERS[1]),
    user3: createInitialMessages(POC_USERS[2]),
  });
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

  const { addUserMessage } = useSessionStore();
  const { prompt } = useRhoEngine();
  const { syncKeysToBackend, loadKeysFromSharedAuthFile, loadCachedModelsFromBackend, fetchAllProviderModels } = useProviderStore();

  useGlobalShortcuts();

  useEffect(() => {
    const user = getActiveUser();
    const newAgents = getUserAgents(user);
    const newItems = getUserSidebarItems(user);
    setAgents(newAgents);
    setSidebarItems(newItems);
    setSelectedAgentId('agent1');
  }, [activeUserId, users]);

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

  const handleCreateEntity = (
    name: string,
    role: string,
    description?: string,
    notifications?: boolean,
    selectedAgentIds?: string[]
  ) => {
    const newId = `custom-${Date.now()}`;
    const isNewTeam =
      createModalState.type === 'team' ||
      Boolean(selectedAgentIds && selectedAgentIds.length >= 2);
    setAgents((prev) => ({
      ...prev,
      [newId]: {
        name,
        role,
        description: isNewTeam ? undefined : description,
        missionObjective: isNewTeam ? description : undefined,
        notifications,
        isTeam: isNewTeam,
        memberIds: isNewTeam ? selectedAgentIds || [] : undefined,
      },
    }));

    setSidebarItems((prev) => ({
      ...prev,
      [newId]: {
        id: newId,
        title: name,
        roleTag: role,
        preview: description || (isNewTeam ? 'Team ready for coordination.' : 'Agent ready.'),
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

    setSelectedAgentId(newId);
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
      const userThreads = prev[activeUserId] || createInitialMessages(currentUser);
      return {
        ...prev,
        [activeUserId]: {
          ...userThreads,
          [selectedAgentId]: [...(userThreads[selectedAgentId] || []), userMsg],
        },
      };
    });

    setIsThinking(true);

    const userOffset = activeUserId === 'user2' ? 3 : activeUserId === 'user3' ? 6 : 0;
    const baseDisp = selectedAgentId === 'agent2' ? 2 : selectedAgentId === 'agent3' ? 3 : 1;
    const displayNumber = userOffset + baseDisp;
    const vmHost = currentUser.vmHost || DEFAULT_EC2_HOST;
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
        // Direct fallback to EC2 instance if running outside Tauri
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
            : `Executed command on Display :${displayNumber}.`,
          toolCalls: ['bash_exec'],
        };
      }

      const aiReply: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: res?.reply || `Action completed on Display :${displayNumber}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolCalls: res?.toolCalls || [],
      };

      setMessagesByUser((prev) => {
        const userThreads = prev[activeUserId] || createInitialMessages(currentUser);
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
        const userThreads = prev[activeUserId] || createInitialMessages(currentUser);
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
        items={sidebarItems}
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
      >
        {activeTab === 'screen' && !isTeam ? (
          <ScreenView
            agentId={selectedAgentId}
            agentName={currentAgent.name}
            agentRole={currentAgent.role}
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
              INITIAL_MESSAGES[selectedAgentId] ||
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
