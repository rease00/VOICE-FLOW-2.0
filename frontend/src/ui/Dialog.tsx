"use client";

import * as D from "@radix-ui/react-dialog";
import { type ReactNode } from "react";
import { cn } from "./cn";

export interface DialogProps {
  trigger?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  footer,
  className,
  open,
  onOpenChange,
}: DialogProps) {
  return (
    <D.Root {...(open != null && { open })} {...(onOpenChange != null && { onOpenChange })}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/60 backdrop-blur-sm animate-in fade-in-0" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[var(--z-modal)] -translate-x-1/2 -translate-y-1/2",
            "w-[min(90vw,480px)] rounded-2xl p-6",
            "glass-3 shadow-2xl",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "outline-none",
            className,
          )}
        >
          <D.Title className="text-lg font-semibold text-[var(--vf-color-text)]">
            {title}
          </D.Title>
          {description && (
            <D.Description className="mt-1.5 text-sm text-[var(--vf-color-text-muted)]">
              {description}
            </D.Description>
          )}
          <div className="mt-4">{children}</div>
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
          <D.Close
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full p-1.5 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)] hover:bg-[color-mix(in_oklab,currentColor_8%,transparent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-2)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const DialogClose = D.Close;
