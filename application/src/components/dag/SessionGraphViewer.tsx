import { useState, useEffect } from "react";
import { GitBranch, Clock, User, Bot, Wrench, History, ChevronRight } from "lucide-react";
import { useSessionStore } from "../../store/sessionStore";

interface SavedSession {
  session_id: string;
  name?: string;
  created_at: string;
  last_modified: string;
  turn_count: number;
  preview: string;
}

export function SessionGraphViewer() {
  const { messages, sessionInfo } = useSessionStore();
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<SavedSession[]>("list_saved_sessions")
          .then((res) => {
            if (res) setSavedSessions(res);
          })
          .catch((err) => console.warn("Failed to load saved sessions:", err));
      });
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
            <GitBranch className="w-4 h-4 text-[#58a6ff]" />
            <span>DAG Session Exploration</span>
          </h2>
          <p className="text-[#8b949e]">
            Visual execution tree of conversational turns, tool forks, and checkpoints.
          </p>
        </div>

        {sessionInfo.id && (
          <span className="font-mono text-[11px] bg-[#161b22] px-2 py-1 rounded border border-[#30363d] text-white">
            Active Session: {sessionInfo.id.slice(0, 10)}
          </span>
        )}
      </div>

      {/* Active Session Turn Tree */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <h3 className="text-xs font-semibold text-white flex items-center space-x-1.5">
          <Clock className="w-3.5 h-3.5 text-[#58a6ff]" />
          <span>Active Turn Tree ({messages.length} turns)</span>
        </h3>

        {messages.length === 0 ? (
          <div className="text-center py-6 text-[#8b949e]">
            <Clock className="w-5 h-5 mx-auto mb-2 text-[#30363d]" />
            <p>No turns recorded in the active session DAG yet.</p>
          </div>
        ) : (
          <div className="relative pl-6 space-y-4 border-l-2 border-[#30363d] ml-3">
            {messages.map((msg, idx) => (
              <div key={msg.id} className="relative">
                {/* Node dot */}
                <div
                  className={`absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-[#161b22] ${
                    msg.role === "user"
                      ? "bg-blue-500"
                      : msg.role === "tool"
                      ? "bg-amber-400"
                      : "bg-purple-500"
                  }`}
                />

                <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 font-semibold text-white">
                      {msg.role === "user" ? (
                        <User className="w-3.5 h-3.5 text-blue-400" />
                      ) : msg.role === "tool" ? (
                        <Wrench className="w-3.5 h-3.5 text-amber-400" />
                      ) : (
                        <Bot className="w-3.5 h-3.5 text-purple-400" />
                      )}
                      <span className="capitalize">{msg.role} Turn #{idx + 1}</span>
                    </div>
                    <span className="font-mono text-[10px] text-[#8b949e]">
                      {msg.id.slice(0, 8)}
                    </span>
                  </div>

                  <p className="text-[11px] text-[#8b949e] line-clamp-2">
                    {msg.role === "tool"
                      ? `Tool: ${msg.toolCall?.tool || "execution"}`
                      : msg.content || (msg.reasoning ? "Thinking..." : "Turn")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historical Saved Sessions */}
      {savedSessions.length > 0 && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-white flex items-center space-x-1.5">
            <History className="w-3.5 h-3.5 text-purple-400" />
            <span>Persisted Session Checkpoints (~/.config/rho/sessions)</span>
          </h3>

          <div className="space-y-2">
            {savedSessions.map((s) => (
              <div
                key={s.session_id}
                className="p-3 bg-[#0d1117] border border-[#30363d] rounded-lg flex items-center justify-between hover:border-[#58a6ff] transition"
              >
                <div className="space-y-1 truncate pr-3">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-semibold text-white text-xs truncate">
                      {s.name || s.session_id}
                    </span>
                    <span className="text-[10px] text-[#8b949e] bg-[#161b22] px-1.5 py-0.5 rounded border border-[#30363d]">
                      {s.turn_count} turns
                    </span>
                  </div>
                  {s.preview && (
                    <p className="text-[11px] text-[#8b949e] truncate">{s.preview}</p>
                  )}
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0 text-[#8b949e]">
                  <span className="text-[10px] font-mono">
                    {new Date(s.last_modified).toLocaleDateString()}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8b949e]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
