import { create } from "zustand";

export interface FileNode {
  path: string;
  name: string;
  isDir: boolean;
  children?: FileNode[];
  size?: number;
}

export type GitProvider = "github" | "gitlab" | "bitbucket" | "git";

export interface WorkspaceEntryPayload {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  children?: WorkspaceEntryPayload[];
}

function mapPayloadToNode(entry: WorkspaceEntryPayload): FileNode {
  return {
    name: entry.name,
    path: entry.path,
    isDir: entry.is_dir,
    size: entry.size,
    children: entry.children ? entry.children.map(mapPayloadToNode) : undefined,
  };
}

interface WorkspaceState {
  workspacePath: string;
  repoName: string;
  gitBranch: string;
  worktree: string;
  remoteUrl: string;
  remoteProvider: GitProvider;
  files: FileNode[];
  selectedFile: { path: string; content?: string } | null;
  attachedFiles: string[];
  maxContextTokens: number;
  isLoadingFiles: boolean;

  setWorkspacePath: (path: string) => void;
  setRepoName: (repo: string) => void;
  setGitBranch: (branch: string) => void;
  setWorktree: (worktree: string) => void;
  setRemoteUrl: (url: string) => void;
  setRemoteProvider: (provider: GitProvider) => void;
  setFiles: (files: FileNode[]) => void;
  selectFile: (file: { path: string; content?: string } | null) => void;
  attachFile: (path: string) => void;
  addAttachedFile: (path: string) => void;
  removeAttachedFile: (path: string) => void;
  clearAttachedFiles: () => void;
  fetchWorkspaceFiles: (path?: string) => Promise<void>;
  loadFileContent: (filePath: string) => Promise<string>;
}

const DEFAULT_MOCK_FILES: FileNode[] = [
  {
    path: "src",
    name: "src",
    isDir: true,
    children: [
      { path: "src/main.rs", name: "main.rs", isDir: false, size: 2450 },
      { path: "src/lib.rs", name: "lib.rs", isDir: false, size: 1890 },
      {
        path: "src/cli",
        name: "cli",
        isDir: true,
        children: [
          { path: "src/cli/mod.rs", name: "mod.rs", isDir: false, size: 3120 },
          { path: "src/cli/rpc.rs", name: "rpc.rs", isDir: false, size: 5400 },
        ],
      },
    ],
  },
  {
    path: "crates",
    name: "crates",
    isDir: true,
    children: [
      {
        path: "crates/rho-engine",
        name: "rho-engine",
        isDir: true,
        children: [
          { path: "crates/rho-engine/Cargo.toml", name: "Cargo.toml", isDir: false, size: 1200 },
          { path: "crates/rho-engine/src/lib.rs", name: "lib.rs", isDir: false, size: 3400 },
        ],
      },
      {
        path: "crates/rho-harness-core",
        name: "rho-harness-core",
        isDir: true,
        children: [
          { path: "crates/rho-harness-core/Cargo.toml", name: "Cargo.toml", isDir: false, size: 980 },
          { path: "crates/rho-harness-core/src/lib.rs", name: "lib.rs", isDir: false, size: 2100 },
        ],
      },
      {
        path: "crates/rho-plugin-sdk",
        name: "rho-plugin-sdk",
        isDir: true,
        children: [
          { path: "crates/rho-plugin-sdk/Cargo.toml", name: "Cargo.toml", isDir: false, size: 850 },
          { path: "crates/rho-plugin-sdk/src/lib.rs", name: "lib.rs", isDir: false, size: 1400 },
        ],
      },
    ],
  },
  {
    path: "lota",
    name: "lota",
    isDir: true,
    children: [
      { path: "lota/package.json", name: "package.json", isDir: false, size: 1100 },
      { path: "lota/src/App.tsx", name: "App.tsx", isDir: false, size: 2800 },
      { path: "lota/README.md", name: "README.md", isDir: false, size: 3200 },
    ],
  },
];

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspacePath: "c:\\Users\\tyson\\.repo\\personal\\rho",
  repoName: "rho",
  gitBranch: "feature/wire-up",
  worktree: "main",
  remoteUrl: "https://github.com/tysongoulding/rho-lota",
  remoteProvider: "github",
  files: DEFAULT_MOCK_FILES,
  selectedFile: null,
  attachedFiles: [],
  maxContextTokens: 128000,
  isLoadingFiles: false,

  setWorkspacePath: (path: string) => set({ workspacePath: path }),
  setRepoName: (repo: string) => set({ repoName: repo }),
  setGitBranch: (branch: string) => set({ gitBranch: branch }),
  setWorktree: (worktree: string) => set({ worktree }),
  setRemoteUrl: (url: string) => set({ remoteUrl: url }),
  setRemoteProvider: (provider: GitProvider) => set({ remoteProvider: provider }),
  setFiles: (files: FileNode[]) => set({ files }),
  selectFile: (file: { path: string; content?: string } | null) => set({ selectedFile: file }),

  attachFile: (path: string) =>
    set((state) => ({
      attachedFiles: state.attachedFiles.includes(path)
        ? state.attachedFiles
        : [...state.attachedFiles, path],
    })),

  addAttachedFile: (path: string) =>
    set((state) => ({
      attachedFiles: state.attachedFiles.includes(path)
        ? state.attachedFiles
        : [...state.attachedFiles, path],
    })),

  removeAttachedFile: (path: string) =>
    set((state) => ({
      attachedFiles: state.attachedFiles.filter((p) => p !== path),
    })),

  clearAttachedFiles: () => set({ attachedFiles: [] }),

  fetchWorkspaceFiles: async (targetPath?: string) => {
    const basePath = targetPath || get().workspacePath;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      set({ isLoadingFiles: true });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const rawEntries = await invoke<WorkspaceEntryPayload[]>("list_workspace_entries", {
          basePath,
        });
        const mapped = rawEntries.map(mapPayloadToNode);
        set({ files: mapped, isLoadingFiles: false });
      } catch (err) {
        console.warn("Failed to fetch workspace files via Tauri, keeping mock fallback:", err);
        set({ isLoadingFiles: false });
      }
    }
  },

  loadFileContent: async (filePath: string): Promise<string> => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const content = await invoke<string>("read_workspace_file", { filePath });
        set({ selectedFile: { path: filePath, content } });
        return content;
      } catch (err) {
        console.warn("Failed to read file content via Tauri:", err);
      }
    }

    const fallback = `// Preview of ${filePath}\n// Loaded from workspace memory buffer.`;
    set({ selectedFile: { path: filePath, content: fallback } });
    return fallback;
  },
}));
