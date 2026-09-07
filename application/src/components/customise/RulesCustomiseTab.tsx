import { useState, useEffect } from "react";
import {
  Shield,
  Save,
  Sliders,
  Cpu,
  Code2,
  Eye,
  RotateCcw,
  Bot,
  Layers,
  Route,
  Zap,
  Lock,
  Plus,
  AlertTriangle,
  X,
  Users,
} from "lucide-react";
import { useToastStore } from "../../store/toastStore";
import { MarkviewRenderer } from "../markdown/MarkviewRenderer";
import { useAgentStore, AgentPersona, DEFAULT_PERSONAS } from "../../store/agentStore";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_SYSTEM_MD = `# Rho Lota System Core Protocol

You are the Rho Lota autonomous coding assistant powered by Rust \`rho-engine\` and Rig core.

## Core Directives
1. **Direct Output**: Start immediately with the solution, script, or executable code block. Never include conversational greetings or filler.
2. **Absolute Brevity**: If a single line answers the prompt, provide only that.
3. **Evidence-First Context Discovery**: Inspect project structure and configuration files before modifying files.
4. **Targeted Modifications**: Prefer precise incremental edits over full-file rewrites.
5. **Strict Red-First TDD**: Author tests first, verify red failure, then implement minimal production code to pass green.
6. **Code Structure**: Keep files concise (~150 lines target). Split along natural cohesion boundaries.
7. **Lint Policy**: Zero tolerance for Clippy lints; never add suppression attributes.`;

const DEFAULT_COMPACTION_MD = `# Context Limit Compaction & Continuation Protocol

## Task Context
- An LLM context limit was reached when a user was in an active working session with an agent.
- Generate a structured continuation checkpoint removing redundant verbose tool outputs while preserving 100% technical fidelity.
- Use framing and tone tailored for the agent to resume execution without loss of state.

## Mandatory Compaction Sections:
1. **User Intent** – All user goals, requests, and UI/architectural directives.
2. **Technical Concepts** – All frameworks, Rig/Rust FSM engines, and MCP protocols.
3. **Files + Code** – Viewed/edited files, complete modified snippets, and justifications.
4. **Errors + Fixes** – Compiler diagnostics, type issues, and applied resolutions.
5. **Problem Solving** – Solved architectural challenges and open design questions.
6. **User Messages** – Chronological history of user requests.
7. **Pending Tasks** – Outstanding unresolved user items.
8. **Current Work** – Exact files and state active at compaction time.
9. **Next Step** – Immediate direct technical command to continue.`;

const DEFAULT_SUBAGENT_SYSTEM_MD = `# Subagent System & Multi-Agent Delegation Protocol

Subagents are specialized autonomous workers invoked via \`invoke_subagent\` running in isolated context threads.

## Workspace Modes
- \`inherit\`: Shares parent working directory directly.
- \`branch\`: Isolated git worktree branched from parent HEAD.
- \`share\`: Shared underlying repository with independent branch pointer.

## Lifecycle & Messaging
- **Reactive Wakeup**: Do NOT poll in a loop. The harness automatically awakens the parent when subagents finish.
- **Communication**: Use \`send_message\` to pass instructions or kill tokens.
- **Role Specialization**: Assign single-responsibility roles (e.g. \`build-implementer\`, \`scout\`, \`red-team-reviewer\`).`;

const DEFAULT_ARTIFACTS_MD = `# Artifact Creation & Presentation Protocol

Artifacts are persistent markdown, HTML, or structured documents saved to \`<appDataDir>/brain/<conversation-id>/\`.

## When to Create Artifacts
- Detailed technical implementation plans (\`implementation_plan.md\`)
- Step-by-step walkthroughs (\`walkthrough.md\`)
- Interactive HTML/Canvas telemetry widgets (\`*.html\`)
- Vector system architecture diagrams (\`*.svg\`)
- Database schemas and migration scripts (\`*.sql\`)

## Formatting Invariants
- **GitHub Alerts**: Use \`> [!NOTE]\`, \`> [!TIP]\`, \`> [!IMPORTANT]\`, \`> [!WARNING]\`, and \`> [!CAUTION]\`.
- **KaTeX LaTeX**: Use \`$...\` for inline math and \`$$...$$\` for block formulas.
- **80% Viewport Preview**: HTML artifacts render dynamically in sandboxed iframes.`;

const DEFAULT_AUTOMATION_MD = `# Dynamic Automation, Tool Execution & MCP Protocol

Defines execution permissions, background daemons, MCP sidecars, and automated scheduled triggers.

## Tool Registry & Sandboxing
- **Native Tools**: \`read_file\`, \`write_to_file\`, \`replace_file_content\`, \`run_command\`, \`schedule\`.
- **MCP Protocol**: Lazy-load JSON schemas for external servers (GitHub, Context-Mode, Google-Workspace).
- **Command Efficiency**: Proactively chain related shell commands (e.g. \`cargo fmt; cargo clippy\`).

## Background Daemons & Timers
- Use \`schedule\` tool for one-shot timers or recurring cron triggers.
- Never execute blocking sleep commands in shell.`;

const DEFAULT_GLOBAL_RULES = `# General Instructions (Chat & Autonomous Agents)
- Direct Output: Start immediately with the solution, script, or code block.
- Absolute Brevity: If a single line answers the prompt, provide only that.
- Target Modifications: Prefer precise, incremental edits over full-file rewrites.
- Closed Loop Validation: Validate syntax and run checks locally before declaring complete.
- No Placeholders: Never emit // TODO or left-as-an-exercise placeholders.`;

const DEFAULT_PROJECT_RULES = `# Repository Instructions (Project Workspace)
- Keep files concise (~150 lines target). Treat growth beyond ~150 lines as a signal to check cohesion.
- Separate unit tests into sibling tests.rs or tests/ submodules.
- Lint Policy: Do not add Clippy allow, expect, or crate-level lint suppressions.
- Testing: Use cargo test --workspace for verified feedback.`;

