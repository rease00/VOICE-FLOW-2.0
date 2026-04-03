import React, { useEffect, useState } from "react";
import { BookOpen, Download, Library, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReaderCatalogItem } from "../../../../types";
import {
  READER_HOME_TABS,
  getReaderHomeTabLabel,
  type ReaderHomeTab,
} from "../model/tabs";
import type { ReaderBootstrapState } from "../model/bootstrap";
import type { ReaderHomeViewModel } from "../model/dashboard";
import { toUserMessage } from "../../../shared/notifications/format";

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
  onRetryDashboard?: () => void;
  onAcceptReaderRights?: () => void;
  resolveImportedStatusBadge: (item: ReaderCatalogItem) => string;
  resolveMediaUrl: (url: string | undefined) => string;
  viewportMode?: "mobile" | "tablet" | "desktop";
}

const getItemMeta = (item: ReaderCatalogItem): string => {
  if (item.contentKind === "comic") {
    const panels = Number(
      item.stats?.totalPanels || item.stats?.pageCount || 0,
    );
    if (panels > 0) return `${panels.toLocaleString()} panels`;
    return "Comic reader";
  }
  const chars = Number(item.stats?.totalChars || 0);
  if (chars > 0) return `${chars.toLocaleString()} chars`;
  return "Novel reader";
};

const getItemShelfLabel = (item: ReaderCatalogItem): string => {
  if (item.surface === "uploads") return "Imported";
  return item.contentKind === "comic" ? "Manga / Comic" : "Novel";
};

const getProgressPct = (item: ReaderCatalogItem): number =>
  Math.max(0, Math.round(Number(item.resume?.progressPct || 0)));

const getShelfVisibleCardCount = (
  viewportMode: "mobile" | "tablet" | "desktop",
): number => {
  if (viewportMode === "mobile") return 4;
  if (viewportMode === "tablet") return 6;
  return 8;
};

const getShelfRailItemLimit = (
  viewportMode: "mobile" | "tablet" | "desktop",
): number => {
  if (viewportMode === "mobile") return 10;
  if (viewportMode === "tablet") return 12;
  return 15;
};

