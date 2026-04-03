import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Download, RefreshCw, Rewind, FastForward, Loader2 } from 'lucide-react';
import { Visualizer } from './Visualizer';
import { shouldAutoplayFirstLiveChunk } from './audioPlayerAutoplay';
import {
  resolveSequentialLiveChunkIndexes,
  shouldHoldLiveElapsedBetweenChunks,
  shouldShowElapsedOnlyLiveTimeline,
} from './audioPlayerLiveHelpers';
import type { PlayerSourceType } from './audioPlayerLiveHelpers';

interface LiveAudioChunk {
  jobId: string;
  index: number;
  contentType?: string;
  durationMs?: number;
  audioBase64?: string;
}

interface AudioPlayerProps {
  audioUrl: string | null;
  backgroundMusicId?: string;
  initialSpeechVolume?: number;
  initialMusicVolume?: number;
  audioBuffer?: AudioBuffer | null;
  isGenerating?: boolean;
  liveChunks?: LiveAudioChunk[];
  isLiveStreaming?: boolean;
  autoPlayOnFirstChunk?: boolean;
  onReset: () => void;
}

interface LiveQueueItem {
  key: string;
  index: number;
  url: string;
  durationSec: number;
}

const readUiMotionLevel = (): 'off' | 'balanced' | 'rich' => {
  if (typeof document === 'undefined') return 'off';
  const value = document.body?.dataset.motion;
  return value === 'rich' || value === 'balanced' || value === 'off' ? value : 'off';
};

const base64ToBlobUrl = (audioBase64?: string, contentType?: string): string | null => {
  const safe = String(audioBase64 || '').trim();
  if (!safe) return null;
  try {
    const binary = atob(safe);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: contentType || 'audio/wav' });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
};

const isPlaybackInterruptedError = (error: unknown): boolean => {
  const name = String((error as any)?.name || '').trim().toLowerCase();
  const message = String((error as any)?.message || '').trim().toLowerCase();
  return (
    name === 'aborterror' ||
    message.includes('interrupted by a new load request') ||
    message.includes('play() request was interrupted') ||
    message.includes('the fetching process for the media resource was aborted')
  );
};

const isAutoplayBlockedError = (error: unknown): boolean => {
  const name = String((error as any)?.name || '').trim().toLowerCase();
  const message = String((error as any)?.message || '').trim().toLowerCase();
  return (
    name === 'notallowederror' ||
    message.includes('user didn\'t interact') ||
    message.includes('not allowed by the user agent')
  );
};

