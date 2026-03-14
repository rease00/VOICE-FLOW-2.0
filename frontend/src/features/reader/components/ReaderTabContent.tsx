import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GenerationSettings,
  ReaderCatalogItem,
  ReaderCommercialPolicy,
  ReaderLibrary,
  ReaderLegalAck,
  ReaderOwnershipBasis,
  ReaderSession,
} from '../../../../types';
import { LANGUAGES, MUSIC_TRACKS, VOICES } from '../../../../constants';
import { parseMultiSpeakerScript } from '../../../../services/geminiService';
import { readStorageJson, writeStorageJson } from '../../../shared/storage/localStore';
import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { resolveApiUrl } from '../../../shared/api/config';
import { reportFrontendSignal } from '../../../shared/telemetry/frontendErrors';
import { useWorkspaceViewport } from '../../../shared/ui/useWorkspaceViewport';
import { resolveMusicTrackUrlById } from '../../../shared/media/audioCatalog';
import { applySafeMediaVolume, normalizeMediaVolume } from '../../../shared/media/safeMediaVolume';
import { useUser } from '../../auth/context/UserContext';
import { autoAssignSpeakerVoices } from '../../../shared/voices/castAssignment';
import {
  acceptReaderLegalAck,
  getReaderPreferences,
  createReaderSession,
  createReaderUpload,
  deleteReaderSession,
  getReaderLegalAck,
  getReaderLibrary,
  getReaderSession,
  getReaderTtsJobAudio,
  saveReaderSession,
  updateReaderPreferences,
  updateReaderProgress,
} from '../api/readerApi';
import {
  filterReaderLibraryItems,
  getReaderAutoAdvanceDelay,
  isReaderAutoSwipeAvailable,
  type ReaderLibraryFilters,
  type ReaderSurfaceFilter,
} from '../model/library';
import {
  resolveReaderBootstrapState,
  resolveReaderResumeSession,
  type ReaderBootstrapState,
} from '../model/bootstrap';
import {
  getReaderAudioSyncFallbackDelay,
  getReaderDeleteCountdownLabel,
  READER_BILLING_RULE,
  shouldRunReaderBackgroundPolling,
  shouldTriggerReaderPanelPrefetch,
  shouldTriggerReaderWindowPrefetch,
} from '../model/session';
import { ReaderBrowseHome } from './ReaderBrowseHome';
import { ReaderPlaybackStage } from './ReaderPlaybackStage';
import { ReaderPlayerDock } from './ReaderStickyDock';
import { ReaderUtilityTray } from './ReaderUtilityTray';
import { getReaderThemeClassName } from './readerTheme';
import type {
  PlaylistItem,
  ReaderAutoAdvanceProfile,
  ReaderAudioEngine,
  ReaderUtilityPanel,
  ReaderUtilityPanelScope,
  ReaderResolvedTheme,
  UploadContentType,
} from './readerTypes';
import { isReaderUtilityPanelAvailable } from './readerTypes';
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
  searchQuery: string;
  targetLanguage: string;
  pageViewMode: 'original' | 'translated';
  ttsLanguageMode: 'auto' | 'source' | 'target';
  autoAdvanceProfile: ReaderAutoAdvanceProfile;
  multiSpeakerEnabled: boolean;
  audioEngine: ReaderAudioEngine;
  narratorVoiceId: string;
  readingMode: string;
}

const DEFAULT_PREFS: ReaderPreferences = {
  surface: 'all',
  regionId: 'english',
  searchQuery: '',
  targetLanguage: '',
  pageViewMode: 'original',
  ttsLanguageMode: 'auto',
  autoAdvanceProfile: 'off',
  multiSpeakerEnabled: true,
  audioEngine: 'native_audio_dialog',
  narratorVoiceId: String(VOICES[0]?.id || 'v22'),
  readingMode: 'vertical_strip',
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
  const storedAudioEngine = String(stored?.audioEngine || '').trim().toLowerCase();
  const audioEngine: ReaderAudioEngine = storedAudioEngine === 'tts_hd' ? 'tts_hd' : 'native_audio_dialog';
  return {
    surface: stored?.surface === 'uploads' ? 'all' : (stored?.surface || DEFAULT_PREFS.surface),
    regionId: typeof stored?.regionId === 'string' && stored.regionId.trim() ? stored.regionId : DEFAULT_PREFS.regionId,
    searchQuery: typeof stored?.searchQuery === 'string' ? stored.searchQuery : DEFAULT_PREFS.searchQuery,
    targetLanguage: typeof stored?.targetLanguage === 'string' ? stored.targetLanguage : DEFAULT_PREFS.targetLanguage,
    pageViewMode: stored?.pageViewMode || DEFAULT_PREFS.pageViewMode,
    ttsLanguageMode: stored?.ttsLanguageMode || DEFAULT_PREFS.ttsLanguageMode,
    autoAdvanceProfile: stored?.autoAdvanceProfile || DEFAULT_PREFS.autoAdvanceProfile,
    multiSpeakerEnabled: typeof stored?.multiSpeakerEnabled === 'boolean'
      ? stored.multiSpeakerEnabled
      : settings?.multiSpeakerEnabled !== false,
    audioEngine,
    narratorVoiceId: typeof stored?.narratorVoiceId === 'string' && stored.narratorVoiceId.trim()
      ? stored.narratorVoiceId
      : DEFAULT_PREFS.narratorVoiceId,
    readingMode: typeof stored?.readingMode === 'string' && stored.readingMode.trim()
      ? stored.readingMode
      : DEFAULT_PREFS.readingMode,
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

const normalizeReaderComicDraftMode = (value: string | undefined): string => {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'rtl_paged' || safe === 'ltr_paged') return safe;
  return 'vertical_strip';
};

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

const normalizeReaderCommercialStatus = (
  value: unknown
): 'allowed' | 'blocked' | 'review' | 'unknown' => {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'allowed' || safe === 'blocked' || safe === 'review') return safe;
  return 'unknown';
};

