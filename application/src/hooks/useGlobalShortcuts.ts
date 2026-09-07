import { useEffect } from "react";
import { useUiStore } from "../store/uiStore";

export function useGlobalShortcuts() {
  const {
    toggleCommandPalette,
    setCommandPaletteOpen,
    toggleSidebar,
    toggleWorkbench,
    setNewChatModalOpen,
    setNewAgentModalOpen,
    commandPaletteOpen,
    newChatModalOpen,
    newAgentModalOpen,
  } = useUiStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Ctrl+K -> Command Palette
      if (isCtrlOrCmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Ctrl+B -> Toggle Sidebar
      if (isCtrlOrCmd && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Ctrl+\ -> Toggle Workbench
      if (isCtrlOrCmd && (e.key === "\\" || e.key.toLowerCase() === "j")) {
        e.preventDefault();
        toggleWorkbench();
        return;
      }

      // Ctrl+Shift+N -> New Chat Modal
      if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewChatModalOpen(true);
        return;
      }

      // Escape -> Close any open modal
      if (e.key === "Escape") {
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        if (newChatModalOpen) setNewChatModalOpen(false);
        if (newAgentModalOpen) setNewAgentModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    toggleCommandPalette,
    setCommandPaletteOpen,
    toggleSidebar,
    toggleWorkbench,
    setNewChatModalOpen,
    setNewAgentModalOpen,
    commandPaletteOpen,
    newChatModalOpen,
    newAgentModalOpen,
  ]);
}
