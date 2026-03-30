import React, { useState } from 'react';
import { BookOpen, Download, Library, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReaderCatalogItem } from '../../../../types';
import { READER_HOME_TABS, getReaderHomeTabLabel, type ReaderHomeTab } from '../model/tabs';
import type { ReaderBootstrapState } from '../model/bootstrap';
import type { ReaderHomeViewModel } from '../model/dashboard';

interface ReaderBrowseHomeProps {
  viewModel: ReaderHomeViewModel;
  homeTab: ReaderHomeTab;
  searchTerm: string;
  selectedItemId: string;
  isLoading: boolean;
  bootstrapState: ReaderBootstrapState;
  legalAccepted: boolean;
  showImportFlow?: boolean;
  libraryErrorMessage: string;
  onChangeHomeTab: (tab: ReaderHomeTab) => void;
  onChangeSearchTerm: (next: string) => void;
  onSelectItem: (itemId: string) => void;
  onOpenItem: (itemId: string) => void;
  onAcceptReaderRights?: () => void;
  resolveImportedStatusBadge: (item: ReaderCatalogItem) => string;
  resolveMediaUrl: (url: string | undefined) => string;
}

const getItemMeta = (item: ReaderCatalogItem): string => {
  if (item.contentKind === 'comic') {
    const panels = Number(item.stats?.totalPanels || item.stats?.pageCount || 0);
    if (panels > 0) return `${panels.toLocaleString()} panels`;
    return 'Comic reader';
  }
  const chars = Number(item.stats?.totalChars || 0);
  if (chars > 0) return `${chars.toLocaleString()} chars`;
  return 'Novel reader';
};

const getItemShelfLabel = (item: ReaderCatalogItem): string => {
  if (item.surface === 'uploads') return 'Imported';
  return item.contentKind === 'comic' ? 'Manga / Comic' : 'Novel';
};

const getProgressPct = (item: ReaderCatalogItem): number => Math.max(0, Math.round(Number(item.resume?.progressPct || 0)));
const formatProgressLabel = (progressPct: number): string => `${Math.max(0, Math.round(progressPct))}% complete`;
const READER_HOME_TAB_ICONS: Record<ReaderHomeTab, LucideIcon> = {
  novels: BookOpen,
  library: Library,
  imported: Download,
};

