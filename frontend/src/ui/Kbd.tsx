"use client";

import { type HTMLAttributes } from "react";
import { cn } from "./cn";

export interface KbdProps extends HTMLAttributes<HTMLElement> {}

export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-md px-1.5 py-0.5",
        "border border-[var(--glass-stroke-1)] bg-[var(--glass-bg-1)]",
        "text-[11px] font-mono text-[var(--vf-color-text-muted)]",
        "shadow-[0_1px_0_var(--glass-stroke-1)]",
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}
