// Strongly-typed RPC protocol matching crates/rho-harness-core/src/rpc/protocol.rs

export type RpcCommand =
  | { type: "prompt"; message: string; model?: string; provider?: string; preamble?: string; images?: unknown[]; streaming_behavior?: string; web_search?: boolean }
  | { type: "web_search"; query: string }
  | { type: "steer"; message: string }
  | { type: "abort" }
  | { type: "tool_response"; approval_id: string; decision: "allow" | "deny" | string }
  | { type: "compact"; instructions?: string }
  | { type: "set_model"; model: string; provider?: string }
  | { type: "get_state" }
  | { type: "exit" };

export type RpcRequest = {
  id?: string;
} & RpcCommand;

export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: Record<string, unknown> | null;
  error?: string | null;
}

export type RpcEvent =
  | {
      type: "session_start";
      session_id: string;
      model: string;
      provider: string;
    }
  | {
      type: "turn_start";
      turn_number: number;
      prompt: string;
    }
  | {
      type: "text_chunk";
      content: string;
    }
  | {
      type: "reasoning_chunk";
      content: string;
    }
  | {
      type: "tool_call_start";
      call_id: string;
      tool: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_approval_request";
      approval_id: string;
      tool: string;
      arguments: Record<string, unknown>;
      description?: string;
    }
  | {
      type: "tool_call_result";
      call_id: string;
      tool: string;
      output: string;
      is_error: boolean;
      duration_ms: u64;
    }
  | {
      type: "usage_update";
      input_tokens?: number;
      output_tokens?: number;
      context_percent?: number;
    }
  | {
      type: "turn_end";
      stop_reason: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
    };

type u64 = number;
export type RpcMessage = RpcResponse | RpcEvent;