export const ReaderBrowseHome: React.FC<ReaderBrowseHomeProps> = ({
  viewModel,
  homeTab,
  searchTerm,
  selectedItemId,
  isLoading,
  bootstrapState,
  legalAccepted,
  showImportFlow = false,
  libraryErrorMessage,
  onChangeHomeTab,
  onChangeSearchTerm,
  onSelectItem,
  onOpenItem,
  onAcceptReaderRights,
  resolveImportedStatusBadge,
  resolveMediaUrl,
}) => {
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});
  const activeCount = Number(viewModel.tabCounts[homeTab] || 0);

  const stateMessages = [
    (showImportFlow && !legalAccepted && bootstrapState !== 'needs_auth')
      ? {
          title: 'Reader rights pending',
          body: 'Accept the Reader rights prompt once to unlock imports and resume the home dashboard.',
        }
      : null,
    bootstrapState === 'loading'
      ? {
          title: 'Loading shelves',
          body: 'Reader is loading your dashboard and restoring the latest shelf state.',
        }
      : null,
    bootstrapState === 'needs_auth'
      ? {
          title: 'Sign in required',
          body: 'Sign in to restore Reader shelves, sessions, and your dashboard state.',
        }
      : null,
    bootstrapState === 'error'
      ? {
          title: 'Recoverable dashboard error',
          body: libraryErrorMessage || 'Reader could not load the dashboard right now. Retry after checking backend availability.',
        }
      : null,
  ].filter(Boolean) as Array<{ title: string; body: string }>;

  const shelfSections = viewModel.sections;
  const statePanel = stateMessages.length > 0 ? (
    <section className="vf-reader-v2-home__states" aria-label="Reader status panels">
      {stateMessages.map((message) => (
        <article key={message.title} className="vf-reader-v2-home__state-card">
          <strong>{message.title}</strong>
          <p>{message.body}</p>
          {message.title === 'Reader rights pending' ? (
            <button
              type="button"
              className="vf-reader-v2-primary"
              onClick={() => onAcceptReaderRights?.()}
            >
              Accept Once
            </button>
          ) : null}
        </article>
      ))}
    </section>
  ) : null;

  return (
    <section className="vf-reader-v2-home" data-testid="reader-home">
      {statePanel}

      <section className="vf-reader-v2-home__controls">
        <label className="vf-reader-v2-home__search">
          <Search size={15} />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onChangeSearchTerm(event.target.value)}
            placeholder="Search title, author, or collection"
            aria-label="Search reader catalog"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
          />
        </label>
        <div className="vf-reader-v2-home__chips" role="group" aria-label="Reader home filters">
          {READER_HOME_TABS.map((tab) => {
            const count = Number(viewModel.tabCounts[tab] || 0);
            const label = getReaderHomeTabLabel(tab);
            const isActive = homeTab === tab;
            const ChipIcon = READER_HOME_TAB_ICONS[tab];
            return (
              <button
                key={tab}
                type="button"
                aria-pressed={isActive}
                className={`vf-reader-v2-chip ${isActive ? 'vf-reader-v2-chip--active' : ''}`}
                onClick={() => onChangeHomeTab(tab)}
              >
                <span className="vf-reader-v2-chip__label">
                  <ChipIcon size={14} className="vf-reader-v2-chip__icon" aria-hidden="true" />
                  <span>{label}</span>
                </span>
                <span className="vf-reader-v2-chip__count">{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        <div className="vf-reader-v2-home__summary">
          <span>
            Showing <strong>{viewModel.visibleCount.toLocaleString()}</strong> {viewModel.visibleCount === 1 ? 'title' : 'titles'}
          </span>
          <span>
            Shelf total <strong>{viewModel.shelfTotal.toLocaleString()}</strong>
          </span>
          <span>
            Filtered <strong>{activeCount.toLocaleString()}</strong>
          </span>
        </div>
      </section>

      <section className="vf-reader-v2-home__shelves" aria-label="Reader shelves">
        {shelfSections.map((section) => (
          <article key={section.id} className="vf-reader-v2-home__shelf">
            <header className="vf-reader-v2-home__shelf-head">
              <div>
                <div className="vf-reader-v2-eyebrow">{section.label}</div>
                <h3>{section.heading}</h3>
                <p>{section.description}</p>
              </div>
              <div className="vf-reader-v2-home__shelf-count">{section.items.length.toLocaleString()}</div>
            </header>

            {section.items.length === 0 ? (
              <div className="vf-reader-v2-home__shelf-empty">{section.emptyMessage}</div>
            ) : (
              <div className="vf-reader-v2-home__shelf-grid">
                {section.items.map((item) => {
                  const imported = item.surface === 'uploads';
                  const coverUrl = resolveMediaUrl(item.coverUrl);
                  const progressPct = getProgressPct(item);
                  const showFallback = brokenImages[item.id] || !coverUrl;
                  return (
                    <article
                      key={item.id}
                      className={`vf-reader-v2-home__card ${selectedItemId === item.id ? 'vf-reader-v2-home__card--active' : ''}`}
                      onMouseEnter={() => onSelectItem(item.id)}
                      onFocusCapture={() => onSelectItem(item.id)}
                    >
                      <button
                        type="button"
                        className="vf-reader-v2-home__card-cover"
                        onClick={() => onOpenItem(item.id)}
                        aria-label={`Open ${item.title}`}
                      >
                        {showFallback ? (
                          <div className="vf-reader-v2-home__card-cover-fallback">
                            <span>{getItemShelfLabel(item)}</span>
                            <strong>{item.title}</strong>
                          </div>
                        ) : (
                          <img
                            src={coverUrl}
                            alt={item.title}
                            onError={() => setBrokenImages((current) => ({ ...current, [item.id]: true }))}
                          />
                        )}
                      </button>
                      <div className="vf-reader-v2-home__card-body">
                        <div className="vf-reader-v2-home__card-meta">
                          <span>{getItemShelfLabel(item)}</span>
                          <span>{item.collectionLabel || item.provider}</span>
                          {imported ? <span className="vf-reader-v2-badge">{resolveImportedStatusBadge(item)}</span> : null}
                        </div>
                        <h4>{item.title}</h4>
                        <p>{item.author}</p>
                        <div className="vf-reader-v2-home__card-progress">
                          <div className="vf-reader-v2-home__progress-track">
                            <div className="vf-reader-v2-home__progress-fill" style={{ width: `${progressPct}%` }} />
                          </div>
                          <span>{formatProgressLabel(progressPct)}</span>
                        </div>
                        <div className="vf-reader-v2-home__card-meta vf-reader-v2-home__card-meta--secondary">
                          <span>{getItemMeta(item)}</span>
                          <span>{item.summary || 'Open for a full Reader preview.'}</span>
                        </div>
                        <button type="button" className="vf-reader-v2-primary vf-reader-v2-home__card-open" onClick={() => onOpenItem(item.id)}>
                          Open
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </article>
        ))}
      </section>

    </section>
  );
};
