'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Music, Volume2, VolumeX } from 'lucide-react';
import type { AmbianceTrack } from '../../model/types';

interface AmbiancePanelProps {
  isCompact?: boolean;
}

const AMBIANCE_TRACKS: AmbianceTrack[] = [
  { id: 'rain', name: 'Rain', category: 'nature', url: '/ambiance/rain.mp3', duration: 3600, volume: 0.5 },
  { id: 'forest', name: 'Forest', category: 'nature', url: '/ambiance/forest.mp3', duration: 3600, volume: 0.5 },
  { id: 'ocean', name: 'Ocean', category: 'nature', url: '/ambiance/ocean.mp3', duration: 3600, volume: 0.5 },
  { id: 'cafe', name: 'Cafe', category: 'cafe', url: '/ambiance/cafe.mp3', duration: 3600, volume: 0.5 },
  { id: 'library', name: 'Library', category: 'cafe', url: '/ambiance/library.mp3', duration: 3600, volume: 0.5 },
  { id: 'ambient', name: 'Ambient', category: 'ambient', url: '/ambiance/ambient.mp3', duration: 3600, volume: 0.5 },
];

export function AmbiancePanel({ isCompact = false }: AmbiancePanelProps) {
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const playTrack = useCallback((track: AmbianceTrack) => {
    stopAudio();
    const audio = new Audio(track.url);
    audio.loop = true;
    audio.volume = volume;
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    audioRef.current = audio;
  }, [volume, stopAudio]);

  const handleTrackSelect = useCallback((trackId: string) => {
    if (selectedTrack === trackId) {
      setSelectedTrack(null);
      stopAudio();
      return;
    }
    setSelectedTrack(trackId);
    const track = AMBIANCE_TRACKS.find((t) => t.id === trackId);
    if (track) playTrack(track);
  }, [selectedTrack, playTrack, stopAudio]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    return () => { stopAudio(); };
  }, [stopAudio]);

  if (isCompact) {
    return (
      <button
        onClick={() => handleTrackSelect(selectedTrack || '')}
        className="flex flex-col items-center gap-1 rounded-2xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] px-3 py-2 text-center transition-colors hover:bg-[var(--vf-reader-hover-bg)]"
      >
        {isPlaying ? <Volume2 size={16} className="text-[var(--vf-reader-accent-text)]" /> : <Music size={16} className="text-[var(--vf-reader-panel-text)]" />}
        <span className="text-xs font-medium text-[var(--vf-reader-muted)]">{isPlaying ? 'On' : 'Ambiance'}</span>
      </button>
    );
  }

  const renderTrackGroup = (label: string, category: AmbianceTrack['category']) => (
    <div className="space-y-1">
      <p className="text-xs font-medium text-[var(--vf-reader-muted)]">{label}</p>
      <div className="grid grid-cols-3 gap-1">
        {AMBIANCE_TRACKS.filter((track) => track.category === category).map((track) => (
          <button
            key={track.id}
            onClick={() => handleTrackSelect(track.id)}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              selectedTrack === track.id
                ? 'bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)]'
                : 'bg-[var(--vf-reader-choice-idle-bg)] text-[var(--vf-reader-choice-idle-text)] hover:bg-[var(--vf-reader-choice-idle-hover-bg)]'
            }`}
          >
            {track.name}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 rounded-[24px] border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <h3 className="text-sm font-semibold text-[var(--vf-reader-shell-text)]">Ambiance</h3>
      {renderTrackGroup('Nature', 'nature')}
      {renderTrackGroup('Cafe', 'cafe')}
      {renderTrackGroup('Ambient', 'ambient')}

      {selectedTrack && (
        <div className="space-y-2 border-t border-[var(--vf-reader-card-border)] pt-3">
          <div className="flex items-center justify-between">
            <label htmlFor="ambiance-volume" className="flex items-center gap-1 text-xs font-medium text-[var(--vf-reader-muted)]">
              <button onClick={() => setVolume(volume > 0 ? 0 : 0.5)} className="transition-colors hover:text-[var(--vf-reader-panel-text)]">
                {volume > 0 ? <Volume2 size={12} /> : <VolumeX size={12} />}
              </button>
              Volume
            </label>
            <span className="text-xs font-medium text-[var(--vf-reader-muted)]">{Math.round(volume * 100)}%</span>
          </div>
          <input
            id="ambiance-volume"
            type="range"
            min="0"
            max="100"
            value={volume * 100}
            onChange={(event) => setVolume(Number(event.target.value) / 100)}
            className="vf-reader-slider"
          />
        </div>
      )}
    </div>
  );
}
