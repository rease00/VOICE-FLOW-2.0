"use client";

import * as P from "@radix-ui/react-popover";
import { forwardRef, type ReactNode } from "react";
import { cn } from "./cn";

export interface PopoverProps {
  trigger: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children: ReactNode;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({
  trigger,
  side = "bottom",
  align = "center",
  children,
  className,
  open,
  onOpenChange,
}: PopoverProps) {
  return (
    <P.Root {...(open != null && { open })} {...(onOpenChange != null && { onOpenChange })}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn(
            "z-[var(--z-popover)] rounded-2xl p-4",
            "glass-3 shadow-2xl",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[side=top]:slide-in-from-bottom-2",
            "data-[side=bottom]:slide-in-from-top-2",
            "data-[side=left]:slide-in-from-right-2",
            "data-[side=right]:slide-in-from-left-2",
            "outline-none",
            className,
          )}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export const PopoverClose = P.Close;
