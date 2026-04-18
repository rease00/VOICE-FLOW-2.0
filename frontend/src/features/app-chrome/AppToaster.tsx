"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * AppToaster — thin Aurora-themed wrapper over sonner's Toaster.
 *
 * Positions toasts at the bottom-right, above the MiniPlayer (pb-16).
 * Custom styling uses CSS variables from the Aurora design tokens.
 *
 * Usage from anywhere:
 *   import { toast } from "sonner";
 *   toast.success("Done!");
 *   toast.error("Something went wrong.");
 *   toast.promise(myPromise, { loading: "Generating…", success: "Done!", error: "Failed" });
 */
export function AppToaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      offset={72} /* clear the 56 px MiniPlayer + 16 px gap */
      expand={false}
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: [
            "rounded-xl border border-white/10",
            "bg-[var(--vf-color-bg)]/90 backdrop-blur-xl",
            "shadow-[0_8px_32px_rgba(0,0,0,0.35)]",
            "text-[var(--vf-color-text-primary)]",
            "font-sans text-sm",
          ].join(" "),
          title: "font-medium",
          description: "text-[var(--vf-color-text-muted)] text-xs",
          actionButton: "aurora-bg text-white rounded-lg px-3 py-1 text-xs font-medium",
          cancelButton:
            "bg-white/10 text-[var(--vf-color-text-muted)] rounded-lg px-3 py-1 text-xs",
          closeButton:
            "border border-white/10 bg-white/5 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text-primary)]",
        },
      }}
    />
  );
}
