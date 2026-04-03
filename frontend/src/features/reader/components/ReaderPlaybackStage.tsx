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
  savedUnitIds?: string[];
  coverUrl: string;
  statusLabel: string;
  liveTickerText: string;
  vfEstimateLabel: string;
  vfEstimateDetail: string;
  contentScrollRef: React.RefObject<HTMLDivElement | null>;
  viewportMode?: 'mobile' | 'tablet' | 'desktop';
  onSelectUnit: (index: number) => void;
}

export const ReaderPlaybackStage: React.FC<ReaderPlaybackStageProps> = ({
  mode,
  title,
  summary,
  progressPct,
  activeUnitIndex,
  units,
  savedUnitIds = [],
  coverUrl,
  statusLabel,
  liveTickerText,
  vfEstimateLabel,
  vfEstimateDetail,
  contentScrollRef,
  viewportMode = 'desktop',
  onSelectUnit,
}) => {
  const activeUnit = units[activeUnitIndex] || null;
  const savedUnitIdSet = React.useMemo(() => new Set(
    savedUnitIds.map((id) => String(id || '').trim()).filter((id) => Boolean(id))
  ), [savedUnitIds]);
  const leftLabel = mode === 'novel' ? 'Chapter List' : 'Episode List';
  const centerLabel = mode === 'novel' ? 'Read' : 'Panels';
  const unitLabel = mode === 'novel' ? 'Chapter' : 'Panel';
  const isCompactViewport = viewportMode !== 'desktop';
  const glassPanelStyle: React.CSSProperties = {
    border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
    background: 'color-mix(in srgb, rgba(255,255,255,0.14) 68%, transparent)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    borderRadius: 999,
    padding: '10px 14px',
    minWidth: 0,
  };

  return (
    <section className="vf-reader-v2-stage" data-testid="reader-playback-stage" data-reader-zone="stage" data-reader-viewport={viewportMode} data-mode={mode}>
      <aside className="vf-reader-v2-stage__left">
        <div className="vf-reader-v2-stage__left-head">
          <strong>{leftLabel}</strong>
          <span>{units.length} {mode === 'novel' ? 'chapters' : 'episodes'}</span>
        </div>
        <div className="vf-reader-v2-stage__left-list">
          {units.map((unit, index) => {
            const isSaved = savedUnitIdSet.has(unit.id);
            const isActive = index === activeUnitIndex;
            return (
              <button
                key={unit.id}
                type="button"
                className={`vf-reader-v2-stage__left-item ${isActive ? 'vf-reader-v2-stage__left-item--active' : ''} ${isSaved ? 'vf-reader-v2-stage__left-item--saved' : ''}`}
                onClick={() => onSelectUnit(index)}
                data-saved={isSaved ? 'true' : 'false'}
                style={isSaved ? {
                  boxShadow: isActive
                    ? '0 0 0 1px color-mix(in srgb, currentColor 28%, transparent), 0 0 18px color-mix(in srgb, currentColor 24%, transparent)'
                    : '0 0 0 1px color-mix(in srgb, currentColor 18%, transparent), 0 0 14px color-mix(in srgb, currentColor 18%, transparent)',
                  background: isActive
                    ? 'color-mix(in srgb, rgba(92, 214, 163, 0.2) 66%, rgba(255,255,255,0.12))'
                    : 'color-mix(in srgb, rgba(92, 214, 163, 0.12) 50%, rgba(255,255,255,0.10))',
                } : undefined}
              >
                <span className="vf-reader-v2-stage__left-item-title">
                  {unit.title}
                  {isSaved ? <span style={{ marginLeft: 8, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 800, opacity: 0.9 }}>Saved</span> : null}
                </span>
                <span className="vf-reader-v2-stage__left-item-status">{unit.status}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div ref={contentScrollRef} className="vf-reader-v2-stage__center">
        <header className="vf-reader-v2-stage__hero">
          <div className="vf-reader-v2-stage__hero-copy">
            <div className="vf-reader-v2-eyebrow">{mode === 'novel' ? 'Novel Reader' : 'Comic Reader'}</div>
            <h2>{title}</h2>
            <p>{summary || (mode === 'novel'
              ? (isCompactViewport ? 'Read with synchronized audio.' : 'Read long-form text with synchronized audio.')
              : (isCompactViewport ? 'Follow panel playback.' : 'Follow panel playback with speaker-aware narration.'))}</p>
            <div className="vf-reader-v2-stage__hero-meta">
              <span>{centerLabel}</span>
              <span>{Math.round(progressPct)}% complete</span>
              <span>Status: {statusLabel}</span>
              <span>{units.length} units</span>
            </div>
            <div
              data-testid="reader-live-ticker"
              aria-live="polite"
              aria-atomic="true"
              style={glassPanelStyle}
            >
              <div style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 }}>
                <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.78 }}>
                  Live
                </span>
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 14,
                    lineHeight: 1.35,
                    fontWeight: 600,
                  }}
                  title={liveTickerText || activeUnit?.body || activeUnit?.title || summary || title}
                >
                  {liveTickerText || activeUnit?.body || activeUnit?.title || summary || title}
                </span>
              </div>
            </div>
          </div>
          <div className="vf-reader-v2-stage__cover" style={{ display: 'grid', gap: 10 }}>
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
            <div
              data-testid="reader-vf-estimate"
              style={{
                ...glassPanelStyle,
                borderRadius: 20,
                display: 'grid',
                gap: 4,
                textAlign: 'right',
              }}
            >
              <strong style={{ fontSize: 14, lineHeight: 1.2 }}>{vfEstimateLabel}</strong>
              <span style={{ fontSize: 12, opacity: 0.78 }}>{vfEstimateDetail}</span>
            </div>
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
