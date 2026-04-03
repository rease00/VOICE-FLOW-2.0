import type {
  ReaderCatalogItem,
  ReaderDashboardHighlights,
  ReaderDashboardMission,
  ReaderDashboardPayload,
  ReaderDashboardShelves,
  ReaderLibrary,
  ReaderSession,
} from '../../../../types';
import type { ReaderHomeTab, ReaderHomeTabCounts } from './tabs';
import { resolveHomeTabItems, sortReaderItems } from './library';

export interface ReaderDashboardSection {
  id: 'continueReading' | 'trending' | 'newArrivals' | 'recentlyImported';
  label: string;
  heading: string;
  description: string;
  emptyMessage: string;
  items: ReaderCatalogItem[];
}

export interface ReaderHomeViewModel {
  spotlight: ReaderCatalogItem | null;
  sections: ReaderDashboardSection[];
  tabItems: Record<ReaderHomeTab, ReaderCatalogItem[]>;
  tabCounts: ReaderHomeTabCounts;
  visibleCount: number;
  shelfTotal: number;
  highlights: ReaderDashboardHighlights;
  mission: ReaderDashboardMission;
}

type DashboardShape = Record<string, unknown>;

export const EMPTY_READER_LIBRARY: ReaderLibrary = {
  surface: 'all',
  regionId: 'english',
  regions: [],
  items: [],
  activeSession: null,
  activeSessions: [],
  counts: {
    all: 0,
    visible: 0,
    books: 0,
    comics: 0,
    uploads: 0,
    resumable: 0,
  },
  facets: {
    providers: [],
    collections: [],
    progressStates: [],
  },
  shelves: {
    continueReading: [],
    trending: [],
    newArrivals: [],
    recentlyImported: [],
  },
};

const DEFAULT_MISSION: ReaderDashboardMission = {
  title: 'Play any novel with AI TTS',
  subtitle: 'Jump back into active sessions, browse your shelves, and launch imports without losing your place.',
  ctaText: 'Open your library and press Play',
};

const normalizeText = (value: string | undefined): string =>
  String(value || '').trim().toLowerCase();

const matchesSearch = (item: ReaderCatalogItem, searchTerm: string): boolean => {
  const query = normalizeText(searchTerm);
  if (!query) return true;
  const haystack = [
    item.title,
    item.author,
    item.summary,
    item.provider,
    item.collectionLabel,
  ].map((value) => normalizeText(value)).join(' ');
  return haystack.includes(query);
};

const matchesHomeTab = (item: ReaderCatalogItem, homeTab: ReaderHomeTab): boolean => {
  if (homeTab === 'novels') return item.contentKind === 'book' && item.surface !== 'uploads';
  if (homeTab === 'imported') return item.surface === 'uploads';
  return item.surface !== 'uploads';
};

const filterSectionItems = (
  items: ReaderCatalogItem[],
  homeTab: ReaderHomeTab,
  searchTerm: string
): ReaderCatalogItem[] => sortReaderItems(items.filter((item) => matchesHomeTab(item, homeTab) && matchesSearch(item, searchTerm)));

const buildDashboardHighlights = (library: ReaderLibrary): ReaderDashboardHighlights => ({
  library: Number(library.counts?.all || library.items.length || 0),
  resumable: Number(library.counts?.resumable || 0),
  uploads: Number(library.counts?.uploads || 0),
  comics: Number(library.counts?.comics || 0),
  books: Number(library.counts?.books || 0),
});

const resolveSpotlightItem = (library: ReaderLibrary, shelves: ReaderDashboardShelves): ReaderCatalogItem | null => (
  shelves.continueReading[0]
  || shelves.trending[0]
  || shelves.newArrivals[0]
  || shelves.recentlyImported[0]
  || library.items[0]
  || null
);

