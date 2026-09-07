import { create } from "zustand";

export interface ArtifactVersion {
  version: number;
  content: string;
  prompt?: string;
  timestamp: string;
  commitHash: string;
}

export interface ArtifactItem {
  id: string;
  name: string;
  extension: string;
  language: string;
  content: string;
  summary: string;
  userFacing: boolean;
  createdAt: string;
  updatedAt: string;
  versions?: ArtifactVersion[];
  currentVersion?: number;
  finalized?: boolean;
}

const DEFAULT_ARTIFACTS: ArtifactItem[] = [
  {
    id: "art-mermaid-1",
    name: "system_fsm_architecture.mmd",
    extension: "mmd",
    language: "mermaid",
    summary: "Interactive Mermaid state transition diagram illustrating the turn execution FSM and TDD red-green cycles.",
    userFacing: true,
    createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    content: `stateDiagram-v2
    [*] --> Idle
    Idle --> UserTurnQueued : User Prompt Submit
    UserTurnQueued --> ContextTokenizing : Rig AST Token Counting
    ContextTokenizing --> LLMInference : Stream SSE Request

    state LLMInference {
        [*] --> ReasoningStream
        ReasoningStream --> ToolCallDecision : Grammar Match
        ReasoningStream --> DirectOutput : Code Solution
    }

    ToolCallDecision --> NativeToolExec : Sandboxed Task
    ToolCallDecision --> McpBridgeExec : MCP Sidecar Protocol

    NativeToolExec --> RedGreenTddGate : Verify Test
    McpBridgeExec --> RedGreenTddGate : Verify Test

    state RedGreenTddGate {
        [*] --> RedFailedTest : Prove Bug
        RedFailedTest --> GreenPassedTest : Minimal Fix
    }

    RedGreenTddGate --> DoneTurn : Verification OK
    DirectOutput --> DoneTurn : Response Streamed
    DoneTurn --> Idle : Ready for Input`,
  },
  {
    id: "art-mermaid-2",
    name: "turn_sequence_flow.mmd",
    extension: "mmd",
    language: "mermaid",
    summary: "Mermaid sequence flow diagram illustrating client-to-engine IPC pipes and MCP tool dispatch.",
    userFacing: true,
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    content: `sequenceDiagram
    autonumber
    actor User as User / Developer
    participant UI as React LotA UI
    participant FSM as Rust Tokio Engine
    participant LLM as Claude-3.7-Sonnet
    participant MCP as MCP Sidecar Daemon

    User->>UI: Types Prompt / Attaches Files
    UI->>FSM: JSON-RPC over Socket (Turn Request)
    FSM->>LLM: Stream Preamble + Active Rules + Context
    LLM-->>FSM: Stream SSE Reasoning Chunks
    FSM-->>UI: Live Stream to Workbench Feed
    LLM->>FSM: Tool Call Request (create_pull_request)
    FSM->>MCP: Dispatch JSON Schema
    MCP-->>FSM: Tool Output Success
    FSM->>LLM: Append Tool Result to Turns
    LLM-->>FSM: Final Markdown Summary
    FSM-->>UI: Turn Complete Signal (Done)`,
  },
  {
    id: "art-drawio",
    name: "cloud_infrastructure.drawio",
    extension: "drawio",
    language: "xml",
    summary: "Draw.io vector architecture model defining Kubernetes clusters, Redis turn queues, and Tokio microservices.",
    userFacing: true,
    createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    content: `<mxfile host="Electron" modified="2026-09-02T16:00:00.000Z" agent="Rho-Lota/1.0" version="24.1.0">
  <diagram id="rho-topology" name="System Infrastructure">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="850">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="client" value="React LotA Frontend&#xa;(Vite / Tailwind / Zustand)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#1f6feb;strokeColor=#58a6ff;fontColor=#ffffff;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="100" y="200" width="180" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="engine" value="Rust rho-engine&#xa;(Tokio / Rig Core / FSM)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#8957e5;strokeColor=#d2a8ff;fontColor=#ffffff;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="450" y="200" width="200" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="mcp" value="MCP Cluster&#xa;(GitHub, Context-Mode)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#238636;strokeColor=#3fb950;fontColor=#ffffff;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="800" y="200" width="180" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="edge1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#58a6ff;strokeWidth=3;" edge="1" parent="1" source="client" target="engine">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge2" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#d2a8ff;strokeWidth=3;" edge="1" parent="1" source="engine" target="mcp">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`,
  },
  {
    id: "art-slides",
    name: "q3_product_deck.deck",
    extension: "deck",
    language: "markdown",
    summary: "5-slide interactive presentation deck covering product architecture, performance benchmarks, and delivery roadmap.",
    userFacing: true,
    createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    content: `# Rho Lota Studio 2.0
### Autonomous Multi-Agent Engineering Environment

Powered by Rust \`rho-engine\` & Rig Core

> [!NOTE]
> High-performance developer cockpit with desktop MarkView, live diagrams, and interactive HTML sandboxes.

---

# The Problem & Bottlenecks

### Traditional AI Assistant Limitations
- **Context Bleed**: Bloated conversational histories cause memory compaction crashes.
- **Manual Verification**: Inline hallucinations ship unverified code regressions.
- **Fragmented Tooling**: Disjointed terminals, external browsers, and diagram viewers.

---

# Architecture & Engine Design

\`\`\`rust
// High-throughput Tokio event loop with zero-copy stream buffers
pub struct AsyncEventLoop {
    tx: Sender<StreamChunk>,
    rx: Option<Receiver<StreamChunk>>,
}
\`\`\`

- **Zero-Latency SSE**: Direct Unix domain socket pipe from Rust core to React front-end.
- **Strict Red-First TDD**: Autonomous implementer must prove red failures before green code edits.

---

# Performance Benchmarks

| Metric | Rho Lota v2 | Traditional CLI | Improvement |
| :--- | :---: | :---: | :---: |
| **Startup Token Overhead** | \`3,800 tok\` | 18,500 tok | **79% reduction** |
| **Streaming Latency** | \`18.4 ms\` | 110.0 ms | **6x faster** |
| **Test Feedback** | \`cargo nextest\` | Sequential | **4.2x speedup** |

---

# Q3 Engineering Roadmap

- [x] **Universal AI Agent Configuration Template** (7-Part schema)
- [x] **MarkView Desktop Engine** with Rust syntax & GitHub alerts
- [x] **Interactive Diagrams & Slide Deck Presentations** (Mermaid / Draw.io)
- [ ] **Daemon Plugin SDK hot-reloading** over shared memory IPC

> [!TIP]
> Press \`ArrowRight\` (→) or \`ArrowLeft\` (←) on your keyboard to navigate between slides!`,
  },
  {
    id: "art-rust",
    name: "rust_async_engine.md",
    extension: "md",
    language: "markdown",
    summary: "Rust asynchronous Tokio event bus, zero-copy buffer pipeline, and GitHub alerts specification.",
    userFacing: true,
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    content: `# High-Performance Rust Asynchronous Pipeline

A high-throughput Tokio event loop and state machine architecture powering Rho Lota.

> [!NOTE]
> All HTTP client builders reuse static \`LazyLock\` instances with \`.no_proxy()\` to prevent macOS \`SCDynamicStoreCopyProxies\` lockups in parallel tests.

## 1. Rust Tokio Channel Handler

\`\`\`rust
use std::sync::Arc;
use tokio::sync::mpsc::{channel, Receiver, Sender};
use tokio::task::JoinHandle;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StreamChunk {
    pub turn_id: String,
    pub delta: String,
    pub tokens_used: usize,
}

pub struct AsyncEventLoop {
    tx: Sender<StreamChunk>,
    rx: Option<Receiver<StreamChunk>>,
}

impl AsyncEventLoop {
    pub fn new(capacity: usize) -> Self {
        let (tx, rx) = channel(capacity);
        Self { tx, rx: Some(rx) }
    }

    pub async fn dispatch(&self, chunk: StreamChunk) -> Result<(), String> {
        self.tx.send(chunk).await.map_err(|e| e.to_string())
    }
}
\`\`\`

> [!TIP]
> Use \`cargo nextest run\` for parallel test execution feedback during rapid inner-loop iterations.

## 2. Performance Comparison Matrix

| Layer | Engine | Latency (p99) | Throughput | Zero-Copy |
| :--- | :--- | :---: | :---: | :---: |
| **Transport** | Unix Socket IPC | \`0.42 ms\` | 185k msg/s | ✅ Enabled |
| **Parser** | \`simd-json\` | \`0.18 ms\` | 420 MB/s | ✅ Enabled |
| **Token Counter** | \`tiktoken-rs\` | \`0.09 ms\` | 1.2M tok/s | ✅ LazyLock |

## 3. Mathematical Formula for Turn Costs

The context window compaction threshold is governed by KaTeX formula:

$$C_{\text{turn}} = \sum_{i=1}^{N} \left( T_{\text{input}}^{(i)} \cdot R_{\text{in}} + T_{\text{output}}^{(i)} \cdot R_{\text{out}} \right)$$

> [!IMPORTANT]
> Files must strictly adhere to the ~150 lines target to ensure modular separation of concerns.

## 4. Execution Checklist
- [x] Integrate \`MarkviewRenderer\` with Shiki dual-theme Rust syntax highlighting
- [x] Parse GitHub alert callouts (\`[!NOTE]\`, \`[!TIP]\`, \`[!IMPORTANT]\`, \`[!WARNING]\`, \`[!CAUTION]\`)
- [x] Support full-width reading toggle and interactive outline TOC drawer
- [ ] Connect live native \`cargo test\` runner daemon`,
  },
  {
    id: "art-1",
    name: "interactive_dashboard.html",
    extension: "html",
    language: "html",
    summary: "Live interactive telemetry dashboard with responsive gauges, metrics cards, and dark theme CSS.",
    userFacing: true,
    createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rho Lota Runtime Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0d1117; color: #c9d1d9; font-family: ui-sans-serif, system-ui, sans-serif; }
  </style>
</head>
<body class="p-6">
  <div class="max-w-4xl mx-auto space-y-6">
    <header class="flex items-center justify-between border-b border-[#30363d] pb-4">
      <div>
        <h1 class="text-xl font-bold text-white flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
          Rho Lota System Telemetry
        </h1>
        <p class="text-xs text-gray-400 mt-0.5">Session: ses_f8e29a • Active Engine: Claude-3.7-Sonnet</p>
      </div>
      <div class="px-3 py-1 bg-[#161b22] border border-[#30363d] rounded-lg text-xs font-mono text-blue-400">
        Status: ONLINE
      </div>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-[#161b22] border border-[#30363d] p-4 rounded-xl">
        <div class="text-xs text-gray-400">Context Window Used</div>
        <div class="text-2xl font-bold text-white font-mono mt-1">14,250 <span class="text-xs text-gray-500 font-sans">/ 200k</span></div>
        <div class="w-full bg-[#0d1117] h-2 rounded-full mt-3 overflow-hidden border border-[#30363d]">
          <div class="bg-blue-500 h-full" style="width: 7.1%"></div>
        </div>
      </div>

      <div class="bg-[#161b22] border border-[#30363d] p-4 rounded-xl">
        <div class="text-xs text-gray-400">FSM Streaming Latency</div>
        <div class="text-2xl font-bold text-emerald-400 font-mono mt-1">18.4 <span class="text-xs text-gray-500 font-sans">ms / tok</span></div>
        <div class="text-[11px] text-emerald-500/90 mt-2 font-medium">99.8% cache hit rate</div>
      </div>

      <div class="bg-[#161b22] border border-[#30363d] p-4 rounded-xl">
        <div class="text-xs text-gray-400">Estimated Turn Cost</div>
        <div class="text-2xl font-bold text-yellow-400 font-mono mt-1">$0.0428</div>
        <div class="text-[11px] text-gray-400 mt-2">Rate card: $3.00/1M input</div>
      </div>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: "art-3",
    name: "system_architecture.svg",
    extension: "svg",
    language: "xml",
    summary: "Vector diagram visualizing client-side React LotA bridge with Rust Rho-Engine core over IPC sockets.",
    userFacing: true,
    createdAt: new Date(Date.now() - 3600000 * 8).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="100%" height="100%">
  <rect width="100%" height="100%" fill="#0d1117" />
  <rect x="40" y="40" width="220" height="320" rx="16" fill="#161b22" stroke="#30363d" stroke-width="2" />
  <text x="60" y="80" fill="#58a6ff" font-family="sans-serif" font-weight="bold" font-size="18">React LotA UI</text>
  <text x="60" y="110" fill="#8b949e" font-family="sans-serif" font-size="12">Vite • Tailwind • Zustand</text>
  
  <rect x="70" y="140" width="160" height="50" rx="8" fill="#21262d" stroke="#58a6ff" />
  <text x="90" y="170" fill="#fff" font-family="sans-serif" font-size="13">Chat & Artifacts</text>

  <rect x="70" y="210" width="160" height="50" rx="8" fill="#21262d" stroke="#30363d" />
  <text x="90" y="240" fill="#fff" font-family="sans-serif" font-size="13">Streaming FSM</text>

  <line x1="260" y1="200" x2="500" y2="200" stroke="#007acc" stroke-width="4" stroke-dasharray="6,6" />
  <text x="320" y="185" fill="#007acc" font-family="monospace" font-size="13" font-weight="bold">JSON-RPC / SSE Pipe</text>

  <rect x="500" y="40" width="260" height="320" rx="16" fill="#161b22" stroke="#8957e5" stroke-width="2" />
  <text x="530" y="80" fill="#d2a8ff" font-family="sans-serif" font-weight="bold" font-size="18">Rust rho-engine</text>
  <text x="530" y="110" fill="#8b949e" font-family="sans-serif" font-size="12">Tokio • Rig Core • MCP Bridge</text>

  <rect x="530" y="140" width="200" height="50" rx="8" fill="#21262d" stroke="#8957e5" />
  <text x="550" y="170" fill="#fff" font-family="sans-serif" font-size="13">Tool Executor / Native</text>

  <rect x="530" y="210" width="200" height="50" rx="8" fill="#21262d" stroke="#30363d" />
  <text x="550" y="240" fill="#fff" font-family="sans-serif" font-size="13">Context Compactor</text>
</svg>`,
  },
  {
    id: "art-4",
    name: "theme_presets.json",
    extension: "json",
    language: "json",
    summary: "JSON schema defining active theme color palettes, background tokens, and accent configurations.",
    userFacing: false,
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    content: `{
  "themeVersion": "2.0.0",
  "activePreset": "Default Dark",
  "presets": [
    {
      "id": "default-light",
      "name": "Default Light",
      "background": "#F9F9F9",
      "foreground": "#101010",
      "accent": "#007acc"
    },
    {
      "id": "default-dark",
      "name": "Default Dark",
      "background": "#101010",
      "foreground": "#cccccc",
      "accent": "#007acc"
    }
  ]
}`,
  },
  {
    id: "art-5",
    name: "schema_migrations.sql",
    extension: "sql",
    language: "sql",
    summary: "Relational database schema migration script for persistent session DAG graph nodes and execution turns.",
    userFacing: false,
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    content: `-- Rho Lota Session DAG Persistence Schema
CREATE TABLE IF NOT EXISTS session_nodes (
    id VARCHAR(64) PRIMARY KEY,
    parent_id VARCHAR(64) REFERENCES session_nodes(id) ON DELETE SET NULL,
    session_title VARCHAR(255) NOT NULL,
    active_persona_id VARCHAR(64) NOT NULL,
    total_tokens_used INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);`,
  },
];

interface ArtifactState {
  artifacts: ArtifactItem[];
  selectedArtifactId: string | null;
  addArtifact: (artifact: Omit<ArtifactItem, "id" | "createdAt" | "updatedAt">) => void;
  updateArtifact: (id: string, content: string, name?: string) => void;
  addRevision: (id: string, newContent: string, prompt: string) => void;
  restoreVersion: (id: string, versionNumber: number) => void;
  finalizeArtifact: (id: string) => void;
  deleteArtifact: (id: string) => void;
  setSelectedArtifactId: (id: string | null) => void;
}

const STORAGE_KEY = "rho_lota_artifacts_v4";

const loadInitialArtifacts = (): ArtifactItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: ArtifactItem[] = JSON.parse(raw);
      return parsed.map((a) => ({
        ...a,
        versions:
          a.versions && a.versions.length > 0
            ? a.versions
            : [
                {
                  version: 1,
                  content: a.content,
                  prompt: "Initial generation",
                  timestamp: a.createdAt,
                  commitHash: `git_${a.id.slice(-6)}_v1`,
                },
              ],
        currentVersion: a.currentVersion || (a.versions?.length || 1),
      }));
    }
  } catch (err) {
    console.error("Failed to load artifacts from localStorage", err);
  }
  return DEFAULT_ARTIFACTS.map((a) => ({
    ...a,
    versions: [
      {
        version: 1,
        content: a.content,
        prompt: "Initial generation",
        timestamp: a.createdAt,
        commitHash: `git_${a.id.slice(-6)}_v1`,
      },
    ],
    currentVersion: 1,
    finalized: true,
  }));
};

export const useArtifactStore = create<ArtifactState>((set) => ({
  artifacts: loadInitialArtifacts(),
  selectedArtifactId: null,

  addArtifact: (item) =>
    set((state) => {
      const now = new Date().toISOString();
      const id = `art-${Date.now()}`;
      const newArt: ArtifactItem = {
        ...item,
        id,
        createdAt: now,
        updatedAt: now,
        versions: [
          {
            version: 1,
            content: item.content,
            prompt: "Initial generation",
            timestamp: now,
            commitHash: `git_${id.slice(-6)}_v1`,
          },
        ],
        currentVersion: 1,
        finalized: false,
      };
      const updated = [newArt, ...state.artifacts];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to persist artifacts", err);
      }
      return { artifacts: updated };
    }),

  updateArtifact: (id, content, name) =>
    set((state) => {
      const updated = state.artifacts.map((a) => {
        if (a.id === id) {
          const extension = name ? name.split(".").pop() || a.extension : a.extension;
          return {
            ...a,
            content,
            name: name || a.name,
            extension,
            updatedAt: new Date().toISOString(),
          };
        }
        return a;
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to persist artifacts", err);
      }
      return { artifacts: updated };
    }),

  addRevision: (id, newContent, prompt) =>
    set((state) => {
      const updated = state.artifacts.map((a) => {
        if (a.id === id) {
          const baseVersions =
            a.versions && a.versions.length > 0
              ? a.versions
              : [
                  {
                    version: 1,
                    content: a.content,
                    prompt: "Initial generation",
                    timestamp: a.createdAt,
                    commitHash: `git_${a.id.slice(-6)}_v1`,
                  },
                ];
          const nextVer = baseVersions.length + 1;
          const randomHash = Math.random().toString(36).substring(2, 9);
          const newVersion: ArtifactVersion = {
            version: nextVer,
            content: newContent,
            prompt: prompt || `Revision ${nextVer}`,
            timestamp: new Date().toISOString(),
            commitHash: `git_${randomHash}`,
          };
          return {
            ...a,
            content: newContent,
            versions: [...baseVersions, newVersion],
            currentVersion: nextVer,
            updatedAt: new Date().toISOString(),
            finalized: false,
          };
        }
        return a;
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to persist artifacts", err);
      }
      return { artifacts: updated };
    }),

  restoreVersion: (id, versionNumber) =>
    set((state) => {
      const updated = state.artifacts.map((a) => {
        if (a.id === id && a.versions) {
          const target = a.versions.find((v) => v.version === versionNumber);
          if (target) {
            return {
              ...a,
              content: target.content,
              currentVersion: target.version,
              updatedAt: new Date().toISOString(),
            };
          }
        }
        return a;
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to persist artifacts", err);
      }
      return { artifacts: updated };
    }),

  finalizeArtifact: (id) =>
    set((state) => {
      const updated = state.artifacts.map((a) => {
        if (a.id === id) {
          return {
            ...a,
            finalized: true,
            updatedAt: new Date().toISOString(),
          };
        }
        return a;
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to persist artifacts", err);
      }
      return { artifacts: updated };
    }),

  deleteArtifact: (id) =>
    set((state) => {
      const updated = state.artifacts.filter((a) => a.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to persist artifacts", err);
      }
      return {
        artifacts: updated,
        selectedArtifactId: state.selectedArtifactId === id ? null : state.selectedArtifactId,
      };
    }),

  setSelectedArtifactId: (id) => set({ selectedArtifactId: id }),
}));
