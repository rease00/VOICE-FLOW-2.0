"use client";

import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Wand2, X, Download, Pause, Play, AlertTriangle } from "lucide-react";
import { cn } from "@/ui/cn";
import { GlassPanel } from "@/ui/GlassPanel";
import { useStudioStore, selectIndicatorVisible } from "./studioStore";

/**
 * GenerationIndicator — slim persistent pill shown across all /app/* pages
 * when Studio v2 is generating or has a completed audio result.
 *
 * Hidden on /app/studio (GenerationDock handles that surface).
 *
 * Anatomy (single row):
 *   [wand icon] [label · status text] [progress bar] [▶/⏸] [↓ dl] [✕]
 */

function fmt(pct: number) {
  return `${Math.round(pct)}%`;
}

export function GenerationIndicator() {
  const pathname = usePathname();
  const storeVisible = useStudioStore(selectIndicatorVisible);

  // Hide on /app/studio — GenerationDock already covers that surface
  const visible = storeVisible && !pathname?.startsWith("/app/studio");

  const status = useStudioStore((s) => s.status);
  const progress = useStudioStore((s) => s.progress);
  const audioUrl = useStudioStore((s) => s.audioUrl);
  const errorMessage = useStudioStore((s) => s.errorMessage);
  const job = useStudioStore((s) => s.job);

  const setStatus = useStudioStore((s) => s.setStatus);
  const reset = useStudioStore((s) => s.reset);

  const handlePlayPause = () => {
    setStatus(status === "playing" ? "paused" : "playing");
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "voiceflow-studio.mp3";
    a.click();
  };

  const label = job?.label ?? "Studio";
  const voiceName = job?.voiceName ?? "";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="gen-indicator"
          initial={{ y: -56, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -56, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className="fixed left-0 right-0 top-0 z-[9989] px-2 pt-2 sm:px-4 sm:pt-3"
        >
          <GlassPanel
            intensity={3}
            anchor="top"
            className="flex w-full items-center gap-3 rounded-2xl border border-white/10 px-3 py-2 shadow-2xl"
          >
            {/* Icon */}
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                status === "error"
                  ? "bg-red-500/20"
                  : "bg-gradient-to-br from-[var(--aurora-1)] to-[var(--aurora-3)]",
              )}
            >
              {status === "error" ? (
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              ) : (
                <Wand2 className="h-3.5 w-3.5 text-white" />
              )}
            </div>

            {/* Label + status */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[var(--vf-color-text-primary)]">
                {status === "error"
                  ? (errorMessage ?? "Generation failed")
                  : status === "generating"
                  ? `Generating… ${fmt(progress)}`
                  : status === "playing"
                  ? "Playing"
                  : status === "paused"
                  ? "Paused"
                  : label}
              </p>
              {voiceName && status !== "error" && (
                <p className="text-[10px] text-[var(--vf-color-text-muted)]">{voiceName}</p>
              )}
            </div>

            {/* Progress bar (only while generating) */}
            {status === "generating" && (
              <div
                className="relative h-1 w-24 shrink-0 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Generation progress"
              >
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--aurora-1)]"
                  style={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}

            {/* Play / Pause (only when audio is ready) */}
            {audioUrl && status !== "generating" && status !== "error" && (
              <button
                onClick={handlePlayPause}
                aria-label={status === "playing" ? "Pause" : "Play"}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                  "bg-[var(--aurora-1)]/20 text-[var(--aurora-1)] hover:bg-[var(--aurora-1)]/30",
                )}
              >
                {status === "playing" ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </button>
            )}

            {/* Download */}
            {audioUrl && (
              <button
                onClick={handleDownload}
                aria-label="Download audio"
                className="shrink-0 rounded-md p-1 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text-primary)] transition-colors"
              >
                <Download className="h-4 w-4" />
              </button>
            )}

            {/* Go to studio link */}
            <a
              href="/app/studio"
              aria-label="Open Studio"
              className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold text-[var(--vf-color-text-muted)] hover:text-[var(--aurora-1)] transition-colors border border-white/10 hover:border-[var(--aurora-1)]/30"
            >
              Studio
            </a>

            {/* Dismiss */}
            <button
              onClick={reset}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text-primary)] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
