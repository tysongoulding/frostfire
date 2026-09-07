import { RpcCommand, RpcEvent, RpcMessage, RpcRequest, RpcResponse } from "./protocol";

type EventListener = (event: RpcEvent) => void;

export class RhoClient {
  private reqSeq = 0;
  private pending = new Map<string, (res: RpcResponse) => void>();
  private listeners = new Set<EventListener>();

  constructor() {
    this.setupTransport();
  }

  private setupTransport() {
    // Check if running inside Tauri webview
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<RpcEvent>("rho://event", (event) => {
          this.notifyListeners(event.payload);
        });
      });
    }
  }

  public onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(event: RpcEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public handleInboundMessage(raw: string) {
    try {
      const msg = JSON.parse(raw) as RpcMessage;
      if (msg.type === "response") {
        const res = msg as RpcResponse;
        if (res.id && this.pending.has(res.id)) {
          this.pending.get(res.id)!(res);
          this.pending.delete(res.id);
        }
      } else {
        this.notifyListeners(msg as RpcEvent);
      }
    } catch (err) {
      console.error("Failed to parse inbound RPC message:", err);
    }
  }

  public async sendCommand(cmd: RpcCommand): Promise<RpcResponse> {
    const id = `req-${++this.reqSeq}`;
    const payload: RpcRequest = { id, ...cmd };

    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<RpcResponse>("send_rpc_command", { request: payload });
    }

    // Fallback: mock response in browser dev mode
    return {
      id,
      type: "response",
      command: cmd.type,
      success: true,
      data: null,
      error: null,
    };
  }

  public prompt(message: string, model?: string, provider?: string, preamble?: string, webSearch?: boolean) {
    return this.sendCommand({
      type: "prompt",
      message,
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      ...(preamble ? { preamble } : {}),
      ...(webSearch ? { web_search: true } : {}),
    });
  }

  public searchWeb(query: string) {
    return this.sendCommand({ type: "web_search", query });
  }

  public steer(message: string) {
    return this.sendCommand({ type: "steer", message });
  }

  public abort() {
    return this.sendCommand({ type: "abort" });
  }

  public respondToTool(approval_id: string, decision: "allow" | "deny") {
    return this.sendCommand({ type: "tool_response", approval_id, decision });
  }
}

export const rhoClient = new RhoClient();
