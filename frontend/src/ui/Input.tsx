"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

type InputSize = "sm" | "md" | "lg";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: InputSize;
  error?: boolean;
}

const sizeClasses: Record<InputSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-3.5 text-sm",
  lg: "h-12 px-4 text-base",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = "md", error = false, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-xl bg-[var(--glass-bg-1)] text-[var(--vf-color-text)]",
        "border border-[var(--glass-stroke-1)]",
        "placeholder:text-[var(--vf-color-text-muted)]",
        "outline-none focus:ring-2 focus:ring-[var(--aurora-2)] focus:border-transparent",
        "transition-colors duration-[var(--dur-fast)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sizeClasses[inputSize],
        error && "border-rose-500 focus:ring-rose-500",
        className,
      )}
      {...rest}
    />
  );
});