const normalizeDashboardShelves = (
  candidate: DashboardShape,
  fallback: ReaderDashboardShelves
): ReaderDashboardShelves => ({
  continueReading: Array.isArray(candidate.continueReading) ? candidate.continueReading as ReaderCatalogItem[] : fallback.continueReading,
  trending: Array.isArray(candidate.trending) ? candidate.trending as ReaderCatalogItem[] : fallback.trending,
  newArrivals: Array.isArray(candidate.newArrivals) ? candidate.newArrivals as ReaderCatalogItem[] : fallback.newArrivals,
  recentlyImported: Array.isArray(candidate.recentlyImported) ? candidate.recentlyImported as ReaderCatalogItem[] : fallback.recentlyImported,
});

const normalizeReaderLibraryShape = (value: unknown): ReaderLibrary | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.items) || typeof candidate.counts !== 'object' || !Array.isArray(candidate.regions)) return null;
  return candidate as unknown as ReaderLibrary;
};

const normalizeReaderDashboardShape = (payload: unknown): DashboardShape | null => {
  if (!payload || typeof payload !== 'object') return null;
  return payload as DashboardShape;
};

export const buildReaderDashboardPayloadFromLibrary = (library: ReaderLibrary): ReaderDashboardPayload => ({
  library,
  mission: DEFAULT_MISSION,
  highlights: buildDashboardHighlights(library),
  spotlight: resolveSpotlightItem(library, library.shelves),
  shelves: library.shelves,
  activeSessionSummary: library.activeSession || library.activeSessions?.[0] || null,
  ...(library.commercialPolicyVersion ? { commercialPolicyVersion: String(library.commercialPolicyVersion).trim() } : {}),
  blockedProviders: Array.isArray(library.blockedProviders)
    ? library.blockedProviders.map((value) => String(value || '').trim()).filter(Boolean)
    : [],
});

export const normalizeReaderDashboardPayload = (payload: unknown): ReaderDashboardPayload | null => {
  const candidate = normalizeReaderDashboardShape(payload);
  if (!candidate) return null;

  const dashboardCandidate = candidate.dashboard && typeof candidate.dashboard === 'object'
    ? candidate.dashboard as DashboardShape
    : candidate;
  const library =
    normalizeReaderLibraryShape(dashboardCandidate.library)
    || normalizeReaderLibraryShape(candidate.library)
    || normalizeReaderLibraryShape(dashboardCandidate)
    || normalizeReaderLibraryShape(candidate);
  if (!library) return null;

  const fallback = buildReaderDashboardPayloadFromLibrary(library);
  const missionCandidate = dashboardCandidate.mission && typeof dashboardCandidate.mission === 'object'
    ? dashboardCandidate.mission as DashboardShape
    : null;
  const highlightsCandidate = dashboardCandidate.highlights && typeof dashboardCandidate.highlights === 'object'
    ? dashboardCandidate.highlights as DashboardShape
    : null;
  const shelvesCandidate = dashboardCandidate.shelves && typeof dashboardCandidate.shelves === 'object'
    ? dashboardCandidate.shelves as DashboardShape
    : null;
  const spotlightCandidate = dashboardCandidate.spotlight && typeof dashboardCandidate.spotlight === 'object'
    ? dashboardCandidate.spotlight as ReaderCatalogItem
    : null;
  const sessionCandidate = dashboardCandidate.activeSessionSummary && typeof dashboardCandidate.activeSessionSummary === 'object'
    ? dashboardCandidate.activeSessionSummary as ReaderSession
    : null;
  const blockedProviders = Array.isArray(dashboardCandidate.blockedProviders)
    ? dashboardCandidate.blockedProviders.map((value) => String(value || '').trim()).filter(Boolean)
    : fallback.blockedProviders || [];
  const commercialPolicyVersion = String(
    dashboardCandidate.commercialPolicyVersion
    || candidate.commercialPolicyVersion
    || fallback.commercialPolicyVersion
    || ''
  ).trim();

  return {
    library,
    mission: {
    title: String(missionCandidate?.title || fallback.mission.title).trim(),
      subtitle: String(missionCandidate?.subtitle || fallback.mission.subtitle).trim(),
      ctaText: String(missionCandidate?.ctaText || fallback.mission.ctaText).trim(),
    },
    highlights: {
      library: Number(highlightsCandidate?.library || fallback.highlights.library || 0),
      resumable: Number(highlightsCandidate?.resumable || fallback.highlights.resumable || 0),
      uploads: Number(highlightsCandidate?.uploads || fallback.highlights.uploads || 0),
      comics: Number(highlightsCandidate?.comics || fallback.highlights.comics || 0),
      books: Number(highlightsCandidate?.books || fallback.highlights.books || 0),
    },
    spotlight: spotlightCandidate || resolveSpotlightItem(library, fallback.shelves),
    shelves: shelvesCandidate ? normalizeDashboardShelves(shelvesCandidate, library.shelves) : library.shelves,
    activeSessionSummary: sessionCandidate || fallback.activeSessionSummary,
    ...(commercialPolicyVersion ? { commercialPolicyVersion } : {}),
    blockedProviders,
  };
};

