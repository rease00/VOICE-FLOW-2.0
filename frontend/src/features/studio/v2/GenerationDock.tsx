"use client";

import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/ui/GlassPanel";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { spring, fadeIn } from "@/ui/motion";
import { Play, Pause, Square, Loader2, ListMusic, ChevronUp, Volume2, Download } from "lucide-react";
import { useRef, useState, useCallback, useEffect } from "react";

type DockStatus = "idle" | "generating" | "playing" | "paused" | "error";

interface GenerationDockProps {
  status: DockStatus;
  progress: number;
  audioUrl: string | null;
  queueLength: number;
  onGenerate: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onDownload: () => void;
  onOpenQueue: () => void;
  disabled?: boolean;
  errorMessage?: string | undefined;
}

const STATUS_LABELS: Record<DockStatus, string> = {
  idle: "Ready to generate",
  generating: "Synthesizing…",
  playing: "Playing",
  paused: "Paused",
  error: "Error",
};

export function GenerationDock({
  status,
  progress,
  audioUrl,
  queueLength,
  onGenerate,
  onPlay,
  onPause,
  onStop,
  onDownload,
  onOpenQueue,
  disabled = false,
  errorMessage,
}: GenerationDockProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <GlassPanel
      intensity={3}
      anchor="bottom"
      role="region"
      aria-label="Generation dock"
      className="fixed inset-x-4 bottom-4 z-[var(--z-dock)] mx-auto max-w-[1376px] px-4 py-3"
    >
      <div className="flex items-center gap-3">
        {/* Transport controls */}
        <div className="flex items-center gap-1.5">
          {status === "generating" ? (
            <Button variant="ghost" size="icon" onClick={onStop} disabled={disabled}>
              <Square className="h-4 w-4" />
            </Button>
          ) : status === "playing" ? (
            <Button variant="ghost" size="icon" onClick={onPause}>
              <Pause className="h-4 w-4" />
            </Button>
          ) : audioUrl ? (
            <motion.button
              type="button"
              onClick={onPlay}
              whileTap={{ scale: 0.94 }}
              transition={spring.press}
              className="aurora-bg flex h-10 w-10 items-center justify-center rounded-full text-white shadow-[0_8px_20px_rgba(124,92,255,0.45)]"
            >
              <Play className="ml-0.5 h-4 w-4" />
            </motion.button>
          ) : (
            <Button
              variant="aurora"
              size="md"
              onClick={onGenerate}
              disabled={disabled}
            >
              Generate
            </Button>
          )}
        </div>

        {/* Progress / status */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "text-sm font-medium",
                status === "error"
                  ? "text-rose-400"
                  : "text-[var(--vf-color-text)]",
              )}
            >
              {status === "error" ? errorMessage || "Generation failed" : STATUS_LABELS[status]}
            </span>
            {(status === "playing" || status === "paused") && duration > 0 && (
              <span className="text-xs tabular-nums text-[var(--vf-color-text-muted)]">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              className={cn(
                "h-full rounded-full",
                status === "generating"
                  ? "aurora-bg"
                  : status === "error"
                    ? "bg-rose-500"
                    : "bg-[var(--aurora-2)]",
              )}
              initial={{ width: "0%" }}
              animate={{
                width:
                  status === "generating"
                    ? `${Math.max(progress, 5)}%`
                    : status === "playing" && duration > 0
                      ? `${(currentTime / duration) * 100}%`
                      : "0%",
              }}
              transition={spring.layout}
            />
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          {audioUrl && (
            <Button variant="ghost" size="icon" onClick={onDownload}>
              <Download className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onOpenQueue}>
            <ListMusic className="mr-1 h-3.5 w-3.5" />
            {queueLength > 0 ? `Queue (${queueLength})` : "Queue"}
          </Button>
        </div>
      </div>

      {/* Hidden audio element for playback */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={() => {
            if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) setDuration(audioRef.current.duration);
          }}
          onEnded={onPause}
        />
      )}
    </GlassPanel>
  );
}
