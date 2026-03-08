import { useEffect, useState } from 'react';

export type WorkspaceViewportMode = 'phone' | 'tablet' | 'desktop';

const PHONE_MAX_WIDTH = 639;
const TABLET_MAX_WIDTH = 1279;

const resolveViewportMode = (width: number): WorkspaceViewportMode => {
  if (width <= PHONE_MAX_WIDTH) return 'phone';
  if (width <= TABLET_MAX_WIDTH) return 'tablet';
  return 'desktop';
};

const readWindowWidth = (): number => {
  if (typeof window === 'undefined') return TABLET_MAX_WIDTH;
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
