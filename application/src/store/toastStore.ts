import { create } from "zustand";

export interface ToastItem {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
}

export type ToastParam =
  | string
  | {
      title?: string;
      message?: string;
      description?: string;
      type?: ToastItem["type"];
    };

interface ToastState {
  toasts: ToastItem[];
  addToast: (param: ToastParam, type?: ToastItem["type"]) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (param, type = "info") => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    let finalMessage = "";
    let finalTitle: string | undefined = undefined;
    let finalType: ToastItem["type"] = type;

    if (typeof param === "string") {
      finalMessage = param;
    } else if (param && typeof param === "object") {
      finalTitle = param.title;
      finalMessage = param.message || param.description || param.title || "Notification";
      if (param.type) finalType = param.type;
    } else {
      finalMessage = String(param);
    }

    set((state) => ({
      toasts: [...state.toasts, { id, type: finalType, title: finalTitle, message: finalMessage }],
    }));

    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 3500);
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
