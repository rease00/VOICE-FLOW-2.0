import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../../../app/navigation';
import { useUser } from '../../auth/context/UserContext';
import type {
  GenerationSettings,
  ReaderCatalogItem,
  ReaderDashboardPayload,
  ReaderLegalAck,
  ReaderLibrary,
  ReaderSession,
  ReaderSessionProgress,
} from '../../../../types';
import { VOICES } from '../../../../constants';
import { readStorageJson, writeStorageJson } from '../../../shared/storage/localStore';
import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { resolveApiUrl } from '../../../shared/api/config';
import {
  acceptReaderLegalAck,
  checkReaderCommercialUse,
  createReaderSession,
  createReaderUpload,
  exportReaderSessionAudio,
  getReaderDashboard,
  getReaderCatalogItem,
  getReaderLegalAck,
  getReaderPreferences,
  getReaderSession,
  getReaderTtsJobAudio,
  primeReaderQueue,
  saveReaderSession,
  resolveReaderQueuePrimeMode,
  type ReaderCommercialCheckResponse,
  updateReaderPreferences,
  updateReaderProgress,
  type ReaderPreferencesPayload,
} from '../api/readerApi';
import { resolveReaderBootstrapState } from '../model/bootstrap';
import {
  isImportedItem,
  isLowConfidenceItem,
  resolveImportedStatusBadge,
} from '../model/library';
import { buildReaderDeepLink, isReaderPath, parseReaderDeepLink } from '../model/route';
import { EMPTY_READER_LIBRARY, buildReaderDashboardPayloadFromLibrary, resolveReaderHomeViewModel } from '../model/dashboard';
import { getReaderPlayableUnits, isLowConfidenceSession, resolveReaderBillingDisplay, resolveReaderMode, resolveReaderStatusLabel } from '../model/session';
import {
  coerceReaderHomeTab,
  coerceReaderTab,
  getReaderTabs,
  resolveImportedDefaultTab,
  type ReaderHomeTab,
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
  denseTabs?: boolean;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  authReturnPath?: string;
  syncLocation?: boolean;
  isActive?: boolean;
}

const READER_RESTORE_VERSION = 1;
const READER_PREFERENCES_VERSION = 1;
// Collapse the reader dock sooner on tablet widths so it stops covering shelves.
const RESPONSIVE_DOCK_MINI_MODE_QUERY = '(max-width: 900px)';

const subscribeToReaderDockViewport = (onStoreChange: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;

  const mediaQuery = window.matchMedia(RESPONSIVE_DOCK_MINI_MODE_QUERY);
  const handleChange = () => onStoreChange();

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }

  mediaQuery.addListener(handleChange);
  return () => mediaQuery.removeListener(handleChange);
};

