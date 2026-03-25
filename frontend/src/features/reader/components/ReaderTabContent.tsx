import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationSettings, ReaderCatalogItem, ReaderLegalAck, ReaderLibrary, ReaderSession, ReaderSessionProgress } from '../../../../types';
import { VOICES } from '../../../../constants';
import { parseMultiSpeakerScript } from '../../../../services/geminiService';
import { readStorageJson, writeStorageJson } from '../../../shared/storage/localStore';
import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { resolveApiUrl } from '../../../shared/api/config';
import { useWorkspaceViewport } from '../../../shared/ui/useWorkspaceViewport';
import {
  acceptReaderLegalAck,
  checkReaderCommercialUse,
  createReaderSession,
  createReaderUpload,
  exportReaderSessionAudio,
  getReaderCatalogItem,
  getReaderLegalAck,
  getReaderLibrary,
  getReaderPreferences,
  getReaderSession,
  getReaderTtsJobAudio,
  saveReaderSession,
  type ReaderCommercialCheckResponse,
  updateReaderPreferences,
  updateReaderProgress,
  type ReaderPreferencesPayload,
} from '../api/readerApi';
import { resolveReaderBootstrapState } from '../model/bootstrap';
import {
  isImportedItem,
  isLowConfidenceItem,
  resolveHomeTabItems,
  resolveImportedStatusBadge,
  sortReaderItems,
} from '../model/library';
import { buildReaderDeepLink, isReaderPath, parseReaderDeepLink } from '../model/route';
import { getReaderPlayableUnits, isLowConfidenceSession, resolveReaderMode, resolveReaderStatusLabel } from '../model/session';
import {
  coerceReaderHomeTab,
  coerceReaderTab,
  getReaderTabs,
  resolveImportedDefaultTab,
  type ReaderHomeTab,
  type ReaderHomeTabCounts,
  type ReaderMode,
  type ReaderTab,
} from '../model/tabs';
import { ReaderBrowseHome } from './ReaderBrowseHome';
import { ReaderLaunchModal } from './ReaderLaunchModal';
import { ReaderPlaybackStage } from './ReaderPlaybackStage';
import { ReaderStickyDock } from './ReaderStickyDock';
import { getReaderThemeClassName } from './readerTheme';
import type { ReaderRestoreEntry, ReaderRestoreStore, ReaderResolvedTheme, ReaderTabBadgeMap } from './readerTypes';
import { ReaderUtilityTray } from './ReaderUtilityTray';
import './reader.css';

