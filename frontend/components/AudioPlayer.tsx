import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Play, Pause, Download, RefreshCw, SkipBack, SkipForward, Volume2, Loader2, Check, AlertCircle } from 'lucide-react';
import { Visualizer } from './Visualizer';
import { shouldAutoplayFirstLiveChunk, shouldAutoplayGeneratedAudio } from './audioPlayerAutoplay';
import {
  advanceLivePlaybackState,
  appendLivePlaybackChunks,
  createLivePlaybackState,
  resetLivePlaybackState,
  resolveLivePlaybackSessionKey,
} from './audioPlayerLiveHelpers';
import { firebaseAuth } from '../services/firebaseClient';
import {
  connectDriveIdentity,
  getDriveProviderToken,
  reconsentDriveScopes,
} from '../services/driveAuthService';

export interface LiveAudioChunk {
  jobId: string;
  index: number;
  sessionEpoch?: number;
  contentType?: string;
  durationMs?: number;
  audioBase64?: string;
  audioObjectUrl?: string;
}

interface AudioPlayerProps {
  audioUrl: string | null;
  liveChunks?: LiveAudioChunk[];
  playbackSessionKey?: string;
  isLiveStreaming?: boolean;
  isGenerating?: boolean;
  autoPlayOnFirstChunk?: boolean;
  autoPlayGeneratedAudio?: boolean;
  autoplayNonce?: number;
  onReset: () => void;
}

const TRANSPORT_SKIP_SECONDS = 5;

const GoogleDriveIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
    <path fill="#0F9D58" d="M8.2 3.5h7.4l6.1 10.6h-7.4z" />
    <path fill="#FFC107" d="M2.1 14.1 8.2 3.5l3.7 6.4-6.1 10.6z" />
    <path fill="#4285F4" d="M8.2 20.5h12.2l-3.7-6.4H4.5z" />
  </svg>
);

