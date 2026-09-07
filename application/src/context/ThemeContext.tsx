import React, { createContext, useContext, useEffect, useState } from 'react';
import { ThemeName, ThemeMode, DevicePreview } from '../types';
import { useThemeStore, applyThemeToDocument } from '../store/themeStore';

interface ThemeContextValue {
  theme: ThemeName;
  mode: ThemeMode;
  effectiveMode: 'dark' | 'light';
  devicePreview: DevicePreview;
  setTheme: (theme: ThemeName) => void;
  setMode: (mode: ThemeMode) => void;
  setDevicePreview: (device: DevicePreview) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storeMode = useThemeStore((state) => state.mode);
  const storePreset = useThemeStore((state) => state.preset);
  const setStoreMode = useThemeStore((state) => state.setMode);
  const setStorePreset = useThemeStore((state) => state.setPreset);

  const [devicePreview, setDevicePreviewState] = useState<DevicePreview>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('frostfire-device-preview') as DevicePreview) || 'fluid';
    }
    return 'fluid';
  });

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
      applyThemeToDocument();
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Ensure theme is applied on mount and whenever store changes
  useEffect(() => {
    applyThemeToDocument();
  }, [storeMode, storePreset]);

  const setDevicePreview = (device: DevicePreview) => {
    setDevicePreviewState(device);
    if (typeof window !== 'undefined') {
      localStorage.setItem('frostfire-device-preview', device);
    }
  };

  const setTheme = (newTheme: ThemeName) => {
    setStorePreset(newTheme);
  };

  const setMode = (newMode: ThemeMode) => {
    setStoreMode(newMode);
  };

  const effectiveMode: 'dark' | 'light' =
    storeMode === 'system' ? (systemIsDark ? 'dark' : 'light') : storeMode === 'light' ? 'light' : 'dark';

  const theme: ThemeName = (storePreset === 'frost' || storePreset === 'fire') ? storePreset : 'frostfire';

  return (
    <ThemeContext.Provider
      value={{
        theme,
        mode: storeMode,
        effectiveMode,
        devicePreview,
        setTheme,
        setMode,
        setDevicePreview,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
