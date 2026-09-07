import { create } from "zustand";

export interface AutomationJob {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  scheduleLabel: string;
  nextRun: string;
  lastRun?: string;
  lastDuration?: string;
  status: "active" | "scheduled" | "running" | "paused";
  targetAgent: string;
  targetPrompt: string;
  toolIntegrations: string[];
  createdAt: string;
}

const DEFAULT_AUTOMATIONS: AutomationJob[] = [
  {
    id: "auto-1",
    name: "Continuous Cargo Linter & Red-Green Verification",
    description: "Runs cargo fmt check, cargo clippy with zero tolerance, and cargo nextest parallel test harness across all targets.",
    cronExpression: "*/30 * * * *",
    scheduleLabel: "Every 30 minutes",
    nextRun: new Date(Date.now() + 18 * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    lastRun: "12 mins ago",
    lastDuration: "3.4s",
    status: "active",
    targetAgent: "Build Implementer",
    targetPrompt: "Run cargo fmt --check, cargo clippy --all-targets -- -D warnings, and cargo nextest run. Verify red-first TDD invariants.",
    toolIntegrations: ["run_command", "cargo", "clippy"],
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
  {
    id: "auto-2",
    name: "Nightly Context Health & Token Compactor Daemon",
    description: "Audits active DAG session contexts, purges obsolete tool stdout, and executes lossless 9-section compaction turns.",
    cronExpression: "0 2 * * *",
    scheduleLabel: "Daily at 02:00 AM UTC",
    nextRun: "Tomorrow at 02:00:00 AM",
    lastRun: "Yesterday at 02:00:01 AM",
    lastDuration: "1.2s",
    status: "scheduled",
    targetAgent: "Rho Context Compactor",
    targetPrompt: "Compact session DAG nodes exceeding 85% token threshold using rig.rs lossless continuation format.",
    toolIntegrations: ["schedule", "rig.rs", "compactor"],
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
  },
  {
    id: "auto-3",
    name: "Pull Request Auto-Triage & Story Map Coverage",
    description: "Scans new GitHub PRs, checks against known defect catalog regressions, and verifies UAT role-based story map coverage.",
    cronExpression: "0 * * * *",
    scheduleLabel: "Hourly on the hour",
    nextRun: new Date(Date.now() + 45 * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    lastRun: "15 mins ago",
    lastDuration: "5.8s",
    status: "active",
    targetAgent: "Team QA Lead",
    targetPrompt: "Inspect open PRs via GitHub MCP, review changed files against defect catalog, and generate test assertions.",
    toolIntegrations: ["github", "mcp", "story-map"],
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
  {
    id: "auto-4",
    name: "Librarian Durable Knowledge Ingestion",
    description: "Extracts architectural decisions and reusable solutions from recent conversation transcripts into shared library.",
    cronExpression: "0 0 * * 0",
    scheduleLabel: "Weekly on Sunday at 00:00",
    nextRun: "Sunday at 00:00:00",
    lastRun: "3 days ago",
    lastDuration: "2.1s",
    status: "scheduled",
    targetAgent: "Team Librarian",
    targetPrompt: "Harvest durable engineering insights and architectural decisions from logs and update Table of Contents.",
    toolIntegrations: ["librarian", "read_file", "write_to_file"],
    createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
  },
  {
    id: "auto-5",
    name: "MCP Server Health & IPC Heartbeat Check",
    description: "Pings registered Model Context Protocol sidecars (Context-Mode, GitHub, Workspace) to verify socket responsiveness.",
    cronExpression: "*/10 * * * *",
    scheduleLabel: "Every 10 minutes",
    nextRun: new Date(Date.now() + 6 * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    lastRun: "4 mins ago",
    lastDuration: "0.8s",
    status: "active",
    targetAgent: "Default Autonomous Agent",
    targetPrompt: "Ping MCP socket endpoints and report tool latency metrics to telemetry dashboard.",
    toolIntegrations: ["plug-zap", "ipc", "mcp-daemon"],
    createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
  },
];

interface AutomationState {
  automations: AutomationJob[];
  runningJobIds: string[];
  addAutomation: (job: Omit<AutomationJob, "id" | "createdAt" | "status">) => void;
  updateAutomation: (id: string, updates: Partial<AutomationJob>) => void;
  deleteAutomation: (id: string) => void;
  toggleStatus: (id: string) => void;
  runJobNow: (id: string) => Promise<void>;
}

const STORAGE_KEY = "rho_lota_automations_v1";

const loadInitialAutomations = (): AutomationJob[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load automations from localStorage", err);
  }
  return DEFAULT_AUTOMATIONS;
};

export const useAutomationStore = create<AutomationState>((set) => ({
  automations: loadInitialAutomations(),
  runningJobIds: [],

  addAutomation: (job) =>
    set((state) => {
      const newJob: AutomationJob = {
        ...job,
        id: `auto-${Date.now()}`,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      const updated = [newJob, ...state.automations];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { automations: updated };
    }),

  updateAutomation: (id, updates) =>
    set((state) => {
      const updated = state.automations.map((a) => (a.id === id ? { ...a, ...updates } : a));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { automations: updated };
    }),

  deleteAutomation: (id) =>
    set((state) => {
      const updated = state.automations.filter((a) => a.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { automations: updated };
    }),

  toggleStatus: (id) =>
    set((state) => {
      const updated = state.automations.map((a) => {
        if (a.id === id) {
          const nextStatus = a.status === "paused" ? "active" : "paused";
          return { ...a, status: nextStatus as "active" | "paused" };
        }
        return a;
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { automations: updated };
    }),

  runJobNow: async (id) => {
    set((state) => ({ runningJobIds: [...state.runningJobIds, id] }));

    // Simulate real background task execution
    await new Promise((resolve) => setTimeout(resolve, 2000));

    set((state) => {
      const updated = state.automations.map((a) => {
        if (a.id === id) {
          return {
            ...a,
            lastRun: "Just now",
            lastDuration: `${(Math.random() * 2 + 0.5).toFixed(1)}s`,
          };
        }
        return a;
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return {
        automations: updated,
        runningJobIds: state.runningJobIds.filter((jobId) => jobId !== id),
      };
    });
  },
}));
