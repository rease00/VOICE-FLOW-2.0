import React, { useMemo } from 'react';
import { Compass, PlayCircle, Search, UploadCloud } from 'lucide-react';
import type { ReaderCatalogItem, ReaderLibrary, ReaderSession } from '../../../../types';
import { getReaderPrimaryAction, type ReaderSurfaceFilter } from '../model/library';

interface ReaderBrowseHomeProps {
  library: ReaderLibrary | null;
  filteredItems: ReaderCatalogItem[];
  selectedItemId: string;
  resumeSession: ReaderSession | null;
  resumeItem: ReaderCatalogItem | null;
  surface: ReaderSurfaceFilter;
  regionId: string;
  searchQuery: string;
  resultsCountLabel: string;
  isLoading: boolean;
  onSelectSurface: (surface: ReaderSurfaceFilter) => void;
  onSelectRegion: (regionId: string) => void;
  onSetSearchQuery: (value: string) => void;
  onSelectItem: (itemId: string) => void;
  onOpenItem: (itemId: string) => void;
  onOpenImport: () => void;
  onResumeSession: () => void;
  resolveMediaUrl: (url: string | undefined) => string;
  formatCompactStat: (item: ReaderCatalogItem | null) => string;
  formatProgressLabel: (item: ReaderCatalogItem | null) => string;
}

const SURFACE_OPTIONS: Array<{ id: ReaderSurfaceFilter; label: string }> = [
  { id: 'all', label: 'novels' },
  { id: 'books', label: 'books' },
  { id: 'comics', label: 'manga/comics' },
];

const buildShelf = (source: ReaderCatalogItem[], surface: ReaderSurfaceFilter): ReaderCatalogItem[] =>
  source.filter((item) => {
    if (surface === 'all') return true;
    if (surface === 'uploads') return item.surface === 'uploads';
    return item.surface === surface;
  });

const buildReadingLibrary = (source: ReaderCatalogItem[], surface: ReaderSurfaceFilter): ReaderCatalogItem[] =>
  buildShelf(source, surface)
    .filter((item) => item.surface === 'uploads' || Boolean(item.sessionId || item.resume?.hasProgress))
    .sort((left, right) => {
      const rightScore = Number(right.resume?.progressPct || 0) + (right.sessionId ? 20 : 0) + (right.surface === 'uploads' ? 8 : 0);
      const leftScore = Number(left.resume?.progressPct || 0) + (left.sessionId ? 20 : 0) + (left.surface === 'uploads' ? 8 : 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''));
    });

const renderCardCover = (item: ReaderCatalogItem, resolveMediaUrl: (url: string | undefined) => string): React.ReactNode => {
  const coverUrl = resolveMediaUrl(item.coverUrl);
  if (coverUrl) {
    return <img src={coverUrl} alt={item.title} className="vf-reader-home__card-cover-image" />;
  }
  return (
    <div className="vf-reader-home__card-cover-fallback">
      <span>{item.title}</span>
    </div>
  );
};

const normalizeCommercialStatus = (value: string | null | undefined): 'allowed' | 'blocked' | 'review' | 'unknown' => {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'allowed' || safe === 'blocked' || safe === 'review') return safe;
  return 'unknown';
};

const formatCommercialLabel = (status: 'allowed' | 'blocked' | 'review' | 'unknown'): string => {
  if (status === 'allowed') return 'Commercial Ready';
  if (status === 'review') return 'Needs Review';
  if (status === 'blocked') return 'Blocked';
  return 'Reader Ready';
};

const formatProviderLabel = (value: string | undefined): string =>
  String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

const formatBlockedProvidersLabel = (providers: string[]): string => {
  if (!providers.length) return 'Catalog restrictions are active for non-vetted sources.';
  const labels = providers.slice(0, 3).map((provider) => formatProviderLabel(provider));
  return `Restricted source families: ${labels.join(', ')}${providers.length > 3 ? ` +${providers.length - 3} more` : ''}.`;
};

const resolveCardActionLabel = (item: ReaderCatalogItem): string => {
  const primaryAction = getReaderPrimaryAction(item);
  if (primaryAction.disabled) return primaryAction.label;
  if (primaryAction.intent === 'resume') return 'Resume Reading';
  return `Open In ${item.contentKind === 'comic' ? 'Manga Player' : 'Book Player'}`;
};

