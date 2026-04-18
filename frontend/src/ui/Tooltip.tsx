"use client";

import * as T from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";
import { cn } from "./cn";

export interface TooltipProps {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
  children: ReactNode;
  className?: string;
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={300}>{children}</T.Provider>;
}

export function Tooltip({
  content,
  side = "top",
  delayDuration,
  children,
  className,
}: TooltipProps) {
  return (
    <T.Root {...(delayDuration != null && { delayDuration })}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[var(--z-tooltip)] rounded-lg px-2.5 py-1.5",
            "bg-[var(--vf-color-text)] text-[var(--vf-color-bg)]",
            "text-xs font-medium shadow-lg",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            className,
          )}
        >
          {content}
          <T.Arrow className="fill-[var(--vf-color-text)]" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
