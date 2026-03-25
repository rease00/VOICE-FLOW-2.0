import React from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw, Upload, X } from 'lucide-react';

interface ReaderStickyDockProps {
  title: string;
  unitLabel: string;
  progressPct: number;
  statusLabel: string;
  isPlaying: boolean;
  miniMode: boolean;
  ambiencePreset: string;
  stylePreset: string;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onClose: () => void;
  onToggleMiniMode: () => void;
  onAmbiencePresetChange: (value: string) => void;
  onStylePresetChange: (value: string) => void;
}

const AMBIENCE_PRESETS = ['none', 'studio', 'forest', 'rain', 'cafe'];
const STYLE_PRESETS = ['default', 'dramatic', 'calm', 'cinematic'];

export const ReaderStickyDock: React.FC<ReaderStickyDockProps> = ({
  title,
  unitLabel,
  progressPct,
  statusLabel,
  isPlaying,
  miniMode,
  ambiencePreset,
  stylePreset,
  onTogglePlay,
  onPrev,
  onNext,
  onRefresh,
  onExport,
  onClose,
  onToggleMiniMode,
  onAmbiencePresetChange,
  onStylePresetChange,
}) => (
  <footer className={`vf-reader-v2-dock ${miniMode ? 'vf-reader-v2-dock--mini' : ''}`} data-testid="reader-sticky-dock">
    <div className="vf-reader-v2-dock__transport">
      <button type="button" aria-label="Previous" onClick={onPrev}>
        <ChevronLeft size={16} />
      </button>
      <button type="button" aria-label="Play pause" onClick={onTogglePlay} className="vf-reader-v2-dock__play">
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button type="button" aria-label="Next" onClick={onNext}>
        <ChevronRight size={16} />
      </button>
    </div>

    <div className="vf-reader-v2-dock__copy">
      <div className="vf-reader-v2-eyebrow">Sticky Player</div>
      <strong>{title || 'Reader'}</strong>
      <span className="vf-reader-v2-dock__copy-line">{unitLabel} - {statusLabel}</span>
      <div className="vf-reader-v2-dock__status">
        <div className="vf-reader-v2-dock__status-meta">
          <span>{Math.round(Math.max(0, Math.min(100, progressPct)))}%</span>
        </div>
        <div className="vf-reader-v2-dock__progress">
          <div className="vf-reader-v2-dock__progress-fill" style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }} />
        </div>
      </div>
    </div>

    <div className="vf-reader-v2-dock__controls">
      {!miniMode ? (
        <>
          <label>
            <span>Ambience</span>
            <select value={ambiencePreset} onChange={(event) => onAmbiencePresetChange(event.target.value)}>
              {AMBIENCE_PRESETS.map((preset) => (
                <option key={`dock-ambience-${preset}`} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Voice Style</span>
            <select value={stylePreset} onChange={(event) => onStylePresetChange(event.target.value)}>
              {STYLE_PRESETS.map((preset) => (
                <option key={`dock-style-${preset}`} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <button type="button" onClick={onExport} title="Export" aria-label="Export">
        <Upload size={14} />
      </button>
      <button type="button" onClick={onRefresh} title="Refresh" aria-label="Refresh">
        <RefreshCw size={14} />
      </button>
      <button type="button" onClick={onToggleMiniMode} title="Mini mode">
        {miniMode ? 'Expand' : 'Compact'}
      </button>
      <button type="button" onClick={onClose} title="Close reader" aria-label="Close reader">
        <X size={14} />
      </button>
    </div>
  </footer>
);
