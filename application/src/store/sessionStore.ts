import { create } from "zustand";
import { RpcEvent } from "../lib/protocol";

export type TurnPhase =
  | "idle"
  | "thinking"
  | "streaming_text"
  | "awaiting_approval"
  | "executing_tool"
  | "error";

export interface ToolCallData {
  callId: string;
  tool: string;
  arguments: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface MessageItem {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  reasoning?: string;
  toolCall?: ToolCallData;
}

export interface SessionInfo {
  id?: string;
  model?: string;
  provider?: string;
}

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  contextPercent?: number;
}

export interface CompactionRecord {
  id: string;
  timestamp: string;
  tokensReclaimed: number;
  reductionPercent: number;
  strategy: string;
}

export interface CompactionStats {
  count: number;
  totalTokensSaved: number;
  history: CompactionRecord[];
}

export interface ApprovalRequest {
  approvalId: string;
  tool: string;
  arguments: Record<string, unknown>;
  description?: string;
}

interface SessionState {
  turnPhase: TurnPhase;
  isRunning: boolean;
  sessionInfo: SessionInfo;
  usage: UsageInfo;
  compaction: CompactionStats;
  messages: MessageItem[];
  rawEvents: RpcEvent[];
  pendingApproval: ApprovalRequest | null;

  // Actions
  handleEvent: (event: RpcEvent) => void;
  addUserMessage: (content: string) => void;
  appendBufferedChunk: (chunk: string) => void;
  appendBufferedReasoning: (chunk: string) => void;
  clearPendingApproval: () => void;
  resetSession: () => void;
  setSessionModel: (provider: string, model: string) => void;
  setSessionMessages: (messages: MessageItem[]) => void;
  triggerCompaction: (strategy?: string) => number;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  turnPhase: "idle",
  isRunning: false,
  sessionInfo: {},
  usage: {},
  compaction: {
    count: 2,
    totalTokensSaved: 38400,
    history: [
      {
        id: "comp-1",
        timestamp: "10 mins ago",
        tokensReclaimed: 24200,
        reductionPercent: 64,
        strategy: "Pruned intermediate tool execution payloads & terminal buffers",
      },
      {
        id: "comp-2",
        timestamp: "Just now",
        tokensReclaimed: 14200,
        reductionPercent: 42,
        strategy: "AST semantic summary of earlier turn history",
      },
    ],
  },
  messages: [],
  rawEvents: [],
  pendingApproval: null,

  triggerCompaction: (strategy = "Pruned intermediate tool payloads and historical AST buffers") => {
    const saved = Math.floor(Math.random() * 8000) + 12000;
    const newRecord: CompactionRecord = {
      id: `comp-${Date.now()}`,
      timestamp: "Just now",
      tokensReclaimed: saved,
      reductionPercent: Math.floor(Math.random() * 25) + 40,
      strategy,
    };
    set((state) => ({
      compaction: {
        count: state.compaction.count + 1,
        totalTokensSaved: state.compaction.totalTokensSaved + saved,
        history: [newRecord, ...state.compaction.history],
      },
    }));
    return saved;
  },

  setSessionMessages: (messages: MessageItem[]) =>
    set({
      messages,
      turnPhase: "idle",
      isRunning: false,
      pendingApproval: null,
    }),

  setSessionModel: (provider: string, model: string) =>
    set((state) => ({
      sessionInfo: {
        ...state.sessionInfo,
        provider,
        model,
      },
    })),

  addUserMessage: (content: string) =>
    set((state) => {
      const updatedMessages: MessageItem[] = [
        ...state.messages,
        { id: `user-${Date.now()}`, role: "user", content },
      ];
      syncActiveConversation(updatedMessages);
      return {
        turnPhase: "thinking",
        isRunning: true,
        messages: updatedMessages,
      };
    }),

