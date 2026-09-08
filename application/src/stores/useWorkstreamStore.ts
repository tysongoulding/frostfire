import { create } from "zustand";
import { BlackboardArtifact, TeamPlan, ToolApprovalRequest, WorkstreamEvent } from "@/types/protocol";

export interface SmeTask {
  id: string;
  agentId: string;
  role: string;
  phase: string;
  status: "pending" | "running" | "completed" | "failed";
  streamOutput: string;
}

export interface WorkstreamItem {
  id: string;
  name: string;
  blueprintId: string;
  status: "pending" | "running" | "paused" | "completed";
  currentPhase: string;
  tasks: SmeTask[];
  plan?: TeamPlan;
  artifacts: BlackboardArtifact[];
}

interface WorkstreamStore {
  workstreams: WorkstreamItem[];
  activeWorkstreamId: string | null;
  pendingApproval: ToolApprovalRequest | null;
  setActiveWorkstream: (id: string) => void;
  addWorkstream: (item: WorkstreamItem) => void;
  updateTaskStream: (taskId: string, chunk: string) => void;
  handleIncomingEvent: (event: WorkstreamEvent) => void;
  setPendingApproval: (req: ToolApprovalRequest | null) => void;
}

export const useWorkstreamStore = create<WorkstreamStore>((set) => ({
  workstreams: [],
  activeWorkstreamId: null,
  pendingApproval: null,

  setActiveWorkstream: (id) => set({ activeWorkstreamId: id }),

  addWorkstream: (item) =>
    set((state) => ({
      workstreams: [item, ...state.workstreams],
      activeWorkstreamId: item.id,
    })),

  updateTaskStream: (taskId, chunk) =>
    set((state) => ({
      workstreams: state.workstreams.map((ws) => ({
        ...ws,
        tasks: ws.tasks.map((t) =>
          t.id === taskId ? { ...t, streamOutput: t.streamOutput + chunk } : t
        ),
      })),
    })),

  handleIncomingEvent: (event) =>
    set((state) => {
      if (event.event === "sme_task_started") {
        return {
          workstreams: state.workstreams.map((ws) => {
            const exists = ws.tasks.some((t) => t.id === event.task_id);
            if (!exists) {
              return {
                ...ws,
                tasks: [
                  ...ws.tasks,
                  {
                    id: event.task_id,
                    agentId: event.agent_id,
                    role: event.role,
                    phase: event.phase,
                    status: "running",
                    streamOutput: "",
                  },
                ],
              };
            }
            return ws;
          }),
        };
      }

      if (event.event === "token_stream") {
        return {
          workstreams: state.workstreams.map((ws) => ({
            ...ws,
            tasks: ws.tasks.map((t) =>
              t.id === event.task_id
                ? { ...t, streamOutput: t.streamOutput + event.chunk }
                : t
            ),
          })),
        };
      }

      if (event.event === "tool_approval_request") {
        return { pendingApproval: event };
      }

      return state;
    }),

  setPendingApproval: (req) => set({ pendingApproval: req }),
}));