const formatReaderCommercialMessage = (params: {
  status?: string | null | undefined;
  reason?: string | null | undefined;
  provider?: string | null | undefined;
  fallback: string;
}): string => {
  const status = normalizeReaderCommercialStatus(params.status);
  const reason = String(params.reason || '').trim();
  if (reason) return reason;
  const provider = String(params.provider || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (status === 'review') {
    return `This title needs commercial review before Reader can use it${provider ? ` from ${provider}` : ''}.`;
  }
  if (status === 'blocked') {
    return `This title is blocked for commercial Reader use${provider ? ` from ${provider}` : ''}.`;
  }
  return params.fallback;
};

const describeReaderRequestError = (error: unknown, fallback: string): string => {
  const typed = error as Error & {
    code?: string;
    status?: number;
    detail?: unknown;
  };
  const detail = typed?.detail && typeof typed.detail === 'object'
    ? typed.detail as Record<string, unknown>
    : null;
  const commercialStatus = normalizeReaderCommercialStatus(detail?.commercialUseStatus);
  if (typed?.code === 'commercial_policy_blocked' || commercialStatus === 'blocked' || commercialStatus === 'review') {
    return formatReaderCommercialMessage({
      status: commercialStatus,
      reason: String(typed?.message || ''),
      provider: typeof detail?.provider === 'string' ? detail.provider : '',
      fallback,
    });
  }
  return String(typed?.message || '').trim() || fallback;
};

export const ReaderTabContent: React.FC<ReaderTabContentProps> = ({ mediaBackendUrl, settings, resolvedTheme, onToast }) => {
  const { characterLibrary, getVoiceForCharacter, updateCharacter, user } = useUser();
  const { mode: layoutMode } = useWorkspaceViewport();
  const initialPrefs = useMemo(() => readPrefs(settings), [settings]);
  const speechVolume = normalizeMediaVolume(settings?.speechVolume, 1);
  const musicVolume = normalizeMediaVolume(settings?.musicVolume, 0.3);
  const [surface, setSurface] = useState<ReaderSurfaceFilter>(initialPrefs.surface);
  const [regionId, setRegionId] = useState<string>(initialPrefs.regionId);
  const [searchQuery, setSearchQuery] = useState<string>(initialPrefs.searchQuery);
  const [targetLanguageDraft, setTargetLanguageDraft] = useState<string>(initialPrefs.targetLanguage);
  const [pageViewModeDraft, setPageViewModeDraft] = useState<'original' | 'translated'>(initialPrefs.pageViewMode);
  const [ttsLanguageModeDraft, setTtsLanguageModeDraft] = useState<'auto' | 'source' | 'target'>(initialPrefs.ttsLanguageMode);
  const [library, setLibrary] = useState<ReaderLibrary | null>(null);
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [resumeSession, setResumeSession] = useState<ReaderSession | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'browse' | 'playback'>('browse');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [legalAck, setLegalAck] = useState<ReaderLegalAck | null>(null);
  const [commercialPolicy, setCommercialPolicy] = useState<ReaderCommercialPolicy | null>(null);
  const [billingLabel, setBillingLabel] = useState<string>(`Reader pricing: ${READER_BILLING_RULE}`);
  const [readerBootstrapState, setReaderBootstrapState] = useState<ReaderBootstrapState>('loading');
  const [readerBootstrapMessage, setReaderBootstrapMessage] = useState<string>('');
  const [bootstrapRetryNonce, setBootstrapRetryNonce] = useState<number>(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState<string>('');
  const [uploadContentType, setUploadContentType] = useState<UploadContentType>('auto');
  const [uploadOwnershipBasis, setUploadOwnershipBasis] = useState<ReaderOwnershipBasis>('user_responsible');
  const [castDraft, setCastDraft] = useState<Record<string, string>>({});
  const [narratorVoiceDraft, setNarratorVoiceDraft] = useState<string>(initialPrefs.narratorVoiceId);
  const [unitOverridesDraft, setUnitOverridesDraft] = useState<Record<string, string>>({});
  const [detectedTextEditorDraft, setDetectedTextEditorDraft] = useState<string>('');
  const [readingModeDraft, setReadingModeDraft] = useState<string>(initialPrefs.readingMode);
  const [autoAdvanceDraft, setAutoAdvanceDraft] = useState<ReaderAutoAdvanceProfile>(initialPrefs.autoAdvanceProfile);
  const [multiSpeakerEnabledDraft, setMultiSpeakerEnabledDraft] = useState<boolean>(initialPrefs.multiSpeakerEnabled);
  const [audioEngineDraft, setAudioEngineDraft] = useState<ReaderAudioEngine>(initialPrefs.audioEngine);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [resolvedMusicTrackUrl, setResolvedMusicTrackUrl] = useState<string>('');
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
  const [activeUtilityPanel, setActiveUtilityPanel] = useState<ReaderUtilityPanel | null>(null);
  const [activeUtilityPanelScope, setActiveUtilityPanelScope] = useState<ReaderUtilityPanelScope>('all');
  const [pageVisibility, setPageVisibility] = useState<DocumentVisibilityState>(
    typeof document === 'undefined' ? 'visible' : document.visibilityState
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const readerRootRef = useRef<HTMLDivElement | null>(null);
  const playerDockRef = useRef<HTMLDivElement | null>(null);
  const fetchedAudioJobIdsRef = useRef<Set<string>>(new Set());
  const prefetchedWindowKeysRef = useRef<Set<string>>(new Set());
  const prefetchedPanelKeysRef = useRef<Set<string>>(new Set());
  const playlistRef = useRef<PlaylistItem[]>([]);
  const panelRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const autoplayPendingRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string>('');
  const workspaceModeRef = useRef<'browse' | 'playback'>('browse');
  const lastBootstrapLoadKeyRef = useRef<string>('');
  const expiredSessionToastForRef = useRef<string>('');
  const audioSyncFallbackTimerRef = useRef<number | null>(null);
  const lastAudioSyncFallbackKeyRef = useRef<string>('');
  const lastAutoSaveSignatureRef = useRef<string>('');
  const lastLayoutTelemetryRef = useRef<string>('');
  const lastPanelTelemetryRef = useRef<string>('');
  const lastReaderPreferencesLoadKeyRef = useRef<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const readerIdentityKey = String(user.uid || user.email || '').trim() || 'guest';
  const isReaderSaveStateActive = Boolean(
    session?.id && (session?.contentKind === 'book' || session?.contentKind === 'comic')
  );

  useEffect(() => {
    sessionIdRef.current = session?.id || '';
  }, [session?.id]);

  useEffect(() => {
    lastAutoSaveSignatureRef.current = '';
  }, [session?.id]);

  useEffect(() => {
    workspaceModeRef.current = workspaceMode;
  }, [workspaceMode]);

  useEffect(() => () => {
    if (audioSyncFallbackTimerRef.current !== null) {
      window.clearTimeout(audioSyncFallbackTimerRef.current);
      audioSyncFallbackTimerRef.current = null;
    }
  }, [layoutMode]);

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
      searchQuery,
      targetLanguage: targetLanguageDraft,
      pageViewMode: pageViewModeDraft,
      ttsLanguageMode: ttsLanguageModeDraft,
      autoAdvanceProfile: autoAdvanceDraft,
      multiSpeakerEnabled: multiSpeakerEnabledDraft,
      audioEngine: audioEngineDraft,
      narratorVoiceId: narratorVoiceDraft,
      readingMode: normalizeReaderComicDraftMode(readingModeDraft),
    } satisfies ReaderPreferences);
  }, [audioEngineDraft, autoAdvanceDraft, multiSpeakerEnabledDraft, narratorVoiceDraft, pageViewModeDraft, readingModeDraft, regionId, searchQuery, surface, targetLanguageDraft, ttsLanguageModeDraft]);

  useEffect(() => {
    const signature = `${layoutMode}|${workspaceMode}|${Boolean(session?.id)}`;
    if (lastLayoutTelemetryRef.current === signature) return;
    lastLayoutTelemetryRef.current = signature;
    void reportFrontendSignal({
      message: 'reader.layout_mode',
      component: 'ReaderTabContent',
      metadata: {
        layoutMode,
        workspaceMode,
        hasSession: Boolean(session?.id),
      },
    });
  }, [layoutMode, session?.id, workspaceMode]);

  useEffect(() => {
    if (!activeUtilityPanel) return;
    const signature = `${layoutMode}|${workspaceMode}|${activeUtilityPanel}`;
    if (lastPanelTelemetryRef.current === signature) return;
    lastPanelTelemetryRef.current = signature;
    void reportFrontendSignal({
      message: 'reader.panel_open',
      component: 'ReaderTabContent',
      metadata: {
        layoutMode,
        workspaceMode,
        panel: activeUtilityPanel,
      },
    });
  }, [activeUtilityPanel, layoutMode, workspaceMode]);

  useEffect(() => {
    if (activeUtilityPanel) return;
    if (activeUtilityPanelScope !== 'all') setActiveUtilityPanelScope('all');
  }, [activeUtilityPanel, activeUtilityPanelScope]);

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

  const applyReaderPreferences = useCallback((preferences: {
    regionId?: string;
    targetLanguage?: string;
    pageViewMode?: 'original' | 'translated';
    ttsLanguageMode?: 'auto' | 'source' | 'target';
    autoAdvanceProfile?: string;
    multiSpeakerEnabled?: boolean;
    audioEngine?: string;
    narratorVoiceId?: string;
    readingMode?: string;
  }) => {
    if (typeof preferences.regionId === 'string' && preferences.regionId.trim()) {
      setRegionId(preferences.regionId);
    }
    if (typeof preferences.targetLanguage === 'string') {
      setTargetLanguageDraft(preferences.targetLanguage);
    }
    if (preferences.pageViewMode === 'translated' || preferences.pageViewMode === 'original') {
      setPageViewModeDraft(preferences.pageViewMode);
    }
    if (
      preferences.ttsLanguageMode === 'auto'
      || preferences.ttsLanguageMode === 'source'
      || preferences.ttsLanguageMode === 'target'
    ) {
      setTtsLanguageModeDraft(preferences.ttsLanguageMode);
    }
    if (
      preferences.autoAdvanceProfile === 'off'
      || preferences.autoAdvanceProfile === 'audio_sync'
      || preferences.autoAdvanceProfile === 'slow'
      || preferences.autoAdvanceProfile === 'medium'
      || preferences.autoAdvanceProfile === 'fast'
    ) {
      setAutoAdvanceDraft(preferences.autoAdvanceProfile);
    }
    if (typeof preferences.multiSpeakerEnabled === 'boolean') {
      setMultiSpeakerEnabledDraft(preferences.multiSpeakerEnabled);
    }
    if (typeof preferences.audioEngine === 'string') {
      setAudioEngineDraft(preferences.audioEngine === 'tts_hd' ? 'tts_hd' : 'native_audio_dialog');
    }
    if (typeof preferences.narratorVoiceId === 'string' && preferences.narratorVoiceId.trim()) {
      setNarratorVoiceDraft(preferences.narratorVoiceId);
    }
    if (typeof preferences.readingMode === 'string' && preferences.readingMode.trim()) {
      setReadingModeDraft(normalizeReaderComicDraftMode(preferences.readingMode));
    }
  }, []);

  const loadReaderPreferences = useCallback(async (options?: { suppressToast?: boolean }) => {
    try {
      const preferences = await getReaderPreferences(mediaBackendUrl);
      applyReaderPreferences(preferences);
      return preferences;
    } catch (error) {
      if (!options?.suppressToast) {
        onToast(String((error as Error)?.message || 'Could not load Reader defaults.'), 'error');
      }
      return null;
    }
  }, [applyReaderPreferences, mediaBackendUrl, onToast]);

  const loadAck = useCallback(async (options?: { suppressToast?: boolean; throwOnError?: boolean }) => {
    try {
      const payload = await getReaderLegalAck(mediaBackendUrl);
      setLegalAck(payload.ack);
      setCommercialPolicy(payload.commercial || null);
      setBillingLabel(payload.billing.label);
      return payload;
    } catch (error) {
      if (!options?.suppressToast) {
        onToast(describeReaderRequestError(error, 'Could not load Reader rights status.'), 'error');
      }
      if (options?.throwOnError) throw error;
      return null;
    }
  }, [mediaBackendUrl, onToast]);

  useEffect(() => {
    const loadKey = `${mediaBackendUrl}|${readerIdentityKey}`;
    if (lastReaderPreferencesLoadKeyRef.current === loadKey) return;
    lastReaderPreferencesLoadKeyRef.current = loadKey;
    void loadReaderPreferences({ suppressToast: true });
  }, [loadReaderPreferences, mediaBackendUrl, readerIdentityKey]);

  const loadLibrary = useCallback(async (options?: { background?: boolean; suppressToast?: boolean; throwOnError?: boolean }) => {
    if (!options?.background) setIsLoading(true);
    try {
      const nextLibrary = await getReaderLibrary(mediaBackendUrl, {
        surface,
        regionId,
        search: deferredSearchQuery.trim(),
      });
      startTransition(() => {
        setLibrary(nextLibrary);
        setResumeSession(resolveReaderResumeSession(nextLibrary, sessionIdRef.current));
        setSelectedItemId((current) => {
          if (current && nextLibrary.items.some((item) => item.id === current)) return current;
          if (workspaceModeRef.current === 'playback' && sessionIdRef.current) return current;
          return nextLibrary.shelves.continueReading[0]?.id || nextLibrary.items[0]?.id || '';
        });
      });
      return nextLibrary;
    } catch (error) {
      if (!options?.suppressToast) {
        onToast(String((error as Error)?.message || 'Could not load Reader library.'), 'error');
      }
      if (options?.throwOnError) throw error;
      return null;
    } finally {
      if (!options?.background) setIsLoading(false);
    }
  }, [deferredSearchQuery, mediaBackendUrl, onToast, regionId, surface]);

  useEffect(() => {
    const loadKey = `${mediaBackendUrl}|${readerIdentityKey}|${surface}|${regionId}|${deferredSearchQuery.trim()}|${bootstrapRetryNonce}`;
    if (lastBootstrapLoadKeyRef.current === loadKey) return;
    lastBootstrapLoadKeyRef.current = loadKey;
    let cancelled = false;

    startTransition(() => {
      setReaderBootstrapState('loading');
      setReaderBootstrapMessage('');
    });

    const bootstrap = async () => {
      const [ackResult, libraryResult] = await Promise.allSettled([
        loadAck({ suppressToast: true, throwOnError: true }),
        loadLibrary({ suppressToast: true, throwOnError: true }),
      ]);
      if (cancelled) return;

      const libraryError = libraryResult.status === 'rejected' ? libraryResult.reason : null;
      const libraryPayload = libraryResult.status === 'fulfilled' ? libraryResult.value : null;
      const nextBootstrapState = resolveReaderBootstrapState({
        library: libraryPayload,
        libraryError,
      });
      const fallbackError = libraryError || (ackResult.status === 'rejected' ? ackResult.reason : null);

      startTransition(() => {
        setReaderBootstrapState(nextBootstrapState);
        if (nextBootstrapState === 'needs_auth') {
          setReaderBootstrapMessage('Sign in to load your Reader library and active sessions.');
          return;
        }
        if (nextBootstrapState === 'error') {
          setReaderBootstrapMessage(String((fallbackError as Error)?.message || 'Could not load Reader.'));
          return;
        }
        setReaderBootstrapMessage('');
      });
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [bootstrapRetryNonce, deferredSearchQuery, loadAck, loadLibrary, mediaBackendUrl, readerIdentityKey, regionId, surface]);

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
      const nextLibrary = await loadLibrary({ background: true, suppressToast: true });
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
        setUnitOverridesDraft({});
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
          setNarratorVoiceDraft(String(nextSession.narratorVoiceId || nextSession.castMemory?.Narrator || VOICES[0]?.id || 'v22'));
          setUnitOverridesDraft(nextSession.unitOverrides || {});
          setReadingModeDraft(nextSession.readingMode || 'document');
          setAutoAdvanceDraft((nextSession.autoAdvanceProfile as ReaderAutoAdvanceProfile) || 'off');
          setTargetLanguageDraft(nextSession.targetLanguage || nextSession.sourceLanguage || '');
          setPageViewModeDraft(nextSession.pageViewMode || resolveReaderPageViewDefault(nextSession.sourceLanguage, nextSession.targetLanguage));
          setTtsLanguageModeDraft(nextSession.ttsLanguageMode || 'auto');
          setMultiSpeakerEnabledDraft(nextSession.multiSpeakerEnabled !== false);
          setAudioEngineDraft(nextSession.audioEngine === 'native_audio_dialog' ? 'native_audio_dialog' : 'tts_hd');
          if (typeof nextSession.restoreState?.activeItemIndex === 'number') {
            setActiveQueueIndex(Math.max(0, nextSession.restoreState.activeItemIndex));
          } else if (typeof nextSession.activeItemIndex === 'number') {
            setActiveQueueIndex(Math.max(0, nextSession.activeItemIndex));
          }
        });
        if (!isReaderPrepTerminal(nextSession)) {
          void loadLibrary({ background: true, suppressToast: true });
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

  const effectiveMusicTrackId = session?.musicTrackId || String(settings?.musicTrackId || 'm_none');
  const activeMusicTrack = useMemo(() => MUSIC_TRACKS.find((item) => item.id === effectiveMusicTrackId), [effectiveMusicTrackId]);

  const filters = useMemo<ReaderLibraryFilters>(
    () => ({
      surface,
      search: deferredSearchQuery,
      provider: 'all',
      contentKind: 'all',
      progress: 'all',
      collection: 'all',
      sort: 'featured',
    }),
    [deferredSearchQuery, surface]
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
      setNarratorVoiceDraft(String(session.narratorVoiceId || session.castMemory?.Narrator || VOICES[0]?.id || 'v22'));
      setUnitOverridesDraft(session.unitOverrides || {});
      setReadingModeDraft(session.readingMode || sessionItem?.readingModeDefault || selectedItem?.readingModeDefault || 'document');
      setAutoAdvanceDraft((session.autoAdvanceProfile as ReaderAutoAdvanceProfile) || 'off');
      setTargetLanguageDraft(session.targetLanguage || session.sourceLanguage || '');
      setPageViewModeDraft(session.pageViewMode || resolveReaderPageViewDefault(session.sourceLanguage, session.targetLanguage));
      setTtsLanguageModeDraft(session.ttsLanguageMode || 'auto');
      setMultiSpeakerEnabledDraft(session.multiSpeakerEnabled !== false);
      setAudioEngineDraft(session.audioEngine === 'native_audio_dialog' ? 'native_audio_dialog' : 'tts_hd');
      return;
    }
    if (!selectedItem) return;
    setNarratorVoiceDraft(String(VOICES[0]?.id || 'v22'));
    setUnitOverridesDraft({});
    setReadingModeDraft(selectedItem.readingModeDefault || (selectedItem.contentKind === 'comic' ? 'vertical_strip' : 'document'));
    setAutoAdvanceDraft(selectedItem.contentKind === 'comic' ? initialPrefs.autoAdvanceProfile : 'off');
    setAudioEngineDraft(initialPrefs.audioEngine);
    const nextTargetLanguage = resolveReaderTargetLanguage(selectedItem, initialPrefs.targetLanguage);
    setTargetLanguageDraft(nextTargetLanguage);
    setPageViewModeDraft(resolveReaderPageViewDefault(selectedItem.sourceLanguage, nextTargetLanguage));
    setTtsLanguageModeDraft(initialPrefs.ttsLanguageMode);
  }, [initialPrefs.audioEngine, initialPrefs.autoAdvanceProfile, initialPrefs.targetLanguage, initialPrefs.ttsLanguageMode, selectedItem, session, sessionItem]);

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

  const voiceModeDraft = useMemo<'single' | 'multi'>(
    () => (multiSpeakerEnabledDraft ? 'multi' : 'single'),
    [multiSpeakerEnabledDraft]
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
    if (typeof document === 'undefined') return undefined;
    const syncVisibility = () => setPageVisibility(document.visibilityState);
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, [layoutMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const rootElement = readerRootRef.current;
    const dockElement = playerDockRef.current;
    if (!rootElement || !dockElement) return undefined;

    let rafId: number | null = null;
    const applyDockHeight = () => {
      const nextHeight = Math.ceil(dockElement.getBoundingClientRect().height);
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      const cssValue = `${nextHeight}px`;
      if (rootElement.style.getPropertyValue('--reader-dock-height') !== cssValue) {
        rootElement.style.setProperty('--reader-dock-height', cssValue);
      }
    };

    const scheduleDockHeight = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        applyDockHeight();
      });
    };

    scheduleDockHeight();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleDockHeight) : null;
    resizeObserver?.observe(dockElement);
    window.addEventListener('resize', scheduleDockHeight);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleDockHeight);
      rootElement.style.removeProperty('--reader-dock-height');
    };
  }, [layoutMode]);

  useEffect(() => {
    completedJobs.forEach((jobId) => {
      if (audioUrls[jobId] || fetchedAudioJobIdsRef.current.has(jobId)) return;
      fetchedAudioJobIdsRef.current.add(jobId);
      void getReaderTtsJobAudio(mediaBackendUrl, jobId)
        .then((payload) => {
          const url = payload.blob
            ? URL.createObjectURL(payload.blob)
            : payload.audioBase64
              ? base64ToObjectUrl(payload.audioBase64, payload.mediaType || 'audio/wav')
              : null;
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
    if (typeof session?.restoreState?.activeItemIndex === 'number') {
      setActiveQueueIndex(Math.min(Math.max(0, session.restoreState.activeItemIndex), playlist.length - 1));
      return;
    }
    if (typeof session?.activeItemIndex === 'number') {
      setActiveQueueIndex(Math.min(Math.max(0, session.activeItemIndex), playlist.length - 1));
      return;
    }
    setActiveQueueIndex((current) => (current >= playlist.length ? playlist.length - 1 : current));
  }, [playlist, session?.activeItemIndex, session?.restoreState?.activeItemIndex]);

  const activeItem = playlist[activeQueueIndex] || null;

  const activeDetectedUnit = useMemo(() => {
    if (!session || !activeItem) return null;
    if (activeItem.kind === 'window') {
      const indexToken = Number(activeItem.key.split(':')[1] || -1);
      const unit = Number.isFinite(indexToken)
        ? session.windows.find((item) => item.index === indexToken)
        : null;
      if (!unit) return null;
      return {
        unitId: `window_${unit.index}`,
        text: String(unit.sourceText || unit.text || ''),
      };
    }
    if (activeItem.kind === 'panel' && typeof activeItem.panelIndex === 'number') {
      const unit = session.panels.find((item) => item.index === activeItem.panelIndex);
      if (!unit) return null;
      return {
        unitId: String(unit.panelId || `panel_${unit.index}`),
        text: String(unit.sourceText || unit.text || ''),
      };
    }
    return null;
  }, [activeItem, session]);

  const activeDetectedUnitId = String(activeDetectedUnit?.unitId || '').trim();
  const activeDetectedText = String(activeDetectedUnit?.text || '').trim();
  const activeDetectedOverride = activeDetectedUnitId ? String(unitOverridesDraft[activeDetectedUnitId] || '') : '';
  const detectedTextEditorValue = activeDetectedOverride || activeDetectedText;
  const hasDetectedTextDirty = activeDetectedUnitId
    ? detectedTextEditorDraft.trim() !== detectedTextEditorValue.trim()
    : false;

  useEffect(() => {
    setDetectedTextEditorDraft(detectedTextEditorValue);
  }, [activeDetectedUnitId, detectedTextEditorValue]);

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
    applySafeMediaVolume(audio, speechVolume, {
      fallback: 1,
      context: 'reader_speech',
      onError: (error, info) => {
        void reportFrontendSignal({
          message: 'reader.media_volume_assignment_failed',
          component: 'ReaderTabContent',
          severity: 'warning',
          metadata: {
            channel: 'speech',
            attemptedVolume: info.attemptedVolume,
            appliedFallback: info.appliedFallback,
            context: info.context,
            error: error instanceof Error ? error.message : String(error || 'unknown'),
          },
        });
      },
    });
  }, [speechVolume]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const nextUrl = await resolveMusicTrackUrlById(String(activeMusicTrack?.id || ''), activeMusicTrack?.url || '');
      if (!active) return;
      setResolvedMusicTrackUrl(nextUrl);
    })();
    return () => {
      active = false;
    };
  }, [activeMusicTrack]);

  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio || !activeMusicTrack) return;
    audio.loop = true;
    audio.src = resolvedMusicTrackUrl || '';
    applySafeMediaVolume(audio, isSpeechPlaying ? musicVolume * 0.45 : musicVolume, {
      fallback: musicVolume,
      context: 'reader_music',
      onError: (error, info) => {
        void reportFrontendSignal({
          message: 'reader.media_volume_assignment_failed',
          component: 'ReaderTabContent',
          severity: 'warning',
          metadata: {
            channel: 'music',
            attemptedVolume: info.attemptedVolume,
            appliedFallback: info.appliedFallback,
            context: info.context,
            error: error instanceof Error ? error.message : String(error || 'unknown'),
          },
        });
      },
    });
    if (isMusicPlaying && resolvedMusicTrackUrl) {
      void audio.play().catch(() => setIsMusicPlaying(false));
    } else {
      audio.pause();
    }
  }, [activeMusicTrack, isMusicPlaying, isSpeechPlaying, musicVolume, resolvedMusicTrackUrl]);

  const buildRestoreStatePayload = useCallback(
    (overrides?: { activeItemIndex?: number; activeUnitId?: string; viewportAnchor?: string }) => {
      if (!isReaderSaveStateActive) return null;
      const fallbackKey = activeItem?.key || '';
      return {
        activeItemIndex: Math.max(0, Number(overrides?.activeItemIndex ?? activeQueueIndex ?? 0)),
        activeUnitId: String(overrides?.activeUnitId || fallbackKey).trim(),
        viewportAnchor: String(overrides?.viewportAnchor || fallbackKey).trim(),
      };
    },
    [activeItem?.key, activeQueueIndex, isReaderSaveStateActive]
  );

  const commitProgress = useCallback(
    async (
      nextProgress: {
        consumedChars?: number;
        currentPanelIndex?: number;
        audioEngine?: ReaderAudioEngine;
        activeItemIndex?: number;
        activeUnitId?: string;
        viewportAnchor?: string;
      }
    ) => {
      if (!session?.id || !isReaderSaveStateActive) return;
      try {
        const restoreOverrides: { activeItemIndex?: number; activeUnitId?: string; viewportAnchor?: string } = {};
        if (typeof nextProgress.activeItemIndex === 'number') restoreOverrides.activeItemIndex = nextProgress.activeItemIndex;
        if (typeof nextProgress.activeUnitId === 'string') restoreOverrides.activeUnitId = nextProgress.activeUnitId;
        if (typeof nextProgress.viewportAnchor === 'string') restoreOverrides.viewportAnchor = nextProgress.viewportAnchor;
        const restoreState = buildRestoreStatePayload(restoreOverrides);
        if (!restoreState) return;
        const nextSession = await updateReaderProgress(mediaBackendUrl, session.id, {
          ...nextProgress,
          targetLanguage: targetLanguageDraft,
          pageViewMode: pageViewModeDraft,
          audioEngine: nextProgress.audioEngine || audioEngineDraft,
          activeItemIndex: restoreState.activeItemIndex,
          activeUnitId: restoreState.activeUnitId,
          viewportAnchor: restoreState.viewportAnchor,
        });
        startTransition(() => setSession(nextSession));
      } catch {
        // keep playback responsive even if progress commit stalls
      }
    },
    [audioEngineDraft, buildRestoreStatePayload, isReaderSaveStateActive, mediaBackendUrl, pageViewModeDraft, session?.id, targetLanguageDraft]
  );

  const buildLiveAutosavePayload = useCallback(() => {
    if (!isReaderSaveStateActive || !session?.id || !activeItem) return null;
    const payload: {
      activeItemIndex: number;
      activeUnitId: string;
      viewportAnchor: string;
      audioEngine: ReaderAudioEngine;
      consumedChars?: number;
      currentPanelIndex?: number;
    } = {
      activeItemIndex: Math.max(0, activeQueueIndex),
      activeUnitId: activeItem.key,
      viewportAnchor: activeItem.key,
      audioEngine: audioEngineDraft,
    };
    if (activeItem.kind === 'window' && typeof activeItem.startChar === 'number') {
      const startChar = activeItem.startChar;
      const charSpan = typeof activeItem.charCount === 'number'
        ? Math.max(0, activeItem.charCount)
        : typeof activeItem.endChar === 'number'
          ? Math.max(0, activeItem.endChar - startChar)
          : 0;
      const ratio = Math.min(1, Math.max(0, speechProgressPct / 100));
      let consumedChars = startChar + Math.floor(charSpan * ratio);
      if (typeof activeItem.endChar === 'number') consumedChars = Math.min(consumedChars, activeItem.endChar);
      payload.consumedChars = Math.max(0, consumedChars);
    } else if (activeItem.kind === 'panel' && typeof activeItem.panelIndex === 'number') {
      payload.currentPanelIndex = Math.max(0, activeItem.panelIndex);
    }
    return payload;
  }, [activeItem, activeQueueIndex, audioEngineDraft, isReaderSaveStateActive, session?.id, speechProgressPct]);

  const flushLiveAutosave = useCallback((force: boolean = false) => {
    const payload = buildLiveAutosavePayload();
    if (!payload) return;
    const signature = JSON.stringify(payload);
    if (!force && signature === lastAutoSaveSignatureRef.current) return;
    lastAutoSaveSignatureRef.current = signature;
    void commitProgress(payload);
  }, [buildLiveAutosavePayload, commitProgress]);

  useEffect(() => {
    if (!shouldRunReaderBackgroundPolling({ sessionId: session?.id, workspaceMode, visibilityState: pageVisibility })) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      flushLiveAutosave(false);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [flushLiveAutosave, pageVisibility, session?.id, workspaceMode]);

  useEffect(() => {
    if (!session?.id || workspaceMode !== 'playback') return undefined;
    const handlePageHide = () => {
      flushLiveAutosave(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handlePageHide();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [flushLiveAutosave, session?.id, workspaceMode]);

  const goToQueueIndex = useCallback((nextIndex: number, autoplay: boolean) => {
    if (playlistRef.current.length <= 0) return;
    const bounded = Math.max(0, Math.min(nextIndex, playlistRef.current.length - 1));
    const nextItem = playlistRef.current[bounded] || null;
    autoplayPendingRef.current = autoplay;
    setSpeechProgressPct(0);
    setIsSpeechBuffering(autoplay);
    setActiveQueueIndex(bounded);
    if (autoplay) {
      setIsSpeechPlaying(true);
    }
    const progressPayload: {
      activeItemIndex: number;
      activeUnitId?: string;
      viewportAnchor?: string;
      consumedChars?: number;
      currentPanelIndex?: number;
    } = {
      activeItemIndex: bounded,
      activeUnitId: nextItem?.key || '',
      viewportAnchor: nextItem?.key || '',
    };
    if (nextItem?.kind === 'panel' && typeof nextItem.panelIndex === 'number') {
      progressPayload.currentPanelIndex = nextItem.panelIndex;
    }
    if (nextItem?.kind === 'window' && typeof nextItem.startChar === 'number') {
      progressPayload.consumedChars = nextItem.startChar;
    }
    void commitProgress(progressPayload);
  }, [commitProgress]);

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

  useEffect(() => {
    if (audioSyncFallbackTimerRef.current !== null) {
      window.clearTimeout(audioSyncFallbackTimerRef.current);
      audioSyncFallbackTimerRef.current = null;
    }
    if (!session || !isReaderAutoSwipeAvailable(session) || !activeItem || activeItem.kind !== 'panel') {
      lastAudioSyncFallbackKeyRef.current = '';
      return;
    }
    if (autoAdvanceDraft !== 'audio_sync') {
      lastAudioSyncFallbackKeyRef.current = '';
      return;
    }
    if (Date.now() < autoSwipePausedUntil) return;
    if (typeof activeItem.panelIndex !== 'number') return;
    if (isSpeechPlaying && !isSpeechBuffering) {
      lastAudioSyncFallbackKeyRef.current = '';
      return;
    }
    const activePanel = session.panels.find((item) => item.index === activeItem.panelIndex);
    const fallbackDelayMs = getReaderAudioSyncFallbackDelay({
      emotionAwareReadMs: activePanel?.pacing?.emotionAwareReadMs,
      estimatedReadMs: activePanel?.estimatedReadMs,
    });
    const fallbackKey = `${session.id}:${activeItem.key}:${fallbackDelayMs}`;
    if (lastAudioSyncFallbackKeyRef.current === fallbackKey) return;
    lastAudioSyncFallbackKeyRef.current = fallbackKey;
    audioSyncFallbackTimerRef.current = window.setTimeout(() => {
      audioSyncFallbackTimerRef.current = null;
      advanceComicPanel('timer');
    }, fallbackDelayMs);
    return () => {
      if (audioSyncFallbackTimerRef.current !== null) {
        window.clearTimeout(audioSyncFallbackTimerRef.current);
        audioSyncFallbackTimerRef.current = null;
      }
    };
  }, [activeItem, advanceComicPanel, autoAdvanceDraft, autoSwipePausedUntil, isSpeechBuffering, isSpeechPlaying, session]);

  const startSession = useCallback(
    async (item: ReaderCatalogItem, options?: { forceNew?: boolean; autoPlay?: boolean }) => {
      const commercialStatus = normalizeReaderCommercialStatus(item.commercialUseStatus);
      if (commercialStatus === 'blocked' || commercialStatus === 'review') {
        onToast(
          formatReaderCommercialMessage({
            status: commercialStatus,
            reason: item.commercialUseReason,
            provider: item.provider,
            fallback: 'This title is not available for commercial Reader use.',
          }),
          'error'
        );
        return;
      }
      try {
        const resolvedTargetLanguage = resolveReaderTargetLanguage(item, targetLanguageDraft);
        const payload: Parameters<typeof createReaderSession>[1] = item.surface === 'uploads'
          ? { uploadId: item.id, forceNew: Boolean(options?.forceNew), autoAdvanceProfile: item.contentKind === 'comic' ? autoAdvanceDraft : 'off' }
          : { itemId: item.id, forceNew: Boolean(options?.forceNew), autoAdvanceProfile: item.contentKind === 'comic' ? autoAdvanceDraft : 'off' };
        if (item.contentKind === 'comic') payload.readingModeOverride = normalizeReaderComicDraftMode(readingModeDraft);
        payload.targetLanguage = resolvedTargetLanguage;
        payload.pageViewMode = pageViewModeDraft;
        payload.ttsLanguageMode = ttsLanguageModeDraft;
        payload.audioEngine = audioEngineDraft;
        payload.multiSpeakerEnabled = multiSpeakerEnabledDraft;
        payload.voiceMode = voiceModeDraft;
        payload.narratorVoiceId = narratorVoiceDraft;
        const nextSession = await createReaderSession(mediaBackendUrl, payload);
        autoplayPendingRef.current = Boolean(options?.autoPlay);
        startTransition(() => {
          setSelectedItemId(item.id);
          setSession(nextSession);
          setResumeSession(nextSession);
          setWorkspaceMode('playback');
          setActiveUtilityPanel(null);
          setCastDraft(nextSession.castMemory || {});
          setNarratorVoiceDraft(String(nextSession.narratorVoiceId || nextSession.castMemory?.Narrator || narratorVoiceDraft));
          setUnitOverridesDraft(nextSession.unitOverrides || {});
          setReadingModeDraft(nextSession.readingMode || item.readingModeDefault || 'document');
          setAutoAdvanceDraft((nextSession.autoAdvanceProfile as ReaderAutoAdvanceProfile) || 'off');
          setTargetLanguageDraft(nextSession.targetLanguage || resolvedTargetLanguage);
          setPageViewModeDraft(nextSession.pageViewMode || resolveReaderPageViewDefault(nextSession.sourceLanguage, nextSession.targetLanguage));
          setTtsLanguageModeDraft(nextSession.ttsLanguageMode || 'auto');
          setMultiSpeakerEnabledDraft(nextSession.multiSpeakerEnabled !== false);
          setAudioEngineDraft(nextSession.audioEngine === 'native_audio_dialog' ? 'native_audio_dialog' : 'tts_hd');
          if (typeof nextSession.restoreState?.activeItemIndex === 'number') {
            setActiveQueueIndex(Math.max(0, nextSession.restoreState.activeItemIndex));
            return;
          }
          if (typeof nextSession.activeItemIndex === 'number') {
            setActiveQueueIndex(Math.max(0, nextSession.activeItemIndex));
            return;
          }
          setActiveQueueIndex(0);
        });
        void loadLibrary({ background: true, suppressToast: true });
        onToast(
          isReaderPrepTerminal(nextSession)
            ? `Reader session ready for ${item.title}.`
            : `Preparing Reader session for ${item.title}.`,
          isReaderPrepTerminal(nextSession) ? 'success' : 'info'
        );
      } catch (error) {
        onToast(describeReaderRequestError(error, 'Could not start Reader session.'), 'error');
      }
    },
    [audioEngineDraft, autoAdvanceDraft, loadLibrary, mediaBackendUrl, multiSpeakerEnabledDraft, narratorVoiceDraft, onToast, pageViewModeDraft, readingModeDraft, targetLanguageDraft, ttsLanguageModeDraft, voiceModeDraft]
  );

  const handleResumeSession = useCallback(async () => {
    if (!resumeSession) return;
    let nextSession = resumeSession;
    if (resumeSession.id) {
      try {
        nextSession = await getReaderSession(mediaBackendUrl, resumeSession.id);
      } catch (error) {
        if ((error as Error & { status?: number }).status === 404) {
          const nextLibrary = await loadLibrary({ background: true, suppressToast: true });
          if (!libraryHasSession(nextLibrary, resumeSession.id)) {
            startTransition(() => {
              setSession(null);
              setResumeSession(resolveReaderResumeSession(nextLibrary, ''));
              setWorkspaceMode('browse');
              setActiveUtilityPanel(null);
              setUnitOverridesDraft({});
            });
            if (expiredSessionToastForRef.current !== resumeSession.id) {
              expiredSessionToastForRef.current = resumeSession.id;
              onToast('Reader session expired after server restart.', 'info');
            }
            return;
          }
        }
        onToast('Using cached Reader session because refresh failed.', 'info');
      }
    }
    startTransition(() => {
      if (resumeSessionItem?.id) setSelectedItemId(resumeSessionItem.id);
      setSession(nextSession);
      setResumeSession(nextSession);
      setWorkspaceMode('playback');
      setActiveUtilityPanel(null);
      setCastDraft(nextSession.castMemory || {});
      setNarratorVoiceDraft(String(nextSession.narratorVoiceId || nextSession.castMemory?.Narrator || VOICES[0]?.id || 'v22'));
      setUnitOverridesDraft(nextSession.unitOverrides || {});
      setReadingModeDraft(nextSession.readingMode || resumeSessionItem?.readingModeDefault || 'document');
      setAutoAdvanceDraft((nextSession.autoAdvanceProfile as ReaderAutoAdvanceProfile) || 'off');
      setTargetLanguageDraft(nextSession.targetLanguage || nextSession.sourceLanguage || '');
      setPageViewModeDraft(nextSession.pageViewMode || resolveReaderPageViewDefault(nextSession.sourceLanguage, nextSession.targetLanguage));
      setTtsLanguageModeDraft(nextSession.ttsLanguageMode || 'auto');
      setMultiSpeakerEnabledDraft(nextSession.multiSpeakerEnabled !== false);
      setAudioEngineDraft(nextSession.audioEngine === 'native_audio_dialog' ? 'native_audio_dialog' : 'tts_hd');
      if (typeof nextSession.restoreState?.activeItemIndex === 'number') {
        setActiveQueueIndex(Math.max(0, nextSession.restoreState.activeItemIndex));
        return;
      }
      if (typeof nextSession.activeItemIndex === 'number') {
        setActiveQueueIndex(Math.max(0, nextSession.activeItemIndex));
        return;
      }
      setActiveQueueIndex(0);
    });
    void reportFrontendSignal({
      message: 'reader.playback_resume',
      component: 'ReaderTabContent',
      metadata: {
        layoutMode,
        sessionId: nextSession.id,
        contentKind: nextSession.contentKind,
      },
    });
  }, [layoutMode, loadLibrary, mediaBackendUrl, onToast, resumeSession, resumeSessionItem]);

  const handlePrimaryAction = useCallback(async () => {
    if (!activeCatalogItem) return;
    if (shouldResumeActiveCatalogItem) {
      await handleResumeSession();
      return;
    }
    await startSession(activeCatalogItem, { autoPlay: true });
  }, [activeCatalogItem, handleResumeSession, shouldResumeActiveCatalogItem, startSession]);

  const openUtilityPanel = useCallback((panel: ReaderUtilityPanel, options?: { toggle?: boolean; scope?: ReaderUtilityPanelScope }) => {
    if (!isReaderUtilityPanelAvailable(panel, Boolean(session))) {
      const label = panel === 'detected'
        ? 'AI Text'
        : panel === 'cast'
          ? 'Cast'
          : panel.charAt(0).toUpperCase() + panel.slice(1);
      onToast(`Open or resume a Reader session to use ${label}.`, 'info');
      return;
    }
    const nextScope = options?.scope || 'all';
    if (options?.toggle && activeUtilityPanel === panel && activeUtilityPanelScope === nextScope) {
      setActiveUtilityPanelScope('all');
      setActiveUtilityPanel(null);
      return;
    }
    setActiveUtilityPanelScope(nextScope);
    setActiveUtilityPanel(panel);
  }, [activeUtilityPanel, activeUtilityPanelScope, onToast, session]);

  const toggleUtilityPanel = useCallback((panel: ReaderUtilityPanel) => {
    openUtilityPanel(panel, { toggle: true });
  }, [openUtilityPanel]);

  const toggleTranslatePanel = useCallback(() => {
    openUtilityPanel('translator', { toggle: true, scope: 'translator_only' });
  }, [openUtilityPanel]);

  const handleSelectUtilityPanel = useCallback((panel: ReaderUtilityPanel) => {
    openUtilityPanel(panel, { scope: 'all' });
  }, [openUtilityPanel]);

  const handleOpenItem = useCallback(
    (itemId: string) => {
      const nextItem =
        filteredItems.find((item) => item.id === itemId)
        || (library?.items || []).find((item) => item.id === itemId)
        || null;
      if (!nextItem) return;
      setSelectedItemId(nextItem.id);
      setActiveUtilityPanel(null);
      void (async () => {
        const shouldResumeItem = Boolean(
          !session
          && resumeSession?.id
          && resumeSessionItem?.id
          && resumeSessionItem.id === nextItem.id
        );
        if (shouldResumeItem) {
          await handleResumeSession();
          return;
        }
        await startSession(nextItem, { autoPlay: true });
      })();
    },
    [filteredItems, handleResumeSession, library?.items, resumeSession?.id, resumeSessionItem?.id, session, startSession]
  );

  const handleGoHome = useCallback(() => {
    setWorkspaceMode('browse');
    setActiveUtilityPanel(null);
    autoplayPendingRef.current = false;
  }, []);

  const handleAudioEngineChange = useCallback(
    (nextEngine: ReaderAudioEngine) => {
      const resolved = nextEngine === 'native_audio_dialog' ? 'native_audio_dialog' : 'tts_hd';
      setAudioEngineDraft(resolved);
      setSession((current) => (current ? { ...current, audioEngine: resolved } : current));
      if (!session?.id) return;
      void commitProgress({
        activeItemIndex: activeQueueIndex,
        activeUnitId: activeItem?.key || '',
        viewportAnchor: activeItem?.key || '',
        audioEngine: resolved,
      });
    },
    [activeItem?.key, activeQueueIndex, commitProgress, session?.id]
  );

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
      setUploadOwnershipBasis('user_responsible');
      setSurface('all');
      setSelectedItemId(created.id);
      setActiveUtilityPanel(null);
      await loadLibrary();
      await startSession(created, { forceNew: true, autoPlay: true });
      onToast(`Imported and opened in player as ${created.contentKind}.`, 'success');
    } catch (error) {
      onToast(describeReaderRequestError(error, 'Reader import failed.'), 'error');
    } finally {
      setIsUploading(false);
    }
  }, [loadLibrary, mediaBackendUrl, onToast, regionId, selectedFiles, startSession, uploadContentType, uploadOwnershipBasis, uploadTitle]);

  const handleSavepoint = useCallback(async () => {
    if (!session?.id || !isReaderSaveStateActive) return;
    setIsSaving(true);
    try {
      const restoreState = buildRestoreStatePayload();
      if (!restoreState) return;
      const savePayload: Parameters<typeof saveReaderSession>[2] = {
        castOverrides: castDraft,
        autoAdvanceProfile: session.contentKind === 'comic' ? autoAdvanceDraft : 'off',
        musicTrackId: effectiveMusicTrackId,
        targetLanguage: targetLanguageDraft,
        pageViewMode: pageViewModeDraft,
        ttsLanguageMode: ttsLanguageModeDraft,
        audioEngine: audioEngineDraft,
        multiSpeakerEnabled: multiSpeakerEnabledDraft,
        voiceMode: voiceModeDraft,
        narratorVoiceId: narratorVoiceDraft,
        unitOverrides: unitOverridesDraft,
        restoreState,
      };
      if (session.contentKind === 'comic') savePayload.readingModeOverride = normalizeReaderComicDraftMode(readingModeDraft);
      const nextSession = await saveReaderSession(mediaBackendUrl, session.id, savePayload);
      setSession(nextSession);
      setTargetLanguageDraft(nextSession.targetLanguage || targetLanguageDraft);
      setPageViewModeDraft(nextSession.pageViewMode || pageViewModeDraft);
      setTtsLanguageModeDraft(nextSession.ttsLanguageMode || ttsLanguageModeDraft);
      setMultiSpeakerEnabledDraft(nextSession.multiSpeakerEnabled !== false);
      setAudioEngineDraft(nextSession.audioEngine === 'native_audio_dialog' ? 'native_audio_dialog' : 'tts_hd');
      setNarratorVoiceDraft(String(nextSession.narratorVoiceId || nextSession.castMemory?.Narrator || narratorVoiceDraft));
      setUnitOverridesDraft(nextSession.unitOverrides || {});
      await loadLibrary();
      onToast('Reader savepoint updated.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not save Reader preferences.'), 'error');
    } finally {
      setIsSaving(false);
    }
  }, [audioEngineDraft, autoAdvanceDraft, buildRestoreStatePayload, castDraft, effectiveMusicTrackId, isReaderSaveStateActive, loadLibrary, mediaBackendUrl, multiSpeakerEnabledDraft, narratorVoiceDraft, onToast, pageViewModeDraft, readingModeDraft, session, targetLanguageDraft, ttsLanguageModeDraft, unitOverridesDraft, voiceModeDraft]);

  const handleSavePreferences = useCallback(async () => {
    setIsSaving(true);
    try {
      const nextPreferences = await updateReaderPreferences(mediaBackendUrl, {
        regionId,
        targetLanguage: targetLanguageDraft,
        pageViewMode: pageViewModeDraft,
        ttsLanguageMode: ttsLanguageModeDraft,
        autoAdvanceProfile: autoAdvanceDraft,
        multiSpeakerEnabled: multiSpeakerEnabledDraft,
        audioEngine: audioEngineDraft,
        narratorVoiceId: narratorVoiceDraft,
        readingMode: normalizeReaderComicDraftMode(readingModeDraft),
      });
      applyReaderPreferences(nextPreferences);
      onToast('Reader defaults updated.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not save Reader defaults.'), 'error');
    } finally {
      setIsSaving(false);
    }
  }, [applyReaderPreferences, audioEngineDraft, autoAdvanceDraft, mediaBackendUrl, multiSpeakerEnabledDraft, narratorVoiceDraft, onToast, pageViewModeDraft, readingModeDraft, regionId, targetLanguageDraft, ttsLanguageModeDraft]);

  const handleApplyDetectedTextOverride = useCallback(async () => {
    if (!session?.id || !activeDetectedUnitId || !isReaderSaveStateActive) return;
    setIsSaving(true);
    try {
      const normalizedText = detectedTextEditorDraft.trim();
      const nextOverrides = { ...unitOverridesDraft };
      if (normalizedText) {
        nextOverrides[activeDetectedUnitId] = normalizedText;
      } else {
        delete nextOverrides[activeDetectedUnitId];
      }
      const restoreState = buildRestoreStatePayload();
      if (!restoreState) return;
      const nextSession = await saveReaderSession(mediaBackendUrl, session.id, {
        unitOverrides: nextOverrides,
        audioEngine: audioEngineDraft,
        voiceMode: voiceModeDraft,
        narratorVoiceId: narratorVoiceDraft,
        restoreState,
      });
      startTransition(() => {
        setSession(nextSession);
        setUnitOverridesDraft(nextSession.unitOverrides || {});
        setDetectedTextEditorDraft(normalizedText);
        setAudioEngineDraft(nextSession.audioEngine === 'native_audio_dialog' ? 'native_audio_dialog' : 'tts_hd');
      });
      onToast('Detected text updated for this session.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not apply detected text edit.'), 'error');
    } finally {
      setIsSaving(false);
    }
  }, [activeDetectedUnitId, audioEngineDraft, buildRestoreStatePayload, detectedTextEditorDraft, isReaderSaveStateActive, mediaBackendUrl, narratorVoiceDraft, onToast, session?.id, unitOverridesDraft, voiceModeDraft]);

  const handleResetDetectedTextOverride = useCallback(async () => {
    if (!session?.id || !activeDetectedUnitId || !isReaderSaveStateActive) return;
    setIsSaving(true);
    try {
      const nextOverrides = { ...unitOverridesDraft };
      delete nextOverrides[activeDetectedUnitId];
      const restoreState = buildRestoreStatePayload();
      if (!restoreState) return;
      const nextSession = await saveReaderSession(mediaBackendUrl, session.id, {
        unitOverrides: nextOverrides,
        audioEngine: audioEngineDraft,
        voiceMode: voiceModeDraft,
        narratorVoiceId: narratorVoiceDraft,
        restoreState,
      });
      startTransition(() => {
        setSession(nextSession);
        setUnitOverridesDraft(nextSession.unitOverrides || {});
        setDetectedTextEditorDraft(activeDetectedText);
        setAudioEngineDraft(nextSession.audioEngine === 'native_audio_dialog' ? 'native_audio_dialog' : 'tts_hd');
      });
      onToast('Detected text reset for this session.', 'success');
    } catch (error) {
      onToast(String((error as Error)?.message || 'Could not reset detected text.'), 'error');
    } finally {
      setIsSaving(false);
    }
  }, [activeDetectedText, activeDetectedUnitId, audioEngineDraft, buildRestoreStatePayload, isReaderSaveStateActive, mediaBackendUrl, narratorVoiceDraft, onToast, session?.id, unitOverridesDraft, voiceModeDraft]);

  const handleCloseSession = useCallback(async () => {
    if (!session?.id) return;
    try {
      await deleteReaderSession(mediaBackendUrl, session.id);
      setWorkspaceMode('browse');
      setResumeSession(null);
      setSession(null);
      setActiveUtilityPanel(null);
      setActiveQueueIndex(0);
      setSpeechProgressPct(0);
      setIsSpeechBuffering(false);
      setUnitOverridesDraft({});
      setDetectedTextEditorDraft('');
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

  const warningCountdown = session?.deleteAtMs ? getReaderDeleteCountdownLabel(session.deleteAtMs) : '03:00';
  const resultsCountLabel = `${filteredItems.length.toLocaleString()} title${filteredItems.length === 1 ? '' : 's'}`;

  const targetLanguageLabel = useMemo(
    () => findLanguageLabel(session?.targetLanguage || targetLanguageDraft || activeCatalogItem?.sourceLanguage),
    [activeCatalogItem?.sourceLanguage, session?.targetLanguage, targetLanguageDraft]
  );
  const activeAudioEngine = audioEngineDraft === 'native_audio_dialog'
    ? 'native_audio_dialog'
    : 'tts_hd';
  const audioEngineLabel = activeAudioEngine === 'native_audio_dialog'
    ? 'Gemini 2.5 Native Audio Dialog'
    : 'Gemini 2.5 Flash TTS';
  const audioEngineStatusLabel = String(
    session?.audioEngineStatus
      || (activeAudioEngine === 'native_audio_dialog' ? 'active' : 'active')
  ).trim().toLowerCase() || 'active';
  const pageViewModeLabel = pageViewModeDraft === 'translated' ? 'Translated Page View' : 'Original Page View';
  const isPlaybackMode = workspaceMode === 'playback' && Boolean(session);
  const showReaderAuthState = !isPlaybackMode && readerBootstrapState === 'needs_auth';
  const showReaderErrorState = !isPlaybackMode && readerBootstrapState === 'error' && !library;
  const shouldShowRightsNotice = readerBootstrapState === 'ready' && legalAck !== null && !legalAck.accepted;
  const rootClassName = `${getReaderThemeClassName(resolvedTheme)} vf-reader--layout-${layoutMode}${isFullscreen ? ' vf-reader--fullscreen' : ''}${activeUtilityPanel ? ' vf-reader--tray-open' : ''}`;
  const workspaceClassName = `vf-reader__workspace vf-reader__workspace--${layoutMode} ${isPlaybackMode ? 'vf-reader__workspace--playback' : 'vf-reader__workspace--browse'}${activeUtilityPanel ? ' vf-reader__workspace--has-tray' : ''}`;
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
            {shouldShowRightsNotice && (
              <section className="vf-reader__section">
                <div className="vf-reader__notice-card">
                  <div className="vf-reader__section-eyebrow">Rights Notice</div>
                  <h3>{legalAck?.title || 'Acknowledge Reader rights once before importing content.'}</h3>
                  <p>{legalAck?.message || 'Upload only work you created, have permission to use, or that is openly licensed.'}</p>
                  <div className="vf-reader__notice-meta">{billingLabel}. Reader warns before unsaved cache expires.</div>
                  {commercialPolicy?.enabled ? (
                    <div className="vf-reader__notice-meta">
                      Commercial checks are active. Prefer uploads you own or license, and catalog items marked commercial-ready.
                    </div>
                  ) : null}
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
                    onSelectWindow={selectQueueIndexFromWindow}
                    onSelectPanel={selectQueueIndexFromPanel}
                    resolveMediaUrl={resolveMediaUrl}
                    panelRefs={panelRefs}
                    pauseAutoSwipe={pauseAutoSwipe}
                    targetLanguageLabel={targetLanguageLabel}
                    pageViewModeLabel={pageViewModeLabel}
                    audioEngineLabel={audioEngineLabel}
                    audioEngineStatus={audioEngineStatusLabel}
                  />
                ) : showReaderAuthState ? (
                  <section className="vf-reader__section" data-testid="reader-auth-required">
                    <div className="vf-reader__notice-card">
                      <div className="vf-reader__section-eyebrow">Reader Access</div>
                      <h3>Sign in to load your Reader shelf.</h3>
                      <p>{readerBootstrapMessage || 'Reader can show active sessions, synced imports, and region shelves once you sign in.'}</p>
                      <button
                        type="button"
                        className="vf-reader__btn"
                        onClick={() => setBootstrapRetryNonce((current) => current + 1)}
                      >
                        Retry Reader Load
                      </button>
                    </div>
                  </section>
                ) : showReaderErrorState ? (
                  <section className="vf-reader__section" data-testid="reader-load-error">
                    <div className="vf-reader__notice-card">
                      <div className="vf-reader__section-eyebrow">Reader Status</div>
                      <h3>Reader could not load right now.</h3>
                      <p>{readerBootstrapMessage || 'Retry after checking backend availability and your Reader configuration.'}</p>
                      <button
                        type="button"
                        className="vf-reader__btn"
                        onClick={() => setBootstrapRetryNonce((current) => current + 1)}
                      >
                        Retry Reader Load
                      </button>
                    </div>
                  </section>
                ) : (
                  <ReaderBrowseHome
                    library={library}
                    filteredItems={filteredItems}
                    selectedItemId={selectedItemId}
                    resumeSession={resumeSession}
                    resumeItem={resumeSessionItem}
                    surface={surface}
                    regionId={regionId}
                    searchQuery={searchQuery}
                    resultsCountLabel={resultsCountLabel}
                    isLoading={isLoading}
                    onSelectSurface={setSurface}
                    onSelectRegion={setRegionId}
                    onSetSearchQuery={setSearchQuery}
                    onSelectItem={setSelectedItemId}
                    onOpenItem={handleOpenItem}
                    onOpenImport={() => toggleUtilityPanel('import')}
                    onResumeSession={() => void handleResumeSession()}
                    resolveMediaUrl={resolveMediaUrl}
                    formatCompactStat={formatCompactStat}
                    formatProgressLabel={formatProgressLabel}
                  />
                )}
              </div>

              <ReaderUtilityTray
                layoutMode={layoutMode}
                panel={activeUtilityPanel}
                panelScope={activeUtilityPanelScope}
                isOpen={Boolean(activeUtilityPanel)}
                session={session}
                legalAckAccepted={Boolean(legalAck?.accepted)}
                commercialPolicy={commercialPolicy}
                regions={library?.regions || []}
                regionId={regionId}
                uploadTitle={uploadTitle}
                uploadContentType={uploadContentType}
                uploadOwnershipBasis={uploadOwnershipBasis}
                selectedFiles={selectedFiles}
                targetLanguageDraft={targetLanguageDraft}
                pageViewModeDraft={pageViewModeDraft}
                ttsLanguageModeDraft={ttsLanguageModeDraft}
                audioEngineDraft={audioEngineDraft}
                audioEngineStatusLabel={audioEngineStatusLabel}
                readingModeDraft={readingModeDraft}
                autoAdvanceDraft={autoAdvanceDraft}
                narratorVoiceId={narratorVoiceDraft}
                multiSpeakerEnabled={multiSpeakerEnabledDraft}
                castDraft={castDraft}
                castSpeakers={castSpeakers}
                activeDetectedUnitId={activeDetectedUnitId}
                editedDetectedText={detectedTextEditorDraft}
                activeDetectedText={activeDetectedText}
                hasEditedTextDirty={hasDetectedTextDirty}
                isSaving={isSaving}
                isUploading={isUploading}
                isAutoAssigningCast={isAutoAssigningCast}
                onClose={() => {
                  setActiveUtilityPanelScope('all');
                  setActiveUtilityPanel(null);
                }}
                onSelectPanel={handleSelectUtilityPanel}
                onSavepoint={() => void handleSavepoint()}
                onSavePreferences={() => void handleSavePreferences()}
                onCloseSession={() => void handleCloseSession()}
                onSetRegionId={setRegionId}
                onSetUploadTitle={setUploadTitle}
                onSetUploadContentType={setUploadContentType}
                onSetUploadOwnershipBasis={setUploadOwnershipBasis}
                onFileSelection={setSelectedFiles}
                onUpload={() => void handleUpload()}
                onSetTargetLanguageDraft={setTargetLanguageDraft}
                onSetPageViewModeDraft={setPageViewModeDraft}
                onSetTtsLanguageModeDraft={setTtsLanguageModeDraft}
                onSetAudioEngineDraft={handleAudioEngineChange}
                onSetReadingModeDraft={setReadingModeDraft}
                onSetAutoAdvanceDraft={setAutoAdvanceDraft}
                onSetNarratorVoiceId={setNarratorVoiceDraft}
                onSetMultiSpeakerEnabled={setMultiSpeakerEnabledDraft}
                onCastDraftChange={setCastDraft}
                onAutoAssignCast={handleAutoAssignCast}
                onEditedDetectedTextChange={setDetectedTextEditorDraft}
                onApplyDetectedTextOverride={() => void handleApplyDetectedTextOverride()}
                onResetDetectedTextOverride={() => void handleResetDetectedTextOverride()}
              />
            </div>
          </div>
        </div>

        <ReaderPlayerDock
          dockRef={playerDockRef}
          suspendAutoCollapse={Boolean(activeUtilityPanel)}
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
          audioEngine={activeAudioEngine}
          audioEngineStatus={audioEngineStatusLabel}
          narratorVoiceId={narratorVoiceDraft}
          multiSpeakerEnabled={multiSpeakerEnabledDraft}
          voiceOptions={VOICES}
          onTransportToggle={transportToggle}
          onPrev={() => goToQueueIndex(activeQueueIndex - 1, isSpeechPlaying || isSpeechBuffering)}
          onNext={() => goToQueueIndex(activeQueueIndex + 1, isSpeechPlaying || isSpeechBuffering)}
          onGoHome={handleGoHome}
          onOpenImport={() => toggleUtilityPanel('import')}
          onOpenTranslate={toggleTranslatePanel}
          onOpenSettings={() => toggleUtilityPanel('settings')}
          onOpenDetectedText={() => toggleUtilityPanel('detected')}
          onOpenCast={() => toggleUtilityPanel('cast')}
          onToggleNativeAudio={() => handleAudioEngineChange(activeAudioEngine === 'native_audio_dialog' ? 'tts_hd' : 'native_audio_dialog')}
          onNarratorVoiceChange={setNarratorVoiceDraft}
          onToggleMultiSpeaker={() => setMultiSpeakerEnabledDraft((value) => !value)}
        />
        <audio ref={speechAudioRef} preload="auto" />
        <audio ref={musicAudioRef} preload="auto" />
      </div>
    </div>
  );
};
