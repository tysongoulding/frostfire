import { useState, useEffect } from "react";
import { Zap, Search, Folder, Terminal } from "lucide-react";

interface SkillItem {
  name: string;
  category?: string;
  triggers: string[];
  description: string;
  path: string;
  tokens: number;
}

const FALLBACK_SKILLS: SkillItem[] = [
  {
    name: "agy-customizations",
    category: "Built-in System",
    triggers: ["customizations", "skills", "rules", "plugins"],
    description: "Comprehensive guide for the Antigravity Customization System (loading priority, rules, MCP, sidecars).",
    path: "C:\\Users\\tyson\\.gemini\\antigravity\\builtin\\skills\\agy-customizations",
    tokens: 65,
  },
  {
    name: "librarian",
    category: "Durable Knowledge",
    triggers: ["librarian", "save to library", "search library", "architecture direction"],
    description: "Curates durable knowledge and decisions into shared library for one-shot retrieval.",
    path: "C:\\Users\\tyson\\.gemini\\config\\plugins\\librarian-plugin\\skills\\librarian",
    tokens: 95,
  },
  {
    name: "team-build",
    category: "Engineering Delivery",
    triggers: ["team-build", "build this plan", "run build team"],
    description: "Runs virtual engineering team (planner, implementer, verifier, reviewer) under strict red-to-green TDD.",
    path: "C:\\Users\\tyson\\.gemini\\config\\plugins\\delivery-team-plugin\\skills\\team-build",
    tokens: 110,
  },
  {
    name: "team-qa",
    category: "Quality Assurance",
    triggers: ["team-qa", "qa check", "test plan"],
    description: "Runs virtual QA team (cartographer, risk analyst, test architects) to prevent silent regressions.",
    path: "C:\\Users\\tyson\\.gemini\\config\\plugins\\delivery-team-plugin\\skills\\team-qa",
    tokens: 105,
  },
  {
    name: "wrap-up",
    category: "Git Lifecycle",
    triggers: ["wrap up", "/wrap-up", "close out work"],
    description: "Audits uncommitted changes, surfaces decisions, commits, pushes, and merges cleanly.",
    path: "C:\\Users\\tyson\\.gemini\\config\\plugins\\dev-workflow\\skills\\wrap-up",
    tokens: 75,
  },
];

export function SkillsCustomiseTab() {
  const [search, setSearch] = useState("");
  const [skills, setSkills] = useState<SkillItem[]>(FALLBACK_SKILLS);

  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<Array<{ name: string; description: string; location: string; origin: string }>>("list_installed_skills")
          .then((res) => {
            if (res && res.length > 0) {
              setSkills(
                res.map((s) => ({
                  name: s.name,
                  category: s.origin === "built-in" ? "Built-in System" : s.origin === "user" ? "User Skill" : "Project Skill",
                  triggers: [s.name, `/${s.name}`],
                  description: s.description,
                  path: s.location,
                  tokens: Math.max(30, Math.round(s.description.length / 3)),
                }))
              );
            }
          })
          .catch((err) => console.warn("Failed to load skills from backend:", err));
      });
    }
  }, []);

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      (s.category && s.category.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5 max-w-5xl mx-auto text-xs text-[#c9d1d9]">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
            <Zap className="w-4 h-4 text-pink-400" />
            <span>Installed Skills & Trigger Contracts</span>
          </h2>
          <p className="text-[#8b949e]">
            Skills extend agent capabilities via YAML frontmatter and markdown execution instructions.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills & triggers..."
            className="w-full bg-[#161b22] border border-[#30363d] rounded-xl pl-8 pr-3 py-1.5 text-white text-xs outline-none focus:border-pink-500"
          />
        </div>
      </div>

      {/* Grid of Skill Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((skill) => (
          <div
            key={skill.name}
            className="p-4 bg-[#161b22] border border-[#30363d] rounded-2xl space-y-2.5 hover:border-[#8b949e] transition flex flex-col justify-between"
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 truncate">
                  <div className="p-1 rounded bg-pink-500/10 text-pink-400 border border-pink-500/20">
                    <Zap className="w-3.5 h-3.5" />
                  </div>
                  <span className="font-mono text-xs font-semibold text-white truncate">{skill.name}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#0d1117] border border-[#30363d] text-pink-300/90 font-mono">
                  ~{skill.tokens} tok
                </span>
              </div>

              <p className="text-[11px] text-[#8b949e] leading-relaxed">{skill.description}</p>
            </div>

            <div className="space-y-2 pt-1 border-t border-[#30363d]/50">
              {/* Triggers */}
              <div className="flex items-center space-x-1.5 text-[10px]">
                <Terminal className="w-3 h-3 text-[#8b949e] flex-shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {skill.triggers.map((t, idx) => (
                    <span key={idx} className="bg-[#0d1117] text-white px-1.5 py-0.5 rounded font-mono border border-[#30363d]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Path */}
              <div className="flex items-center space-x-1.5 text-[10px] text-[#8b949e] truncate font-mono">
                <Folder className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{skill.path}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
