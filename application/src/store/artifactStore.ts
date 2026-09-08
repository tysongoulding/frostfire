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

export interface ArtifactState {
  artifacts: ArtifactItem[];
  selectedArtifactId: string | null;
  addArtifact: (item: Omit<ArtifactItem, "id" | "createdAt" | "updatedAt" | "versions" | "currentVersion">) => void;
  updateArtifact: (id: string, content: string, name?: string) => void;
  addRevision: (id: string, newContent: string, prompt?: string) => void;
  restoreVersion: (id: string, versionNumber: number) => void;
  finalizeArtifact: (id: string) => void;
  deleteArtifact: (id: string) => void;
  setSelectedArtifactId: (id: string | null) => void;
}

const STORAGE_KEY = "frostfire_artifacts_v1";

const loadInitialArtifacts = (): ArtifactItem[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: ArtifactItem[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
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
    }
  } catch (err) {
    console.error("Failed to load artifacts from localStorage", err);
  }
  return [];
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
