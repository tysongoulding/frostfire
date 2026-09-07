import { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export interface BreakpointInfo {
  breakpoint: Breakpoint;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  windowWidth: number;
}

export function useBreakpoint(): BreakpointInfo {
  const { devicePreview } = useTheme();
  const [windowWidth, setWindowWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth;
    }
    return 1200;
  });

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  let effectiveBreakpoint: Breakpoint;

  if (devicePreview.startsWith('phone')) {
    effectiveBreakpoint = 'phone';
  } else if (devicePreview.startsWith('tablet')) {
    effectiveBreakpoint = 'tablet';
  } else if (devicePreview.startsWith('desktop')) {
    effectiveBreakpoint = 'desktop';
  } else {
    // fluid mode based on real window size
    if (windowWidth < 640) {
      effectiveBreakpoint = 'phone';
    } else if (windowWidth < 1024) {
      effectiveBreakpoint = 'tablet';
    } else {
      effectiveBreakpoint = 'desktop';
    }
  }

  return {
    breakpoint: effectiveBreakpoint,
    isPhone: effectiveBreakpoint === 'phone',
    isTablet: effectiveBreakpoint === 'tablet',
    isDesktop: effectiveBreakpoint === 'desktop',
    windowWidth,
  };
}
