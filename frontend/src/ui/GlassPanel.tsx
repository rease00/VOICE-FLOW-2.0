"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./cn";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** intensity 1 = subtle, 3 = max blur (use 3 for sheets/docks) */
  intensity?: 1 | 2 | 3;
  /** anchor side, used for scrim layout shortcuts */
  anchor?: "top" | "bottom" | "left" | "right" | "center";
}

const intensityClass = {
  1: "glass-1",
  2: "glass-2",
  3: "glass-3",
} as const;

const anchorClass = {
  top: "rounded-b-3xl",
  bottom: "rounded-t-3xl",
  left: "rounded-r-3xl",
  right: "rounded-l-3xl",
  center: "rounded-3xl",
} as const;

/**
 * Frosted-glass surface used by Studio/Reader docks, sheets, and the
 * navbar in v2. Composes `glass-{n}` utilities defined in
 * `aurora-tokens.css`.
 */
export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  function GlassPanel(
    { intensity = 2, anchor = "center", className, children, ...rest },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(intensityClass[intensity], anchorClass[anchor], className)}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
