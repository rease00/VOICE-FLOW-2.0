import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationSettings, ReaderCatalogItem, ReaderLibrary, ReaderLegalAck, ReaderSession } from '../../../../types';
import { LANGUAGES, MUSIC_TRACKS, VOICES } from '../../../../constants';
import { parseMultiSpeakerScript } from '../../../../services/geminiService';
import { readStorageJson, writeStorageJson } from '../../../shared/storage/localStore';
import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { resolveApiUrl } from '../../../shared/api/config';
import { useUser } from '../../auth/context/UserContext';
import { autoAssignSpeakerVoices } from '../../../shared/voices/castAssignment';
import {
  acceptReaderLegalAck,
  createReaderSession,
  createReaderUpload,
  deleteReaderSession,
  exportReaderSessionAudio,
  getReaderLegalAck,
  getReaderLibrary,
  getReaderSession,
  getReaderTtsJobAudio,
  saveReaderSession,
  updateReaderProgress,
} from '../api/readerApi';
import {
  filterReaderLibraryItems,
  getReaderAutoAdvanceDelay,
  getReaderPrimaryAction,
  isReaderAutoSwipeAvailable,
  type ReaderLibraryFilters,
  type ReaderSortOption,
  type ReaderSurfaceFilter,
} from '../model/library';
import {
  getReaderDeleteCountdownLabel,
  READER_BILLING_RULE,
  shouldTriggerReaderPanelPrefetch,
  shouldTriggerReaderWindowPrefetch,
} from '../model/session';
import { formatReaderMultiSpeakerMode, getReaderEffectiveMultiSpeakerMode } from '../model/multiSpeaker';
import { ReaderBrowseHome } from './ReaderBrowseHome';
import { ReaderControlPanel } from './ReaderControlPanel';
import { ReaderPlaybackStage } from './ReaderPlaybackStage';
import { ReaderPlayerDock } from './ReaderStickyDock';
import { deriveReaderAuditModel } from './readerAudit';
import { getReaderThemeClassName } from './readerTheme';
import type {
  PlaylistItem,
  ReaderAutoAdvanceProfile,
  ReaderContentFilter,
  ReaderPanelSection,
  ReaderProgressFilter,
  ReaderResolvedTheme,
  ReaderViewMode,
  UploadContentType,
} from './readerTypes';
import './reader.css';
interface ReaderTabContentProps {
  mediaBackendUrl: string;
  settings?: GenerationSettings;
  resolvedTheme: ReaderResolvedTheme;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface ReaderPreferences {
  surface: ReaderSurfaceFilter;
  regionId: string;
  musicTrackId: string;
  speechVolume: number;
  musicVolume: number;
  panelCollapsed: boolean;
  searchQuery: string;
  targetLanguage: string;
  pageViewMode: 'original' | 'translated';
  ttsLanguageMode: 'auto' | 'source' | 'target';
  provider: string;
  collection: string;
  progress: ReaderProgressFilter;
  contentKind: ReaderContentFilter;
  sort: ReaderSortOption;
  viewMode: ReaderViewMode;
  autoAdvanceProfile: ReaderAutoAdvanceProfile;
  multiSpeakerEnabled: boolean;
}

const READER_DESKTOP_MEDIA_QUERY = '(min-width: 1180px)';

const DEFAULT_PREFS: ReaderPreferences = {
  surface: 'all',
  regionId: 'english',
  musicTrackId: 'm_none',
  speechVolume: 1,
  musicVolume: 0.3,
  panelCollapsed: false,
  searchQuery: '',
  targetLanguage: '',
  pageViewMode: 'original',
  ttsLanguageMode: 'auto',
  provider: 'all',
  collection: 'all',
  progress: 'all',
  contentKind: 'all',
  sort: 'featured',
  viewMode: 'grid',
  autoAdvanceProfile: 'off',
  multiSpeakerEnabled: true,
};

const base64ToObjectUrl = (audioBase64: string, mediaType: string): string | null => {
  const safe = String(audioBase64 || '').trim();
  if (!safe) return null;
  try {
    const binary = atob(safe);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: mediaType || 'audio/wav' }));
  } catch {
    return null;
  }
};

const readPrefs = (settings?: GenerationSettings): ReaderPreferences => {
  const stored = readStorageJson<Partial<ReaderPreferences>>(STORAGE_KEYS.readerPreferences);
  return {
    surface: stored?.surface || DEFAULT_PREFS.surface,
    regionId: typeof stored?.regionId === 'string' && stored.regionId.trim() ? stored.regionId : DEFAULT_PREFS.regionId,
    musicTrackId: typeof stored?.musicTrackId === 'string' && stored.musicTrackId.trim() ? stored.musicTrackId : String(settings?.musicTrackId || DEFAULT_PREFS.musicTrackId),
    speechVolume: typeof stored?.speechVolume === 'number' ? stored.speechVolume : Number(settings?.speechVolume ?? DEFAULT_PREFS.speechVolume),
    musicVolume: typeof stored?.musicVolume === 'number' ? stored.musicVolume : Number(settings?.musicVolume ?? DEFAULT_PREFS.musicVolume),
    panelCollapsed: typeof stored?.panelCollapsed === 'boolean' ? stored.panelCollapsed : DEFAULT_PREFS.panelCollapsed,
    searchQuery: typeof stored?.searchQuery === 'string' ? stored.searchQuery : DEFAULT_PREFS.searchQuery,
    targetLanguage: typeof stored?.targetLanguage === 'string' ? stored.targetLanguage : DEFAULT_PREFS.targetLanguage,
    pageViewMode: stored?.pageViewMode || DEFAULT_PREFS.pageViewMode,
    ttsLanguageMode: stored?.ttsLanguageMode || DEFAULT_PREFS.ttsLanguageMode,
    provider: typeof stored?.provider === 'string' ? stored.provider : DEFAULT_PREFS.provider,
    collection: typeof stored?.collection === 'string' ? stored.collection : DEFAULT_PREFS.collection,
    progress: stored?.progress || DEFAULT_PREFS.progress,
    contentKind: stored?.contentKind || DEFAULT_PREFS.contentKind,
    sort: stored?.sort || DEFAULT_PREFS.sort,
    viewMode: stored?.viewMode || DEFAULT_PREFS.viewMode,
    autoAdvanceProfile: stored?.autoAdvanceProfile || DEFAULT_PREFS.autoAdvanceProfile,
    multiSpeakerEnabled: typeof stored?.multiSpeakerEnabled === 'boolean'
      ? stored.multiSpeakerEnabled
      : settings?.multiSpeakerEnabled !== false,
  };
};

const formatCompactStat = (item: ReaderCatalogItem | null): string => {
  if (!item) return 'Select a title to inspect format and playback state.';
  if (item.contentKind === 'comic') {
    const panels = Number(item.stats?.totalPanels || item.stats?.pageCount || 0);
    return panels > 0 ? `${panels.toLocaleString()} panels` : 'Comic / manga import';
  }
  const chars = Number(item.stats?.totalChars || 0);
  return chars > 0 ? `${chars.toLocaleString()} chars` : 'Narrated text';
};

const formatProgressLabel = (item: ReaderCatalogItem | null): string => {
  const progressPct = Number(item?.resume?.progressPct || 0);
  if (!item?.resume?.hasProgress) return 'Not started';
  return `${Math.round(progressPct)}% complete`;
};

const findLanguageLabel = (code: string | undefined): string => {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return 'Original';
  const direct = LANGUAGES.find((item) => String(item.code || '').trim().toLowerCase() === normalized);
  if (direct) return direct.name;
  const prefix = normalized.split('-', 1)[0] || normalized;
  const prefixed = LANGUAGES.find((item) => (String(item.code || '').trim().toLowerCase().split('-', 1)[0] || '') === prefix);
  return prefixed?.name || prefix.toUpperCase();
};

const resolveReaderTargetLanguage = (selectedItem: ReaderCatalogItem | null, draftValue: string): string => {
  const preferred = String(draftValue || '').trim();
  if (preferred) return preferred;
  return String(selectedItem?.sourceLanguage || 'en').trim() || 'en';
};

