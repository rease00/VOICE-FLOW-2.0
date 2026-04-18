"use client";

import { cn } from "./cn";

type SkeletonVariant = "line" | "circle" | "rect";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  variant = "line",
  className,
  width,
  height,
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{ width, height }}
      className={cn(
        "animate-pulse bg-[var(--glass-bg-2)]",
        variant === "circle" && "rounded-full",
        variant === "line" && "h-4 rounded-md",
        variant === "rect" && "rounded-xl",
        className,
      )}
    />
  );
}
