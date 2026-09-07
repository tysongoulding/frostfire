import { useWorkspaceStore, FileNode } from "../../store/workspaceStore";
import { useSubagentStore } from "../../store/subagentStore";
import { Sparkles, Terminal, FileCode, Bot } from "lucide-react";

export interface AutocompleteItem {
  key: string;
  label: string;
  description: string;
  type: "skill" | "command" | "file" | "agent";
}

const STATIC_SUGGESTIONS: AutocompleteItem[] = [
  { key: "/search", label: "/search", description: "Search the internet with live web results & citations", type: "command" },
  { key: "/browser", label: "/browser", description: "Browse web documentation and online resources", type: "command" },
  { key: "@create-plugin", label: "@create-plugin", description: "Scaffold a new MCP tool or plugin", type: "skill" },
  { key: "@plan", label: "@plan", description: "Design implementation plan", type: "skill" },
  { key: "@spec", label: "@spec", description: "Generate specification doc", type: "skill" },
  { key: "/model", label: "/model", description: "Switch active LLM model", type: "command" },
  { key: "/reload", label: "/reload", description: "Reload config and skills", type: "command" },
  { key: "/compact", label: "/compact", description: "Compact session memory context", type: "command" },
  { key: "/clear", label: "/clear", description: "Reset active conversation feed", type: "command" },
];

function flattenFileNodes(nodes: FileNode[]): AutocompleteItem[] {
  const items: AutocompleteItem[] = [];
  for (const node of nodes) {
    if (!node.isDir) {
      items.push({
        key: `@${node.path}`,
        label: `@${node.path}`,
        description: `Workspace file (${(node.size ? node.size / 1024 : 0).toFixed(1)}k)`,
        type: "file",
      });
    } else if (node.children) {
      items.push(...flattenFileNodes(node.children));
    }
  }
  return items;
}

interface AutocompleteMenuProps {
  filter: string;
  onSelect: (item: AutocompleteItem) => void;
}

export function AutocompleteMenu({ filter, onSelect }: AutocompleteMenuProps) {
  const { files } = useWorkspaceStore();
  const { subagents } = useSubagentStore();

  const agentSuggestions: AutocompleteItem[] = subagents.map((a) => ({
    key: `@${a.name}`,
    label: `@${a.name}`,
    description: `${a.role} • ${a.model}`,
    type: "agent",
  }));

  const fileSuggestions = flattenFileNodes(files);
  const allSuggestions = [...agentSuggestions, ...STATIC_SUGGESTIONS, ...fileSuggestions];

  const matches = allSuggestions.filter((s) =>
    s.key.toLowerCase().startsWith(filter.toLowerCase())
  );

  if (matches.length === 0) return null;

  return (
    <div className="absolute bottom-full left-4 mb-2 w-80 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden text-xs z-50">
      <div className="p-2 bg-[#0d1117] text-[10px] uppercase font-semibold text-[#8b949e] border-b border-[#30363d] flex items-center justify-between">
        <span>Context & Agent Autocomplete</span>
        <span>{matches.length} matches</span>
      </div>
      <div className="max-h-56 overflow-y-auto p-1 space-y-0.5 font-mono">
        {matches.map((item) => (
          <button
            key={item.key}
            onClick={() => onSelect(item)}
            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[#21262d] text-left transition"
          >
            <div className="flex items-center space-x-2 truncate">
              {item.type === "agent" ? (
                <Bot className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
              ) : item.type === "skill" ? (
                <Sparkles className="w-3.5 h-3.5 text-[#58a6ff] flex-shrink-0" />
              ) : item.type === "file" ? (
                <FileCode className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              ) : (
                <Terminal className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
              )}
              <div className="truncate">
                <div className="font-semibold text-white truncate">{item.label}</div>
                <div className="text-[10px] text-[#8b949e] font-sans truncate">{item.description}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
