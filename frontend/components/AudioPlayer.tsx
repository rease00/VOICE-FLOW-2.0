import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Play, Pause, Download, RefreshCw, SkipBack, SkipForward, Volume2, Loader2, Check, AlertCircle } from 'lucide-react';
import { Visualizer } from './Visualizer';
import { shouldAutoplayFirstLiveChunk } from './audioPlayerAutoplay';
import { resolveSequentialLiveChunkIndexes } from './audioPlayerLiveHelpers';
import { firebaseAuth } from '../services/firebaseClient';
import {
  connectDriveIdentity,
  getDriveProviderToken,
  reconsentDriveScopes,
} from '../services/driveAuthService';

export interface LiveAudioChunk {
  jobId: string;
  index: number;
  contentType?: string;
  durationMs?: number;
  audioBase64?: string;
}

interface AudioPlayerProps {
  audioUrl: string | null;
  liveChunks?: LiveAudioChunk[];
  isLiveStreaming?: boolean;
  isGenerating?: boolean;
  autoPlayOnFirstChunk?: boolean;
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
  isLiveStreaming = false,
  isGenerating = false,
  autoPlayOnFirstChunk = true,
  onReset,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(Boolean(isGenerating));
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeUrl, setActiveUrl] = useState<string | null>(audioUrl);
  const [volume, setVolume] = useState(1);
  const [liveIndex, setLiveIndex] = useState<number>(-1);
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [driveNotice, setDriveNotice] = useState('');
  const [driveNoticeTone, setDriveNoticeTone] = useState<'success' | 'error'>('success');

  const audioRef = useRef<HTMLAudioElement>(null);
  const liveQueueRef = useRef<Map<number, string>>(new Map());
  const nextLiveIndexRef = useRef(0);
  const lastPlayedLiveRef = useRef(-1);

  // derive live-ready chunks in order
  useEffect(() => {
    if (!isLiveStreaming || liveChunks.length === 0) return;
    const ready = resolveSequentialLiveChunkIndexes({
      pendingIndexes: liveChunks.map((c) => c.index).values(),
      nextIndex: nextLiveIndexRef.current,
    });
    ready.readyIndexes.forEach((idx) => {
      const chunk = liveChunks.find((c) => c.index === idx);
      if (!chunk) return;
      const url = base64ToBlobUrl(chunk.audioBase64, chunk.contentType);
      if (url) liveQueueRef.current.set(idx, url);
    });
    nextLiveIndexRef.current = ready.nextIndex;
  }, [liveChunks, isLiveStreaming]);

  // pick current source: prefer live queue else final url
  useEffect(() => {
    if (liveQueueRef.current.size > 0) {
      const sorted = Array.from(liveQueueRef.current.entries()).sort((a, b) => a[0] - b[0]);
      const first = sorted[0];
      if (!first) return;
      const [idx, url] = first;
      if (idx !== lastPlayedLiveRef.current) {
        setActiveUrl(url);
        lastPlayedLiveRef.current = idx;
        setLiveIndex(idx);
      }
      return;
    }
    setActiveUrl(audioUrl);
    setLiveIndex(-1);
  }, [audioUrl, liveQueueRef.current.size]);

  // autoplay first live chunk if allowed
  useEffect(() => {
    if (!audioRef.current || !isLiveStreaming) return;
    if (
      !shouldAutoplayFirstLiveChunk({
        autoPlayOnFirstChunk,
        activeSourceType: liveIndex >= 0 ? 'live' : (activeUrl ? 'final' : 'none'),
        isPlaying,
        liveQueueSize: liveQueueRef.current.size,
      })
    ) {
      return;
    }
    if (isPlaying) return;
    audioRef.current.play().catch(() => {});
    setIsPlaying(true);
  }, [activeUrl, isLiveStreaming, autoPlayOnFirstChunk, isPlaying, liveIndex]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [audioUrl]);

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

  const advanceLiveQueue = useCallback(
    (autoplay: boolean) => {
      if (liveIndex >= 0) {
        const current = liveQueueRef.current.get(liveIndex);
        if (current) {
          try { URL.revokeObjectURL(current); } catch {}
        }
        liveQueueRef.current.delete(liveIndex);
      }
      if (liveQueueRef.current.size === 0) {
        setActiveUrl(audioUrl);
        setLiveIndex(-1);
        return;
      }
      const sorted = Array.from(liveQueueRef.current.entries()).sort((a, b) => a[0] - b[0]);
      const first = sorted[0];
      if (!first) {
        setActiveUrl(audioUrl);
        setLiveIndex(-1);
        return;
      }
      const [nextIdx, nextUrl] = first;
      lastPlayedLiveRef.current = nextIdx;
      setLiveIndex(nextIdx);
      setActiveUrl(nextUrl);
      if (autoplay && audioRef.current) {
        audioRef.current.src = nextUrl;
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
    },
    [audioUrl, liveIndex]
  );

  const canRender = useMemo(() => Boolean(activeUrl), [activeUrl]);
  const canExportFinalAudio = useMemo(() => Boolean(audioUrl), [audioUrl]);

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
            if (isLiveStreaming) {
              advanceLiveQueue(true);
            }
          }}
          onWaiting={() => setIsBuffering(true)}
          onCanPlay={() => setIsBuffering(false)}
          preload="auto"
          crossOrigin="anonymous"
        />
      ) : null}

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
            onClick={onReset}
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
