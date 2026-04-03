'use client';

import { useEffect } from 'react';

const VISUAL_READY_ATTRIBUTE = 'data-vf-visual-ready';

export function AppShellVisualBootstrap() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const shell = document.querySelector<HTMLElement>('[data-vf-app-shell]');
    if (!shell) return undefined;

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const markReady = () => shell.setAttribute(VISUAL_READY_ATTRIBUTE, 'true');
    const fallbackTimeoutId = window.setTimeout(markReady, 1500);
    let idleId: number | null = null;

    const rafId = window.requestAnimationFrame(() => {
      if (typeof win.requestIdleCallback === 'function') {
        idleId = win.requestIdleCallback(() => {
          window.clearTimeout(fallbackTimeoutId);
          markReady();
        }, { timeout: 1500 });
        return;
      }
      const timeoutId = window.setTimeout(() => {
        window.clearTimeout(fallbackTimeoutId);
        markReady();
      }, 180);
      idleId = timeoutId;
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(fallbackTimeoutId);
      if (idleId === null) return;
      if (typeof win.cancelIdleCallback === 'function' && typeof win.requestIdleCallback === 'function') {
        win.cancelIdleCallback(idleId);
        return;
      }
      window.clearTimeout(idleId);
    };
  }, []);

  return null;
}
