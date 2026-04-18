"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

type ChipVariant = "default" | "active" | "aurora";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  leftIcon?: ReactNode;
  onRemove?: () => void;
}

const variantClasses: Record<ChipVariant, string> = {
  default:
    "bg-[var(--glass-bg-1)] text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]",
  active:
    "bg-[var(--aurora-2)]/15 text-[var(--aurora-2)] border-[var(--aurora-2)]/30",
  aurora: "aurora-bg text-white",
};

export const Chip = forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  { variant = "default", leftIcon, onRemove, className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-medium",
        "transition-colors duration-[var(--dur-fast)]",
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {leftIcon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{leftIcon}</span>}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="ml-0.5 -mr-1 rounded-full p-0.5 hover:bg-[color-mix(in_oklab,currentColor_15%,transparent)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      )}
    </span>
  );
});
