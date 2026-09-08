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

interface AutomationState {
  automations: AutomationJob[];
  runningJobIds: string[];
  addAutomation: (job: Omit<AutomationJob, "id" | "createdAt" | "status">) => void;
  updateAutomation: (id: string, updates: Partial<AutomationJob>) => void;
  deleteAutomation: (id: string) => void;
  toggleStatus: (id: string) => void;
  runJobNow: (id: string) => Promise<void>;
}

const STORAGE_KEY = "frostfire_automations_v1";

const loadInitialAutomations = (): AutomationJob[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load automations from localStorage", err);
  }
  return [];
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
