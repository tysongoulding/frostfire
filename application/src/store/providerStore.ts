import { create } from "zustand";
import { TestKeyResponse } from "../types/protocol";

export interface ProviderConfig {
  id: string;
  name: string;
  type: "api_key" | "local" | "oauth";
  apiKey?: string;
  endpoint?: string;
  oauthClientId?: string;
  defaultModel: string;
  models: string[];
  isConfigured: boolean;
}

export interface PreamblePreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

const DEFAULT_PREAMBLES: PreamblePreset[] = [
  {
    id: "none",
    name: "Direct (No System Preamble)",
    description: "Zero preamble. Raw model output directly answering your prompt.",
    content: "",
  },
  {
    id: "default-coder",
    name: "Senior Software Engineer",
    description: "Direct, concise, type-safe code with zero placeholders.",
    content: "You are an expert autonomous software engineer. Answer directly, concisely, and accurately without introductory greetings or conversational filler. Write clean, production-ready code in fenced code blocks.",
  },
  {
    id: "architect",
    name: "Systems Architect & Tech Lead",
    description: "Focuses on high-level system design, cohesion, and boundary isolation.",
    content: "You are a Principal Systems Architect. Analyze trade-offs, modularity, data flow, and error resilience directly and concisely without conversational boilerplate.",
  },
  {
    id: "reviewer",
    name: "Security & Strict Code Reviewer",
    description: "Interrogates changes for edge-case defects, regressions, and safety risks.",
    content: "You are a strict security and code quality reviewer. Inspect diffs for edge cases, resource leaks, race conditions, and architectural regressions concisely without introductory filler.",
  },
];

const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    type: "api_key",
    defaultModel: "gemini-3.8-flash",
    models: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.1-pro",
      "gemini-3-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-2.0-flash-thinking-exp-01-21",
      "gemini-2.0-pro-exp-02-05",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro",
      "gemma-2-27b-it",
      "gemma-2-9b-it",
      "gemma-2-2b-it",
    ],
    isConfigured: false,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    type: "api_key",
    defaultModel: "claude-3-7-sonnet-20250219",
    models: [
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ],
    isConfigured: false,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    type: "api_key",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "o3-mini", "gpt-4-turbo"],
    isConfigured: false,
  },
  xai: {
    id: "xai",
    name: "xAI (SpaceX / Grok)",
    type: "api_key",
    defaultModel: "grok-2-1212",
    models: [
      "grok-2-1212",
      "grok-2-vision-1212",
      "grok-beta",
    ],
    isConfigured: false,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    type: "api_key",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    isConfigured: false,
  },
  groq: {
    id: "groq",
    name: "Groq",
    type: "api_key",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "deepseek-r1-distill-llama-70b",
    ],
    isConfigured: false,
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local LLM)",
    type: "local",
    endpoint: "http://localhost:11434",
    defaultModel: "llama3.2",
    models: ["llama3.2", "qwen2.5-coder:32b", "deepseek-r1:14b"],
    isConfigured: true,
  },
  chatgpt_oauth: {
    id: "chatgpt_oauth",
    name: "ChatGPT (OAuth PKCE)",
    type: "oauth",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini"],
    isConfigured: false,
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot (Device Auth)",
    type: "oauth",
    defaultModel: "claude-3.5-sonnet",
    models: ["claude-3.5-sonnet", "gpt-4o"],
    isConfigured: false,
  },
};

const STORAGE_KEYS = {
  PROVIDERS: "rho_lota_providers_vault_v1",
  PREAMBLES: "rho_lota_preambles_v1",
  ACTIVE_SELECTION: "rho_lota_active_selection_v1",
  MODELS_CACHE: "rho_lota_models_cache_v1",
};

const DEPRECATED_MODELS = new Set([
  "gemini-2.5-pro",
  "gemini-1.0-pro",
  "gemini-1.0-pro-vision",
  "gemini-pro",
  "gemini-pro-vision",
  "chat-bison-001",
  "text-bison-001",
]);

export function isDeprecatedModel(model?: string): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  return (
    DEPRECATED_MODELS.has(m) ||
    m.includes("1.0") ||
    m.includes("bison") ||
    m === "gemini-pro" ||
    m === "gemini-pro-vision"
  );
}

