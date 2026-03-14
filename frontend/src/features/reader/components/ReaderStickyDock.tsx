import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Home, Languages, Pause, Play, Settings2, UploadCloud, Users, Volume2, Wand2, Waves } from 'lucide-react';
import type { VoiceOption } from '../../../../types';
import type { ReaderCatalogItem, ReaderSession } from '../../../../types';
import type { PlaylistItem } from './readerTypes';

interface ReaderPlayerDockProps {
  dockRef?: React.Ref<HTMLDivElement>;
  suspendAutoCollapse?: boolean;
  session: ReaderSession | null;
  selectedItem: ReaderCatalogItem | null;
  activeItem: PlaylistItem | null;
  speechProgressPct: number;
  isSpeechPlaying: boolean;
  isSpeechBuffering: boolean;
  activeQueueIndex: number;
  playlistLength: number;
  warningCountdown: string;
  billingLabel: string;
  audioEngine: 'tts_hd' | 'native_audio_dialog';
  audioEngineStatus: string;
  narratorVoiceId: string;
  multiSpeakerEnabled: boolean;
  voiceOptions: VoiceOption[];
  onTransportToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onGoHome: () => void;
  onOpenImport: () => void;
  onOpenTranslate: () => void;
  onOpenSettings: () => void;
  onOpenDetectedText: () => void;
  onOpenCast: () => void;
  onToggleNativeAudio: () => void;
  onNarratorVoiceChange: (value: string) => void;
  onToggleMultiSpeaker: () => void;
}

