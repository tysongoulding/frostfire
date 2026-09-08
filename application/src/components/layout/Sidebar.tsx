import { useState, useRef, useEffect } from "react";
import { useUiStore } from "../../store/uiStore";
import { useSessionStore } from "../../store/sessionStore";
import { useChatStore } from "../../store/chatStore";
import { useSubagentStore, SubagentDefinition } from "../../store/subagentStore";
import { SubagentDetailModal } from "../agent/SubagentDetailModal";
import { RenameSubagentModal } from "../modals/RenameSubagentModal";
import { useToastStore } from "../../store/toastStore";
import { useFtaStore } from "../../stores/useFtaStore";
import {
  User,
  MessageSquarePlus,
  MessageSquare,
  Bot,
  ChevronDown,
  ChevronRight,
  Settings,
  Trash2,
  Plus,
  WandSparkles,
  Layers,
  Route,
  Search,
  X,
  GitBranch,
  MoreVertical,
  Edit2,
  SlidersHorizontal,
  Copy,
} from "lucide-react";

export function Sidebar() {
  const {
    sidebarOpen,
    activeView,
    setActiveView,
    setNewAgentModalOpen,
    setNewChatModalOpen,
  } = useUiStore();
  const { sessionInfo, setSessionMessages } = useSessionStore();
  const { chats, activeChatId, switchChat, deleteChat } = useChatStore();
  const {
    subagents,
    activeChatAgentId,
    setActiveChatAgentId,
    cloneSubagent,
    deleteSubagent,
    getAgentMessages,
  } = useSubagentStore();
  const { addToast } = useToastStore();
  const { hoursSaved, blendedHourlyRate } = useFtaStore();
  const totalFtaValue = Math.round(hoursSaved * blendedHourlyRate);

  const [searchQuery, setSearchQuery] = useState("");
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [chatsExpanded, setChatsExpanded] = useState(true);

  // Modals & Menu State
  const [editingSubagent, setEditingSubagent] = useState<SubagentDefinition | null>(null);
  const [renamingSubagent, setRenamingSubagent] = useState<SubagentDefinition | null>(null);
  const [menuSubagentId, setMenuSubagentId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuSubagentId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // 1. Direct Dedicated Agent Conversation
  const handleChatWithAgent = (agent: SubagentDefinition) => {
    setActiveChatAgentId(agent.id);
    const msgs = getAgentMessages(agent.id);
    setSessionMessages(msgs);
    setActiveView("chat");
  };

  // 2. Select General Chat Thread
  const handleSelectChat = (chatId: string) => {
    setActiveChatAgentId(null);
    switchChat(chatId);
    const targetChat = chats.find((c) => c.id === chatId);
    setSessionMessages(targetChat ? targetChat.messages : []);
    setActiveView("chat");
  };

  const handleDeleteChat = (e: React.MouseEvent, chatId: string, chatTitle: string) => {
    e.stopPropagation();
    deleteChat(chatId);
    addToast(`Deleted chat: ${chatTitle}`, "info");
  };

  // Agent Actions
  const handleClone = (e: React.MouseEvent, agent: SubagentDefinition) => {
    e.stopPropagation();
    setMenuSubagentId(null);
    const cloned = cloneSubagent(agent.id);
    if (cloned) {
      addToast(`Cloned agent to: ${cloned.name}`, "success");
    }
  };

  const handleOpenEdit = (e: React.MouseEvent, agent: SubagentDefinition) => {
    e.stopPropagation();
    setMenuSubagentId(null);
    setEditingSubagent(agent);
  };

  const handleOpenRename = (e: React.MouseEvent, agent: SubagentDefinition) => {
    e.stopPropagation();
    setMenuSubagentId(null);
    setRenamingSubagent(agent);
  };

  const handleDeleteAgent = (e: React.MouseEvent, agent: SubagentDefinition) => {
    e.stopPropagation();
    setMenuSubagentId(null);
    deleteSubagent(agent.id);
    addToast(`Deleted agent: ${agent.name}`, "info");
  };

  // Filter agents and chats by search query
  const filteredAgents = subagents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <aside
        className={`h-full bg-[#0d1117] flex flex-col text-xs select-none flex-shrink-0 overflow-hidden transition-[width,opacity,border-color] duration-300 ease-in-out ${
          sidebarOpen
            ? "w-64 border-r border-[#30363d] opacity-100"
            : "w-0 border-r-0 border-transparent opacity-0 pointer-events-none"
        }`}
      >
        <div className="w-64 h-full flex flex-col min-w-[16rem]">
          {/* Top Action Buttons */}
      <div className="p-3 border-b border-[#30363d] space-y-2 flex-shrink-0">
        {/* New Agent Button */}
        <button
          onClick={() => setNewAgentModalOpen(true)}
          className="w-full flex items-center justify-center space-x-2 py-1.5 px-3 bg-[#161b22] hover:bg-[#21262d] text-white rounded-lg border border-[#30363d] font-medium transition"
          title="Create a new standalone Agent"
        >
          <User className="w-4 h-4 text-[#f472b6]" />
          <span>New Agent</span>
        </button>

        {/* New Chat Button */}
        <button
          onClick={() => {
            setActiveChatAgentId(null);
            setNewChatModalOpen(true);
          }}
          className="w-full flex items-center justify-center space-x-2 py-1.5 px-3 bg-[#21262d] hover:bg-[#30363d] text-white rounded-lg border border-[#30363d] font-medium transition"
          title="Start a new conversation (Ctrl+Shift+N)"
        >
          <MessageSquarePlus className="w-4 h-4 text-[#58a6ff]" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Feature Navigation Views */}
      <div className="p-2 space-y-1 flex-shrink-0">
        <button
          onClick={() => setActiveView("workstreams")}
          className={`w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left ${
            activeView === "workstreams"
              ? "bg-gradient-to-r from-[#58a6ff]/20 to-[#f472b6]/20 text-white font-medium border border-[#f472b6]/40"
              : "text-[#c9d1d9] hover:bg-[#161b22] border border-transparent"
          }`}
          title="Workstream Federations & 1-Hour Sprints"
        >
          <GitBranch className="w-4 h-4 text-[#58a6ff]" />
          <span>Workstreams</span>
        </button>
        <button
          onClick={() => setActiveView("customise")}
          className={`w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left ${
            activeView === "customise"
              ? "bg-gradient-to-r from-[#58a6ff]/20 to-[#f472b6]/20 text-white font-medium border border-[#f472b6]/40"
              : "text-[#c9d1d9] hover:bg-[#161b22] border border-transparent"
          }`}
          title="Appearance, Chat Personas & Customisation"
        >
          <WandSparkles className="w-4 h-4 text-[#58a6ff]" />
          <span>Customise</span>
        </button>

        <button
          onClick={() => setActiveView("artifacts")}
          className={`w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left ${
            activeView === "artifacts"
              ? "bg-gradient-to-r from-[#58a6ff]/20 to-[#f472b6]/20 text-white font-medium border border-[#f472b6]/40"
              : "text-[#c9d1d9] hover:bg-[#161b22] border border-transparent"
          }`}
          title="Artifacts, Diagrams & Presentation Decks"
        >
          <Layers className="w-4 h-4 text-[#58a6ff]" />
          <span>Artifacts</span>
        </button>

        <button
          onClick={() => setActiveView("automation")}
          className={`w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left ${
            activeView === "automation"
              ? "bg-gradient-to-r from-[#58a6ff]/20 to-[#f472b6]/20 text-white font-medium border border-[#f472b6]/40"
              : "text-[#c9d1d9] hover:bg-[#161b22] border border-transparent"
          }`}
          title="Dynamic Tools, Cron & Automation Jobs"
        >
          <Route className="w-4 h-4 text-[#58a6ff]" />
          <span>Automation</span>
        </button>
      </div>

      {/* Line Divider */}
      <div className="border-b border-[#30363d] mx-3" />

      {/* Agents & Chats Search Bar */}
      <div className="p-2 flex-shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents & chats..."
            className="w-full bg-[#161b22] border border-[#30363d] rounded-lg pl-8 pr-7 py-1 text-white text-[11px] placeholder-[#8b949e] focus:border-[#58a6ff] outline-none transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 text-[#8b949e] hover:text-white p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Accordion Lists */}
      <div className="flex-1 overflow-y-auto p-2 pt-0 space-y-3">
        {/* Agents Section */}
        <div className="space-y-1">
          <div
            onClick={() => setAgentsExpanded(!agentsExpanded)}
            className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-[#161b22] cursor-pointer text-[#8b949e] hover:text-white transition group"
          >
            <div className="flex items-center space-x-1.5 font-semibold text-[11px] tracking-wide uppercase">
              {agentsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#8b949e]" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#8b949e]" />
              )}
              <span>Agents</span>
              <span className="text-[10px] font-mono text-[#8b949e] ml-1">({filteredAgents.length})</span>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setNewAgentModalOpen(true);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
              title="Create new agent"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {agentsExpanded && (
            <div className="space-y-0.5 pl-1 animate-in fade-in duration-100">
              {filteredAgents.length === 0 ? (
                <div className="px-2 py-2 text-[10px] text-[#8b949e] italic">No agents found</div>
              ) : (
                filteredAgents.map((agent) => {
                  const isChattingWithThisAgent =
                    activeChatAgentId === agent.id && activeView === "chat";
                  const isMenuOpen = menuSubagentId === agent.id;

                  return (
                    <div
                      key={agent.id}
                      className={`relative w-full flex items-center justify-between px-2 py-1.5 rounded-lg transition group cursor-pointer ${
                        isChattingWithThisAgent
                          ? "bg-[#f472b6]/10 text-[#f472b6] border border-[#f472b6]/30"
                          : "text-[#c9d1d9] hover:bg-[#161b22] border border-transparent hover:border-[#30363d]"
                      }`}
                      onClick={() => handleChatWithAgent(agent)}
                      title={`Chat directly with ${agent.name}`}
                    >
                      {/* Left: Bot Icon + Name & Role */}
                      <div className="flex items-center space-x-2 truncate mr-1">
                        <div className="relative flex-shrink-0">
                          <Bot
                            className={`w-3.5 h-3.5 ${
                              isChattingWithThisAgent ? "text-[#f472b6]" : "text-[#58a6ff]"
                            }`}
                          />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${
                              agent.state === "running"
                                ? "bg-[#f472b6] animate-pulse"
                                : "bg-[#58a6ff]"
                            }`}
                          />
                        </div>
                        <div className="truncate">
                          <div className="truncate text-xs font-medium text-white">{agent.name}</div>
                          <div className="text-[10px] text-[#8b949e] truncate leading-tight flex items-center space-x-1">
                            {agent.workspaceMode === "branch" && (
                              <GitBranch className="w-2.5 h-2.5 text-[#58a6ff]" />
                            )}
                            <span className="truncate">{agent.role}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Triple Vertical Dot Menu Button */}
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuSubagentId(isMenuOpen ? null : agent.id);
                          }}
                          className={`p-1 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition ${
                            isMenuOpen ? "opacity-100 bg-[#21262d] text-white" : "opacity-0 group-hover:opacity-100"
                          }`}
                          title="Agent options (Rename, Edit, Clone, Delete)"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Floating Context Menu */}
                      {isMenuOpen && (
                        <div
                          ref={menuRef}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-1 top-8 z-50 w-36 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl py-1 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
                        >
                          <button
                            onClick={(e) => handleOpenRename(e, agent)}
                            className="w-full flex items-center space-x-2 px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-blue-400" />
                            <span>Rename</span>
                          </button>

                          <button
                            onClick={(e) => handleOpenEdit(e, agent)}
                            className="w-full flex items-center space-x-2 px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5 text-purple-400" />
                            <span>Edit Agent</span>
                          </button>

                          <button
                            onClick={(e) => handleClone(e, agent)}
                            className="w-full flex items-center space-x-2 px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition"
                          >
                            <Copy className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Clone</span>
                          </button>

                          <div className="border-t border-[#30363d] my-1" />

                          <button
                            onClick={(e) => handleDeleteAgent(e, agent)}
                            className="w-full flex items-center space-x-2 px-3 py-1.5 text-left text-red-400 hover:bg-red-950/40 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Chats Section */}
        <div className="space-y-1">
          <div
            onClick={() => setChatsExpanded(!chatsExpanded)}
            className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-[#161b22] cursor-pointer text-[#8b949e] hover:text-white transition group"
          >
            <div className="flex items-center space-x-1.5 font-semibold text-[11px] tracking-wide uppercase">
              {chatsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#8b949e]" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#8b949e]" />
              )}
              <span>Chats</span>
              <span className="text-[10px] font-mono text-[#8b949e] ml-1">({filteredChats.length})</span>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveChatAgentId(null);
                setNewChatModalOpen(true);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-white transition"
              title="Start new chat"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {chatsExpanded && (
            <div className="space-y-0.5 pl-1 animate-in fade-in duration-100">
              {filteredChats.length === 0 ? (
                <div className="px-2 py-2 text-[10px] text-[#8b949e] italic">No chats found</div>
              ) : (
                filteredChats.map((chat) => {
                  const isActive =
                    activeView === "chat" && activeChatAgentId === null && activeChatId === chat.id;
                  return (
                    <div
                      key={chat.id}
                      onClick={() => handleSelectChat(chat.id)}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg transition cursor-pointer group ${
                        isActive
                          ? "bg-[#1f6feb]/20 text-[#58a6ff] font-medium border border-blue-500/40"
                          : "text-[#c9d1d9] hover:bg-[#161b22] border border-transparent"
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <MessageSquare
                          className={`w-3.5 h-3.5 flex-shrink-0 ${
                            isActive ? "text-[#58a6ff]" : "text-[#8b949e]"
                          }`}
                        />
                        <div className="truncate">
                          <div className="truncate text-xs">{chat.title}</div>
                          <div className="text-[9px] text-[#8b949e]">
                            {new Date(chat.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                          </div>
                        </div>
                      </div>

                      {chats.length > 1 && (
                        <button
                          onClick={(e) => handleDeleteChat(e, chat.id, chat.title)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-red-400 transition ml-1"
                          title="Delete chat"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Real-Time FTA Valuation Counter */}
      <div className="p-3 border-t border-[#30363d] bg-[#161b22]/30 flex-shrink-0">
        <div className="p-2.5 rounded-xl bg-[#0d1117] border border-[#30363d] space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#8b949e] font-semibold uppercase tracking-wider">FTA ROI Value</span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-pink-950/40 text-pink-400 border border-pink-800/40">Real-time</span>
          </div>
          <div className="flex items-baseline justify-between pt-0.5">
            <span className="text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#58a6ff] via-purple-400 to-pink-400 font-mono">
              {hoursSaved.toFixed(1)} <span className="text-xs font-normal text-[#8b949e]">hrs</span>
            </span>
            <span className="text-xs font-bold text-white font-mono">${totalFtaValue.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Cloud Computer / Multi-Agent Studio Button */}
      <div className="p-2 border-t border-[#30363d] bg-[#161b22]/40 flex-shrink-0">
        <button
          onClick={() => setActiveView(activeView === "cloud" ? "chat" : "cloud")}
          className={`w-full flex items-center space-x-2 px-2.5 py-2 rounded-lg transition text-left ${
            activeView === "cloud"
              ? "bg-[#1f6feb]/20 text-[#58a6ff] font-medium border border-blue-500/40 shadow-sm"
              : "text-[#c9d1d9] hover:bg-[#21262d] hover:text-white border border-transparent"
          }`}
          title="Open Cloud Computer & Multi-Agent Studio"
        >
          <Layers className={`w-4 h-4 ${activeView === "cloud" ? "text-[#58a6ff]" : "text-emerald-400"}`} />
          <span className="font-medium">Cloud Studio</span>
          <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {subagents.length} {subagents.length === 1 ? "Agent" : "Agents"}
          </span>
        </button>
      </div>

      {/* Bottom Settings Button */}
      <div className="p-2 border-t border-[#30363d] bg-[#161b22]/50 flex-shrink-0">
        <button
          onClick={() => setActiveView("settings")}
          className={`w-full flex items-center space-x-2 px-2.5 py-2 rounded-lg transition text-left ${
            activeView === "settings"
              ? "bg-[#1f6feb]/20 text-[#58a6ff] font-medium border border-blue-500/40"
              : "text-[#c9d1d9] hover:bg-[#21262d] hover:text-white border border-transparent"
          }`}
          title="Open Settings & Preferences"
        >
          <Settings className={`w-4 h-4 ${activeView === "settings" ? "text-[#58a6ff]" : "text-[#8b949e]"}`} />
          <span className="font-medium">Settings</span>
        </button>
      </div>
      </div>
    </aside>

    {/* Standalone Agent Detail / Edit Modal */}
    {editingSubagent && (
      <SubagentDetailModal
        subagent={editingSubagent}
        onClose={() => setEditingSubagent(null)}
      />
    )}

    {/* Rename Agent Modal */}
    {renamingSubagent && (
      <RenameSubagentModal
        subagent={renamingSubagent}
        onClose={() => setRenamingSubagent(null)}
      />
    )}
  </>
);
}
