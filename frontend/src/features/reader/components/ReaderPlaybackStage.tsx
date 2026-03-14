import React from 'react';
import { Languages, PanelsTopLeft, ScrollText } from 'lucide-react';
import type { ReaderCatalogItem, ReaderSession } from '../../../../types';
import type { PlaylistItem } from './readerTypes';

interface ReaderPlaybackStageProps {
  session: ReaderSession;
  sessionItem: ReaderCatalogItem | null;
  activeItem: PlaylistItem | null;
  onSelectWindow: (startChar: number | undefined) => void;
  onSelectPanel: (panelIndex: number) => void;
  resolveMediaUrl: (url: string | undefined) => string;
  panelRefs: React.MutableRefObject<Record<number, HTMLButtonElement | null>>;
  pauseAutoSwipe: () => void;
  targetLanguageLabel: string;
  pageViewModeLabel: string;
  audioEngineLabel: string;
  audioEngineStatus: string;
}

export const ReaderPlaybackStage: React.FC<ReaderPlaybackStageProps> = ({
  session,
  sessionItem,
  activeItem,
  onSelectWindow,
  onSelectPanel,
  resolveMediaUrl,
  panelRefs,
  pauseAutoSwipe,
  targetLanguageLabel,
  pageViewModeLabel,
  audioEngineLabel,
  audioEngineStatus,
}) => {
  const heroCover = resolveMediaUrl(session.coverUrl || sessionItem?.coverUrl);
  const activeText = activeItem?.text || session.summary || 'Preparing the next playable unit.';
  const commercialStatus = String(session.commercialUseStatus || sessionItem?.commercialUseStatus || '').trim().toLowerCase();
  const commercialLabel = commercialStatus === 'review'
    ? 'Commercial: Needs Review'
    : commercialStatus === 'blocked'
      ? 'Commercial: Blocked'
      : 'Commercial: Ready';
  const policyNote = String(session.commercialUseReason || sessionItem?.commercialUseReason || '').trim();
  const activePanel = session.contentKind === 'comic'
    ? session.panels.find((panel) => panel.index === activeItem?.panelIndex) || session.panels[0] || null
    : null;
  const activeWindow = session.contentKind === 'book'
    ? session.windows.find((window) => window.startChar === activeItem?.startChar) || session.windows[0] || null
    : null;
  const activePanelImageUrl = resolveMediaUrl(activePanel?.imageUrl);
  const activePanelText = activePanel?.displayText || activePanel?.translatedText || activePanel?.sourceText || activePanel?.text || activeText;
  const activeWindowText = activeWindow?.displayText || activeWindow?.translatedText || activeWindow?.sourceText || activeWindow?.text || activeText;

  return (
    <div className="vf-reader-player" data-testid="reader-playback-stage">
      <section className="vf-reader-player__hero">
        <div className="vf-reader-player__headline">
          <div className="vf-reader-player__eyebrow">
            {session.contentKind === 'comic' ? <PanelsTopLeft size={14} /> : <ScrollText size={14} />}
            {session.contentKind === 'comic' ? 'Manga / Comic Player' : 'Novel / Book Player'}
          </div>
          <h2>{session.title}</h2>
          <p>{session.summary || (session.contentKind === 'comic' ? 'Audio-first panel pacing with visual hold and fallback timer advance.' : 'Live highlighted reading windows with non-blocking preload.')}</p>
          <div className="vf-reader-player__meta">
            <span>{pageViewModeLabel}</span>
            <span>{targetLanguageLabel}</span>
            <span>{audioEngineLabel}</span>
            <span>Status: {audioEngineStatus}</span>
            {session.provider ? <span>Source: {session.provider}</span> : null}
            {session.license ? <span>License: {session.license}</span> : null}
            <span>{commercialLabel}</span>
          </div>
          {policyNote ? <div className="vf-reader-player__policy-note">{policyNote}</div> : null}
        </div>
        <div className="vf-reader-player__poster">
          {heroCover ? <img src={heroCover} alt={session.title} /> : <div className="vf-reader-player__poster-fallback">{session.title}</div>}
        </div>
      </section>

      {session.contentKind === 'book' ? (
        <div className="vf-reader-player__book-layout">
          <section className="vf-reader-player__focus vf-reader-player__focus--book">
            <div className="vf-reader-player__focus-head">
              <strong>{activeItem?.title || 'Active reading window'}</strong>
              <div className="vf-reader-player__focus-language">
                <Languages size={14} />
                <span>{session.ttsLanguageMode === 'target' ? `Narrating in ${targetLanguageLabel}` : 'Narrating source text'}</span>
              </div>
            </div>
            <article className="vf-reader-player__focus-article">
              <p className="vf-reader-player__active-line">{activeWindowText}</p>
            </article>
          </section>

          <section className="vf-reader-player__book-stage">
            <header>
              <span>Chapter windows</span>
              <strong>{Math.round(session.progressPct)}% complete</strong>
            </header>
            <div className="vf-reader-player__book-scroll">
              {session.windows.map((item) => {
                const isActive = activeItem?.kind === 'window' && activeItem.startChar === item.startChar;
                return (
                  <button
                    key={`reader-window-${item.index}`}
                    type="button"
                    className={`vf-reader-player__window ${isActive ? 'vf-reader-player__window--active' : ''}`}
                    onClick={() => onSelectWindow(item.startChar)}
                  >
                    <div className="vf-reader-player__window-head">
                      <span>Window {item.index + 1}</span>
                      <strong>{item.job?.status || item.translationStatus || item.status || 'queued'}</strong>
                    </div>
                    <p>{item.displayText || item.translatedText || item.sourceText || item.text || 'Preparing book text...'}</p>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
        <div className="vf-reader-player__comic-layout" onWheel={pauseAutoSwipe} onTouchStart={pauseAutoSwipe}>
          <section className="vf-reader-player__focus vf-reader-player__focus--comic">
            <div className="vf-reader-player__focus-head">
              <strong>{activeItem?.title || 'Active panel'}</strong>
              <div className="vf-reader-player__focus-language">
                <Languages size={14} />
                <span>{session.ttsLanguageMode === 'target' ? `Narrating in ${targetLanguageLabel}` : 'Narrating source text'}</span>
              </div>
            </div>
            <div className="vf-reader-player__focus-panel">
              <div className="vf-reader-player__panel-frame">
                {activePanelImageUrl ? <img src={activePanelImageUrl} alt="Active panel" /> : <div className="vf-reader-player__poster-fallback">Active panel</div>}
              </div>
              <div className="vf-reader-player__panel-caption">
                <div className="vf-reader-player__window-head">
                  <span>Panel {(activePanel?.index || 0) + 1}</span>
                  <strong>{activePanel?.audioJob?.status || activePanel?.audioStatus || 'queued'}</strong>
                </div>
                <p className="vf-reader-player__active-line">{activePanelText}</p>
              </div>
            </div>
          </section>

          <section className="vf-reader-player__comic-stage">
            {session.panels.map((panel) => {
              const isActive = activeItem?.kind === 'panel' && activeItem.panelIndex === panel.index;
              const panelImageUrl = resolveMediaUrl(panel.imageUrl);
              return (
                <button
                  key={panel.panelId}
                  type="button"
                  ref={(element) => {
                    panelRefs.current[panel.index] = element;
                  }}
                  className={`vf-reader-player__panel ${isActive ? 'vf-reader-player__panel--active' : ''}`}
                  onClick={() => onSelectPanel(panel.index)}
                >
                  <div className="vf-reader-player__panel-frame">
                    {panelImageUrl ? <img src={panelImageUrl} alt={`Panel ${panel.index + 1}`} /> : <div className="vf-reader-player__poster-fallback">Panel {panel.index + 1}</div>}
                  </div>
                  <div className="vf-reader-player__panel-caption">
                    <div className="vf-reader-player__window-head">
                      <span>Panel {panel.index + 1}</span>
                      <strong>{panel.audioJob?.status || panel.audioStatus || 'queued'}</strong>
                    </div>
                    <p className={isActive ? 'vf-reader-player__active-line' : ''}>{panel.displayText || panel.translatedText || panel.sourceText || panel.text || 'Preparing panel text...'}</p>
                  </div>
                </button>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
};