const getReaderDockViewportMiniMode = (): boolean => (
  typeof window !== 'undefined' && window.matchMedia(RESPONSIVE_DOCK_MINI_MODE_QUERY).matches
);

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
  mode === 'comic' ? 'library' : 'novels';

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
  denseTabs,
  onToast,
  authReturnPath,
  syncLocation = false,
  isActive = true,
}) => {
  const { authReady, isAuthenticated } = useUser();
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRegistryRef = useRef<string[]>([]);
  const hasHandledDeepLinkRef = useRef(false);
  const hasUserChangedHomeTabRef = useRef(false);
  const lastAutoOpenedSessionIdRef = useRef('');
  const readerPreferencesCacheRef = useRef<ReaderPreferencesPayload>(readReaderPreferencesStore());
  const lastPersistedReaderTabRef = useRef<{ sessionKey: string; tab: ReaderTab } | null>(null);
  const initialDeepLinkRef = useRef(
    typeof window === 'undefined'
      ? null
      : parseReaderDeepLink(window.location.pathname, window.location.search)
  );
  const closedSessionIdRef = useRef('');
  const [library, setLibrary] = useState<ReaderLibrary | null>(null);
  const [libraryError, setLibraryError] = useState<unknown>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [dashboard, setDashboard] = useState<ReaderDashboardPayload | null>(null);
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
  const [isSavingTextEdit, setIsSavingTextEdit] = useState(false);
  const [isSavingVoiceSettings, setIsSavingVoiceSettings] = useState(false);
  const [isSavingCastAssignments, setIsSavingCastAssignments] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [showImportFlow, setShowImportFlow] = useState(false);
  const [showImportTermsModal, setShowImportTermsModal] = useState(false);
  const [isAcceptingImportTerms, setIsAcceptingImportTerms] = useState(false);
  const [dockImportDialogSignal, setDockImportDialogSignal] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [audioProgressPct, setAudioProgressPct] = useState(0);
  const [statusLabel, setStatusLabel] = useState('Idle');
  const [miniModeOverride, setMiniModeOverride] = useState<boolean | null>(null);
  const [lastJobId, setLastJobId] = useState('');
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const sessionMutationRef = useRef<Record<'open' | 'progress' | 'savepoint' | 'settings' | 'queue-prime' | 'bootstrap', number>>({
    open: 0,
    progress: 0,
    savepoint: 0,
    settings: 0,
    'queue-prime': 0,
    bootstrap: 0,
  });
  const sessionSnapshotRef = useRef<{ sessionId: string; updatedAtMs: number }>({ sessionId: '', updatedAtMs: 0 });

  const sessionItem = useMemo(
    () => (library?.items || []).find((item) => item.id === sessionItemId) || null,
    [library?.items, sessionItemId]
  );
  const previewItem = useMemo(() => {
    if (previewItemSnapshot && previewItemSnapshot.id === previewItemId) return previewItemSnapshot;
    return (library?.items || []).find((item) => item.id === previewItemId) || null;
  }, [library?.items, previewItemId, previewItemSnapshot]);
  const readerDashboard = useMemo(
    () => dashboard || (library ? buildReaderDashboardPayloadFromLibrary(library) : null),
    [dashboard, library]
  );
  const homeViewModel = useMemo(
    () => resolveReaderHomeViewModel(readerDashboard || buildReaderDashboardPayloadFromLibrary(EMPTY_READER_LIBRARY), homeTab, searchTerm),
    [homeTab, readerDashboard, searchTerm]
  );
  const readerAuthError = useMemo(() => {
    const error = new Error('Sign in to restore Reader shelves, sessions, and your dashboard state.') as Error & { status?: number };
    error.status = 401;
    return error;
  }, []);
  const hasReaderAuthSession = authReady && isAuthenticated;
  const readerAuthReturnPath = useMemo(() => {
    const safePath = String(authReturnPath || '').trim().replace(/\/+$/, '') || APP_ROUTE_PATHS.reader;
    if (safePath === '/reader' || safePath.startsWith('/reader/')) return safePath;
    return APP_ROUTE_PATHS.reader;
  }, [authReturnPath]);
  const readerLoginUrl = useMemo(() => resolveLoginPath('login', readerAuthReturnPath), [readerAuthReturnPath]);
  const readerSignupUrl = useMemo(() => resolveLoginPath('signup', readerAuthReturnPath), [readerAuthReturnPath]);

  const activeText = useMemo(
    () => getActiveUnitText(session, mode, activeUnitIndex),
    [activeUnitIndex, mode, session]
  );
  const deferredActiveText = useDeferredValue(activeText);
  const translationSupported = useMemo(
    () => Boolean(sessionItem?.translationSupport?.page || sessionItem?.translationSupport?.tts || session?.translationState === 'ready' || session?.translationState === 'warming'),
    [session?.translationState, sessionItem?.translationSupport?.page, sessionItem?.translationSupport?.tts]
  );
  const playbackUnits = useMemo(() => getReaderPlayableUnits(session), [session]);
  const activeUnit = playbackUnits[activeUnitIndex] || null;
  const isCompactDockViewport = useSyncExternalStore(
    subscribeToReaderDockViewport,
    getReaderDockViewportMiniMode,
    () => false
  );
  const miniMode = miniModeOverride ?? isCompactDockViewport;
  const [detectedSpeakersFromText, setDetectedSpeakersFromText] = useState<string[]>([]);
  const speakerParseRunIdRef = useRef(0);

  useEffect(() => {
    const activeSessionId = String(session?.id || '');
    if (!activeSessionId) {
      lastAutoOpenedSessionIdRef.current = '';
      setMiniModeOverride(true);
      return;
    }
    if (lastAutoOpenedSessionIdRef.current !== activeSessionId) {
      if (!isCompactDockViewport) {
        setMiniModeOverride(false);
      }
      lastAutoOpenedSessionIdRef.current = activeSessionId;
    }
  }, [session?.id, isCompactDockViewport]);

  useEffect(() => {
    if (isActive === false) return;

    const rawText = String(deferredActiveText || '').trim();
    if (!rawText) {
      speakerParseRunIdRef.current += 1;
      setDetectedSpeakersFromText([]);
      return;
    }

    const runId = speakerParseRunIdRef.current + 1;
    speakerParseRunIdRef.current = runId;
    let cancelled = false;

    void import('../../../../services/geminiService')
      .then(({ parseMultiSpeakerScript }) => {
        if (cancelled || speakerParseRunIdRef.current !== runId) return;
        const parsed = parseMultiSpeakerScript(rawText).speakersList
          .map((speaker) => String(speaker || '').trim())
          .filter((speaker) => Boolean(speaker) && speaker.toLowerCase() !== 'narrator');
        setDetectedSpeakersFromText(Array.from(new Set(parsed)));
      })
      .catch(() => {
        if (!cancelled && speakerParseRunIdRef.current === runId) setDetectedSpeakersFromText([]);
      });

    return () => {
      cancelled = true;
    };
  }, [deferredActiveText, isActive]);

  const detectedSpeakers = useMemo(() => {
    const fromCast = Object.keys(castDraft || {})
      .map((speaker) => String(speaker || '').trim())
      .filter((speaker) => Boolean(speaker) && speaker.toLowerCase() !== 'narrator');
    const fromText = detectedSpeakersFromText;
    return Array.from(new Set([...fromCast, ...fromText]));
  }, [castDraft, detectedSpeakersFromText]);

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
    if (!hasReaderAuthSession) return;
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
  }, [hasReaderAuthSession, mediaBackendUrl]);

  const loadLibrary = useCallback(async () => {
    if (!authReady) {
      setIsLoadingLibrary(false);
      return;
    }
    if (!isAuthenticated) {
      setIsLoadingLibrary(false);
      setShowImportFlow(false);
      setShowImportTermsModal(false);
      setDashboard(null);
      setLibrary(null);
      setLegalAck(null);
      setLibraryError(readerAuthError);
      setSelectedItemId('');
      setPreviewItemId('');
      setPreviewItemSnapshot(null);
      setCommercialCheck(null);
      setIsCheckingCommercial(false);
      return;
    }
    setIsLoadingLibrary(true);
    try {
      const searchQuery = searchTerm.trim();
      const [libraryResult, legalResult, preferencesResult] = await Promise.allSettled([
        getReaderDashboard(mediaBackendUrl, {
          surface: 'all',
          regionId: readerPreferencesCacheRef.current.regionId || 'english',
          ...(searchQuery ? { search: searchQuery } : {}),
        }),
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
        setDashboard(libraryPayload);
        setLibrary(libraryPayload.library);
        setLibraryError(null);
        if (!hasUserChangedHomeTabRef.current) {
          setHomeTab((current) => coerceReaderHomeTab(resolvedPreferences.homeTab, current));
        }
        const first = libraryPayload.library.items[0];
        if (first) setSelectedItemId((current) => current || first.id);
      } else {
        setDashboard(null);
        setLibrary(null);
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
  }, [authReady, isAuthenticated, mediaBackendUrl, onToast, readerAuthError, searchTerm]);

  useEffect(() => {
    if (!authReady || isActive === false) return;
    void loadLibrary();
  }, [authReady, isActive, loadLibrary]);

  const getSessionUpdatedAtMs = useCallback((value: ReaderSession | null | undefined): number => (
    Math.max(0, Number((value as { updatedAtMs?: number } | null | undefined)?.updatedAtMs || 0))
  ), []);

  const issueSessionMutationToken = useCallback((
    lane: 'open' | 'progress' | 'savepoint' | 'settings' | 'queue-prime' | 'bootstrap'
  ): number => {
    sessionMutationRef.current[lane] += 1;
    return sessionMutationRef.current[lane];
  }, []);

  const commitSessionResponse = useCallback((
    lane: 'open' | 'progress' | 'savepoint' | 'settings' | 'queue-prime' | 'bootstrap',
    nextSession: ReaderSession | null | undefined,
    options?: {
      expectedSessionId?: string;
      token?: number;
      allowSessionSwitch?: boolean;
    }
  ): boolean => {
    if (!nextSession) return false;
    const nextSessionId = String(nextSession.id || '').trim();
    const nextUpdatedAtMs = getSessionUpdatedAtMs(nextSession);
    if (typeof options?.token === 'number' && options.token !== sessionMutationRef.current[lane]) return false;
    if (options?.expectedSessionId && nextSessionId !== options.expectedSessionId) return false;
    if (closedSessionIdRef.current && nextSessionId === closedSessionIdRef.current) return false;
    const currentSnapshot = sessionSnapshotRef.current;
    if (!options?.allowSessionSwitch && currentSnapshot.sessionId && nextSessionId && currentSnapshot.sessionId !== nextSessionId) {
      return false;
    }
    if (
      currentSnapshot.sessionId
      && nextSessionId === currentSnapshot.sessionId
      && currentSnapshot.updatedAtMs > 0
      && nextUpdatedAtMs < currentSnapshot.updatedAtMs
    ) {
      return false;
    }
    setSession(nextSession);
    sessionSnapshotRef.current = {
      sessionId: nextSessionId || currentSnapshot.sessionId,
      updatedAtMs: Math.max(currentSnapshot.updatedAtMs, nextUpdatedAtMs),
    };
    return true;
  }, [getSessionUpdatedAtMs]);

  const invalidateSessionMutations = useCallback(() => {
    (Object.keys(sessionMutationRef.current) as Array<keyof typeof sessionMutationRef.current>).forEach((lane) => {
      sessionMutationRef.current[lane] += 1;
    });
    sessionSnapshotRef.current = { sessionId: '', updatedAtMs: 0 };
  }, []);

  const openReaderItem = useCallback(async (
    item: ReaderCatalogItem,
    options?: {
      requestedTab?: ReaderTab;
      chapter?: number;
      episode?: number;
      fromDeepLink?: boolean;
    }
  ): Promise<boolean> => {
    closedSessionIdRef.current = '';
    const openToken = issueSessionMutationToken('open');
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

      if (!commitSessionResponse('open', nextSession, { token: openToken, allowSessionSwitch: true })) {
        return false;
      }
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

      const queuePrimeToken = issueSessionMutationToken('queue-prime');
      void primeReaderQueue(mediaBackendUrl, {
        sessionId: nextSession.id,
        mode: resolveReaderQueuePrimeMode(nextMode),
        lookaheadUnits: 4,
        fromActiveIndex: clampedIndex,
      })
        .then((primedSession) => {
          if (primedSession) {
            commitSessionResponse('queue-prime', primedSession, {
              expectedSessionId: nextSession.id,
              token: queuePrimeToken,
            });
          }
        })
        .catch(() => undefined);

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
  }, [commitSessionResponse, issueSessionMutationToken, mediaBackendUrl, multiSpeakerEnabled, narratorVoiceId, onToast, sourceLanguage, targetLanguage]);

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
    if (!syncLocation) return;
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
  }, [activeTab, activeUnitIndex, mode, sessionItemId, syncLocation]);

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
    const savepointToken = issueSessionMutationToken('savepoint');
    const restoreState = {
      activeItemIndex: activeUnitIndex,
      ...(activeUnit?.id ? { activeUnitId: activeUnit.id, viewportAnchor: activeUnit.id } : {}),
      activeReaderTab: activeTab,
    };
    void saveReaderSession(mediaBackendUrl, session.id, { restoreState })
      .then((nextSession) => {
        commitSessionResponse('savepoint', nextSession, {
          expectedSessionId: session.id,
          token: savepointToken,
        });
      })
      .catch(() => undefined);
  }, [activeTab, activeUnit?.id, activeUnitIndex, commitSessionResponse, issueSessionMutationToken, lastJobId, mediaBackendUrl, mode, session?.id, sessionItemId]);

  useEffect(() => {
    if (!session?.id) return;
    const progressToken = issueSessionMutationToken('progress');
    const consumedChars = session.windows
      .slice(0, Math.max(0, activeUnitIndex + 1))
      .reduce((total, windowItem) => total + Number(windowItem.charCount || 0), 0);
    const progressPayload: ReaderSessionProgress = {
      activeItemIndex: activeUnitIndex,
      ...(activeUnit?.id ? { activeUnitId: activeUnit.id, viewportAnchor: activeUnit.id } : {}),
      ...(mode === 'comic' ? { currentPanelIndex: activeUnitIndex } : { consumedChars }),
    };
    void updateReaderProgress(mediaBackendUrl, session.id, progressPayload)
      .then((nextSession) => {
        commitSessionResponse('progress', nextSession, {
          expectedSessionId: session.id,
          token: progressToken,
        });
      })
      .catch(() => undefined);
    // Sync progress only when position changes.
  }, [activeUnit?.id, activeUnitIndex, commitSessionResponse, issueSessionMutationToken, mediaBackendUrl, mode, session?.id, session?.windows]);

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
    const savepointToken = issueSessionMutationToken('savepoint');
    setIsSavingTextEdit(true);
    try {
      const nextSession = await saveReaderSession(mediaBackendUrl, session.id, {
        unitOverrides: nextOverrides,
        multiSpeakerEnabled,
        narratorVoiceId,
      });
      commitSessionResponse('savepoint', nextSession, {
        expectedSessionId: session.id,
        token: savepointToken,
      });
      onToast('Text override applied.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not apply text override.'), 'error');
    } finally {
      setIsSavingTextEdit(false);
    }
  }, [activeUnit, commitSessionResponse, issueSessionMutationToken, mediaBackendUrl, multiSpeakerEnabled, narratorVoiceId, onToast, session?.id, textDraft, unitOverridesDraft]);

  const handleResetTextEdit = useCallback(() => {
    setTextDraft(activeText || '');
  }, [activeText]);

  const handleSaveVoiceSettings = useCallback(async () => {
    if (!session?.id) return;
    const settingsToken = issueSessionMutationToken('settings');
    setIsSavingVoiceSettings(true);
    try {
      const nextSession = await saveReaderSession(mediaBackendUrl, session.id, {
        multiSpeakerEnabled,
        narratorVoiceId,
        voiceMode: multiSpeakerEnabled ? 'multi' : 'single',
      });
      if (commitSessionResponse('settings', nextSession, {
        expectedSessionId: session.id,
        token: settingsToken,
      })) {
        onToast('Voice settings saved.', 'success');
      }
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not save voice settings.'), 'error');
    } finally {
      setIsSavingVoiceSettings(false);
    }
  }, [commitSessionResponse, issueSessionMutationToken, mediaBackendUrl, multiSpeakerEnabled, narratorVoiceId, onToast, session?.id]);

  const handleSaveCastAssignments = useCallback(async () => {
    if (!session?.id) return;
    const settingsToken = issueSessionMutationToken('settings');
    setIsSavingCastAssignments(true);
    try {
      const nextSession = await saveReaderSession(mediaBackendUrl, session.id, {
        castOverrides: castDraft,
        multiSpeakerEnabled,
        narratorVoiceId,
      });
      if (commitSessionResponse('settings', nextSession, {
        expectedSessionId: session.id,
        token: settingsToken,
      })) {
        onToast('Cast assignments saved.', 'success');
      }
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not save cast assignments.'), 'error');
    } finally {
      setIsSavingCastAssignments(false);
    }
  }, [castDraft, commitSessionResponse, issueSessionMutationToken, mediaBackendUrl, multiSpeakerEnabled, narratorVoiceId, onToast, session?.id]);

  const handleRefresh = useCallback(async () => {
    try {
      const bootstrapToken = issueSessionMutationToken('bootstrap');
      const sessionPromise = session?.id
        ? getReaderSession(mediaBackendUrl, session.id)
        : Promise.resolve(null);
      const [, sessionResult] = await Promise.allSettled([
        loadLibrary(),
        sessionPromise,
      ]);
      if (session?.id && sessionResult.status === 'fulfilled' && sessionResult.value) {
        commitSessionResponse('bootstrap', sessionResult.value, {
          expectedSessionId: session.id,
          token: bootstrapToken,
        });
        onToast('Reader refreshed.', 'success');
        return;
      }
      if (session?.id) {
        onToast('Could not refresh reader session.', 'error');
      }
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not refresh reader session.'), 'error');
    }
  }, [commitSessionResponse, issueSessionMutationToken, loadLibrary, mediaBackendUrl, onToast, session?.id]);

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
    closedSessionIdRef.current = String(session?.id || sessionItemId || '').trim();
    invalidateSessionMutations();
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
    setShowImportFlow(false);
    setShowImportTermsModal(false);
    lastPersistedReaderTabRef.current = null;
    const url = new URL(window.location.href);
    url.pathname = '/reader';
    const readerQueryKeys = ['tab', 'chapter', 'episode', 'vf-reader-mode', 'vf-reader-item', 'vf-reader-title', 'vf-reader-tab', 'vf-reader-chapter', 'vf-reader-episode'];
    readerQueryKeys.forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [invalidateSessionMutations, session?.id, sessionItemId]);

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

  const handleImportUpload = useCallback(async (nextFiles = uploadFiles, nextTitle = uploadTitle) => {
    if (nextFiles.length === 0) {
      onToast('Select files to import first.', 'info');
      return;
    }
    if (!legalAck?.accepted) {
      setShowImportTermsModal(true);
      onToast('Accept import terms to continue.', 'info');
      return;
    }
    setIsUploading(true);
    try {
      const contentType = detectImportTypeFromFiles(nextFiles);
      const upload = await createReaderUpload(mediaBackendUrl, {
        files: nextFiles,
        title: nextTitle || nextFiles[0]?.name || 'Imported title',
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

  const handleAcceptReaderRights = useCallback(() => {
    void acceptReaderLegalAck(mediaBackendUrl)
      .then((ack) => {
        setLegalAck(ack);
        setShowImportFlow(false);
        onToast('Reader import rights accepted.', 'success');
      })
      .catch((error) => onToast(String((error as Error)?.message || 'Could not save reader rights acknowledgement.'), 'error'));
  }, [mediaBackendUrl, onToast]);

  const handleAcceptImportTerms = useCallback(() => {
    if (isAcceptingImportTerms) return;
    setIsAcceptingImportTerms(true);
    void acceptReaderLegalAck(mediaBackendUrl)
      .then((ack) => {
        setLegalAck(ack);
        setShowImportFlow(false);
        setShowImportTermsModal(false);
        onToast('Reader import rights accepted.', 'success');
        setDockImportDialogSignal((current) => current + 1);
      })
      .catch((error) => onToast(String((error as Error)?.message || 'Could not save reader rights acknowledgement.'), 'error'))
      .finally(() => setIsAcceptingImportTerms(false));
  }, [isAcceptingImportTerms, mediaBackendUrl, onToast]);

  const handleDockImport = useCallback((): boolean => {
    if (!hasReaderAuthSession) {
      onToast('Sign in to import files.', 'info');
      return true;
    }
    if (!legalAck?.accepted) {
      setShowImportTermsModal(true);
      return true;
    }
    return false;
  }, [hasReaderAuthSession, legalAck?.accepted, onToast]);

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
  const voiceSettingsDirty = Boolean(
    session
    && (
      session.multiSpeakerEnabled !== multiSpeakerEnabled
      || String(session.narratorVoiceId || '') !== String(narratorVoiceId || '')
    )
  );
  const castSettingsDirty = JSON.stringify(castDraft || {}) !== JSON.stringify(session?.castMemory || {});
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

  const billingDisplay = useMemo(() => resolveReaderBillingDisplay(session), [session]);
  const handleToggleMiniMode = useCallback(() => {
    setMiniModeOverride((current) => (current === null ? !isCompactDockViewport : !current));
  }, [isCompactDockViewport]);
  const dockActionProps = session
    ? {
        onRefresh: () => void handleRefresh(),
        onExport: () => void handleExport(),
        onClose: handleClose,
      }
    : {};

  return (
    <div className={getReaderThemeClassName(resolvedTheme)}>
      <div
        className="vf-reader-v2-shell"
        data-reader-tab-density={(denseTabs ?? isCompactDockViewport) ? 'compact' : 'default'}
        data-reader-dock-mode={miniMode ? 'mini' : 'full'}
      >
        {!session ? (
          <>
            <ReaderBrowseHome
              viewModel={homeViewModel}
              homeTab={homeTab}
              searchTerm={searchTerm}
              selectedItemId={selectedItemId}
              isLoading={isLoadingLibrary}
              bootstrapState={bootstrapState}
              legalAccepted={Boolean(legalAck?.accepted)}
              showImportFlow={showImportFlow}
              libraryErrorMessage={String((libraryError as Error)?.message || libraryError || '')}
              onChangeHomeTab={persistHomeTab}
              onChangeSearchTerm={setSearchTerm}
              onSelectItem={setSelectedItemId}
              onOpenItem={handleRequestOpenItem}
              onAcceptReaderRights={handleAcceptReaderRights}
              resolveImportedStatusBadge={resolveImportedStatusBadge}
              resolveMediaUrl={resolveMediaUrl}
            />

            {!hasReaderAuthSession ? (
              <section className="vf-reader-v2-auth-gate" aria-label="Reader sign-in gate">
                <div>
                  <strong>Sign in to use Reader</strong>
                  <p>Restore shelves, continue saved sessions, accept import rights, and bring in new titles after secure sign-in.</p>
                </div>
                <div className="vf-reader-v2-auth-gate__actions">
                  <a href={readerLoginUrl} className="vf-reader-v2-primary">Sign in</a>
                  <a href={readerSignupUrl} className="vf-reader-v2-secondary">Create account</a>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <>
            <section className="vf-reader-v2-workspace__toolbar">
              <button type="button" className="vf-reader-v2-secondary" onClick={handleClose}>
                Back To Home
              </button>
              <span>{mode === 'novel' ? 'Novel Reader' : 'Comic Reader'}</span>
              {(billingDisplay.label || billingDisplay.rule) ? (
                <span className="vf-reader-v2-workspace__billing">{billingDisplay.label || billingDisplay.rule}</span>
              ) : null}
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
                voiceSettingsDirty={voiceSettingsDirty}
                castSettingsDirty={castSettingsDirty}
                isSavingVoiceSettings={isSavingVoiceSettings}
                isSavingCastAssignments={isSavingCastAssignments}
                onChangeTab={setActiveTab}
                onToggleMultiSpeaker={() => setMultiSpeakerEnabled((current) => !current)}
                onNarratorVoiceChange={setNarratorVoiceId}
                onSpeedChange={setPlaybackSpeed}
                onAmbiencePresetChange={setAmbiencePreset}
                onStylePresetChange={setStylePreset}
                onCastDraftChange={setCastDraft}
                onSaveVoiceSettings={() => void handleSaveVoiceSettings()}
                onSaveCastAssignments={() => void handleSaveCastAssignments()}
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

        {showImportTermsModal ? (
          <div className="vf-reader-v2-modal-backdrop">
            <section className="vf-reader-v2-modal vf-reader-v2-modal--compact" role="dialog" aria-modal="true" aria-label="Reader import terms">
              <div className="vf-reader-v2-modal__content">
                <div className="vf-reader-v2-eyebrow">Reader Import</div>
                <h3>Accept Terms To Continue</h3>
                <p className="vf-reader-v2-modal__summary">
                  Before your first import, confirm you have rights to use this content and that you accept Reader import terms.
                </p>
                <ul className="vf-reader-v2-modal__terms">
                  <li>Only import content you own or have permission to transform.</li>
                  <li>Do not upload restricted or illegal material.</li>
                  <li>You are responsible for licensing and commercial-use compliance.</li>
                </ul>
                <div className="vf-reader-v2-modal__actions">
                  <button
                    type="button"
                    className="vf-reader-v2-secondary"
                    onClick={() => setShowImportTermsModal(false)}
                    disabled={isAcceptingImportTerms}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="vf-reader-v2-primary"
                    onClick={handleAcceptImportTerms}
                    disabled={isAcceptingImportTerms}
                  >
                    {isAcceptingImportTerms ? 'Accepting...' : 'Accept & Continue'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        <ReaderStickyDock
          title={String(session?.title || sessionItem?.title || 'Reader')}
          unitLabel={activeUnit?.title || (mode === 'novel' ? 'Read' : 'Panels')}
          progressPct={session ? overallProgress : 0}
          statusLabel={session ? statusLabel : 'Idle'}
          isPlaying={session ? isPlaying : false}
          miniMode={miniMode}
          transportDisabled={!session}
          onTogglePlay={() => void handleTogglePlay()}
          onPrev={() => handleSelectUnit(activeUnitIndex - 1)}
          onNext={() => handleSelectUnit(activeUnitIndex + 1)}
          {...dockActionProps}
          onToggleMiniMode={handleToggleMiniMode}
          onDockImport={handleDockImport}
          importDialogSignal={dockImportDialogSignal}
          onImportFiles={(files) => {
            setUploadFiles(files);
            void handleImportUpload(files);
          }}
        />
        <audio ref={audioRef} preload="auto" />
      </div>
    </div>
  );
};