const DEFAULT_WORKSTREAM_RULES = `# FrostfireOS Workstream Execution & Federation Protocol

Universal execution rules enforced across every single active workstream.

## Core Directives
1. **Blackboard Dual-Plane Synchronization**: All milestone deliverables must be published to the Blackboard Data Plane (JSON) and Presentation Plane (Markdown).
2. **Deterministic Invariant Validation**: Before phase transitions, verify that produced artifacts satisfy upstream contract invariants (produces vs prohibits).
3. **Phase-Gate Sequentiality**: Adhere to sequential progression (Understand -> Sketch -> Decide -> Prototype). No phase may be skipped.
4. **Zero-Trust Author Isolation**: Agents may only mutate namespaces matching their caller agent ID and role assignment.
5. **Circuit Breakers**: Immediately halt and request human review if reasoning loops or step retries exceed threshold.`;

const DEFAULT_TEAM_RULES = `# Team Workflow & Defect Prevention
- TDD Discipline: Strict red-to-green verification before declaring task done.
- Defect Catalog: Review known regression classes in memory/defect-catalog.md.`;

const DEFAULT_NEW_AGENT = {
  name: "Security SME",
  id: "security_sme",
  role: "Application Security & Zero-Trust Auditor",
  description: "Enforces zero-trust boundaries, assesses CVE vulnerabilities, and blocks architectural drift.",
  tier: "fast_tier" as const,
  temperature: 0.2,
  thinkingLevel: "high" as const,
  permissionLevel: "Sandboxed" as const,
  produces: "security_audit, threat_model, cve_assessment",
  prohibits: "plaintext_secrets, public_endpoints, unauthenticated_routes",
  assumes: "architecture_spec, source_code",
  prompt: `# FrostfireOS Security SME System Instructions
STRICT_INTERNAL_COORDINATOR_RULES: You are an autonomous Security Subject Matter Expert in FrostfireOS.
CONFIDENTIAL_PROPRIETARY_PIPELINE: Your role is to enforce zero-trust boundaries, assess CVE vulnerabilities, and block security regressions.
Never emit unencrypted credentials, bypass authorization guards, or leave ports open below 1024.
Evaluate solution candidates with trade-off matrices, data-flow diagrams, and clear module contracts.`,
};

const FROSTFIRE_BUILTIN_AGENT_IDS = [
  "arch_sme",
  "code_sme",
  "coordinator",
  "coder",
  "architect",
  "researcher",
  "reviewer",
];

const STORAGE_KEY = "frostfire_rules_customise_v6";
const STORAGE_CUSTOM_RULES_KEY = "frostfire_custom_rules_v6";

interface PromptConfigDto {
  role: string;
  is_custom: boolean;
  display_status: string;
  prompt_content: string;
}

