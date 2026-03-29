import React from 'react';
import type { ReaderMode } from '../model/tabs';
import type { ReaderPlayableUnit } from '../model/session';
import { ReaderCover } from './ReaderCover';

interface ReaderPlaybackStageProps {
  mode: ReaderMode;
  title: string;
  summary: string;
  progressPct: number;
  activeUnitIndex: number;
  units: ReaderPlayableUnit[];
  coverUrl: string;
  statusLabel: string;
  contentScrollRef: React.RefObject<HTMLDivElement | null>;
  onSelectUnit: (index: number) => void;
}

export const ReaderPlaybackStage: React.FC<ReaderPlaybackStageProps> = ({
  mode,
  title,
  summary,
  progressPct,
  activeUnitIndex,
  units,
  coverUrl,
  statusLabel,
  contentScrollRef,
  onSelectUnit,
}) => {
  const activeUnit = units[activeUnitIndex] || null;
  const leftLabel = mode === 'novel' ? 'Chapter List' : 'Episode List';
  const centerLabel = mode === 'novel' ? 'Read' : 'Panels';
  const unitLabel = mode === 'novel' ? 'Chapter' : 'Panel';

  return (
    <section className="vf-reader-v2-stage" data-testid="reader-playback-stage" data-mode={mode}>
      <aside className="vf-reader-v2-stage__left">
        <div className="vf-reader-v2-stage__left-head">
          <strong>{leftLabel}</strong>
          <span>{units.length} {mode === 'novel' ? 'chapters' : 'episodes'}</span>
        </div>
        <div className="vf-reader-v2-stage__left-list">
          {units.map((unit, index) => (
            <button
              key={unit.id}
              type="button"
              className={`vf-reader-v2-stage__left-item ${index === activeUnitIndex ? 'vf-reader-v2-stage__left-item--active' : ''}`}
              onClick={() => onSelectUnit(index)}
            >
              <span className="vf-reader-v2-stage__left-item-title">{unit.title}</span>
              <span className="vf-reader-v2-stage__left-item-status">{unit.status}</span>
            </button>
          ))}
        </div>
      </aside>

      <div ref={contentScrollRef} className="vf-reader-v2-stage__center">
        <header className="vf-reader-v2-stage__hero">
          <div className="vf-reader-v2-stage__hero-copy">
            <div className="vf-reader-v2-eyebrow">{mode === 'novel' ? 'Novel Reader' : 'Comic Reader'}</div>
            <h2>{title}</h2>
            <p>{summary || (mode === 'novel' ? 'Read long-form text with synchronized audio.' : 'Follow panel playback with speaker-aware narration.')}</p>
            <div className="vf-reader-v2-stage__hero-meta">
              <span>{centerLabel}</span>
              <span>{Math.round(progressPct)}% complete</span>
              <span>Status: {statusLabel}</span>
              <span>{units.length} units</span>
            </div>
          </div>
          <div className="vf-reader-v2-stage__cover">
            <ReaderCover
              src={coverUrl}
              title={title}
              subtitle={summary || statusLabel}
              eyebrow={mode === 'novel' ? 'Novel Reader' : 'Comic Reader'}
              alt={title}
              variant="stage"
              loading="eager"
              fetchPriority="high"
              className="vf-reader-v2-stage__cover-shell"
            />
          </div>
        </header>

        <article className="vf-reader-v2-stage__active">
          <div className="vf-reader-v2-stage__active-head">
            <strong>{activeUnit?.title || (mode === 'novel' ? 'Read' : 'Panels')}</strong>
            <span className="vf-reader-v2-stage__active-status">{activeUnit?.status || 'queued'}</span>
          </div>
          <p>{activeUnit?.body || `Pick a ${unitLabel.toLowerCase()} to begin playback.`}</p>
        </article>
      </div>
    </section>
  );
};
