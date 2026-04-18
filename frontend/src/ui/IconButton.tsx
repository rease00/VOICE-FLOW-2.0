"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "./cn";
import { spring } from "./motion";

type IconButtonVariant = "ghost" | "secondary" | "danger";
type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps
  extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  label: string;
  children: ReactNode;
}

const variantClasses: Record<IconButtonVariant, string> = {
  ghost:
    "bg-transparent text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)] hover:bg-[color-mix(in_oklab,currentColor_8%,transparent)]",
  secondary:
    "glass-1 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]",
  danger:
    "bg-transparent text-rose-400 hover:bg-rose-500/10",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-8 w-8 [&>svg]:h-4 [&>svg]:w-4",
  md: "h-10 w-10 [&>svg]:h-5 [&>svg]:w-5",
  lg: "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = "ghost", size = "md", label, className, children, disabled, ...rest },
    ref,
  ) {
    return (
      <motion.button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={disabled}
        whileTap={{ scale: 0.92 }}
        transition={spring.press}
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-2)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vf-color-bg)]",
          "transition-colors duration-[var(--dur-fast)]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          sizeClasses[size],
          variantClasses[variant],
          className,
        )}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);
