"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, X, ChevronUp } from "lucide-react";
import { cn } from "@/ui/cn";
import { GlassPanel } from "@/ui/GlassPanel";
import { useReaderStore, selectMiniPlayerVisible } from "./readerStore";

/**
 * MiniPlayer — persistent 56px bottom bar shown across all /app/* pages
 * whenever a Reader v2 track is loaded or synthesizing.
 *
 * Layout (mobile, single row):
 *   [spinner|title+progress line] [|◀| ▶/⏸ |▶|] [expand ↑] [✕]
 *
 * The component controls the shared HTMLAudioElement ref stored in the
 * readerStore, so both MiniPlayer and PlayerDock can drive the same
 * audio element without prop-drilling.
 *
 * Expand button: scrolls to /app/reader-v2 (or the current reader route).
 * Dismiss (✕): calls store.dismiss() — clears track + audioUrl.
 */

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 2.0];

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function MiniPlayer() {
  const pathname = usePathname();
  const storeVisible = useReaderStore(selectMiniPlayerVisible);

  // Hide on the reader-v2 page — PlayerDock serves that surface
  const visible = storeVisible && !pathname?.includes("/reader-v2");
  const playing = useReaderStore((s) => s.playing);
  const synthesizing = useReaderStore((s) => s.synthesizing);
  const audioUrl = useReaderStore((s) => s.audioUrl);
  const track = useReaderStore((s) => s.track);
  const currentTime = useReaderStore((s) => s.currentTime);
  const duration = useReaderStore((s) => s.duration);
  const speed = useReaderStore((s) => s.speed);

  const setPlaying = useReaderStore((s) => s.setPlaying);
  const setCurrentTime = useReaderStore((s) => s.setCurrentTime);
  const setDuration = useReaderStore((s) => s.setDuration);
  const skipForward = useReaderStore((s) => s.skipForward);
  const skipBack = useReaderStore((s) => s.skipBack);
  const dismiss = useReaderStore((s) => s.dismiss);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* ── sync audio element with store ──────────── */
  useEffect(() => {
    if (!audioUrl) {
      audioRef.current?.pause();
      return;
    }

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const el = audioRef.current;
    el.src = audioUrl;
    el.playbackRate = speed;

    const onTime = () => setCurrentTime(el.currentTime);
    const onDuration = () => setDuration(el.duration);
    const onEnded = () => setPlaying(false);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onDuration);
    el.addEventListener("loadedmetadata", onDuration);
    el.addEventListener("ended", onEnded);

    el.play().then(() => setPlaying(true)).catch(() => {});

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onDuration);
      el.removeEventListener("loadedmetadata", onDuration);
      el.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  /* ── sync speed ──────────────────────────────── */
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  /* ── play / pause ────────────────────────────── */
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().then(() => setPlaying(true)).catch(() => {});
    }
  };

  /* ── seek ────────────────────────────────────── */
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = t;
      setCurrentTime(t);
    }
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const title = track?.title ?? "Now playing";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="mini-player"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className="fixed bottom-0 left-0 right-0 z-[9990] px-2 pb-2 sm:px-4 sm:pb-3"
        >
          <GlassPanel
            intensity={3}
            anchor="bottom"
            className="flex w-full items-center gap-3 rounded-2xl border border-white/10 px-3 py-2 shadow-2xl"
          >
            {/* Spinner or waveform icon */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center">
              {synthesizing ? (
                <WaveformSpinner />
              ) : (
                <div
                  className={cn(
                    "h-7 w-7 rounded-lg",
                    "bg-gradient-to-br from-[var(--aurora-1)] to-[var(--aurora-3)]",
                    "flex items-center justify-center",
                  )}
                >
                  <span className="text-[10px] font-bold text-white">v2</span>
                </div>
              )}
            </div>

            {/* Title + scrubber */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[var(--vf-color-text-primary)]">
                {synthesizing ? "Synthesizing…" : title}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="tabular-nums text-[10px] text-[var(--vf-color-text-muted)]">
                  {fmt(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  disabled={synthesizing || duration === 0}
                  className="mini-scrubber h-1 flex-1 cursor-pointer accent-[var(--aurora-1)] disabled:opacity-30"
                  aria-label="Seek"
                />
                <span className="tabular-nums text-[10px] text-[var(--vf-color-text-muted)]">
                  {fmt(duration)}
                </span>
              </div>
            </div>

            {/* Transport controls */}
            <div className="flex shrink-0 items-center gap-0.5">
              <IconBtn aria-label="Previous paragraph" onClick={skipBack} disabled={synthesizing}>
                <SkipBack className="h-4 w-4" />
              </IconBtn>
              <IconBtn
                aria-label={playing ? "Pause" : "Play"}
                onClick={togglePlay}
                disabled={synthesizing || !audioUrl}
                highlight
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </IconBtn>
              <IconBtn aria-label="Next paragraph" onClick={skipForward} disabled={synthesizing}>
                <SkipForward className="h-4 w-4" />
              </IconBtn>
            </div>

            {/* Speed chip */}
            <SpeedChip speed={speed} />

            {/* Expand link */}
            <a
              href="/app/reader-v2"
              aria-label="Open Reader"
              className={cn(
                "shrink-0 rounded-md p-1 text-[var(--vf-color-text-muted)]",
                "hover:text-[var(--vf-color-text-primary)] transition-colors",
              )}
            >
              <ChevronUp className="h-4 w-4" />
            </a>

            {/* Dismiss */}
            <button
              onClick={dismiss}
              aria-label="Dismiss player"
              className={cn(
                "shrink-0 rounded-md p-1 text-[var(--vf-color-text-muted)]",
                "hover:text-[var(--vf-color-text-primary)] transition-colors",
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── small sub-components ───────────────────── */

function IconBtn({
  children,
  highlight,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { highlight?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
        highlight
          ? "bg-[var(--aurora-1)]/20 text-[var(--aurora-1)] hover:bg-[var(--aurora-1)]/30"
          : "text-[var(--vf-color-text-primary)] hover:bg-white/10",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function SpeedChip({ speed }: { speed: number }) {
  const setSpeed = useReaderStore((s) => s.setSpeed);

  const cycle = () => {
    const idx = SPEED_OPTIONS.indexOf(speed);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length] ?? 1.0;
    setSpeed(next);
  };

  return (
    <button
      onClick={cycle}
      aria-label="Change speed"
      className={cn(
        "shrink-0 rounded-full border border-white/10 px-2 py-0.5",
        "text-[10px] font-semibold text-[var(--vf-color-text-muted)]",
        "hover:border-[var(--aurora-1)]/40 hover:text-[var(--aurora-1)] transition-colors",
      )}
    >
      {speed}×
    </button>
  );
}

function WaveformSpinner() {
  return (
    <span className="flex h-7 w-7 items-end justify-center gap-[2px]" aria-hidden>
      {[3, 6, 4, 7, 5].map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-[var(--aurora-1)] opacity-80"
          style={{
            height: `${h * 2}px`,
            animation: `mini-waveform 0.9s ease-in-out infinite`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </span>
  );
}
