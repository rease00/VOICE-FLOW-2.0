"use client";

import { type ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-center",
        className,
      )}
    >
      {icon && (
        <div className="text-[var(--vf-color-text-muted)] [&>svg]:h-10 [&>svg]:w-10 opacity-50">
          {icon}
        </div>
      )}
      <h3 className="text-base font-medium text-[var(--vf-color-text)]">
        {title}
      </h3>
      {description && (
        <p className="max-w-xs text-sm text-[var(--vf-color-text-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