const base64ToBlobUrl = (audioBase64?: string, contentType?: string): string | null => {
  const safe = String(audioBase64 || '').trim();
  if (!safe) return null;
  try {
    const binary = atob(safe);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: contentType || 'audio/wav' });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
};

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
  liveChunks = [],
  playbackSessionKey = '',
  isLiveStreaming = false,
  isGenerating = false,
  autoPlayOnFirstChunk = true,
  autoPlayGeneratedAudio = true,
  autoplayNonce = 0,
  onReset,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(Boolean(isGenerating));
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [driveNotice, setDriveNotice] = useState('');
  const [driveNoticeTone, setDriveNoticeTone] = useState<'success' | 'error'>('success');
  const [livePlaybackState, setLivePlaybackState] = useState(() => createLivePlaybackState());

  const audioRef = useRef<HTMLAudioElement>(null);
  const livePlaybackStateRef = useRef(livePlaybackState);
  const lastAutoplayedLiveIndexRef = useRef(-1);
  const lastConsumedAutoplayNonceRef = useRef(0);

  const revokeObjectUrls = useCallback((urls: string[]) => {
    urls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore invalid or already-revoked object URLs.
      }
    });
  }, []);

  useEffect(() => {
    livePlaybackStateRef.current = livePlaybackState;
  }, [livePlaybackState]);

  useEffect(() => {
    if (isGenerating) {
      setIsBuffering(true);
    }
  }, [isGenerating]);

  const liveIndex = livePlaybackState.currentEntry?.index ?? -1;
  const activeUrl = livePlaybackState.currentEntry?.url || audioUrl;
  const activeSourceType = liveIndex >= 0 ? 'live' : (activeUrl ? 'final' : 'none');

  useEffect(() => {
    const nextSessionKey = String(playbackSessionKey || '').trim();
    setLivePlaybackState((previousState) => {
      if (previousState.sessionKey === nextSessionKey) {
        return previousState;
      }
      const reset = resetLivePlaybackState(previousState, nextSessionKey);
      revokeObjectUrls(reset.revokedUrls);
      return reset.state;
    });
    lastAutoplayedLiveIndexRef.current = -1;
    setIsPlaying(false);
    setCurrentTime(0);
  }, [playbackSessionKey, revokeObjectUrls]);

  useEffect(() => {
    if (!isLiveStreaming || liveChunks.length === 0) return;
    const preparedChunks = liveChunks.flatMap((chunk) => {
      const directUrl = String(chunk.audioObjectUrl || '').trim();
      const resolvedUrl = directUrl || base64ToBlobUrl(chunk.audioBase64, chunk.contentType);
      if (!resolvedUrl) return [];
      const sessionKey = resolveLivePlaybackSessionKey({
        jobId: chunk.jobId,
        ...(chunk.sessionEpoch === undefined ? {} : { sessionEpoch: chunk.sessionEpoch }),
      });
      if (!sessionKey) {
        revokeObjectUrls([resolvedUrl]);
        return [];
      }
      return [{
        index: Math.max(0, Math.floor(Number(chunk.index) || 0)),
        sessionKey,
        url: resolvedUrl,
        revokeOnRelease: true,
      }];
    });
    if (preparedChunks.length <= 0) return;
    setLivePlaybackState((previousState) => {
      const appended = appendLivePlaybackChunks(previousState, preparedChunks);
      revokeObjectUrls(appended.revokedUrls);
      return appended.state;
    });
  }, [isLiveStreaming, liveChunks, revokeObjectUrls]);

  useEffect(() => {
    if (!audioRef.current || !isLiveStreaming) return;
    if (
      !shouldAutoplayFirstLiveChunk({
        autoPlayOnFirstChunk,
        activeSourceType,
        currentLiveIndex: liveIndex,
        isPlaying,
        lastAutoplayedLiveIndex: lastAutoplayedLiveIndexRef.current,
      })
    ) {
      return;
    }
    lastAutoplayedLiveIndexRef.current = liveIndex;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
    setIsPlaying(true);
  }, [activeSourceType, autoPlayOnFirstChunk, isLiveStreaming, isPlaying, liveIndex]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [audioUrl]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (!shouldAutoplayGeneratedAudio({
      autoPlayGeneratedAudio,
      activeSourceType,
      activeUrl,
      finalAudioUrl: audioUrl,
      autoplayNonce,
      lastConsumedAutoplayNonce: lastConsumedAutoplayNonceRef.current,
    })) {
      return;
    }

    lastConsumedAutoplayNonceRef.current = autoplayNonce;
    const el = audioRef.current;
    el.currentTime = 0;
    el.play()
      .then(() => {
        setIsPlaying(true);
        setIsBuffering(false);
      })
      .catch(() => setIsPlaying(false));
  }, [activeSourceType, activeUrl, audioUrl, autoPlayGeneratedAudio, autoplayNonce]);

  useEffect(() => {
    return () => {
      const reset = resetLivePlaybackState(livePlaybackStateRef.current);
      revokeObjectUrls(reset.revokedUrls);
    };
  }, [revokeObjectUrls]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      return;
    }
    el.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [isPlaying]);

  const handleTimeUpdate = () => {
    const el = audioRef.current;
    if (!el) return;
    setCurrentTime(el.currentTime);
    if (!Number.isNaN(el.duration)) setDuration(el.duration);
  };

  const handleLoaded = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    setDuration(e.currentTarget.duration || 0);
    setIsBuffering(false);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    const el = audioRef.current;
    if (!el || Number.isNaN(time)) return;
    el.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
  };

  const advanceLiveQueue = useCallback((autoplay: boolean) => {
    const advanced = advanceLivePlaybackState(livePlaybackStateRef.current);
    revokeObjectUrls(advanced.revokedUrls);
    livePlaybackStateRef.current = advanced.state;
    setLivePlaybackState(advanced.state);
    if (autoplay && advanced.state.currentEntry && audioRef.current) {
      audioRef.current.src = advanced.state.currentEntry.url;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [revokeObjectUrls]);

  const canRender = useMemo(() => Boolean(activeUrl), [activeUrl]);
  const canExportFinalAudio = useMemo(() => Boolean(audioUrl), [audioUrl]);

  const handleReset = useCallback(() => {
    const reset = resetLivePlaybackState(livePlaybackStateRef.current);
    revokeObjectUrls(reset.revokedUrls);
    livePlaybackStateRef.current = reset.state;
    setLivePlaybackState(reset.state);
    lastAutoplayedLiveIndexRef.current = -1;
    onReset();
  }, [onReset, revokeObjectUrls]);

  const handleSaveToDrive = useCallback(async () => {
    if (!audioUrl || isSavingToDrive) return;
    setIsSavingToDrive(true);
    setDriveNotice('');
    setDriveNoticeTone('success');
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        throw new Error('Sign in with Google first.');
      }

      let driveTokenResult = await getDriveProviderToken();
      if (!driveTokenResult.ok) {
        if (driveTokenResult.status === 'needs_consent') {
          await reconsentDriveScopes();
        } else {
          await connectDriveIdentity();
        }
        driveTokenResult = await getDriveProviderToken();
      }

      if (!driveTokenResult.ok || !driveTokenResult.token) {
        throw new Error(driveTokenResult.message || 'Google Drive authorization failed.');
      }

      const audioResponse = await fetch(audioUrl, { cache: 'no-store' });
      if (!audioResponse.ok) {
        throw new Error('Unable to read the generated audio file.');
      }
      const audioBlob = await audioResponse.blob();
      const extension = audioBlob.type.includes('mpeg') ? 'mp3' : 'audio';
      const formData = new FormData();
      formData.set('googleAccessToken', driveTokenResult.token);
      formData.set('fileName', `voiceflow_${Date.now()}.${extension}`);
      formData.set('file', new File([audioBlob], `voiceflow_${Date.now()}.${extension}`, { type: audioBlob.type || 'audio/mpeg' }));

      const idToken = await user.getIdToken();
      const exportResponse = await fetch('/api/tts/studio/export/drive', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: formData,
      });
      const exportPayload = await exportResponse.json().catch(() => null) as { fileName?: string; error?: string } | null;
      if (!exportResponse.ok) {
        throw new Error(exportPayload?.error || 'Drive export failed.');
      }

      setDriveNotice(exportPayload?.fileName ? `Saved to Drive as ${exportPayload.fileName}` : 'Saved to Google Drive');
      setDriveNoticeTone('success');
    } catch (error) {
      setDriveNotice(error instanceof Error ? error.message : 'Drive export failed.');
      setDriveNoticeTone('error');
    } finally {
      setIsSavingToDrive(false);
    }
  }, [audioUrl, isSavingToDrive]);

  return (
    <div className="w-full rounded-3xl bg-slate-900/60 border border-slate-800 p-4 sm:p-5">
      {canRender ? (
        <audio
          ref={audioRef}
          src={activeUrl || undefined}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoaded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            if (liveIndex >= 0) {
              advanceLiveQueue(true);
            }
          }}
          onWaiting={() => setIsBuffering(true)}
          onCanPlay={() => setIsBuffering(false)}
          preload="auto"
          crossOrigin="anonymous"
        />
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Generated Audio</h3>
          <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
            <span>{liveIndex >= 0 ? `Live Chunk ${liveIndex + 1}` : 'Final Output'}</span>
            {isGenerating ? <span className="inline-flex items-center gap-1 text-amber-300"><Loader2 size={11} className="animate-spin" /> Rendering</span> : null}
          </div>
        </div>
      </div>

      <div className="h-28 rounded-2xl bg-slate-800/50 border border-slate-800 flex items-center justify-center overflow-hidden mb-4">
        {!isPlaying && currentTime === 0 && (
          <div className="text-slate-400 text-sm font-medium flex items-center gap-2">Press Play to listen</div>
        )}
        <Visualizer audioElement={audioRef.current} isPlaying={isPlaying} height={112} />
      </div>

      <div className="flex items-center gap-3 text-xs font-mono text-slate-300 mb-3">
        <span>{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step="0.01"
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          className="flex-1 h-1.5 bg-slate-700 rounded-full accent-amber-400"
        />
        <span>{formatTime(duration)}</span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const el = audioRef.current;
              if (el) el.currentTime = Math.max(0, el.currentTime - TRANSPORT_SKIP_SECONDS);
            }}
            className="p-2 rounded-xl border border-slate-800 text-slate-200 hover:border-amber-400 transition-colors"
            title="-5s"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            className="w-14 h-14 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center shadow-lg shadow-amber-500/40 hover:scale-105 transition-transform"
            disabled={!canRender}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isBuffering ? <Loader2 size={22} className="animate-spin" /> : isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
          </button>
          <button
            onClick={() => {
              const el = audioRef.current;
              if (!el || !duration) return;
              el.currentTime = Math.min(duration, el.currentTime + TRANSPORT_SKIP_SECONDS);
            }}
            className="p-2 rounded-xl border border-slate-800 text-slate-200 hover:border-amber-400 transition-colors"
            title="+5s"
          >
            <SkipForward size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-slate-300">
            <Volume2 size={16} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setVolume(val);
                if (audioRef.current) audioRef.current.volume = val;
              }}
              className="w-24 accent-amber-400"
            />
          </div>
          {activeUrl ? (
            <a
              href={activeUrl}
              download={`voiceflow_${Date.now()}.mp3`}
              className="px-3 py-2 rounded-lg border border-slate-800 text-slate-100 hover:border-amber-400 text-xs font-semibold"
            >
              <Download size={14} className="inline mr-1" /> Save
            </a>
          ) : null}
          {canExportFinalAudio ? (
            <button
              onClick={() => { void handleSaveToDrive(); }}
              disabled={isSavingToDrive}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-emerald-400 disabled:opacity-60"
              title="Save to Google Drive"
            >
              {isSavingToDrive ? <Loader2 size={14} className="animate-spin" /> : <GoogleDriveIcon />}
              Drive
            </button>
          ) : null}
          <button
            onClick={handleReset}
            className="p-2 rounded-lg border border-slate-800 text-slate-200 hover:text-rose-400 hover:border-rose-400 transition-colors"
            title="Reset / New Generation"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      {driveNotice ? (
        <div className={`mt-3 flex items-center gap-1.5 text-[11px] ${driveNoticeTone === 'success' ? 'text-slate-300' : 'text-rose-300'}`}>
          {driveNoticeTone === 'success'
            ? <Check size={12} className="text-emerald-400" />
            : <AlertCircle size={12} className="text-rose-400" />}
          <span>{driveNotice}</span>
        </div>
      ) : null}
    </div>
  );
};