interface ReaderTabContentProps {
  mediaBackendUrl: string;
  settings?: GenerationSettings;
  resolvedTheme: ReaderResolvedTheme;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const READER_RESTORE_VERSION = 1;
const READER_PREFERENCES_VERSION = 1;

interface ReaderRestoreEnvelope {
  version: number;
  entries: ReaderRestoreStore;
}

interface ReaderPreferencesEnvelope {
  version: number;
  preferences: ReaderPreferencesPayload;
}

const readReaderRestoreStore = (): ReaderRestoreStore => {
  const raw = readStorageJson<ReaderRestoreEnvelope | ReaderRestoreStore>(STORAGE_KEYS.readerRestoreState);
  if (!raw) return {};
  if (
    typeof raw === 'object'
    && raw !== null
    && 'version' in raw
    && 'entries' in raw
    && typeof (raw as ReaderRestoreEnvelope).entries === 'object'
    && (raw as ReaderRestoreEnvelope).entries !== null
  ) {
    return (raw as ReaderRestoreEnvelope).entries;
  }
  return raw as ReaderRestoreStore;
};

const writeReaderRestoreStore = (entries: ReaderRestoreStore): void => {
  writeStorageJson(STORAGE_KEYS.readerRestoreState, {
    version: READER_RESTORE_VERSION,
    entries,
  } satisfies ReaderRestoreEnvelope);
};

const readReaderPreferencesStore = (): ReaderPreferencesPayload => {
  const raw = readStorageJson<ReaderPreferencesEnvelope | ReaderPreferencesPayload>(STORAGE_KEYS.readerPreferences);
  if (!raw) return {};
  if (
    typeof raw === 'object'
    && raw !== null
    && 'version' in raw
    && 'preferences' in raw
    && typeof (raw as ReaderPreferencesEnvelope).preferences === 'object'
    && (raw as ReaderPreferencesEnvelope).preferences !== null
  ) {
    return (raw as ReaderPreferencesEnvelope).preferences;
  }
  return raw as ReaderPreferencesPayload;
};

const writeReaderPreferencesStore = (preferences: ReaderPreferencesPayload): void => {
  writeStorageJson(STORAGE_KEYS.readerPreferences, {
    version: READER_PREFERENCES_VERSION,
    preferences,
  } satisfies ReaderPreferencesEnvelope);
};

const getRestoreKey = (mode: ReaderMode, titleId: string): string =>
  `${mode}:${String(titleId || '').trim()}`;

const createObjectUrlFromBase64 = (audioBase64: string, mediaType: string): string | null => {
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

const normalizeContentMode = (item: ReaderCatalogItem | null | undefined, session: ReaderSession | null | undefined): ReaderMode => {
  if (item?.contentKind === 'comic') return 'comic';
  return resolveReaderMode(session);
};

const toHomeTab = (mode: ReaderMode): ReaderHomeTab =>
  mode === 'comic' ? 'comics' : 'novels';

const detectImportTypeFromFiles = (files: File[]): 'book' | 'comic' => {
  const comicExtensions = ['.cbz', '.zip', '.png', '.jpg', '.jpeg', '.webp'];
  const hasComicFile = files.some((file) => {
    const name = String(file.name || '').trim().toLowerCase();
    return comicExtensions.some((ext) => name.endsWith(ext));
  });
  return hasComicFile ? 'comic' : 'book';
};

const inferOwnershipBasis = (item: ReaderCatalogItem): 'own_work' | 'licensed' | 'open_license' | 'public_domain' | 'user_responsible' => {
  const provider = String(item.provider || '').trim().toLowerCase();
  if (provider === 'voiceflow_upload') return 'user_responsible';
  const license = String(item.license || '').trim().toLowerCase();
  if (!license) return 'user_responsible';
  if (license.includes('public domain') || license.includes('cc0') || license.includes('pdm')) return 'public_domain';
  if (license.includes('creativecommons') || license.includes('cc-by')) return 'open_license';
  return 'user_responsible';
};

const getActiveUnitText = (session: ReaderSession | null, mode: ReaderMode, activeUnitIndex: number): string => {
  if (!session) return '';
  if (mode === 'comic') {
    const panel = session.panels[activeUnitIndex];
    return String(panel?.displayText || panel?.translatedText || panel?.sourceText || panel?.text || '');
  }
  const windowItem = session.windows[activeUnitIndex];
  return String(windowItem?.displayText || windowItem?.translatedText || windowItem?.sourceText || windowItem?.text || '');
};

const getSessionSummary = (session: ReaderSession | null, sessionItem: ReaderCatalogItem | null): string =>
  String(session?.summary || sessionItem?.summary || sessionItem?.excerpt || '').trim();

const getCoverUrl = (session: ReaderSession | null, sessionItem: ReaderCatalogItem | null): string =>
  String(session?.coverUrl || sessionItem?.coverUrl || '').trim();

export const ReaderTabContent: React.FC<ReaderTabContentProps> = ({
  mediaBackendUrl,
  settings,
  resolvedTheme,
  onToast,
}) => {
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRegistryRef = useRef<string[]>([]);
  const hasHandledDeepLinkRef = useRef(false);
  const hasUserChangedHomeTabRef = useRef(false);
  const readerPreferencesCacheRef = useRef<ReaderPreferencesPayload>(readReaderPreferencesStore());
  const lastPersistedReaderTabRef = useRef<{ sessionKey: string; tab: ReaderTab } | null>(null);
  const initialDeepLinkRef = useRef(
    typeof window === 'undefined'
      ? null
      : parseReaderDeepLink(window.location.pathname, window.location.search)
  );
  const { isPhone, isTablet } = useWorkspaceViewport();

  const [library, setLibrary] = useState<ReaderLibrary | null>(null);
  const [libraryError, setLibraryError] = useState<unknown>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [legalAck, setLegalAck] = useState<ReaderLegalAck | null>(null);
  const [homeTab, setHomeTab] = useState<ReaderHomeTab>(() => coerceReaderHomeTab(readerPreferencesCacheRef.current.homeTab));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [previewItemId, setPreviewItemId] = useState('');
  const [previewItemSnapshot, setPreviewItemSnapshot] = useState<ReaderCatalogItem | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [commercialCheck, setCommercialCheck] = useState<ReaderCommercialCheckResponse | null>(null);
  const [isCheckingCommercial, setIsCheckingCommercial] = useState(false);
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [sessionItemId, setSessionItemId] = useState('');
  const [mode, setMode] = useState<ReaderMode>('novel');
  const [activeTab, setActiveTab] = useState<ReaderTab>('read');
  const [activeUnitIndex, setActiveUnitIndex] = useState(0);
  const [multiSpeakerEnabled, setMultiSpeakerEnabled] = useState(settings?.multiSpeakerEnabled !== false);
  const [narratorVoiceId, setNarratorVoiceId] = useState(String(settings?.voiceId || VOICES[0]?.id || 'v1'));
  const [playbackSpeed, setPlaybackSpeed] = useState(Number(settings?.speed || 1));
  const [ambiencePreset, setAmbiencePreset] = useState('none');
  const [stylePreset, setStylePreset] = useState('default');
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [playbackLanguage, setPlaybackLanguage] = useState('en');
  const [castDraft, setCastDraft] = useState<Record<string, string>>({});
  const [unitOverridesDraft, setUnitOverridesDraft] = useState<Record<string, string>>({});
  const [textDraft, setTextDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [audioProgressPct, setAudioProgressPct] = useState(0);
  const [statusLabel, setStatusLabel] = useState('Idle');
  const [miniMode, setMiniMode] = useState(() => isPhone || isTablet);
  const [lastJobId, setLastJobId] = useState('');
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});

  const sessionItem = useMemo(
    () => (library?.items || []).find((item) => item.id === sessionItemId) || null,
    [library?.items, sessionItemId]
  );
  const previewItem = useMemo(() => {
    if (previewItemSnapshot && previewItemSnapshot.id === previewItemId) return previewItemSnapshot;
    return (library?.items || []).find((item) => item.id === previewItemId) || null;
  }, [library?.items, previewItemId, previewItemSnapshot]);
  const filteredItems = useMemo(
    () => sortReaderItems(resolveHomeTabItems(library, homeTab, searchTerm)),
    [library, homeTab, searchTerm]
  );
  const homeTabCounts = useMemo<ReaderHomeTabCounts>(() => {
    const counts = {
      novels: resolveHomeTabItems(library, 'novels', searchTerm).length,
      comics: resolveHomeTabItems(library, 'comics', searchTerm).length,
      library: resolveHomeTabItems(library, 'library', searchTerm).length,
      imported: resolveHomeTabItems(library, 'imported', searchTerm).length,
    } satisfies ReaderHomeTabCounts;
    return counts;
  }, [library, searchTerm]);

  const activeText = useMemo(
    () => getActiveUnitText(session, mode, activeUnitIndex),
    [activeUnitIndex, mode, session]
  );
  const translationSupported = useMemo(
    () => Boolean(sessionItem?.translationSupport?.page || sessionItem?.translationSupport?.tts || session?.translationState === 'ready' || session?.translationState === 'warming'),
    [session?.translationState, sessionItem?.translationSupport?.page, sessionItem?.translationSupport?.tts]
  );
  const playbackUnits = useMemo(() => getReaderPlayableUnits(session), [session]);
  const activeUnit = playbackUnits[activeUnitIndex] || null;

  const detectedSpeakers = useMemo(() => {
    const fromCast = Object.keys(castDraft || {})
      .map((speaker) => String(speaker || '').trim())
      .filter((speaker) => Boolean(speaker) && speaker.toLowerCase() !== 'narrator');
    const fromText = parseMultiSpeakerScript(activeText).speakersList
      .map((speaker) => String(speaker || '').trim())
      .filter((speaker) => Boolean(speaker) && speaker.toLowerCase() !== 'narrator');
    return Array.from(new Set([...fromCast, ...fromText]));
  }, [activeText, castDraft]);

  const unassignedSpeakerCount = useMemo(() => {
    if (!multiSpeakerEnabled) return 0;
    return detectedSpeakers.filter((speaker) => !String(castDraft[speaker] || '').trim()).length;
  }, [castDraft, detectedSpeakers, multiSpeakerEnabled]);

  const availableTabs = useMemo(
    () => getReaderTabs({
      mode,
      multiSpeakerEnabled,
      speakerCount: detectedSpeakers.length,
      translationSupported,
      sourceLanguage,
      playbackLanguage,
    }),
    [detectedSpeakers.length, mode, multiSpeakerEnabled, playbackLanguage, sourceLanguage, translationSupported]
  );

  useEffect(() => {
    setActiveTab((current) => coerceReaderTab(current, availableTabs, mode));
  }, [availableTabs, mode]);

  useEffect(() => {
    setTextDraft(activeText || '');
  }, [activeText, activeUnit?.id]);

  useEffect(() => {
    setStatusLabel(isPreparingAudio ? 'Generating Audio' : resolveReaderStatusLabel(session));
  }, [isPreparingAudio, session]);

  useEffect(() => {
    if (isPhone || isTablet) {
      setMiniMode(true);
    }
  }, [isPhone, isTablet]);

  useEffect(() => {
    const audioNode = audioRef.current;
    if (!audioNode) return undefined;

    const onTimeUpdate = () => {
      if (!audioNode.duration || Number.isNaN(audioNode.duration)) {
        setAudioProgressPct(0);
        return;
      }
      setAudioProgressPct(Math.max(0, Math.min(100, (audioNode.currentTime / audioNode.duration) * 100)));
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setAudioProgressPct(100);
      setActiveUnitIndex((current) => {
        if (current >= playbackUnits.length - 1) return current;
        return current + 1;
      });
    };

    audioNode.addEventListener('timeupdate', onTimeUpdate);
    audioNode.addEventListener('play', onPlay);
    audioNode.addEventListener('pause', onPause);
    audioNode.addEventListener('ended', onEnded);

    return () => {
      audioNode.removeEventListener('timeupdate', onTimeUpdate);
      audioNode.removeEventListener('play', onPlay);
      audioNode.removeEventListener('pause', onPause);
      audioNode.removeEventListener('ended', onEnded);
    };
  }, [playbackUnits.length]);

  useEffect(() => () => {
    objectUrlRegistryRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlRegistryRef.current = [];
  }, []);

  useEffect(() => {
    if (!previewItem) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewItemId('');
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [previewItem]);

  const resolveMediaUrl = useCallback((url: string | undefined): string => {
    const safe = String(url || '').trim();
    if (!safe) return '';
    if (/^https?:\/\//i.test(safe)) return safe;
    return resolveApiUrl(safe, mediaBackendUrl);
  }, [mediaBackendUrl]);

  const persistHomeTab = useCallback((nextHomeTab: ReaderHomeTab) => {
    hasUserChangedHomeTabRef.current = true;
    setHomeTab(nextHomeTab);
    const nextPreferences = {
      ...readerPreferencesCacheRef.current,
      homeTab: nextHomeTab,
    };
    readerPreferencesCacheRef.current = nextPreferences;
    writeReaderPreferencesStore(nextPreferences);
    void updateReaderPreferences(mediaBackendUrl, { homeTab: nextHomeTab })
      .then((updatedPreferences) => {
        const mergedPreferences = {
          ...readerPreferencesCacheRef.current,
          ...updatedPreferences,
          homeTab: coerceReaderHomeTab(updatedPreferences.homeTab || readerPreferencesCacheRef.current.homeTab || nextHomeTab),
        };
        readerPreferencesCacheRef.current = mergedPreferences;
        writeReaderPreferencesStore(mergedPreferences);
      })
      .catch(() => undefined);
  }, [mediaBackendUrl]);

  const loadLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    try {
      const [libraryResult, legalResult, preferencesResult] = await Promise.allSettled([
        getReaderLibrary(mediaBackendUrl, { surface: 'all' }),
        getReaderLegalAck(mediaBackendUrl),
        getReaderPreferences(mediaBackendUrl),
      ]);
      const serverPreferences = preferencesResult.status === 'fulfilled' ? preferencesResult.value : null;
      const resolvedPreferences = {
        ...readerPreferencesCacheRef.current,
        ...(serverPreferences || {}),
        homeTab: coerceReaderHomeTab(serverPreferences?.homeTab || readerPreferencesCacheRef.current.homeTab),
      };
      readerPreferencesCacheRef.current = resolvedPreferences;
      writeReaderPreferencesStore(resolvedPreferences);

      if (libraryResult.status === 'fulfilled') {
        const libraryPayload = libraryResult.value;
        setLibrary(libraryPayload);
        setLibraryError(null);
        if (!hasUserChangedHomeTabRef.current) {
          setHomeTab((current) => coerceReaderHomeTab(resolvedPreferences.homeTab, current));
        }
        const first = libraryPayload.items[0];
        if (first) setSelectedItemId((current) => current || first.id);
      } else {
        setLibraryError(libraryResult.reason);
        const message = String((libraryResult.reason as Error)?.message || 'Could not load Reader catalog.');
        onToast(message, 'error');
      }

      if (legalResult.status === 'fulfilled') {
        setLegalAck(legalResult.value.ack);
      }
    } catch (error) {
      setLibraryError(error);
      const message = String((error as Error)?.message || 'Could not load Reader catalog.');
      onToast(message, 'error');
    } finally {
      setIsLoadingLibrary(false);
    }
  }, [mediaBackendUrl, onToast]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const openReaderItem = useCallback(async (
    item: ReaderCatalogItem,
    options?: {
      requestedTab?: ReaderTab;
      chapter?: number;
      episode?: number;
      fromDeepLink?: boolean;
    }
  ): Promise<boolean> => {
    try {
      const nextSession = await createReaderSession(mediaBackendUrl, {
        ...(isImportedItem(item) ? { uploadId: item.id } : { itemId: item.id }),
        targetLanguage,
        multiSpeakerEnabled,
        narratorVoiceId,
        audioEngine: 'tts_hd',
      });
      const nextMode = normalizeContentMode(item, nextSession);
      const nextUnits = getReaderPlayableUnits(nextSession);
      const restoreStore = readReaderRestoreStore();
      const restoreKey = getRestoreKey(nextMode, item.id);
      const restoreEntry = restoreStore[restoreKey];
      const routeUnitIndexRaw = nextMode === 'comic' ? (options?.episode || 0) : (options?.chapter || 0);
      const routeUnitIndex = routeUnitIndexRaw > 0 ? routeUnitIndexRaw - 1 : -1;
      const persistedUnitIndex = nextMode === 'comic'
        ? Number(restoreEntry?.lastEpisode || 0) - 1
        : Number(restoreEntry?.lastChapter || 0) - 1;
      const nextIndexCandidate = routeUnitIndex >= 0
        ? routeUnitIndex
        : persistedUnitIndex >= 0
          ? persistedUnitIndex
          : Number(nextSession.restoreState?.activeItemIndex || 0);
      const clampedIndex = Math.max(0, Math.min(Math.max(0, nextUnits.length - 1), nextIndexCandidate));
      const nextLowConfidence = isLowConfidenceSession(nextSession) || isLowConfidenceItem(item);
      const nextTabs = getReaderTabs({
        mode: nextMode,
        multiSpeakerEnabled: nextSession.multiSpeakerEnabled !== false,
        speakerCount: Object.keys(nextSession.castMemory || {}).length,
        translationSupported: Boolean(item.translationSupport?.page || item.translationSupport?.tts || nextSession.translationState === 'ready' || nextSession.translationState === 'warming'),
        sourceLanguage: nextSession.sourceLanguage,
        playbackLanguage: nextSession.targetLanguage || nextSession.sourceLanguage,
      });
      const requestedTab = options?.requestedTab
        || (nextSession.restoreState?.activeReaderTab as ReaderTab | undefined)
        || (restoreEntry?.lastReaderTab as ReaderTab | undefined);
      const fallbackDefaultTab = resolveImportedDefaultTab({
        mode: nextMode,
        imported: isImportedItem(item),
        lowConfidence: nextLowConfidence,
        availableTabs: nextTabs,
      });
      const nextTab = coerceReaderTab(requestedTab || fallbackDefaultTab, nextTabs, nextMode);

      setSession(nextSession);
      setSessionItemId(item.id);
      setPreviewItemId('');
      setPreviewItemSnapshot(null);
      setIsLoadingPreview(false);
      setCommercialCheck(null);
      setIsCheckingCommercial(false);
      setMode(nextMode);
      setActiveUnitIndex(clampedIndex);
      setActiveTab(nextTab);
      setMultiSpeakerEnabled(nextSession.multiSpeakerEnabled !== false);
      setNarratorVoiceId(String(nextSession.narratorVoiceId || narratorVoiceId || VOICES[0]?.id || 'v1'));
      setSourceLanguage(String(nextSession.sourceLanguage || sourceLanguage || 'en'));
      setTargetLanguage(String(nextSession.targetLanguage || targetLanguage || nextSession.sourceLanguage || 'en'));
      setPlaybackLanguage(String(nextSession.targetLanguage || nextSession.sourceLanguage || 'en'));
      setCastDraft(nextSession.castMemory || {});
      setUnitOverridesDraft(nextSession.unitOverrides || {});

      if (restoreEntry && typeof restoreEntry.lastScrollPosition === 'number' && !options?.fromDeepLink) {
        window.requestAnimationFrame(() => {
          if (contentScrollRef.current) contentScrollRef.current.scrollTop = restoreEntry.lastScrollPosition;
        });
      } else {
        window.requestAnimationFrame(() => {
          if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
        });
      }
      return true;
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not open reader title.'), 'error');
      return false;
    }
  }, [mediaBackendUrl, multiSpeakerEnabled, narratorVoiceId, onToast, sourceLanguage, targetLanguage]);

  useEffect(() => {
    if (hasHandledDeepLinkRef.current) return;
    if (!library) return;
    hasHandledDeepLinkRef.current = true;
    const deepLink = initialDeepLinkRef.current;
    if (!deepLink) return;
    const matchedItem = library.items.find((item) => item.id === deepLink.titleId);
    if (!matchedItem) return;
    setHomeTab(toHomeTab(deepLink.mode));
    void openReaderItem(matchedItem, {
      ...(deepLink.tab ? { requestedTab: deepLink.tab } : {}),
      ...(deepLink.chapter ? { chapter: deepLink.chapter } : {}),
      ...(deepLink.episode ? { episode: deepLink.episode } : {}),
      fromDeepLink: true,
    });
  }, [library, openReaderItem]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!sessionItemId) {
      const url = new URL(window.location.href);
      if (!isReaderPath(url.pathname)) {
        url.pathname = '/reader';
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
      return;
    }
    const unitNumber = activeUnitIndex + 1;
    const nextHref = buildReaderDeepLink({
      mode,
      titleId: sessionItemId,
      tab: activeTab,
      ...(mode === 'novel' ? { chapter: unitNumber } : { episode: unitNumber }),
    }, window.location.href);
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextHref !== currentHref) {
      window.history.replaceState({}, '', nextHref);
    }
  }, [activeTab, activeUnitIndex, mode, sessionItemId]);

