'use client';

import React, { ReactNode } from 'react';
import { useIntersectionObserver } from '../../src/shared/hooks/useIntersectionObserver';

interface AnimatedSectionProps {
  children: ReactNode;
  className?: string;
  /** CSS class to apply when visible */
  visibleClassName?: string;
  /** CSS class to apply when hidden */
  hiddenClassName?: string;
  /** Pause animations when out of view */
  pauseAnimations?: boolean;
  /** IntersectionObserver threshold (0-1) */
  threshold?: number | number[];
  /** ID for debugging */
  id?: string;
}

/**
 * Wrapper component that automatically pauses animations for elements
 * outside the viewport, improving performance
 *
 * Usage:
 * ```tsx
 * <AnimatedSection pauseAnimations threshold={0.25}>
 *   <div className="vf-brand-float animate-pulse">
 *     This will pause when out of view
 *   </div>
 * </AnimatedSection>
 * ```
 */
export const AnimatedSection: React.FC<AnimatedSectionProps> = ({
  children,
  className = '',
  visibleClassName = 'opacity-100',
  hiddenClassName = 'opacity-50',
  pauseAnimations = true,
  threshold = 0.1,
  id,
}) => {
  const { ref, isVisible } = useIntersectionObserver({
    threshold,
    pauseAnimationsWhenHidden: pauseAnimations,
    debug: false,
  });

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      id={id}
      className={`vf-animated-section ${className} ${isVisible ? visibleClassName : hiddenClassName}`}
      data-visible={isVisible}
    >
      {children}
    </div>
  );
};

export default AnimatedSection;
