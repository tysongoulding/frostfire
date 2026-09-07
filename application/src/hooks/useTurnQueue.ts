import { create } from "zustand";

interface QueueState {
  queue: string[];
  enqueue: (prompt: string) => void;
  dequeue: () => string | undefined;
  removeAt: (index: number) => void;
  clear: () => void;
}

export const useTurnQueue = create<QueueState>((set, get) => ({
  queue: [],

  enqueue: (prompt: string) =>
    set((state) => ({ queue: [...state.queue, prompt] })),

  dequeue: () => {
    const current = get().queue;
    if (current.length === 0) return undefined;
    const [first, ...rest] = current;
    set({ queue: rest });
    return first;
  },

  removeAt: (index: number) =>
    set((state) => ({
      queue: state.queue.filter((_, i) => i !== index),
    })),

  clear: () => set({ queue: [] }),
}));
