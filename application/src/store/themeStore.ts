import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  border: string;
  accent: string;
  highlight: string;
}

export interface PresetTheme {
  id: string;
  name: string;
  dark: ThemeColors;
  light: ThemeColors;
}

export const THEME_PRESETS: PresetTheme[] = [
  {
    id: "frostfire",
    name: "Frostfire (Default)",
    dark: {
      background: "#121212",
      foreground: "#F5F5F5",
      card: "#1E1E1E",
      border: "#2E2E2E",
      accent: "#38BDF8",
      highlight: "#FF3366",
    },
    light: {
      background: "#F5F5F5",
      foreground: "#171717",
      card: "#FFFFFF",
      border: "#E5E5E5",
      accent: "#0284C7",
      highlight: "#E11D48",
    },
  },
  {
    id: "frost",
    name: "Frost (Blue Focus)",
    dark: {
      background: "#0A0E17",
      foreground: "#FFFFFF",
      card: "#121B2D",
      border: "#1E2E4A",
      accent: "#38BDF8",
      highlight: "#EF4444",
    },
    light: {
      background: "#F0F9FF",
      foreground: "#0C4A6E",
      card: "#FFFFFF",
      border: "#BAE6FD",
      accent: "#0284C7",
      highlight: "#DC2626",
    },
  },
  {
    id: "fire",
    name: "Fire (Red Focus)",
    dark: {
      background: "#0F0C10",
      foreground: "#F8FAFC",
      card: "#1B141D",
      border: "#322135",
      accent: "#FF2A5F",
      highlight: "#00D8F6",
    },
    light: {
      background: "#FFF1F2",
      foreground: "#881337",
      card: "#FFFFFF",
      border: "#FECDD3",
      accent: "#E11D48",
      highlight: "#0284C7",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    dark: {
      background: "#282a36",
      foreground: "#f8f8f2",
      card: "#44475a",
      border: "#6272a4",
      accent: "#bd93f9",
      highlight: "#ff79c6",
    },
    light: {
      background: "#f8f8f2",
      foreground: "#282a36",
      card: "#e8e8e8",
      border: "#6272a4",
      accent: "#bd93f9",
      highlight: "#ff79c6",
    },
  },
  {
    id: "nord",
    name: "Nord Frost",
    dark: {
      background: "#2e3440",
      foreground: "#eceff4",
      card: "#3b4252",
      border: "#4c566a",
      accent: "#88c0d0",
      highlight: "#81a1c1",
    },
    light: {
      background: "#eceff4",
      foreground: "#2e3440",
      card: "#e5e9f0",
      border: "#d8dee9",
      accent: "#5e81ac",
      highlight: "#88c0d0",
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    dark: {
      background: "#08090c",
      foreground: "#00f0ff",
      card: "#12151c",
      border: "#ff003c",
      accent: "#ffe600",
      highlight: "#ff003c",
    },
    light: {
      background: "#f0f2f5",
      foreground: "#08090c",
      card: "#ffffff",
      border: "#ff003c",
      accent: "#00f0ff",
      highlight: "#ffe600",
    },
  },
];

interface ThemeState {
  mode: ThemeMode;
  preset: string;
  darkColors: ThemeColors;
  lightColors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  setPreset: (presetId: string) => void;
  setColor: (target: "dark" | "light", key: keyof ThemeColors, value: string) => void;
  resetPreset: (presetId: string) => void;
  initTheme: (data: Partial<{ mode: ThemeMode; preset: string; darkColors: Partial<ThemeColors>; lightColors: Partial<ThemeColors> }>) => void;
}

const STORAGE_KEY = "frostfire-theme";

function loadInitialState() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

const saved = loadInitialState();
const initialPreset = saved?.preset || "frostfire";
const matchedPreset = THEME_PRESETS.find((p) => p.id === initialPreset) || THEME_PRESETS[0];

const initial = {
  mode: (saved?.mode || "dark") as ThemeMode,
  preset: initialPreset,
  darkColors: (saved?.preset === "custom" && saved?.darkColors) ? { ...matchedPreset.dark, ...saved.darkColors } : { ...matchedPreset.dark },
  lightColors: (saved?.preset === "custom" && saved?.lightColors) ? { ...matchedPreset.light, ...saved.lightColors } : { ...matchedPreset.light },
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initial.mode,
  preset: initial.preset,
  darkColors: { ...initial.darkColors },
  lightColors: { ...initial.lightColors },

  setMode: (mode: ThemeMode) => {
    set({ mode });
    persist(get());
    applyThemeToDocument();
  },

  setPreset: (presetId: string) => {
    const found = THEME_PRESETS.find((p) => p.id === presetId);
    if (found) {
      set({
        preset: presetId,
        darkColors: { ...found.dark },
        lightColors: { ...found.light },
      });
      persist(get());
      applyThemeToDocument();
    }
  },

  setColor: (target, key, value) => {
    set((state) => ({
      preset: "custom",
      ...(target === "dark"
        ? { darkColors: { ...state.darkColors, [key]: value } }
        : { lightColors: { ...state.lightColors, [key]: value } }),
    }));
    persist(get());
    applyThemeToDocument();
  },

  resetPreset: (presetId: string) => {
    const found = THEME_PRESETS.find((p) => p.id === presetId);
    if (found) {
      set({
        preset: presetId,
        darkColors: { ...found.dark },
        lightColors: { ...found.light },
      });
      persist(get());
      applyThemeToDocument();
    }
  },

  initTheme: (data) => {
    const presetId = data.preset;
    const foundPreset = presetId ? THEME_PRESETS.find((p) => p.id === presetId) : null;
    set((state) => ({
      mode: data.mode ?? state.mode,
      preset: data.preset ?? state.preset,
      darkColors: foundPreset
        ? { ...foundPreset.dark }
        : data.darkColors
        ? { ...state.darkColors, ...data.darkColors }
        : state.darkColors,
      lightColors: foundPreset
        ? { ...foundPreset.light }
        : data.lightColors
        ? { ...state.lightColors, ...data.lightColors }
        : state.lightColors,
    }));
    applyThemeToDocument();
  },
}));

