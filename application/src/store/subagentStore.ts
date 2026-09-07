import { create } from "zustand";
import { MessageItem } from "./sessionStore";

export interface SubagentDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  model: "inherit" | "flash_lite" | "flash" | "pro";
  workspaceMode: "inherit" | "branch" | "share";
  enableWriteTools: boolean;
  enableMcpTools: boolean;
  enableSubagentTools: boolean;
  state: "idle" | "running" | "waiting_for_input" | "waiting_for_message" | "errored" | "done";
  stateDetail?: string;
  conversationId?: string;
  createdAt: string;
}

export const DEFAULT_SUBAGENTS: SubagentDefinition[] = [
  {
    id: "sub-implementer",
    name: "build-implementer",
    role: "Autonomous TDD Implementer",
    description: "Sole implementer for team-build. Works ordered task list to make red tests pass under strict TDD without inline shortcuts.",
    systemPrompt: "You are the build-implementer. Apply technical plan changes, enforce red-first TDD, and apply mandatory structural cures.",
    model: "inherit",
    workspaceMode: "branch",
    enableWriteTools: true,
    enableMcpTools: true,
    enableSubagentTools: false,
    state: "idle",
    stateDetail: "Ready to implement plan tasks",
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
  {
    id: "sub-qa",
    name: "team-qa",
    role: "Quality Assurance Cartographer",
    description: "Evaluates diff coverage, maps test boundaries, identifies risk hotspots, and prevents silent regressions.",
    systemPrompt: "You are the team QA architect. Inspect changes, map test coverage, and author comprehensive assertions.",
    model: "pro",
    workspaceMode: "inherit",
    enableWriteTools: true,
    enableMcpTools: true,
    enableSubagentTools: false,
    state: "idle",
    stateDetail: "Monitoring workspace assertions",
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
  },
  {
    id: "sub-librarian",
    name: "librarian",
    role: "Durable Knowledge Curator",
    description: "Curates architectural decisions, system patterns, and reusable knowledge into shared persistent library.",
    systemPrompt: "You are the team librarian. Harvest durable technical insights, maintain single Table of Contents, and gate writes.",
    model: "flash",
    workspaceMode: "inherit",
    enableWriteTools: true,
    enableMcpTools: false,
    enableSubagentTools: false,
    state: "idle",
    stateDetail: "Table of Contents indexed",
    createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
  },
  {
    id: "sub-scout",
    name: "scout",
    role: "Deep Research & Codebase Scout",
    description: "Queries APIs, scrapes documentation, harvests raw data, and monitors external feeds based on research objectives.",
    systemPrompt: "You are a research scout. Query external sources, read dependencies, and extract structured findings.",
    model: "flash",
    workspaceMode: "inherit",
    enableWriteTools: false,
    enableMcpTools: true,
    enableSubagentTools: false,
    state: "idle",
    stateDetail: "Standing by for lookup targets",
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
  {
    id: "sub-red-team",
    name: "red-team-reviewer",
    role: "Critique & Edge-Case Analyst",
    description: "Attacks proposed designs, identifies architectural blind spots, stress-tests assumptions, and forces mitigation strategies.",
    systemPrompt: "You are the red team reviewer. Challenge assumptions, find vulnerability vectors, and demand concrete mitigations.",
    model: "pro",
    workspaceMode: "inherit",
    enableWriteTools: false,
    enableMcpTools: false,
    enableSubagentTools: false,
    state: "idle",
    stateDetail: "Review criteria active",
    createdAt: new Date(Date.now() - 3600000 * 36).toISOString(),
  },
  {
    id: "sub-cavecrew",
    name: "cavecrew-builder",
    role: "Surgical 1-2 File Modifier",
    description: "Surgical modifier for single-function rewrites, typos, and mechanical renames. Hard-refuses 3+ file scope.",
    systemPrompt: "You are the cavecrew surgical builder. Edit strictly 1-2 files, preserve formatting, and return caveman diff receipts.",
    model: "flash_lite",
    workspaceMode: "inherit",
    enableWriteTools: true,
    enableMcpTools: false,
    enableSubagentTools: false,
    state: "idle",
    stateDetail: "Scope limit: <=2 files",
    createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
  },
];

interface SubagentState {
  subagents: SubagentDefinition[];
  selectedSubagentId: string | null;
  activeChatAgentId: string | null;
  agentMessages: Record<string, MessageItem[]>;
  addSubagent: (agent: Omit<SubagentDefinition, "id" | "createdAt" | "state">) => SubagentDefinition;
  updateSubagent: (id: string, updates: Partial<SubagentDefinition>) => void;
  renameSubagent: (id: string, newName: string) => void;
  cloneSubagent: (id: string) => SubagentDefinition | null;
  deleteSubagent: (id: string) => void;
  setSelectedSubagentId: (id: string | null) => void;
  setActiveChatAgentId: (id: string | null) => void;
  setSubagentState: (id: string, state: SubagentDefinition["state"], detail?: string) => void;
  getAgentMessages: (agentId: string) => MessageItem[];
  setAgentMessages: (agentId: string, messages: MessageItem[]) => void;
  clearAgentMessages: (agentId: string) => void;
}

const STORAGE_KEY = "rho_lota_subagents_v1";
const MESSAGES_STORAGE_KEY = "rho_lota_agent_messages_v1";

const loadInitialSubagents = (): SubagentDefinition[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_SUBAGENTS;
};

const loadInitialAgentMessages = (): Record<string, MessageItem[]> => {
  try {
    const raw = localStorage.getItem(MESSAGES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
};

export const useSubagentStore = create<SubagentState>((set, get) => ({
  subagents: loadInitialSubagents(),
  selectedSubagentId: null,
  activeChatAgentId: null,
  agentMessages: loadInitialAgentMessages(),

  addSubagent: (agent) => {
    const newAgent: SubagentDefinition = {
      ...agent,
      id: `sub-${Date.now()}`,
      state: "idle",
      createdAt: new Date().toISOString(),
    };
    set((state) => {
      const updated = [newAgent, ...state.subagents];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { subagents: updated };
    });
    return newAgent;
  },

  updateSubagent: (id, updates) =>
    set((state) => {
      const updated = state.subagents.map((a) => (a.id === id ? { ...a, ...updates } : a));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { subagents: updated };
    }),

  renameSubagent: (id, newName) =>
    set((state) => {
      const cleanName = newName.trim().toLowerCase().replace(/\s+/g, "-");
      const updated = state.subagents.map((a) => (a.id === id ? { ...a, name: cleanName } : a));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { subagents: updated };
    }),

  cloneSubagent: (id) => {
    const target = get().subagents.find((a) => a.id === id);
    if (!target) return null;

    const cloned: SubagentDefinition = {
      ...target,
      id: `sub-${Date.now()}`,
      name: `${target.name}-copy`,
      role: `${target.role} (Copy)`,
      state: "idle",
      createdAt: new Date().toISOString(),
    };

    set((state) => {
      const updated = [cloned, ...state.subagents];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { subagents: updated };
    });

    return cloned;
  },

  deleteSubagent: (id) =>
    set((state) => {
      const updated = state.subagents.filter((a) => a.id !== id);
      const updatedMsgs = { ...state.agentMessages };
      delete updatedMsgs[id];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(updatedMsgs));
      } catch {}
      return {
        subagents: updated,
        agentMessages: updatedMsgs,
        selectedSubagentId: state.selectedSubagentId === id ? null : state.selectedSubagentId,
        activeChatAgentId: state.activeChatAgentId === id ? null : state.activeChatAgentId,
      };
    }),

  setSelectedSubagentId: (id) => set({ selectedSubagentId: id }),
  setActiveChatAgentId: (id) => set({ activeChatAgentId: id }),

  setSubagentState: (id, stateVal, detail) =>
    set((state) => {
      const updated = state.subagents.map((a) =>
        a.id === id ? { ...a, state: stateVal, stateDetail: detail || a.stateDetail } : a
      );
      return { subagents: updated };
    }),

  getAgentMessages: (agentId) => {
    const msgs = get().agentMessages[agentId];
    if (msgs && Array.isArray(msgs)) return msgs;
    return [];
  },

  setAgentMessages: (agentId, messages) =>
    set((state) => {
      const updated = { ...state.agentMessages, [agentId]: messages };
      try {
        localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { agentMessages: updated };
    }),

  clearAgentMessages: (agentId) =>
    set((state) => {
      const updated = { ...state.agentMessages, [agentId]: [] };
      try {
        localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { agentMessages: updated };
    }),
}));
