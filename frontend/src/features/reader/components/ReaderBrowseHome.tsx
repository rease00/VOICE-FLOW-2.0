import React from 'react';
import { Search } from 'lucide-react';
import type { ReaderCatalogItem } from '../../../../types';
import { READER_HOME_TABS, getReaderHomeTabLabel, type ReaderHomeTab, type ReaderHomeTabCounts } from '../model/tabs';

interface ReaderBrowseHomeProps {
  homeTab: ReaderHomeTab;
  homeTabCounts: ReaderHomeTabCounts;
  searchTerm: string;
  items: ReaderCatalogItem[];
  selectedItemId: string;
  isLoading: boolean;
  onChangeHomeTab: (tab: ReaderHomeTab) => void;
  onChangeSearchTerm: (next: string) => void;
  onSelectItem: (itemId: string) => void;
  onOpenItem: (itemId: string) => void;
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

export const ReaderBrowseHome: React.FC<ReaderBrowseHomeProps> = ({
  homeTab,
  searchTerm,
  items,
  selectedItemId,
  isLoading,
  homeTabCounts,
  onChangeHomeTab,
  onChangeSearchTerm,
  onSelectItem,
  onOpenItem,
  resolveImportedStatusBadge,
  resolveMediaUrl,
}) => {
  const activeCount = Number(homeTabCounts[homeTab] || 0);
  return (
    <section className="vf-reader-v2-home" data-testid="reader-home">
      <header className="vf-reader-v2-home__hero">
        <div className="vf-reader-v2-home__hero-copy">
          <div className="vf-reader-v2-eyebrow">Reader Library</div>
          <h2>Find books, comics, and imports faster.</h2>
          <p>Search first, then use the filter chips to move between novels, manga, the full library, and your imported titles.</p>
        </div>
        <div className="vf-reader-v2-home__hero-metrics" aria-label="Reader shelf counts">
          {READER_HOME_TABS.map((tab) => {
            const count = Number(homeTabCounts[tab] || 0);
            const label = getReaderHomeTabLabel(tab);
            const isActive = homeTab === tab;
            return (
              <div key={tab} className={`vf-reader-v2-home__metric ${isActive ? 'vf-reader-v2-home__metric--active' : ''}`}>
                <span>{label}</span>
                <strong>{count.toLocaleString()}</strong>
              </div>
            );
          })}
        </div>
      </header>

      <section className="vf-reader-v2-home__controls">
        <label className="vf-reader-v2-home__search">
          <Search size={15} />
          <input
            value={searchTerm}
            onChange={(event) => onChangeSearchTerm(event.target.value)}
            placeholder="Search title, author, genre..."
            aria-label="Search reader catalog"
          />
        </label>
        <div className="vf-reader-v2-home__chips" role="group" aria-label="Reader home filters">
          {READER_HOME_TABS.map((tab) => {
            const count = Number(homeTabCounts[tab] || 0);
            const label = getReaderHomeTabLabel(tab);
            const isActive = homeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                aria-pressed={isActive}
                className={`vf-reader-v2-chip ${isActive ? 'vf-reader-v2-chip--active' : ''}`}
                onClick={() => onChangeHomeTab(tab)}
              >
                <span>{label}</span>
                <span className="vf-reader-v2-chip__count">{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        <div className="vf-reader-v2-home__summary">
          <span>
            Showing <strong>{items.length.toLocaleString()}</strong> {items.length === 1 ? 'title' : 'titles'}
          </span>
          <span>
            Shelf total <strong>{activeCount.toLocaleString()}</strong>
          </span>
        </div>
      </section>

      {isLoading ? <div className="vf-reader-v2-empty">Loading reader catalog...</div> : null}
      {!isLoading && items.length === 0 ? <div className="vf-reader-v2-empty">No titles found for this tab.</div> : null}

      <div className="vf-reader-v2-home__grid">
        {items.map((item) => {
          const imported = item.surface === 'uploads';
          const coverUrl = resolveMediaUrl(item.coverUrl);
          const importedBadge = imported ? resolveImportedStatusBadge(item) : '';
          return (
            <article
              key={item.id}
              className={`vf-reader-v2-card ${selectedItemId === item.id ? 'vf-reader-v2-card--active' : ''}`}
              onMouseEnter={() => onSelectItem(item.id)}
              onFocusCapture={() => onSelectItem(item.id)}
            >
              <button
                type="button"
                className="vf-reader-v2-card__cover"
                onClick={() => onOpenItem(item.id)}
                aria-label={`Open ${item.title}`}
              >
                {coverUrl ? (
                  <img src={coverUrl} alt={item.title} />
                ) : (
                  <div className="vf-reader-v2-card__cover-fallback">
                    <span className="vf-reader-v2-card__cover-eyebrow">{getItemShelfLabel(item)}</span>
                    <strong>{item.title}</strong>
                  </div>
                )}
              </button>
              <div className="vf-reader-v2-card__body">
                <div className="vf-reader-v2-card__meta">
                  <span>{getItemShelfLabel(item)}</span>
                  <span>{item.collectionLabel || item.provider}</span>
                  {imported ? <span className="vf-reader-v2-badge">{importedBadge}</span> : null}
                </div>
                <h3>{item.title}</h3>
                <p>{item.author}</p>
                <p className="vf-reader-v2-card__summary">{item.summary || 'Open to preview details and launch the player.'}</p>
                <div className="vf-reader-v2-card__stats">
                  <span>{getItemMeta(item)}</span>
                  <span>{Math.round(Number(item.resume?.progressPct || 0))}% complete</span>
                </div>
                <div className="vf-reader-v2-card__actions">
                  <button
                    type="button"
                    className="vf-reader-v2-primary vf-reader-v2-card__open"
                    onClick={() => onOpenItem(item.id)}
                    aria-label={`Open ${item.title}`}
                  >
                    Open
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
