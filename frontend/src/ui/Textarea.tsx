"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ error = false, className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-xl bg-[var(--glass-bg-1)] text-[var(--vf-color-text)]",
          "border border-[var(--glass-stroke-1)]",
          "placeholder:text-[var(--vf-color-text-muted)]",
          "outline-none focus:ring-2 focus:ring-[var(--aurora-2)] focus:border-transparent",
          "transition-colors duration-[var(--dur-fast)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "min-h-20 px-3.5 py-2.5 text-sm resize-y",
          error && "border-rose-500 focus:ring-rose-500",
          className,
        )}
        {...rest}
      />
    );
  },
);
