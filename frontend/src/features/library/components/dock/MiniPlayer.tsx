'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FastForward, Loader2, Pause, Play, Rewind, SkipBack, SkipForward, Timer } from 'lucide-react';

import type { PlaybackState, TtsSettings } from '../../model/types';
import type {
  AudioNovelChapterAudioResponse,
  AudioNovelLiveClientMessage,
  AudioNovelLiveServerMessage,
} from '../../../../server/audioNovel/contracts';
import { API_ROUTES } from '../../../../shared/api/routes';

interface MiniPlayerProps {
  bookId: string | number;
  chapterId?: string | undefined;
  publishedMode?: boolean;
  playbackState: PlaybackState;
  onStateChange: (state: PlaybackState) => void;
  ttsSettings: TtsSettings;
  sourceText?: string;
  bookText?: string;
  translationTargetLanguage?: string | undefined;
  isCompact?: boolean;
  theme?: string;
}

const createWebSocketUrl = (path: string): string => {
  if (typeof window === 'undefined') return path;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
};

export function MiniPlayer({
  bookId,
  chapterId,
  publishedMode = false,
  playbackState,
  onStateChange,
  ttsSettings,
  sourceText,
  bookText,
  translationTargetLanguage,
  isCompact = false,
}: MiniPlayerProps) {
  const [progress, setProgress] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [sleepRemaining, setSleepRemaining] = useState<number>(0);

  const sleepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackStateRef = useRef(playbackState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextAudioTimeRef = useRef(0);
  const liveCompleteTimerRef = useRef<number | null>(null);
  const publishedAudioRef = useRef<AudioNovelChapterAudioResponse | null>(null);
  const publishedAudioPromiseRef = useRef<Promise<AudioNovelChapterAudioResponse | null> | null>(null);

  playbackStateRef.current = playbackState;

  const narrationText = useMemo(() => String(sourceText || bookText || '').trim(), [bookText, sourceText]);
  const transportMode = publishedMode && chapterId ? 'published' : 'live';
  const requestKey = useMemo(() => JSON.stringify({
    bookId: String(bookId),
    chapterId: String(chapterId || ''),
    text: narrationText,
    language: ttsSettings.language,
    voice: ttsSettings.voice,
    speed: Number(ttsSettings.speed || 1).toFixed(2),
    targetLanguage: translationTargetLanguage || '',
    transportMode,
  }), [bookId, chapterId, narrationText, transportMode, translationTargetLanguage, ttsSettings.language, ttsSettings.speed, ttsSettings.voice]);

  const resetPublishedAudioCache = useCallback(() => {
    publishedAudioRef.current = null;
    publishedAudioPromiseRef.current = null;
  }, []);

  const stopLivePlayback = useCallback(() => {
    if (liveCompleteTimerRef.current) {
      window.clearTimeout(liveCompleteTimerRef.current);
      liveCompleteTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    nextAudioTimeRef.current = 0;
  }, []);

  useEffect(() => {
    resetPublishedAudioCache();
    stopLivePlayback();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setProgress(0);
    onStateChange({
      ...playbackStateRef.current,
      currentChunkIndex: 0,
      currentTime: 0,
      totalChunks: 1,
      isPlaying: false,
    });
  }, [onStateChange, requestKey, resetPublishedAudioCache, stopLivePlayback]);

  const updateFromPublishedAudio = useCallback((audio: HTMLAudioElement, meta: AudioNovelChapterAudioResponse) => {
    if (!audio.duration || !Number.isFinite(audio.duration)) {
      return;
    }
    const totalRuns = meta.generated ? Math.max(1, Number(meta.totalRuns || 1)) : 1;
    const fraction = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
    const runIndex = Math.min(totalRuns - 1, Math.max(0, Math.floor(fraction * totalRuns)));
    setProgress(fraction * 100);
    onStateChange({
      ...playbackStateRef.current,
      currentChunkIndex: runIndex,
      currentTime: audio.currentTime,
      isPlaying: !audio.paused,
      totalChunks: totalRuns,
      chunkDuration: audio.duration / totalRuns,
    });
  }, [onStateChange]);

  const loadPublishedAudio = useCallback(async (): Promise<AudioNovelChapterAudioResponse | null> => {
    if (!publishedMode || !chapterId) return null;
    if (publishedAudioRef.current) {
      return publishedAudioRef.current;
    }
    if (publishedAudioPromiseRef.current) {
      return publishedAudioPromiseRef.current;
    }

    const promise = (async () => {
      const response = await fetch(API_ROUTES.library.bookChapterAudio(bookId, chapterId), {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as AudioNovelChapterAudioResponse | { error?: string } | null;
      if (!response.ok) {
        throw new Error(String((payload as { error?: string } | null)?.error || 'Chapter audio lookup failed.'));
      }
      const normalized = payload as AudioNovelChapterAudioResponse;
      publishedAudioRef.current = normalized;
      return normalized;
    })().finally(() => {
      publishedAudioPromiseRef.current = null;
    });

    publishedAudioPromiseRef.current = promise;
    return promise;
  }, [bookId, chapterId, publishedMode]);

  const ensurePublishedAudioElement = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }, []);

  const playPublishedAudio = useCallback(async () => {
    if (!chapterId) return;
    setFetching(true);
    try {
      const payload = await loadPublishedAudio();
      if (!payload?.generated || !payload.audioUrl) {
        throw new Error('Published chapter audio is not generated yet.');
      }

      const audio = ensurePublishedAudioElement();
      if (audio.src !== payload.audioUrl) {
        audio.pause();
        audio.src = payload.audioUrl;
        audio.preload = 'auto';
      }

      audio.ontimeupdate = () => updateFromPublishedAudio(audio, payload);
      audio.onended = () => {
        setProgress(100);
        onStateChange({
          ...playbackStateRef.current,
          currentTime: 0,
          currentChunkIndex: Math.max(0, (payload.totalRuns || 1) - 1),
          isPlaying: false,
        });
      };
      audio.onerror = () => {
        onStateChange({ ...playbackStateRef.current, isPlaying: false });
      };

      onStateChange({
        ...playbackStateRef.current,
        isPlaying: true,
        totalChunks: Math.max(1, payload.totalRuns || 1),
      });
      await audio.play();
      updateFromPublishedAudio(audio, payload);
    } finally {
      setFetching(false);
    }
  }, [chapterId, ensurePublishedAudioElement, loadPublishedAudio, onStateChange, updateFromPublishedAudio]);

  const decodeLivePcmChunk = useCallback((raw: ArrayBuffer) => {
    if (!audioContextRef.current) return;
    if (raw.byteLength < 100) return;
    const int16 = new Int16Array(raw);
    const float32 = new Float32Array(int16.length);
    for (let index = 0; index < int16.length; index += 1) {
      float32[index] = int16[index]! / 32768;
    }

    const audioContext = audioContextRef.current;
    const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    const now = audioContext.currentTime;
    const startAt = Math.max(now + 0.04, nextAudioTimeRef.current || now + 0.04);
    source.start(startAt);
    nextAudioTimeRef.current = startAt + audioBuffer.duration;
  }, []);

  const startLivePlayback = useCallback(async () => {
    if (!narrationText) return;
    stopLivePlayback();
    setFetching(true);

    const audioContext = new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = audioContext;
    nextAudioTimeRef.current = 0;

    const socket = new WebSocket(createWebSocketUrl(API_ROUTES.library.audioNovelWebSocket));
    socket.binaryType = 'arraybuffer';
    wsRef.current = socket;

    socket.onopen = () => {
      const message: AudioNovelLiveClientMessage = {
        type: 'stdio',
        text: narrationText,
        ...(publishedMode && chapterId ? { chapterId } : {}),
        ...(bookId ? { bookId: String(bookId) } : {}),
      };
      socket.send(JSON.stringify(message));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        decodeLivePcmChunk(event.data as ArrayBuffer);
        return;
      }

      const message = JSON.parse(event.data) as AudioNovelLiveServerMessage;
      if ('error' in message) {
        setFetching(false);
        onStateChange({ ...playbackStateRef.current, isPlaying: false });
        return;
      }
      if ('status' in message && message.status === 'start') {
        setFetching(false);
        onStateChange({
          ...playbackStateRef.current,
          isPlaying: true,
          currentChunkIndex: 0,
          currentTime: 0,
          totalChunks: Math.max(1, message.totalRuns),
        });
        return;
      }
      if ('type' in message && message.type === 'run-meta') {
        onStateChange({
          ...playbackStateRef.current,
          isPlaying: true,
          currentChunkIndex: message.runIndex,
          currentTime: Math.max(0, audioContext.currentTime),
          totalChunks: Math.max(1, message.total),
        });
        return;
      }
      if ('done' in message && message.done) {
        const remainingMs = Math.max(0, (nextAudioTimeRef.current - audioContext.currentTime) * 1000);
        if (liveCompleteTimerRef.current) {
          window.clearTimeout(liveCompleteTimerRef.current);
        }
        liveCompleteTimerRef.current = window.setTimeout(() => {
          onStateChange({
            ...playbackStateRef.current,
            isPlaying: false,
            currentTime: 0,
          });
          stopLivePlayback();
        }, remainingMs + 80);
      }
    };

    socket.onerror = () => {
      setFetching(false);
      onStateChange({ ...playbackStateRef.current, isPlaying: false });
      stopLivePlayback();
    };
    socket.onclose = () => {
      if (fetching) {
        setFetching(false);
      }
    };
  }, [bookId, chapterId, decodeLivePcmChunk, fetching, narrationText, onStateChange, publishedMode, stopLivePlayback]);

  useEffect(() => {
    return () => {
      stopLivePlayback();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      if (sleepTimerRef.current) {
        clearInterval(sleepTimerRef.current);
      }
    };
  }, [stopLivePlayback]);

  useEffect(() => {
    if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    if (sleepMinutes === null) {
      setSleepRemaining(0);
      return;
    }

    const end = Date.now() + sleepMinutes * 60 * 1000;
    setSleepRemaining(sleepMinutes * 60);

    sleepTimerRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setSleepRemaining(left);
      if (left <= 0) {
        if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
        setSleepMinutes(null);
        const audio = audioRef.current;
        audio?.pause();
        stopLivePlayback();
        onStateChange({ ...playbackStateRef.current, isPlaying: false });
      }
    }, 1000);

    return () => {
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    };
  }, [onStateChange, sleepMinutes, stopLivePlayback]);

  const handlePlayPause = useCallback(() => {
    if (transportMode === 'published') {
      const audio = ensurePublishedAudioElement();
      if (playbackStateRef.current.isPlaying && !audio.paused) {
        audio.pause();
        onStateChange({ ...playbackStateRef.current, isPlaying: false });
        return;
      }
      void playPublishedAudio().catch(() => {
        if (narrationText) {
          void startLivePlayback();
        }
      });
      return;
    }

    if (playbackStateRef.current.isPlaying) {
      stopLivePlayback();
      onStateChange({ ...playbackStateRef.current, isPlaying: false });
      return;
    }
    void startLivePlayback();
  }, [ensurePublishedAudioElement, narrationText, onStateChange, playPublishedAudio, startLivePlayback, stopLivePlayback, transportMode]);

  const handleSkipForward15 = useCallback(() => {
    if (transportMode !== 'published') return;
    const audio = audioRef.current;
    if (audio && audio.duration && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.currentTime + 15, audio.duration);
    }
  }, [transportMode]);

  const handleSkipBack15 = useCallback(() => {
    if (transportMode !== 'published') return;
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = Math.max(audio.currentTime - 15, 0);
    }
  }, [transportMode]);

  const cycleSleepTimer = () => {
    const options = [null, 5, 15, 30, 60];
    const currentIdx = options.indexOf(sleepMinutes);
    setSleepMinutes(options[(currentIdx + 1) % options.length] ?? null);
  };

  const seekToRelativeChunk = useCallback((direction: -1 | 1) => {
    if (transportMode !== 'published') return;
    const audio = audioRef.current;
    if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return;
    const totalChunks = Math.max(1, playbackStateRef.current.totalChunks || 1);
    const nextIndex = Math.min(totalChunks - 1, Math.max(0, playbackStateRef.current.currentChunkIndex + direction));
    audio.currentTime = (nextIndex / totalChunks) * audio.duration;
    onStateChange({
      ...playbackStateRef.current,
      currentChunkIndex: nextIndex,
      currentTime: audio.currentTime,
    });
  }, [onStateChange, transportMode]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const canSeekByChunk = transportMode === 'published';

  if (isCompact) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => seekToRelativeChunk(-1)}
          disabled={!canSeekByChunk || playbackState.currentChunkIndex === 0}
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
          onClick={() => seekToRelativeChunk(1)}
          disabled={!canSeekByChunk || playbackState.currentChunkIndex >= playbackState.totalChunks - 1}
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
          onChange={(event) => {
            const value = Number(event.target.value);
            setProgress(value);
            const audio = audioRef.current;
            if (transportMode === 'published' && audio && audio.duration && Number.isFinite(audio.duration)) {
              audio.currentTime = (value / 100) * audio.duration;
            }
          }}
          className="vf-reader-slider w-full cursor-pointer"
        />
      </div>

      <div className="flex items-center justify-center gap-1.5">
        <button
          onClick={() => seekToRelativeChunk(-1)}
          disabled={!canSeekByChunk || playbackState.currentChunkIndex === 0}
          className="rounded-full p-1.5 transition-colors hover:bg-[var(--vf-reader-hover-bg)] disabled:opacity-50"
        >
          <SkipBack size={18} className="text-[var(--vf-reader-panel-text)]" />
        </button>
        <button
          onClick={handleSkipBack15}
          disabled={transportMode !== 'published'}
          className="rounded-full p-1 transition-colors hover:bg-[var(--vf-reader-hover-bg)] disabled:opacity-40"
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
          disabled={transportMode !== 'published'}
          className="rounded-full p-1 transition-colors hover:bg-[var(--vf-reader-hover-bg)] disabled:opacity-40"
          title="Forward 15s"
        >
          <FastForward size={14} className="text-[var(--vf-reader-muted)]" />
        </button>
        <button
          onClick={() => seekToRelativeChunk(1)}
          disabled={!canSeekByChunk || playbackState.currentChunkIndex >= playbackState.totalChunks - 1}
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
            onChange={(event) =>
              onStateChange({
                ...playbackState,
                isPreloading: event.target.checked,
              })
            }
            className="accent-[var(--vf-reader-accent-text)]"
          />
          <span>{transportMode === 'published' ? 'Signed URL Playback' : 'Live WebSocket Playback'}</span>
        </label>
      </div>
    </div>
  );
}
