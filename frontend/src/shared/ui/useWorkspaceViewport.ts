import { useEffect, useState } from 'react';

import type { WorkspaceLayoutMode } from '../../../types';

export type WorkspaceViewportMode = WorkspaceLayoutMode;

export const WORKSPACE_LAYOUT_BREAKPOINTS = {
  phoneMax: 767,
  tabletMax: 1279,
} as const;

const resolveViewportMode = (width: number): WorkspaceViewportMode => {
  const { phoneMax, tabletMax } = WORKSPACE_LAYOUT_BREAKPOINTS;
  if (width <= phoneMax) return 'phone';
  if (width <= tabletMax) return 'tablet';
  return 'desktop';
};

const readWindowWidth = (): number => {
  if (typeof window === 'undefined') return WORKSPACE_LAYOUT_BREAKPOINTS.tabletMax;
  return Math.max(0, Math.round(window.innerWidth || 0));
};

export const useWorkspaceViewport = () => {
  const [width, setWidth] = useState<number>(readWindowWidth);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onResize = () => {
      setWidth(readWindowWidth());
    };

    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const mode = resolveViewportMode(width);

  return {
    width,
    mode,
    isPhone: mode === 'phone',
    isTablet: mode === 'tablet',
    isDesktop: mode === 'desktop',
  };
};
