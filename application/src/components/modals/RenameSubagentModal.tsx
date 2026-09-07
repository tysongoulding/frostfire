import { useState, useEffect } from "react";
import { SubagentDefinition, useSubagentStore } from "../../store/subagentStore";
import { useToastStore } from "../../store/toastStore";
import { Edit2, X, Check } from "lucide-react";

interface RenameSubagentModalProps {
  subagent: SubagentDefinition | null;
  onClose: () => void;
}

export function RenameSubagentModal({ subagent, onClose }: RenameSubagentModalProps) {
  const { renameSubagent } = useSubagentStore();
  const { addToast } = useToastStore();
  const [name, setName] = useState("");

  useEffect(() => {
    if (subagent) {
      setName(subagent.name);
    }
  }, [subagent]);

  if (!subagent) return null;

  const handleSave = () => {
    if (!name.trim()) {
      addToast("Agent name cannot be empty", "error");
      return;
    }
    renameSubagent(subagent.id, name);
    addToast(`Renamed agent to: ${name.trim()}`, "success");
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150 text-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden p-5 space-y-4 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Edit2 className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold text-white">Rename Agent</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#8b949e] hover:text-white hover:bg-[#21262d] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-[#8b949e] uppercase">Agent Identifier</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") onClose();
            }}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-blue-500"
            autoFocus
          />
        </div>

        <div className="flex items-center justify-end space-x-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl bg-[#21262d] hover:bg-[#30363d] text-white transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition flex items-center space-x-1.5 shadow"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        </div>
      </div>
    </div>
  );
}
