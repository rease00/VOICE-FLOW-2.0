"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "./cn";
import { spring } from "./motion";

type ButtonVariant = "primary" | "secondary" | "ghost" | "aurora" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--vf-color-text)] text-[var(--vf-color-bg)] hover:opacity-90 disabled:opacity-50",
  secondary:
    "glass-2 text-[var(--vf-color-text)] hover:bg-[color-mix(in_oklab,white_92%,transparent)]",
  ghost:
    "bg-transparent text-[var(--vf-color-text)] hover:bg-[color-mix(in_oklab,currentColor_8%,transparent)]",
  aurora:
    "aurora-bg text-white shadow-[0_8px_24px_rgba(124,92,255,0.35)] hover:shadow-[0_12px_32px_rgba(124,92,255,0.45)]",
  danger:
    "bg-rose-500 text-white hover:bg-rose-600 disabled:bg-rose-500/40",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2.5",
  icon: "h-10 w-10 p-0",
};

/**
 * Aurora primary button. Composes framer-motion press feedback with the
 * variant token presets. Honors `prefers-reduced-motion` automatically
 * because framer-motion respects the OS setting.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: 1.01 }}
        transition={spring.press}
        className={cn(
          "inline-flex items-center justify-center rounded-full font-medium",
          "outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-2)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vf-color-bg)]",
          "transition-colors duration-[var(--dur-fast)]",
          "disabled:cursor-not-allowed",
          sizeClasses[size],
          variantClasses[variant],
          loading && "cursor-wait",
          className,
        )}
        {...rest}
      >
        {loading ? (
          <span
            aria-hidden
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </motion.button>
    );
  },
);
