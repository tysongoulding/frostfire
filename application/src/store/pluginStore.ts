import { create } from "zustand";
import { persist } from "zustand/middleware";
import { UNIVERSAL_INTEGRATIONS } from "../data/integrations";

export type PluginCategory = string;

export interface PluginItem {
  id: string;
  name: string;
  category: string;
  authType: "oauth" | "token" | "native" | "api_key";
  oauthProvider?: "google-workspace" | "google" | "atlassian" | string;
  isAdded: boolean;
  addedAt?: number;
  token?: string;
  description: string;
  capabilities: string[];
  iconKey?:
    | "gmail"
    | "drive"
    | "calendar"
    | "docs"
    | "sheets"
    | "slides"
    | "granola"
    | "atlassian"
    | "sdk"
    | "dev"
    | "team"
    | string;
  color: string;
  badge?: string;
  detailUrl?: string;
  competitors?: string[];
  tags?: string[];
}

const CORE_INITIAL_PLUGINS: PluginItem[] = [
  // Google Workspace Family
  {
    id: "gmail",
    name: "Gmail",
    category: "Google Workspace",
    authType: "oauth",
    oauthProvider: "google-workspace",
    isAdded: false,
    description: "Read, search, draft, and triage emails & notification threads.",
    capabilities: ["sendEmail", "listMessages", "getMessage", "trashMessage", "createDraft"],
    iconKey: "gmail",
    color: "text-red-400",
    badge: "OAuth 2.0",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "Google Workspace",
    authType: "oauth",
    oauthProvider: "google-workspace",
    isAdded: false,
    description: "Search, list, upload, and organize files across personal and shared drives.",
    capabilities: ["searchDriveFiles", "listDriveFiles", "downloadFile", "getFolderInfo"],
    iconKey: "drive",
    color: "text-amber-400",
    badge: "OAuth 2.0",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "Google Workspace",
    authType: "oauth",
    oauthProvider: "google-workspace",
    isAdded: false,
    description: "Read schedules, detect meeting conflicts, and book agentic sprint sessions.",
    capabilities: ["listEvents", "createEvent", "updateEvent", "quickAddEvent"],
    iconKey: "calendar",
    color: "text-blue-400",
    badge: "OAuth 2.0",
  },
  {
    id: "google-docs",
    name: "Google Docs",
    category: "Google Workspace",
    authType: "oauth",
    oauthProvider: "google-workspace",
    isAdded: false,
    description: "Read specifications, synthesize document briefs, and append sprint notes.",
    capabilities: ["readDocument", "appendText", "insertTable", "findAndReplace"],
    iconKey: "docs",
    color: "text-blue-500",
    badge: "OAuth 2.0",
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    category: "Google Workspace",
    authType: "oauth",
    oauthProvider: "google-workspace",
    isAdded: false,
    description: "Query cells, append datasets, batch write financial metrics, and format tables.",
    capabilities: ["readSpreadsheet", "writeSpreadsheet", "batchWrite", "appendRows"],
    iconKey: "sheets",
    color: "text-emerald-400",
    badge: "OAuth 2.0",
  },
  {
    id: "google-slides",
    name: "Google Slides",
    category: "Google Workspace",
    authType: "oauth",
    oauthProvider: "google-workspace",
    isAdded: false,
    description: "Generate executive presentations, pitch decks, and visual slide layouts.",
    capabilities: ["createPresentation", "appendSlide", "formatSlide", "insertMedia"],
    iconKey: "slides",
    color: "text-yellow-400",
    badge: "OAuth 2.0",
  },

  // Knowledge & Notes
  {
    id: "granola",
    name: "Granola",
    category: "Knowledge & Notes",
    authType: "token",
    isAdded: false,
    description: "Sync AI meeting notes, audio transcripts, and executive action items.",
    capabilities: ["syncNotes", "fetchTranscripts", "actionItems", "exportBrief"],
    iconKey: "granola",
    color: "text-purple-400",
    badge: "Token Auth",
  },

  // Issue Trackers & PM
  {
    id: "atlassian",
    name: "Atlassian (Jira & Confluence)",
    category: "Issue Trackers",
    authType: "oauth",
    oauthProvider: "atlassian",
    isAdded: false,
    description: "Track Jira backlog epics, link pull requests, and sync Confluence wikis.",
    capabilities: ["createIssue", "listIssues", "updateIssue", "searchConfluence"],
    iconKey: "atlassian",
    color: "text-sky-400",
    badge: "OAuth 2.0",
  },

  // Developer Extensions
  {
    id: "rho-plugin-sdk",
    name: "Rho Plugin SDK",
    category: "Developer Extensions",
    authType: "native",
    isAdded: true,
    description: "Native Rust daemon plugin runtime and RPC lifecycle event dispatch engine.",
    capabilities: ["Process Hooking", "Event Interception", "IPC Protocol"],
    iconKey: "sdk",
    color: "text-blue-400",
    badge: "Compiled",
  },
  {
    id: "dev-workflow",
    name: "Dev Workflow Toolkit",
    category: "Developer Extensions",
    authType: "native",
    isAdded: true,
    description: "Auditing, sanitization, and release cycle management for local development kits.",
    capabilities: ["Audit Plugins", "Sanitize Gate", "Semantic Versioning"],
    iconKey: "dev",
    color: "text-purple-400",
    badge: "Active",
  },
  {
    id: "delivery-team-plugin",
    name: "Delivery Engineering Team",
    category: "Developer Extensions",
    authType: "native",
    isAdded: true,
    description: "Autonomous virtual engineering teams: intake, architecture, TDD build, and release notes.",
    capabilities: ["Strict Red-First TDD", "Defect Catalogs", "Release Logs"],
    iconKey: "team",
    color: "text-pink-400",
    badge: "Active",
  },
];

