import React from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, Pause, Play, Settings2, Upload } from 'lucide-react';

interface ReaderStickyDockProps {
  title: string;
  unitLabel: string;
  readyChunkCount?: number;
  pendingChunkCount?: number;
  queueFillPct?: number;
  progressPct?: number;
  statusLabel: string;
  isPlaying: boolean;
  miniMode: boolean;
  transportDisabled?: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRefresh?: () => void;
  onExport?: () => void;
  onClose?: () => void;
  onToggleMiniMode: () => void;
  onDockImport?: () => boolean | void;
  onDockSettings?: () => void;
  importAccept?: string;
  importDialogSignal?: number;
  onImportFiles?: (files: File[]) => void;
  onOpenSettings?: () => void;
}

export const ReaderStickyDock: React.FC<ReaderStickyDockProps> = ({
  title,
  unitLabel,
  readyChunkCount,
  pendingChunkCount,
  queueFillPct,
  progressPct,
  statusLabel,
  isPlaying,
  miniMode,
  transportDisabled,
  onTogglePlay,
  onPrev,
  onNext,
  onRefresh,
  onExport,
  onClose,
  onToggleMiniMode,
  onDockImport,
  onDockSettings,
  importAccept = '',
  importDialogSignal = 0,
  onImportFiles,
  onOpenSettings,
}) => {
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const importInputId = React.useId();
  const lastImportDialogSignalRef = React.useRef(importDialogSignal);

  const safeReadyChunks = Math.max(0, Math.floor(Number(readyChunkCount || 0)));
  const safePendingChunks = Math.max(0, Math.floor(Number(pendingChunkCount || 0)));
  const safeQueuePct = Math.max(0, Math.min(100, Number(queueFillPct ?? 0)));
  const resolvedTransportDisabled = Boolean(transportDisabled);

  const queueStatusText = `${safeReadyChunks} ready chunks, ${safePendingChunks} pending, queue ${safeQueuePct}%`;

  const handleImportClick = () => {
    const handledByParent = onDockImport?.();
    if (handledByParent) return;
    importInputRef.current?.click();
  };

  React.useEffect(() => {
    if (importDialogSignal > lastImportDialogSignalRef.current) {
      importInputRef.current?.click();
    }
    lastImportDialogSignalRef.current = importDialogSignal;
  }, [importDialogSignal]);

  const handleImportChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (files && files.length > 0 && onImportFiles) {
      onImportFiles(Array.from(files));
    }
    event.currentTarget.value = '';
  };

  if (miniMode) {
    return (
      <footer className="vf-reader-v2-dock vf-reader-v2-dock--mini" data-testid="reader-sticky-dock">
        <button
          type="button"
          className="vf-reader-v2-dock__mini-circle"
          onClick={onToggleMiniMode}
          title="Expand reader dock"
          aria-label="Expand reader dock"
        >
          <ChevronUp size={12} aria-hidden="true" />
        </button>
        <div className="vf-reader-v2-dock__status-sr" role="status" aria-live="polite" aria-atomic="true">
          Reader status: {statusLabel}. {queueStatusText}
        </div>
      </footer>
    );
  }

  return (
    <footer className="vf-reader-v2-dock" data-testid="reader-sticky-dock">
      <div className="vf-reader-v2-dock__transport">
        <button type="button" aria-label="Previous chunk" className="vf-reader-v2-dock__icon-btn" onClick={onPrev} disabled={resolvedTransportDisabled}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
          aria-pressed={isPlaying}
          onClick={onTogglePlay}
          className="vf-reader-v2-dock__play vf-reader-v2-dock__icon-btn"
          disabled={resolvedTransportDisabled}
        >
          {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
        <button type="button" aria-label="Next chunk" className="vf-reader-v2-dock__icon-btn" onClick={onNext} disabled={resolvedTransportDisabled}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="vf-reader-v2-dock__copy">
        <div className="vf-reader-v2-eyebrow">Sticky Player</div>
        <strong>{title || 'Reader'}</strong>
        <span className="vf-reader-v2-dock__copy-line">{unitLabel} - {statusLabel}</span>
        <div className="vf-reader-v2-dock__status" aria-hidden="true">
          <div className="vf-reader-v2-dock__status-meta">
            <span>{safeReadyChunks} ready chunks</span>
            <em>{safePendingChunks} pending</em>
          </div>
          <div
            className="vf-reader-v2-dock__progress vf-reader-v2-dock__progress--queue"
            role="progressbar"
            aria-label="Queue fill"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(safeQueuePct)}
            aria-valuetext={`${Math.round(safeQueuePct)}% queue fill`}
          >
            <div
              className="vf-reader-v2-dock__progress-fill vf-reader-v2-dock__progress-fill--animated"
              style={{ width: `${safeQueuePct}%` }}
            />
          </div>
        </div>
        <div className="vf-reader-v2-dock__status-sr" role="status" aria-live="polite" aria-atomic="true">
          Reader status: {statusLabel}. {queueStatusText}
        </div>
      </div>

      <div className="vf-reader-v2-dock__controls vf-reader-v2-dock__controls-shell">
        <div className="vf-reader-v2-dock__quick-tools" role="group" aria-label="Reader quick tools">
          <button
            type="button"
            className="vf-reader-v2-dock__text-btn"
            onClick={handleImportClick}
            aria-controls={importInputId}
            aria-label="Import content"
            title="Import content"
          >
            <Upload size={14} aria-hidden="true" />
            <span>Import</span>
          </button>
          <input
            ref={importInputRef}
            id={importInputId}
            type="file"
            accept={importAccept || undefined}
            onChange={handleImportChange}
            className="vf-reader-v2-dock__import-input"
            hidden
            aria-hidden="true"
            tabIndex={-1}
          />

          <button
            type="button"
            className="vf-reader-v2-dock__text-btn"
            onClick={() => {
              onDockSettings?.();
              onOpenSettings?.();
            }}
            aria-label="Open settings"
            title="Open settings"
            disabled={!onDockSettings && !onOpenSettings}
          >
            <Settings2 size={14} aria-hidden="true" />
            <span>Settings</span>
          </button>
          {onRefresh ? (
            <button type="button" className="vf-reader-v2-dock__text-btn" onClick={onRefresh}>
              <span>Refresh</span>
            </button>
          ) : null}
          {onExport ? (
            <button type="button" className="vf-reader-v2-dock__text-btn" onClick={onExport}>
              <span>Export</span>
            </button>
          ) : null}
          {onClose ? (
            <button type="button" className="vf-reader-v2-dock__text-btn" onClick={onClose}>
              <span>Close</span>
            </button>
          ) : null}
        </div>

        <div className="vf-reader-v2-dock__collapse-slot">
          <button
            type="button"
            className="vf-reader-v2-dock__icon-btn vf-reader-v2-dock__icon-btn--compact"
            onClick={onToggleMiniMode}
            title="Collapse dock to compact circle"
            aria-label="Collapse dock to compact circle"
          >
            <ChevronUp size={14} />
          </button>
        </div>
      </div>
    </footer>
  );
};
