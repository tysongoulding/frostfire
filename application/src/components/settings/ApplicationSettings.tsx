import { Laptop, Keyboard, RotateCcw, Info, Terminal } from "lucide-react";
import { useToastStore } from "../../store/toastStore";
import { APP_VERSION } from "../../lib/version";

export function ApplicationSettings() {
  const { addToast } = useToastStore();

  const handleClearCache = () => {
    localStorage.removeItem("rho-lota-theme");
    localStorage.removeItem("rho-lota-providers");
    localStorage.removeItem("rho-lota-custom-agents");
    addToast("Cleared local client cache. Reloading defaults.", "info");
  };

  const shortcuts = [
    { key: "Ctrl + K", desc: "Open Command Palette & Persona Switcher" },
    { key: "Ctrl + Shift + N", desc: "Start New Chat Conversation modal" },
    { key: "Ctrl + B", desc: "Toggle Workspace Navigation Sidebar" },
    { key: "Ctrl + \\", desc: "Toggle Streaming Workbench (Diffs & Reasoning)" },
    { key: "Escape", desc: "Close Modals / Abort Active Stream" },
    { key: "Enter", desc: "Send prompt message" },
    { key: "Shift + Enter", desc: "Insert newline in prompt textarea" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <Laptop className="w-4 h-4 text-[#58a6ff]" />
          <span>Application Environment & Shortcuts</span>
        </h2>
        <p className="text-[#8b949e]">
          Desktop application runtime specifications, platform bindings, and key mappings.
        </p>
      </div>

      {/* App Info Card */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider flex items-center space-x-1.5">
          <Info className="w-3.5 h-3.5 text-blue-400" />
          <span>Runtime Environment</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11px]">
          <div className="p-2.5 bg-[#0d1117] rounded-lg border border-[#30363d]">
            <div className="text-[#8b949e] text-[10px] uppercase">Client Version</div>
            <div className="text-white font-semibold mt-0.5">FrostfireOS v{APP_VERSION}</div>
          </div>
          <div className="p-2.5 bg-[#0d1117] rounded-lg border border-[#30363d]">
            <div className="text-[#8b949e] text-[10px] uppercase">Engine Core</div>
            <div className="text-white font-semibold mt-0.5">Rho v0.1.5</div>
          </div>
          <div className="p-2.5 bg-[#0d1117] rounded-lg border border-[#30363d]">
            <div className="text-[#8b949e] text-[10px] uppercase">Desktop Framework</div>
            <div className="text-white font-semibold mt-0.5">Tauri 2.0 (Rust)</div>
          </div>
          <div className="p-2.5 bg-[#0d1117] rounded-lg border border-[#30363d]">
            <div className="text-[#8b949e] text-[10px] uppercase">UI Stack</div>
            <div className="text-white font-semibold mt-0.5">React 19 / Vite</div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Cheatsheet */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider flex items-center space-x-1.5">
          <Keyboard className="w-3.5 h-3.5 text-purple-400" />
          <span>Global Keyboard Shortcuts</span>
        </label>
        <div className="space-y-1.5">
          {shortcuts.map((sc, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2 bg-[#0d1117] border border-[#30363d] rounded-lg"
            >
              <span className="text-[#c9d1d9]">{sc.desc}</span>
              <kbd className="bg-[#21262d] text-white px-2 py-0.5 rounded font-mono text-[11px] border border-[#30363d]">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>

      {/* Cache & Maintenance */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider flex items-center space-x-1.5">
          <Terminal className="w-3.5 h-3.5 text-yellow-400" />
          <span>Storage & Cache Maintenance</span>
        </label>
        <div className="flex items-center justify-between p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg">
          <div>
            <div className="text-white font-medium text-xs">Reset Local Client Cache</div>
            <div className="text-[10px] text-[#8b949e]">
              Clears saved custom agents, theme overrides, and local vault cache.
            </div>
          </div>
          <button
            type="button"
            onClick={handleClearCache}
            className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-white transition flex items-center space-x-1 font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Cache</span>
          </button>
        </div>
      </div>
    </div>
  );
}
