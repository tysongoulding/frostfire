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

export const DEFAULT_USER_PROFILE: UserProfile = {
  id: "user-default",
  name: "Default Operator",
  email: "operator@frostfire.local",
  role: "System Operator",
  bio: "Autonomous Agent Orchestrator",
  customInstructions: "Prefer concise explanations and clean, modular code. Respect project boundaries.",
  vmHost: "44.242.94.86",
  agentPorts: { agent1: 6080, agent2: 6081, agent3: 6082 },
  execPort: 3000,
  isDefault: true,
  createdAt: new Date().toISOString(),
};

const STORAGE_KEY = "frostfire-users-v1";

function loadInitialUsers(): { activeUserId: string; users: UserProfile[] } {
  if (typeof window === "undefined") {
    return { activeUserId: DEFAULT_USER_PROFILE.id, users: [DEFAULT_USER_PROFILE] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.users) && parsed.users.length > 0) {
        const activeId =
          parsed.activeUserId && parsed.users.some((u: UserProfile) => u.id === parsed.activeUserId)
            ? parsed.activeUserId
            : parsed.users[0].id;
        return { activeUserId: activeId, users: parsed.users };
      }
    }
  } catch {}
  return { activeUserId: DEFAULT_USER_PROFILE.id, users: [DEFAULT_USER_PROFILE] };
}

const initial = loadInitialUsers();

export const useUserStore = create<UserState>((set, get) => ({
  activeUserId: initial.activeUserId,
  users: initial.users,

  getActiveUser: () => {
    const { users, activeUserId } = get();
    return users.find((u) => u.id === activeUserId) || users[0] || DEFAULT_USER_PROFILE;
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
    if (users.length <= 1) return;

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
    const loadedUsers = data.users && Array.isArray(data.users) && data.users.length > 0
      ? data.users
      : [DEFAULT_USER_PROFILE];
    const activeId =
      data.activeUserId && loadedUsers.some((u) => u.id === data.activeUserId)
        ? data.activeUserId
        : loadedUsers[0].id;

    set({
      users: loadedUsers,
      activeUserId: activeId,
    });
    persist({ activeUserId: activeId, users: loadedUsers });
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
