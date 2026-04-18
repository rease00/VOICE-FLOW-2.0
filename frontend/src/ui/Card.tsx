"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./cn";

type Elevation = 1 | 2 | 3;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: Elevation;
  /** Wrap with `aurora` gradient stroke (used for highlight cards) */
  glow?: boolean;
  /** Compact padding */
  compact?: boolean;
}

const elevationClass: Record<Elevation, string> = {
  1: "glass-1",
  2: "glass-2",
  3: "glass-3",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { elevation = 2, glow = false, compact = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "relative rounded-2xl",
        elevationClass[elevation],
        compact ? "p-3" : "p-5",
        glow && "before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-[var(--aurora-gradient)] before:opacity-30 before:blur-xl",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