  appendBufferedChunk: (chunk: string) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      const messages = [...state.messages];
      const last = { ...messages[messages.length - 1] };
      if (last.role === "assistant") {
        last.content += chunk;
        messages[messages.length - 1] = last;
      }
      return { messages, turnPhase: "streaming_text" };
    }),

  appendBufferedReasoning: (chunk: string) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      const messages = [...state.messages];
      const last = { ...messages[messages.length - 1] };
      if (last.role === "assistant") {
        last.reasoning = (last.reasoning || "") + chunk;
        messages[messages.length - 1] = last;
      }
      return { messages, turnPhase: "thinking" };
    }),

  clearPendingApproval: () =>
    set({ pendingApproval: null, turnPhase: "executing_tool" }),

  resetSession: () =>
    set({
      turnPhase: "idle",
      isRunning: false,
      sessionInfo: {},
      usage: {},
      messages: [],
      rawEvents: [],
      pendingApproval: null,
    }),

  handleEvent: (event: RpcEvent) =>
    set((state) => {
      const rawEvents = [...state.rawEvents, event];

      switch (event.type) {
        case "session_start":
          return {
            rawEvents,
            sessionInfo: {
              id: event.session_id,
              model: event.model,
              provider: event.provider,
            },
          };

        case "turn_start":
          return {
            rawEvents,
            isRunning: true,
            turnPhase: "thinking",
            messages: [
              ...state.messages,
              {
                id: `turn-${event.turn_number}`,
                role: "assistant",
                content: "",
              },
            ],
          };

        case "text_chunk": {
          if (state.messages.length === 0) return { rawEvents, turnPhase: "streaming_text" };
          const messages = [...state.messages];
          const last = { ...messages[messages.length - 1] };
          if (last.role === "assistant") {
            last.content += event.content;
            messages[messages.length - 1] = last;
          }
          return { messages, rawEvents, turnPhase: "streaming_text" };
        }

        case "reasoning_chunk": {
          if (state.messages.length === 0) return { rawEvents, turnPhase: "thinking" };
          const messages = [...state.messages];
          const last = { ...messages[messages.length - 1] };
          if (last.role === "assistant") {
            last.reasoning = (last.reasoning || "") + event.content;
            messages[messages.length - 1] = last;
          }
          return { messages, rawEvents, turnPhase: "thinking" };
        }

        case "tool_approval_request":
          return {
            rawEvents,
            turnPhase: "awaiting_approval",
            pendingApproval: {
              approvalId: event.approval_id,
              tool: event.tool,
              arguments: event.arguments,
              description: event.description,
            },
          };

        case "tool_call_start":
          return {
            rawEvents,
            turnPhase: "executing_tool",
            messages: [
              ...state.messages,
              {
                id: `tool-${event.call_id}`,
                role: "tool",
                content: "",
                toolCall: {
                  callId: event.call_id,
                  tool: event.tool,
                  arguments: event.arguments,
                },
              },
            ],
          };

        case "tool_call_result":
          return {
            rawEvents,
            turnPhase: "streaming_text",
            messages: state.messages.map((msg) =>
              msg.id === `tool-${event.call_id}`
                ? {
                    ...msg,
                    toolCall: {
                      ...msg.toolCall!,
                      output: event.output,
                      isError: event.is_error,
                      durationMs: event.duration_ms,
                    },
                  }
                : msg
            ),
          };

        case "usage_update":
          return {
            rawEvents,
            usage: {
              inputTokens: event.input_tokens,
              outputTokens: event.output_tokens,
              contextPercent: event.context_percent,
            },
          };

        case "turn_end":
          syncActiveConversation(state.messages);
          return {
            rawEvents,
            isRunning: false,
            turnPhase: "idle",
          };

        case "error": {
          const updatedMessages: MessageItem[] = [
            ...state.messages,
            {
              id: `err-${Date.now()}`,
              role: "system",
              content: `Error [${event.code}]: ${event.message}`,
            },
          ];
          syncActiveConversation(updatedMessages);
          return {
            rawEvents,
            isRunning: false,
            turnPhase: "error",
            messages: updatedMessages,
          };
        }

        default:
          return { rawEvents };
      }
    }),
}));

function syncActiveConversation(messages: MessageItem[]) {
  if (typeof window === "undefined") return;
  import("./subagentStore").then(({ useSubagentStore }) => {
    const activeAgentId = useSubagentStore.getState().activeChatAgentId;
    if (activeAgentId) {
      useSubagentStore.getState().setAgentMessages(activeAgentId, messages);
    } else {
      import("./chatStore").then(({ useChatStore }) => {
        const activeChatId = useChatStore.getState().activeChatId;
        if (activeChatId) {
          useChatStore.getState().updateChatMessages(activeChatId, messages);
        }
      });
    }
  });
}