  useEffect(() => {
    if (!sessionItemId) return;
    const restoreStore = readReaderRestoreStore();
    const restoreKey = getRestoreKey(mode, sessionItemId);
    const nextEntry: ReaderRestoreEntry = {
      lastReaderTab: activeTab,
      ...(mode === 'novel' ? { lastChapter: activeUnitIndex + 1 } : { lastEpisode: activeUnitIndex + 1 }),
      lastScrollPosition: Math.max(0, Number(contentScrollRef.current?.scrollTop || 0)),
      ...(lastJobId ? { jobId: lastJobId } : {}),
      updatedAt: Date.now(),
    };
    writeReaderRestoreStore({
      ...restoreStore,
      [restoreKey]: nextEntry,
    });
    const sessionKey = String(session?.id || sessionItemId);
    const shouldPersistTab =
      lastPersistedReaderTabRef.current?.sessionKey !== sessionKey
      || lastPersistedReaderTabRef.current?.tab !== activeTab;
    if (!session?.id || !shouldPersistTab) return;
    lastPersistedReaderTabRef.current = {
      sessionKey,
      tab: activeTab,
    };
    const restoreState = {
      activeItemIndex: activeUnitIndex,
      ...(activeUnit?.id ? { activeUnitId: activeUnit.id, viewportAnchor: activeUnit.id } : {}),
      activeReaderTab: activeTab,
    };
    void saveReaderSession(mediaBackendUrl, session.id, { restoreState })
      .then((nextSession) => setSession(nextSession))
      .catch(() => undefined);
  }, [activeTab, activeUnit?.id, activeUnitIndex, lastJobId, mediaBackendUrl, mode, session?.id, sessionItemId]);