const TRANSPORT_SKIP_SECONDS = 10;

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
  isGenerating = false,
  liveChunks = [],
  isLiveStreaming = false,
  autoPlayOnFirstChunk = true,
  onReset,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(Boolean(isGenerating));
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playError, setPlayError] = useState<string | null>(null);
  const [activeSourceUrl, setActiveSourceUrl] = useState<string | null>(audioUrl);
  const [activeSourceType, setActiveSourceType] = useState<PlayerSourceType>(audioUrl ? 'final' : 'none');
  const [playedLiveChunkCount, setPlayedLiveChunkCount] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const previousGeneratingRef = useRef<boolean>(false);
  const liveQueueRef = useRef<LiveQueueItem[]>([]);
  const seenChunkKeysRef = useRef<Set<string>>(new Set());
  const liveChunkUrlsRef = useRef<string[]>([]);
  const pendingLiveChunksRef = useRef<Map<number, LiveQueueItem>>(new Map());
  const nextLiveChunkIndexRef = useRef(0);
  const liveOrderInitializedRef = useRef(false);
  const activeLiveChunkRef = useRef<LiveQueueItem | null>(null);
  const liveElapsedSecondsRef = useRef(0);
  const isSwitchingLiveSourceRef = useRef<boolean>(false);
  const pendingPlayModeRef = useRef<'none' | 'manual' | 'auto'>('none');
  const suppressTransientErrorUntilRef = useRef<number>(0);

  const markIntentionalSourceSwitch = useCallback((playAfterLoad: 'none' | 'manual' | 'auto' = 'none') => {
    pendingPlayModeRef.current = playAfterLoad;
    suppressTransientErrorUntilRef.current = Date.now() + 1800;
  }, []);

  const safePlay = useCallback(async (audio: HTMLAudioElement, mode: 'auto' | 'manual') => {
    try {
      await audio.play();
      return true;
    } catch (error: any) {
      if (isPlaybackInterruptedError(error)) {
        return false;
      }
      if (mode === 'auto' && isAutoplayBlockedError(error)) {
        setPlayError('Autoplay blocked by browser. Tap Play to listen.');
        return false;
      }
      if (mode === 'manual' && isAutoplayBlockedError(error)) {
        setPlayError('Playback blocked by browser. Tap Play once more.');
        return false;
      }
      const fallback = mode === 'manual' ? 'Playback failed. Please try again.' : 'Unable to start playback automatically.';
      setPlayError(String(error?.message || fallback));
      return false;
    }
  }, []);

  const revokeLiveChunkUrls = useCallback(() => {
    for (const url of liveChunkUrlsRef.current) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // noop
      }
    }
    liveChunkUrlsRef.current = [];
  }, []);

  const sumLiveQueueDuration = useCallback(() => {
    return liveQueueRef.current.reduce((total, item) => {
      const value = Number(item.durationSec || 0);
      return Number.isFinite(value) && value > 0 ? total + value : total;
    }, 0);
  }, []);

  const syncLiveTimelineDuration = useCallback((currentChunkDurationSec?: number) => {
    const candidate = Number((currentChunkDurationSec ?? activeLiveChunkRef.current?.durationSec) || 0);
    const activeChunkDuration = Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
    const knownTotal = liveElapsedSecondsRef.current + activeChunkDuration + sumLiveQueueDuration();
    if (knownTotal > 0) {
      setDuration((prev) => (knownTotal > prev ? knownTotal : prev));
      return;
    }
    if (liveElapsedSecondsRef.current > 0) {
      setDuration(liveElapsedSecondsRef.current);
    }
  }, [sumLiveQueueDuration]);

  const clearLiveQueue = useCallback(() => {
    liveQueueRef.current = [];
    pendingLiveChunksRef.current.clear();
    nextLiveChunkIndexRef.current = 0;
    liveOrderInitializedRef.current = false;
    seenChunkKeysRef.current.clear();
    isSwitchingLiveSourceRef.current = false;
    pendingPlayModeRef.current = 'none';
    activeLiveChunkRef.current = null;
    liveElapsedSecondsRef.current = 0;
    revokeLiveChunkUrls();
    setPlayedLiveChunkCount(0);
    setIsBuffering(false);
  }, [revokeLiveChunkUrls]);

  const drainPendingLiveChunksToQueue = useCallback(() => {
    const { readyIndexes, nextIndex } = resolveSequentialLiveChunkIndexes({
      pendingIndexes: pendingLiveChunksRef.current.keys(),
      nextIndex: nextLiveChunkIndexRef.current,
    });
    nextLiveChunkIndexRef.current = nextIndex;
    for (const index of readyIndexes) {
      const next = pendingLiveChunksRef.current.get(index);
      pendingLiveChunksRef.current.delete(index);
      if (!next) continue;
      liveQueueRef.current.push(next);
    }
    return readyIndexes.length;
  }, []);

  const playNextLiveChunk = useCallback(async (playAfterLoad: 'none' | 'manual' | 'auto' = 'none') => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isSwitchingLiveSourceRef.current) return;
    const next = liveQueueRef.current.shift();
    if (!next) {
      isSwitchingLiveSourceRef.current = false;
      activeLiveChunkRef.current = null;
      if (audioUrl) {
        liveElapsedSecondsRef.current = 0;
        setActiveSourceType('final');
        setActiveSourceUrl(audioUrl);
        setCurrentTime(0);
        setDuration(0);
        setIsBuffering(false);
        return;
      }
      const holdElapsed = shouldHoldLiveElapsedBetweenChunks({
        isGenerating,
        isLiveStreaming,
        hasFinalAudio: Boolean(audioUrl),
      });
      if (holdElapsed) {
        setActiveSourceType('live');
        setActiveSourceUrl(null);
        setCurrentTime(liveElapsedSecondsRef.current);
        syncLiveTimelineDuration(0);
        setIsBuffering(true);
        return;
      }
      liveElapsedSecondsRef.current = 0;
      setActiveSourceType('none');
      setActiveSourceUrl(null);
      setCurrentTime(0);
      setDuration(0);
      setIsBuffering(false);
      return;
    }

    isSwitchingLiveSourceRef.current = true;
    activeLiveChunkRef.current = next;
    markIntentionalSourceSwitch(playAfterLoad);
    setActiveSourceType('live');
    setActiveSourceUrl(next.url);
    setCurrentTime(liveElapsedSecondsRef.current);
    setIsBuffering(true);
    setPlayedLiveChunkCount((count) => count + 1);
    syncLiveTimelineDuration(next.durationSec);
    setPlayError(null);
  }, [audioUrl, isGenerating, isLiveStreaming, markIntentionalSourceSwitch, syncLiveTimelineDuration]);

  const hasPlayableAudio = Boolean(activeSourceUrl) || liveQueueRef.current.length > 0;
  const hasFinalAudio = Boolean(audioUrl);
  const seekEnabled = Boolean(hasFinalAudio && activeSourceType === 'final');
  const isLiveMode = Boolean(!hasFinalAudio && (activeSourceType === 'live' || isLiveStreaming || liveChunks.length > 0 || liveQueueRef.current.length > 0));
  const uiMotionLevel = readUiMotionLevel();
  const showLiveVisualizer = hasPlayableAudio && uiMotionLevel !== 'off';
  const seekProgressPct = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const liveQueueRemaining = isLiveMode ? liveQueueRef.current.length + (activeSourceType === 'live' && activeSourceUrl ? 1 : 0) : 0;
  const holdLiveElapsedBetweenChunks = shouldHoldLiveElapsedBetweenChunks({
    isGenerating,
    isLiveStreaming,
    hasFinalAudio,
  });
  const waitingForFirstChunk = isLiveStreaming && !hasFinalAudio && !activeSourceUrl && liveChunks.length === 0;
  const waitingForNextSentence = isLiveMode && holdLiveElapsedBetweenChunks && liveQueueRemaining === 0 && !activeSourceUrl;
  const statusLabel = waitingForFirstChunk
    ? 'Preparing first live sentence...'
    : isBuffering
      ? (activeSourceType === 'live' ? 'Loading next live sentence...' : 'Buffering audio...')
      : waitingForNextSentence
        ? 'Waiting for next live sentence...'
        : isLiveMode
          ? (isPlaying ? 'Playing live stream' : 'Live stream ready')
          : (isGenerating && !hasPlayableAudio ? 'Rendering final audio...' : isPlaying ? 'Playing final audio' : 'Ready to play');
  const queueLabel = isLiveMode
    ? (liveQueueRemaining > 0
      ? `${liveQueueRemaining} live chunk${liveQueueRemaining === 1 ? '' : 's'} ready`
      : isGenerating
        ? 'Streaming...'
        : `${Math.max(liveChunks.length, playedLiveChunkCount)} live chunk${Math.max(liveChunks.length, playedLiveChunkCount) === 1 ? '' : 's'} complete`)
    : (audioUrl ? 'Final mix loaded' : 'No audio yet');
  const showElapsedOnlyTimeline = shouldShowElapsedOnlyLiveTimeline({
    isLiveMode,
    activeSourceType,
    audioUrl,
  });

  useEffect(() => {
    return () => {
      clearLiveQueue();
    };
  }, [clearLiveQueue]);

  useEffect(() => {
    const startingNewLiveRun = isLiveStreaming && !audioUrl && liveChunks.length === 0;
    if (!startingNewLiveRun) return;
    clearLiveQueue();
    setActiveSourceType('none');
    setActiveSourceUrl(null);
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(true);
    setPlayError(null);
    pendingPlayModeRef.current = 'none';
  }, [audioUrl, clearLiveQueue, isLiveStreaming, liveChunks.length]);

  useEffect(() => {
    if (!audioUrl) {
      if (!isLiveStreaming && liveQueueRef.current.length === 0) {
        activeLiveChunkRef.current = null;
        liveElapsedSecondsRef.current = 0;
        setActiveSourceType('none');
        setActiveSourceUrl(null);
        setCurrentTime(0);
        setDuration(0);
        setIsBuffering(false);
      }
      return;
    }
    if (activeSourceType === 'final' && activeSourceUrl === audioUrl) return;
    const shouldResumePlayback = Boolean(audioRef.current && !audioRef.current.paused);
    activeLiveChunkRef.current = null;
    liveElapsedSecondsRef.current = 0;
    markIntentionalSourceSwitch(shouldResumePlayback ? 'auto' : 'none');
    setActiveSourceType('final');
    setActiveSourceUrl(audioUrl);
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(shouldResumePlayback);
    setPlayError(null);
  }, [activeSourceType, activeSourceUrl, audioUrl, isLiveStreaming, markIntentionalSourceSwitch]);

  useEffect(() => {
    if (!hasPlayableAudio) {
      setIsBuffering(Boolean(isGenerating || isLiveStreaming));
      return;
    }
    if (!isPlaying && activeSourceType === 'final') {
      setIsBuffering(false);
    }
  }, [activeSourceType, hasPlayableAudio, isGenerating, isLiveStreaming, isPlaying]);

  useEffect(() => {
    let added = 0;
    for (const chunk of liveChunks) {
      const chunkIndex = Math.max(0, Math.round(Number(chunk.index || 0)));
      const key = `${chunk.jobId}:${chunkIndex}`;
      if (seenChunkKeysRef.current.has(key)) continue;
      if (liveOrderInitializedRef.current && chunkIndex < nextLiveChunkIndexRef.current) {
        seenChunkKeysRef.current.add(key);
        continue;
      }
      const chunkUrl = base64ToBlobUrl(chunk.audioBase64, String(chunk.contentType || 'audio/wav'));
      if (!chunkUrl) continue;
      seenChunkKeysRef.current.add(key);
      liveChunkUrlsRef.current.push(chunkUrl);
      pendingLiveChunksRef.current.set(chunkIndex, {
        key,
        index: chunkIndex,
        url: chunkUrl,
        durationSec: Math.max(0, Number(chunk.durationMs || 0) / 1000),
      });
      added += 1;
    }
    if (added <= 0) return;
    if (!liveOrderInitializedRef.current) {
      const pendingIndexes = Array.from(pendingLiveChunksRef.current.keys());
      if (pendingIndexes.length > 0) {
        nextLiveChunkIndexRef.current = Math.min(...pendingIndexes);
        liveOrderInitializedRef.current = true;
      }
    }
    const drained = drainPendingLiveChunksToQueue();
    if (activeSourceType === 'live' || drained > 0) {
      syncLiveTimelineDuration();
    }
  }, [activeSourceType, drainPendingLiveChunksToQueue, liveChunks, syncLiveTimelineDuration]);

  useEffect(() => {
    if (!shouldAutoplayFirstLiveChunk({
      autoPlayOnFirstChunk,
      activeSourceType,
      isPlaying,
      liveQueueSize: liveQueueRef.current.length,
    })) return;
    void playNextLiveChunk('auto');
  }, [activeSourceType, autoPlayOnFirstChunk, isPlaying, liveChunks.length, playNextLiveChunk]);

  useEffect(() => {
    const justFinishedGenerating = previousGeneratingRef.current && !isGenerating;
    previousGeneratingRef.current = isGenerating;
    if (!audioUrl || !justFinishedGenerating || !audioRef.current) return;
    if (activeSourceUrl !== audioUrl) {
      const shouldResumePlayback = Boolean(!audioRef.current.paused);
      markIntentionalSourceSwitch(shouldResumePlayback ? 'auto' : 'none');
      setActiveSourceType('final');
      setActiveSourceUrl(audioUrl);
      setIsBuffering(shouldResumePlayback);
      return;
    }
  }, [activeSourceType, activeSourceUrl, audioUrl, isGenerating, markIntentionalSourceSwitch]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setPlayError(null);
    try {
      if (audio.paused) {
        if (!activeSourceUrl) {
          if (liveQueueRef.current.length > 0) {
            setIsBuffering(true);
            await playNextLiveChunk('manual');
            return;
          }
          if (audioUrl) {
            markIntentionalSourceSwitch('manual');
            setActiveSourceType('final');
            setActiveSourceUrl(audioUrl);
            setIsBuffering(true);
            return;
          }
          return;
        }
        setIsBuffering(true);
        await safePlay(audio, 'manual');
      } else {
        audio.pause();
        setIsBuffering(false);
      }
    } catch (error: any) {
      if (isPlaybackInterruptedError(error)) return;
      setPlayError(error?.message || 'Playback failed.');
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (activeSourceType === 'live') {
      const liveTime = Math.max(0, liveElapsedSecondsRef.current + audio.currentTime);
      setCurrentTime(liveTime);
      const audioDuration = Number(audio.duration || 0);
      const queuedDuration = Number(activeLiveChunkRef.current?.durationSec || 0);
      const resolvedChunkDuration = Number.isFinite(audioDuration) && audioDuration > 0
        ? Math.max(audioDuration, queuedDuration, audio.currentTime)
        : Math.max(queuedDuration, audio.currentTime);
      syncLiveTimelineDuration(resolvedChunkDuration);
      return;
    }
    setCurrentTime(audio.currentTime);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
  };

  const handleEnded = () => {
    const audio = audioRef.current;
    setIsPlaying(false);
    if (activeSourceType === 'live') {
      const audioDuration = Number(audio?.duration || 0);
      const chunkDuration = Number(activeLiveChunkRef.current?.durationSec || 0);
      const resolvedChunkDuration = chunkDuration > 0
        ? chunkDuration
        : (Number.isFinite(audioDuration) && audioDuration > 0 ? audioDuration : Math.max(0, Number(audio?.currentTime || 0)));
      if (resolvedChunkDuration > 0) {
        liveElapsedSecondsRef.current += resolvedChunkDuration;
      }
      activeLiveChunkRef.current = null;
      setCurrentTime(liveElapsedSecondsRef.current);
      syncLiveTimelineDuration(0);
      if (activeSourceUrl) {
        try {
          URL.revokeObjectURL(activeSourceUrl);
        } catch {
          // noop
        }
        liveChunkUrlsRef.current = liveChunkUrlsRef.current.filter((item) => item !== activeSourceUrl);
      }
      if (liveQueueRef.current.length > 0) {
        setIsBuffering(true);
        void playNextLiveChunk('auto');
        return;
      }
      if (audioUrl) {
        liveElapsedSecondsRef.current = 0;
        setActiveSourceType('final');
        setActiveSourceUrl(audioUrl);
        setIsBuffering(false);
        if (audio) {
          audio.currentTime = 0;
        }
        setCurrentTime(0);
        setDuration(0);
        return;
      }
      const holdElapsed = shouldHoldLiveElapsedBetweenChunks({
        isGenerating,
        isLiveStreaming,
        hasFinalAudio: Boolean(audioUrl),
      });
      if (holdElapsed) {
        setActiveSourceType('live');
        setActiveSourceUrl(null);
        setIsBuffering(true);
        setCurrentTime(liveElapsedSecondsRef.current);
        syncLiveTimelineDuration(0);
        return;
      }
      liveElapsedSecondsRef.current = 0;
      setActiveSourceType('none');
      setActiveSourceUrl(null);
      setIsBuffering(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    setCurrentTime(0);
  };

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!seekEnabled || !audioRef.current) return;
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      if (activeSourceType === 'live') {
        const liveTime = Math.max(0, liveElapsedSecondsRef.current + audio.currentTime);
        setCurrentTime(liveTime);
        const audioDuration = Number(audio.duration || 0);
        const queuedDuration = Number(activeLiveChunkRef.current?.durationSec || 0);
        const resolvedChunkDuration = Number.isFinite(audioDuration) && audioDuration > 0
          ? Math.max(audioDuration, queuedDuration, audio.currentTime)
          : Math.max(queuedDuration, audio.currentTime);
        syncLiveTimelineDuration(resolvedChunkDuration);
      } else {
        setCurrentTime(audio.currentTime);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [activeSourceType, isPlaying, syncLiveTimelineDuration]);

  if (!audioUrl && !isGenerating && liveChunks.length === 0 && activeSourceType === 'none') return null;

  return (
    <div className={`vf-live-player w-full rounded-3xl p-6 shadow-xl border border-gray-100 animate-in ${isLiveMode ? 'vf-live-player--streaming' : ''}`}>
      <div className="vf-live-player__header">
        <div className="vf-live-player__header-copy">
          <span className="vf-live-player__eyebrow">{isLiveMode ? 'Studio monitor' : 'Control room'}</span>
          <h3 className="vf-live-player__title">{isLiveMode ? 'Live Mix Preview' : 'Final Mix Preview'}</h3>
        </div>
        <span className="vf-live-player__header-chip">
          {isLiveMode ? 'Stream output' : 'Render output'}
        </span>
      </div>

      <audio
        ref={audioRef}
        src={activeSourceUrl || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadStart={() => setIsBuffering(Boolean(activeSourceUrl || isGenerating || isLiveStreaming))}
        onLoadedMetadata={(e) => {
          const nextDuration = Number(e.currentTarget.duration || 0);
          if (activeSourceType === 'live') {
            const queuedDuration = Number(activeLiveChunkRef.current?.durationSec || 0);
            const resolvedChunkDuration = Number.isFinite(nextDuration) && nextDuration > 0
              ? Math.max(nextDuration, queuedDuration)
              : queuedDuration;
            syncLiveTimelineDuration(resolvedChunkDuration);
          } else if (Number.isFinite(nextDuration) && nextDuration > 0) {
            setDuration(nextDuration);
          }
          const pendingPlayMode = pendingPlayModeRef.current;
          pendingPlayModeRef.current = 'none';
          if (pendingPlayMode !== 'none' && e.currentTarget.paused) {
            void safePlay(e.currentTarget, pendingPlayMode);
          }
          isSwitchingLiveSourceRef.current = false;
        }}
        onCanPlay={() => setIsBuffering(false)}
        onPlay={() => setIsPlaying(true)}
        onPlaying={() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }}
        onPause={() => {
          setIsPlaying(false);
          if (!audioRef.current?.ended) {
            setIsBuffering(false);
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onSeeking={() => setIsBuffering(true)}
        onSeeked={() => setIsBuffering(false)}
        onEnded={handleEnded}
        onError={(event) => {
          setIsPlaying(false);
          setIsBuffering(false);
          isSwitchingLiveSourceRef.current = false;
          pendingPlayModeRef.current = 'none';
          if (Date.now() < suppressTransientErrorUntilRef.current) return;
          const mediaCode = Number(event.currentTarget.error?.code || 0);
          if (mediaCode === 1) return; // MEDIA_ERR_ABORTED during expected source swaps.
          setPlayError('Unable to load generated audio.');
        }}
        crossOrigin="anonymous"
      />

      <div className="vf-live-player__viz h-32 rounded-2xl border border-gray-100 mb-6 flex items-center justify-center overflow-hidden relative">
         {isLiveMode && (
            <span className="vf-live-player__badge absolute left-3 top-3 z-20 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide">
              <span className="vf-live-player__badge-dot" />
              Live
            </span>
         )}
         {hasPlayableAudio && !isPlaying && currentTime === 0 && !isGenerating && activeSourceType === 'final' && (
             <div className="vf-live-player__viz-copy absolute z-10">
                 <span className="vf-live-player__viz-title">Preview ready</span>
                 <span className="vf-live-player__viz-subtitle">Press play to audition the latest render.</span>
             </div>
         )}
         {showLiveVisualizer ? (
           <Visualizer audioElement={audioRef.current} isPlaying={isPlaying} height={128} />
         ) : (
           <div className="vf-live-player__viz-fallback h-full w-full" />
         )}
      </div>

      <div className="vf-live-player__status" aria-live="polite">
        <div className={`vf-live-player__status-pill ${isBuffering ? 'vf-live-player__status-pill--buffering' : isLiveMode ? 'vf-live-player__status-pill--live' : 'vf-live-player__status-pill--ready'}`}>
          {isBuffering ? (
            <Loader2 size={13} className="vf-live-player__status-icon" />
          ) : (
            <span className="vf-live-player__status-dot" />
          )}
          <span>{statusLabel}</span>
        </div>
        <span className="vf-live-player__status-metric">{queueLabel}</span>
      </div>

      <div className="vf-live-player__transport">
         <div className="vf-live-player__timeline flex items-center gap-3 text-xs font-mono text-gray-500">
            <span>{formatTime(hasPlayableAudio ? currentTime : 0)}</span>
            <div className="vf-live-player__seek-wrap relative flex-1">
              <span className="vf-live-player__seek-fill absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ width: `${seekProgressPct}%` }} />
              <input
                  type="range"
                  min="0"
                  max={duration > 0 ? duration : 1}
                  value={hasPlayableAudio ? currentTime : 0}
                  onChange={handleSeek}
                  disabled={!seekEnabled}
                  aria-label="Playback position"
                  aria-valuetext={`${formatTime(hasPlayableAudio ? currentTime : 0)} of ${formatTime(duration > 0 ? duration : 0)}`}
                  className={`vf-live-player__seek relative z-10 w-full appearance-none ${seekEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              />
            </div>
            {!showElapsedOnlyTimeline && (
              <span>{formatTime(duration > 0 ? duration : 0)}</span>
            )}
            {!showElapsedOnlyTimeline && (
              <span className="min-w-10 text-right text-[11px] font-semibold text-indigo-500">{Math.round(seekProgressPct)}%</span>
            )}
         </div>

         <div className="vf-live-player__control-row">
            <div className="vf-live-player__transport-controls">
                <button
                    type="button"
                    onClick={() => {
                      if (!audioRef.current || !seekEnabled) return;
                      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - TRANSPORT_SKIP_SECONDS);
                    }}
                    disabled={!seekEnabled}
                    aria-label={`Skip back ${TRANSPORT_SKIP_SECONDS} seconds`}
                    className="vf-live-player__step p-2 text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
                >
                    <Rewind size={20} />
                </button>

                <button
                    type="button"
                    onClick={togglePlay}
                    disabled={!hasPlayableAudio}
                    className={`vf-live-player__play w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] transform active:scale-95 ${
                      isPlaying ? 'vf-live-player__play--playing' : ''
                    } ${isLiveMode ? 'vf-live-player__play--live' : ''} ${isBuffering ? 'vf-live-player__play--buffering' : ''} ${!hasPlayableAudio ? 'vf-live-player__play--disabled' : ''}`}
                    aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                >
                    {isBuffering && !isPlaying ? (
                      <Loader2 size={22} className="animate-spin" />
                    ) : isPlaying ? (
                      <Pause size={24} fill="currentColor" />
                    ) : (
                      <Play size={24} fill="currentColor" className="ml-1" />
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => {
                      if (!audioRef.current || !seekEnabled) return;
                      audioRef.current.currentTime = Math.min(duration || audioRef.current.currentTime + TRANSPORT_SKIP_SECONDS, audioRef.current.currentTime + TRANSPORT_SKIP_SECONDS);
                    }}
                    disabled={!seekEnabled}
                    aria-label={`Skip forward ${TRANSPORT_SKIP_SECONDS} seconds`}
                    className="vf-live-player__step p-2 text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
                >
                    <FastForward size={20} />
                </button>
            </div>

            <div className="vf-live-player__transport-actions">
                <a
                    href={audioUrl || undefined}
                    download={`v_flow_ai_${Date.now()}.wav`}
                    onClick={(event) => {
                      if (!audioUrl) {
                        event.preventDefault();
                      }
                    }}
                    tabIndex={audioUrl ? 0 : -1}
                    aria-disabled={!audioUrl}
                    aria-label={audioUrl ? 'Download audio' : 'Download unavailable until audio is generated'}
                    className={`vf-live-player__save px-4 py-2 rounded-xl bg-gray-50 text-gray-700 font-bold text-xs transition-colors flex items-center gap-2 ${
                      audioUrl ? 'hover:bg-gray-100' : 'pointer-events-none opacity-40'
                    }`}
                >
                    <Download size={14} /> Save
                </a>
                <button
                    type="button"
                    onClick={onReset}
                    className="vf-live-player__reset p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Reset / New Generation"
                    aria-label="Reset and start new generation"
                >
                    <RefreshCw size={18} />
                </button>
             </div>
         </div>
         {playError && (
            <div className="text-xs text-rose-600 font-medium">{playError}</div>
         )}
      </div>
    </div>
  );
};
