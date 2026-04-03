'use client';

import { useEffect } from 'react';

export function LandingMotionObserver() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-vf-reveal]'));

    if (elements.length === 0) return undefined;

    const revealElement = (element: HTMLElement) => {
      element.setAttribute('data-vf-revealed', 'true');
    };

    if (typeof IntersectionObserver === 'undefined') {
      elements.forEach(revealElement);
      return undefined;
    }

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
        rootMargin: '0px 0px -12% 0px',
        threshold: 0.18,
      }
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}
