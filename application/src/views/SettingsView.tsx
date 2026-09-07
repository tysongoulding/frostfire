import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ThemeName, ThemeMode, DevicePreview } from '../types';
import { Sliders, Palette, Sun, Moon, Laptop, Smartphone, Tablet, Monitor } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { theme, mode, effectiveMode, devicePreview, setTheme, setMode, setDevicePreview } = useTheme();
  const { breakpoint, windowWidth } = useBreakpoint();

  const themes: { id: ThemeName; name: string; desc: string; primary: string; secondary: string }[] = [
    {
      id: 'frostfire',
      name: 'Default (Frostfire)',
      desc: 'Neutral grayscale base with balanced Ice Blue & Fire Red accents',
      primary: '#38BDF8',
      secondary: '#FF3366',
    },
    {
      id: 'frost',
      name: 'Frost (Blue Focus)',
      desc: 'Deep oceanic navy slate background with electric cyan primary',
      primary: '#38BDF8',
      secondary: '#EF4444',
    },
    {
      id: 'fire',
      name: 'Fire (Red Focus)',
      desc: 'Dark plum/crimson atmosphere with hot pink-red primary accent',
      primary: '#FF2A5F',
      secondary: '#00D8F6',
    },
  ];

  const previewModes: { id: DevicePreview; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'fluid', label: 'Fluid Window', icon: <Laptop className="w-4 h-4" />, desc: 'Native browser viewport' },
    { id: 'desktop-windows', label: 'Desktop (Windows)', icon: <Monitor className="w-4 h-4" />, desc: 'Windows 11 desktop frame' },
    { id: 'desktop-linux', label: 'Desktop (Linux)', icon: <Monitor className="w-4 h-4" />, desc: 'Linux / GNOME frame' },
    { id: 'desktop-mac', label: 'Desktop (Mac)', icon: <Monitor className="w-4 h-4" />, desc: 'macOS frame with traffic lights' },
    { id: 'tablet-android', label: 'Tablet (Android)', icon: <Tablet className="w-4 h-4" />, desc: 'Android tablet frame' },
    { id: 'tablet-ios', label: 'Tablet (iOS)', icon: <Tablet className="w-4 h-4" />, desc: 'iPadOS tablet frame' },
    { id: 'phone-android', label: 'Phone (Android)', icon: <Smartphone className="w-4 h-4" />, desc: 'Android punch-hole frame' },
    { id: 'phone-ios', label: 'Phone (iOS)', icon: <Smartphone className="w-4 h-4" />, desc: 'iPhone with Dynamic Island' },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 p-4 sm:p-6 overflow-y-auto">
      {/* Brand Theme Selection */}
      <section className="rounded-xl border border-theme-border bg-theme-surface p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-theme-accent-primary" />
          <div>
            <h3 className="text-lg font-bold text-theme-text-primary">Theme Palette Engine</h3>
            <p className="text-xs sm:text-sm text-theme-text-muted">Choose your brand pairing and accent hierarchy</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`p-4 rounded-lg border text-left transition-all cursor-pointer ${
                theme === t.id
                  ? 'border-theme-accent-primary bg-theme-bg shadow-sm ring-1 ring-theme-accent-primary'
                  : 'border-theme-border bg-theme-bg/40 hover:border-theme-border/80'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-theme-text-primary">{t.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ backgroundColor: t.primary }} />
                  <span className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ backgroundColor: t.secondary }} />
                </div>
              </div>
              <p className="text-xs text-theme-text-muted leading-relaxed">{t.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Light / Dark / System Mode */}
      <section className="rounded-xl border border-theme-border bg-theme-surface p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-theme-accent-primary" />
          <div>
            <h3 className="text-lg font-bold text-theme-text-primary">Appearance Mode</h3>
            <p className="text-xs sm:text-sm text-theme-text-muted">Active mode: {effectiveMode}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {(['dark', 'light', 'system'] as ThemeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2 border cursor-pointer ${
                mode === m
                  ? 'bg-theme-accent-primary text-black border-theme-accent-primary shadow-sm'
                  : 'bg-theme-bg border-theme-border text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {m === 'dark' && <Moon className="w-3.5 h-3.5" />}
              {m === 'light' && <Sun className="w-3.5 h-3.5" />}
              {m === 'system' && <Laptop className="w-3.5 h-3.5" />}
              {m}
            </button>
          ))}
        </div>
      </section>

      {/* Device Viewport Preview Simulator */}
      <section className="rounded-xl border border-theme-border bg-theme-surface p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-theme-accent-primary" />
            <div>
              <h3 className="text-lg font-bold text-theme-text-primary">Device Form Factor Simulator</h3>
              <p className="text-xs sm:text-sm text-theme-text-muted">
                Emulate Desktop, Webapp, Tablet, and Phone front ends directly in this window
              </p>
            </div>
          </div>
          <span className="text-xs font-mono px-2 py-1 rounded bg-theme-bg border border-theme-border text-theme-accent-primary">
            {breakpoint.toUpperCase()} ({windowWidth}px)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {previewModes.map((item) => (
            <button
              key={item.id}
              onClick={() => setDevicePreview(item.id)}
              className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer ${
                devicePreview === item.id
                  ? 'border-theme-accent-primary bg-theme-bg ring-1 ring-theme-accent-primary'
                  : 'border-theme-border bg-theme-bg/40 hover:border-theme-border/80'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-xs text-theme-text-primary mb-1">
                <span className={devicePreview === item.id ? 'text-theme-accent-primary' : 'text-theme-text-muted'}>
                  {item.icon}
                </span>
                {item.label}
              </div>
              <p className="text-[11px] text-theme-text-muted">{item.desc}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
