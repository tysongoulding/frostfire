import { create } from "zustand";
import { SystemStatus } from "@/types/protocol";
import { APP_VERSION } from "../lib/version";

interface SettingsStore {
  systemStatus: SystemStatus | null;
  apiKeys: {
    gemini: string;
    anthropic: string;
    openai: string;
    groq: string;
    xai: string;
  };
  connectedIntegrations: {
    googleWorkspace: boolean;
    microsoft365: boolean;
  };
  setSystemStatus: (status: SystemStatus) => void;
  setApiKey: (provider: "gemini" | "anthropic" | "openai" | "groq" | "xai", key: string) => void;
  setIntegrationStatus: (provider: "googleWorkspace" | "microsoft365", connected: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  systemStatus: null,
  apiKeys: {
    gemini: "",
    anthropic: "",
    openai: "",
    groq: "",
    xai: "",
  },
  connectedIntegrations: {
    googleWorkspace: false,
    microsoft365: false,
  },

  setSystemStatus: (status) => set({ systemStatus: status }),
  setApiKey: (provider, key) =>
    set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } })),
  setIntegrationStatus: (provider, connected) =>
    set((state) => ({
      connectedIntegrations: { ...state.connectedIntegrations, [provider]: connected },
    })),
}));
