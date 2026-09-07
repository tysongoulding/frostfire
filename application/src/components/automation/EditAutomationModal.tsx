import { useState, useEffect } from "react";
import { AutomationJob, useAutomationStore } from "../../store/automationStore";
import { useToastStore } from "../../store/toastStore";
import { X, Save, Clock, Bot, Terminal, Calendar, Route, Check } from "lucide-react";

interface EditAutomationModalProps {
  job: AutomationJob | null;
  onClose: () => void;
}

export function EditAutomationModal({ job, onClose }: EditAutomationModalProps) {
  const { updateAutomation } = useAutomationStore();
  const { addToast } = useToastStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cronExpression, setCronExpression] = useState("*/30 * * * *");
  const [scheduleLabel, setScheduleLabel] = useState("Every 30 minutes");
  const [targetAgent, setTargetAgent] = useState("Build Implementer");
  const [targetPrompt, setTargetPrompt] = useState("");
  const [status, setStatus] = useState<"active" | "paused">("active");

  useEffect(() => {
    if (job) {
      setName(job.name);
      setDescription(job.description);
      setCronExpression(job.cronExpression);
      setScheduleLabel(job.scheduleLabel);
      setTargetAgent(job.targetAgent);
      setTargetPrompt(job.targetPrompt);
      setStatus(job.status === "paused" ? "paused" : "active");
    }
  }, [job]);

  if (!job) return null;

  const schedulePresets = [
    { label: "Every 5 minutes", cron: "*/5 * * * *" },
    { label: "Every 15 minutes", cron: "*/15 * * * *" },
    { label: "Every 30 minutes", cron: "*/30 * * * *" },
    { label: "Hourly on the hour", cron: "0 * * * *" },
    { label: "Daily at 02:00 AM UTC", cron: "0 2 * * *" },
    { label: "Weekly on Sunday", cron: "0 0 * * 0" },
  ];

  const handleApplyPreset = (label: string, cron: string) => {
    setScheduleLabel(label);
    setCronExpression(cron);
  };

  const handleSave = () => {
    updateAutomation(job.id, {
      name: name.trim() || job.name,
      description: description.trim() || job.description,
      cronExpression,
      scheduleLabel,
      targetAgent,
      targetPrompt: targetPrompt.trim() || job.targetPrompt,
      status,
      nextRun: `In next interval (${cronExpression})`,
    });
    addToast(`Updated automation: ${name}`, "success");
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-xs animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#30363d] bg-[#0d1117]">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Route className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-xs">Edit Automation Job</h3>
              <p className="text-[10px] text-[#8b949e]">Configure schedule, cron triggers, and prompt targets.</p>
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
          {/* Job Name */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-[#8b949e] uppercase">Automation Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white font-medium outline-none focus:border-emerald-500"
              placeholder="e.g. Continuous Cargo Linter & Red-Green Gate"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-[#8b949e] uppercase">Description & Intent</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl p-3 text-white outline-none focus:border-emerald-500 resize-none text-xs"
              placeholder="Describe what this automated background job does..."
            />
          </div>

          {/* Schedule & Cron Section */}
          <div className="space-y-2 p-3.5 bg-[#0d1117] rounded-xl border border-[#30363d]">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Scheduled Time & Frequency</span>
              </span>
              <span className="font-mono text-emerald-400 text-[11px] font-bold">{scheduleLabel}</span>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
              {schedulePresets.map((preset) => {
                const isSelected = cronExpression === preset.cron;
                return (
                  <button
                    key={preset.cron}
                    type="button"
                    onClick={() => handleApplyPreset(preset.label, preset.cron)}
                    className={`px-2.5 py-1.5 rounded-lg border text-[11px] transition text-left flex items-center justify-between ${
                      isSelected
                        ? "bg-emerald-950/40 border-emerald-500 text-white font-medium"
                        : "bg-[#161b22] border-[#30363d] text-[#8b949e] hover:text-white"
                    }`}
                  >
                    <span>{preset.label}</span>
                    {isSelected && <Check className="w-3 h-3 text-emerald-400" />}
                  </button>
                );
              })}
            </div>

            {/* Custom Cron Input */}
            <div className="pt-2 flex items-center space-x-2">
              <span className="text-[#8b949e] text-[10px] font-mono">Cron Expression:</span>
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                className="flex-1 bg-[#161b22] border border-[#30363d] rounded-lg px-2.5 py-1 text-white font-mono text-xs outline-none focus:border-emerald-500"
                placeholder="*/30 * * * *"
              />
            </div>
          </div>

          {/* Target Agent & Prompt Directives */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-[#8b949e] uppercase flex items-center space-x-1">
                <Bot className="w-3 h-3 text-purple-400" />
                <span>Assigned Agent Persona</span>
              </label>
              <select
                value={targetAgent}
                onChange={(e) => setTargetAgent(e.target.value)}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500"
              >
                <option value="Build Implementer">Build Implementer (TDD)</option>
                <option value="Team QA Lead">Team QA Lead</option>
                <option value="Rho Context Compactor">Rho Context Compactor</option>
                <option value="Team Librarian">Team Librarian</option>
                <option value="Default Autonomous Agent">Default Autonomous Agent</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-[#8b949e] uppercase flex items-center space-x-1">
                <Calendar className="w-3 h-3 text-cyan-400" />
                <span>Job Status</span>
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "paused")}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500"
              >
                <option value="active">Active (Scheduled)</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>

          {/* Prompt Directives */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-[#8b949e] uppercase flex items-center space-x-1">
              <Terminal className="w-3 h-3 text-[#58a6ff]" />
              <span>Target Execution Prompt & Instructions</span>
            </label>
            <textarea
              rows={3}
              value={targetPrompt}
              onChange={(e) => setTargetPrompt(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl p-3 text-white font-mono text-[11px] outline-none focus:border-emerald-500 resize-none leading-relaxed"
              placeholder="Provide exact prompt instructions to run when this cron triggers..."
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-[#30363d] bg-[#0d1117] flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#21262d] hover:bg-[#30363d] text-white font-medium transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition flex items-center space-x-1.5 shadow"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