const ShelfSection: React.FC<{
  title: string;
  eyebrow: string;
  items: ReaderCatalogItem[];
  selectedItemId: string;
  onSelectItem: (itemId: string) => void;
  onOpenItem: (itemId: string) => void;
  resolveMediaUrl: (url: string | undefined) => string;
  formatCompactStat: (item: ReaderCatalogItem | null) => string;
  formatProgressLabel: (item: ReaderCatalogItem | null) => string;
}> = ({
  title,
  eyebrow,
  items,
  selectedItemId,
  onSelectItem,
  onOpenItem,
  resolveMediaUrl,
  formatCompactStat,
  formatProgressLabel,
}) => (
  <section className="vf-reader-home__shelf">
    <div className="vf-reader-home__shelf-head">
      <div>
        <span>{eyebrow}</span>
        <h3>{title}</h3>
      </div>
      <div className="vf-reader-home__shelf-count">{items.length} titles</div>
    </div>
    {items.length === 0 ? (
      <div className="vf-reader-home__empty-card">No surfaced titles yet for this section.</div>
    ) : (
      <div className="vf-reader-home__card-grid">
        {items.map((item) => {
          const primaryAction = getReaderPrimaryAction(item);
          const commercialStatus = normalizeCommercialStatus(item.commercialUseStatus);
          const commercialReason = commercialStatus === 'blocked' || commercialStatus === 'review'
            ? String(item.commercialUseReason || '').trim()
            : '';
          const actionLabel = resolveCardActionLabel(item);
          const isDisabled = primaryAction.disabled;
          const isCommercialRestricted = commercialStatus === 'blocked' || commercialStatus === 'review';

          return (
            <article
              key={item.id}
              className={[
                'vf-reader-home__card',
                selectedItemId === item.id ? 'vf-reader-home__card--selected' : '',
                isDisabled ? 'vf-reader-home__card--disabled' : '',
                isCommercialRestricted ? `vf-reader-home__card--${commercialStatus}` : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => onSelectItem(item.id)}
              onPointerDown={() => onSelectItem(item.id)}
              onFocusCapture={() => onSelectItem(item.id)}
            >
              <button
                type="button"
                className="vf-reader-home__card-cover"
                onClick={() => onOpenItem(item.id)}
                disabled={isDisabled}
                title={commercialReason || undefined}
              >
                {renderCardCover(item, resolveMediaUrl)}
              </button>
              <div className="vf-reader-home__card-body">
                <div className="vf-reader-home__card-tags">
                  <span>{item.surface === 'uploads' ? 'import' : 'legal discovery'}</span>
                  <span>{formatProviderLabel(item.provider)}</span>
                  <span className={`vf-reader-home__card-badge vf-reader-home__card-badge--${commercialStatus}`}>
                    {formatCommercialLabel(commercialStatus)}
                  </span>
                </div>
                <h4>{item.title}</h4>
                <p>{item.author}</p>
                {commercialReason ? <div className="vf-reader-home__card-reason">{commercialReason}</div> : null}
                <div className="vf-reader-home__card-meta">
                  <span>{formatCompactStat(item)}</span>
                  <span>{formatProgressLabel(item)}</span>
                </div>
                <button
                  type="button"
                  className="vf-reader-home__card-action"
                  onClick={() => onOpenItem(item.id)}
                  disabled={isDisabled}
                  title={commercialReason || undefined}
                >
                  {actionLabel}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    )}
  </section>
);

export const ReaderBrowseHome: React.FC<ReaderBrowseHomeProps> = ({
  library,
  filteredItems,
  selectedItemId,
  resumeSession,
  resumeItem,
  surface,
  regionId,
  searchQuery,
  resultsCountLabel,
  isLoading,
  onSelectSurface,
  onSelectRegion,
  onSetSearchQuery,
  onSelectItem,
  onOpenItem,
  onOpenImport,
  onResumeSession,
  resolveMediaUrl,
  formatCompactStat,
  formatProgressLabel,
}) => {
  const continueReading = useMemo(() => buildShelf(library?.shelves.continueReading || [], surface), [library?.shelves.continueReading, surface]);
  const discoveryRail = useMemo(() => buildShelf(library?.shelves.trending || [], surface), [library?.shelves.trending, surface]);
  const readingLibrary = useMemo(() => buildReadingLibrary(library?.items || [], surface), [library?.items, surface]);
  const newArrivals = useMemo(() => buildShelf(library?.shelves.newArrivals || [], surface), [library?.shelves.newArrivals, surface]);
  const selectedItem = useMemo(
    () => (library?.items || []).find((item) => item.id === selectedItemId) || null,
    [library?.items, selectedItemId]
  );
  const hasCommercialPolicy = Boolean(library?.commercialPolicyVersion || library?.blockedProviders?.length);
  const regionOptions = useMemo(() => {
    const safeRegions = (library?.regions || []).filter((region) => {
      const regionId = String(region?.id || '').trim();
      const label = String(region?.label || '').trim();
      return Boolean(regionId && label);
    });
    if (safeRegions.length > 0) return safeRegions;
    return [
      {
        id: regionId || 'global',
        label: isLoading ? 'Loading regions' : 'All regions',
      },
    ];
  }, [isLoading, library?.regions, regionId]);
  const isRegionSelectDisabled = regionOptions.length <= 1;

  return (
    <div className="vf-reader-home" data-testid="reader-browse-home">
      {hasCommercialPolicy ? (
        <section className="vf-reader-home__policy">
          <div className="vf-reader-home__policy-copy">
            <span>Commercial Mode</span>
            <strong>Reader is running with commercial rights checks enabled.</strong>
            <p>
              Use imported owned or licensed material for production work, and only open catalog titles marked commercial-ready.
              {' '}
              {formatBlockedProvidersLabel(library?.blockedProviders || [])}
            </p>
          </div>
          {library?.commercialPolicyVersion ? (
            <div className="vf-reader-home__policy-version">Policy {library.commercialPolicyVersion}</div>
          ) : null}
        </section>
      ) : null}

      <section className="vf-reader-home__hero">
        <div className="vf-reader-home__hero-copy">
          <div className="vf-reader-home__eyebrow">
            <Compass size={14} />
            Reader Home
          </div>
          <div className="vf-reader-home__hero-actions">
            <div className="vf-reader-home__surface-strip">
              {SURFACE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`vf-reader-home__chip ${surface === option.id ? 'vf-reader-home__chip--active' : ''}`}
                  onClick={() => onSelectSurface(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="vf-reader-home__hero-toolbar">
              <label className="vf-reader-home__search vf-reader-home__search--hero">
                <Search size={16} />
                <input value={searchQuery} onChange={(event) => onSetSearchQuery(event.target.value)} placeholder="search" aria-label="Search reader titles" />
              </label>
              <label className="vf-reader-home__region-toggle" aria-label="Reader region">
                <select value={regionOptions.some((region) => region.id === regionId) ? regionId : regionOptions[0]?.id} onChange={(event) => onSelectRegion(event.target.value)} disabled={isRegionSelectDisabled}>
                  {regionOptions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="vf-reader-home__hero-quick">
            <div className="vf-reader-home__hero-summary">
              <strong>{selectedItem?.title || 'Select a title from the shelves'}</strong>
              <span>{selectedItem ? formatCompactStat(selectedItem) : resultsCountLabel}</span>
            </div>
            <button
              type="button"
              className="vf-reader-home__ghost"
              onClick={onOpenImport}
            >
              <UploadCloud size={14} />
              Import To Player
            </button>
            <button
              type="button"
              className="vf-reader-home__primary"
              onClick={() => {
                if (!selectedItem) return;
                onOpenItem(selectedItem.id);
              }}
              disabled={!selectedItem}
            >
              <PlayCircle size={14} />
              Open Selected
            </button>
            {resumeSession && resumeItem ? (
              <button type="button" className="vf-reader-home__ghost" onClick={onResumeSession}>
                Resume {resumeItem.title}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="vf-reader-home__shelves">
        <ShelfSection
          title="Continue Reading"
          eyebrow="Creator Queue"
          items={continueReading}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectItem}
          onOpenItem={onOpenItem}
          resolveMediaUrl={resolveMediaUrl}
          formatCompactStat={formatCompactStat}
          formatProgressLabel={formatProgressLabel}
        />
        <ShelfSection
          title="Reading Library"
          eyebrow="Your Library"
          items={readingLibrary}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectItem}
          onOpenItem={onOpenItem}
          resolveMediaUrl={resolveMediaUrl}
          formatCompactStat={formatCompactStat}
          formatProgressLabel={formatProgressLabel}
        />
        <ShelfSection
          title="Top Trending"
          eyebrow="Discovery Rail"
          items={discoveryRail}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectItem}
          onOpenItem={onOpenItem}
          resolveMediaUrl={resolveMediaUrl}
          formatCompactStat={formatCompactStat}
          formatProgressLabel={formatProgressLabel}
        />
        <ShelfSection
          title="New Arrivals"
          eyebrow="Discovery Rail"
          items={newArrivals}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectItem}
          onOpenItem={onOpenItem}
          resolveMediaUrl={resolveMediaUrl}
          formatCompactStat={formatCompactStat}
          formatProgressLabel={formatProgressLabel}
        />
      </div>

      {isLoading ? <div className="vf-reader-home__loading">Loading Reader library...</div> : null}
      {filteredItems.length === 0 && !isLoading ? (
        <div className="vf-reader-home__loading">No titles match the current search or surface filter.</div>
      ) : null}
    </div>
  );
};
