import React from 'react';
import { ChevronLeft, ChevronRight, Loader2, Music2, Pause, Play, Volume2 } from 'lucide-react';
import { MUSIC_TRACKS } from '../../../../constants';
import type { ReaderCatalogItem, ReaderSession } from '../../../../types';
import type { PlaylistItem } from './readerTypes';

interface ReaderPlayerDockProps {
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
  isMusicPlaying: boolean;
  musicTrackId: string;
  onTransportToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleMusic: () => void;
  onMusicTrackChange: (value: string) => void;
  onExport: () => void;
  onRefresh: () => void;
  onClose: () => void;
  onAutoAssignCast: () => void;
  canAutoAssignCast: boolean;
  isAutoAssigningCast: boolean;
}

export const ReaderPlayerDock: React.FC<ReaderPlayerDockProps> = ({
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
  isMusicPlaying,
  musicTrackId,
  onTransportToggle,
  onPrev,
  onNext,
  onToggleMusic,
  onMusicTrackChange,
  onExport,
  onRefresh,
  onClose,
  onAutoAssignCast,
  canAutoAssignCast,
  isAutoAssigningCast,
}) => {
  const currentTrack = MUSIC_TRACKS.find((track) => track.id === musicTrackId);

  return (
    <div className="vf-reader__dock" data-testid="reader-sticky-dock">
      <div className="vf-reader__dock-main">
        <button
          type="button"
          className={`vf-reader__dock-play ${isSpeechPlaying ? 'vf-reader__dock-play--playing' : ''}${isSpeechBuffering ? ' vf-reader__dock-play--buffering' : ''}`}
          onClick={onTransportToggle}
          disabled={!activeItem}
          aria-label={isSpeechPlaying ? 'Pause reader audio' : 'Play reader audio'}
        >
          {isSpeechBuffering && !isSpeechPlaying ? <Loader2 size={18} className="animate-spin" /> : isSpeechPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <div className="vf-reader__dock-copy">
          <div className="vf-reader__eyebrow">
            <Volume2 size={13} />
            Sticky Player
          </div>
          <div className="vf-reader__dock-title">
            {activeItem?.title || session?.title || selectedItem?.title || 'No reader audio ready yet'}
          </div>
          <div className="vf-reader__dock-summary">
            {isSpeechBuffering
              ? 'Loading the next reader section...'
              : activeItem?.text || session?.summary || selectedItem?.summary || 'Open a title and press Prepare & Play.'}
          </div>
          <div className="vf-reader__dock-progress">
            <div className="vf-reader__dock-progress-fill" style={{ width: `${speechProgressPct}%` }} />
          </div>
          <div className="vf-reader__dock-meta">
            {session?.warningActive
              ? `Unsaved cache expires in ${warningCountdown}. Savepoint or export to preserve the session.`
              : `${billingLabel}. ${currentTrack?.name ? `Ambience: ${currentTrack.name}.` : 'Select ambience from the player.'}`}
          </div>
        </div>
      </div>

      <div className="vf-reader__dock-actions">
        <button type="button" className="vf-reader__dock-btn" onClick={onPrev} disabled={activeQueueIndex <= 0}>
          <ChevronLeft size={15} />
          Prev
        </button>
        <button type="button" className="vf-reader__dock-btn" onClick={onNext} disabled={!playlistLength || activeQueueIndex >= playlistLength - 1}>
          Next
          <ChevronRight size={15} />
        </button>
        <button type="button" className="vf-reader__dock-btn" onClick={onToggleMusic}>
          <Music2 size={15} />
          {isMusicPlaying ? 'Ambience On' : 'Ambience'}
        </button>
        <label className="vf-reader__dock-select">
          <span>Track</span>
          <select value={musicTrackId} onChange={(event) => onMusicTrackChange(event.target.value)} className="vf-reader__select vf-reader__select--dock vf-theme-select">
            {MUSIC_TRACKS.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="vf-reader__dock-btn" onClick={onExport}>
          Export
        </button>
        <button type="button" className="vf-reader__dock-btn" onClick={onRefresh}>
          Refresh
        </button>
        <button type="button" className="vf-reader__dock-btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="vf-reader__dock-btn" onClick={onAutoAssignCast} disabled={!canAutoAssignCast || isAutoAssigningCast}>
          AI Auto
        </button>
      </div>
    </div>
  );
};
