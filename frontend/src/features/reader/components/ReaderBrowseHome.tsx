import React from 'react';
import { Compass, LayoutGrid, List, PanelsTopLeft, Search, Sparkles } from 'lucide-react';
import type { ReaderCatalogItem, ReaderLibrary, ReaderSession } from '../../../../types';
import type { ReaderPrimaryAction, ReaderSurfaceFilter } from '../model/library';
import type { ReaderViewMode } from './readerTypes';

interface ReaderBrowseHomeProps {
  library: ReaderLibrary | null;
  filteredItems: ReaderCatalogItem[];
  selectedItem: ReaderCatalogItem | null;
  resumeSession: ReaderSession | null;
  resumeItem: ReaderCatalogItem | null;
  surface: ReaderSurfaceFilter;
  regionId: string;
  resultsCountLabel: string;
  viewMode: ReaderViewMode;
  isLoading: boolean;
  currentPrimaryAction: ReaderPrimaryAction | null;
  onSelectSurface: (surface: ReaderSurfaceFilter) => void;
  onSelectRegion: (regionId: string) => void;
  onSelectItem: (itemId: string) => void;
  onPrimaryAction: () => void;
  onResumeSession: () => void;
  onOpenTools: () => void;
  onOpenAudit: () => void;
  onSetViewMode: (mode: ReaderViewMode) => void;
  resolveMediaUrl: (url: string | undefined) => string;
  formatCompactStat: (item: ReaderCatalogItem | null) => string;
  formatProgressLabel: (item: ReaderCatalogItem | null) => string;
}

const SURFACE_LABELS: Array<{ id: ReaderSurfaceFilter; label: string }> = [
  { id: 'all', label: 'All Collections' },
  { id: 'books', label: 'Books' },
  { id: 'comics', label: 'Manga & Comics' },
  { id: 'uploads', label: 'Imports' },
];

const SHELF_LABELS: Record<keyof ReaderLibrary['shelves'], string> = {
  continueReading: 'Continue Reading',
  trending: 'Trending & Popular',
  newArrivals: 'New Releases',
  recentlyImported: 'Recently Imported',
};

const renderCover = (
  item: ReaderCatalogItem,
  resolveMediaUrl: (url: string | undefined) => string,
  className: string
): React.ReactNode => {
  const coverUrl = resolveMediaUrl(item.coverUrl);
  if (coverUrl) {
    return <img src={coverUrl} alt={item.title} className={className} />;
  }
  return (
    <div className={`${className} vf-reader__poster-fallback`}>
      <span>{item.title}</span>
    </div>
  );
};