const getReaderShelfEmptyMessage = (
  homeTab: ReaderHomeTab,
  searchTerm: string,
): string => {
  if (String(searchTerm || "").trim()) {
    return "No reader titles match this search yet.";
  }
  if (homeTab === "library") {
    return "Your library rail will fill up once you open or save titles.";
  }
  if (homeTab === "imported") {
    return "Imported titles will appear here after you add files to Reader.";
  }
  return "Fresh titles will appear here as soon as your Reader shelves are ready.";
};

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
  onRetryDashboard,
  onAcceptReaderRights,
  resolveImportedStatusBadge,
  resolveMediaUrl,
  viewportMode = "desktop",
}) => {
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const isCompactViewport = viewportMode !== "desktop";
  const shelfVisibleCardCount = getShelfVisibleCardCount(viewportMode);
  const shelfRailItemLimit = getShelfRailItemLimit(viewportMode);
  const activeCount = Number(viewModel.tabCounts[homeTab] || 0);
  const safeDashboardErrorMessage = toUserMessage(
    libraryErrorMessage,
    "Reader could not load the dashboard right now. Retry after checking backend availability.",
  );
  const shelfSections = viewModel.sections;
  const shelfEmptyMessage = getReaderShelfEmptyMessage(homeTab, searchTerm);

  useEffect(() => {
    setExpandedSections({});
  }, [homeTab, searchTerm, viewportMode]);

  const stateMessages = [
    showImportFlow && !legalAccepted && bootstrapState !== "needs_auth"
      ? {
          title: "Reader rights pending",
          body: "Accept the Reader rights prompt once to unlock imports and resume the home dashboard.",
        }
      : null,
    bootstrapState === "loading"
      ? {
          title: "Loading shelves",
          body: "Reader is loading your dashboard and restoring the latest shelf state.",
        }
      : null,
    bootstrapState === "needs_auth"
      ? {
          title: "Sign in required",
          body: "Sign in to restore Reader shelves, sessions, and your dashboard state.",
        }
      : null,
    bootstrapState === "error"
      ? {
          title: "Recoverable dashboard error",
          body: safeDashboardErrorMessage,
        }
      : null,
  ].filter(Boolean) as Array<{ title: string; body: string }>;

  const statePanel =
    stateMessages.length > 0 ? (
      <section
        className="vf-reader-v2-home__states"
        aria-label="Reader status panels"
      >
        {stateMessages.map((message) => (
          <article
            key={message.title}
            className="vf-reader-v2-home__state-card"
          >
            <strong>{message.title}</strong>
            <p>{message.body}</p>
            {message.title === "Reader rights pending" ? (
              <button
                type="button"
                className="vf-reader-v2-primary"
                onClick={() => onAcceptReaderRights?.()}
              >
                Accept Once
              </button>
            ) : null}
            {message.title === "Recoverable dashboard error" ? (
              <button
                type="button"
                className="vf-reader-v2-secondary"
                onClick={() => onRetryDashboard?.()}
              >
                Retry
              </button>
            ) : null}
          </article>
        ))}
      </section>
    ) : null;

  return (
    <div
      data-testid="reader-browse-home"
      data-reader-zone="home"
      data-reader-viewport={viewportMode}
      data-reader-loading={isLoading ? "true" : "false"}
    >
      <section className="vf-reader-v2-home" data-testid="reader-home">
        {statePanel}

        <section className="vf-reader-v2-home__controls vf-topbar">
          <label className="vf-reader-v2-home__search">
            <Search size={15} />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => onChangeSearchTerm(event.target.value)}
              placeholder={isCompactViewport ? "Search titles" : "Search title, author, or collection"}
              aria-label="Search reader catalog"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
            />
          </label>
          <div
            className="vf-reader-v2-home__chips"
            role="group"
            aria-label="Reader home filters"
          >
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
                  className={`vf-reader-v2-chip ${isActive ? "vf-reader-v2-chip--active" : ""}`}
                  onClick={() => onChangeHomeTab(tab)}
                >
                  <span className="vf-reader-v2-chip__label">
                    <ChipIcon
                      size={14}
                      className="vf-reader-v2-chip__icon"
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </span>
                  <span className="vf-reader-v2-chip__count">
                    {count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="vf-reader-v2-home__summary">
            <span>
              Showing <strong>{viewModel.visibleCount.toLocaleString()}</strong>{" "}
              {viewModel.visibleCount === 1 ? "title" : "titles"}
            </span>
            <span>
              Shelf total{" "}
              <strong>{viewModel.shelfTotal.toLocaleString()}</strong>
            </span>
            <span>
              Filtered <strong>{activeCount.toLocaleString()}</strong>
            </span>
          </div>
        </section>

        <section
          className="vf-reader-v2-home__shelves"
          aria-label="Reader shelves"
          data-reader-item-limit={shelfRailItemLimit}
          data-reader-visible-cards={shelfVisibleCardCount}
        >
          {shelfSections.length > 0 ? (
            shelfSections.map((section) => {
              const expanded = Boolean(expandedSections[section.id]);
              const canExpand = section.items.length > shelfRailItemLimit;
              const visibleItems = expanded
                ? section.items
                : section.items.slice(0, shelfRailItemLimit);
              const shelfRailStyle = {
                ["--reader-v2-shelf-visible" as string]: String(shelfVisibleCardCount),
              } as React.CSSProperties;

              return (
                <article key={section.id} className="vf-reader-v2-home__shelf">
                  <header className="vf-reader-v2-home__shelf-head">
                    <div>
                      <div className="vf-reader-v2-eyebrow">{section.label}</div>
                      <h3>{section.heading}</h3>
                      <p>{section.description}</p>
                    </div>
                    <div className="vf-reader-v2-home__shelf-actions">
                      <div className="vf-reader-v2-home__shelf-count">
                        {section.items.length.toLocaleString()}
                      </div>
                      {canExpand ? (
                        <button
                          type="button"
                          className="vf-reader-v2-secondary vf-reader-v2-home__shelf-more"
                          aria-expanded={expanded}
                          aria-controls={`reader-shelf-${section.id}`}
                          onClick={() =>
                            setExpandedSections((current) => ({
                              ...current,
                              [section.id]: !expanded,
                            }))
                          }
                        >
                          {expanded ? "Less" : "More"}
                        </button>
                      ) : null}
                    </div>
                  </header>

                  <div
                    id={`reader-shelf-${section.id}`}
                    className="vf-reader-v2-home__shelf-grid"
                    style={shelfRailStyle}
                    data-reader-visible-cards={shelfVisibleCardCount}
                    data-reader-expanded={expanded ? "true" : "false"}
                    data-testid={`reader-shelf-${section.id}`}
                  >
                    {visibleItems.map((item, itemIndex) => {
                      const imported = item.surface === "uploads";
                      const coverUrl = resolveMediaUrl(item.coverUrl);
                      const progressPct = getProgressPct(item);
                      const showProgress = progressPct > 0;
                      const byline =
                        item.author
                        || item.collectionLabel
                        || item.provider
                        || getItemMeta(item);
                      const showFallback = brokenImages[item.id] || !coverUrl;
                      const shouldPrioritizeCover =
                        section.id === shelfSections[0]?.id
                        && itemIndex < Math.min(4, shelfVisibleCardCount);

                      return (
                        <article
                          key={item.id}
                          className={`vf-reader-v2-home__card ${selectedItemId === item.id ? "vf-reader-v2-home__card--active" : ""}`}
                          onMouseEnter={() => onSelectItem(item.id)}
                          onFocusCapture={() => onSelectItem(item.id)}
                          data-reader-home-card={item.id}
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
                                loading={shouldPrioritizeCover ? "eager" : "lazy"}
                                decoding="async"
                                fetchPriority={shouldPrioritizeCover ? "high" : "low"}
                                onError={() =>
                                  setBrokenImages((current) => ({
                                    ...current,
                                    [item.id]: true,
                                  }))
                                }
                              />
                            )}
                          </button>
                          <div className="vf-reader-v2-home__card-body">
                            <div className="vf-reader-v2-home__card-meta">
                              <span className="vf-reader-v2-home__card-label">{getItemShelfLabel(item)}</span>
                              {imported ? (
                                <span className="vf-reader-v2-badge">
                                  {resolveImportedStatusBadge(item)}
                                </span>
                              ) : null}
                            </div>
                            <h4 title={item.title}>{item.title}</h4>
                            <p title={byline}>{byline}</p>
                            {showProgress ? (
                              <div className="vf-reader-v2-home__card-progress">
                                <div className="vf-reader-v2-home__progress-track">
                                  <div
                                    className="vf-reader-v2-home__progress-fill"
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                                <span>{progressPct}%</span>
                              </div>
                            ) : (
                              <div className="vf-reader-v2-home__card-meta vf-reader-v2-home__card-meta--secondary">
                                <span>{getItemMeta(item)}</span>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="vf-reader-v2-home__empty-state">
              <div className="vf-reader-v2-home__shelf-empty">
                {shelfEmptyMessage}
              </div>
            </div>
          )}
        </section>
      </section>
    </div>
  );
};
