"use client";

import { Drawer } from "vaul";
import { type ReactNode } from "react";
import { cn } from "./cn";

export interface SheetProps {
  trigger?: ReactNode;
  title?: string;
  description?: string;
  children: ReactNode;
  side?: "bottom" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  snapPoints?: (number | string)[];
}

export function Sheet({
  trigger,
  title,
  description,
  children,
  side = "bottom",
  open,
  onOpenChange,
  className,
  snapPoints,
}: SheetProps) {
  const isRight = side === "right";

  return (
    <Drawer.Root
      direction={isRight ? "right" : "bottom"}
      {...(open != null && { open })}
      {...(onOpenChange != null && { onOpenChange })}
      {...(snapPoints != null && { snapPoints })}
    >
      {trigger && <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>}
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
        <Drawer.Content
          className={cn(
            "fixed z-[var(--z-modal)] outline-none",
            isRight
              ? "right-0 top-0 bottom-0 w-[min(90vw,420px)] rounded-l-2xl"
              : "bottom-0 left-0 right-0 max-h-[85vh] rounded-t-2xl",
            "glass-3 shadow-2xl",
            className,
          )}
        >
          {!isRight && (
            <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-[var(--glass-stroke-2)]" />
          )}
          <div className={cn("p-5", isRight && "h-full overflow-y-auto")}>
            {title && (
              <Drawer.Title className="text-lg font-semibold text-[var(--vf-color-text)]">
                {title}
              </Drawer.Title>
            )}
            {description && (
              <Drawer.Description className="mt-1 text-sm text-[var(--vf-color-text-muted)]">
                {description}
              </Drawer.Description>
            )}
            <div className={cn((title || description) && "mt-4")}>{children}</div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export const SheetClose = Drawer.Close;
