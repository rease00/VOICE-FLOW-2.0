'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseIntersectionObserverOptions extends IntersectionObserverInit {
  /** Callback when element becomes visible */
  onVisible?: () => void;
  /** Callback when element becomes hidden */
  onHidden?: () => void;
  /** Pause animations when hidden */
  pauseAnimationsWhenHidden?: boolean;
  /** Debug logging */
  debug?: boolean;
}

export interface UseIntersectionObserverResult {
  ref: React.RefObject<HTMLElement | null>;
  isVisible: boolean;
  isAnimating: boolean;
  element: HTMLElement | null;
}

/**
 * Hook to detect element visibility and pause animations when out of viewport
 * Helps optimize performance by disabling animations for elements users can't see
 *
 * Usage:
 * ```tsx
 * function AnimatedComponent() {
 *   const { ref, isVisible } = useIntersectionObserver({
 *     pauseAnimationsWhenHidden: true,
 *     threshold: 0.1,
 *   });
 *
 *   return (
 *     <div ref={ref} className={isVisible ? 'animate-pulse' : ''}>
 *       Animated content
 *     </div>
 *   );
 * }
 * ```
 */
export function useIntersectionObserver(
  options: UseIntersectionObserverOptions = {}
): UseIntersectionObserverResult {
  const {
    threshold = 0.1,
    rootMargin = '0px',
    root = null,
    onVisible,
    onHidden,
    pauseAnimationsWhenHidden = false,
    debug = false,
  } = options;

  const ref = useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Handle intersection changes
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        const wasVisible = isVisible;
        const nowVisible = entry.isIntersecting;

        if (nowVisible && !wasVisible) {
          if (debug) console.warn('[useIntersectionObserver] Element became visible');
          setIsVisible(true);
          onVisible?.();

          // Resume animations
          if (pauseAnimationsWhenHidden && entry.target) {
            entry.target.setAttribute('data-visible', 'true');
            (entry.target as HTMLElement).style.animationPlayState = 'running';
          }
        } else if (!nowVisible && wasVisible) {
          if (debug) console.warn('[useIntersectionObserver] Element became hidden');
          setIsVisible(false);
          onHidden?.();

          // Pause animations
          if (pauseAnimationsWhenHidden && entry.target) {
            entry.target.setAttribute('data-visible', 'false');
            (entry.target as HTMLElement).style.animationPlayState = 'paused';
          }
        }
      });
    },
    [isVisible, onVisible, onHidden, pauseAnimationsWhenHidden, debug]
  );

  // Setup observer
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setElement(element);

    // Create observer
    observerRef.current = new IntersectionObserver(handleIntersection, {
      root,
      rootMargin,
      threshold,
    });

    // Start observing
    observerRef.current.observe(element);

    // Cleanup
    return () => {
      if (observerRef.current) {
        observerRef.current.unobserve(element);
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      setElement(null);
    };
  }, [root, rootMargin, threshold, handleIntersection]);

  return {
    ref,
    isVisible,
    isAnimating: isVisible,
    element,
  };
}