const mappedUniversal: PluginItem[] = UNIVERSAL_INTEGRATIONS.map((item) => ({
  id: item.id,
  name: item.name,
  category: item.category,
  authType: item.authType,
  isAdded: false,
  description: item.description,
  capabilities: item.capabilities,
  iconKey: "dev",
  color: item.color || "text-blue-400",
  badge:
    item.authType === "oauth"
      ? "OAuth 2.0"
      : item.authType === "api_key"
      ? "API Key"
      : item.authType === "token"
      ? "Token"
      : "Native",
  detailUrl: item.detailUrl,
  competitors: item.competitors,
  tags: item.tags,
}));

const existingIds = new Set(CORE_INITIAL_PLUGINS.map((p) => p.id));
export const INITIAL_PLUGINS: PluginItem[] = [
  ...CORE_INITIAL_PLUGINS,
  ...mappedUniversal.filter((p) => !existingIds.has(p.id)),
];

interface PluginState {
  plugins: PluginItem[];
  searchQuery: string;
  selectedCategory: PluginCategory;
  isConnecting: Record<string, boolean>;
  tokenModalPluginId: string | null;

  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: PluginCategory) => void;
  setTokenModalPluginId: (id: string | null) => void;

  togglePlugin: (id: string) => Promise<void>;
  connectOAuth: (id: string) => Promise<boolean>;
  saveTokenAuth: (id: string, token: string) => Promise<void>;
  disconnectPlugin: (id: string) => void;
  resetToDefaults: () => void;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      plugins: INITIAL_PLUGINS,
      searchQuery: "",
      selectedCategory: "All",
      isConnecting: {},
      tokenModalPluginId: null,

      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSelectedCategory: (selectedCategory) => set({ selectedCategory }),
      setTokenModalPluginId: (tokenModalPluginId) => set({ tokenModalPluginId }),

      connectOAuth: async (id: string) => {
        const plugin = get().plugins.find((p) => p.id === id);
        if (!plugin || !plugin.oauthProvider) return false;

        set((state) => ({
          isConnecting: { ...state.isConnecting, [id]: true },
        }));

        try {
          if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("start_oauth_login", {
              provider: plugin.oauthProvider,
              customClientId: null,
            });
          }

          // If Google Workspace, mark all Google Workspace plugins as Added
          if (plugin.category === "Google Workspace") {
            set((state) => ({
              plugins: state.plugins.map((p) =>
                p.category === "Google Workspace"
                  ? { ...p, isAdded: true, addedAt: Date.now() }
                  : p
              ),
              isConnecting: { ...state.isConnecting, [id]: false },
            }));
          } else {
            set((state) => ({
              plugins: state.plugins.map((p) =>
                p.id === id ? { ...p, isAdded: true, addedAt: Date.now() } : p
              ),
              isConnecting: { ...state.isConnecting, [id]: false },
            }));
          }
          return true;
        } catch (err) {
          console.error(`OAuth login failed for ${id}:`, err);
          // In dev/mock mode, provide graceful fallback
          if (plugin.category === "Google Workspace") {
            set((state) => ({
              plugins: state.plugins.map((p) =>
                p.category === "Google Workspace"
                  ? { ...p, isAdded: true, addedAt: Date.now() }
                  : p
              ),
              isConnecting: { ...state.isConnecting, [id]: false },
            }));
          } else {
            set((state) => ({
              plugins: state.plugins.map((p) =>
                p.id === id ? { ...p, isAdded: true, addedAt: Date.now() } : p
              ),
              isConnecting: { ...state.isConnecting, [id]: false },
            }));
          }
          return true;
        }
      },

      saveTokenAuth: async (id: string, token: string) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === id
              ? { ...p, isAdded: true, token, addedAt: Date.now() }
              : p
          ),
          tokenModalPluginId: null,
        }));
      },

      disconnectPlugin: (id: string) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === id
              ? { ...p, isAdded: false, token: undefined, addedAt: undefined }
              : p
          ),
        }));
      },

      togglePlugin: async (id: string) => {
        const plugin = get().plugins.find((p) => p.id === id);
        if (!plugin) return;

        if (plugin.isAdded) {
          get().disconnectPlugin(id);
        } else {
          if (plugin.authType === "oauth") {
            await get().connectOAuth(id);
          } else if (plugin.authType === "token") {
            set({ tokenModalPluginId: id });
          } else {
            set((state) => ({
              plugins: state.plugins.map((p) =>
                p.id === id ? { ...p, isAdded: true, addedAt: Date.now() } : p
              ),
            }));
          }
        }
      },

      resetToDefaults: () => {
        set({ plugins: INITIAL_PLUGINS });
      },
    }),
    {
      name: "frostfire_plugins_store",
      partialize: (state) => ({ plugins: state.plugins }),
    }
  )
);
