import { create } from "zustand";
import { MessageItem } from "./sessionStore";

export interface ChatItem {
  id: string;
  title: string;
  createdAt: number;
  agentId?: string;
  folder?: string;
  repoUrl?: string;
  messages: MessageItem[];
}

interface ChatState {
  activeChatId: string;
  chats: ChatItem[];
  createChat: (title: string, agentId?: string, folder?: string, repoUrl?: string) => string;
  switchChat: (id: string) => void;
  deleteChat: (id: string) => void;
  updateChatMessages: (id: string, messages: MessageItem[]) => void;
}

const STORAGE_KEY = "frostfire-chats";
const LEGACY_STORAGE_KEY = "rho-lota-chats";

function createDefaultChats(): ChatItem[] {
  return [
    {
      id: "chat-main",
      title: "New Conversation",
      createdAt: Date.now(),
      agentId: "coder",
      messages: [],
    },
  ];
}

function loadChats(): ChatItem[] {
  if (typeof window === "undefined") return createDefaultChats();
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return createDefaultChats();
}

export const useChatStore = create<ChatState>((set) => ({
  activeChatId: loadChats()[0]?.id || "chat-welcome",
  chats: loadChats(),

  createChat: (title: string, agentId?: string, folder?: string, repoUrl?: string) => {
    const id = `chat-${Date.now()}`;
    const newChat: ChatItem = {
      id,
      title: title || `Chat - ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      createdAt: Date.now(),
      agentId: agentId || "coder",
      folder,
      repoUrl,
      messages: [],
    };

    set((state) => {
      const updated = [newChat, ...state.chats];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { chats: updated, activeChatId: id };
    });

    return id;
  },

  switchChat: (id: string) => {
    set({ activeChatId: id });
  },

  deleteChat: (id: string) => {
    set((state) => {
      const updated = state.chats.filter((c) => c.id !== id);
      const nextActiveId = updated[0]?.id || "";
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { chats: updated, activeChatId: state.activeChatId === id ? nextActiveId : state.activeChatId };
    });
  },

  updateChatMessages: (id: string, messages: MessageItem[]) => {
    set((state) => {
      const updated = state.chats.map((c) => (c.id === id ? { ...c, messages } : c));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return { chats: updated };
    });
  },
}));