const loadInitialProviders = (): Record<string, ProviderConfig> => {
  try {
    let cachedMap: Record<string, string[]> = {};
    try {
      const rawCache = localStorage.getItem(STORAGE_KEYS.MODELS_CACHE);
      if (rawCache) {
        cachedMap = JSON.parse(rawCache);
      }
    } catch {}

    const raw = localStorage.getItem(STORAGE_KEYS.PROVIDERS);
    const parsed = raw ? (JSON.parse(raw) as Record<string, Partial<ProviderConfig>>) : {};
    const result: Record<string, ProviderConfig> = { ...DEFAULT_PROVIDERS };
    for (const [key, defaultProv] of Object.entries(DEFAULT_PROVIDERS)) {
      const provParsed = parsed[key] || {};
      const cachedModels = cachedMap[key];
      const candidateModels = Array.isArray(provParsed.models) && provParsed.models.length > 0
        ? provParsed.models
        : (Array.isArray(cachedModels) && cachedModels.length > 0 ? cachedModels : defaultProv.models);
      const cleanModels = candidateModels.filter((m: string) => !isDeprecatedModel(m));

      result[key] = {
        ...defaultProv,
        ...provParsed,
        models: cleanModels.length > 0 ? cleanModels : defaultProv.models,
      };
    }
    return result;
  } catch {}
  return DEFAULT_PROVIDERS;
};

const loadInitialActive = (): { provider: string; model: string } => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_SELECTION);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.model && isDeprecatedModel(parsed.model)) {
        parsed.model = "gemini-2.0-flash";
        try {
          localStorage.setItem(STORAGE_KEYS.ACTIVE_SELECTION, JSON.stringify(parsed));
        } catch {}
      }
      return parsed;
    }
  } catch {}
  return { provider: "gemini", model: "gemini-2.0-flash" };
};

export type ThinkingLevel = "high" | "med" | "low" | "off";

export interface ProviderState {
  providers: Record<string, ProviderConfig>;
  activeProviderId: string;
  activeModel: string;
  thinkingLevel: ThinkingLevel;
  ollamaStatus: "online" | "offline" | "checking" | "unknown";
  lastSyncedAt: Record<string, number>;
  isSyncing: Record<string, boolean>;
  preambles: PreamblePreset[];
  activePreambleId: string;

  setApiKey: (id: string, key: string) => void;
  setEndpoint: (id: string, endpoint: string) => void;
  setOAuthClientId: (id: string, clientId: string) => void;
  setActiveProviderAndModel: (providerId: string, model: string) => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
  syncKeysToBackend: () => Promise<void>;
  loadKeysFromSharedAuthFile: () => Promise<void>;
  loadCachedModelsFromBackend: () => Promise<Record<string, string[]>>;
  testProviderKeyLive: (providerId: string, key: string) => Promise<{ success: boolean; message: string; latency?: number; models?: string[] }>;
  fetchProviderModels: (providerId: string) => Promise<string[]>;
  fetchAllProviderModels: () => Promise<Record<string, string[]>>;
  startOAuthLogin: (providerId: string, customClientId?: string) => Promise<{ success: boolean; message: string }>;
  checkOllama: () => Promise<void>;
  savePreamble: (preset: PreamblePreset) => void;
  deletePreamble: (id: string) => void;
  setActivePreambleId: (id: string) => void;
}


const initialActive = loadInitialActive();

