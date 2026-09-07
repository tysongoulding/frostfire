import { useState } from "react";
import {
  useThemeStore,
  THEME_PRESETS,
  ThemeMode,
  ThemeColors,
} from "../../store/themeStore";
import { Sun, Moon, Laptop, Palette, RotateCcw, Check } from "lucide-react";

export function AppearanceSettings() {
  const {
    mode,
    preset,
    darkColors,
    lightColors,
    setMode,
    setPreset,
    setColor,
    resetPreset,
  } = useThemeStore();

  const [activeTab, setActiveTab] = useState<"dark" | "light">("dark");
  const currentPalette = activeTab === "dark" ? darkColors : lightColors;

  const colorFields: { key: keyof ThemeColors; label: string; desc: string }[] = [
    { key: "background", label: "Background", desc: "Main workspace & background canvas" },
    { key: "card", label: "Card / Surface", desc: "Sidebar, headers, and container panels" },
    { key: "foreground", label: "Foreground / Text", desc: "Primary typography and text content" },
    { key: "border", label: "Border", desc: "Dividers, boundaries, and input borders" },
    { key: "accent", label: "Accent / Primary", desc: "Buttons, badges, and focus rings" },
    { key: "highlight", label: "Highlight / Selection", desc: "Text selection highlight, active badges, and focus markers" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <Palette className="w-4 h-4 text-[#58a6ff]" />
          <span>Appearance & Theme Settings</span>
        </h2>
        <p className="text-[#8b949e]">
          Configure theme mode, appearance presets, and custom hex color palettes.
        </p>
      </div>

      {/* Mode Selector */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
          Theme Mode
        </label>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "System", icon: Laptop },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isSelected = mode === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setMode(item.id as ThemeMode)}
                className={`p-3 rounded-lg border text-center transition flex flex-col items-center justify-center space-y-1.5 ${
                  isSelected
                    ? "bg-[#1f6feb]/20 border-blue-500 text-[#58a6ff] font-semibold"
                    : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-white"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme Presets */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between min-h-[24px]">
          <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
            Presets
          </label>
          {preset !== "custom" && (
            <button
              onClick={() => resetPreset(preset)}
              className="flex items-center space-x-1 text-[11px] text-[#8b949e] hover:text-white transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset to defaults</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {THEME_PRESETS.map((p) => {
            const isSelected = preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`p-3 rounded-xl border text-left transition h-[82px] flex flex-col justify-between ${
                  isSelected
                    ? "bg-[#0d1117] border-blue-500 shadow-sm shadow-blue-500/10"
                    : "bg-[#0d1117] border-[#30363d] hover:border-[#8b949e]"
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-semibold text-white text-xs">{p.name}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-blue-400" />}
                </div>

                {/* Swatch Previews */}
                <div className="flex space-x-1.5 w-full pt-1">
                  <div className="w-3.5 h-3.5 rounded-full border border-black/20 flex-shrink-0" style={{ backgroundColor: p.dark.background }} />
                  <div className="w-3.5 h-3.5 rounded-full border border-black/20 flex-shrink-0" style={{ backgroundColor: p.dark.card }} />
                  <div className="w-3.5 h-3.5 rounded-full border border-black/20 flex-shrink-0" style={{ backgroundColor: p.dark.accent }} />
                  <div className="w-3.5 h-3.5 rounded-full border border-black/20 flex-shrink-0" style={{ backgroundColor: p.dark.highlight }} />
                  <div className="w-3.5 h-3.5 rounded-full border border-black/20 flex-shrink-0" style={{ backgroundColor: p.dark.foreground }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hex Color Palette Customizer */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-[#30363d] pb-2">
          <div>
            <span className="font-semibold text-white text-xs">Custom Hex Palette</span>
            <span className="text-[11px] text-[#8b949e] ml-2">
              (Editing {activeTab} mode colors)
            </span>
          </div>

          <div className="flex bg-[#0d1117] p-0.5 rounded-lg border border-[#30363d]">
            <button
              onClick={() => setActiveTab("dark")}
              className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${
                activeTab === "dark" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-white"
              }`}
            >
              Dark Palette
            </button>
            <button
              onClick={() => setActiveTab("light")}
              className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${
                activeTab === "light" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-white"
              }`}
            >
              Light Palette
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {colorFields.map((field) => (
            <div
              key={field.key}
              className="flex items-center justify-between p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg"
            >
              <div>
                <div className="font-medium text-white text-xs">{field.label}</div>
                <div className="text-[10px] text-[#8b949e]">{field.desc}</div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={currentPalette[field.key]}
                  onChange={(e) => setColor(activeTab, field.key, e.target.value)}
                  className="w-7 h-7 rounded border border-[#30363d] bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={currentPalette[field.key]}
                  onChange={(e) => setColor(activeTab, field.key, e.target.value)}
                  className="w-20 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 font-mono text-[11px] text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
