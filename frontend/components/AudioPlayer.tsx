import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Download, RefreshCw, SkipBack, SkipForward } from 'lucide-react';
import { Visualizer } from './Visualizer';

interface LiveAudioChunk {
  jobId: string;
  index: number;
  contentType?: string;
  durationMs?: number;
  audioBase64: string;
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
  liveAutoPlay?: boolean;
  onReset: () => void;
}

type PlayerSourceType = 'none' | 'live' | 'final';

interface LiveQueueItem {
  key: string;
  url: string;
  durationSec: number;
}

const base64ToBlobUrl = (audioBase64: string, contentType: string): string | null => {
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

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
  isGenerating = false,
  liveChunks = [],
  isLiveStreaming = false,
  liveAutoPlay = true,
  onReset,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playError, setPlayError] = useState<string | null>(null);
  const [activeSourceUrl, setActiveSourceUrl] = useState<string | null>(audioUrl);
  const [activeSourceType, setActiveSourceType] = useState<PlayerSourceType>(audioUrl ? 'final' : 'none');

  const audioRef = useRef<HTMLAudioElement>(null);
  const previousGeneratingRef = useRef<boolean>(false);
  const liveQueueRef = useRef<LiveQueueItem[]>([]);
  const seenChunkKeysRef = useRef<Set<string>>(new Set());
  const liveChunkUrlsRef = useRef<string[]>([]);
  const isSwitchingLiveSourceRef = useRef<boolean>(false);
  const pendingAutoPlayRef = useRef<boolean>(false);
  const suppressTransientErrorUntilRef = useRef<number>(0);

  const markIntentionalSourceSwitch = useCallback(() => {
    pendingAutoPlayRef.current = true;
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

  const clearLiveQueue = useCallback(() => {
    liveQueueRef.current = [];
    seenChunkKeysRef.current.clear();
    isSwitchingLiveSourceRef.current = false;
    pendingAutoPlayRef.current = false;
    revokeLiveChunkUrls();
  }, [revokeLiveChunkUrls]);

  const playNextLiveChunk = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isSwitchingLiveSourceRef.current) return;
    const next = liveQueueRef.current.shift();
    if (!next) {
      isSwitchingLiveSourceRef.current = false;
      if (audioUrl) {
        setActiveSourceType('final');
        setActiveSourceUrl(audioUrl);
        setCurrentTime(0);
      }
      return;
    }

    isSwitchingLiveSourceRef.current = true;
    markIntentionalSourceSwitch();
    setActiveSourceType('live');
    setActiveSourceUrl(next.url);
    setCurrentTime(0);
    if (next.durationSec > 0) {
      setDuration(next.durationSec);
    }
    setPlayError(null);
  }, [audioUrl, markIntentionalSourceSwitch]);

  const hasPlayableAudio = Boolean(activeSourceUrl) || liveQueueRef.current.length > 0;
  const seekEnabled = Boolean(audioUrl && activeSourceType === 'final');
  const isLiveMode = Boolean(activeSourceType === 'live' || isLiveStreaming || (liveChunks.length > 0 && !audioUrl));
  const seekProgressPct = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;

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
    setPlayError(null);
    pendingAutoPlayRef.current = false;
  }, [audioUrl, clearLiveQueue, isLiveStreaming, liveChunks.length]);

  useEffect(() => {
    if (!audioUrl) {
      if (!isLiveStreaming && liveQueueRef.current.length === 0) {
        setActiveSourceType('none');
        setActiveSourceUrl(null);
        setCurrentTime(0);
        setDuration(0);
      }
      return;
    }
    if (activeSourceType !== 'live' && liveQueueRef.current.length === 0) {
      setActiveSourceType('final');
      setActiveSourceUrl(audioUrl);
    }
  }, [activeSourceType, audioUrl, isLiveStreaming]);

  useEffect(() => {
    const sorted = [...liveChunks].sort((a, b) => a.index - b.index);
    let added = 0;
    for (const chunk of sorted) {
      const key = `${chunk.jobId}:${chunk.index}`;
      if (seenChunkKeysRef.current.has(key)) continue;
      const chunkUrl = base64ToBlobUrl(chunk.audioBase64, String(chunk.contentType || 'audio/wav'));
      if (!chunkUrl) continue;
      seenChunkKeysRef.current.add(key);
      liveChunkUrlsRef.current.push(chunkUrl);
      liveQueueRef.current.push({
        key,
        url: chunkUrl,
        durationSec: Math.max(0, Number(chunk.durationMs || 0) / 1000),
      });
      added += 1;
    }
    if (added <= 0) return;
    if (!liveAutoPlay) return;
    const audio = audioRef.current;
    const shouldStartLivePlayback = !audio || audio.paused || activeSourceType !== 'live';
    if (shouldStartLivePlayback) {
      void playNextLiveChunk();
    }
  }, [activeSourceType, liveAutoPlay, liveChunks, playNextLiveChunk]);

  useEffect(() => {
    const justFinishedGenerating = previousGeneratingRef.current && !isGenerating;
    previousGeneratingRef.current = isGenerating;
    if (!audioUrl || !justFinishedGenerating || !audioRef.current) return;
    if (activeSourceType === 'live') return;
    if (activeSourceUrl !== audioUrl) {
      markIntentionalSourceSwitch();
      setActiveSourceType('final');
      setActiveSourceUrl(audioUrl);
      return;
    }
    void safePlay(audioRef.current, 'auto');
  }, [activeSourceType, activeSourceUrl, audioUrl, isGenerating, markIntentionalSourceSwitch, safePlay]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setPlayError(null);
    try {
      if (audio.paused) {
        if (!activeSourceUrl) {
          if (liveQueueRef.current.length > 0) {
            await playNextLiveChunk();
            return;
          }
          if (audioUrl) {
            markIntentionalSourceSwitch();
            setActiveSourceType('final');
            setActiveSourceUrl(audioUrl);
            return;
          }
          return;
        }
        await safePlay(audio, 'manual');
      } else {
        audio.pause();
      }
    } catch (error: any) {
      if (isPlaybackInterruptedError(error)) return;
      setPlayError(error?.message || 'Playback failed.');
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
  };

  const handleEnded = () => {
    const audio = audioRef.current;
    setIsPlaying(false);
    setCurrentTime(0);
    if (activeSourceType === 'live') {
      if (activeSourceUrl) {
        try {
          URL.revokeObjectURL(activeSourceUrl);
        } catch {
          // noop
        }
        liveChunkUrlsRef.current = liveChunkUrlsRef.current.filter((item) => item !== activeSourceUrl);
      }
      if (liveQueueRef.current.length > 0) {
        void playNextLiveChunk();
        return;
      }
      if (audioUrl) {
        setActiveSourceType('final');
        setActiveSourceUrl(audioUrl);
        if (audio) {
          audio.currentTime = 0;
        }
        return;
      }
      setActiveSourceType('none');
      setActiveSourceUrl(null);
    }
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

  if (!audioUrl && !isGenerating && liveChunks.length === 0 && activeSourceType === 'none') return null;

  return (
    <div className={`vf-live-player w-full rounded-3xl p-6 shadow-xl border border-gray-100 animate-in ${isLiveMode ? 'vf-live-player--streaming' : ''}`}>
      <audio
        ref={audioRef}
        src={activeSourceUrl || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => {
          const nextDuration = Number(e.currentTarget.duration || 0);
          if (Number.isFinite(nextDuration) && nextDuration > 0) {
            setDuration(nextDuration);
          }
          const shouldAutoPlay = pendingAutoPlayRef.current;
          pendingAutoPlayRef.current = false;
          if (shouldAutoPlay && e.currentTarget.paused) {
            void safePlay(e.currentTarget, 'auto');
          }
          isSwitchingLiveSourceRef.current = false;
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        onError={(event) => {
          setIsPlaying(false);
          isSwitchingLiveSourceRef.current = false;
          pendingAutoPlayRef.current = false;
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
             <div className="absolute text-gray-400 text-sm font-medium flex items-center gap-2 z-10">
                 Press Play to Listen
             </div>
         )}
         {hasPlayableAudio ? (
           <Visualizer audioElement={audioRef.current} isPlaying={isPlaying} height={128} />
         ) : (
           <div className="h-full w-full bg-gradient-to-r from-indigo-50/60 to-purple-50/60" />
         )}
      </div>

      <div className="flex flex-col gap-4">
         <div className="flex items-center gap-3 text-xs font-mono text-gray-500">
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
                  className={`vf-live-player__seek relative z-10 w-full appearance-none ${seekEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              />
            </div>
            <span>{formatTime(duration > 0 ? duration : 0)}</span>
         </div>

         <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <button
                    onClick={() => {
                      if (!audioRef.current || !seekEnabled) return;
                      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                    }}
                    disabled={!seekEnabled}
                    className="vf-live-player__step p-2 text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
                >
                    <SkipBack size={20} />
                </button>

                <button
                    onClick={togglePlay}
                    disabled={!hasPlayableAudio}
                    className={`vf-live-player__play w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all transform active:scale-95 ${
                      isPlaying ? 'vf-live-player__play--playing' : ''
                    } ${isLiveMode ? 'vf-live-player__play--live' : ''} ${!hasPlayableAudio ? 'vf-live-player__play--disabled' : ''}`}
                    aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                >
                    {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                </button>

                <button
                    onClick={() => {
                      if (!audioRef.current || !seekEnabled) return;
                      audioRef.current.currentTime = Math.min(duration || audioRef.current.currentTime + 5, audioRef.current.currentTime + 5);
                    }}
                    disabled={!seekEnabled}
                    className="vf-live-player__step p-2 text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
                >
                    <SkipForward size={20} />
                </button>
            </div>

            <div className="flex items-center gap-2">
                <a
                    href={audioUrl || '#'}
                    download={`voiceflow_${Date.now()}.wav`}
                    className={`vf-live-player__save px-4 py-2 rounded-xl bg-gray-50 text-gray-700 font-bold text-xs transition-colors flex items-center gap-2 ${
                      audioUrl ? 'hover:bg-gray-100' : 'pointer-events-none opacity-40'
                    }`}
                >
                    <Download size={14} /> Save
                </a>
                <button
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
