import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function isTauriEnvironment(): boolean {
  try {
    return isTauri();
  } catch {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }
}

export async function minimizeWindow(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke('minimize_window');
      return;
    } catch {
      try {
        const win = getCurrentWindow();
        await win.minimize();
        return;
      } catch (err) {
        console.warn('Failed to minimize Tauri window:', err);
      }
    }
  }
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke('toggle_maximize_window');
      return;
    } catch {
      try {
        const win = getCurrentWindow();
        await win.toggleMaximize();
        return;
      } catch (err) {
        console.warn('Failed to toggle maximize Tauri window:', err);
      }
    }
  } else if (typeof document !== 'undefined') {
    // Browser fallback: toggle fullscreen
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen toggle not permitted:', err);
    }
  }
}

export async function closeWindow(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke('close_window');
      return;
    } catch {
      try {
        const win = getCurrentWindow();
        await win.close();
        return;
      } catch (err) {
        console.warn('Failed to close Tauri window:', err);
      }
    }
  } else if (typeof window !== 'undefined') {
    try {
      window.close();
    } catch {}
  }
}

export async function startDragWindow(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke('start_drag_window');
      return;
    } catch {
      try {
        const win = getCurrentWindow();
        await win.startDragging();
      } catch (err) {
        console.warn('Failed to initiate Tauri window drag:', err);
      }
    }
  }
}