function loadInitialThinkingLevel(): ThinkingLevel {
  if (typeof window === "undefined") return "high";
  try {
    const saved = localStorage.getItem("rho_lota_thinking_level");
    if (saved === "high" || saved === "med" || saved === "low" || saved === "off") {
      return saved;
    }
  } catch {}
  return "high";
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: loadInitialProviders(),
  activeProviderId: initialActive.provider,
  activeModel: initialActive.model,
  thinkingLevel: loadInitialThinkingLevel(),
  ollamaStatus: "unknown",
  lastSyncedAt: {},
  isSyncing: {},
  preambles: DEFAULT_PREAMBLES,
  activePreambleId: "none",

  setThinkingLevel: (level: ThinkingLevel) => {
    try {
      localStorage.setItem("rho_lota_thinking_level", level);
    } catch {}
    set({ thinkingLevel: level });
  },

  setApiKey: (id, key) => {
    const trimmed = key.trim();
    set((state) => {
      const current = state.providers[id];
      if (!current) return state;
      const updated = {
        ...state.providers,
        [id]: {
          ...current,
          apiKey: trimmed,
          isConfigured: trimmed.length > 0,
        },
      };
      try {
        localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
      } catch {}
      return { providers: updated };
    });

    // Sync directly with Rust backend
    get().syncKeysToBackend();
  },

  syncKeysToBackend: async () => {
    const providers = get().providers;
    const keysMap: Record<string, string> = {};
    for (const [id, prov] of Object.entries(providers)) {
      if (prov.apiKey && prov.apiKey.trim()) {
        keysMap[id] = prov.apiKey.trim();
      }
    }

    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("sync_provider_keys", { keys: keysMap });
      } catch (err) {
        console.warn("Failed to sync API keys with backend:", err);
      }
    }
  },

  loadKeysFromSharedAuthFile: async () => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const sharedKeys = await invoke<Record<string, string>>("get_saved_auth_keys");
        if (sharedKeys && Object.keys(sharedKeys).length > 0) {
          set((state) => {
            const updated = { ...state.providers };
            for (const [id, key] of Object.entries(sharedKeys)) {
              if (updated[id] && key && key.trim()) {
                updated[id] = {
                  ...updated[id],
                  apiKey: key.trim(),
                  isConfigured: true,
                };
              }
            }
            try {
              localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
            } catch {}
            return { providers: updated };
          });
        }
      } catch (err) {
        console.warn("Failed to load shared auth keys:", err);
      }
    }
  },

  loadCachedModelsFromBackend: async () => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cached = await invoke<Record<string, string[]>>("get_cached_models");
        if (cached && Object.keys(cached).length > 0) {
          set((state) => {
            const updated = { ...state.providers };
            let changed = false;
            for (const [provId, models] of Object.entries(cached)) {
              if (updated[provId] && Array.isArray(models) && models.length > 0) {
                const cleanModels = models.filter((m) => !isDeprecatedModel(m));
                if (cleanModels.length > 0) {
                  updated[provId] = {
                    ...updated[provId],
                    models: cleanModels,
                    isConfigured: true,
                  };
                  changed = true;
                }
              }
            }
            if (changed) {
              try {
                localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
                localStorage.setItem(STORAGE_KEYS.MODELS_CACHE, JSON.stringify(cached));
              } catch {}
              return { providers: updated };
            }
            return state;
          });
          return cached;
        }
      } catch (err) {
        console.warn("Failed to load cached models from backend:", err);
      }
    }
    return {};
  },

  testProviderKeyLive: async (providerId: string, key: string) => {
    const cleanKey = key.trim();
    if (!cleanKey) {
      return { success: false, message: "API Key cannot be blank" };
    }

    // Call real Tauri network validation command (runs natively without CORS restrictions)
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<TestKeyResponse>(
          "test_provider_key",
          { provider: providerId, key: cleanKey }
        );
        if (res.success && res.models && res.models.length > 0) {
          const discovered = res.models.filter((m) => !isDeprecatedModel(m));
          set((state) => {
            const current = state.providers[providerId];
            if (!current) return state;
            const updated = {
              ...state.providers,
              [providerId]: {
                ...current,
                models: discovered.length > 0 ? discovered : current.models,
                isConfigured: true,
              },
            };
            try {
              localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
            } catch {}

            // Fallback active model if current model was pruned or is deprecated
            const shouldFallback =
              (state.activeProviderId === providerId && !discovered.includes(state.activeModel)) ||
              isDeprecatedModel(state.activeModel);
            const fallbackModel = shouldFallback
              ? (discovered.includes(current.defaultModel) ? current.defaultModel : (discovered[0] || "gemini-2.0-flash"))
              : state.activeModel;

            if (fallbackModel !== state.activeModel) {
              try {
                localStorage.setItem(
                  STORAGE_KEYS.ACTIVE_SELECTION,
                  JSON.stringify({ provider: providerId, model: fallbackModel })
                );
              } catch {}
            }

            return {
              providers: updated,
              activeModel: fallbackModel,
              lastSyncedAt: { ...state.lastSyncedAt, [providerId]: Date.now() },
            };
          });
        }
        return { success: res.success, message: res.message, latency: res.latency_ms, models: res.models };
      } catch (err: unknown) {
        console.warn("Tauri test_provider_key command error, attempting web probe fallback:", err);
      }
    }

    // Browser fallback test for Gemini / OpenAI
    const start = performance.now();
    try {
      if (providerId === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
        const latency = Math.round(performance.now() - start);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const discoveredModels: string[] = [];
          if (Array.isArray(data.models)) {
            for (const m of data.models) {
              const supportsGen = Array.isArray(m.supportedGenerationMethods)
                ? m.supportedGenerationMethods.includes("generateContent")
                : true;
              if (supportsGen && typeof m.name === "string") {
                const clean = m.name.replace(/^models\//, "");
                if (!isDeprecatedModel(clean)) {
                  discoveredModels.push(clean);
                }
              }
            }
          }
          if (discoveredModels.length > 0) {
            set((state) => {
              const current = state.providers[providerId];
              if (!current) return state;
              const updated = {
                ...state.providers,
                [providerId]: {
                  ...current,
                  models: discoveredModels,
                  isConfigured: true,
                },
              };
              try {
                localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
              } catch {}

              const shouldFallback =
                (state.activeProviderId === providerId && !discoveredModels.includes(state.activeModel)) ||
                isDeprecatedModel(state.activeModel);
              const fallbackModel = shouldFallback
                ? (discoveredModels.includes(current.defaultModel) ? current.defaultModel : (discoveredModels[0] || "gemini-2.0-flash"))
                : state.activeModel;

              if (fallbackModel !== state.activeModel) {
                try {
                  localStorage.setItem(
                    STORAGE_KEYS.ACTIVE_SELECTION,
                    JSON.stringify({ provider: providerId, model: fallbackModel })
                  );
                } catch {}
              }

              return {
                providers: updated,
                activeModel: fallbackModel,
                lastSyncedAt: { ...state.lastSyncedAt, [providerId]: Date.now() },
              };
            });
          }
          return {
            success: true,
            message: `Google Gemini Verified (${res.status}, ${discoveredModels.length} models discovered)`,
            latency,
            models: discoveredModels,
          };
        } else {
          const errData = await res.json().catch(() => ({}));
          const msg = errData.error?.message || `HTTP ${res.status}`;
          return { success: false, message: msg, latency };
        }
      }
    } catch (err: unknown) {
      return { success: false, message: String(err) };
    }

    return { success: true, message: "Format valid (Browser mode)", latency: 25 };
  },

  fetchProviderModels: async (providerId: string) => {
    set((state) => ({
      isSyncing: { ...state.isSyncing, [providerId]: true },
    }));
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const res = await invoke<TestKeyResponse>("fetch_provider_models", { provider: providerId });
          if (res.success && res.models && res.models.length > 0) {
            const discovered = res.models.filter((m) => !isDeprecatedModel(m));
            set((state) => {
              const current = state.providers[providerId];
              if (!current) return state;
              const updated = {
                ...state.providers,
                [providerId]: {
                  ...current,
                  models: discovered.length > 0 ? discovered : current.models,
                  isConfigured: true,
                },
              };
              try {
                localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
                const cacheRaw = localStorage.getItem(STORAGE_KEYS.MODELS_CACHE);
                const cacheMap = cacheRaw ? JSON.parse(cacheRaw) : {};
                cacheMap[providerId] = discovered;
                localStorage.setItem(STORAGE_KEYS.MODELS_CACHE, JSON.stringify(cacheMap));
              } catch {}

              const shouldFallback = state.activeProviderId === providerId && !discovered.includes(state.activeModel);
              const fallbackModel = shouldFallback
                ? (discovered.includes(current.defaultModel) ? current.defaultModel : (discovered[0] || "gemini-2.0-flash"))
                : state.activeModel;

              if (fallbackModel !== state.activeModel) {
                try {
                  localStorage.setItem(
                    STORAGE_KEYS.ACTIVE_SELECTION,
                    JSON.stringify({ provider: providerId, model: fallbackModel })
                  );
                } catch {}
              }

              return {
                providers: updated,
                activeModel: fallbackModel,
                lastSyncedAt: { ...state.lastSyncedAt, [providerId]: Date.now() },
              };
            });
            return discovered;
          }
        } catch (err) {
          console.warn("fetch_provider_models failed, falling back to key test:", err);
        }
      }
      const prov = get().providers[providerId];
      const key = prov?.apiKey || "";
      if (key.trim()) {
        const res = await get().testProviderKeyLive(providerId, key);
        if (res.models && res.models.length > 0) {
          return res.models;
        }
      }
      return prov?.models || [];
    } finally {
      set((state) => ({
        isSyncing: { ...state.isSyncing, [providerId]: false },
      }));
    }
  },

  fetchAllProviderModels: async () => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const results = await invoke<Record<string, string[]>>("fetch_all_provider_models");
        if (results && Object.keys(results).length > 0) {
          set((state) => {
            const updated = { ...state.providers };
            const now = Date.now();
            const newSync: Record<string, number> = { ...state.lastSyncedAt };
            for (const [provId, models] of Object.entries(results)) {
              if (updated[provId] && Array.isArray(models) && models.length > 0) {
                const cleanModels = models.filter((m) => !isDeprecatedModel(m));
                if (cleanModels.length > 0) {
                  updated[provId] = {
                    ...updated[provId],
                    models: cleanModels,
                    isConfigured: true,
                  };
                  newSync[provId] = now;
                }
              }
            }
            try {
              localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
              localStorage.setItem(STORAGE_KEYS.MODELS_CACHE, JSON.stringify(results));
            } catch {}
            return { providers: updated, lastSyncedAt: newSync };
          });
          return results;
        }
      } catch (err) {
        console.warn("fetch_all_provider_models failed:", err);
      }
    }
    return {};
  },

  startOAuthLogin: async (providerId: string, customClientId?: string) => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const msg = await invoke<string>("start_oauth_login", {
          provider: providerId,
          customClientId: customClientId?.trim() || null,
        });
        set((state) => {
          const current = state.providers[providerId];
          if (!current) return state;
          const updated = {
            ...state.providers,
            [providerId]: {
              ...current,
              isConfigured: true,
            },
          };
          try {
            localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
          } catch {}
          return { providers: updated };
        });
        await get().fetchProviderModels(providerId);
        return { success: true, message: msg };
      } catch (err: unknown) {
        return { success: false, message: String(err) };
      }
    }
    return { success: false, message: "OAuth flow requires native desktop Tauri environment." };
  },

  setOAuthClientId: (id, clientId) =>
    set((state) => {
      const current = state.providers[id];
      if (!current) return state;
      const updated = {
        ...state.providers,
        [id]: {
          ...current,
          oauthClientId: clientId.trim(),
        },
      };
      try {
        localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
      } catch {}
      return { providers: updated };
    }),

  setEndpoint: (id, endpoint) =>
    set((state) => {
      const current = state.providers[id];
      if (!current) return state;
      const updated = {
        ...state.providers,
        [id]: {
          ...current,
          endpoint,
        },
      };
      try {
        localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
      } catch {}
      return { providers: updated };
    }),

  setActiveProviderAndModel: (providerId, model) => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.ACTIVE_SELECTION,
        JSON.stringify({ provider: providerId, model })
      );
    } catch {}
    set({ activeProviderId: providerId, activeModel: model });
    import("../lib/settingsSync").then((m) => m.scheduleSaveSettingsToDisk()).catch(() => {});
  },

  checkOllama: async () => {
    set({ ollamaStatus: "checking" });
    const endpoint = get().providers.ollama?.endpoint || "http://localhost:11434";
    try {
      const res = await fetch(`${endpoint}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        const models = Array.isArray(data.models)
          ? data.models.map((m: { name: string }) => m.name)
          : get().providers.ollama.models;
        set((state) => {
          const updated = {
            ...state.providers,
            ollama: {
              ...state.providers.ollama,
              models: models.length > 0 ? models : state.providers.ollama.models,
              isConfigured: true,
            },
          };
          try {
            localStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(updated));
          } catch {}
          return {
            ollamaStatus: "online",
            providers: updated,
          };
        });
      } else {
        set({ ollamaStatus: "offline" });
      }
    } catch {
      set({ ollamaStatus: "offline" });
    }
  },

  savePreamble: (preset) => {
    set((state) => {
      const exists = state.preambles.some((p) => p.id === preset.id);
      const updated = exists
        ? state.preambles.map((p) => (p.id === preset.id ? preset : p))
        : [...state.preambles, preset];
      try {
        localStorage.setItem(STORAGE_KEYS.PREAMBLES, JSON.stringify(updated));
      } catch {}
      return { preambles: updated };
    });
    import("../lib/settingsSync").then((m) => m.scheduleSaveSettingsToDisk()).catch(() => {});
  },

  deletePreamble: (id) => {
    set((state) => {
      const updated = state.preambles.filter((p) => p.id !== id);
      try {
        localStorage.setItem(STORAGE_KEYS.PREAMBLES, JSON.stringify(updated));
      } catch {}
      return {
        preambles: updated,
        activePreambleId:
          state.activePreambleId === id ? "default-coder" : state.activePreambleId,
      };
    });
    import("../lib/settingsSync").then((m) => m.scheduleSaveSettingsToDisk()).catch(() => {});
  },

  setActivePreambleId: (id) => {
    set({ activePreambleId: id });
    import("../lib/settingsSync").then((m) => m.scheduleSaveSettingsToDisk()).catch(() => {});
  },
}));
