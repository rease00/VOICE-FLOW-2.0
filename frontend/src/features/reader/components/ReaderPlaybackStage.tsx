import React from 'react';
import { Expand, Languages, Minimize2, PanelsTopLeft, ScrollText } from 'lucide-react';
import type { ReaderCatalogItem, ReaderSession } from '../../../../types';
import type { PlaylistItem } from './readerTypes';

interface ReaderPlaybackStageProps {
  session: ReaderSession;
  sessionItem: ReaderCatalogItem | null;
  activeItem: PlaylistItem | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onSelectWindow: (startChar: number | undefined) => void;
  onSelectPanel: (panelIndex: number) => void;
  resolveMediaUrl: (url: string | undefined) => string;
  panelRefs: React.MutableRefObject<Record<number, HTMLButtonElement | null>>;
  pauseAutoSwipe: () => void;
  targetLanguageLabel: string;
  pageViewModeLabel: string;
}

const formatActiveHeadline = (activeItem: PlaylistItem | null): string =>
  activeItem?.title || 'Preparing first playable chunk';

const formatActiveText = (activeItem: PlaylistItem | null, session: ReaderSession): string => {
  if (activeItem?.text) return activeItem.text;
  if (session.contentKind === 'comic') return 'Reader is preparing panel audio and translation state.';
  return 'Reader is preparing narration windows and translated page copy.';
};

const formatPrepStageLabel = (stage: string | undefined): string => {
  const safe = String(stage || '').trim().toLowerCase();
  if (safe === 'manifest') return 'Manifest';
  if (safe === 'assets') return 'Assets';
  if (safe === 'ocr') return 'OCR';
  if (safe === 'audio') return 'Audio';
  return 'Preparation';
};

const formatPrepSummary = (session: ReaderSession): string => {
  const prep = session.prep;
  if (!prep) return 'Preparation telemetry unavailable.';
  const base = `${prep.completedItems}/${prep.totalItems} prepared`;
  if (prep.failedItems > 0) return `${base} • ${prep.failedItems} failed`;
  return base;
};

