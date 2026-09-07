import { create } from "zustand";

export interface UserAgentPorts {
  agent1: number;
  agent2: number;
  agent3: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  bio: string;
  customInstructions: string;
  vmHost: string;
  agentPorts: UserAgentPorts;
  execPort?: number;
  isDefault?: boolean;
  createdAt: string;
}

interface UserState {
  activeUserId: string;
  users: UserProfile[];
  getActiveUser: () => UserProfile;
  addUser: (profile: Partial<UserProfile>) => UserProfile;
  updateUser: (id: string, updates: Partial<UserProfile>) => void;
  updateUserVmConfig: (
    id: string,
    config: { vmHost: string; agentPorts: UserAgentPorts; execPort?: number }
  ) => void;
  deleteUser: (id: string) => void;
  switchUser: (id: string) => void;
  initUsers: (data: { activeUserId?: string; users?: UserProfile[] }) => void;
}

export const POC_USERS: UserProfile[] = [
  {
    id: "user1",
    name: "Tyson Goulding",
    email: "tyson@frostfire.ai",
    role: "Network Architect",
    bio: "Network Architect & Multi-Agent Orchestrator",
    customInstructions: "Prefer concise explanations and clean, modular code. Respect project boundaries.",
    vmHost: "44.242.94.86",
    agentPorts: { agent1: 6080, agent2: 6081, agent3: 6082 },
    execPort: 3000,
    isDefault: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "user2",
    name: "Taylor Goulding",
    email: "taylor@frostfire.ai",
    role: "Director of Operations",
    bio: "Director of Operations & Workflow Automation Lead",
    customInstructions: "Prefer rapid prototyping, practical scripts, and modular components.",
    vmHost: "44.242.94.86",
    agentPorts: { agent1: 6083, agent2: 6084, agent3: 6085 },
    execPort: 3000,
    isDefault: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "user3",
    name: "Cason Adams",
    email: "cason@frostfire.ai",
    role: "Principal Software Engineer",
    bio: "Principal Software Engineer & Autonomous Verification Lead",
    customInstructions: "Focus on automated test passes, edge cases, and tamper-evident logging.",
    vmHost: "44.242.94.86",
    agentPorts: { agent1: 6086, agent2: 6087, agent3: 6088 },
    execPort: 3000,
    isDefault: false,
    createdAt: new Date().toISOString(),
  },
];

const STORAGE_KEY = "frostfire-poc-users-v8";

function loadInitialUsers(): { activeUserId: string; users: UserProfile[] } {
  if (typeof window === "undefined") {
    return { activeUserId: POC_USERS[0].id, users: POC_USERS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.users) && parsed.users.length > 0) {
        // Ensure canonical POC users are always in the list
        const mergedUsers = POC_USERS.map((poc) => {
          const match = parsed.users.find((u: UserProfile) => u.id === poc.id || u.name === poc.name);
          const safeHost = (!match?.vmHost || match.vmHost === '44.242.94.87' || match.vmHost === '44.242.94.88')
            ? poc.vmHost
            : match.vmHost;
          return match
            ? {
                ...poc,
                ...match,
                id: poc.id,
                name: poc.name,
                role: poc.role,
                vmHost: safeHost,
                agentPorts: match.agentPorts || poc.agentPorts,
                execPort: match.execPort || poc.execPort,
              }
            : poc;
        });
        const extraUsers = parsed.users.filter(
          (u: UserProfile) => !POC_USERS.some((poc) => poc.id === u.id || poc.name === u.name)
        );
        const finalUsers = [...mergedUsers, ...extraUsers];
        const activeId = parsed.activeUserId && finalUsers.some((u) => u.id === parsed.activeUserId)
          ? parsed.activeUserId
          : POC_USERS[0].id;
        return { activeUserId: activeId, users: finalUsers };
      }
    }
  } catch {}
  return { activeUserId: POC_USERS[0].id, users: POC_USERS };
}

const initial = loadInitialUsers();

export const useUserStore = create<UserState>((set, get) => ({
  activeUserId: initial.activeUserId,
  users: initial.users,

  getActiveUser: () => {
    const { users, activeUserId } = get();
    return users.find((u) => u.id === activeUserId) || users[0] || POC_USERS[0];
  },

  addUser: (profile) => {
    const newUser: UserProfile = {
      id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: profile.name || "New Developer",
      email: profile.email || "developer@local",
      role: profile.role || "Software Engineer",
      bio: profile.bio || "Building agentic systems",
      customInstructions: profile.customInstructions || "Prefer concise answers.",
      vmHost: profile.vmHost || "44.242.94.86",
      agentPorts: profile.agentPorts || { agent1: 6080, agent2: 6081, agent3: 6082 },
      execPort: profile.execPort || 3000,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      users: [...state.users, newUser],
      activeUserId: newUser.id,
    }));

    persist(get());
    return newUser;
  },

  updateUser: (id, updates) => {
    set((state) => ({
      users: state.users.map((u) => (u.id === id ? { ...u, ...updates } : u)),
    }));
    persist(get());
  },

  updateUserVmConfig: (id, config) => {
    set((state) => ({
      users: state.users.map((u) =>
        u.id === id
          ? {
              ...u,
              vmHost: config.vmHost,
              agentPorts: { ...u.agentPorts, ...config.agentPorts },
              execPort: config.execPort ?? u.execPort ?? 3000,
            }
          : u
      ),
    }));
    persist(get());
  },

  deleteUser: (id) => {
    const { users, activeUserId } = get();
    if (users.length <= 3) return; // Keep at least the 3 POC users

    const filtered = users.filter((u) => u.id !== id);
    const nextActive = activeUserId === id ? filtered[0].id : activeUserId;

    set({ users: filtered, activeUserId: nextActive });
    persist(get());
  },

  switchUser: (id) => {
    set({ activeUserId: id });
    persist(get());
  },

  initUsers: (data) => {
    const loadedUsers = data.users && Array.isArray(data.users) ? data.users : [];
    // Ensure all 3 canonical POC users are always in the list
    const mergedUsers = POC_USERS.map((poc) => {
      const match = loadedUsers.find((u: UserProfile) => u.id === poc.id || u.name === poc.name);
      const safeHost = (!match?.vmHost || match.vmHost === '44.242.94.87' || match.vmHost === '44.242.94.88')
        ? poc.vmHost
        : match.vmHost;
      return match
        ? {
            ...poc,
            ...match,
            id: poc.id,
            name: poc.name,
            role: poc.role,
            vmHost: safeHost,
            agentPorts: match.agentPorts || poc.agentPorts,
            execPort: match.execPort || poc.execPort,
          }
        : poc;
    });
    const extraUsers = loadedUsers.filter(
      (u: UserProfile) => !POC_USERS.some((poc) => poc.id === u.id || poc.name === u.name)
    );
    const finalUsers = [...mergedUsers, ...extraUsers];
    const activeId = data.activeUserId && finalUsers.some((u) => u.id === data.activeUserId)
      ? data.activeUserId
      : POC_USERS[0].id;

    set({
      users: finalUsers,
      activeUserId: activeId,
    });
    persist({ activeUserId: activeId, users: finalUsers });
  },
}));

function persist(state: { activeUserId: string; users: UserProfile[] }) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeUserId: state.activeUserId,
        users: state.users,
      })
    );
    import("../lib/settingsSync").then((m) => m.scheduleSaveSettingsToDisk()).catch(() => {});
  } catch {}
}
