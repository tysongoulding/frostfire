import { useState, useEffect } from "react";
import { SubagentDefinition, useSubagentStore } from "../../store/subagentStore";
import { useToastStore } from "../../store/toastStore";
import {
  X,
  Bot,
  GitBranch,
  Wrench,
  PlugZap,
  Network,
  Cpu,
  Save,
  Play,
  Trash2,
  Check,
  RotateCw,
} from "lucide-react";

interface SubagentDetailModalProps {
  subagent: SubagentDefinition | null;
  onClose: () => void;
}

export function SubagentDetailModal({ subagent, onClose }: SubagentDetailModalProps) {
  const { updateSubagent, deleteSubagent, setSubagentState } = useSubagentStore();
  const { addToast } = useToastStore();

  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState<SubagentDefinition["model"]>("inherit");
  const [workspaceMode, setWorkspaceMode] = useState<SubagentDefinition["workspaceMode"]>("inherit");
  const [enableWriteTools, setEnableWriteTools] = useState(true);
  const [enableMcpTools, setEnableMcpTools] = useState(true);
  const [enableSubagentTools, setEnableSubagentTools] = useState(false);
  const [isInvoking, setIsInvoking] = useState(false);

  useEffect(() => {
    if (subagent) {
      setRole(subagent.role);
      setDescription(subagent.description);
      setSystemPrompt(subagent.systemPrompt);
      setModel(subagent.model);
      setWorkspaceMode(subagent.workspaceMode);
      setEnableWriteTools(subagent.enableWriteTools);
      setEnableMcpTools(subagent.enableMcpTools);
      setEnableSubagentTools(subagent.enableSubagentTools);
    }
  }, [subagent]);

  if (!subagent) return null;

  const handleSave = () => {
    updateSubagent(subagent.id, {
      role: role.trim() || subagent.role,
      description: description.trim() || subagent.description,
      systemPrompt: systemPrompt.trim() || subagent.systemPrompt,
      model,
      workspaceMode,
      enableWriteTools,
      enableMcpTools,
      enableSubagentTools,
    });
    addToast(`Saved changes to agent: ${subagent.name}`, "success");
    onClose();
  };

  const handleInvoke = async () => {
    setIsInvoking(true);
    setSubagentState(subagent.id, "running", "Executing assigned task...");
    addToast(`Invoked agent: ${subagent.name}`, "info");

    setTimeout(() => {
      setSubagentState(subagent.id, "idle", "Task completed successfully");
      setIsInvoking(false);
      addToast(`Agent ${subagent.name} finished task`, "success");
    }, 2500);
  };

  const handleDelete = () => {
    deleteSubagent(subagent.id);
    addToast(`Deleted agent: ${subagent.name}`, "info");
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150 text-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#30363d] bg-[#0d1117]">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-white font-mono text-xs">{subagent.name}</span>
                <span className="px-2 py-0.2 rounded-full text-[10px] font-mono bg-[#161b22] border border-purple-500/30 text-purple-300">
                  Agent
                </span>
              </div>
              <p className="text-[10px] text-[#8b949e]">{subagent.stateDetail || "Autonomous worker"}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8b949e] hover:text-white hover:bg-[#21262d] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body Form */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {/* Role */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-[#8b949e] uppercase">Role Description</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white font-medium outline-none focus:border-purple-500"
              placeholder="e.g. Autonomous TDD Implementer"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-[#8b949e] uppercase">Capability Summary</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl p-3 text-white outline-none focus:border-purple-500 resize-none text-xs leading-relaxed"
            />
          </div>

          {/* Workspace Mode & Model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Workspace Mode */}
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-[#8b949e] uppercase flex items-center space-x-1">
                <GitBranch className="w-3 h-3 text-cyan-400" />
                <span>Workspace Isolation Mode</span>
              </label>
              <select
                value={workspaceMode}
                onChange={(e) => setWorkspaceMode(e.target.value as SubagentDefinition["workspaceMode"])}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white outline-none focus:border-purple-500 font-mono text-xs"
              >
                <option value="inherit">inherit (Shares parent workspace)</option>
                <option value="branch">branch (Isolated git worktree)</option>
                <option value="share">share (Shared underlying repo)</option>
              </select>
            </div>

            {/* Model */}
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-[#8b949e] uppercase flex items-center space-x-1">
                <Cpu className="w-3 h-3 text-blue-400" />
                <span>Model Tier</span>
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as SubagentDefinition["model"])}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white outline-none focus:border-purple-500 font-mono text-xs"
              >
                <option value="inherit">inherit (Parent Model)</option>
                <option value="flash_lite">flash_lite (Lightweight model)</option>
                <option value="flash">flash (Fast speed/research)</option>
                <option value="pro">pro (High reasoning / refactors)</option>
              </select>
            </div>
          </div>

          {/* Tool Group Permissions */}
          <div className="space-y-2 p-3 bg-[#0d1117] rounded-xl border border-[#30363d]">
            <label className="text-[10px] font-semibold text-[#8b949e] uppercase">Tool Group Permissions</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Write Tools */}
              <button
                type="button"
                onClick={() => setEnableWriteTools(!enableWriteTools)}
                className={`p-2.5 rounded-lg border text-left flex items-center justify-between transition ${
                  enableWriteTools
                    ? "bg-purple-950/30 border-purple-500 text-white"
                    : "bg-[#161b22] border-[#30363d] text-[#8b949e]"
                }`}
              >
                <div className="flex items-center space-x-1.5">
                  <Wrench className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-[11px]">Write Tools</span>
                </div>
                {enableWriteTools && <Check className="w-3 h-3 text-purple-400" />}
              </button>

              {/* MCP Tools */}
              <button
                type="button"
                onClick={() => setEnableMcpTools(!enableMcpTools)}
                className={`p-2.5 rounded-lg border text-left flex items-center justify-between transition ${
                  enableMcpTools
                    ? "bg-emerald-950/30 border-emerald-500 text-white"
                    : "bg-[#161b22] border-[#30363d] text-[#8b949e]"
                }`}
              >
                <div className="flex items-center space-x-1.5">
                  <PlugZap className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px]">MCP Tools</span>
                </div>
                {enableMcpTools && <Check className="w-3 h-3 text-emerald-400" />}
              </button>

              {/* Subagent Tools */}
              <button
                type="button"
                onClick={() => setEnableSubagentTools(!enableSubagentTools)}
                className={`p-2.5 rounded-lg border text-left flex items-center justify-between transition ${
                  enableSubagentTools
                    ? "bg-blue-950/30 border-blue-500 text-white"
                    : "bg-[#161b22] border-[#30363d] text-[#8b949e]"
                }`}
              >
                <div className="flex items-center space-x-1.5">
                  <Network className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[11px]">Agent Spawner</span>
                </div>
                {enableSubagentTools && <Check className="w-3 h-3 text-blue-400" />}
              </button>
            </div>
          </div>

          {/* System Prompt */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-[#8b949e] uppercase">
              Agent System Prompt
            </label>
            <textarea
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl p-3 text-white font-mono text-[11px] outline-none focus:border-purple-500 resize-none leading-relaxed"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-[#30363d] bg-[#0d1117] flex items-center justify-between">
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 rounded-xl bg-[#21262d] hover:bg-red-950/40 text-[#8b949e] hover:text-red-400 border border-[#30363d] transition flex items-center space-x-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleInvoke}
              disabled={isInvoking}
              className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold flex items-center space-x-1.5 transition shadow"
            >
              {isInvoking ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isInvoking ? "Running..." : "Invoke Agent"}</span>
            </button>

            <button
              onClick={handleSave}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center space-x-1.5 transition shadow"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