export const ReaderPlaybackStage: React.FC<ReaderPlaybackStageProps> = ({
  session,
  sessionItem,
  activeItem,
  isFullscreen,
  onToggleFullscreen,
  onSelectWindow,
  onSelectPanel,
  resolveMediaUrl,
  panelRefs,
  pauseAutoSwipe,
  targetLanguageLabel,
  pageViewModeLabel,
}) => {
  const heroCover = resolveMediaUrl(session.coverUrl || sessionItem?.coverUrl);
  const progressLabel = session.contentKind === 'comic'
    ? `${Math.min(session.currentPanelIndex + 1, Math.max(1, session.totalPanels))}/${Math.max(1, session.totalPanels)} panels`
    : `${session.consumedChars.toLocaleString()}/${Math.max(1, session.totalChars).toLocaleString()} chars`;
  const prepTone = String(session.prep?.state || 'ready').trim().toLowerCase();

  return (
    <div className="vf-reader__playback-stage" data-testid="reader-playback-stage">
      <section className="vf-reader__playback-hero">
        <div className="vf-reader__playback-hero-copy">
          <div className="vf-reader__eyebrow">
            {session.contentKind === 'comic' ? <PanelsTopLeft size={14} /> : <ScrollText size={14} />}
            Playback Stage
          </div>
          <div className="vf-reader__playback-header">
            <div>
              <h2 className="vf-reader__playback-title">{session.title}</h2>
              <p className="vf-reader__playback-lede">
                {session.contentKind === 'comic'
                  ? 'Continuous-scroll reading surface with translation state and panel-by-panel voice prep.'
                  : 'Focused reading surface with narration windows, translation state, and export-ready audio.'}
              </p>
            </div>
            <button
              type="button"
              className="vf-reader__btn vf-reader__btn--secondary"
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>
          <div className="vf-reader__chip-row">
            <span className="vf-reader__pill">{session.readiness?.label || 'Preparing playback'}</span>
            {session.prep ? <span className="vf-reader__pill vf-reader__pill--muted">{formatPrepSummary(session)}</span> : null}
            <span className="vf-reader__pill vf-reader__pill--muted">{Math.round(session.progressPct)}% complete</span>
            <span className="vf-reader__pill vf-reader__pill--muted">{progressLabel}</span>
            <span className="vf-reader__pill vf-reader__pill--muted">{pageViewModeLabel}</span>
            <span className="vf-reader__pill vf-reader__pill--muted">{targetLanguageLabel}</span>
          </div>
          {session.prep ? (
            <div className={`vf-reader__prep-banner vf-reader__prep-banner--${prepTone}`}>
              <div className="vf-reader__prep-banner-head">
                <strong>Preparation {session.prep.state}</strong>
                <span>{formatPrepStageLabel(session.prep.stage)}</span>
              </div>
              <p>{session.prep.message || (session.prep.failedItems > 0 ? 'Reader completed hydration with degraded pages.' : 'Reader is preparing this session in the background.')}</p>
            </div>
          ) : null}
          <div className="vf-reader__active-focus">
            <div className="vf-reader__active-label">Now Focused</div>
            <div className="vf-reader__active-title">{formatActiveHeadline(activeItem)}</div>
            <p>{formatActiveText(activeItem, session)}</p>
            <div className="vf-reader__meta-line vf-reader__meta-line--compact">
              <Languages size={14} />
              <span>{session.ttsLanguageMode === 'target' ? `Narrating in ${targetLanguageLabel}` : 'Narrating from original script context'}</span>
            </div>
          </div>
        </div>

        <div className="vf-reader__playback-hero-art">
          {heroCover ? (
            <img src={heroCover} alt={session.title} className="vf-reader__playback-hero-image" />
          ) : (
            <div className="vf-reader__poster-fallback vf-reader__playback-hero-image">
              <span>{session.title}</span>
            </div>
          )}
        </div>
      </section>

      {session.contentKind === 'book' ? (
        <section className="vf-reader__stage-body">
          <div className="vf-reader__section-header">
            <div>
              <div className="vf-reader__section-eyebrow">Narration Windows</div>
              <h3>Playback timeline</h3>
            </div>
          </div>
          <div className="vf-reader__window-grid">
            {session.windows.map((item) => {
              const isActive = activeItem?.kind === 'window' && activeItem.startChar === item.startChar;
              const status = item.job?.status || item.translationStatus || item.status || 'pending';
              return (
                <button
                  key={`window-${item.index}`}
                  type="button"
                  className={`vf-reader__window-card ${isActive ? 'vf-reader__window-card--active' : ''}`}
                  onClick={() => onSelectWindow(item.startChar)}
                >
                  <div className="vf-reader__window-head">
                    <strong>Window {item.index + 1}</strong>
                    <span className="vf-reader__pill vf-reader__pill--muted">{status}</span>
                  </div>
                  <p>{item.displayText || item.translatedText || item.sourceText || item.text || 'Preparing text...'}</p>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="vf-reader__stage-body vf-reader__stage-body--webtoon">
          <div className="vf-reader__section-header vf-reader__section-header--webtoon">
            <div>
              <div className="vf-reader__section-eyebrow">Webtoon Reader</div>
              <h3>Continuous scroll episode</h3>
            </div>
            <p className="vf-reader__section-note">
              Scroll naturally through the strip. Tap any panel to jump audio focus and pause auto-advance.
            </p>
          </div>
          <div className="vf-reader__webtoon-shell" onWheel={pauseAutoSwipe} onTouchStart={pauseAutoSwipe}>
            <div className="vf-reader__webtoon-feed">
              {session.panels.map((panel) => {
                const isActive = activeItem?.kind === 'panel' && activeItem.panelIndex === panel.index;
                const panelImageUrl = resolveMediaUrl(panel.imageUrl);
                const status = panel.audioJob?.status || panel.audioStatus || 'pending';
                return (
                  <button
                    key={panel.panelId}
                    type="button"
                    ref={(element) => {
                      panelRefs.current[panel.index] = element;
                    }}
                    className={`vf-reader__panel-card vf-reader__webtoon-card ${isActive ? 'vf-reader__panel-card--active' : ''}`}
                    onClick={() => onSelectPanel(panel.index)}
                  >
                    <div className="vf-reader__webtoon-card-frame">
                      {panelImageUrl ? (
                        <img src={panelImageUrl} alt={`Panel ${panel.index + 1}`} className="vf-reader__webtoon-image" />
                      ) : (
                        <div className="vf-reader__poster-fallback vf-reader__webtoon-image">
                          <span>{panel.emotion || 'Neutral'} panel</span>
                        </div>
                      )}
                    </div>
                    <div className="vf-reader__webtoon-caption">
                      <div className="vf-reader__window-head">
                        <strong>Panel {panel.index + 1}</strong>
                        <span className="vf-reader__pill vf-reader__pill--muted">{status}</span>
                      </div>
                      <p>{panel.displayText || panel.translatedText || panel.sourceText || panel.text || 'Preparing panel text...'}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