const resolveReaderPageViewDefault = (sourceLanguage: string | undefined, targetLanguage: string | undefined): 'original' | 'translated' =>
  String(sourceLanguage || '').trim().toLowerCase() === String(targetLanguage || '').trim().toLowerCase() ? 'original' : 'translated';

const READER_PREP_TERMINAL_STATES = new Set(['ready', 'error', 'degraded']);

const isReaderPrepTerminal = (readerSession: ReaderSession | null | undefined): boolean => {
  const state = String(readerSession?.prep?.state || '').trim().toLowerCase();
  return !state || READER_PREP_TERMINAL_STATES.has(state);
};

const libraryHasSession = (readerLibrary: ReaderLibrary | null | undefined, sessionId: string): boolean => {
  const safeSessionId = String(sessionId || '').trim();
  if (!safeSessionId) return false;
  if ((readerLibrary?.activeSessions || []).some((item) => item.id === safeSessionId)) return true;
  return (readerLibrary?.items || []).some((item) => item.sessionId === safeSessionId);
};

export const ReaderTabContent: React.FC<ReaderTabContentProps> = ({ mediaBackendUrl, settings, resolvedTheme, onToast }) => {
  const { characterLibrary, getVoiceForCharacter, updateCharacter } = useUser();
  const initialPrefs = useMemo(() => readPrefs(settings), [settings]);
  const [surface, setSurface] = useState<ReaderSurfaceFilter>(initialPrefs.surface);
  const [regionId, setRegionId] = useState<string>(initialPrefs.regionId);
  const [musicTrackId, setMusicTrackId] = useState<string>(initialPrefs.musicTrackId);
  const [speechVolume, setSpeechVolume] = useState<number>(initialPrefs.speechVolume);
  const [musicVolume, setMusicVolume] = useState<number>(initialPrefs.musicVolume);
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(initialPrefs.panelCollapsed);
  const [searchQuery, setSearchQuery] = useState<string>(initialPrefs.searchQuery);
  const [targetLanguageDraft, setTargetLanguageDraft] = useState<string>(initialPrefs.targetLanguage);
  const [pageViewModeDraft, setPageViewModeDraft] = useState<'original' | 'translated'>(initialPrefs.pageViewMode);
  const [ttsLanguageModeDraft, setTtsLanguageModeDraft] = useState<'auto' | 'source' | 'target'>(initialPrefs.ttsLanguageMode);
  const [provider, setProvider] = useState<string>(initialPrefs.provider);
  const [collection, setCollection] = useState<string>(initialPrefs.collection);
  const [progress, setProgress] = useState<ReaderProgressFilter>(initialPrefs.progress);
  const [contentKind, setContentKind] = useState<ReaderContentFilter>(initialPrefs.contentKind);
  const [sort, setSort] = useState<ReaderSortOption>(initialPrefs.sort);
  const [viewMode, setViewMode] = useState<ReaderViewMode>(initialPrefs.viewMode);
  const [library, setLibrary] = useState<ReaderLibrary | null>(null);
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [resumeSession, setResumeSession] = useState<ReaderSession | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'browse' | 'playback'>('browse');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [legalAck, setLegalAck] = useState<ReaderLegalAck | null>(null);
  const [billingLabel, setBillingLabel] = useState<string>(`Reader pricing: ${READER_BILLING_RULE}`);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState<string>('');
  const [uploadContentType, setUploadContentType] = useState<UploadContentType>('auto');
  const [uploadOwnershipBasis, setUploadOwnershipBasis] = useState<string>('own_work');
  const [castDraft, setCastDraft] = useState<Record<string, string>>({});
  const [readingModeDraft, setReadingModeDraft] = useState<string>('document');
  const [autoAdvanceDraft, setAutoAdvanceDraft] = useState<ReaderAutoAdvanceProfile>(initialPrefs.autoAdvanceProfile);
  const [multiSpeakerEnabledDraft, setMultiSpeakerEnabledDraft] = useState<boolean>(initialPrefs.multiSpeakerEnabled);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [activeQueueIndex, setActiveQueueIndex] = useState<number>(0);
  const [speechProgressPct, setSpeechProgressPct] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSpeechPlaying, setIsSpeechPlaying] = useState<boolean>(false);
  const [isSpeechBuffering, setIsSpeechBuffering] = useState<boolean>(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isAutoAssigningCast, setIsAutoAssigningCast] = useState<boolean>(false);
  const [autoSwipePausedUntil, setAutoSwipePausedUntil] = useState<number>(0);
  const [activePanel, setActivePanel] = useState<ReaderPanelSection>('library');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const readerRootRef = useRef<HTMLDivElement | null>(null);
  const controlPanelRef = useRef<HTMLDivElement | null>(null);
  const fetchedAudioJobIdsRef = useRef<Set<string>>(new Set());
  const prefetchedWindowKeysRef = useRef<Set<string>>(new Set());
  const prefetchedPanelKeysRef = useRef<Set<string>>(new Set());
  const playlistRef = useRef<PlaylistItem[]>([]);
  const panelRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const autoplayPendingRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string>('');
  const workspaceModeRef = useRef<'browse' | 'playback'>('browse');
  const lastAckLoadKeyRef = useRef<string>('');
  const lastLibraryLoadKeyRef = useRef<string>('');
  const expiredSessionToastForRef = useRef<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isDesktopLayout, setIsDesktopLayout] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(READER_DESKTOP_MEDIA_QUERY).matches;
  });
  const isDesktopPanelCollapsed = isDesktopLayout && panelCollapsed;

  useEffect(() => {
    sessionIdRef.current = session?.id || '';
  }, [session?.id]);

  useEffect(() => {
    workspaceModeRef.current = workspaceMode;
  }, [workspaceMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia(READER_DESKTOP_MEDIA_QUERY);
    const syncLayout = () => setIsDesktopLayout(mediaQuery.matches);
    syncLayout();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncLayout);
      return () => mediaQuery.removeEventListener('change', syncLayout);
    }
    mediaQuery.addListener(syncLayout);
    return () => mediaQuery.removeListener(syncLayout);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const syncFullscreen = () => {
      const fullscreenElement = document.fullscreenElement;
      setIsFullscreen(Boolean(fullscreenElement && readerRootRef.current && (fullscreenElement === readerRootRef.current || readerRootRef.current.contains(fullscreenElement))));
    };
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    writeStorageJson(STORAGE_KEYS.readerPreferences, {
      surface,
      regionId,
      musicTrackId,
      speechVolume,
      musicVolume,
      panelCollapsed,
      searchQuery,
      targetLanguage: targetLanguageDraft,
      pageViewMode: pageViewModeDraft,
      ttsLanguageMode: ttsLanguageModeDraft,
      provider,
      collection,
      progress,
      contentKind,
      sort,
      viewMode,
      autoAdvanceProfile: autoAdvanceDraft,
      multiSpeakerEnabled: multiSpeakerEnabledDraft,
    } satisfies ReaderPreferences);
  }, [autoAdvanceDraft, collection, contentKind, multiSpeakerEnabledDraft, musicTrackId, musicVolume, pageViewModeDraft, panelCollapsed, progress, provider, regionId, searchQuery, sort, speechVolume, surface, targetLanguageDraft, ttsLanguageModeDraft, viewMode]);

  useEffect(() => () => {
    Object.values(audioUrls).forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // no-op
      }
    });
  }, [audioUrls]);

  const resolveMediaUrl = useCallback(
    (url: string | undefined): string => {
      const safe = String(url || '').trim();
      if (!safe) return '';
      if (/^https?:\/\//i.test(safe)) return safe;
      return resolveApiUrl(safe, mediaBackendUrl);
    },
    [mediaBackendUrl]
  );

  const loadAck = useCallback(async () => {
    try {
      const payload = await getReaderLegalAck(mediaBackendUrl);
      setLegalAck(payload.ack);
      setBillingLabel(payload.billing.label);
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not load Reader rights status.'), 'error');
    }
  }, [mediaBackendUrl, onToast]);

  const loadLibrary = useCallback(async (options?: { background?: boolean }) => {
    if (!options?.background) setIsLoading(true);
    try {
      const nextLibrary = await getReaderLibrary(mediaBackendUrl, {
        surface,
        regionId,
        search: deferredSearchQuery.trim(),
      });
      startTransition(() => {
        setLibrary(nextLibrary);
        const matchingSession = sessionIdRef.current
          ? (nextLibrary.activeSessions || []).find((item) => item.id === sessionIdRef.current) || null
          : null;
        setResumeSession(matchingSession || nextLibrary.activeSession || null);
        setSelectedItemId((current) => {
          if (current && nextLibrary.items.some((item) => item.id === current)) return current;
          if (workspaceModeRef.current === 'playback' && sessionIdRef.current) return current;
          return nextLibrary.shelves.continueReading[0]?.id || nextLibrary.items[0]?.id || '';
        });
      });
      return nextLibrary;
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not load Reader library.'), 'error');
      return null;
    } finally {
      if (!options?.background) setIsLoading(false);
    }
  }, [deferredSearchQuery, mediaBackendUrl, onToast, regionId, surface]);

  useEffect(() => {
    const loadKey = mediaBackendUrl;
    if (lastAckLoadKeyRef.current === loadKey) return;
    lastAckLoadKeyRef.current = loadKey;
    void loadAck();
  }, [loadAck, mediaBackendUrl]);

  useEffect(() => {
    const loadKey = `${mediaBackendUrl}|${surface}|${regionId}|${deferredSearchQuery.trim()}`;
    if (lastLibraryLoadKeyRef.current === loadKey) return;
    lastLibraryLoadKeyRef.current = loadKey;
    void loadLibrary();
  }, [deferredSearchQuery, loadLibrary, mediaBackendUrl, regionId, surface]);

  useEffect(() => {
    if (workspaceMode !== 'playback' || !session?.id) return;
    let cancelled = false;
    let timer: number | undefined;
    const hasPendingPlaybackWork = (current: ReaderSession): boolean => {
      if (current.contentKind === 'comic') {
        return current.panels.some((item) => !['completed', 'ready', 'played'].includes(String(item.audioJob?.status || item.audioStatus || '').toLowerCase()));
      }
      return current.windows.some((item) => !['completed', 'ready', 'played'].includes(String(item.job?.status || item.status || '').toLowerCase()));
    };
    const scheduleNextTick = (current: ReaderSession) => {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const delay = hidden
        ? 10000
        : !isReaderPrepTerminal(current)
          ? 1500
          : hasPendingPlaybackWork(current)
            ? 4000
            : 8000;
      timer = window.setTimeout(() => {
        void tick();
      }, delay);
    };
    const resolveMissingSession = async (sessionId: string) => {
      const nextLibrary = await loadLibrary({ background: true });
      if (cancelled || sessionIdRef.current !== sessionId) return;
      if (libraryHasSession(nextLibrary, sessionId)) {
        timer = window.setTimeout(() => {
          void tick();
        }, 4000);
        return;
      }
      startTransition(() => {
        setSession(null);
        setResumeSession(null);
        setWorkspaceMode('browse');
      });
      if (expiredSessionToastForRef.current !== sessionId) {
        expiredSessionToastForRef.current = sessionId;
        onToast('Reader session expired after server restart.', 'info');
      }
    };
    const tick = async () => {
      try {
        const nextSession = await getReaderSession(mediaBackendUrl, session.id);
        if (cancelled || sessionIdRef.current !== nextSession.id) return;
        startTransition(() => {
          setSession(nextSession);
          setResumeSession(nextSession);
          setCastDraft(nextSession.castMemory || {});
          setReadingModeDraft(nextSession.readingMode || 'document');
          setAutoAdvanceDraft((nextSession.autoAdvanceProfile as ReaderAutoAdvanceProfile) || 'off');
          setTargetLanguageDraft(nextSession.targetLanguage || nextSession.sourceLanguage || '');
          setPageViewModeDraft(nextSession.pageViewMode || resolveReaderPageViewDefault(nextSession.sourceLanguage, nextSession.targetLanguage));
          setTtsLanguageModeDraft(nextSession.ttsLanguageMode || 'auto');
          setMultiSpeakerEnabledDraft(nextSession.multiSpeakerEnabled !== false);
          if (typeof nextSession.activeItemIndex === 'number') {
            setActiveQueueIndex(Math.max(0, nextSession.activeItemIndex));
          }
        });
        if (!isReaderPrepTerminal(nextSession)) {
          void loadLibrary({ background: true });
        }
        scheduleNextTick(nextSession);
      } catch (error) {
        if (cancelled) return;
        if ((error as Error & { status?: number }).status === 404) {
          await resolveMissingSession(session.id);
          return;
        }
        timer = window.setTimeout(() => {
          void tick();
        }, 8000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [loadLibrary, mediaBackendUrl, onToast, session?.id, workspaceMode]);

  const activeMusicTrack = useMemo(() => MUSIC_TRACKS.find((item) => item.id === musicTrackId), [musicTrackId]);

  const filters = useMemo<ReaderLibraryFilters>(
    () => ({
      surface,
      search: deferredSearchQuery,
      provider,
      contentKind,
      progress,
      collection,
      sort,
    }),
    [collection, contentKind, deferredSearchQuery, progress, provider, sort, surface]
  );

  const filteredItems = useMemo(() => filterReaderLibraryItems(library?.items || [], filters), [filters, library?.items]);

  useEffect(() => {
    if (!selectedItemId && filteredItems[0]?.id) {
      setSelectedItemId(filteredItems[0].id);
      return;
    }
    if (selectedItemId && filteredItems.some((item) => item.id === selectedItemId)) return;
    if (filteredItems[0]?.id) setSelectedItemId(filteredItems[0].id);
  }, [filteredItems, selectedItemId]);

  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedItemId) || library?.items.find((item) => item.id === selectedItemId) || null,
    [filteredItems, library?.items, selectedItemId]
  );

  const buildWorkKey = useCallback((item: ReaderCatalogItem) => `${item.surface === 'uploads' ? 'upload' : 'catalog'}:${item.id}`, []);

  const buildSessionItemId = useCallback((readerSession: ReaderSession) => {
    const [, ...parts] = String(readerSession.workKey || '').split(':');
    const derivedId = parts.join(':').trim();
    return derivedId || readerSession.id;
  }, []);

  const buildSessionFallbackItem = useCallback(
    (readerSession: ReaderSession): ReaderCatalogItem => ({
      id: buildSessionItemId(readerSession),
      title: readerSession.title,
      author: readerSession.collectionLabel || readerSession.provider || 'Reader session',
      regionId: readerSession.regionId || regionId,
      ...(readerSession.sourceLanguage ? { sourceLanguage: readerSession.sourceLanguage } : {}),
      contentKind: readerSession.contentKind,
      surface: readerSession.surface,
      provider: readerSession.provider || 'catalog',
      license: readerSession.license || '',
      ...(readerSession.sourceUrl ? { sourceUrl: readerSession.sourceUrl } : {}),
      ...(readerSession.summary ? { summary: readerSession.summary } : {}),
      ...(readerSession.coverUrl ? { coverUrl: readerSession.coverUrl } : {}),
      ...(readerSession.direction ? { direction: readerSession.direction } : {}),
      ...(readerSession.readingMode ? { readingModeDefault: readerSession.readingMode } : {}),
      ...(readerSession.collectionLabel || readerSession.provider
        ? { collectionLabel: readerSession.collectionLabel || readerSession.provider || 'Reader session' }
        : {}),
      sessionId: readerSession.id,
      resume: {
        hasProgress: readerSession.progressPct > 0,
        consumedChars: readerSession.consumedChars,
        currentPanelIndex: readerSession.currentPanelIndex,
        progressPct: readerSession.progressPct,
        sessionId: readerSession.id,
      },
      ...(readerSession.readiness ? { readiness: readerSession.readiness } : {}),
      ...(readerSession.stats ? { stats: readerSession.stats } : {}),
      translationSupport: {
        page: true,
        tts: true,
      },
    }),
    [buildSessionItemId, regionId]
  );

  const resolveSessionCatalogItem = useCallback(
    (readerSession: ReaderSession | null): ReaderCatalogItem | null => {
      if (!readerSession) return null;
      const resolvedItemId = buildSessionItemId(readerSession);
      const matchedItem = (library?.items || []).find(
        (item) => buildWorkKey(item) === readerSession.workKey || item.id === resolvedItemId
      );
      return matchedItem || buildSessionFallbackItem(readerSession);
    },
    [buildSessionFallbackItem, buildSessionItemId, buildWorkKey, library?.items]
  );

  const sessionItem = useMemo(() => resolveSessionCatalogItem(session), [resolveSessionCatalogItem, session]);

  const resumeSessionItem = useMemo(() => resolveSessionCatalogItem(resumeSession), [resolveSessionCatalogItem, resumeSession]);
  const selectedBrowseItem = useMemo(() => {
    if (!selectedItem) return null;
    if (!resumeSession || !resumeSessionItem || resumeSessionItem.id !== selectedItem.id) return selectedItem;
    return {
      ...selectedItem,
      sessionId: resumeSession.id,
      readiness: resumeSession.readiness || selectedItem.readiness,
      prep: resumeSession.prep || selectedItem.prep,
      resume: {
        hasProgress: Boolean(
          selectedItem.resume?.hasProgress
          || Number(resumeSession.progressPct || 0) > 0
          || Number(resumeSession.consumedChars || 0) > 0
          || Number(resumeSession.currentPanelIndex || 0) > 0
        ),
        consumedChars: Math.max(Number(selectedItem.resume?.consumedChars || 0), Number(resumeSession.consumedChars || 0)),
        currentPanelIndex: Math.max(Number(selectedItem.resume?.currentPanelIndex || 0), Number(resumeSession.currentPanelIndex || 0)),
        progressPct: Math.max(Number(selectedItem.resume?.progressPct || 0), Number(resumeSession.progressPct || 0)),
        updatedAt: selectedItem.resume?.updatedAt,
        sessionId: resumeSession.id,
      },
    } as ReaderCatalogItem;
  }, [resumeSession, resumeSessionItem, selectedItem]);
  const activeCatalogItem = sessionItem || selectedBrowseItem;
  const shouldResumeActiveCatalogItem = Boolean(
    !session
    && resumeSession?.id
    && activeCatalogItem?.id
    && activeCatalogItem.id === resumeSessionItem?.id
  );

  useEffect(() => {
    if (workspaceMode !== 'playback' || !sessionItem?.id) return;
    setSelectedItemId((current) => (current === sessionItem.id ? current : sessionItem.id));
  }, [sessionItem?.id, workspaceMode]);

  useEffect(() => {
    if (session) {
      setCastDraft(session.castMemory || {});
      setReadingModeDraft(session.readingMode || sessionItem?.readingModeDefault || selectedItem?.readingModeDefault || 'document');
      setAutoAdvanceDraft((session.autoAdvanceProfile as ReaderAutoAdvanceProfile) || 'off');
      setTargetLanguageDraft(session.targetLanguage || session.sourceLanguage || '');
      setPageViewModeDraft(session.pageViewMode || resolveReaderPageViewDefault(session.sourceLanguage, session.targetLanguage));
      setTtsLanguageModeDraft(session.ttsLanguageMode || 'auto');
      setMultiSpeakerEnabledDraft(session.multiSpeakerEnabled !== false);
      return;
    }
    if (!selectedItem) return;
    setReadingModeDraft(selectedItem.readingModeDefault || (selectedItem.contentKind === 'comic' ? 'vertical_strip' : 'document'));
    setAutoAdvanceDraft(selectedItem.contentKind === 'comic' ? initialPrefs.autoAdvanceProfile : 'off');
    const nextTargetLanguage = resolveReaderTargetLanguage(selectedItem, initialPrefs.targetLanguage);
    setTargetLanguageDraft(nextTargetLanguage);
    setPageViewModeDraft(resolveReaderPageViewDefault(selectedItem.sourceLanguage, nextTargetLanguage));
    setTtsLanguageModeDraft(initialPrefs.ttsLanguageMode);
  }, [initialPrefs.autoAdvanceProfile, initialPrefs.targetLanguage, initialPrefs.ttsLanguageMode, selectedItem, session, sessionItem]);

  useEffect(() => {
    if (workspaceMode === 'playback') return;
    autoplayPendingRef.current = false;
    const speechAudio = speechAudioRef.current;
    const musicAudio = musicAudioRef.current;
    if (speechAudio) {
      speechAudio.pause();
      speechAudio.currentTime = 0;
    }
    if (musicAudio) {
      musicAudio.pause();
      musicAudio.currentTime = 0;
    }
    setIsSpeechPlaying(false);
    setIsSpeechBuffering(false);
    setIsMusicPlaying(false);
    setSpeechProgressPct(0);
  }, [workspaceMode]);

  const previewScriptText = useMemo(() => {
    if (session?.windows?.length) {
      return session.windows
        .map((item) => String(item.sourceText || item.text || item.displayText || '').trim())
        .filter(Boolean)
        .slice(0, 12)
        .join('\n');
    }
    if (session?.panels?.length) {
      return session.panels
        .map((item) => String(item.sourceText || item.text || item.displayText || '').trim())
        .filter(Boolean)
        .slice(0, 12)
        .join('\n');
    }
    return String(selectedItem?.sampleText || selectedItem?.excerpt || selectedItem?.summary || '').trim();
  }, [selectedItem?.excerpt, selectedItem?.sampleText, selectedItem?.summary, session?.panels, session?.windows]);

  const castSpeakers = useMemo(() => {
    const names = new Set<string>();
    Object.keys(castDraft || {}).forEach((speaker) => {
      const safeSpeaker = String(speaker || '').trim();
      if (safeSpeaker && safeSpeaker.toUpperCase() !== 'SFX') names.add(safeSpeaker);
    });
    parseMultiSpeakerScript(previewScriptText).speakersList
      .map((speaker) => String(speaker || '').trim())
      .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX')
      .forEach((speaker) => names.add(speaker));
    if (!names.size) names.add('Narrator');
    return [...names];
  }, [castDraft, previewScriptText]);

  const multiSpeakerMode = useMemo(
    () =>
      getReaderEffectiveMultiSpeakerMode(
        session,
        {
          multiSpeakerEnabled: multiSpeakerEnabledDraft,
          previewText: previewScriptText,
          castMemory: castDraft,
        }
      ),
    [castDraft, multiSpeakerEnabledDraft, previewScriptText, session]
  );

  const multiSpeakerStatusLabel = useMemo(
    () => formatReaderMultiSpeakerMode(multiSpeakerMode),
    [multiSpeakerMode]
  );

  const completedJobs = useMemo(() => {
    if (!session) return [];
    const jobs: string[] = [];
    session.windows.forEach((item) => {
      const jobId = String(item.jobId || '').trim();
      if (jobId && item.job?.status === 'completed') jobs.push(jobId);
    });
    session.panels.forEach((item) => {
      const jobId = String(item.audioJobId || '').trim();
      if (jobId && item.audioJob?.status === 'completed') jobs.push(jobId);
    });
    return jobs;
  }, [session]);

  useEffect(() => {
    completedJobs.forEach((jobId) => {
      if (audioUrls[jobId] || fetchedAudioJobIdsRef.current.has(jobId)) return;
      fetchedAudioJobIdsRef.current.add(jobId);
      void getReaderTtsJobAudio(mediaBackendUrl, jobId)
        .then((payload) => {
          const url = payload.audioBase64 ? base64ToObjectUrl(payload.audioBase64, payload.mediaType || 'audio/wav') : null;
          if (!url) return;
          setAudioUrls((prev) => ({ ...prev, [jobId]: url }));
        })
        .catch(() => {
          fetchedAudioJobIdsRef.current.delete(jobId);
        });
    });
  }, [audioUrls, completedJobs, mediaBackendUrl]);

  const playlist = useMemo<PlaylistItem[]>(() => {
    if (!session) return [];
    if (session.contentKind === 'book') {
      return session.windows.flatMap((item) => {
        const jobId = String(item.jobId || '').trim();
        const url = audioUrls[jobId];
        if (!jobId || !url) return [];
        const entry: PlaylistItem = {
          key: `window:${item.index}`,
          kind: 'window',
          jobId,
          title: `Window ${item.index + 1}`,
          text: String(item.displayText || item.translatedText || item.sourceText || item.text || ''),
          url,
        };
        if (typeof item.startChar === 'number') entry.startChar = item.startChar;
        if (typeof item.endChar === 'number') entry.endChar = item.endChar;
        if (typeof item.charCount === 'number') entry.charCount = item.charCount;
        return [entry];
      });
    }
    return session.panels.flatMap((item) => {
      const jobId = String(item.audioJobId || '').trim();
      const url = audioUrls[jobId];
      if (!jobId || !url) return [];
      const entry: PlaylistItem = {
        key: `panel:${item.index}`,
        kind: 'panel',
        jobId,
        title: `Panel ${item.index + 1}`,
        text: String(item.displayText || item.translatedText || item.sourceText || item.text || ''),
        url,
      };
      entry.panelIndex = item.index;
      const imageUrl = resolveMediaUrl(item.imageUrl);
      if (imageUrl) entry.imageUrl = imageUrl;
      return [entry];
    });
  }, [audioUrls, resolveMediaUrl, session]);

  useEffect(() => {
    playlistRef.current = playlist;
    if (playlist.length === 0) {
      setActiveQueueIndex(0);
      return;
    }
    if (typeof session?.activeItemIndex === 'number') {
      setActiveQueueIndex(Math.min(Math.max(0, session.activeItemIndex), playlist.length - 1));
      return;
    }
    setActiveQueueIndex((current) => (current >= playlist.length ? playlist.length - 1 : current));
  }, [playlist, session?.activeItemIndex]);

  const activeItem = playlist[activeQueueIndex] || null;

  useEffect(() => {
    const audio = speechAudioRef.current;
    if (!audio || !activeItem) return;
    if (audio.src !== activeItem.url) {
      setIsSpeechBuffering(true);
      audio.src = activeItem.url;
      audio.load();
      setSpeechProgressPct(0);
      if (isSpeechPlaying || autoplayPendingRef.current) {
        autoplayPendingRef.current = false;
        setIsSpeechPlaying(true);
        void audio.play().catch(() => {
          setIsSpeechPlaying(false);
          setIsSpeechBuffering(false);
          onToast('Playback is blocked until the browser allows audio.', 'info');
        });
      } else {
        setIsSpeechBuffering(false);
      }
    }
  }, [activeItem, isSpeechPlaying, onToast]);

  useEffect(() => {
    const audio = speechAudioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1.5, speechVolume));
  }, [speechVolume]);

  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio || !activeMusicTrack) return;
    audio.loop = true;
    audio.src = activeMusicTrack.url || '';
    audio.volume = Math.max(0, Math.min(1, isSpeechPlaying ? musicVolume * 0.45 : musicVolume));
    if (isMusicPlaying && activeMusicTrack.url) {
      void audio.play().catch(() => setIsMusicPlaying(false));
    } else {
      audio.pause();
    }
  }, [activeMusicTrack, isMusicPlaying, isSpeechPlaying, musicVolume]);

  const commitProgress = useCallback(
    async (nextProgress: { consumedChars?: number; currentPanelIndex?: number }) => {
      if (!session?.id) return;
      try {
        const nextSession = await updateReaderProgress(mediaBackendUrl, session.id, {
          ...nextProgress,
          targetLanguage: targetLanguageDraft,
          pageViewMode: pageViewModeDraft,
        });
        startTransition(() => setSession(nextSession));
      } catch {
        // keep playback responsive even if progress commit stalls
      }
    },
    [mediaBackendUrl, pageViewModeDraft, session?.id, targetLanguageDraft]
  );

  const goToQueueIndex = useCallback((nextIndex: number, autoplay: boolean) => {
    if (playlistRef.current.length <= 0) return;
    const bounded = Math.max(0, Math.min(nextIndex, playlistRef.current.length - 1));
    autoplayPendingRef.current = autoplay;
    setSpeechProgressPct(0);
    setIsSpeechBuffering(autoplay);
    setActiveQueueIndex(bounded);
    if (autoplay) {
      setIsSpeechPlaying(true);
    }
  }, []);

  const advanceComicPanel = useCallback(
    (trigger: 'audio' | 'timer') => {
      if (!session || session.contentKind !== 'comic' || !activeItem || activeItem.kind !== 'panel' || activeItem.panelIndex === undefined) return;
      const nextIndex = Math.min(activeQueueIndex + 1, playlistRef.current.length - 1);
      const nextPanelPosition = Math.min(activeItem.panelIndex + 1, session.totalPanels);
      if (trigger === 'audio') {
        void commitProgress({ currentPanelIndex: nextPanelPosition });
      } else if (Date.now() >= autoSwipePausedUntil) {
        void commitProgress({ currentPanelIndex: nextPanelPosition });
        if (nextIndex !== activeQueueIndex) goToQueueIndex(nextIndex, true);
      }
    },
    [activeItem, activeQueueIndex, autoSwipePausedUntil, commitProgress, goToQueueIndex, session]
  );

  useEffect(() => {
    const audio = speechAudioRef.current;
    if (!audio || !session) return undefined;
    const onTimeUpdate = () => {
      const ratio = audio.duration > 0 ? Math.min(1, Math.max(0, audio.currentTime / audio.duration)) : 0;
      setSpeechProgressPct(ratio * 100);
      if (!activeItem || activeItem.kind !== 'window' || activeItem.startChar === undefined || activeItem.endChar === undefined || activeItem.charCount === undefined) return;
      const consumedChars = activeItem.startChar + Math.floor(activeItem.charCount * ratio);
      if (
        shouldTriggerReaderWindowPrefetch({
          consumedChars,
          scheduledWindowEndChar: activeItem.endChar,
          thresholdChars: session.limits.prefetchThresholdChars,
        }) &&
        !prefetchedWindowKeysRef.current.has(activeItem.key)
      ) {
        prefetchedWindowKeysRef.current.add(activeItem.key);
        void commitProgress({ consumedChars });
      }
    };
    const onEnded = () => {
      if (activeItem?.kind === 'window' && activeItem.endChar !== undefined) {
        void commitProgress({ consumedChars: activeItem.endChar });
      }
      setSpeechProgressPct(100);
      if (activeItem?.kind === 'panel') advanceComicPanel('audio');
      const nextIndex = activeQueueIndex + 1;
      if (nextIndex < playlistRef.current.length) {
        goToQueueIndex(nextIndex, true);
        return;
      }
      setIsSpeechPlaying(false);
      setIsSpeechBuffering(false);
    };
    const onPlay = () => setIsSpeechPlaying(true);
    const onPause = () => {
      setIsSpeechPlaying(false);
      if (!audio.ended) {
        setIsSpeechBuffering(false);
      }
    };
    const onWaiting = () => setIsSpeechBuffering(true);
    const onCanPlay = () => setIsSpeechBuffering(false);
    const onPlaying = () => {
      setIsSpeechPlaying(true);
      setIsSpeechBuffering(false);
    };
    const onLoadStart = () => setIsSpeechBuffering(true);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('loadstart', onLoadStart);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('loadstart', onLoadStart);
    };
  }, [activeItem, activeQueueIndex, advanceComicPanel, commitProgress, goToQueueIndex, session]);

  useEffect(() => {
    if (!session || !activeItem || activeItem.kind !== 'panel' || activeItem.panelIndex === undefined) return;
    const scheduledPanelCount = session.panels.filter((item) => Boolean(item.audioJobId)).length;
    if (
      shouldTriggerReaderPanelPrefetch({
        currentPanelIndex: activeItem.panelIndex,
        scheduledPanelCount,
        batchSize: session.limits.panelBatchSize,
        triggerIndex: session.limits.panelTriggerIndex,
      }) &&
      !prefetchedPanelKeysRef.current.has(activeItem.key)
    ) {
      prefetchedPanelKeysRef.current.add(activeItem.key);
      void commitProgress({ currentPanelIndex: activeItem.panelIndex });
    }
  }, [activeItem, commitProgress, session]);

  useEffect(() => {
    if (!session || activeItem?.kind !== 'panel' || activeItem.panelIndex === undefined) return;
    const panel = panelRefs.current[activeItem.panelIndex];
    panel?.scrollIntoView({ block: session.readingMode === 'vertical_strip' ? 'nearest' : 'center', inline: 'center', behavior: 'smooth' });
  }, [activeItem, session]);

  const autoAdvanceDelay = useMemo(() => getReaderAutoAdvanceDelay(autoAdvanceDraft), [autoAdvanceDraft]);

  useEffect(() => {
    if (!session || !isReaderAutoSwipeAvailable(session) || !activeItem || activeItem.kind !== 'panel') return;
    if (autoAdvanceDraft === 'off' || autoAdvanceDraft === 'audio_sync' || autoAdvanceDelay === null) return;
    if (Date.now() < autoSwipePausedUntil) return;
    const timer = window.setTimeout(() => advanceComicPanel('timer'), autoAdvanceDelay);
    return () => window.clearTimeout(timer);
  }, [activeItem, advanceComicPanel, autoAdvanceDelay, autoAdvanceDraft, autoSwipePausedUntil, session]);

  const startSession = useCallback(
    async (item: ReaderCatalogItem, options?: { forceNew?: boolean; autoPlay?: boolean }) => {
      try {
        const resolvedTargetLanguage = resolveReaderTargetLanguage(item, targetLanguageDraft);
        const payload: Parameters<typeof createReaderSession>[1] = item.surface === 'uploads'
          ? { uploadId: item.id, forceNew: Boolean(options?.forceNew), autoAdvanceProfile: item.contentKind === 'comic' ? autoAdvanceDraft : 'off' }
          : { itemId: item.id, forceNew: Boolean(options?.forceNew), autoAdvanceProfile: item.contentKind === 'comic' ? autoAdvanceDraft : 'off' };
        if (item.contentKind === 'comic' && readingModeDraft) payload.readingModeOverride = readingModeDraft;
        payload.targetLanguage = resolvedTargetLanguage;
        payload.pageViewMode = pageViewModeDraft;
        payload.ttsLanguageMode = ttsLanguageModeDraft;
        payload.multiSpeakerEnabled = multiSpeakerEnabledDraft;
        const nextSession = await createReaderSession(mediaBackendUrl, payload);
        autoplayPendingRef.current = Boolean(options?.autoPlay);
        startTransition(() => {
          setSelectedItemId(item.id);
          setSession(nextSession);
          setResumeSession(nextSession);
          setWorkspaceMode('playback');
          setCastDraft(nextSession.castMemory || {});
          setReadingModeDraft(nextSession.readingMode || item.readingModeDefault || 'document');
          setAutoAdvanceDraft((nextSession.autoAdvanceProfile as ReaderAutoAdvanceProfile) || 'off');
          setTargetLanguageDraft(nextSession.targetLanguage || resolvedTargetLanguage);
          setPageViewModeDraft(nextSession.pageViewMode || resolveReaderPageViewDefault(nextSession.sourceLanguage, nextSession.targetLanguage));
          setTtsLanguageModeDraft(nextSession.ttsLanguageMode || 'auto');
          setMultiSpeakerEnabledDraft(nextSession.multiSpeakerEnabled !== false);
          if (typeof nextSession.activeItemIndex === 'number') {
            setActiveQueueIndex(Math.max(0, nextSession.activeItemIndex));
            return;
          }
          setActiveQueueIndex(0);
        });
        void loadLibrary({ background: true });
        onToast(
          isReaderPrepTerminal(nextSession)
            ? `Reader session ready for ${item.title}.`
            : `Preparing Reader session for ${item.title}.`,
          isReaderPrepTerminal(nextSession) ? 'success' : 'info'
        );
      } catch (error) {
        onToast(String((error as Error)?.message || 'Could not start Reader session.'), 'error');
      }
    },
    [autoAdvanceDraft, loadLibrary, mediaBackendUrl, multiSpeakerEnabledDraft, onToast, pageViewModeDraft, readingModeDraft, targetLanguageDraft, ttsLanguageModeDraft]
  );

  const handleResumeSession = useCallback(async () => {
    if (!resumeSession) return;
    let nextSession = resumeSession;
    if (resumeSession.id) {
      try {
        nextSession = await getReaderSession(mediaBackendUrl, resumeSession.id);
      } catch {
        onToast('Using cached Reader session because refresh failed.', 'info');
      }
    }
    startTransition(() => {
      if (resumeSessionItem?.id) setSelectedItemId(resumeSessionItem.id);
      setSession(nextSession);
      setResumeSession(nextSession);
      setWorkspaceMode('playback');
      setCastDraft(nextSession.castMemory || {});
      setReadingModeDraft(nextSession.readingMode || resumeSessionItem?.readingModeDefault || 'document');
      setAutoAdvanceDraft((nextSession.autoAdvanceProfile as ReaderAutoAdvanceProfile) || 'off');
      setTargetLanguageDraft(nextSession.targetLanguage || nextSession.sourceLanguage || '');
      setPageViewModeDraft(nextSession.pageViewMode || resolveReaderPageViewDefault(nextSession.sourceLanguage, nextSession.targetLanguage));
      setTtsLanguageModeDraft(nextSession.ttsLanguageMode || 'auto');
      setMultiSpeakerEnabledDraft(nextSession.multiSpeakerEnabled !== false);
      if (typeof nextSession.activeItemIndex === 'number') {
        setActiveQueueIndex(Math.max(0, nextSession.activeItemIndex));
        return;
      }
      setActiveQueueIndex(0);
    });
  }, [mediaBackendUrl, onToast, resumeSession, resumeSessionItem]);

  const handlePrimaryAction = useCallback(async () => {
    if (!activeCatalogItem) return;
    if (shouldResumeActiveCatalogItem) {
      await handleResumeSession();
      return;
    }
    await startSession(activeCatalogItem, { autoPlay: true });
  }, [activeCatalogItem, handleResumeSession, shouldResumeActiveCatalogItem, startSession]);

  const openPanel = useCallback((panel: ReaderPanelSection) => {
    setActivePanel(panel);
    if (isDesktopLayout) {
      setPanelCollapsed(false);
      return;
    }
    window.requestAnimationFrame(() => {
      controlPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [isDesktopLayout]);

  const handleAutoAssignCast = useCallback(() => {
    if (!multiSpeakerEnabledDraft) {
      onToast('Enable Multi-Speaker Mode first.', 'info');
      return;
    }
    if (!castSpeakers.length) {
      onToast('No speakers found to map.', 'info');
      return;
    }

    setIsAutoAssigningCast(true);
    try {
      const rememberedVoices = castSpeakers.reduce<Record<string, string>>((acc, speaker) => {
        const voiceId = String(getVoiceForCharacter(speaker) || '').trim();
        if (voiceId) acc[speaker] = voiceId;
        return acc;
      }, {});
      const { mapping, assignments } = autoAssignSpeakerVoices({
        speakers: castSpeakers,
        script: previewScriptText,
        voices: VOICES,
        existingMapping: castDraft,
        characterLibrary,
        rememberedVoices,
      });
      if (!Object.keys(mapping).length) {
        onToast('No cast speakers available to auto-assign.', 'info');
        return;
      }
      setCastDraft((current) => ({ ...current, ...mapping }));
      assignments.forEach(({ speaker, voice, inferredGender, inferredAgeGroup }) => {
        const existingCharacter = characterLibrary.find((item) => item.name.toLowerCase() === speaker.toLowerCase());
        if (!existingCharacter && !getVoiceForCharacter(speaker)) return;
        updateCharacter({
          id: existingCharacter?.id || crypto.randomUUID(),
          name: speaker,
          voiceId: voice.id,
          gender: voice.gender !== 'Unknown' ? voice.gender : inferredGender,
          age: voice.ageGroup || (inferredAgeGroup !== 'Unknown' ? inferredAgeGroup : 'Adult'),
          avatarColor: existingCharacter?.avatarColor || '#6366f1',
          description: existingCharacter?.description || 'Auto-assigned from Reader cast',
        });
      });
      onToast(`AI assigned ${Object.keys(mapping).length} cast voice${Object.keys(mapping).length === 1 ? '' : 's'}.`, 'success');
    } finally {
      setIsAutoAssigningCast(false);
    }
  }, [castDraft, castSpeakers, characterLibrary, getVoiceForCharacter, multiSpeakerEnabledDraft, onToast, previewScriptText, updateCharacter]);

  const handleUpload = useCallback(async () => {
    if (!selectedFiles.length) {
      onToast('Choose at least one file to import.', 'info');
      return;
    }
    setIsUploading(true);
    try {
      const uploadPayload: Parameters<typeof createReaderUpload>[1] = {
        files: selectedFiles,
        title: uploadTitle,
        ownershipBasis: uploadOwnershipBasis,
        regionId,
      };
      if (uploadContentType !== 'auto') uploadPayload.contentType = uploadContentType;
      const created = await createReaderUpload(mediaBackendUrl, uploadPayload);
      setSelectedFiles([]);
      setUploadTitle('');
      setUploadContentType('auto');
      setSurface('uploads');
      setSelectedItemId(created.id);
      await loadLibrary();
      onToast(`Imported as ${created.contentKind} with ${created.readingModeDefault || 'auto'} reading mode.`, 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Reader import failed.'), 'error');
    } finally {
      setIsUploading(false);
    }
  }, [loadLibrary, mediaBackendUrl, onToast, regionId, selectedFiles, uploadContentType, uploadOwnershipBasis, uploadTitle]);

  const handleExport = useCallback(async () => {
    if (!session?.id) return;
    try {
      const blob = await exportReaderSessionAudio(mediaBackendUrl, session.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${session.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'reader_audio'}.wav`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSession(await getReaderSession(mediaBackendUrl, session.id));
      await loadLibrary();
      onToast('Reader audio exported.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Reader export is not ready yet.'), 'error');
    }
  }, [loadLibrary, mediaBackendUrl, onToast, session]);

  const handleSavepoint = useCallback(async () => {
    if (!session?.id) return;
    setIsSaving(true);
    try {
      const savePayload: Parameters<typeof saveReaderSession>[2] = {
        castOverrides: castDraft,
        autoAdvanceProfile: session.contentKind === 'comic' ? autoAdvanceDraft : 'off',
        musicTrackId,
        targetLanguage: targetLanguageDraft,
        pageViewMode: pageViewModeDraft,
        ttsLanguageMode: ttsLanguageModeDraft,
        multiSpeakerEnabled: multiSpeakerEnabledDraft,
      };
      if (session.contentKind === 'comic' && readingModeDraft) savePayload.readingModeOverride = readingModeDraft;
      const nextSession = await saveReaderSession(mediaBackendUrl, session.id, savePayload);
      setSession(nextSession);
      setTargetLanguageDraft(nextSession.targetLanguage || targetLanguageDraft);
      setPageViewModeDraft(nextSession.pageViewMode || pageViewModeDraft);
      setTtsLanguageModeDraft(nextSession.ttsLanguageMode || ttsLanguageModeDraft);
      setMultiSpeakerEnabledDraft(nextSession.multiSpeakerEnabled !== false);
      await loadLibrary();
      onToast('Reader savepoint updated.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not save Reader preferences.'), 'error');
    } finally {
      setIsSaving(false);
    }
  }, [autoAdvanceDraft, castDraft, loadLibrary, mediaBackendUrl, multiSpeakerEnabledDraft, musicTrackId, onToast, pageViewModeDraft, readingModeDraft, session, targetLanguageDraft, ttsLanguageModeDraft]);

  const handleCloseSession = useCallback(async () => {
    if (!session?.id) return;
    try {
      await deleteReaderSession(mediaBackendUrl, session.id);
      setWorkspaceMode('browse');
      setResumeSession(null);
      setSession(null);
      setActiveQueueIndex(0);
      setSpeechProgressPct(0);
      setIsSpeechBuffering(false);
      await loadLibrary();
      onToast('Reader session closed.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not close Reader session.'), 'error');
    }
  }, [loadLibrary, mediaBackendUrl, onToast, session?.id]);

  const transportToggle = useCallback(() => {
    const audio = speechAudioRef.current;
    if (!audio || !activeItem) return;
    if (isSpeechPlaying) {
      audio.pause();
      return;
    }
    autoplayPendingRef.current = false;
    setIsSpeechPlaying(true);
    setIsSpeechBuffering(true);
    void audio.play().catch(() => {
      setIsSpeechPlaying(false);
      setIsSpeechBuffering(false);
      onToast('Playback is blocked until the browser allows audio.', 'info');
    });
  }, [activeItem, isSpeechPlaying, onToast]);

  const currentPrimaryAction = useMemo(
    () => (activeCatalogItem ? getReaderPrimaryAction(activeCatalogItem) : null),
    [activeCatalogItem]
  );
  const warningCountdown = session?.deleteAtMs ? getReaderDeleteCountdownLabel(session.deleteAtMs) : '03:00';
  const resultsCountLabel = `${filteredItems.length.toLocaleString()} title${filteredItems.length === 1 ? '' : 's'}`;

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (readerRootRef.current?.requestFullscreen) {
        await readerRootRef.current.requestFullscreen();
      }
    } catch {
      onToast('Fullscreen mode is not available in this browser context.', 'info');
    }
  }, [onToast]);

  const targetLanguageLabel = useMemo(
    () => findLanguageLabel(session?.targetLanguage || targetLanguageDraft || activeCatalogItem?.sourceLanguage),
    [activeCatalogItem?.sourceLanguage, session?.targetLanguage, targetLanguageDraft]
  );
  const pageViewModeLabel = pageViewModeDraft === 'translated' ? 'Translated Page View' : 'Original Page View';
  const ttsLanguageModeLabel =
    ttsLanguageModeDraft === 'target' ? `Target (${targetLanguageLabel})` : ttsLanguageModeDraft === 'source' ? 'Source' : 'Auto';
  const isPlaybackMode = workspaceMode === 'playback' && Boolean(session);
  const rootClassName = `${getReaderThemeClassName(resolvedTheme)}${isFullscreen ? ' vf-reader--fullscreen' : ''}`;
  const workspaceClassName = `vf-reader__workspace ${isPlaybackMode ? 'vf-reader__workspace--playback' : 'vf-reader__workspace--browse'}${isDesktopPanelCollapsed ? ' vf-reader__workspace--panel-collapsed' : ''}`;
  const auditModel = useMemo(
    () =>
      deriveReaderAuditModel({
        selectedItem: activeCatalogItem,
        session,
        billingLabel,
        warningCountdown,
        targetLanguageLabel,
        pageViewModeLabel,
        ttsLanguageModeLabel,
        multiSpeakerLabel: multiSpeakerStatusLabel,
      }),
    [activeCatalogItem, billingLabel, multiSpeakerStatusLabel, pageViewModeLabel, session, targetLanguageLabel, ttsLanguageModeLabel, warningCountdown]
  );
  const selectQueueIndexFromWindow = useCallback(
    (startChar: number | undefined) => {
      const nextIndex = playlist.findIndex((entry) => entry.kind === 'window' && entry.startChar === startChar);
      if (nextIndex >= 0) goToQueueIndex(nextIndex, true);
    },
    [goToQueueIndex, playlist]
  );
  const selectQueueIndexFromPanel = useCallback(
    (panelIndex: number) => {
      const nextIndex = playlist.findIndex((entry) => entry.kind === 'panel' && entry.panelIndex === panelIndex);
      if (nextIndex >= 0) goToQueueIndex(nextIndex, true);
    },
    [goToQueueIndex, playlist]
  );
  const pauseAutoSwipe = useCallback(() => setAutoSwipePausedUntil(Date.now() + 8000), []);

  return (
    <div ref={readerRootRef} className={rootClassName}>
      <div className="vf-reader__shell">
        <div className="vf-reader__backdrop">
          <div className="vf-reader__content">
            {!legalAck?.accepted && (
              <section className="vf-reader__section">
                <div className="vf-reader__notice-card">
                  <div className="vf-reader__section-eyebrow">Rights Notice</div>
                  <h3>{legalAck?.title || 'Acknowledge Reader rights once before importing content.'}</h3>
                  <p>{legalAck?.message || 'Upload only work you created, have permission to use, or that is openly licensed.'}</p>
                  <div className="vf-reader__notice-meta">{billingLabel}. Reader warns before unsaved cache expires.</div>
                  <button
                    type="button"
                    className="vf-reader__btn vf-reader__btn--primary"
                    onClick={async () => {
                      try {
                        setLegalAck(await acceptReaderLegalAck(mediaBackendUrl));
                        onToast('Reader rights acknowledgement saved.', 'success');
                      } catch (error) {
                        onToast(String((error as Error)?.message || 'Could not save Reader rights acknowledgement.'), 'error');
                      }
                    }}
                  >
                    Accept Once
                  </button>
                </div>
              </section>
            )}

            <div className={workspaceClassName}>
              <div className="vf-reader__workspace-main">
                {isPlaybackMode && session ? (
                  <ReaderPlaybackStage
                    session={session}
                    sessionItem={sessionItem}
                    activeItem={activeItem}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={() => void toggleFullscreen()}
                    onSelectWindow={selectQueueIndexFromWindow}
                    onSelectPanel={selectQueueIndexFromPanel}
                    resolveMediaUrl={resolveMediaUrl}
                    panelRefs={panelRefs}
                    pauseAutoSwipe={pauseAutoSwipe}
                    targetLanguageLabel={targetLanguageLabel}
                    pageViewModeLabel={pageViewModeLabel}
                  />
                ) : (
                  <ReaderBrowseHome
                    library={library}
                    filteredItems={filteredItems}
                    selectedItem={selectedItem}
                    resumeSession={resumeSession}
                    resumeItem={resumeSessionItem}
                    surface={surface}
                    regionId={regionId}
                    resultsCountLabel={resultsCountLabel}
                    viewMode={viewMode}
                    isLoading={isLoading}
                    currentPrimaryAction={currentPrimaryAction}
                    onSelectSurface={setSurface}
                    onSelectRegion={setRegionId}
                    onSelectItem={setSelectedItemId}
                    onPrimaryAction={() => void handlePrimaryAction()}
                    onResumeSession={() => void handleResumeSession()}
                    onOpenTools={() => openPanel('tools')}
                    onOpenAudit={() => openPanel('audit')}
                    onSetViewMode={setViewMode}
                    resolveMediaUrl={resolveMediaUrl}
                    formatCompactStat={formatCompactStat}
                    formatProgressLabel={formatProgressLabel}
                  />
                )}
              </div>

              <div
                ref={controlPanelRef}
                className={`vf-reader__workspace-side${isDesktopPanelCollapsed ? ' vf-reader__workspace-side--collapsed' : ''}`}
              >
                <ReaderControlPanel
                  activePanel={activePanel}
                  isCollapsed={isDesktopPanelCollapsed}
                  isCollapsible={isDesktopLayout}
                  session={session}
                  selectedItem={selectedBrowseItem}
                  sessionItem={sessionItem}
                  currentPrimaryAction={currentPrimaryAction}
                  library={library}
                  filteredItems={filteredItems}
                  selectedItemId={selectedItemId}
                  resultsCountLabel={resultsCountLabel}
                  viewMode={viewMode}
                  legalAck={legalAck}
                  surface={surface}
                  regionId={regionId}
                  searchQuery={searchQuery}
                  provider={provider}
                  collection={collection}
                  contentKind={contentKind}
                  progress={progress}
                  sort={sort}
                  uploadTitle={uploadTitle}
                  uploadContentType={uploadContentType}
                  uploadOwnershipBasis={uploadOwnershipBasis}
                  selectedFiles={selectedFiles}
                  targetLanguageDraft={targetLanguageDraft}
                  pageViewModeDraft={pageViewModeDraft}
                  ttsLanguageModeDraft={ttsLanguageModeDraft}
                  readingModeDraft={readingModeDraft}
                  autoAdvanceDraft={autoAdvanceDraft}
                  castDraft={castDraft}
                  castSpeakers={castSpeakers}
                  multiSpeakerEnabled={multiSpeakerEnabledDraft}
                  multiSpeakerStatusLabel={multiSpeakerStatusLabel}
                  isAutoAssigningCast={isAutoAssigningCast}
                  isSaving={isSaving}
                  isUploading={isUploading}
                  auditModel={auditModel}
                  onPanelChange={setActivePanel}
                  onToggleCollapsed={() => setPanelCollapsed((current) => !current)}
                  onPrimaryAction={() => void handlePrimaryAction()}
                  onExport={() => void handleExport()}
                  onRefreshLibrary={() => void loadLibrary()}
                  onSavepoint={() => void handleSavepoint()}
                  onCloseSession={() => void handleCloseSession()}
                  onRefreshSession={() => {
                    const refreshTarget = activeCatalogItem;
                    if (!refreshTarget) return;
                    void startSession(refreshTarget, { forceNew: true, autoPlay: true });
                  }}
                  onSelectItem={setSelectedItemId}
                  onSetViewMode={setViewMode}
                  onSetSurface={setSurface}
                  onSetRegionId={setRegionId}
                  onSetSearchQuery={setSearchQuery}
                  onSetProvider={setProvider}
                  onSetCollection={setCollection}
                  onSetContentKind={setContentKind}
                  onSetProgress={setProgress}
                  onSetSort={setSort}
                  onSetUploadTitle={setUploadTitle}
                  onSetUploadContentType={setUploadContentType}
                  onSetUploadOwnershipBasis={setUploadOwnershipBasis}
                  onFileSelection={setSelectedFiles}
                  onUpload={() => void handleUpload()}
                  onSetTargetLanguageDraft={setTargetLanguageDraft}
                  onSetPageViewModeDraft={setPageViewModeDraft}
                  onSetTtsLanguageModeDraft={setTtsLanguageModeDraft}
                  onSetReadingModeDraft={setReadingModeDraft}
                  onSetAutoAdvanceDraft={setAutoAdvanceDraft}
                  onCastDraftChange={setCastDraft}
                  onSetMultiSpeakerEnabled={setMultiSpeakerEnabledDraft}
                  onAutoAssignCast={handleAutoAssignCast}
                  resolveMediaUrl={resolveMediaUrl}
                  formatCompactStat={formatCompactStat}
                  formatProgressLabel={formatProgressLabel}
                />
              </div>
            </div>
          </div>
        </div>

        {isPlaybackMode && session && (
          <ReaderPlayerDock
            session={session}
            selectedItem={sessionItem || selectedItem}
            activeItem={activeItem}
            speechProgressPct={speechProgressPct}
            isSpeechPlaying={isSpeechPlaying}
            isSpeechBuffering={isSpeechBuffering}
            activeQueueIndex={activeQueueIndex}
            playlistLength={playlist.length}
            warningCountdown={warningCountdown}
            billingLabel={billingLabel}
            isMusicPlaying={isMusicPlaying}
            musicTrackId={musicTrackId}
            onTransportToggle={transportToggle}
            onPrev={() => goToQueueIndex(activeQueueIndex - 1, isSpeechPlaying || isSpeechBuffering)}
            onNext={() => goToQueueIndex(activeQueueIndex + 1, isSpeechPlaying || isSpeechBuffering)}
            onToggleMusic={() => setIsMusicPlaying((value) => !value)}
            onMusicTrackChange={setMusicTrackId}
            onExport={() => void handleExport()}
            onRefresh={() => {
              const refreshTarget = selectedItem || sessionItem;
              if (!refreshTarget) return;
              void startSession(refreshTarget, { forceNew: true, autoPlay: true });
            }}
            onClose={() => void handleCloseSession()}
            onAutoAssignCast={handleAutoAssignCast}
            canAutoAssignCast={multiSpeakerEnabledDraft && castSpeakers.length > 0}
            isAutoAssigningCast={isAutoAssigningCast}
          />
        )}
        <audio ref={speechAudioRef} preload="auto" />
        <audio ref={musicAudioRef} preload="auto" />
      </div>
    </div>
  );
};
