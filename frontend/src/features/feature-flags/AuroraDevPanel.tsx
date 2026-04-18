"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Flame, RefreshCw, X } from "lucide-react";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/Button";
import { useUiV2Flag } from "./UiV2FlagContext";
import type { UiV2Flag } from "./uiV2";

/**
 * AuroraDevPanel — slide-out drawer for toggling v2 feature-flag surfaces.
 *
 * Visible only when:
 *   - `process.env.NODE_ENV === 'development'`, OR
 *   - The query-string `?aurora_dev=1` is present (useful for staging).
 *
 * The panel writes directly to the localStorage cache via `overrideFlag`,
 * so changes take effect on the next render — no page reload needed.
 *
 * This component tree-shakes cleanly in production because the entire
 * component returns null unless one of the conditions above is met.
 */

type Surface = keyof UiV2Flag["surfaces"];
const SURFACES: { id: Surface; label: string; desc: string }[] = [
  { id: "studio", label: "Studio v2", desc: "StudioShellV2 with editor, voice picker & dock" },
  { id: "reader", label: "Reader v2", desc: "ReaderShellV2 with paragraph TTS" },
  { id: "library", label: "Library v2", desc: "LibraryHubV2 with draft card & browse tabs" },
];

function isDevVisible(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "development") return true;
  return new URLSearchParams(window.location.search).get("aurora_dev") === "1";
}

export function AuroraDevPanel() {
  const [open, setOpen] = useState(false);
  const { flag, syncing, overrideFlag } = useUiV2Flag();

  // Stable check — evaluated once on client. If false we render nothing.
  const [visible] = useState(isDevVisible);
  if (!visible) return null;

  const toggleMaster = () =>
    overrideFlag((f) => ({ ...f, enabled: !f.enabled }));

  const toggleSurface = (surface: Surface) =>
    overrideFlag((f) => ({
      ...f,
      surfaces: { ...f.surfaces, [surface]: !f.surfaces[surface] },
    }));

  const enableAll = () =>
    overrideFlag({
      enabled: true,
      rolloutPct: 100,
      surfaces: { studio: true, reader: true, library: true },
    });

  const resetToDefault = () =>
    overrideFlag({
      enabled: false,
      rolloutPct: 0,
      surfaces: { studio: false, reader: false, library: false },
    });

  return (
    <>
      {/* Trigger tab */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open Aurora dev panel"
        className={cn(
          "fixed bottom-24 right-0 z-[9999] flex items-center gap-1.5 rounded-l-lg border border-r-0",
          "border-[var(--aurora-1)]/40 bg-[var(--vf-color-bg)]/90 px-2.5 py-2 text-xs font-semibold",
          "text-[var(--aurora-1)] shadow-lg backdrop-blur-sm transition-opacity hover:opacity-100",
          open ? "opacity-0 pointer-events-none" : "opacity-70",
        )}
      >
        <Flame className="h-3.5 w-3.5" />
        v2
      </button>

      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className={cn(
              "fixed right-0 top-0 z-[9999] flex h-full w-80 flex-col",
              "border-l border-white/10 bg-[var(--vf-color-bg)]/95 shadow-2xl backdrop-blur-xl",
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-[var(--aurora-1)]" />
                <span className="text-sm font-semibold text-[var(--vf-color-text-primary)]">
                  Aurora v2 Dev Panel
                </span>
                {syncing && (
                  <RefreshCw className="h-3 w-3 animate-spin text-[var(--vf-color-text-muted)]" />
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close panel"
                className="rounded-md p-1 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Master toggle */}
            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--vf-color-text-primary)]">
                    Master enable
                  </p>
                  <p className="text-xs text-[var(--vf-color-text-muted)]">
                    Rollout %: {flag.rolloutPct}
                  </p>
                </div>
                <Toggle checked={flag.enabled} onToggle={toggleMaster} />
              </div>
            </div>

            {/* Surface toggles */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--vf-color-text-muted)]">
                Surfaces
              </p>
              <ul className="space-y-2">
                {SURFACES.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-white/8 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--vf-color-text-primary)]">
                        {s.label}
                      </p>
                      <p className="text-xs text-[var(--vf-color-text-muted)]">{s.desc}</p>
                    </div>
                    <Toggle
                      checked={flag.surfaces[s.id]}
                      onToggle={() => toggleSurface(s.id)}
                      disabled={!flag.enabled}
                    />
                  </li>
                ))}
              </ul>
            </div>

            {/* Allowlist status */}
            <div className="border-t border-white/10 px-4 py-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[var(--vf-color-text-muted)]">
                Allowlist
              </p>
              <p className="text-xs text-[var(--vf-color-text-muted)]">
                {flag.allowedUids.length === 0
                  ? "Empty — all users evaluated by rollout %"
                  : `${flag.allowedUids.length} UID(s) explicitly allowed`}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 border-t border-white/10 px-4 py-3">
              <Button variant="aurora" size="sm" onClick={enableAll} className="flex-1">
                Enable all
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={resetToDefault} className="flex-1">
                Reset
              </Button>
            </div>

            <p className="px-4 pb-3 text-center text-[10px] text-[var(--vf-color-text-muted)]">
              Dev-only · writes to localStorage cache · refreshes on next render
            </p>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

/* ── small toggle pill ───────────────────────── */

function Toggle({
  checked,
  onToggle,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent",
        "transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-[var(--aurora-1)]" : "bg-white/20",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}
