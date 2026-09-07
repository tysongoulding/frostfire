import { useState } from "react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useToastStore } from "../../store/toastStore";
import { Sliders, Folder, Shield, Zap, Check } from "lucide-react";

export function GeneralSettings() {
  const { workspacePath, setWorkspacePath } = useWorkspaceStore();
  const { addToast } = useToastStore();

  const [inputPath, setInputPath] = useState(workspacePath);
  const [autoCompactionThreshold, setAutoCompactionThreshold] = useState(85);
  const [autoApproveRead, setAutoApproveRead] = useState(true);
  const [autoApproveSearch, setAutoApproveSearch] = useState(true);
  const [streamReasoning, setStreamReasoning] = useState(true);
  const [telemetry, setTelemetry] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPath.trim()) {
      setWorkspacePath(inputPath.trim());
    }
    addToast("General settings updated", "success");
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
          <Sliders className="w-4 h-4 text-[#58a6ff]" />
          <span>General Workspace & Execution Settings</span>
        </h2>
        <p className="text-[#8b949e]">
          Configure primary workspace root directory, token compaction triggers, and execution defaults.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        {/* Workspace Root */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
          <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
            Default Workspace Directory
          </label>
          <div className="relative">
            <Folder className="w-4 h-4 text-[#58a6ff] absolute left-3 top-2.5" />
            <input
              type="text"
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              placeholder="C:\Users\...\repo"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg pl-9 pr-3 py-2 text-white font-mono text-xs focus:border-[#58a6ff] outline-none"
            />
          </div>
        </div>

        {/* Auto Compaction Threshold */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <div className="font-semibold text-white text-xs">Context Compaction Trigger</div>
              <div className="text-[11px] text-[#8b949e]">
                Automatically compact conversation DAG turns when context gauge reaches threshold.
              </div>
            </div>
            <div className="font-mono text-white text-xs bg-[#0d1117] px-2.5 py-1 rounded border border-[#30363d]">
              {autoCompactionThreshold}%
            </div>
          </div>
          <input
            type="range"
            min="50"
            max="95"
            step="5"
            value={autoCompactionThreshold}
            onChange={(e) => setAutoCompactionThreshold(parseInt(e.target.value))}
            className="w-full accent-blue-500 cursor-pointer"
          />
        </div>

        {/* Execution & Safety Toggles */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
          <label className="block text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider flex items-center space-x-1.5">
            <Shield className="w-3.5 h-3.5 text-blue-400" />
            <span>Execution Safety & Streaming</span>
          </label>

          <div className="space-y-2">
            {[
              {
                label: "Auto-approve read-only file queries",
                desc: "Skip manual approval modal for file read and directory scan operations.",
                state: autoApproveRead,
                set: setAutoApproveRead,
              },
              {
                label: "Auto-approve web search and URL fetch",
                desc: "Allow agent to perform read-only searches without blocking turns.",
                state: autoApproveSearch,
                set: setAutoApproveSearch,
              },
              {
                label: "Live reasoning & thinking-block streaming",
                desc: "Stream chain-of-thought tokens real-time into collapsible thinking containers.",
                state: streamReasoning,
                set: setStreamReasoning,
              },
              {
                label: "Anonymous local error telemetry",
                desc: "Log uncaught FSM errors locally to facilitate debugging.",
                state: telemetry,
                set: setTelemetry,
              },
            ].map((item, idx) => (
              <div
                key={idx}
                onClick={() => item.set(!item.state)}
                className="flex items-center justify-between p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg cursor-pointer hover:border-[#8b949e] transition"
              >
                <div>
                  <div className="text-white font-medium text-xs">{item.label}</div>
                  <div className="text-[10px] text-[#8b949e]">{item.desc}</div>
                </div>
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center border transition ${
                    item.state
                      ? "bg-[#1f6feb] border-blue-500 text-white"
                      : "bg-[#161b22] border-[#30363d] text-transparent"
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-[#1f6feb] hover:bg-blue-600 text-white font-semibold shadow-lg shadow-blue-500/20 transition flex items-center space-x-1.5"
          >
            <Zap className="w-4 h-4" />
            <span>Save General Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
}