export const resolveReaderHomeViewModel = (
  dashboard: ReaderDashboardPayload,
  homeTab: ReaderHomeTab,
  searchTerm: string
): ReaderHomeViewModel => {
  const library = dashboard.library;
  const tabItems: Record<ReaderHomeTab, ReaderCatalogItem[]> = {
    novels: sortReaderItems(resolveHomeTabItems(library, 'novels', searchTerm)),
    library: sortReaderItems(resolveHomeTabItems(library, 'library', searchTerm)),
    imported: sortReaderItems(resolveHomeTabItems(library, 'imported', searchTerm)),
  };
  const tabCounts: ReaderHomeTabCounts = {
    novels: tabItems.novels.length,
    library: tabItems.library.length,
    imported: tabItems.imported.length,
  };
  const candidateSections: ReaderDashboardSection[] = [
    ...(homeTab === 'library'
      ? [{
          id: 'continueReading' as const,
          label: 'Continue Reading',
          heading: 'Resume without losing your place',
          description: 'Recent sessions and titles with progress stay pinned here first.',
          emptyMessage: 'No resumable titles match this filter yet.',
          items: filterSectionItems(dashboard.shelves.continueReading || [], homeTab, searchTerm),
        }]
      : []),
    {
      id: 'trending',
      label: 'Trending',
      heading: 'Popular picks from your Reader library',
      description: 'Cover-led browsing for the titles most ready to launch next.',
      emptyMessage: 'No trending titles match this filter yet.',
      items: filterSectionItems(dashboard.shelves.trending || [], homeTab, searchTerm),
    },
    {
      id: 'newArrivals',
      label: 'New Arrivals',
      heading: 'Fresh additions',
      description: 'Recently added novels and imports.',
      emptyMessage: 'No new arrivals match this filter yet.',
      items: filterSectionItems(dashboard.shelves.newArrivals || [], homeTab, searchTerm),
    },
    {
      id: 'recentlyImported',
      label: 'Recently Imported',
      heading: 'Your latest imports',
      description: 'Jump straight back into the files you brought into Reader.',
      emptyMessage: 'No imported titles match this filter yet.',
      items: filterSectionItems(dashboard.shelves.recentlyImported || [], homeTab, searchTerm),
    },
  ];
  const sections = candidateSections.filter((section) => section.items.length > 0);
  const visibleCount = tabCounts[homeTab];
  const renderedShelves = {
    continueReading: sections.find((section) => section.id === 'continueReading')?.items || [],
    trending: sections.find((section) => section.id === 'trending')?.items || [],
    newArrivals: sections.find((section) => section.id === 'newArrivals')?.items || [],
    recentlyImported: sections.find((section) => section.id === 'recentlyImported')?.items || [],
  };

  return {
    spotlight: resolveSpotlightItem(library, renderedShelves),
    sections,
    tabItems,
    tabCounts,
    visibleCount,
    shelfTotal:
      renderedShelves.continueReading.length
      + renderedShelves.trending.length
      + renderedShelves.newArrivals.length
      + renderedShelves.recentlyImported.length,
    highlights: dashboard.highlights,
    mission: dashboard.mission,
  };
};
