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

export const DEFAULT_USERS: UserProfile[] = [
  {
    id: "user-1",
    name: "User1",
    email: "user1@frostfire.cloud",
    role: "User 1",
    bio: "Workspace User 1",
    customInstructions: "Prefer concise explanations and clean, modular code. Respect project boundaries.",
    vmHost: "35.89.125.63",
    agentPorts: { agent1: 6080, agent2: 6081, agent3: 6082 },
    execPort: 1339,
    isDefault: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "user-2",
    name: "user2",
    email: "user2@frostfire.cloud",
    role: "User 2",
    bio: "Workspace User 2",
    customInstructions: "Prefer concise explanations and clean, modular code. Respect project boundaries.",
    vmHost: "35.89.125.63",
    agentPorts: { agent1: 6083, agent2: 6084, agent3: 6085 },
    execPort: 1339,
    isDefault: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "user-3",
    name: "user3",
    email: "user3@frostfire.cloud",
    role: "User 3",
    bio: "Workspace User 3",
    customInstructions: "Prefer concise explanations and clean, modular code. Respect project boundaries.",
    vmHost: "35.89.125.63",
    agentPorts: { agent1: 6086, agent2: 6087, agent3: 6088 },
    execPort: 1339,
    isDefault: false,
    createdAt: new Date().toISOString(),
  },
];

export const DEFAULT_USER_PROFILE: UserProfile = DEFAULT_USERS[0];

const STORAGE_KEY = "frostfire-users-v3";

function loadInitialUsers(): { activeUserId: string; users: UserProfile[] } {
  if (typeof window === "undefined") {
    return { activeUserId: DEFAULT_USERS[0].id, users: DEFAULT_USERS };
  }
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem("frostfire-users-v2") ||
      localStorage.getItem("frostfire-users-v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.users) && parsed.users.length > 0) {
        const targetNames = ["User1", "user2", "user3"];
        const targetEmails = ["user1@frostfire.cloud", "user2@frostfire.cloud", "user3@frostfire.cloud"];
        const migrated: UserProfile[] = DEFAULT_USERS.map((defUser, idx) => {
          const existing = parsed.users[idx] || {};
          return {
            ...defUser,
            ...existing,
            id: defUser.id,
            name: targetNames[idx],
            email: targetEmails[idx],
            vmHost: (!existing.vmHost || existing.vmHost === "44.242.94.86") ? "35.89.125.63" : existing.vmHost,
            execPort: (!existing.execPort || existing.execPort === 3000 || existing.execPort === 443) ? 1339 : existing.execPort,
          };
        });
        const activeId =
          parsed.activeUserId && migrated.some((u) => u.id === parsed.activeUserId)
            ? parsed.activeUserId
            : migrated[0].id;
        return { activeUserId: activeId, users: migrated };
      }
    }
  } catch {}
  return { activeUserId: DEFAULT_USERS[0].id, users: DEFAULT_USERS };
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
    let loadedUsers = data.users && Array.isArray(data.users) && data.users.length > 0
      ? data.users
      : DEFAULT_USERS;
    const targetNames = ["User1", "user2", "user3"];
    const targetEmails = ["user1@frostfire.cloud", "user2@frostfire.cloud", "user3@frostfire.cloud"];
    loadedUsers = DEFAULT_USERS.map((defUser, idx) => {
      const existing = loadedUsers[idx] || {};
      return {
        ...defUser,
        ...existing,
        id: defUser.id,
        name: targetNames[idx] || defUser.name,
        email: targetEmails[idx] || defUser.email,
      };
    });
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