export function RulesCustomiseTab() {
  const { addToast } = useToastStore();
  const { personas, addPersona, updatePersona } = useAgentStore();

  // Selected rule defaults to first Core Engine prompt: "system"
  const [activeRuleId, setActiveRuleId] = useState<string>("system");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [compactingPercent, setCompactingPercent] = useState<number>(85);

  // Project and Team scoped selectors
  const [selectedProject, setSelectedProject] = useState<string>("frostfireos");
  const [selectedTeam, setSelectedTeam] = useState<string>("architecture");

  // Custom rules map (tracks which items have been switched to custom mode)
  const [customRules, setCustomRules] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CUSTOM_RULES_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });

  // Warning Confirmation Modal for switching to custom editable prompts
  const [showCustomWarningModal, setShowCustomWarningModal] = useState(false);
  const [pendingCustomRuleId, setPendingCustomRuleId] = useState<string | null>(null);

  // Prompt Protection state for active agent
  const [promptProtection, setPromptProtection] = useState<PromptConfigDto>({
    role: "arch_sme",
    is_custom: false,
    display_status: "Defaulted",
    prompt_content: "",
  });
  const [savingPrompt, setSavingPrompt] = useState(false);

  // New Agent Modal state with complete defaults
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [newAgentName, setNewAgentName] = useState(DEFAULT_NEW_AGENT.name);
  const [newAgentId, setNewAgentId] = useState(DEFAULT_NEW_AGENT.id);
  const [newAgentRole, setNewAgentRole] = useState(DEFAULT_NEW_AGENT.role);
  const [newAgentDescription, setNewAgentDescription] = useState(DEFAULT_NEW_AGENT.description);
  const [newAgentTier, setNewAgentTier] = useState<"fast_tier" | "reasoning_lead">(DEFAULT_NEW_AGENT.tier);
  const [newAgentTemperature, setNewAgentTemperature] = useState<number>(DEFAULT_NEW_AGENT.temperature);
  const [newAgentThinkingLevel, setNewAgentThinkingLevel] = useState<"off" | "low" | "medium" | "high" | "max">(DEFAULT_NEW_AGENT.thinkingLevel);
  const [newAgentPermissionLevel, setNewAgentPermissionLevel] = useState<"Read-Only" | "Sandboxed" | "Admin">(DEFAULT_NEW_AGENT.permissionLevel);
  const [newAgentProduces, setNewAgentProduces] = useState(DEFAULT_NEW_AGENT.produces);
  const [newAgentProhibits, setNewAgentProhibits] = useState(DEFAULT_NEW_AGENT.prohibits);
  const [newAgentAssumes, setNewAgentAssumes] = useState(DEFAULT_NEW_AGENT.assumes);
  const [newAgentPrompt, setNewAgentPrompt] = useState(DEFAULT_NEW_AGENT.prompt);

  const resetModalToDefaults = () => {
    setNewAgentName(DEFAULT_NEW_AGENT.name);
    setNewAgentId(DEFAULT_NEW_AGENT.id);
    setNewAgentRole(DEFAULT_NEW_AGENT.role);
    setNewAgentDescription(DEFAULT_NEW_AGENT.description);
    setNewAgentTier(DEFAULT_NEW_AGENT.tier);
    setNewAgentTemperature(DEFAULT_NEW_AGENT.temperature);
    setNewAgentThinkingLevel(DEFAULT_NEW_AGENT.thinkingLevel);
    setNewAgentPermissionLevel(DEFAULT_NEW_AGENT.permissionLevel);
    setNewAgentProduces(DEFAULT_NEW_AGENT.produces);
    setNewAgentProhibits(DEFAULT_NEW_AGENT.prohibits);
    setNewAgentAssumes(DEFAULT_NEW_AGENT.assumes);
    setNewAgentPrompt(DEFAULT_NEW_AGENT.prompt);
  };

  const [prompts, setPrompts] = useState<{ [key: string]: string }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      system: DEFAULT_SYSTEM_MD,
      compaction: DEFAULT_COMPACTION_MD,
      subagent: DEFAULT_SUBAGENT_SYSTEM_MD,
      artifacts: DEFAULT_ARTIFACTS_MD,
      automation: DEFAULT_AUTOMATION_MD,
      global: DEFAULT_GLOBAL_RULES,
      project: DEFAULT_PROJECT_RULES,
      workstreams: DEFAULT_WORKSTREAM_RULES,
      team: DEFAULT_TEAM_RULES,
    };
  });

  // Check if current selection is an agent persona
  const activePersona = personas.find((p) => p.id === activeRuleId);

  // Helper to determine if a rule/agent is in custom editable mode
  const isRuleCustom = (id: string): boolean => {
    const p = personas.find((x) => x.id === id);
    if (p) {
      return p.promptProtectionMode === "Custom" || Boolean(customRules[id]);
    }
    return Boolean(customRules[id]);
  };

  // Load Prompt Protection config whenever an agent is selected
  useEffect(() => {
    if (activePersona) {
      const loadConfig = async () => {
        try {
          const res = await invoke<PromptConfigDto>("get_prompt_config", {
            role: activePersona.id,
          });
          setPromptProtection(res);
          if (res.is_custom && res.prompt_content) {
            setPrompts((prev) => ({ ...prev, [activePersona.id]: res.prompt_content }));
            setCustomRules((prev) => ({ ...prev, [activePersona.id]: true }));
          }
        } catch {
          const isCustom = activePersona.promptProtectionMode === "Custom" || Boolean(customRules[activePersona.id]);
          setPromptProtection({
            role: activePersona.id,
            is_custom: isCustom,
            display_status: isCustom ? "Custom" : "Defaulted",
            prompt_content: activePersona.systemPrompt,
          });
        }
      };
      loadConfig();
    }
  }, [activePersona?.id]);

  const promptSwitchToCustom = (ruleId: string) => {
    setPendingCustomRuleId(ruleId);
    setShowCustomWarningModal(true);
  };

  const confirmSwitchToCustom = async () => {
    if (!pendingCustomRuleId) return;
    const ruleId = pendingCustomRuleId;
    const nextCustom = { ...customRules, [ruleId]: true };
    setCustomRules(nextCustom);
    try {
      localStorage.setItem(STORAGE_CUSTOM_RULES_KEY, JSON.stringify(nextCustom));
    } catch {}

    const currentPersona = personas.find((p) => p.id === ruleId);
    if (currentPersona) {
      setSavingPrompt(true);
      try {
        const textToActivate =
          prompts[currentPersona.id] ||
          currentPersona.systemPrompt ||
          `# Custom System Instructions for ${currentPersona.name}\n\nSpecify customized domain rules...`;
        await invoke("save_custom_prompt", {
          role: currentPersona.id,
          content: textToActivate,
          activate: true,
        });
        setPromptProtection({
          role: currentPersona.id,
          is_custom: true,
          display_status: "Custom",
          prompt_content: textToActivate,
        });
        setPrompts((prev) => ({ ...prev, [currentPersona.id]: textToActivate }));
        updatePersona(currentPersona.id, { promptProtectionMode: "Custom" });
      } catch (e: any) {
        addToast(`Error activating custom prompt: ${e}`, "error");
      } finally {
        setSavingPrompt(false);
      }
    }

    setShowCustomWarningModal(false);
    setPendingCustomRuleId(null);
    addToast(`Switched to custom editable mode`, "info");
  };

  const handleReturnToDefault = async () => {
    const ruleId = selectedRule.id;
    const nextCustom = { ...customRules, [ruleId]: false };
    setCustomRules(nextCustom);
    try {
      localStorage.setItem(STORAGE_CUSTOM_RULES_KEY, JSON.stringify(nextCustom));
    } catch {}

    // Reset prompt content to baseline template
    setPrompts((prev) => ({ ...prev, [ruleId]: selectedRule.defaultText }));

    if (activePersona && activePersona.id === ruleId) {
      setSavingPrompt(true);
      try {
        await invoke("save_custom_prompt", {
          role: activePersona.id,
          content: "",
          activate: false,
        });
        setPromptProtection({
          role: activePersona.id,
          is_custom: false,
          display_status: "Defaulted",
          prompt_content: "",
        });
        updatePersona(activePersona.id, { promptProtectionMode: "Defaulted" });
      } catch (e: any) {
        addToast(`Error returning to default: ${e}`, "error");
      } finally {
        setSavingPrompt(false);
      }
    }

    addToast(`Returned ${selectedRule.name} to default proprietary engine`, "success");
  };

  const handleResetActivePersonaProps = () => {
    if (!activePersona) return;
    const defaultRef = DEFAULT_PERSONAS.find((p) => p.id === activePersona.id) || {
      temperature: 0.2,
      thinkingLevel: "high" as const,
      permissionLevel: "Sandboxed" as const,
      targetModel: "pro",
      promptProtectionMode: "Defaulted" as const,
      invariants: {
        produces: ["deliverable_spec"],
        prohibits: [],
        assumes: [],
      },
    };

    updatePersona(activePersona.id, {
      temperature: defaultRef.temperature,
      thinkingLevel: defaultRef.thinkingLevel,
      permissionLevel: defaultRef.permissionLevel,
      targetModel: defaultRef.targetModel,
      promptProtectionMode: defaultRef.promptProtectionMode,
      invariants: defaultRef.invariants,
    });

    handleReturnToDefault();
  };

  const handleCreateAgent = () => {
    const finalName = newAgentName.trim() || DEFAULT_NEW_AGENT.name;
    const finalId = (newAgentId.trim() || DEFAULT_NEW_AGENT.id).toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    const newP: AgentPersona = {
      id: finalId,
      name: finalName,
      role: newAgentRole.trim() || DEFAULT_NEW_AGENT.role,
      description: newAgentDescription.trim() || DEFAULT_NEW_AGENT.description,
      systemPrompt: newAgentPrompt.trim() || DEFAULT_NEW_AGENT.prompt,
      defaultTools: ["read", "write", "search"],
      temperature: newAgentTemperature ?? DEFAULT_NEW_AGENT.temperature,
      thinkingLevel: newAgentThinkingLevel || DEFAULT_NEW_AGENT.thinkingLevel,
      permissionLevel: newAgentPermissionLevel || DEFAULT_NEW_AGENT.permissionLevel,
      targetModel: newAgentTier === "fast_tier" ? "flash" : "pro",
      promptProtectionMode: "Defaulted",
      invariants: {
        produces: (newAgentProduces || DEFAULT_NEW_AGENT.produces)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        prohibits: (newAgentProhibits || DEFAULT_NEW_AGENT.prohibits)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        assumes: (newAgentAssumes || DEFAULT_NEW_AGENT.assumes)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    };

    addPersona(newP);
    setPrompts((prev) => ({ ...prev, [finalId]: newP.systemPrompt }));
    setActiveRuleId(finalId);
    setShowNewAgentModal(false);
    resetModalToDefaults();
    addToast(`Agent persona '${newP.name}' created`, "success");
  };

  // Group 1: Core Engine System Prompts (First)
  // Group 2: Layered Rule Directives (Second)
  // Group 3: Agent Personas, Roles & Prompts (Third)
  const ruleCategories = [
    {
      groupTitle: "Core Engine System Prompts",
      items: [
        {
          id: "system",
          name: "SYSTEM.md",
          icon: Zap,
          file: "crates/frostfire-engine/prompts/SYSTEM.md",
          tokens: 380,
          description: "Core executive protocol defining direct output, absolute brevity, evidence discovery, and safe execution guardrails.",
          defaultText: DEFAULT_SYSTEM_MD,
          source: (isRuleCustom("system") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
        {
          id: "compaction",
          name: "COMPACTION.md",
          icon: Cpu,
          file: "crates/frostfire-engine/prompts/COMPACTION.md",
          tokens: 310,
          description: "Context limit compression protocol synthesizing 9-section continuation checkpoints when token limits are reached.",
          defaultText: DEFAULT_COMPACTION_MD,
          source: (isRuleCustom("compaction") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
        {
          id: "subagent",
          name: "SUBAGENT_SYSTEM.md",
          icon: Users,
          file: "crates/frostfire-engine/prompts/SUBAGENT_SYSTEM.md",
          tokens: 290,
          description: "Delegation harness protocol defining subagent workspace isolation (inherit/branch/share) and reactive wakeup signaling.",
          defaultText: DEFAULT_SUBAGENT_SYSTEM_MD,
          source: (isRuleCustom("subagent") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
        {
          id: "artifacts",
          name: "ARTIFACTS.md",
          icon: Layers,
          file: "crates/frostfire-engine/prompts/ARTIFACTS.md",
          tokens: 260,
          description: "Persistent document protocol governing implementation plans, walkthroughs, diagrams, and sandboxed previews.",
          defaultText: DEFAULT_ARTIFACTS_MD,
          source: (isRuleCustom("artifacts") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
        {
          id: "automation",
          name: "AUTOMATION.md",
          icon: Route,
          file: "crates/frostfire-engine/prompts/AUTOMATION.md",
          tokens: 280,
          description: "Execution permission protocol governing tool sandboxing, MCP server sidecars, and background scheduled triggers.",
          defaultText: DEFAULT_AUTOMATION_MD,
          source: (isRuleCustom("automation") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
      ],
    },
    {
      groupTitle: "Layered Rule Directives",
      items: [
        {
          id: "global",
          name: "@GLOBAL-RULES",
          icon: Shield,
          file: "~/.gemini/GEMINI.md",
          tokens: 420,
          description: "Universal directives applied across everything: both interactive chat sessions and autonomous agents.",
          defaultText: DEFAULT_GLOBAL_RULES,
          source: (isRuleCustom("global") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
        {
          id: "project",
          name: "@PROJECT-RULES",
          icon: Shield,
          file: "AGENTS.md",
          tokens: 580,
          description: "Repository and codebase-specific directives applied to the selected project workspace.",
          defaultText: DEFAULT_PROJECT_RULES,
          source: (isRuleCustom("project") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
        {
          id: "workstreams",
          name: "@WORKSTREAM-RULES",
          icon: Route,
          file: "crates/frostfire-core/rules/WORKSTREAM_RULES.md",
          tokens: 210,
          description: "Universal orchestration directives that every single active workstream strictly follows.",
          defaultText: DEFAULT_WORKSTREAM_RULES,
          source: (isRuleCustom("workstreams") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
        {
          id: "team",
          name: "@TEAM-RULES",
          icon: Users,
          file: "templates/team-rules.md",
          tokens: 190,
          description: "Team-level governance and role-specialized directives applied to the selected agent team.",
          defaultText: DEFAULT_TEAM_RULES,
          source: (isRuleCustom("team") ? "custom" : "default") as "default" | "custom" | "plugin",
        },
      ],
    },
    {
      groupTitle: "Agent Personas, Roles & Prompts",
      isAgentGroup: true,
      items: personas.map((p) => {
        const isBuiltin = FROSTFIRE_BUILTIN_AGENT_IDS.includes(p.id);
        const customState = isRuleCustom(p.id);
        let src: "default" | "custom" | "plugin" = "default";
        if (p.id.includes("plugin") || (p as any).source === "plugin") {
          src = "plugin";
        } else if (!isBuiltin || customState) {
          src = "custom";
        }

        return {
          id: p.id,
          name: p.name,
          roleDesc: p.role,
          description: p.description || p.role,
          icon: Bot,
          file: `crates/frostfire-engine/prompts/proprietary/${p.id}.md`,
          isAgent: true,
          tokens: p.systemPrompt.length > 0 ? Math.round(p.systemPrompt.length / 4) : 400,
          source: src,
          defaultText: p.systemPrompt,
        };
      }),
    },
  ];

  const allItems = ruleCategories.flatMap((g) => g.items);
  const selectedRule = allItems.find((r) => r.id === activeRuleId) || allItems[0];
  const isSelectedCustom = isRuleCustom(selectedRule.id);

  const handleTextChange = (val: string) => {
    setPrompts((prev) => ({ ...prev, [selectedRule.id]: val }));
    if (activePersona) {
      updatePersona(activePersona.id, { systemPrompt: val });
    }
  };

  const handleSave = async () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
      if (activePersona && isSelectedCustom) {
        await invoke("save_custom_prompt", {
          role: activePersona.id,
          content: prompts[selectedRule.id] || "",
          activate: true,
        });
      }
      addToast(`Saved & updated ${selectedRule.name}`, "success");
    } catch {
      addToast("Failed to save rules", "error");
    }
  };

  const renderSourceTag = (source: "default" | "custom" | "plugin") => {
    if (source === "default") {
      return (
        <span className="text-[8.5px] font-mono px-1.5 py-0 rounded border bg-[#58a6ff]/10 text-[#58a6ff] border-[#58a6ff]/30 leading-tight whitespace-nowrap">
          Default
        </span>
      );
    }
    if (source === "plugin") {
      return (
        <span className="text-[8.5px] font-mono px-1.5 py-0 rounded border bg-purple-500/10 text-purple-300 border-purple-500/30 leading-tight whitespace-nowrap">
          Plugin
        </span>
      );
    }
    return (
      <span className="text-[8.5px] font-mono px-1.5 py-0 rounded border bg-[#f472b6]/10 text-[#f472b6] border-[#f472b6]/30 leading-tight whitespace-nowrap">
        Custom
      </span>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3.5 max-w-7xl mx-auto text-xs text-[#c9d1d9]">
      {/* Top Banner */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#30363d]">
        <div>
          <h2 className="text-sm font-semibold text-white mb-0.5 flex items-center space-x-2">
            <Shield className="w-4 h-4 text-[#58a6ff]" />
            <span>Core Prompts, Layered Rules &amp; Agent Personas</span>
          </h2>
          <p className="text-[#8b949e] text-[11px]">
            Govern FrostfireOS default protocols, custom user rules, and multi-agent persona invariant props.
          </p>
        </div>

        <button
          onClick={() => {
            resetModalToDefaults();
            setShowNewAgentModal(true);
          }}
          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#58a6ff] to-[#f472b6] text-white font-semibold text-xs flex items-center space-x-1.5 transition hover:opacity-90 shadow"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Agent Persona</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
        {/* Rule & Agent Selector Sidebar */}
        <div className="space-y-3 md:col-span-1">
          {ruleCategories.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">
                  {group.groupTitle}
                </span>
                {group.isAgentGroup && (
                  <button
                    onClick={() => {
                      resetModalToDefaults();
                      setShowNewAgentModal(true);
                    }}
                    className="text-[10px] text-[#58a6ff] hover:text-white flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {group.items.map((rule) => {
                  const isSelected = activeRuleId === rule.id;
                  return (
                    <button
                      key={rule.id}
                      onClick={() => setActiveRuleId(rule.id)}
                      className={`w-full py-1.5 px-2.5 rounded-lg border text-left transition flex flex-col justify-center ${
                        isSelected
                          ? "bg-gradient-to-r from-[#58a6ff]/20 to-[#f472b6]/20 border-[#f472b6]/40 text-white font-medium shadow-sm"
                          : "bg-[#161b22] border-[#30363d] text-[#8b949e] hover:text-white hover:border-[#484f58]"
                      }`}
                    >
                      {/* Top Row: [Name] [Default/Custom] */}
                      <div className="flex items-center justify-between w-full leading-tight">
                        <span className="font-mono text-[11px] font-semibold truncate text-white mr-2">
                          {rule.name}
                        </span>
                        {renderSourceTag(rule.source)}
                      </div>

                      {/* Bottom Row: [Role/Title] [-tokens] */}
                      <div className="flex items-center justify-between w-full mt-0.5 leading-tight">
                        {"roleDesc" in rule ? (
                          <span className="text-[9px] text-[#8b949e] truncate mr-2">
                            {(rule as any).roleDesc}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className="font-mono text-[9px] text-[#8b949e] flex-shrink-0 ml-auto">
                          -{rule.tokens}t
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Editor & Persona Details Panel */}
        <div className="md:col-span-3 bg-[#161b22] border border-[#30363d] rounded-xl p-3.5 flex flex-col space-y-3 min-h-[500px]">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#30363d] pb-2.5">
            <div className="space-y-0.5">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <span className="font-semibold text-white text-xs font-mono">{selectedRule.name}</span>
                {"roleDesc" in selectedRule && (
                  <span className="font-mono text-[10px] text-[#8b949e]">({(selectedRule as any).roleDesc})</span>
                )}
                {renderSourceTag(selectedRule.source)}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {isSelectedCustom && (
                <>
                  {/* Mode Toggle */}
                  <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded-lg p-0.5 space-x-0.5">
                    <button
                      onClick={() => setEditorMode("edit")}
                      className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                        editorMode === "edit"
                          ? "bg-gradient-to-r from-[#58a6ff] to-[#f472b6] text-white"
                          : "text-[#8b949e] hover:text-white"
                      }`}
                    >
                      <Code2 className="w-3 h-3" />
                      <span>Editor</span>
                    </button>
                    <button
                      onClick={() => setEditorMode("preview")}
                      className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                        editorMode === "preview"
                          ? "bg-gradient-to-r from-[#58a6ff] to-[#f472b6] text-white"
                          : "text-[#8b949e] hover:text-white"
                      }`}
                    >
                      <Eye className="w-3 h-3" />
                      <span>MarkView</span>
                    </button>
                  </div>

                  {/* Return to Default Button */}
                  <button
                    onClick={handleReturnToDefault}
                    className="px-2.5 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[11px] text-[#8b949e] hover:text-white border border-[#30363d] transition flex items-center space-x-1"
                    title="Return to default proprietary engine"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Return to Default</span>
                  </button>

                  {/* Save Button */}
                  <button
                    onClick={handleSave}
                    disabled={savingPrompt}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#58a6ff] to-[#f472b6] text-white font-semibold text-xs flex items-center space-x-1.5 transition shadow hover:opacity-90 active:scale-95"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Project Scoped Selector (When @PROJECT-RULES is active) */}
          {selectedRule.id === "project" && (
            <div className="flex items-center justify-between p-2.5 bg-[#0d1117] rounded-lg border border-[#30363d] text-xs">
              <div className="flex items-center space-x-2">
                <span className="text-[#8b949e]">Target Project:</span>
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-white font-mono text-[11px] outline-none"
                >
                  <option value="frostfireos">FrostfireOS (Current Workspace)</option>
                  <option value="frostfire_core">crates/frostfire-core</option>
                  <option value="frostfire_engine">crates/frostfire-engine</option>
                  <option value="src_tauri">src-tauri</option>
                </select>
              </div>
              <span className="text-[10px] text-[#58a6ff] font-mono">Individual Project Scope</span>
            </div>
          )}

          {/* Team Scoped Selector (When @TEAM-RULES is active) */}
          {selectedRule.id === "team" && (
            <div className="flex items-center justify-between p-2.5 bg-[#0d1117] rounded-lg border border-[#30363d] text-xs">
              <div className="flex items-center space-x-2">
                <span className="text-[#8b949e]">Target Team:</span>
                <select
                  value={selectedTeam}
                  onChange={(e) => setSelectedTeam(e.target.value)}
                  className="bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-white font-mono text-[11px] outline-none"
                >
                  <option value="architecture">Architecture &amp; Distributed Systems Team</option>
                  <option value="engine">Safe Rust Engine &amp; Execution Swarm</option>
                  <option value="frontend">React 19 &amp; Desktop Shell Team</option>
                  <option value="qa_security">Adversarial QA &amp; Security Verification Team</option>
                </select>
              </div>
              <span className="text-[10px] text-[#58a6ff] font-mono">Team-Specific Scope</span>
            </div>
          )}

          {/* Interactive Agent Persona Properties & Invariants Card (Shown when persona is selected) */}
          {activePersona && (
            <div className="p-2.5 bg-[#0d1117] rounded-lg border border-[#30363d] space-y-2">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-white text-xs">{activePersona.role}</span>
                    <button
                      onClick={() => {
                        const newTier = activePersona.targetModel === "flash" ? "pro" : "flash";
                        updatePersona(activePersona.id, { targetModel: newTier });
                        addToast(`Model Tier updated to ${newTier === "flash" ? "90% Fast Tier" : "10% Reasoning Lead"}`, "success");
                      }}
                      className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#161b22] text-[#58a6ff] border border-[#30363d] hover:border-[#58a6ff]/40 cursor-pointer transition"
                      title="Click to toggle Model Tier"
                    >
                      {activePersona.targetModel === "flash" ? "90% Fast Tier (Default)" : "10% Reasoning Lead"}
                    </button>
                  </div>
                </div>

                {/* Prompt Protection Dual-Mode Selector & Reset Props Button */}
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={handleResetActivePersonaProps}
                    className="p-1 rounded-md bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white transition"
                    title="Reset Persona Props to Default"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>

                  <div className="flex items-center space-x-1 bg-[#161b22] border border-[#30363d] p-0.5 rounded-lg">
                    <button
                      onClick={handleReturnToDefault}
                      disabled={!isSelectedCustom}
                      className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono transition ${
                        !isSelectedCustom
                          ? "bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40 font-semibold"
                          : "text-[#8b949e] hover:text-white"
                      }`}
                    >
                      <Lock className="w-2.5 h-2.5" />
                      <span>Default</span>
                    </button>
                    <button
                      onClick={() => promptSwitchToCustom(selectedRule.id)}
                      disabled={isSelectedCustom}
                      className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono transition ${
                        isSelectedCustom
                          ? "bg-[#f472b6]/20 text-[#f472b6] border border-[#f472b6]/40 font-semibold"
                          : "text-[#8b949e] hover:text-white"
                      }`}
                    >
                      <span>Custom</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Editable Props Grid */}
              <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-[#21262d] text-[11px]">
                <div className="p-1.5 px-2 rounded-md bg-[#161b22] border border-[#30363d] space-y-0.5">
                  <div className="text-[9.5px] text-[#8b949e] flex justify-between">
                    <span>Temperature</span>
                    <span className="font-mono text-white">{activePersona.temperature ?? 0.2}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={activePersona.temperature ?? 0.2}
                    onChange={(e) => updatePersona(activePersona.id, { temperature: parseFloat(e.target.value) })}
                    className="w-full accent-[#58a6ff] h-1 bg-[#0d1117] rounded cursor-pointer"
                  />
                </div>

                <div className="p-1.5 px-2 rounded-md bg-[#161b22] border border-[#30363d] space-y-0.5">
                  <div className="text-[9.5px] text-[#8b949e]">Thinking Budget</div>
                  <select
                    value={activePersona.thinkingLevel ?? "high"}
                    onChange={(e) => updatePersona(activePersona.id, { thinkingLevel: e.target.value as any })}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded px-1 py-0.5 text-white font-mono text-[9.5px] outline-none"
                  >
                    <option value="off">Off</option>
                    <option value="low">Low (1k)</option>
                    <option value="medium">Medium (4k)</option>
                    <option value="high">High (16k • Default)</option>
                    <option value="max">Max (32k)</option>
                  </select>
                </div>

                <div className="p-1.5 px-2 rounded-md bg-[#161b22] border border-[#30363d] space-y-0.5">
                  <div className="text-[9.5px] text-[#8b949e]">Permission Level</div>
                  <select
                    value={activePersona.permissionLevel ?? "Sandboxed"}
                    onChange={(e) => updatePersona(activePersona.id, { permissionLevel: e.target.value as any })}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded px-1 py-0.5 text-white font-mono text-[9.5px] outline-none"
                  >
                    <option value="Read-Only">Read-Only</option>
                    <option value="Sandboxed">Sandboxed (Default)</option>
                    <option value="Admin">Admin</option>
                  </select>
                </div>
              </div>

              {/* Invariants: Produces vs Prohibits vs Assumes */}
              <div className="pt-1.5 border-t border-[#21262d] flex flex-wrap items-center gap-2 text-[9.5px] font-mono">
                <div className="flex items-center gap-1">
                  <span className="text-[#8b949e]">Produces:</span>
                  {(activePersona.invariants?.produces || ["deliverable_spec"]).map((p) => (
                    <span key={p} className="px-1.5 py-0.2 rounded bg-[#58a6ff]/10 text-[#58a6ff]">
                      +{p}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[#8b949e]">Prohibits:</span>
                  {(activePersona.invariants?.prohibits || []).length > 0 ? (
                    activePersona.invariants?.prohibits.map((pr) => (
                      <span key={pr} className="px-1.5 py-0.2 rounded bg-[#f472b6]/10 text-[#f472b6]">
                        !{pr}
                      </span>
                    ))
                  ) : (
                    <span className="text-[#8b949e] italic">none</span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[#8b949e]">Assumes:</span>
                  {(activePersona.invariants?.assumes || []).length > 0 ? (
                    activePersona.invariants?.assumes.map((a) => (
                      <span key={a} className="px-1.5 py-0.2 rounded bg-[#21262d] text-[#c9d1d9]">
                        @{a}
                      </span>
                    ))
                  ) : (
                    <span className="text-[#8b949e] italic">none</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Compaction Controls (when COMPACTION.md is active and custom) */}
          {selectedRule.id === "compaction" && isSelectedCustom && (
            <div className="p-2.5 bg-[#0d1117] rounded-lg border border-[#30363d] space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sliders className="w-3.5 h-3.5 text-[#58a6ff]" />
                  <span className="font-semibold text-white text-xs">Compaction Trigger Threshold</span>
                </div>
                <span className="font-mono text-xs font-bold text-[#58a6ff]">
                  {compactingPercent}% of Context Window (Default: 85%)
                </span>
              </div>

              <input
                type="range"
                min="50"
                max="95"
                step="5"
                value={compactingPercent}
                onChange={(e) => setCompactingPercent(Number(e.target.value))}
                className="w-full accent-[#58a6ff] bg-[#161b22] rounded h-1.5 cursor-pointer"
              />
            </div>
          )}

          {/* Body: Protected Default (Proprietary Engine) View OR Markdown Editor */}
          <div className="flex-1 flex flex-col min-h-0">
            {!isSelectedCustom ? (
              /* Sleek Minimal Default (Proprietary Engine) View */
              <div className="flex-1 p-6 rounded-lg bg-[#0d1117] border border-[#30363d] flex flex-col items-center justify-center text-center space-y-3">
                <div className="flex items-center space-x-2 text-xs font-semibold text-white">
                  <Lock className="w-3.5 h-3.5 text-[#58a6ff]" />
                  <span>Default (Proprietary Engine)</span>
                </div>
                <button
                  onClick={() => promptSwitchToCustom(selectedRule.id)}
                  className="px-4 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-white transition hover:border-[#58a6ff]/40 active:scale-95 shadow-sm"
                >
                  Switch to Custom (Editable) Prompt
                </button>
                <p className="text-xs text-[#8b949e] max-w-md leading-relaxed pt-1">
                  {selectedRule.description}
                </p>
              </div>
            ) : editorMode === "edit" ? (
              <textarea
                rows={16}
                value={prompts[selectedRule.id] || ""}
                onChange={(e) => handleTextChange(e.target.value)}
                className="w-full flex-1 bg-[#0d1117] border border-[#30363d] rounded-xl p-4 text-white font-mono text-xs leading-relaxed outline-none focus:border-[#58a6ff] resize-none overflow-y-auto select-text"
                spellCheck={false}
                placeholder="Specify Markdown system prompt instructions..."
              />
            ) : (
              <div className="flex-1 overflow-y-auto bg-[#0d1117] border border-[#30363d] rounded-xl p-5">
                <MarkviewRenderer content={prompts[selectedRule.id] || ""} showLineNumbers={false} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Warning Confirmation Modal for Switching to Custom Mode */}
      {showCustomWarningModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-2 text-amber-400">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <h3 className="font-semibold text-white text-sm">Warning: Custom Prompt Edit</h3>
            </div>
            <p className="text-xs text-[#c9d1d9] leading-relaxed">
              Warning you&apos;re gonna edit this. This is gonna change how this behaves. If you ever want to go back, you can hit the &quot;Return to Default&quot; button.
            </p>
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#30363d]">
              <button
                onClick={() => {
                  setShowCustomWarningModal(false);
                  setPendingCustomRuleId(null);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-white text-xs transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmSwitchToCustom}
                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#58a6ff] to-[#f472b6] text-white font-semibold text-xs transition hover:opacity-90 active:scale-95"
              >
                Proceed to Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Agent Persona Creation Modal with Full Defaults */}
      {showNewAgentModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#30363d]">
              <div className="flex items-center space-x-2">
                <Bot className="w-5 h-5 text-[#58a6ff]" />
                <h3 className="font-semibold text-white text-sm">Create New Agent Persona &amp; Prompt</h3>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={resetModalToDefaults}
                  className="px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-white text-[10px] font-mono border border-[#30363d] transition flex items-center gap-1"
                  title="Reset all fields to recommended defaults"
                >
                  <RotateCcw className="w-3 h-3" /> Reset to Defaults
                </button>
                <button
                  onClick={() => setShowNewAgentModal(false)}
                  className="p-1 rounded-lg text-[#8b949e] hover:text-white hover:bg-[#21262d]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3 text-xs max-h-[70vh] overflow-y-auto pr-1">
              {/* Name & ID */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#8b949e] block mb-1">
                    Agent Name <span className="text-[#58a6ff] font-mono text-[10px]">(Default: Security SME)</span>
                  </label>
                  <input
                    type="text"
                    value={newAgentName}
                    onChange={(e) => {
                      setNewAgentName(e.target.value);
                      if (newAgentId === DEFAULT_NEW_AGENT.id || !newAgentId) {
                        setNewAgentId(e.target.value.toLowerCase().replace(/\s+/g, "_"));
                      }
                    }}
                    placeholder="e.g. Security SME"
                    className="w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white focus:border-[#58a6ff] outline-none"
                  />
                </div>
                <div>
                  <label className="text-[#8b949e] block mb-1">
                    Role ID (snake_case) <span className="text-[#58a6ff] font-mono text-[10px]">(Default: security_sme)</span>
                  </label>
                  <input
                    type="text"
                    value={newAgentId}
                    onChange={(e) => setNewAgentId(e.target.value)}
                    placeholder="e.g. security_sme"
                    className="w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white font-mono focus:border-[#58a6ff] outline-none"
                  />
                </div>
              </div>

              {/* Role Title & Description */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#8b949e] block mb-1">Role Title</label>
                  <input
                    type="text"
                    value={newAgentRole}
                    onChange={(e) => setNewAgentRole(e.target.value)}
                    placeholder="e.g. Application Security & Zero-Trust Auditor"
                    className="w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white focus:border-[#58a6ff] outline-none"
                  />
                </div>
                <div>
                  <label className="text-[#8b949e] block mb-1">Description</label>
                  <input
                    type="text"
                    value={newAgentDescription}
                    onChange={(e) => setNewAgentDescription(e.target.value)}
                    placeholder="e.g. Enforces zero-trust boundaries..."
                    className="w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white focus:border-[#58a6ff] outline-none"
                  />
                </div>
              </div>

              {/* Execution Props: Tier, Temperature, Thinking, Permissions */}
              <div className="grid grid-cols-4 gap-2 p-3 bg-[#0d1117] rounded-xl border border-[#30363d]">
                <div>
                  <label className="text-[10px] text-[#8b949e] block mb-1">Model Tier</label>
                  <select
                    value={newAgentTier}
                    onChange={(e) => setNewAgentTier(e.target.value as any)}
                    className="w-full bg-[#161b22] border border-[#30363d] rounded p-1 text-white text-[10px] font-mono outline-none"
                  >
                    <option value="fast_tier">90% Fast (Default)</option>
                    <option value="reasoning_lead">10% Reasoning</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-[#8b949e] block mb-1">Temp ({newAgentTemperature})</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={newAgentTemperature}
                    onChange={(e) => setNewAgentTemperature(parseFloat(e.target.value))}
                    className="w-full accent-[#58a6ff] h-1.5 bg-[#161b22] rounded cursor-pointer mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-[#8b949e] block mb-1">Thinking</label>
                  <select
                    value={newAgentThinkingLevel}
                    onChange={(e) => setNewAgentThinkingLevel(e.target.value as any)}
                    className="w-full bg-[#161b22] border border-[#30363d] rounded p-1 text-white text-[10px] font-mono outline-none"
                  >
                    <option value="off">Off</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High (Default)</option>
                    <option value="max">Max</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-[#8b949e] block mb-1">Permissions</label>
                  <select
                    value={newAgentPermissionLevel}
                    onChange={(e) => setNewAgentPermissionLevel(e.target.value as any)}
                    className="w-full bg-[#161b22] border border-[#30363d] rounded p-1 text-white text-[10px] font-mono outline-none"
                  >
                    <option value="Read-Only">Read-Only</option>
                    <option value="Sandboxed">Sandboxed (Default)</option>
                    <option value="Admin">Admin</option>
                  </select>
                </div>
              </div>

              {/* Invariant Contracts */}
              <div className="space-y-2">
                <div>
                  <label className="text-[#8b949e] block mb-1">
                    Produces Invariants <span className="text-[#58a6ff] font-mono text-[10px]">(Default: security_audit, threat_model, cve_assessment)</span>
                  </label>
                  <input
                    type="text"
                    value={newAgentProduces}
                    onChange={(e) => setNewAgentProduces(e.target.value)}
                    placeholder="e.g. security_audit, threat_model"
                    className="w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white font-mono text-[11px] focus:border-[#58a6ff] outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[#8b949e] block mb-1">Prohibits Invariants</label>
                    <input
                      type="text"
                      value={newAgentProhibits}
                      onChange={(e) => setNewAgentProhibits(e.target.value)}
                      placeholder="e.g. plaintext_secrets, public_endpoints"
                      className="w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white font-mono text-[11px] focus:border-[#58a6ff] outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[#8b949e] block mb-1">Assumes Invariants</label>
                    <input
                      type="text"
                      value={newAgentAssumes}
                      onChange={(e) => setNewAgentAssumes(e.target.value)}
                      placeholder="e.g. architecture_spec, source_code"
                      className="w-full px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white font-mono text-[11px] focus:border-[#58a6ff] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* System Prompt */}
              <div>
                <label className="text-[#8b949e] block mb-1">
                  System Prompt / Instructions <span className="text-[#58a6ff] font-mono text-[10px]">(Pre-populated with default template)</span>
                </label>
                <textarea
                  rows={4}
                  value={newAgentPrompt}
                  onChange={(e) => setNewAgentPrompt(e.target.value)}
                  placeholder="# System Instructions&#10;Define behavioral directives..."
                  className="w-full p-3 rounded-lg bg-[#0d1117] border border-[#30363d] text-white font-mono text-[11px] focus:border-[#58a6ff] outline-none resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#30363d]">
              <span className="text-[10px] text-[#8b949e]">
                All fields pre-loaded with production defaults.
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowNewAgentModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-white text-xs transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateAgent}
                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#58a6ff] to-[#f472b6] text-white font-semibold text-xs flex items-center space-x-1.5 transition hover:opacity-90 active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Persona &amp; Prompt</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
