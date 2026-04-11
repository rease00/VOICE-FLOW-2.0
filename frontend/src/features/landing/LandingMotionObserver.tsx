'use client';

import { useEffect } from 'react';

export function LandingMotionObserver() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-vf-reveal]'));
    const root = document.documentElement;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);

    if (elements.length === 0) return undefined;

    const revealElement = (element: HTMLElement) => {
      element.setAttribute('data-vf-revealed', 'true');
    };

    if (prefersReducedMotion || saveData) {
      elements.forEach(revealElement);
      return undefined;
    }

    if (typeof IntersectionObserver === 'undefined') {
      elements.forEach(revealElement);
      return undefined;
    }

    root.dataset.vfLandingMotion = 'enabled';

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          revealElement(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        }
      },
      {
        root: null,
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.12,
      }
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      delete root.dataset.vfLandingMotion;
      observer.disconnect();
    };
  }, []);

  return null;
}
