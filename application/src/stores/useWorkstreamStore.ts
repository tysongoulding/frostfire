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
  workstreams: [
    {
      id: "ws-demo-1hour",
      name: "1-Hour Agentic Sprint: MVP Synthesis",
      blueprintId: "1hour-sprint",
      status: "running",
      currentPhase: "Phase 1: Understand & Map",
      tasks: [
        {
          id: "task-101",
          agentId: "sme_research",
          role: "Research Specialist",
          phase: "Understand & Map",
          status: "running",
          streamOutput: "Synthesizing requirements from product directive... Ingested 4 core packages. Identified Blackboard write ACL and 90/10 asymmetric routing invariants.",
        },
        {
          id: "task-102",
          agentId: "sme_user_advocate",
          role: "User Advocate",
          phase: "Understand & Map",
          status: "completed",
          streamOutput: "Generated user persona journey map for non-technical Department Managers.",
        },
        {
          id: "task-103",
          agentId: "sme_architect",
          role: "Lead Architect",
          phase: "Sketch & Ideate",
          status: "pending",
          streamOutput: "",
        },
        {
          id: "task-104",
          agentId: "team_pm",
          role: "Team PM Agent",
          phase: "Decide & Storyboard",
          status: "pending",
          streamOutput: "",
        },
      ],
      artifacts: [
        {
          uri: "blackboard://ws-demo-1hour/team-research/sme_research/user_journey@v1",
          author_id: "sme_research",
          title: "User Journey & Domain Model Brief",
          content: "# User Journey & Domain Model Brief\n\n### 1. Primary Persona: Non-Technical Department Manager\n- Needs zero-code deployment of 4-tier agent federations.\n- Requires human-in-the-loop governance for mutations.\n- Needs transparent FTA ROI metrics.\n\n### 2. Architectural Bounds\n- Blackboard URI isolation: `blackboard://{ws}/{team}/{agent}/{artifact}@v{version}`\n- 90/10 asymmetric model routing (SME vs Frontier).",
          mime_type: "text/markdown",
          version: 1,
          hash: "a3f58e...b92",
          created_at: new Date().toISOString(),
        },
      ],
    },
  ],
  activeWorkstreamId: "ws-demo-1hour",
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
