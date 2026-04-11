'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Loader2, Timer, Rewind, FastForward } from 'lucide-react';
import type { PlaybackState, TtsSettings } from '../../model/types';
import { splitIntoSentenceChunks } from '../../services/ttsUtils';

interface MiniPlayerProps {
  playbackState: PlaybackState;
  onStateChange: (state: PlaybackState) => void;
  ttsSettings: TtsSettings;
  bookText?: string;
  isCompact?: boolean;
  theme?: string;
}

export function MiniPlayer({ playbackState, onStateChange, ttsSettings, bookText, isCompact = false }: MiniPlayerProps) {
  const [progress, setProgress] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [sleepRemaining, setSleepRemaining] = useState<number>(0);
  const sleepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const playbackStateRef = useRef(playbackState);
  playbackStateRef.current = playbackState;

  useEffect(() => {
    chunksRef.current = bookText ? splitIntoSentenceChunks(bookText, 500) : [];
    const total = chunksRef.current.length;
    if (total !== playbackStateRef.current.totalChunks) {
      onStateChange({ ...playbackStateRef.current, totalChunks: total });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookText]);

  const fetchAudio = useCallback(async (text: string, signal: AbortSignal): Promise<string> => {
    const body: Record<string, unknown> = {
      text,
      voice: ttsSettings.voice,
      language: ttsSettings.language,
      engine: ttsSettings.engine,
    };
    if (ttsSettings.engine === 'neural2') {
      body.speed = ttsSettings.speed;
      body.pitch = ttsSettings.pitch;
    }
    if (ttsSettings.engine === 'gemini-native' && ttsSettings.speakerMode === 'multi' && ttsSettings.speakerConfigs.length > 0) {
      body.speakerConfigs = ttsSettings.speakerConfigs;
    }
    const res = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error('TTS fetch failed');
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }, [ttsSettings]);

  const playChunk = useCallback(async (index: number) => {
    const chunks = chunksRef.current;
    if (index < 0 || index >= chunks.length) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFetching(true);
    try {
      const url = await fetchAudio(chunks[index]!, controller.signal);
      if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;
      audio.pause();
      if (audio.src) URL.revokeObjectURL(audio.src);
      audio.src = url;
      audio.currentTime = 0;
      setFetching(false);

      audio.ontimeupdate = () => {
        if (audio.duration && isFinite(audio.duration)) {
          setProgress((audio.currentTime / audio.duration) * 100);
          onStateChange({
            ...playbackStateRef.current,
            currentChunkIndex: index,
            currentTime: audio.currentTime,
            isPlaying: true,
            chunkDuration: audio.duration,
          });
        }
      };
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (index < chunks.length - 1) {
          const next = index + 1;
          onStateChange({ ...playbackStateRef.current, currentChunkIndex: next, currentTime: 0, isPlaying: true });
          playChunk(next);
        } else {
          onStateChange({ ...playbackStateRef.current, currentChunkIndex: index, currentTime: 0, isPlaying: false });
          setProgress(0);
        }
      };
      await audio.play();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('TTS playback error:', err);
        setFetching(false);
        onStateChange({ ...playbackStateRef.current, isPlaying: false });
      }
      const audio = audioRef.current;
      if (audio?.src) {
        URL.revokeObjectURL(audio.src);
        audio.src = '';
      }
    }
  }, [fetchAudio, onStateChange]);

  useEffect(() => {
    const audio = audioRef.current;
    if (playbackState.isPlaying) {
      if (audio && audio.src && !audio.ended && !fetching) {
        audio.play().catch(() => {});
      } else if (!fetching && chunksRef.current.length > 0) {
        playChunk(playbackState.currentChunkIndex);
      }
    } else {
      audio?.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackState.isPlaying]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
      const audio = audioRef.current;
      if (audio) { audio.pause(); if (audio.src) URL.revokeObjectURL(audio.src); }
    };
  }, []);

  useEffect(() => {
    if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    if (sleepMinutes === null) { setSleepRemaining(0); return; }

    const end = Date.now() + sleepMinutes * 60 * 1000;
    setSleepRemaining(sleepMinutes * 60);

    sleepTimerRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setSleepRemaining(left);
      if (left <= 0) {
        if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
        setSleepMinutes(null);
        onStateChange({ ...playbackStateRef.current, isPlaying: false });
      }
    }, 1000);

    return () => { if (sleepTimerRef.current) clearInterval(sleepTimerRef.current); };
  }, [sleepMinutes, onStateChange]);

  const handlePlayPause = () => {
    onStateChange({ ...playbackState, isPlaying: !playbackState.isPlaying });
  };

  const handleSkipForward15 = () => {
    const audio = audioRef.current;
    if (audio && audio.duration && isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.currentTime + 15, audio.duration);
    }
  };

  const handleSkipBack15 = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = Math.max(audio.currentTime - 15, 0);
    }
  };

  const cycleSleepTimer = () => {
    const options = [null, 5, 15, 30, 60];
    const currentIdx = options.indexOf(sleepMinutes);
    const next = options[(currentIdx + 1) % options.length];
    setSleepMinutes(next ?? null);
  };

  const handleNext = () => {
    if (playbackState.currentChunkIndex < playbackState.totalChunks - 1) {
      const next = playbackState.currentChunkIndex + 1;
      onStateChange({ ...playbackState, currentChunkIndex: next, currentTime: 0, isPlaying: true });
      playChunk(next);
    }
  };

  const handlePrevious = () => {
    if (playbackState.currentChunkIndex > 0) {
      const prev = playbackState.currentChunkIndex - 1;
      onStateChange({ ...playbackState, currentChunkIndex: prev, currentTime: 0, isPlaying: true });
      playChunk(prev);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isCompact) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={handlePrevious}
          disabled={playbackState.currentChunkIndex === 0}
          className="rounded-full p-1 transition-colors hover:bg-[var(--vf-reader-hover-bg)] disabled:opacity-40"
        >
          <SkipBack size={13} className="text-[var(--vf-reader-muted)]" />
        </button>
        <button
          onClick={handlePlayPause}
          disabled={fetching}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--vf-reader-primary-btn-bg)] text-[var(--vf-reader-primary-btn-text)] shadow-md transition hover:bg-[var(--vf-reader-primary-btn-hover-bg)] disabled:opacity-60"
        >
          {fetching ? (
            <Loader2 size={14} className="animate-spin" />
          ) : playbackState.isPlaying ? (
            <Pause size={14} />
          ) : (
            <Play size={14} className="ml-0.5" />
          )}
        </button>
        <button
          onClick={handleNext}
          disabled={playbackState.currentChunkIndex >= playbackState.totalChunks - 1}
          className="rounded-full p-1 transition-colors hover:bg-[var(--vf-reader-hover-bg)] disabled:opacity-40"
        >
          <SkipForward size={13} className="text-[var(--vf-reader-muted)]" />
        </button>
        <span className="ml-0.5 text-[10px] text-[var(--vf-reader-muted)]">{ttsSettings.speed.toFixed(1)}x</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="space-y-0.5">
        <div className="flex justify-between text-xs text-[var(--vf-reader-muted)]">
          <span className="text-xs">{formatTime(playbackState.currentTime)}</span>
          <span className="text-xs">
            Chunk {playbackState.currentChunkIndex + 1} of {playbackState.totalChunks}
          </span>
        </div>
        <input
          aria-label="Playback progress"
          type="range"
          min="0"
          max="100"
          value={progress}
          onChange={(e) => {
            const val = Number(e.target.value);
            setProgress(val);
            const audio = audioRef.current;
            if (audio && audio.duration && isFinite(audio.duration)) {
              audio.currentTime = (val / 100) * audio.duration;
            }
          }}
          className="vf-reader-slider w-full cursor-pointer"
        />
      </div>

      <div className="flex items-center justify-center gap-1.5">
        <button
          onClick={handlePrevious}
          disabled={playbackState.currentChunkIndex === 0}
          className="rounded-full p-1.5 transition-colors hover:bg-[var(--vf-reader-hover-bg)] disabled:opacity-50"
        >
          <SkipBack size={18} className="text-[var(--vf-reader-panel-text)]" />
        </button>
        <button
          onClick={handleSkipBack15}
          className="rounded-full p-1 transition-colors hover:bg-[var(--vf-reader-hover-bg)]"
          title="Back 15s"
        >
          <Rewind size={14} className="text-[var(--vf-reader-muted)]" />
        </button>
        <button
          onClick={handlePlayPause}
          disabled={fetching}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--vf-reader-primary-btn-bg)] text-[var(--vf-reader-primary-btn-text)] shadow-md transition hover:bg-[var(--vf-reader-primary-btn-hover-bg)] disabled:opacity-60"
        >
          {fetching ? (
            <Loader2 size={20} className="animate-spin" />
          ) : playbackState.isPlaying ? (
            <Pause size={20} />
          ) : (
            <Play size={20} className="ml-0.5" />
          )}
        </button>
        <button
          onClick={handleSkipForward15}
          className="rounded-full p-1 transition-colors hover:bg-[var(--vf-reader-hover-bg)]"
          title="Forward 15s"
        >
          <FastForward size={14} className="text-[var(--vf-reader-muted)]" />
        </button>
        <button
          onClick={handleNext}
          disabled={playbackState.currentChunkIndex >= playbackState.totalChunks - 1}
          className="rounded-full p-1.5 transition-colors hover:bg-[var(--vf-reader-hover-bg)] disabled:opacity-50"
        >
          <SkipForward size={18} className="text-[var(--vf-reader-panel-text)]" />
        </button>
      </div>

      <div className="flex items-center justify-between rounded bg-[var(--vf-reader-card-bg)] px-2 py-1 text-xs">
        <span className="text-[var(--vf-reader-muted)]">{ttsSettings.speed.toFixed(1)}x</span>
        <button
          onClick={cycleSleepTimer}
          className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors ${
            sleepMinutes !== null
              ? 'bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)]'
              : 'text-[var(--vf-reader-muted)] hover:text-[var(--vf-reader-panel-text)]'
          }`}
          title="Sleep timer"
          aria-label={sleepMinutes !== null ? `Sleep timer: ${Math.floor(sleepRemaining / 60)} minutes ${sleepRemaining % 60} seconds remaining` : 'Sleep timer: off'}
        >
          <Timer size={12} />
          {sleepMinutes !== null
            ? `${Math.floor(sleepRemaining / 60)}:${(sleepRemaining % 60).toString().padStart(2, '0')}`
            : 'Sleep'}
        </button>
      </div>

      <div className="flex items-center justify-between rounded bg-[var(--vf-reader-card-bg)] px-2 py-1 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--vf-reader-panel-text)]">
          <input
            type="checkbox"
            checked={playbackState.isPreloading}
            onChange={(e) =>
              onStateChange({
                ...playbackState,
                isPreloading: e.target.checked,
              })
            }
            className="accent-[var(--vf-reader-accent-text)]"
          />
          <span>Prepare Next Chunk</span>
        </label>
      </div>
    </div>
  );
}