export const ReaderPlayerDock: React.FC<ReaderPlayerDockProps> = ({
  dockRef,
  suspendAutoCollapse = false,
  session,
  selectedItem,
  activeItem,
  speechProgressPct,
  isSpeechPlaying,
  isSpeechBuffering,
  activeQueueIndex,
  playlistLength,
  warningCountdown,
  billingLabel,
  audioEngine,
  audioEngineStatus,
  narratorVoiceId,
  multiSpeakerEnabled,
  voiceOptions,
  onTransportToggle,
  onPrev,
  onNext,
  onGoHome,
  onOpenImport,
  onOpenTranslate,
  onOpenSettings,
  onOpenDetectedText,
  onOpenCast,
  onToggleNativeAudio,
  onNarratorVoiceChange,
  onToggleMultiSpeaker,
}) => {
  const AUTO_COLLAPSE_IDLE_MS = 3000;
  const title = activeItem?.title || session?.title || selectedItem?.title || 'Reader Dock';
  const queueLabel = playlistLength > 0 ? `${activeQueueIndex + 1}/${playlistLength}` : 'Idle';
  const progressWidth = Number.isFinite(speechProgressPct) ? Math.max(0, Math.min(100, speechProgressPct)) : 0;
  const engineBadgeLabel = audioEngine === 'native_audio_dialog' ? 'Gemini Native' : 'Gemini 2.5 Flash';
  const engineStatusLabel = audioEngineStatus === 'fallback_to_tts'
    ? 'Fallback to Gemini 2.5 Flash'
      : audioEngineStatus === 'unavailable'
        ? 'Unavailable'
        : 'Active';
  const [isCollapsed, setIsCollapsed] = useState<boolean>(true);
  const collapseTimerRef = useRef<number | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current === null) return;
    window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
  }, []);

  const armCollapseTimer = useCallback(() => {
    clearCollapseTimer();
    collapseTimerRef.current = window.setTimeout(() => {
      setIsCollapsed(true);
    }, AUTO_COLLAPSE_IDLE_MS);
  }, [AUTO_COLLAPSE_IDLE_MS, clearCollapseTimer]);

  const handleDockActivity = useCallback(() => {
    if (isCollapsed) return;
    if (suspendAutoCollapse) {
      clearCollapseTimer();
      return;
    }
    armCollapseTimer();
  }, [armCollapseTimer, clearCollapseTimer, isCollapsed, suspendAutoCollapse]);

  const handleCollapsedPrimary = useCallback(() => {
    setIsCollapsed(false);
    if (activeItem) onTransportToggle();
    if (!suspendAutoCollapse) armCollapseTimer();
  }, [activeItem, armCollapseTimer, onTransportToggle, suspendAutoCollapse]);

  useEffect(() => {
    if (isCollapsed) return;
    if (suspendAutoCollapse) {
      clearCollapseTimer();
      return;
    }
    armCollapseTimer();
  }, [armCollapseTimer, clearCollapseTimer, isCollapsed, suspendAutoCollapse]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  if (isCollapsed) {
    return (
      <div ref={dockRef} className="vf-reader-dock vf-reader-dock--collapsed" data-testid="reader-sticky-dock">
        <button
          type="button"
          className="vf-reader-dock__peek-play"
          aria-label="Expand reader controls"
          onClick={handleCollapsedPrimary}
        >
          {isSpeechPlaying ? <Pause size={20} /> : <Play size={20} />}
          <span>{isSpeechPlaying ? 'Pause' : 'Play'}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={dockRef}
      className="vf-reader-dock"
      data-testid="reader-sticky-dock"
      onPointerMove={handleDockActivity}
      onPointerDown={handleDockActivity}
      onTouchStart={handleDockActivity}
      onFocusCapture={handleDockActivity}
      onKeyDown={handleDockActivity}
    >
      <div className="vf-reader-dock__transport-cluster">
        <button type="button" className="vf-reader-dock__nav" onClick={onGoHome} aria-label="Open Reader home">
          <Home size={16} />
        </button>

        <button
          type="button"
          className={`vf-reader-dock__transport ${isSpeechPlaying ? 'vf-reader-dock__transport--playing' : ''}${isSpeechBuffering ? ' vf-reader-dock__transport--buffering' : ''}`}
          onClick={onTransportToggle}
          disabled={!activeItem}
          aria-label={isSpeechPlaying ? 'Pause reader audio' : 'Play reader audio'}
        >
          {isSpeechPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <button type="button" className="vf-reader-dock__nav" onClick={onPrev} disabled={activeQueueIndex <= 0} aria-label="Previous reader item">
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="vf-reader-dock__nav" onClick={onNext} disabled={!playlistLength || activeQueueIndex >= playlistLength - 1} aria-label="Next reader item">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="vf-reader-dock__copy">
        <div className="vf-reader-dock__eyebrow">
          <Volume2 size={13} />
          Player Dock
        </div>
        <strong>{title}</strong>
        <div className="vf-reader-dock__meta">
          <span>{queueLabel}</span>
          <span className="vf-reader-dock__engine-badge">{engineBadgeLabel}</span>
          <span className="vf-reader-dock__engine-status">{engineStatusLabel}</span>
          {session?.warningActive ? <span>Unsaved cache {warningCountdown}</span> : <span>{billingLabel}</span>}
        </div>
        <div className="vf-reader-dock__progress">
          <div className="vf-reader-dock__progress-fill" style={{ width: `${progressWidth}%` }} />
        </div>
      </div>

      <div className="vf-reader-dock__controls">
        <button type="button" className="vf-reader-dock__button" onClick={onOpenImport}>
          <UploadCloud size={12} />
          Import
        </button>

        <button type="button" className="vf-reader-dock__button" onClick={onOpenTranslate}>
          <Languages size={12} />
          Translate
        </button>

        <button type="button" className={`vf-reader-dock__button ${multiSpeakerEnabled ? 'vf-reader-dock__button--active' : ''}`} onClick={onToggleMultiSpeaker}>
          <Users size={12} />
          Multi {multiSpeakerEnabled ? 'On' : 'Off'}
        </button>

        {multiSpeakerEnabled ? (
          <button type="button" className="vf-reader-dock__button" onClick={onOpenCast} disabled={!session}>
            <Users size={12} />
            Cast
          </button>
        ) : null}

        <button type="button" className="vf-reader-dock__button" onClick={onOpenDetectedText} disabled={!session}>
          <Wand2 size={12} />
          AI Text
        </button>

        <button type="button" className="vf-reader-dock__button" onClick={onOpenSettings}>
          <Settings2 size={12} />
          Settings
        </button>

        <button type="button" className={`vf-reader-dock__button ${audioEngine === 'native_audio_dialog' ? 'vf-reader-dock__button--active' : ''}`} onClick={onToggleNativeAudio}>
          <Waves size={12} />
          Native {audioEngine === 'native_audio_dialog' ? 'On' : 'Off'}
        </button>

        <label className="vf-reader-dock__select" title="Single speaker narrator voice">
          <select aria-label="Voice narrator" value={narratorVoiceId} onChange={(event) => onNarratorVoiceChange(event.target.value)}>
            {voiceOptions.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
};