export const ReaderBrowseHome: React.FC<ReaderBrowseHomeProps> = ({
  library,
  filteredItems,
  selectedItem,
  resumeSession,
  resumeItem,
  surface,
  regionId,
  resultsCountLabel,
  viewMode,
  isLoading,
  currentPrimaryAction,
  onSelectSurface,
  onSelectRegion,
  onSelectItem,
  onPrimaryAction,
  onResumeSession,
  onOpenTools,
  onOpenAudit,
  onSetViewMode,
  resolveMediaUrl,
  formatCompactStat,
  formatProgressLabel,
}) => {
  const featuredItem = resumeItem || selectedItem || library?.shelves.trending[0] || library?.items[0] || null;
  const shelfEntries = (Object.keys(SHELF_LABELS) as Array<keyof ReaderLibrary['shelves']>).map((key) => ({
    key,
    label: SHELF_LABELS[key],
    items: (library?.shelves[key] || []).slice(0, 2),
    total: (library?.shelves[key] || []).length,
  }));
  const previewResults = filteredItems.slice(0, viewMode === 'grid' ? 8 : 6);
  const hiddenResultsCount = Math.max(0, filteredItems.length - previewResults.length);
  const featuredUsesResume = Boolean(resumeSession && resumeItem && featuredItem?.id === resumeItem.id);

  return (
    <div className="vf-reader__browse-home" data-testid="reader-browse-home">
      <section className="vf-reader__hero">
        <div className="vf-reader__hero-grid">
          <div className="vf-reader__hero-copy">
            <div className="vf-reader__eyebrow">
              <Compass size={14} />
              Reader Home
            </div>
            <h2 className="vf-reader__hero-title">
              Scroll-first browsing, episode-style discovery, and a reading flow that stays focused on the art.
            </h2>
            <p className="vf-reader__hero-lede">
              Browse comics and books like a premium shelf, then enter playback only when you explicitly want to read or listen.
            </p>
            <div className="vf-reader__chip-row">
              {SURFACE_LABELS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`vf-reader__chip ${surface === option.id ? 'vf-reader__chip--active' : ''}`}
                  onClick={() => onSelectSurface(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="vf-reader__chip-row">
              {(library?.regions || []).map((region) => (
                <button
                  key={region.id}
                  type="button"
                  className={`vf-reader__chip vf-reader__chip--subtle ${regionId === region.id ? 'vf-reader__chip--active' : ''}`}
                  onClick={() => onSelectRegion(region.id)}
                >
                  {region.label}
                </button>
              ))}
            </div>
            {resumeSession && (
              <div className="vf-reader__resume-banner">
                <div className="vf-reader__resume-copy">
                  <div className="vf-reader__section-eyebrow">Resume Session</div>
                  <strong>{resumeSession.title}</strong>
                  <p>
                    {Math.round(resumeSession.progressPct)}% complete
                    {resumeSession.contentKind === 'comic'
                      ? ` | ${Math.min(resumeSession.currentPanelIndex + 1, Math.max(1, resumeSession.totalPanels))}/${Math.max(1, resumeSession.totalPanels)} panels read`
                      : ` | ${resumeSession.consumedChars.toLocaleString()}/${Math.max(1, resumeSession.totalChars).toLocaleString()} chars read`}
                  </p>
                </div>
                <div className="vf-reader__action-row">
                  <button type="button" className="vf-reader__btn vf-reader__btn--primary" onClick={onResumeSession}>
                    Continue Reading
                  </button>
                  <button type="button" className="vf-reader__btn vf-reader__btn--secondary" onClick={onOpenAudit}>
                    Review Audit
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="vf-reader__feature-panel">
            {featuredItem ? (
              <>
                <div className="vf-reader__feature-cover">
                  {renderCover(featuredItem, resolveMediaUrl, 'vf-reader__feature-cover-image')}
                </div>
                <div className="vf-reader__feature-body">
                  <div className="vf-reader__meta-line">
                    <span className="vf-reader__pill">{featuredItem.collectionLabel || featuredItem.provider}</span>
                    <span className="vf-reader__pill vf-reader__pill--muted">{featuredItem.contentKind}</span>
                    {featuredUsesResume && <span className="vf-reader__pill vf-reader__pill--muted">Live resume</span>}
                  </div>
                  <div>
                    <div className="vf-reader__feature-title">{featuredItem.title}</div>
                    <div className="vf-reader__feature-author">{featuredItem.author}</div>
                  </div>
                  <p className="vf-reader__feature-summary">{featuredItem.summary || 'Prepared for Reader playback.'}</p>
                  <div className="vf-reader__stat-grid">
                    <div className="vf-reader__stat-card">
                      <span className="vf-reader__stat-label">Progress</span>
                      <strong>{featuredUsesResume ? `${Math.round(resumeSession?.progressPct || 0)}% complete` : formatProgressLabel(featuredItem)}</strong>
                    </div>
                    <div className="vf-reader__stat-card">
                      <span className="vf-reader__stat-label">Collection</span>
                      <strong>{formatCompactStat(featuredItem)}</strong>
                    </div>
                  </div>
                  <div className="vf-reader__action-row">
                    <button
                      type="button"
                      className="vf-reader__btn vf-reader__btn--primary"
                      onClick={featuredUsesResume ? onResumeSession : onPrimaryAction}
                      disabled={!featuredUsesResume && Boolean(currentPrimaryAction?.disabled)}
                    >
                      {featuredUsesResume ? 'Continue Reading' : currentPrimaryAction?.label || 'Prepare'}
                    </button>
                    <button type="button" className="vf-reader__btn vf-reader__btn--secondary" onClick={onOpenTools}>
                      Tools
                    </button>
                    <button type="button" className="vf-reader__btn vf-reader__btn--ghost" onClick={onOpenAudit}>
                      Audit
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="vf-reader__empty">
                <Sparkles size={18} />
                <div>
                  <strong>No featured title yet</strong>
                  <p>Open the Tools panel to import content or adjust filters.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="vf-reader__section">
        <div className="vf-reader__section-header">
          <div>
            <div className="vf-reader__section-eyebrow">Discovery Rail</div>
            <h3>Compact Reader shelves</h3>
          </div>
          <p className="vf-reader__section-note">Each rail previews top surfaced titles without forcing the reader into playback.</p>
        </div>

        <div className="vf-reader__shelf-grid">
          {shelfEntries.map((shelf) => (
            <div key={shelf.key} className="vf-reader__shelf-card">
              <div className="vf-reader__shelf-head">
                <div>
                  <div className="vf-reader__section-eyebrow">Discovery Rail</div>
                  <h3>{shelf.label}</h3>
                </div>
                <span className="vf-reader__pill vf-reader__pill--muted">
                  {shelf.total.toLocaleString()} title{shelf.total === 1 ? '' : 's'}
                </span>
              </div>

              {shelf.items.length === 0 && (
                <div className="vf-reader__empty vf-reader__empty--compact">
                  <PanelsTopLeft size={18} />
                  <div>
                    <strong>Nothing surfaced yet</strong>
                    <p>Try another region or import a title from the Tools panel.</p>
                  </div>
                </div>
              )}

              {shelf.items.length > 0 && (
                <div className="vf-reader__shelf-stack">
                  {shelf.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`vf-reader__shelf-item ${selectedItem?.id === item.id ? 'vf-reader__shelf-item--selected' : ''}`}
                      onClick={() => onSelectItem(item.id)}
                    >
                      <div className="vf-reader__shelf-item-cover">
                        {renderCover(item, resolveMediaUrl, 'vf-reader__shelf-item-cover-image')}
                      </div>
                      <div className="vf-reader__shelf-item-body">
                        <div className="vf-reader__shelf-item-title">{item.title}</div>
                        <div className="vf-reader__shelf-item-subtitle">{item.author}</div>
                        <div className="vf-reader__rail-meta">
                          <span>{formatCompactStat(item)}</span>
                          <span>{formatProgressLabel(item)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="vf-reader__section">
        <div className="vf-reader__section-header">
          <div>
            <div className="vf-reader__section-eyebrow">Library Results</div>
            <h3>{resultsCountLabel}</h3>
            {hiddenResultsCount > 0 && (
              <p className="vf-reader__section-note">
                Showing the first {previewResults.length} titles here. Use the Library panel for the full catalog.
              </p>
            )}
          </div>
          <div className="vf-reader__toggle-row">
            <button
              type="button"
              className={`vf-reader__icon-toggle ${viewMode === 'grid' ? 'vf-reader__icon-toggle--active' : ''}`}
              onClick={() => onSetViewMode('grid')}
              aria-label="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              className={`vf-reader__icon-toggle ${viewMode === 'list' ? 'vf-reader__icon-toggle--active' : ''}`}
              onClick={() => onSetViewMode('list')}
              aria-label="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="vf-reader__empty">
            <Search size={18} />
            <div>
              <strong>Loading Reader library...</strong>
              <p>Fetching shelves, resumable sessions, and imports.</p>
            </div>
          </div>
        )}

        {!isLoading && filteredItems.length === 0 && (
          <div className="vf-reader__empty">
            <Search size={18} />
            <div>
              <strong>No titles match the current filters</strong>
              <p>Use the Tools panel to change provider, region, or import your own content.</p>
            </div>
          </div>
        )}

        {!isLoading && previewResults.length > 0 && (
          <div className={viewMode === 'grid' ? 'vf-reader__results-grid' : 'vf-reader__results-list'}>
            {previewResults.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`vf-reader__result-card ${viewMode === 'list' ? 'vf-reader__result-card--list' : ''} ${selectedItem?.id === item.id ? 'vf-reader__result-card--selected' : ''}`}
                onClick={() => onSelectItem(item.id)}
              >
                <div className={viewMode === 'grid' ? 'vf-reader__result-cover' : 'vf-reader__result-cover vf-reader__result-cover--list'}>
                  {renderCover(item, resolveMediaUrl, viewMode === 'grid' ? 'vf-reader__result-cover-image' : 'vf-reader__result-cover-image vf-reader__result-cover-image--list')}
                </div>
                <div className="vf-reader__result-body">
                  <div className="vf-reader__meta-line">
                    <span className="vf-reader__pill">{item.collectionLabel || item.provider}</span>
                    <span className="vf-reader__pill vf-reader__pill--muted">{item.contentKind}</span>
                  </div>
                  <div className="vf-reader__result-title">{item.title}</div>
                  <div className="vf-reader__result-subtitle">{item.author}</div>
                  <p className="vf-reader__result-summary">{item.summary || 'Prepared for Reader playback.'}</p>
                  <div className="vf-reader__rail-meta">
                    <span>{formatCompactStat(item)}</span>
                    <span>{formatProgressLabel(item)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