  useEffect(() => {
    if (!session?.id) return;
    const consumedChars = session.windows
      .slice(0, Math.max(0, activeUnitIndex + 1))
      .reduce((total, windowItem) => total + Number(windowItem.charCount || 0), 0);
    const progressPayload: ReaderSessionProgress = {
      activeItemIndex: activeUnitIndex,
      ...(activeUnit?.id ? { activeUnitId: activeUnit.id, viewportAnchor: activeUnit.id } : {}),
      ...(mode === 'comic' ? { currentPanelIndex: activeUnitIndex } : { consumedChars }),
    };
    void updateReaderProgress(mediaBackendUrl, session.id, progressPayload)
      .then((nextSession) => setSession(nextSession))
      .catch(() => undefined);
    // Sync progress only when position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUnitIndex, mediaBackendUrl, mode, session?.id]);

  const resolveAudioUrlForUnit = useCallback(async (): Promise<string> => {
    if (!activeUnit) return '';
    if (audioUrls[activeUnit.id]) return audioUrls[activeUnit.id] || '';

    if (!activeUnit.jobId) return '';
    setIsPreparingAudio(true);
    try {
      const payload = await getReaderTtsJobAudio(mediaBackendUrl, activeUnit.jobId);
      setLastJobId(activeUnit.jobId);
      if (payload.blob) {
        const objectUrl = URL.createObjectURL(payload.blob);
        objectUrlRegistryRef.current.push(objectUrl);
        setAudioUrls((current) => ({ ...current, [activeUnit.id]: objectUrl }));
        return objectUrl;
      }
      if (payload.audioBase64) {
        const objectUrl = createObjectUrlFromBase64(payload.audioBase64, payload.mediaType || 'audio/wav');
        if (objectUrl) {
          objectUrlRegistryRef.current.push(objectUrl);
          setAudioUrls((current) => ({ ...current, [activeUnit.id]: objectUrl }));
          return objectUrl;
        }
      }
      return '';
    } finally {
      setIsPreparingAudio(false);
    }
  }, [activeUnit, audioUrls, mediaBackendUrl]);

  const handleTogglePlay = useCallback(async () => {
    const audioNode = audioRef.current;
    if (!audioNode) return;
    if (isPlaying) {
      audioNode.pause();
      return;
    }
    const nextUrl = await resolveAudioUrlForUnit();
    if (!nextUrl) {
      onToast('Audio is still preparing for this unit.', 'info');
      return;
    }
    if (audioNode.src !== nextUrl) audioNode.src = nextUrl;
    try {
      await audioNode.play();
    } catch {
      onToast('Playback is blocked until the browser allows audio.', 'info');
    }
  }, [isPlaying, onToast, resolveAudioUrlForUnit]);

  const handleSelectUnit = useCallback((nextIndex: number) => {
    const clamped = Math.max(0, Math.min(Math.max(0, playbackUnits.length - 1), nextIndex));
    setActiveUnitIndex(clamped);
    setAudioProgressPct(0);
  }, [playbackUnits.length]);

  const handleApplyTextEdit = useCallback(async () => {
    if (!session?.id || !activeUnit) return;
    const nextBody = textDraft.trim();
    if (!nextBody) return;
    const nextOverrides = {
      ...unitOverridesDraft,
      [activeUnit.id]: nextBody,
    };
    setUnitOverridesDraft(nextOverrides);
    setIsSaving(true);
    try {
      const nextSession = await saveReaderSession(mediaBackendUrl, session.id, {
        unitOverrides: nextOverrides,
        multiSpeakerEnabled,
        narratorVoiceId,
      });
      setSession(nextSession);
      onToast('Text override applied.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not apply text override.'), 'error');
    } finally {
      setIsSaving(false);
    }
  }, [activeUnit, mediaBackendUrl, multiSpeakerEnabled, narratorVoiceId, onToast, session?.id, textDraft, unitOverridesDraft]);

  const handleResetTextEdit = useCallback(() => {
    setTextDraft(activeText || '');
  }, [activeText]);

  const handleRefresh = useCallback(async () => {
    try {
      const sessionPromise = session?.id
        ? getReaderSession(mediaBackendUrl, session.id)
        : Promise.resolve(null);
      const [, sessionResult] = await Promise.allSettled([
        loadLibrary(),
        sessionPromise,
      ]);
      if (session?.id && sessionResult.status === 'fulfilled' && sessionResult.value) {
        setSession(sessionResult.value);
        onToast('Reader refreshed.', 'success');
        return;
      }
      if (session?.id) {
        onToast('Could not refresh reader session.', 'error');
      }
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not refresh reader session.'), 'error');
    }
  }, [loadLibrary, mediaBackendUrl, onToast, session?.id]);

  const handleExport = useCallback(async () => {
    if (!session?.id) return;
    try {
      const blob = await exportReaderSessionAudio(mediaBackendUrl, session.id);
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRegistryRef.current.push(objectUrl);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${session.title || 'reader-session'}.wav`;
      anchor.click();
      onToast('Reader export started.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not export reader audio.'), 'error');
    }
  }, [mediaBackendUrl, onToast, session?.id, session?.title]);

  const handleClose = useCallback(() => {
    const audioNode = audioRef.current;
    if (audioNode) {
      audioNode.pause();
      audioNode.removeAttribute('src');
      audioNode.load();
    }
    setSession(null);
    setSessionItemId('');
    setPreviewItemId('');
    setPreviewItemSnapshot(null);
    setIsLoadingPreview(false);
    setCommercialCheck(null);
    setIsCheckingCommercial(false);
    setActiveUnitIndex(0);
    setActiveTab('read');
    setIsPlaying(false);
    setAudioProgressPct(0);
    lastPersistedReaderTabRef.current = null;
    const url = new URL(window.location.href);
    url.pathname = '/reader';
    const readerQueryKeys = ['tab', 'chapter', 'episode', 'vf-reader-mode', 'vf-reader-item', 'vf-reader-title', 'vf-reader-tab', 'vf-reader-chapter', 'vf-reader-episode'];
    readerQueryKeys.forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const runCommercialCheckForItem = useCallback((item: ReaderCatalogItem) => {
    const sourceMeta = item.sourceMeta && typeof item.sourceMeta === 'object'
      ? item.sourceMeta as Record<string, unknown>
      : null;
    const attributionUrl = String(sourceMeta?.attributionUrl || item.sourceUrl || '').trim();
    const ownershipBasis = inferOwnershipBasis(item);
    setIsCheckingCommercial(true);
    setCommercialCheck(null);
    void checkReaderCommercialUse(mediaBackendUrl, {
      provider: item.provider,
      license: item.license,
      attributionUrl,
      ownershipBasis,
      intendedUse: 'tts_transform_only',
      isSellingOriginalText: false,
    })
      .then((result) => setCommercialCheck(result))
      .catch((error) => {
        setCommercialCheck({
          result: 'review',
          reason: String((error as Error)?.message || 'Could not verify commercial policy.'),
          provider: String(item.provider || '').trim().toLowerCase(),
          licenseToken: '',
          ownershipBasis,
          intendedUse: 'tts_transform_only',
          isSellingOriginalText: false,
          catalogAllowed: false,
          notes: [],
          nextSteps: ['Use imported content with explicit rights basis if policy check is unavailable.'],
        });
      })
      .finally(() => setIsCheckingCommercial(false));
  }, [mediaBackendUrl]);

  const handleRequestOpenItem = useCallback((itemId: string) => {
    setSelectedItemId(itemId);
    setPreviewItemId(itemId);
    const cached = (library?.items || []).find((item) => item.id === itemId) || null;
    setPreviewItemSnapshot(cached);
    setIsLoadingPreview(true);
    void getReaderCatalogItem(mediaBackendUrl, itemId)
      .then((item) => {
        setPreviewItemSnapshot(item);
        runCommercialCheckForItem(item);
      })
      .catch((error) => {
        if (!cached) {
          onToast(String((error as Error)?.message || 'Could not load reader summary.'), 'error');
        }
      })
      .finally(() => setIsLoadingPreview(false));
    if (cached) runCommercialCheckForItem(cached);
  }, [library?.items, mediaBackendUrl, onToast, runCommercialCheckForItem]);

  const handleImportUpload = useCallback(async () => {
    if (uploadFiles.length === 0) {
      onToast('Select files to import first.', 'info');
      return;
    }
    if (!legalAck?.accepted) {
      onToast('Accept reader rights once before importing.', 'info');
      return;
    }
    setIsUploading(true);
    try {
      const contentType = detectImportTypeFromFiles(uploadFiles);
      const upload = await createReaderUpload(mediaBackendUrl, {
        files: uploadFiles,
        title: uploadTitle || uploadFiles[0]?.name || 'Imported title',
        contentType,
        regionId: library?.regionId || 'english',
      });
      setUploadFiles([]);
      setUploadTitle('');
      persistHomeTab('imported');
      setSelectedItemId(upload.id);
      void loadLibrary();
      const opened = await openReaderItem(upload);
      if (opened) {
        onToast('Import opened in player.', 'success');
        return;
      }
      handleRequestOpenItem(upload.id);
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not import files.'), 'error');
    } finally {
      setIsUploading(false);
    }
  }, [handleRequestOpenItem, legalAck?.accepted, library?.regionId, loadLibrary, mediaBackendUrl, onToast, openReaderItem, persistHomeTab, uploadFiles, uploadTitle]);

  const handleConfirmPreviewRead = useCallback(() => {
    if (!previewItem) return;
    if (commercialCheck?.result === 'blocked') {
      onToast(commercialCheck.reason || 'This title is blocked for commercial workflow. Use licensed import.', 'error');
      return;
    }
    void openReaderItem(previewItem);
  }, [commercialCheck?.reason, commercialCheck?.result, onToast, openReaderItem, previewItem]);

  const bootstrapState = resolveReaderBootstrapState({
    library,
    ...(libraryError ? { libraryError } : {}),
  });

  const textDirty = textDraft.trim() !== activeText.trim();
  const lowConfidenceSignal = isLowConfidenceSession(session) || isLowConfidenceItem(sessionItem || undefined);
  const speakerCountLabel = detectedSpeakers.length === 1
    ? '1 speaker'
    : `${detectedSpeakers.length} speakers`;
  const tabBadges: ReaderTabBadgeMap = {
    voices: multiSpeakerEnabled ? 'Multi-speaker' : 'Single-speaker',
    ...(availableTabs.includes('cast') ? { cast: unassignedSpeakerCount > 0 ? `${unassignedSpeakerCount} unassigned` : speakerCountLabel } : {}),
    ...(availableTabs.includes('text') && (lowConfidenceSignal || unassignedSpeakerCount > 0 || textDirty) ? { text: 'Needs review' } : {}),
    ...(availableTabs.includes('translate') ? { translate: `Target: ${String(targetLanguage || playbackLanguage || 'EN').slice(0, 2).toUpperCase()}` } : {}),
  };

  const overallProgress = session?.progressPct && session.progressPct > 0
    ? Number(session.progressPct)
    : playbackUnits.length > 0
      ? ((activeUnitIndex + Math.max(0.01, audioProgressPct / 100)) / playbackUnits.length) * 100
      : 0;

  const translationPreview = useMemo(() => {
    const content = activeText.trim();
    if (!content) return '';
    if (sourceLanguage === targetLanguage) return content;
    return `[${targetLanguage.toUpperCase()}] ${content}`;
  }, [activeText, sourceLanguage, targetLanguage]);

  return (
    <div className={getReaderThemeClassName(resolvedTheme)}>
      <div className="vf-reader-v2-shell">
        {!legalAck?.accepted ? (
          <section className="vf-reader-v2-notice">
            <div>
              <strong>Reader Rights Notice</strong>
              <p>Accept once to import EPUB, TXT, PDF, images, ZIP, and CBZ sources.</p>
            </div>
            <button
              type="button"
              className="vf-reader-v2-primary"
              onClick={() => {
                void acceptReaderLegalAck(mediaBackendUrl)
                  .then((ack) => {
                    setLegalAck(ack);
                    onToast('Reader rights accepted.', 'success');
                  })
                  .catch((error) => onToast(String((error as Error)?.message || 'Could not save reader rights acknowledgement.'), 'error'));
              }}
            >
              Accept Once
            </button>
          </section>
        ) : null}

        {bootstrapState === 'error' && !library ? (
          <section className="vf-reader-v2-empty">
            Reader could not load right now. Retry after checking backend availability.
          </section>
        ) : null}
        {bootstrapState === 'needs_auth' && !library ? (
          <section className="vf-reader-v2-empty">
            Sign in to load your Reader shelves and restore sessions.
          </section>
        ) : null}

        {!session ? (
          <>
            <section className="vf-reader-v2-import">
              <label>
                <span>Quick Import</span>
                <input
                  type="file"
                  multiple
                  accept=".txt,.md,.docx,.pdf,.epub,.cbz,.zip,.png,.jpg,.jpeg,.webp"
                  onChange={(event) => setUploadFiles(Array.from(event.target.files || []))}
                />
              </label>
              <label>
                <span>Title</span>
                <input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Optional title" />
              </label>
              <button type="button" className="vf-reader-v2-primary" onClick={() => void handleImportUpload()} disabled={isUploading}>
                {isUploading ? 'Importing...' : `Import${uploadFiles.length > 0 ? ` (${uploadFiles.length})` : ''}`}
              </button>
            </section>

            <ReaderBrowseHome
              homeTab={homeTab}
              homeTabCounts={homeTabCounts}
              searchTerm={searchTerm}
              items={filteredItems}
              selectedItemId={selectedItemId}
              isLoading={isLoadingLibrary}
              onChangeHomeTab={persistHomeTab}
              onChangeSearchTerm={setSearchTerm}
              onSelectItem={setSelectedItemId}
              onOpenItem={handleRequestOpenItem}
              resolveImportedStatusBadge={resolveImportedStatusBadge}
              resolveMediaUrl={resolveMediaUrl}
            />
          </>
        ) : (
          <>
            <section className="vf-reader-v2-workspace__toolbar">
              <button type="button" className="vf-reader-v2-secondary" onClick={handleClose}>
                Back To Home
              </button>
              <span>{mode === 'novel' ? 'Novel Reader' : 'Comic Reader'}</span>
            </section>

            <div className="vf-reader-v2-workspace">
              <ReaderPlaybackStage
                mode={mode}
                title={String(session.title || sessionItem?.title || 'Reader')}
                summary={getSessionSummary(session, sessionItem)}
                progressPct={overallProgress}
                activeUnitIndex={activeUnitIndex}
                units={playbackUnits}
                coverUrl={resolveMediaUrl(getCoverUrl(session, sessionItem))}
                statusLabel={statusLabel}
                contentScrollRef={contentScrollRef}
                onSelectUnit={handleSelectUnit}
              />

              <ReaderUtilityTray
                mode={mode}
                tabs={availableTabs}
                activeTab={activeTab}
                tabBadges={tabBadges}
                sourceLanguage={sourceLanguage}
                targetLanguage={targetLanguage}
                playbackLanguage={playbackLanguage}
                translationPreview={translationPreview}
                translationSupported={translationSupported}
                multiSpeakerEnabled={multiSpeakerEnabled}
                narratorVoiceId={narratorVoiceId}
                speed={playbackSpeed}
                ambiencePreset={ambiencePreset}
                stylePreset={stylePreset}
                voiceOptions={VOICES}
                detectedSpeakers={detectedSpeakers}
                castDraft={castDraft}
                textDraft={textDraft}
                activeText={activeText}
                textDirty={textDirty}
                onChangeTab={setActiveTab}
                onToggleMultiSpeaker={() => setMultiSpeakerEnabled((current) => !current)}
                onNarratorVoiceChange={setNarratorVoiceId}
                onSpeedChange={setPlaybackSpeed}
                onAmbiencePresetChange={setAmbiencePreset}
                onStylePresetChange={setStylePreset}
                onCastDraftChange={(nextCast) => {
                  setCastDraft(nextCast);
                  if (!session?.id) return;
                  void saveReaderSession(mediaBackendUrl, session.id, {
                    castOverrides: nextCast,
                    multiSpeakerEnabled,
                    narratorVoiceId,
                  }).catch(() => undefined);
                }}
                onTextDraftChange={setTextDraft}
                onApplyTextEdit={() => void handleApplyTextEdit()}
                onResetTextEdit={handleResetTextEdit}
                onSourceLanguageChange={setSourceLanguage}
                onTargetLanguageChange={setTargetLanguage}
                onPlaybackLanguageChange={setPlaybackLanguage}
              />
            </div>
          </>
        )}

        {previewItem ? (
          <ReaderLaunchModal
            item={previewItem}
            isLoading={isLoadingPreview}
            commercialCheck={commercialCheck}
            isCheckingCommercial={isCheckingCommercial}
            resolveMediaUrl={resolveMediaUrl}
            onClose={() => {
              setPreviewItemId('');
              setPreviewItemSnapshot(null);
              setIsLoadingPreview(false);
              setCommercialCheck(null);
              setIsCheckingCommercial(false);
            }}
            onRead={handleConfirmPreviewRead}
          />
        ) : null}

        <ReaderStickyDock
          title={String(session?.title || sessionItem?.title || 'Reader')}
          unitLabel={activeUnit?.title || (mode === 'novel' ? 'Read' : 'Panels')}
          progressPct={overallProgress}
          statusLabel={statusLabel}
          isPlaying={isPlaying}
          miniMode={miniMode}
          ambiencePreset={ambiencePreset}
          stylePreset={stylePreset}
          onTogglePlay={() => void handleTogglePlay()}
          onPrev={() => handleSelectUnit(activeUnitIndex - 1)}
          onNext={() => handleSelectUnit(activeUnitIndex + 1)}
          onRefresh={() => void handleRefresh()}
          onExport={() => void handleExport()}
          onClose={handleClose}
          onToggleMiniMode={() => setMiniMode((current) => !current)}
          onAmbiencePresetChange={setAmbiencePreset}
          onStylePresetChange={setStylePreset}
        />
        <audio ref={audioRef} preload="auto" />
      </div>
    </div>
  );
};