function persist(state: ThemeState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: state.mode,
        preset: state.preset,
        darkColors: state.darkColors,
        lightColors: state.lightColors,
      })
    );
    import("../lib/settingsSync").then((m) => m.scheduleSaveSettingsToDisk()).catch(() => {});
  } catch {}
}

export function applyThemeToDocument() {
  if (typeof window === "undefined") return;
  const state = useThemeStore.getState();
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = state.mode === "system" ? systemPrefersDark : state.mode === "dark";

  const root = document.documentElement;
  const colors = isDark ? state.darkColors : state.lightColors;

  const activeMode = isDark ? "dark" : "light";
  if (isDark) {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }

  root.setAttribute("data-mode", activeMode);
  root.setAttribute("data-theme", state.preset || "frostfire");

  // Determine appropriate text-muted for the theme and mode
  let textMuted = isDark ? "#A3A3A3" : "#737373";
  if (state.preset === "frost") {
    textMuted = isDark ? "#8B9BB4" : "#0369A1";
  } else if (state.preset === "fire") {
    textMuted = isDark ? "#A198A7" : "#9F1239";
  }

  root.style.setProperty("--font-main", "'Ubuntu', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif");
  root.style.setProperty("--bg", colors.background);
  root.style.setProperty("--surface", colors.card);
  root.style.setProperty("--text-primary", colors.foreground);
  root.style.setProperty("--text-muted", textMuted);
  root.style.setProperty("--accent-primary", colors.accent);
  root.style.setProperty("--accent-secondary", colors.highlight || colors.accent);
  root.style.setProperty("--border", colors.border);

  root.style.setProperty("--bg-main", colors.background);
  root.style.setProperty("--bg-card", colors.card);
  root.style.setProperty("--text-main", colors.foreground);
  root.style.setProperty("--border-main", colors.border);
  root.style.setProperty("--color-accent", colors.accent);
  root.style.setProperty("--color-highlight", colors.highlight || colors.accent);

  if (document.body) {
    document.body.style.backgroundColor = colors.background;
    document.body.style.color = colors.foreground;
  }
}
