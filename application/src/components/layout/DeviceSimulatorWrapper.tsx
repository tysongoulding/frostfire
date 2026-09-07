import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { minimizeWindow, toggleMaximizeWindow, closeWindow } from '../../lib/windowControls';

interface DeviceSimulatorWrapperProps {
  children: React.ReactNode;
}

export const DeviceSimulatorWrapper: React.FC<DeviceSimulatorWrapperProps> = ({ children }) => {
  const { devicePreview, setDevicePreview } = useTheme();

  // Phone modes: phone-android, phone-ios, or fallback phone
  if (devicePreview.startsWith('phone')) {
    const isIos = devicePreview === 'phone-ios' || devicePreview === 'phone';
    const deviceTitle = isIos ? 'Phone — iOS (iPhone 375 × 740)' : 'Phone — Android (Pixel 375 × 740)';

    return (
      <div className="py-6 px-3 flex flex-col items-center justify-center flex-1 min-h-0 w-full max-w-full overflow-y-auto overflow-x-hidden bg-theme-bg/80">
        <div className="flex items-center gap-2 mb-2 text-xs text-theme-text-muted">
          <span>{deviceTitle}</span>
          <button
            onClick={() => setDevicePreview('fluid')}
            className="underline text-theme-accent-primary hover:opacity-80 font-medium cursor-pointer"
          >
            Exit to Fluid
          </button>
        </div>

        <div className="relative w-[375px] max-w-full h-[740px] max-h-[92vh] bg-theme-surface border-[8px] border-theme-border rounded-[40px] shadow-2xl overflow-hidden flex flex-col ring-1 ring-black/20">
          {/* Top Notch / Dynamic Island or Punch Hole */}
          {isIos ? (
            <div className="w-28 h-5 bg-theme-border self-center rounded-b-xl shrink-0 z-20" />
          ) : (
            <div className="w-3.5 h-3.5 bg-theme-border self-center rounded-full mt-1.5 shrink-0 z-20" />
          )}

          {/* Screen */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {children}
          </div>

          {/* Bottom Home / Navigation Indicator */}
          <div className="py-1 bg-theme-surface shrink-0 flex justify-center">
            {isIos ? (
              <div className="w-32 h-1 bg-theme-text-muted/40 rounded-full" />
            ) : (
              <div className="w-20 h-1 bg-theme-text-muted/40 rounded-full" />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Tablet modes: tablet-android, tablet-ios, or fallback tablet
  if (devicePreview.startsWith('tablet')) {
    const isIos = devicePreview === 'tablet-ios' || devicePreview === 'tablet';
    const deviceTitle = isIos ? 'Tablet — iOS (iPad 768 × 960)' : 'Tablet — Android (Galaxy Tab 768 × 960)';

    return (
      <div className="py-6 px-3 flex flex-col items-center justify-center flex-1 min-h-0 w-full max-w-full overflow-y-auto overflow-x-hidden bg-theme-bg/80">
        <div className="flex items-center gap-2 mb-2 text-xs text-theme-text-muted">
          <span>{deviceTitle}</span>
          <button
            onClick={() => setDevicePreview('fluid')}
            className="underline text-theme-accent-primary hover:opacity-80 font-medium cursor-pointer"
          >
            Exit to Fluid
          </button>
        </div>

        <div className="relative w-[768px] max-w-full h-[960px] max-h-[88vh] bg-theme-surface border-[10px] border-theme-border rounded-[28px] shadow-2xl overflow-hidden flex flex-col ring-1 ring-black/20">
          {/* Tablet Camera Dot */}
          <div className="w-2.5 h-2.5 bg-theme-border self-center rounded-full my-1 shrink-0 z-20" />

          {/* Screen */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {children}
          </div>

          {/* Bottom Home Indicator */}
          <div className="py-1 bg-theme-surface shrink-0 flex justify-center">
            <div className={`h-1 bg-theme-text-muted/40 rounded-full ${isIos ? 'w-36' : 'w-24'}`} />
          </div>
        </div>
      </div>
    );
  }

  // Desktop modes: desktop-windows, desktop-linux, desktop-mac, or fallback desktop
  if (devicePreview.startsWith('desktop')) {
    const isWindows = devicePreview === 'desktop-windows';
    const isMac = devicePreview === 'desktop-mac';
    const isLinux = devicePreview === 'desktop-linux';
    const osTitle = isWindows
      ? 'Desktop — Windows (1280 × 800 frame)'
      : isMac
      ? 'Desktop — Mac (1280 × 800 frame)'
      : isLinux
      ? 'Desktop — Linux (1280 × 800 frame)'
      : 'Desktop Viewport (1280 × 800 frame)';

    return (
      <div className="py-6 px-3 flex flex-col items-center justify-center flex-1 min-h-0 w-full overflow-y-auto bg-theme-bg/80">
        <div className="flex items-center gap-2 mb-2 text-xs text-theme-text-muted">
          <span>{osTitle}</span>
          <button
            onClick={() => setDevicePreview('fluid')}
            className="underline text-theme-accent-primary hover:opacity-80 font-medium cursor-pointer"
          >
            Exit to Fluid
          </button>
        </div>

        <div className="w-full max-w-[1280px] h-[800px] bg-theme-surface border border-theme-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
          {/* Mock Window Titlebar styled per OS */}
          {isMac ? (
            <div className="h-7 bg-theme-bg border-b border-theme-border px-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDevicePreview('fluid')}
                  title="Close / Exit to Fluid"
                  className="w-3 h-3 rounded-full bg-[#FF5F56] border border-black/10 hover:opacity-80 cursor-pointer"
                />
                <button
                  onClick={() => minimizeWindow()}
                  title="Minimize"
                  className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-black/10 hover:opacity-80 cursor-pointer"
                />
                <button
                  onClick={() => setDevicePreview('fluid')}
                  title="Maximize to Fluid"
                  className="w-3 h-3 rounded-full bg-[#27C93F] border border-black/10 hover:opacity-80 cursor-pointer"
                />
              </div>
              <span className="text-[11px] text-theme-text-muted font-medium">
                Frostfire OS — macOS
              </span>
              <div className="w-12" />
            </div>
          ) : isWindows ? (
            <div className="h-7 bg-theme-bg border-b border-theme-border pl-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-theme-text-primary font-medium">Frostfire OS</span>
                <span className="text-[10px] text-theme-text-muted">Windows 11</span>
              </div>
              <div className="flex items-center text-theme-text-muted text-xs">
                <button
                  onClick={() => minimizeWindow()}
                  className="px-3 py-1 hover:bg-theme-surface cursor-pointer leading-none"
                  title="Minimize"
                >
                  ─
                </button>
                <button
                  onClick={() => setDevicePreview('fluid')}
                  className="px-3 py-1 hover:bg-theme-surface cursor-pointer leading-none"
                  title="Maximize / Fluid"
                >
                  ▢
                </button>
                <button
                  onClick={() => setDevicePreview('fluid')}
                  className="px-3 py-1 hover:bg-rose-600 hover:text-white cursor-pointer leading-none"
                  title="Close / Exit to Fluid"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : isLinux ? (
            <div className="h-7 bg-theme-bg border-b border-theme-border px-3 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-theme-text-primary font-medium">Frostfire OS (Linux / GNOME)</span>
              <div className="flex items-center gap-1.5 text-theme-text-muted">
                <button
                  onClick={() => minimizeWindow()}
                  className="w-4 h-4 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center text-[9px] cursor-pointer"
                  title="Minimize"
                >
                  −
                </button>
                <button
                  onClick={() => setDevicePreview('fluid')}
                  className="w-4 h-4 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center text-[9px] cursor-pointer"
                  title="Maximize / Fluid"
                >
                  □
                </button>
                <button
                  onClick={() => setDevicePreview('fluid')}
                  className="w-4 h-4 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center text-[9px] hover:bg-rose-500 hover:text-white cursor-pointer"
                  title="Close / Exit to Fluid"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <div className="h-7 bg-theme-bg border-b border-theme-border px-3 flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <span className="text-[10px] text-theme-text-muted font-mono mx-auto">
                Frostfire OS Desktop Window
              </span>
            </div>
          )}

          <div className="flex-1 flex flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    );
  }

  // Fluid mode
  return <div className="w-full flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>;
};
