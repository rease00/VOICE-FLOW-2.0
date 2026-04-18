"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "@/ui/GlassPanel";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { spring } from "@/ui/motion";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Gauge,
} from "lucide-react";

interface PlayerDockProps {
  /** Audio source URL to play */
  audioUrl: string | null;
  /** Whether text is currently being synthesized */
  synthesizing: boolean;
  /** Called when user clicks next/prev to advance paragraph */
  onSkipForward?: () => void;
  onSkipBack?: () => void;
  /** External time update callback for paragraph tracking */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export function PlayerDock({
  audioUrl,
  synthesizing,
  onSkipForward,
  onSkipBack,
  onTimeUpdate,
}: PlayerDockProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [showSpeed, setShowSpeed] = useState(false);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  }, [playing]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = t;
      setCurrentTime(t);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !muted;
      setMuted(!muted);
    }
  }, [muted]);

  const changeSpeed = useCallback((s: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = s;
      setSpeed(s);
      setShowSpeed(false);
    }
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTime = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime, audio.duration);
    };
    const handleMeta = () => setDuration(audio.duration);
    const handleEnded = () => setPlaying(false);

    audio.addEventListener("timeupdate", handleTime);
    audio.addEventListener("loadedmetadata", handleMeta);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", handleTime);
      audio.removeEventListener("loadedmetadata", handleMeta);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioUrl, onTimeUpdate]);

  return (
    <GlassPanel
      intensity={3}
      anchor="bottom"
      role="region"
      aria-label="Audio player"
      className="fixed inset-x-4 bottom-4 z-[var(--z-dock)] mx-auto max-w-[1376px] px-4 py-3"
    >
      <div className="flex items-center gap-4">
        {/* Transport */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onSkipBack}
            disabled={!audioUrl}
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          <motion.button
            type="button"
            onClick={togglePlay}
            disabled={!audioUrl && !synthesizing}
            whileTap={{ scale: 0.92 }}
            transition={spring.press}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full text-white shadow-lg disabled:opacity-40",
              synthesizing
                ? "animate-pulse bg-[var(--aurora-2)]/60"
                : "aurora-bg",
            )}
          >
            {playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="ml-0.5 h-4 w-4" />
            )}
          </motion.button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onSkipForward}
            disabled={!audioUrl}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Timeline */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="min-w-[3.5ch] text-right text-xs tabular-nums text-[var(--vf-color-text-muted)]">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--aurora-2)] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--aurora-2)]"
          />
          <span className="min-w-[3.5ch] text-xs tabular-nums text-[var(--vf-color-text-muted)]">
            {formatTime(duration)}
          </span>
        </div>

        {/* Volume + speed */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleMute}
            className="rounded p-1.5 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]"
          >
            {muted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSpeed(!showSpeed)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]"
            >
              <Gauge className="h-3 w-3" />
              {speed}x
            </button>
            {showSpeed && (
              <div className="absolute -top-2 right-0 z-10 -translate-y-full rounded-xl border border-white/10 bg-[var(--vf-color-glass-bg)] p-1 shadow-xl backdrop-blur-xl">
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => changeSpeed(s)}
                    className={cn(
                      "block w-full rounded-lg px-3 py-1.5 text-left text-xs",
                      speed === s
                        ? "bg-[var(--aurora-2)]/15 text-[var(--vf-color-text)]"
                        : "text-[var(--vf-color-text-muted)] hover:bg-white/5",
                    )}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden audio */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} />}
    </GlassPanel>
  );
}
