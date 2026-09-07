import { useThemeStore, ThemeMode, ThemeColors } from "../store/themeStore";
import { useProviderStore, PreamblePreset } from "../store/providerStore";
import { useAgentStore, AgentPersona } from "../store/agentStore";
import { useUserStore, UserProfile } from "../store/userStore";

export interface LotaPersistentSettings {
  version?: number;
  users?: {
    activeUserId?: string;
    users?: UserProfile[];
  };
  profile?: UserProfile; // Backward compatibility fallback
  theme?: {
    mode?: ThemeMode;
    preset?: string;
    darkColors?: ThemeColors;
    lightColors?: ThemeColors;
  };
  provider?: {
    activeProviderId?: string;
    activeModel?: string;
    preambles?: PreamblePreset[];
    activePreambleId?: string;
  };
  agents?: {
    personas?: AgentPersona[];
    activePersonaId?: string;
  };
  ui?: {
    sidebarCollapsed?: boolean;
    workbenchOpen?: boolean;
    statusbarOpen?: boolean;
  };
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export async function loadSettingsFromDisk(): Promise<LotaPersistentSettings | null> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const settings = await invoke<LotaPersistentSettings>("load_lota_settings");
      if (settings && typeof settings === "object" && Object.keys(settings).length > 0) {
        // Apply users & active profile
        if (settings.users && settings.users.users) {
          useUserStore.getState().initUsers({
            activeUserId: settings.users.activeUserId,
            users: settings.users.users,
          });
        } else if (settings.profile) {
          useUserStore.getState().initUsers({
            activeUserId: settings.profile.id,
            users: [settings.profile],
          });
        }

        // Apply theme settings
        if (settings.theme) {
          const { initTheme } = useThemeStore.getState();
          initTheme({
            mode: settings.theme.mode,
            preset: settings.theme.preset,
            darkColors: settings.theme.darkColors,
            lightColors: settings.theme.lightColors,
          });
        }

        // Apply provider settings
        if (settings.provider) {
          const { setActiveProviderAndModel, setActivePreambleId } = useProviderStore.getState();
          if (settings.provider.activeProviderId && settings.provider.activeModel) {
            setActiveProviderAndModel(settings.provider.activeProviderId, settings.provider.activeModel);
          }
          if (settings.provider.activePreambleId) {
            setActivePreambleId(settings.provider.activePreambleId);
          }
        }

        return settings;
      }
    } catch (err) {
      console.warn("Failed to load settings from ~/.config/rho/lota/settings.json:", err);
    }
  }
  return null;
}

export function scheduleSaveSettingsToDisk() {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const theme = useThemeStore.getState();
        const provider = useProviderStore.getState();
        const agent = useAgentStore.getState();
        const userState = useUserStore.getState();

        const payload: LotaPersistentSettings = {
          version: 1,
          users: {
            activeUserId: userState.activeUserId,
            users: userState.users,
          },
          profile: userState.getActiveUser(),
          theme: {
            mode: theme.mode,
            preset: theme.preset,
            darkColors: theme.darkColors,
            lightColors: theme.lightColors,
          },
          provider: {
            activeProviderId: provider.activeProviderId,
            activeModel: provider.activeModel,
            preambles: provider.preambles,
            activePreambleId: provider.activePreambleId,
          },
          agents: {
            personas: agent.personas,
            activePersonaId: agent.activePersonaId,
          },
        };

        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_lota_settings", { settings: payload });
      } catch (err) {
        console.warn("Failed to save settings to ~/.config/rho/lota/settings.json:", err);
      }
    }
  }, 400);
}
