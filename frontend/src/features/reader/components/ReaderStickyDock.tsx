import React from 'react';
import { ChevronLeft, ChevronRight, Home, Languages, Pause, Play, Save, Settings2, UploadCloud, Users, Volume2, Wand2, Waves, X } from 'lucide-react';
import type { VoiceOption } from '../../../../types';
import type { ReaderCatalogItem, ReaderSession } from '../../../../types';
import type { PlaylistItem } from './readerTypes';

interface ReaderPlayerDockProps {
  dockRef?: React.Ref<HTMLDivElement>;
  dockScale: number;
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
  onSavepoint: () => void;
  onCloseSession: () => void;
  onToggleNativeAudio: () => void;
  onNarratorVoiceChange: (value: string) => void;
  onToggleMultiSpeaker: () => void;
}

export const ReaderPlayerDock: React.FC<ReaderPlayerDockProps> = ({
  dockRef,
  dockScale,
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
  onSavepoint,
  onCloseSession,
  onToggleNativeAudio,
  onNarratorVoiceChange,
  onToggleMultiSpeaker,
}) => {
  const title = activeItem?.title || session?.title || selectedItem?.title || 'Reader Dock';
  const queueLabel = playlistLength > 0 ? `${activeQueueIndex + 1}/${playlistLength}` : 'Idle';
  const dockStyle = { '--reader-dock-scale': String(dockScale) } as React.CSSProperties;

  return (
    <div ref={dockRef} className="vf-reader-dock" data-testid="reader-sticky-dock" style={dockStyle}>
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
          Reader Dock
        </div>
        <strong>{title}</strong>
        <div className="vf-reader-dock__meta">
          <span>{queueLabel}</span>
          <span>{billingLabel}</span>
          {session?.warningActive ? <span>Unsaved cache {warningCountdown}</span> : <span>Status: {audioEngineStatus}</span>}
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

        <button type="button" className="vf-reader-dock__button" onClick={onOpenCast} disabled={!session || !multiSpeakerEnabled}>
          <Users size={12} />
          Cast
        </button>

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

        <label className="vf-reader-dock__select">
          <select aria-label="Voice narrator" value={narratorVoiceId} onChange={(event) => onNarratorVoiceChange(event.target.value)}>
            {voiceOptions.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="vf-reader-dock__button" onClick={onSavepoint} disabled={!session}>
          <Save size={12} />
          Save
        </button>

        <button type="button" className="vf-reader-dock__button vf-reader-dock__button--danger" onClick={onCloseSession} disabled={!session}>
          <X size={12} />
          Close
        </button>
      </div>
    </div>
  );
};
