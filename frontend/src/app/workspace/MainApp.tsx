'use client';

import React, { Suspense, lazy, startTransition, useDeferredValue, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
    Mic, Play, Pause, Settings, X, Wand2, Trash2, Sparkles,
    Music, Video,
    Save, Fingerprint, UploadCloud, Loader2,
    Download, Menu, Box,
    Bot, Clock, Send,
    Film, Mic2, Sliders,
    Lock, RefreshCw, Users, Palette, Timer, Cpu, Zap, Laptop, Activity, Sun, Moon, Type, ChevronDown, ChevronUp, LogIn, LogOut, UserPlus, Coins, Bell, Maximize2, Minimize2
} from 'lucide-react';
import { Button } from '../../../components/Button';
import { VOICES, MUSIC_TRACKS, LANGUAGES, EMOTIONS } from '../../../constants';
import {
  ActiveTtsEngineKey,
  GenerationSettings,
  AppScreen,
  ClonedVoice,
  DubSegment,
  CharacterProfile,
  VoiceOption,
  StudioEditorMode,
  StudioQueueItem,
  StudioQueueState,
  StudioSingleInflightGenerationLedger,
} from '../../../types';
import { USER_CONTEXT_CHARACTER_SYNC_WARNING_EVENT, useUser } from '../../../contexts/UserContext';
import { refreshStudioSpeakerVoices } from '../../shared/voices/castAssignment';
import { getEngineDisplayName } from '../../../services/engineDisplay';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { readStorageJson, readStorageString, removeStorageKey, writeStorageJson, writeStorageString } from '../../shared/storage/localStore';
import { UI_BRAND_THEME_CONFIGS, UI_BRAND_THEME_ORDER, type UiBrandThemeId } from '../../shared/theme/brandThemes';
import { applyBrandThemeToDocument, applyThemeModeToDocument } from '../../shared/theme/themeDom';
import { EngineRuntimeStrip } from '../../../components/EngineRuntimeStrip';
import { ProofreadCluster } from '../../../components/ProofreadCluster';
import { OptimizedAvatar } from '../../../components/ui/OptimizedAvatar';
import { StudioTranslateBar } from '../../../components/StudioTranslateBar';
import { SectionCard } from '../../../components/SectionCard';
import { BrandLogo } from '../../../components/BrandLogo';
import { MorphingGenerateButton } from '../../../components/studio/MorphingGenerateButton';
import { DirectorPreview } from '../../../components/studio/DirectorPreview';
import { normalizeDirectorPreviewComparisonText } from '../../../components/studio/directorPreviewDiff';
import { TelemetrySparkline } from '../../../components/ui/TelemetrySparkline';
import { buildWorkspaceTabs, resolveWorkspaceNextPreloadTab, WORKSPACE_NAV_SECTION_LABELS, WorkspaceTab as Tab } from '../../features/workspace/model/tabs';
import { useBillingActions } from '../../features/billing/hooks/useBillingActions';
import { cancelTtsJob, cancelTtsSession, createTtsJob, getTtsJob } from '../../shared/api/gatewayClient';
import { resolveApiBaseUrl } from '../../shared/api/config';
import { API_ROUTE_FAMILIES } from '../../shared/api/routes';
import { applySafeMediaVolume, normalizeMediaVolume } from '../../shared/media/safeMediaVolume';
import { useWorkspaceViewport } from '../../shared/ui/useWorkspaceViewport';
import { useManagedTabs } from '../../shared/ui/tabs';
import {
  normalizeAssistantProviderControlsEnabled,
  normalizePreferUserGeminiKey,
} from '../../shared/settings/assistantProvider';
import { hasAdminConsoleAccess as canUseAdminConsole } from '../../shared/auth/adminAccess';
import { formatFrontendError, type FrontendErrorContext } from '../../shared/errors/formatFrontendError';
import { joinUiFragments, sanitizeUiText } from '../../shared/ui/terminology';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import { NOTIFICATION_DEEP_LINK_EVENT, readNotificationDeepLink } from '../../shared/notifications/deepLink';
import { reportFrontendSignal } from '../../shared/telemetry/frontendErrors';
import { fetchAccountProfile, type TokenPackKey } from '../../../services/accountService';
import { firebaseAuth } from '../../../services/firebaseClient';
import { extractNovelTextFromFile } from '../../../services/novelImportService';
import {
  type AdminOpsTab,
  COUNTRY_TAG_BY_NAME,
  TOKEN_PACK_MATRIX,
  STUDIO_SPEECH_GAIN_MAX,
  STUDIO_SPEECH_GAIN_MIN,
  SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT,
  applyTokenPackDiscount,
  appendRollingSample,
  formatInr,
  formatMobileAvailableCreditsPercent,
  getStaticVoiceFallback,
  injectDirectorTagsPreservingFormat,
  normalizeEngineToken,
  normalizeEmotionTag,
  normalizeSpeakerHeaderScript,
  normalizeSpeakerMapKey,
  parseMultiSpeakerScript,
  pickLowestLatencyRuntimeEngine,
  resolveAdminOpsTabFromUrl,
  resolveEngineToken,
  resolveInitialStudioDraftText,
  resolveTokenPackDiscountPercent,
  normalizePlanToken,
  PRIME_ACCESS_LOCK_MESSAGE,
  resolveSpeakerMappedVoiceId,
  resolveStudioMusicGain,
  resolveStudioSpeechGain,
  resolvePrimeAllowedEngines,
  resolveWorkspaceRoutePath,
  resolveWorkspaceTabFromPathname,
  shouldRefreshSelectedEngineTelemetry,
} from './mainAppHelpers';
import {
  canUseStudioQueue,
  computeStudioQueueMasterOrder,
  createStudioQueueState,
  hashStudioQueueSource,
  normalizeStoredStudioQueueState,
} from '../../features/studio/model/queue';
import {
  STUDIO_RAIL_TAB_ITEMS,
  getStudioCreditsActionState,
  resolveSidebarMode,
  resolveStudioRailTab,
  type SidebarMode,
  type StudioRailTab,
} from '../../features/studio/model/layout';
import { resolveStudioGenerateDockMetrics } from '../../features/studio/model/generateDock';
import {
  clearStudioQueueAudioCache,
  deleteStudioQueueAudioBlob,
  readStudioQueueAudioBlob,
  storeStudioQueueAudioBlob,
} from '../../../services/studioQueueCacheService';
import { createStudioObjectUrlRegistry } from '../../../services/studioObjectUrlRegistry';
import { audioBufferToWav } from '../../shared/audio/wav';
import { getSharedAudioContext as getAudioContext } from '../../shared/audio/audioContext';
import { resolveHistoryVoiceLabel } from '../../shared/voices/historyVoiceLabel';
import { resolvePublicVoiceLabel } from '../../shared/voices/voicePublicName';

// Runtime types imported from inlined barrel
import {
  mapGatewayEngineRuntimeToUiStatus,
  TTS_RUNTIME_STATUS_EVENT,
  type EngineRuntimeUiState,
  type EngineRuntimeUiStatus,
  type EngineRuntimeMetadata,
  formatRuntimeMetadataSummary,
  formatRuntimeServerLabel,
  normalizeEngineRuntimeStateToken,
} from '../../shared/runtime/runtimeStatusMapping';

import { createSynthesisTraceId } from '../../../services/synthesisContractService';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../navigation';
import type { VoiceCloneModalResult } from '../../features/voice-cloning/VoiceCloneModal';
import { applyMotionLevelToDocument } from '../../shared/theme/themeDom';


type StudioDirectorOptionKey = 'expressiveEmotion' | 'autoRewrite';
type StudioDirectorModeState = Record<StudioDirectorOptionKey, boolean>;
interface StudioDirectorPreviewState {
  sourceText: string;
  previewText: string;
  castNames: string[];
  mood?: string;
  modeLabel: string;
  patchedLineCount: number;
}

type VoiceSampleSource = {
  url: string;
  needsCleanup: boolean;
};

type VoiceSampleCacheEntry = {
  source?: VoiceSampleSource;
  inFlight?: Promise<VoiceSampleSource>;
};

const DEFAULT_STUDIO_DIRECTOR_MODE_STATE: StudioDirectorModeState = {
  expressiveEmotion: false,
  autoRewrite: false,
};

const EMPTY_PARSED_STUDIO_SCRIPT = parseMultiSpeakerScript('');

const STUDIO_DIRECTOR_OPTION_ITEMS: Array<{
  key: StudioDirectorOptionKey;
  label: string;
  compactLabel: string;
  title: string;
}> = [
  {
    key: 'expressiveEmotion',
    label: 'Expressive Emotion',
    compactLabel: 'Expressive',
    title: 'Use stronger, more vivid emotion labels when the source supports them.',
  },
  {
    key: 'autoRewrite',
    label: 'Auto',
    compactLabel: 'Auto',
    title: 'Rewrite the same script into the cleaner AI Director pass shown in the preview while preserving meaning.',
  },
];

const describeStudioDirectorModeState = (value: StudioDirectorModeState): string => {
  const activeLabels = STUDIO_DIRECTOR_OPTION_ITEMS
    .filter((item) => value[item.key])
    .map((item) => item.label);
  return activeLabels.length > 0 ? activeLabels.join(' + ') : 'Default';
};

const loadStudioMixService = (() => {
  let cached: Promise<typeof import('../../../services/studioMixService')> | null = null;
  return () => {
    cached ??= import('../../../services/studioMixService');
    return cached;
  };
})();
const loadAdminTabContent = () => import('../../features/admin/components/AdminTabContent');
const loadNovelTabContent = () => import('../../features/novel/components/NovelTabContent');
const loadVoiceCloningTabContent = () => import('../../features/voice-cloning/VoiceCloningTabContent');
const loadAudioPlayer = () => import('../../../components/AudioPlayer');
const LazyBlockScriptEditor = lazy(async () => {
  const module = await import('../../../components/studio/BlockScriptEditor');
  return { default: module.BlockScriptEditor };
});
const LazyStudioQueuePanel = lazy(async () => {
  const module = await import('../../../components/studio/StudioQueuePanel');
  return { default: module.StudioQueuePanel };
});
const loadStudioQueueAudioService = (() => {
  let cached: Promise<typeof import('../../../services/studioQueueAudioService')> | null = null;
  return () => {
    cached ??= import('../../../services/studioQueueAudioService');
    return cached;
  };
})();
const loadTtsVoiceRegistryService = (() => {
  let cached: Promise<typeof import('../../../services/ttsVoiceRegistryService')> | null = null;
  return () => {
    cached ??= import('../../../services/ttsVoiceRegistryService');
    return cached;
  };
})();
const loadTtsGatewayJobService = (() => {
  let cached: Promise<typeof import('../../../services/ttsGatewayJobService')> | null = null;
  return () => {
    cached ??= import('../../../services/ttsGatewayJobService');
    return cached;
  };
})();

const loadMediaBackendService = (() => {
  let cached: Promise<typeof import('../../../services/mediaBackendService')> | null = null;
  return () => {
    cached ??= import('../../../services/mediaBackendService');
    return cached;
  };
})();

/** Stub: backend routing is no longer needed (Cloud TTS). */
const clearNearestBackendRoutingState = (): void => {};
const applyNearestBackendRoutingOnLogin = async (_opts?: { signal?: AbortSignal }): Promise<void> => {};

export const findFirstRecoverableStudioQueueItem = (items: StudioQueueItem[]): StudioQueueItem | null => (
  [...items]
    .sort((left, right) => left.order - right.order)
    .find((item) => item.status === 'failed' || item.status === 'cancelled') || null
);

export const hasRecoverableSingleInflightGenerationState = (
  value: Pick<StudioSingleInflightGenerationLedger, 'requestId' | 'jobId'> | null | undefined
): boolean => {
  const requestId = String(value?.requestId || '').trim();
  const jobId = String(value?.jobId || '').trim();
  return Boolean(requestId || jobId);
};

export const normalizeStudioGenerationLedgerText = (value: string): string => (
  String(value || '').replace(/\s+/g, ' ').trim()
);

export const shouldResumeSingleGenerationFromLedger = (
  currentText: string,
  ledger: Pick<StudioSingleInflightGenerationLedger, 'requestId' | 'jobId' | 'textSnapshot'> | null | undefined
): boolean => {
  if (!hasRecoverableSingleInflightGenerationState(ledger)) return false;
  const normalizedLedgerText = normalizeStudioGenerationLedgerText(String(ledger?.textSnapshot || ''));
  if (!normalizedLedgerText) return true;
  const normalizedCurrentText = normalizeStudioGenerationLedgerText(currentText);
  if (!normalizedCurrentText) return true;
  return normalizedCurrentText === normalizedLedgerText;
};

const FRONTEND_PROXY_POLICY_PATTERNS = [
  'backend path is not allowed by proxy policy',
  'backend method is not allowed by proxy policy',
  'backend proxy requires authentication for write methods',
];

const RUNTIME_EXPLICIT_PERMISSION_SIGNAL_PATTERNS = [
  'uid_not_allowlisted',
  'missing permission',
  'permission denied',
  'ops.mutate',
  'x-admin-unlock',
  'admin session unlock',
  'admin-unlock',
];

const AUTH_OR_PROFILE_SIGNAL_PATTERNS = [
  'authentication required',
  'missing bearer token',
  'invalid auth token',
  'unauthorized',
  'status code 401',
  '(401)',
  'status code 428',
  '(428)',
  'complete your user id',
  'complete your userid',
  'requireduserid',
];

const BILLING_OR_QUOTA_SIGNAL_PATTERNS = [
  'billing',
  'checkout',
  'coupon',
  'low balance',
  'not enough vf',
  'rate limit',
  'quota',
];

const RESTRICTED_COPY_PATTERNS = [
  'this action is restricted for your account permissions.',
  'this action is restricted for your current account permissions.',
];

export const isFalseFrontendOnlyRuntimeRestriction = (input: {
  rawMessage?: unknown;
  publicMessage?: unknown;
}): boolean => {
  const raw = String(input.rawMessage || '').trim().toLowerCase();
  const publicCopy = String(input.publicMessage || '').trim().toLowerCase();
  if (!raw && !publicCopy) return false;

  if (FRONTEND_PROXY_POLICY_PATTERNS.some((token) => raw.includes(token))) {
    return true;
  }

  const hasRestrictedCopy = RESTRICTED_COPY_PATTERNS.some((token) => (
    raw.includes(token) || publicCopy.includes(token)
  ));
  if (!hasRestrictedCopy) return false;

  if (RUNTIME_EXPLICIT_PERMISSION_SIGNAL_PATTERNS.some((token) => raw.includes(token))) {
    return false;
  }
  if (AUTH_OR_PROFILE_SIGNAL_PATTERNS.some((token) => raw.includes(token))) {
    return false;
  }
  if (BILLING_OR_QUOTA_SIGNAL_PATTERNS.some((token) => raw.includes(token))) {
    return false;
  }
  return true;
};

export const buildVoiceSampleSingleFlightKey = (
  voiceId: string,
  engine: GenerationSettings['engine'] = 'PRIME'
): string => {
  const normalizedEngine = resolveEngineToken(engine);
  const normalizedVoiceId = String(voiceId || '').trim();
  return `${normalizedEngine}:${normalizedVoiceId}`;
};

const normalizeStoredSingleInflightGenerationLedger = (
  value: unknown
): StudioSingleInflightGenerationLedger | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StudioSingleInflightGenerationLedger>;
  if (candidate.mode !== 'single') return null;
  const requestId = String(candidate.requestId || '').trim();
  const jobId = String(candidate.jobId || '').trim();
  if (!hasRecoverableSingleInflightGenerationState({ requestId, jobId })) return null;
  const textSnapshot = String(candidate.textSnapshot || '');
  const startedAtMs = Number(candidate.startedAtMs || 0);
  return {
    mode: 'single',
    ...(requestId ? { requestId } : {}),
    ...(jobId ? { jobId } : {}),
    textSnapshot,
    startedAtMs: Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs : Date.now(),
  };
};

const TTS_GATEWAY_JOB_PROGRESS_EVENT = 'voiceflow:tts-gateway-job-progress';
const TTS_GATEWAY_AUDIO_CHUNK_EVENT = 'voiceflow:tts-gateway-audio-chunk';
const TTS_RUNTIME_DIAGNOSTICS_EVENT = 'voiceflow:tts-runtime-diagnostics';

const AdminTabContent = lazy(async () => loadAdminTabContent().then((module) => ({ default: module.AdminTabContent })));
const NovelTabContent = lazy(async () => loadNovelTabContent().then((module) => ({ default: module.NovelTabContent })));
const VoiceCloningTabContent = lazy(async () => loadVoiceCloningTabContent().then((module) => ({ default: module.VoiceCloningTabContent })));
const VoiceCloneModal = lazy(async () => import('../../features/voice-cloning/VoiceCloneModal').then((module) => ({ default: module.VoiceCloneModal })));
const AudioPlayer = lazy(async () => loadAudioPlayer().then((module) => ({ default: module.AudioPlayer })));

const readBooleanEnv = (value: unknown, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const ENABLE_RESOURCE_MONITOR = readBooleanEnv(process.env.NEXT_PUBLIC_ENABLE_RESOURCE_MONITOR ?? process.env.VITE_ENABLE_RESOURCE_MONITOR, process.env.NODE_ENV !== 'production');
const ENABLE_RESOURCE_MONITOR_LONGTASK = readBooleanEnv(process.env.NEXT_PUBLIC_ENABLE_RESOURCE_MONITOR_LONGTASK ?? process.env.VITE_ENABLE_RESOURCE_MONITOR_LONGTASK, false);

const TAB_PRELOADERS: Partial<Record<Tab, () => Promise<unknown>>> = {
  [Tab.ADMIN]: loadAdminTabContent,
  [Tab.NOVEL]: loadNovelTabContent,
  [Tab.VOICE_CLONING]: loadVoiceCloningTabContent,
};

const loadGeminiService = (() => {
  let cached: Promise<typeof import('../../../services/geminiService')> | null = null;
  return () => {
    cached ??= import('../../../services/geminiService');
    return cached;
  };
})();

interface MainAppProps {
  setScreen: (screen: AppScreen) => void;
}

interface SpeakerVcReference {
  referenceArtifactId?: string | undefined;
  referenceAudioUrl: string;
  referenceAudioName: string;
  sourceVoiceId: string;
  sourceVoiceName: string;
  sourceVoiceEngine: string;
  consumedVcUnits: number;
  updatedAt: number;
}

type SpeakerVcReferenceStore = Record<string, Record<string, SpeakerVcReference>>;

const SPEAKER_VC_REFERENCE_OWNER_GUEST = '__guest__';
const MAX_SPEAKER_VC_REFERENCE_ENTRIES = 64;

const normalizeSpeakerVcReferenceMap = (value: unknown): Record<string, SpeakerVcReference> => {
  if (!value || typeof value !== 'object') return {};
  const next: Record<string, SpeakerVcReference> = {};
  Object.entries(value as Record<string, unknown>).forEach(([rawKey, rawValue]) => {
    const speakerKey = normalizeSpeakerMapKey(String(rawKey || '').trim());
    if (!speakerKey || !rawValue || typeof rawValue !== 'object') return;
    const payload = rawValue as Record<string, unknown>;
    const referenceAudioUrl = String(payload.referenceAudioUrl || '').trim();
    if (!referenceAudioUrl) return;
    next[speakerKey] = {
      referenceArtifactId: String(payload.referenceArtifactId || '').trim() || undefined,
      referenceAudioUrl,
      referenceAudioName: String(payload.referenceAudioName || 'reference.wav').trim() || 'reference.wav',
      sourceVoiceId: String(payload.sourceVoiceId || '').trim(),
      sourceVoiceName: String(payload.sourceVoiceName || '').trim(),
      sourceVoiceEngine: String(payload.sourceVoiceEngine || '').trim(),
      consumedVcUnits: Math.max(0, Number(payload.consumedVcUnits || 0)),
      updatedAt: Math.max(0, Number(payload.updatedAt || Date.now())),
    };
    if (Object.keys(next).length >= MAX_SPEAKER_VC_REFERENCE_ENTRIES) return;
  });
  return next;
};

const hasSpeakerVcReferencePayloadShape = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return typeof (entry as Record<string, unknown>).referenceAudioUrl === 'string';
  });
};

type UiTheme = 'light' | 'dark' | 'system';
type UiMotionLevel = 'off' | 'balanced' | 'rich';
type EngineRuntimeState = EngineRuntimeUiState;

const UI_FONT_SCALE_DEFAULT = 1;

const STUDIO_OBJECT_URL_REGISTRY_MAX = 64;
const STUDIO_SINGLE_RUN_CHAR_CAP = 8000;
const STUDIO_EDITOR_HARD_CAP = 50000;
const STUDIO_DRAFT_PERSIST_DEBOUNCE_MS = 450;
const STUDIO_QUEUE_INTER_PART_DELAY_MS = 3000;
const TRANSIENT_GENERATION_RETRY_MAX = 1;
const TRANSIENT_GENERATION_RETRY_DELAY_MS = 700;
const SINGLE_INFLIGHT_AUTO_RESUME_MAX_AGE_MS = 10 * 60 * 1000;
const GENERATION_STALL_TIMEOUT_MS = 90000;
const VOICE_GENERATION_DELAY_NOTICE = "Voice generation may take a little longer right now. We'll start it as soon as a server is free.";
const RUNTIME_AUTO_SELECT_SESSION_FLAG = 'vf_runtime_auto_select_lowest_engine_v4';
const DEV_SESSION_HEARTBEAT_ENDPOINT = '/api/dev/session';
const DEV_SESSION_HEARTBEAT_INTERVAL_MS = 15000;
const DEV_SESSION_STORAGE_KEY = 'vf_dev_session_id_v1';
const DEV_SESSION_LAST_HEARTBEAT_AT_KEY = 'vf_dev_session_heartbeat_at_v1';

const hasRuntimeAutoSelectSessionRun = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(RUNTIME_AUTO_SELECT_SESSION_FLAG) === '1';
  } catch {
    return false;
  }
};

const markRuntimeAutoSelectSessionRun = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(RUNTIME_AUTO_SELECT_SESSION_FLAG, '1');
  } catch {
    // no-op
  }
};

const clearRuntimeAutoSelectSessionRun = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(RUNTIME_AUTO_SELECT_SESSION_FLAG);
  } catch {
    // no-op
  }
};

const createDevSessionId = (): string =>
  `vf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const RETRYABLE_GENERATION_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_GENERATION_TOKENS = [
  'chunk_failed',
  'generation_failed',
  'poll_failed',
  'upstream',
  'timeout',
  'timed out',
  'rate limit',
  'quota',
  'capacity',
  'overload',
];
const NON_RETRYABLE_GENERATION_TOKENS = [
  'authentication',
  'unauthorized',
  'forbidden',
  'missing bearer token',
  'invalid auth token',
  'requireduserid',
  'required user id',
  'billing',
  'insufficient',
  'wallet',
  'balance',
];

const shouldRetryTransientGenerationError = (errorLike: unknown): boolean => {
  const candidate = errorLike as {
    detail?: Record<string, unknown>;
    cause?: { status?: number; statusCode?: number };
    status?: number;
    statusCode?: number;
    message?: string;
  };
  const detail = (candidate?.detail && typeof candidate.detail === 'object')
    ? candidate.detail
    : {};
  if (detail.retryable === true) return true;

  const statusCode = Number(
    candidate?.statusCode
    || candidate?.status
    || candidate?.cause?.statusCode
    || candidate?.cause?.status
    || detail.statusCode
    || 0
  );
  if (RETRYABLE_GENERATION_STATUS_CODES.has(statusCode)) return true;
  if (statusCode >= 400 && statusCode < 500) return false;

  const combined = sanitizeUiText(
    [
      candidate?.message,
      detail.code,
      detail.reason,
      detail.message,
      detail.error,
      detail.errorCode,
      detail.classification,
    ]
      .map((value) => String(value || '').trim())
      .filter((value) => value.length > 0)
      .join(' ')
      .toLowerCase()
  );
  if (!combined) return false;
  if (NON_RETRYABLE_GENERATION_TOKENS.some((token) => combined.includes(token))) {
    return false;
  }
  return RETRYABLE_GENERATION_TOKENS.some((token) => combined.includes(token));
};

const createAbortError = (): Error => {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
};

const throwIfSignalAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const waitForAbortableDelay = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  const safeDelayMs = Math.max(0, Math.floor(Number(delayMs || 0)));
  throwIfSignalAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timerId = window.setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, safeDelayMs);
    const onAbort = () => {
      window.clearTimeout(timerId);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
};

const awaitAbortablePromise = async <T,>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  throwIfSignalAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
};

type EngineRuntimeStatus = EngineRuntimeUiStatus;
type SelectedEngineTelemetryKind = 'pending' | 'network' | 'local' | 'error';

interface SelectedEngineTelemetry {
  kind: SelectedEngineTelemetryKind;
  label: string;
  detail: string;
  latencyMs: number | null;
  measuredAtMs: number;
  samples: number[];
}

const createSelectedEngineTelemetry = (
  overrides: Partial<SelectedEngineTelemetry> = {}
): SelectedEngineTelemetry => ({
  kind: 'pending',
  label: 'Pending',
  detail: 'Latency probe pending.',
  latencyMs: null,
  measuredAtMs: 0,
  samples: [],
  ...overrides,
});

const createInitialSelectedEngineTelemetry = (): Record<ActiveTtsEngineKey, SelectedEngineTelemetry> => ({
  PRIME: createSelectedEngineTelemetry(),
  VECTOR: createSelectedEngineTelemetry(),
});

const ENGINE_RUNTIME_STATE_SET: ReadonlySet<EngineRuntimeState> = new Set([
  'checking',
  'starting',
  'warming',
  'online',
  'offline',
  'not_configured',
  'standby',
]);

const normalizeEngineRuntimeState = (
  rawState: unknown,
  fallback: EngineRuntimeState = 'offline'
): EngineRuntimeState => {
  const token = String(rawState || '').trim().toLowerCase() as EngineRuntimeState;
  return ENGINE_RUNTIME_STATE_SET.has(token) ? token : fallback;
};

const cleanRuntimeMetadataField = (value: unknown): string => String(value || '').trim();

const mergeRuntimeStatus = (
  current: EngineRuntimeStatus | undefined,
  patch: Partial<EngineRuntimeStatus>
): EngineRuntimeStatus => {
  const state = patch.state ?? current?.state ?? 'offline';
  const detail = sanitizeUiText(String(patch.detail ?? current?.detail ?? 'Runtime status updated.')) || 'Runtime status updated.';
  return {
    state,
    detail,
    provider: cleanRuntimeMetadataField(patch.provider ?? current?.provider),
    lane: cleanRuntimeMetadataField(patch.lane ?? current?.lane),
    selectedRegion: cleanRuntimeMetadataField(patch.selectedRegion ?? current?.selectedRegion),
    modelId: cleanRuntimeMetadataField(patch.modelId ?? current?.modelId),
    runtimeUrl: cleanRuntimeMetadataField(patch.runtimeUrl ?? current?.runtimeUrl),
    healthUrl: cleanRuntimeMetadataField(patch.healthUrl ?? current?.healthUrl),
    cloudTtsLocation: cleanRuntimeMetadataField(patch.cloudTtsLocation ?? current?.cloudTtsLocation),
    vertexLocation: cleanRuntimeMetadataField(patch.vertexLocation ?? current?.vertexLocation),
    regionHint: cleanRuntimeMetadataField(patch.regionHint ?? current?.regionHint),
    regionSource: cleanRuntimeMetadataField(patch.regionSource ?? current?.regionSource),
  };
};

interface RuntimeAccessProbe {
  ok: boolean;
  detail: string;
  checkedAt: number;
}

interface TtsAccessState {
  blocked: boolean;
  detail: string;
  checkedAt: number;
}

interface RuntimeDiagnosticsEventDetail {
  traceId?: string;
  engine?: string;
  runtimeLabel?: string;
  retryChunks?: number;
  qualityGuardRecoveries?: number;
  splitChunks?: number;
  recoveryUsed?: boolean;
}

interface GatewayJobProgressEventDetail {
  jobId?: string;
  requestId?: string;
  status?: string;
  engine?: string;
  queueAgeMs?: number;
  queueDepth?: number;
  stage?: string;
  progressPct?: number;
  selectedRegion?: string;
  cloudTtsLocation?: string;
  vertexLocation?: string;
  regionHint?: string;
  regionSource?: string;
}

interface GatewayAudioChunkEventDetail {
  jobId?: string;
  requestId?: string;
  index?: number;
  engine?: string;
  contentType?: string;
  durationMs?: number;
  textChars?: number;
  traceId?: string;
  speakerId?: string;
  voiceId?: string;
  turnIndex?: number;
  sessionEpoch?: number;
  resumeAttempt?: number;
  fallbackUsed?: boolean;
  speakerIndex?: number;
  dialogIndex?: number | null;
  dialogChunkIndex?: number;
  stageIndex?: number;
  stageCharCap?: number;
  audioBase64?: string;
  audioObjectUrl?: string;
}

interface LiveAudioChunkItem {
  jobId: string;
  index: number;
  engine: string;
  contentType: string;
  durationMs: number;
  textChars: number;
  traceId: string;
  speakerId?: string;
  voiceId?: string;
  turnIndex?: number;
  sessionEpoch?: number;
  resumeAttempt?: number;
  fallbackUsed?: boolean;
  speakerIndex?: number;
  dialogIndex?: number | null;
  dialogChunkIndex?: number;
  stageIndex?: number;
  stageCharCap?: number;
  audioBase64?: string;
  audioObjectUrl?: string;
}

const LIVE_AUDIO_CHUNK_STATE_CAP = 48;

interface GenerationTimingSnapshot {
  mode: 'single' | 'queue';
  startedAtMs: number;
  firstAudioAtMs: number;
  completedAtMs: number;
  timeToFirstAudioMs: number;
  totalGenerationMs: number;
  partCount?: number;
  partDurationsMs?: number[];
  coldStart?: boolean;
}

type AssistantApplyMode = 'replace' | 'append';

interface AssistantRequestOptions {
  applyToEditor?: boolean;
  applyMode?: AssistantApplyMode;
  historyText?: string;
}

interface AssistantQuickAction {
  id: string;
  label: string;
  prompt: string;
  applyToEditor: boolean;
  applyMode: AssistantApplyMode;
  requiresContext?: boolean;
}

type HealthSeverity = 'ok' | 'warn' | 'error';

interface BackendHealthState {
  ok: boolean;
  summary: string;
  severity: HealthSeverity;
}

const ENGINE_ORDER: ActiveTtsEngineKey[] = ['VECTOR', 'PRIME'];
const FALLBACK_RUNTIME_URLS: Record<ActiveTtsEngineKey, string> = {
  PRIME: 'http://127.0.0.1:7810',
  VECTOR: 'http://127.0.0.1:7810',
};
const SIMULATED_GENERATION_TICK_MS = 200;
const EMPTY_RUNTIME_CATALOG: Record<ActiveTtsEngineKey, VoiceOption[]> = { PRIME: [], VECTOR: [] };
const DEFAULT_GEM_VOICE_ID = VOICES[0]?.id ?? 'gem_default_voice';
const BUILT_IN_VOICE_IDS = new Set([...VOICES.map((voice) => voice.id)]);
const FREE_TIER_ALLOWED_VOICE_IDS: Record<ActiveTtsEngineKey, string[]> = {
  PRIME: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  VECTOR: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
};
const STUDIO_CUSTOM_MUSIC_TRACK_ID = 'm_custom_upload';
const STUDIO_CUSTOM_MUSIC_MAX_FILE_BYTES = 40 * 1024 * 1024;
const STUDIO_CUSTOM_MUSIC_FILE_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac';

type CustomStudioMusicTrackUpload = {
  name: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
};

const DEFAULT_SETTINGS: GenerationSettings = {
  voiceId: DEFAULT_GEM_VOICE_ID,
  speed: 1.0,
  pitch: 'Medium',
  language: 'Auto',
  emotion: 'Neutral',
  style: 'default',
  emotionRefId: '',
  emotionStrength: 0.35,
  engine: 'PRIME',
  helperProvider: 'GEMINI',
  assistantProviderControlsEnabled: false,
  preferUserGeminiKey: false,
  perplexityApiKey: '',
  localLlmUrl: 'http://localhost:5000',
  geminiApiKey: '',
  backendApiKey: '',
  voiceModel: '',
  geminiTtsServiceUrl: FALLBACK_RUNTIME_URLS.PRIME,
  uiMotionLevel: 'rich',

  musicTrackId: 'm_none',
  musicVolume: 0.3,
  speechVolume: 1.0,
  autoEnhance: true,
  useModelSourceSeparation: true,
  preserveDubVoiceTone: false,
  multiSpeakerEnabled: true,
  speakerMapping: {},
  autoPlayGeneratedAudio: true,
};

const normalizeServiceSetting = (value: unknown, fallback: string): string => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const normalizeSettings = (input: unknown): GenerationSettings => {
  const value = (input && typeof input === 'object') ? input as Record<string, any> : {};
  const engine = normalizeEngineToken(value.engine, DEFAULT_SETTINGS.engine);
  const defaultVoice = DEFAULT_GEM_VOICE_ID;
  const rawMusicTrackId = typeof value.musicTrackId === 'string'
    ? value.musicTrackId.trim()
    : DEFAULT_SETTINGS.musicTrackId;
  const hasBuiltInMusicTrack = MUSIC_TRACKS.some((track) => track.id === rawMusicTrackId);
  const normalizedMusicTrackId = (
    rawMusicTrackId === STUDIO_CUSTOM_MUSIC_TRACK_ID || hasBuiltInMusicTrack
  )
    ? rawMusicTrackId
    : DEFAULT_SETTINGS.musicTrackId;
  const normalized: GenerationSettings = {
    ...DEFAULT_SETTINGS,
    ...value,
    engine,
    voiceId: typeof value.voiceId === 'string' && value.voiceId.trim() ? value.voiceId : defaultVoice,
    speed: typeof value.speed === 'number' ? value.speed : DEFAULT_SETTINGS.speed,
    pitch: value.pitch === 'Low' || value.pitch === 'Medium' || value.pitch === 'High' ? value.pitch : DEFAULT_SETTINGS.pitch,
    language: typeof value.language === 'string' && value.language.trim() ? value.language : DEFAULT_SETTINGS.language,
    emotion: normalizeEmotionTag(String(value.emotion || '')) || (typeof value.emotion === 'string' && value.emotion.trim() ? value.emotion : DEFAULT_SETTINGS.emotion),
    helperProvider: 'GEMINI',
    assistantProviderControlsEnabled: normalizeAssistantProviderControlsEnabled(
      value.assistantProviderControlsEnabled,
      DEFAULT_SETTINGS.assistantProviderControlsEnabled !== false,
    ),
    preferUserGeminiKey: normalizePreferUserGeminiKey(
      value.preferUserGeminiKey,
      DEFAULT_SETTINGS.preferUserGeminiKey === true,
    ),
    geminiApiKey: typeof value.geminiApiKey === 'string' ? value.geminiApiKey.trim() : DEFAULT_SETTINGS.geminiApiKey,
    perplexityApiKey: typeof value.perplexityApiKey === 'string' ? value.perplexityApiKey.trim() : DEFAULT_SETTINGS.perplexityApiKey,
    localLlmUrl: typeof value.localLlmUrl === 'string' && value.localLlmUrl.trim() ? value.localLlmUrl.trim() : DEFAULT_SETTINGS.localLlmUrl,
    speakerMapping: (value.speakerMapping && typeof value.speakerMapping === 'object') ? value.speakerMapping : {},
    style: typeof value.style === 'string' ? value.style : DEFAULT_SETTINGS.style,
    emotionRefId: typeof value.emotionRefId === 'string' ? value.emotionRefId : DEFAULT_SETTINGS.emotionRefId,
    emotionStrength: typeof value.emotionStrength === 'number' ? value.emotionStrength : DEFAULT_SETTINGS.emotionStrength,
    musicTrackId: normalizedMusicTrackId,
    musicVolume: resolveStudioMusicGain(value.musicVolume),
    speechVolume: resolveStudioSpeechGain(value.speechVolume),
    useModelSourceSeparation: typeof value.useModelSourceSeparation === 'boolean'
      ? value.useModelSourceSeparation
      : DEFAULT_SETTINGS.useModelSourceSeparation,
    preserveDubVoiceTone: typeof value.preserveDubVoiceTone === 'boolean'
      ? value.preserveDubVoiceTone
      : DEFAULT_SETTINGS.preserveDubVoiceTone,
  uiMotionLevel:
    value.uiMotionLevel === 'off' || value.uiMotionLevel === 'balanced' || value.uiMotionLevel === 'rich'
      ? value.uiMotionLevel
    : (DEFAULT_SETTINGS.uiMotionLevel || 'rich'),
    multiSpeakerEnabled: typeof value.multiSpeakerEnabled === 'boolean'
      ? value.multiSpeakerEnabled
      : DEFAULT_SETTINGS.multiSpeakerEnabled,
    backendApiKey: typeof value.backendApiKey === 'string' ? value.backendApiKey.trim() : DEFAULT_SETTINGS.backendApiKey,
    voiceModel: typeof value.voiceModel === 'string' ? value.voiceModel : DEFAULT_SETTINGS.voiceModel,
    geminiTtsServiceUrl: normalizeServiceSetting(value.geminiTtsServiceUrl, DEFAULT_SETTINGS.geminiTtsServiceUrl || FALLBACK_RUNTIME_URLS.PRIME),
    autoPlayGeneratedAudio: typeof value.autoPlayGeneratedAudio === 'boolean'
      ? value.autoPlayGeneratedAudio
      : (DEFAULT_SETTINGS.autoPlayGeneratedAudio !== false),
  };

  const validVoiceIds = new Set([
    ...VOICES.map(v => v.id),
    ...((value.clonedVoices || []) as any[]).map(v => v?.id).filter(Boolean),
  ]);

  if (!validVoiceIds.has(normalized.voiceId)) {
    normalized.voiceId = defaultVoice;
  }

  return normalized;
};

const stripSensitiveSettingsForStorage = (value: GenerationSettings): GenerationSettings => ({
  ...value,
  geminiApiKey: '',
  perplexityApiKey: '',
  backendApiKey: '',
  preferUserGeminiKey: false,
});

const formatGenerationDuration = (ms: number): string => {
  const safeMs = Math.max(0, Math.floor(Number(ms) || 0));
  const totalSeconds = Math.round(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

// --- SYSTEM RESOURCE MONITOR ---
const ResourceMonitor = ({ isWorking, hidden = false }: { isWorking: boolean; hidden?: boolean }) => {
  const [stats, setStats] = useState({
    cpu: 0,
    ram: 0,
    cpuHistory: Array(20).fill(4) as number[],
    ramHistory: Array(20).fill(0) as number[],
  });

  useEffect(() => {
    if (hidden) return undefined;

    let intervalId: number | null = null;
    let longTaskDurationSinceTick = 0;
    let previousTickAt = performance.now();
    let previousRamUsageMb = 0;
    let longTaskObserver: PerformanceObserver | null = null;

    if (
      ENABLE_RESOURCE_MONITOR_LONGTASK
      && typeof window !== 'undefined'
      && typeof PerformanceObserver !== 'undefined'
    ) {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskDurationSinceTick += Math.max(0, Number(entry.duration) || 0);
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
      } catch {
        longTaskObserver = null;
      }
    }

    const runTick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const now = performance.now();
      const expectedCadenceMs = isWorking ? 2500 : 8000;
      const elapsedMs = Math.max(1, now - previousTickAt);
      const eventLoopLagMs = Math.max(0, elapsedMs - expectedCadenceMs);

      const perfWithMemory = performance as Performance & {
        memory?: { usedJSHeapSize?: number };
      };
      const heapBytes = Number(perfWithMemory.memory?.usedJSHeapSize || 0);
      const ramUsage = heapBytes > 0 ? Math.round(heapBytes / 1024 / 1024) : 0;
      const heapDeltaMb = previousRamUsageMb > 0 ? Math.max(0, ramUsage - previousRamUsageMb) : 0;
      if (ramUsage > 0) {
        previousRamUsageMb = ramUsage;
      }

      const longTaskRatio = Math.min(1, longTaskDurationSinceTick / elapsedMs);
      const lagRatio = Math.min(1, eventLoopLagMs / Math.max(24, expectedCadenceMs * 0.4));
      const heapTrendRatio = Math.min(1, heapDeltaMb / 24);
      const workloadBias = isWorking ? 0.16 : 0.03;
      const cpuSignalPct = (
        (longTaskRatio * 0.52)
        + (lagRatio * 0.30)
        + (heapTrendRatio * 0.18)
        + workloadBias
      ) * 100;
      longTaskDurationSinceTick = 0;
      previousTickAt = now;

      setStats((previous) => {
        const smoothedCpu = Math.max(1, Math.min(100, Math.round((previous.cpu * 0.62) + (cpuSignalPct * 0.38))));
        return {
          ...previous,
          ram: ramUsage,
          cpu: smoothedCpu,
          cpuHistory: [...previous.cpuHistory.slice(-19), smoothedCpu],
          ramHistory: [...previous.ramHistory.slice(-19), ramUsage],
        };
      });
    };

    const startPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      previousTickAt = performance.now();
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      const cadenceMs = isWorking ? 2500 : 8000;
      intervalId = window.setInterval(runTick, cadenceMs);
      runTick();
    };

    const onVisibilityChange = () => {
      startPolling();
    };

    startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      longTaskObserver?.disconnect();
    };
  }, [hidden, isWorking]);

  if (hidden) return null;

  return (
    <div className="pointer-events-none fixed bottom-3 left-[calc(16rem+0.75rem)] z-40 hidden select-none xl:flex items-center gap-2 rounded-full border border-slate-300/70 bg-slate-950/82 px-2.5 py-1.5 text-[9px] font-mono text-slate-200 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-1.5" title="Browser CPU signal (long tasks, event-loop lag, and heap trend)">
            <Activity size={10} className={isWorking ? "text-amber-400 animate-pulse" : "text-slate-400"} />
            <span>CPU {stats.cpu}%</span>
            <TelemetrySparkline
              values={stats.cpuHistory}
              compact
              colorClassName={isWorking ? 'text-amber-300' : 'text-slate-400'}
              glow={isWorking}
              title="Browser CPU pressure trend"
            />
        </div>
        <div className="h-2.5 w-px bg-slate-600"></div>
        <div className="flex items-center gap-1.5" title="JS heap usage">
            <Cpu size={10} className="text-slate-400" />
            <span>RAM {stats.ram > 0 ? `${stats.ram}M` : '--'}</span>
            <TelemetrySparkline
              values={stats.ramHistory}
              compact
              colorClassName="text-cyan-300"
              title="RAM trend"
            />
        </div>
    </div>
  );
};

export const MainApp: React.FC<MainAppProps> = ({ setScreen }) => {
  const {
    stats,
    setShowSubscriptionModal,
    addToHistory,
    history,
    loadHistory,
    clearHistory,
    user,
    clonedVoices,
    addClonedVoice,
    characterLibrary,
    updateCharacter,
    deleteCharacter,
    getVoiceForCharacter,
    syncCast,
    signOutUser,
    refreshEntitlements,
    isAdmin,
    hasUnlimitedAccess,
  } = useUser();
  const {
    emit,
    unreadCount,
    isCenterOpen,
    setCenterOpen,
  } = useNotifications();
  const { mode: viewportMode, width: viewportWidth, isPhone, isTablet, isDesktop } = useWorkspaceViewport();
  const [viewportHeight, setViewportHeight] = useState<number>(() => (
    typeof window === 'undefined' ? 0 : Math.max(0, Math.round(window.innerHeight || 0))
  ));
  const isLargeDesktop = viewportWidth >= 1600;
  const isUltraWideDesktop = viewportWidth >= 2048;
  const isNarrowDesktop = isDesktop && viewportWidth < 1152;
  const isShortPhone = isPhone && viewportHeight > 0 && viewportHeight <= 860;
  const hasSessionIdentity = Boolean(String(user.uid || '').trim());
  const hasAdminConsoleAccess = useMemo(() => canUseAdminConsole(user), [user]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let frameId = 0;
    const syncViewportHeight = () => {
      const nextViewportHeight = Math.max(0, Math.round(window.innerHeight || 0));
      setViewportHeight((previous) => (previous === nextViewportHeight ? previous : nextViewportHeight));
    };
    const scheduleViewportSync = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncViewportHeight);
    };

    syncViewportHeight();
    window.addEventListener('resize', scheduleViewportSync, { passive: true });
    window.addEventListener('orientationchange', scheduleViewportSync, { passive: true });
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleViewportSync);
      window.removeEventListener('orientationchange', scheduleViewportSync);
    };
  }, []);

  const [hasWorkspaceInteracted, setHasWorkspaceInteracted] = useState(false);

  useEffect(() => {
    if (hasWorkspaceInteracted || typeof window === 'undefined') return undefined;

    let interactionTimerId: number | null = null;
    const markInteracted = () => {
      interactionTimerId = window.setTimeout(() => {
        setHasWorkspaceInteracted(true);
      }, 0);
    };

    window.addEventListener('pointerdown', markInteracted, { passive: true, once: true });
    window.addEventListener('keydown', markInteracted, { passive: true, once: true });
    window.addEventListener('touchstart', markInteracted, { passive: true, once: true });
    return () => {
      if (interactionTimerId !== null) {
        window.clearTimeout(interactionTimerId);
      }
      window.removeEventListener('pointerdown', markInteracted);
      window.removeEventListener('keydown', markInteracted);
      window.removeEventListener('touchstart', markInteracted);
    };
  }, [hasWorkspaceInteracted]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onCharacterSyncWarning = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      const message = String(detail?.message || '').trim();
      if (!message) return;
      emit('custom.message', {
        title: 'Voice Preset',
        message,
        severity: 'warning',
        category: 'activity',
        channel: 'toast',
        dedupeKey: `voice-preset-sync-warning:${message.toLowerCase()}`,
      });
    };
    window.addEventListener(USER_CONTEXT_CHARACTER_SYNC_WARNING_EVENT, onCharacterSyncWarning as EventListener);
    return () => {
      window.removeEventListener(USER_CONTEXT_CHARACTER_SYNC_WARNING_EVENT, onCharacterSyncWarning as EventListener);
    };
  }, [emit]);
  
  // --- State ---
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<Tab>(() => resolveWorkspaceTabFromPathname(pathname) || Tab.STUDIO);
  const isStudioWorkspaceTab = activeTab === Tab.STUDIO;
  const isNovelWorkspaceTab = activeTab === Tab.NOVEL;
  const shouldHydrateStudioWorkspaceStateOnInit = isStudioWorkspaceTab;
  const [initialAdminOpsTab, setInitialAdminOpsTab] = useState<AdminOpsTab>(resolveAdminOpsTabFromUrl);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => (
    resolveSidebarMode(readStorageString(STORAGE_KEYS.studioSidebarMode))
  ));
  const [isCreditsSurfaceOpen, setIsCreditsSurfaceOpen] = useState(false);
  const [studioRailTab, setStudioRailTab] = useState<StudioRailTab>(() => (
    resolveStudioRailTab(readStorageString(STORAGE_KEYS.studioRailTab))
  ));
  const [mountedWorkspaceTabs, setMountedWorkspaceTabs] = useState<Partial<Record<Tab, true>>>(() => ({
    [activeTab]: true,
  }));
  
  // Studio Text State
  const [text, setText] = useState<string>(() => (
    shouldHydrateStudioWorkspaceStateOnInit
      ? resolveInitialStudioDraftText(STUDIO_EDITOR_HARD_CAP)
      : ''
  ));
  
  // Settings State
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    const saved = readStorageJson(STORAGE_KEYS.settings);
    return normalizeSettings(saved || DEFAULT_SETTINGS);
  });
  const adminApiBaseUrl = resolveApiBaseUrl();
  const studioApiBaseUrl = API_ROUTE_FAMILIES.studio;
  const deferredSettings = useDeferredValue(settings);
  const authenticatedUserId = String(user.uid || '').trim();
  const speakerVcReferenceOwnerKey = useMemo(() => {
    const uidToken = String(user.uid || '').trim();
    if (uidToken) return `uid:${uidToken.toLowerCase()}`;
    const emailToken = String(user.email || '').trim();
    if (emailToken) return `email:${emailToken.toLowerCase()}`;
    return SPEAKER_VC_REFERENCE_OWNER_GUEST;
  }, [user.email, user.uid]);
  const settingsAuthOwnerRef = useRef<string>('');
  const settingsAuthInitializedRef = useRef(false);

  useEffect(() => {
    if (settingsAuthInitializedRef.current && settingsAuthOwnerRef.current !== authenticatedUserId) {
      return;
    }
    writeStorageJson(STORAGE_KEYS.settings, deferredSettings);
  }, [authenticatedUserId, deferredSettings]);
  useEffect(() => {
    if (!settingsAuthInitializedRef.current) {
      settingsAuthOwnerRef.current = authenticatedUserId;
      settingsAuthInitializedRef.current = true;
      return;
    }
    if (settingsAuthOwnerRef.current === authenticatedUserId) return;
    settingsAuthOwnerRef.current = authenticatedUserId;
    setSettings((previous) => stripSensitiveSettingsForStorage(previous));
  }, [authenticatedUserId]);

  // Generation Status State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgressState] = useState(0);
  const timeLeftRef = useRef(0);
  const processingStageRef = useRef('');
  const [generationTiming, setGenerationTiming] = useState<GenerationTimingSnapshot | null>(null);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [liveAudioChunks, setLiveAudioChunks] = useState<LiveAudioChunkItem[]>([]);
  const [studioQueueState, setStudioQueueState] = useState<StudioQueueState | null>(() => (
    shouldHydrateStudioWorkspaceStateOnInit
      ? normalizeStoredStudioQueueState(readStorageJson(STORAGE_KEYS.studioQueue))
      : null
  ));
  const [studioQueueAudioUrls, setStudioQueueAudioUrls] = useState<Record<string, string>>({});
  
  // Abort Controller for Cancellation
  const generationAbortController = useRef<AbortController | null>(null);
  const generationAbortReasonRef = useRef<'' | 'manual' | 'stall'>('');
  const generationRunStartedAtRef = useRef<number>(0);
  const generationFirstAudioAtRef = useRef<number>(0);
  const generationStopResetTimerRef = useRef<number | null>(null);
  const queueItemTimingRef = useRef<Record<string, { startedAtMs: number; firstAudioAtMs: number }>>({});
  const generationActivityAtRef = useRef<number>(0);
  const generationWatchdogTimerRef = useRef<number | null>(null);
  const seenRuntimeDiagnosticsTracesRef = useRef<Set<string>>(new Set());
  const setProgress = useCallback((value: React.SetStateAction<number>) => {
    startTransition(() => {
      setProgressState(value);
    });
  }, []);
  const setTimeLeft = useCallback((value: React.SetStateAction<number>) => {
    timeLeftRef.current = typeof value === 'function'
      ? (value as (previous: number) => number)(timeLeftRef.current)
      : value;
  }, []);
  const setProcessingStage = useCallback((value: string) => {
    processingStageRef.current = value;
  }, []);
  const activeGatewayRequestIdRef = useRef<string>('');
  const activeGatewayJobIdRef = useRef<string>('');
  const singleInflightLedgerRef = useRef<StudioSingleInflightGenerationLedger | null>(
    shouldHydrateStudioWorkspaceStateOnInit
      ? normalizeStoredSingleInflightGenerationLedger(readStorageJson(STORAGE_KEYS.studioSingleInflightGeneration))
      : null
  );
  const studioWorkspaceBootHydratedRef = useRef(shouldHydrateStudioWorkspaceStateOnInit);
  const singleInflightAutoResumeAttemptedRef = useRef(false);
  const backendRoutingRediscoveryInFlightRef = useRef(false);
  const backendRoutingRediscoveryLastAttemptAtRef = useRef(0);
  const seenLiveChunkKeysRef = useRef<Set<string>>(new Set());
  const studioQueueStateRef = useRef<StudioQueueState | null>(studioQueueState);
  const isStudioQueueRunActiveRef = useRef(false);
  const activeStudioQueueItemIdRef = useRef<string>('');
  const studioQueueAudioUrlsRef = useRef<Record<string, string>>({});
  const masterQueueAudioUrlRef = useRef<string | null>(null);
  const queueMasterRebuildTimerRef = useRef<number | null>(null);
  const studioQueueCooldownTimerRef = useRef<number | null>(null);
  const singleRunLockRef = useRef(false);
  const queueRunnerLockRef = useRef(false);
  const studioQueueAutoResumeAttemptedRef = useRef(false);
  const generationFailureBurstRef = useRef(0);
  const studioObjectUrlRegistryRef = useRef(
    createStudioObjectUrlRegistry({ maxTracked: STUDIO_OBJECT_URL_REGISTRY_MAX })
  );
  const lastRuntimeStatesRef = useRef<Record<ActiveTtsEngineKey, EngineRuntimeState>>({
    PRIME: 'checking',
    VECTOR: 'checking',
  });
  const lastBackendHealthyRef = useRef<boolean | null>(null);
  const quotaNoticeRef = useRef<Record<string, boolean>>({});
  const studioTextHardCapNoticeAtRef = useRef(0);
  const ttsAccessProbeRef = useRef<RuntimeAccessProbe | null>(null);
  const ttsAccessProbeInFlightRef = useRef<Promise<RuntimeAccessProbe> | null>(null);
  const ttsAccessProbeAbortControllerRef = useRef<AbortController | null>(null);
  const lastTtsAccessBlockedRef = useRef<boolean | null>(null);
  const ttsAccessClockRetryAtRef = useRef<number>(0);
  const ttsRequestSingleFlightRef = useRef<Map<string, Promise<AudioBuffer>>>(new Map());
  const runtimeAutoSelectProbeInFlightRef = useRef(false);
  const runtimeAutoSelectAbortControllerRef = useRef<AbortController | null>(null);
  const runtimeAutoSelectGenerationRef = useRef(0);
  const runtimeActivationRequestIdRef = useRef(0);

  const runSingleFlightTtsRequest = useCallback(async (
    requestId: string,
    run: () => Promise<AudioBuffer>
  ): Promise<AudioBuffer> => {
    const safeRequestId = String(requestId || '').trim();
    if (!safeRequestId) {
      return run();
    }

    const inFlight = ttsRequestSingleFlightRef.current.get(safeRequestId);
    if (inFlight) {
      return inFlight;
    }

    const pending = run().finally(() => {
      if (ttsRequestSingleFlightRef.current.get(safeRequestId) === pending) {
        ttsRequestSingleFlightRef.current.delete(safeRequestId);
      }
    });
    ttsRequestSingleFlightRef.current.set(safeRequestId, pending);
    return pending;
  }, []);

  useEffect(() => {
    if (!isStudioWorkspaceTab || studioWorkspaceBootHydratedRef.current) return;

    studioWorkspaceBootHydratedRef.current = true;
    const storedDraft = resolveInitialStudioDraftText(STUDIO_EDITOR_HARD_CAP);
    const storedQueueState = normalizeStoredStudioQueueState(readStorageJson(STORAGE_KEYS.studioQueue));
    const storedSingleInflightLedger = normalizeStoredSingleInflightGenerationLedger(
      readStorageJson(STORAGE_KEYS.studioSingleInflightGeneration)
    );

    setText((previous) => (previous.length > 0 ? previous : storedDraft));
    setStudioQueueState((previous) => previous ?? storedQueueState);
    singleInflightLedgerRef.current = storedSingleInflightLedger;
  }, [isStudioWorkspaceTab]);
  
  // Modals & Overlays
  const [showSettings, setShowSettings] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [isRedeemingCoupon, setIsRedeemingCoupon] = useState(false);
  const [isBuyingTokenPack, setIsBuyingTokenPack] = useState(false);
  const [selectedTokenPack, setSelectedTokenPack] = useState<TokenPackKey>('standard');
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [expandedHistoryItemKey, setExpandedHistoryItemKey] = useState<string | null>(null);
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => {
    const saved = readStorageString(STORAGE_KEYS.uiTheme);
    if (saved === 'dark') return 'dark';
    if (saved === 'light') return 'light';
    if (saved === 'system') return 'system';
    return 'dark';
  });
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');
  const [uiBrandTheme, setUiBrandTheme] = useState<UiBrandThemeId>(() => {
    const saved = readStorageString(STORAGE_KEYS.uiBrandTheme);
    return saved === 'aurora' || saved === 'sunset' || saved === 'emerald' || saved === 'neon' ? saved : 'neon';
  });
  const uiFontScale = UI_FONT_SCALE_DEFAULT;

  const setGeneratedAudioUrlManaged = useCallback((nextUrl: string | null) => {
    setGeneratedAudioUrl((previousUrl) => {
      studioObjectUrlRegistryRef.current.replace(previousUrl, nextUrl);
      return nextUrl;
    });
  }, []);
  const writeSingleInflightGenerationLedger = useCallback((nextLedger: StudioSingleInflightGenerationLedger | null) => {
    singleInflightLedgerRef.current = nextLedger;
    if (!nextLedger) {
      singleInflightAutoResumeAttemptedRef.current = false;
      removeStorageKey(STORAGE_KEYS.studioSingleInflightGeneration);
      return;
    }
    writeStorageJson(STORAGE_KEYS.studioSingleInflightGeneration, nextLedger);
  }, []);
  const clearSingleInflightGenerationLedger = useCallback(() => {
    writeSingleInflightGenerationLedger(null);
  }, [writeSingleInflightGenerationLedger]);
  const cancelRuntimeAutoSelectProbe = useCallback((options?: { lockSession?: boolean }) => {
    runtimeAutoSelectGenerationRef.current += 1;
    runtimeAutoSelectProbeInFlightRef.current = false;
    const activeProbe = runtimeAutoSelectAbortControllerRef.current;
    runtimeAutoSelectAbortControllerRef.current = null;
    if (activeProbe) {
      activeProbe.abort();
    }
    if (options?.lockSession) {
      markRuntimeAutoSelectSessionRun();
    }
  }, []);
  const patchSingleInflightGenerationLedger = useCallback((
    patch: Partial<StudioSingleInflightGenerationLedger>
  ): StudioSingleInflightGenerationLedger | null => {
    const current = singleInflightLedgerRef.current;
    const requestId = String(patch.requestId ?? current?.requestId ?? '').trim();
    const jobId = String(patch.jobId ?? current?.jobId ?? '').trim();
    const textSnapshot = normalizeStudioGenerationLedgerText(String(patch.textSnapshot ?? current?.textSnapshot ?? ''));
    if (!requestId && !jobId) return null;
    const nextLedger: StudioSingleInflightGenerationLedger = {
      mode: 'single',
      ...(requestId ? { requestId } : {}),
      ...(jobId ? { jobId } : {}),
      textSnapshot,
      startedAtMs: Number.isFinite(Number(patch.startedAtMs ?? current?.startedAtMs))
        ? Number(patch.startedAtMs ?? current?.startedAtMs)
        : Date.now(),
    };
    writeSingleInflightGenerationLedger(nextLedger);
    return nextLedger;
  }, [writeSingleInflightGenerationLedger]);
  const syncActiveGatewayIds = useCallback((requestId: string, jobId?: string) => {
    const safeRequestId = String(requestId || '').trim();
    const safeJobId = String(jobId || '').trim();
    activeGatewayRequestIdRef.current = safeRequestId;
    activeGatewayJobIdRef.current = safeJobId;
  }, []);
  const [uiMotionLevel, setUiMotionLevel] = useState<UiMotionLevel>(() => {
    const saved = readStorageString(STORAGE_KEYS.uiMotionLevel);
    if (saved === 'off' || saved === 'rich' || saved === 'balanced') return saved;
    const normalized = normalizeSettings(readStorageJson(STORAGE_KEYS.settings));
    if (normalized.uiMotionLevel === 'off' || normalized.uiMotionLevel === 'rich' || normalized.uiMotionLevel === 'balanced') {
      return normalized.uiMotionLevel;
    }
    return DEFAULT_SETTINGS.uiMotionLevel || 'rich';
  });

  // Editor Tools
  const [isAiWriting, setIsAiWriting] = useState(false);
  const [isStudioImporting, setIsStudioImporting] = useState(false);
  const [isAutoAssigningCast, setIsAutoAssigningCast] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);
  const [studioMobilePanels, setStudioMobilePanels] = useState({
    speaker: true,
    mix: false,
    multiSpeaker: false,
    cast: !isPhone,
    queue: false,
    live: false,
  });
  const [studioEditorMode, setStudioEditorMode] = useState<StudioEditorMode>(() => {
      const saved = readStorageString(STORAGE_KEYS.studioEditorMode);
      return saved === 'blocks' ? 'blocks' : 'raw';
  });
  const [studioDirectorModeState, setStudioDirectorModeState] = useState<StudioDirectorModeState>(DEFAULT_STUDIO_DIRECTOR_MODE_STATE);
  const [studioDirectorPreview, setStudioDirectorPreview] = useState<StudioDirectorPreviewState | null>(null);
  const [isStudioEditorFullscreen, setIsStudioEditorFullscreen] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const studioImportInputRef = useRef<HTMLInputElement>(null);
  const customMusicTrackInputRef = useRef<HTMLInputElement>(null);
  const customMusicTrackUploadRef = useRef<CustomStudioMusicTrackUpload | null>(null);
  const [customMusicTrackUpload, setCustomMusicTrackUpload] = useState<CustomStudioMusicTrackUpload | null>(null);
  const setCustomMusicTrackUploadManaged = useCallback((nextUpload: CustomStudioMusicTrackUpload | null) => {
    setCustomMusicTrackUpload((previousUpload) => {
      if (previousUpload?.url && previousUpload.url !== nextUpload?.url) {
        try {
          URL.revokeObjectURL(previousUpload.url);
        } catch {}
      }
      customMusicTrackUploadRef.current = nextUpload;
      return nextUpload;
    });
  }, []);
  const resolveCustomMusicTrackUrlForSettings = useCallback((runSettings: GenerationSettings): string => {
    const selectedTrackId = String(runSettings.musicTrackId || '').trim();
    if (selectedTrackId !== STUDIO_CUSTOM_MUSIC_TRACK_ID) return '';
    return String(customMusicTrackUploadRef.current?.url || '').trim();
  }, []);
  const studioMusicTrackOptions = useMemo(() => {
    const options = MUSIC_TRACKS.map((track) => ({
      id: track.id,
      label: `${track.name} (${track.category})`,
    }));
    if (settings.musicTrackId === STUDIO_CUSTOM_MUSIC_TRACK_ID || customMusicTrackUpload) {
      options.push({
        id: STUDIO_CUSTOM_MUSIC_TRACK_ID,
        label: customMusicTrackUpload
          ? `Custom Upload: ${customMusicTrackUpload.name}`
          : 'Custom Upload (re-upload required)',
      });
    }
    return options;
  }, [customMusicTrackUpload, settings.musicTrackId]);

  useEffect(() => {
    return () => {
      const currentUpload = customMusicTrackUploadRef.current;
      if (currentUpload?.url) {
        try {
          URL.revokeObjectURL(currentUpload.url);
        } catch {}
      }
      customMusicTrackUploadRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (settings.musicTrackId !== STUDIO_CUSTOM_MUSIC_TRACK_ID) return;
    if (customMusicTrackUploadRef.current?.url) return;
    setSettings((prev) => (
      prev.musicTrackId === STUDIO_CUSTOM_MUSIC_TRACK_ID
        ? { ...prev, musicTrackId: DEFAULT_SETTINGS.musicTrackId }
        : prev
    ));
  }, [settings.musicTrackId]);

  const toggleStudioMobilePanel = useCallback((panel: keyof typeof studioMobilePanels) => {
    setStudioMobilePanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  useEffect(() => {
    if (!isPhone) return;
    setStudioMobilePanels((prev) => (prev.cast ? { ...prev, cast: false } : prev));
  }, [isPhone]);

  const toggleStudioDirectorOption = useCallback((option: StudioDirectorOptionKey) => {
    setStudioDirectorModeState((prev) => ({ ...prev, [option]: !prev[option] }));
  }, []);

  const handleDiscardStudioDirectorPreview = useCallback(() => {
    if (!studioDirectorPreview) return;
    setStudioDirectorPreview(null);
    emit('custom.message', {
      message: `AI Director (${studioDirectorPreview.modeLabel}) preview discarded.`,
      severity: 'info',
      category: 'activity',
      channel: 'toast',
    });
  }, [emit, studioDirectorPreview]);

  const handleApplyStudioDirectorPreview = useCallback(() => {
    if (!studioDirectorPreview) return;
    const nextPreview = studioDirectorPreview;
    setStudioDirectorPreview(null);
    setStudioEditorMode('raw');
    setText(nextPreview.previewText);
    startTransition(() => {
      setDetectedSpeakers(nextPreview.castNames);
    });
    emit('custom.message', {
      message: `AI Director (${nextPreview.modeLabel}) applied to the editor.`,
      severity: 'success',
      category: 'activity',
      channel: 'toast',
    });
  }, [emit, studioDirectorPreview]);

  useEffect(() => {
    if (!studioDirectorPreview) return;
    if (text === studioDirectorPreview.sourceText) return;
    setStudioDirectorPreview(null);
  }, [studioDirectorPreview, text]);

  useEffect(() => {
    if (!studioDirectorPreview) return;

    const handleDirectorPreviewKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (showSettings || isCreditsSurfaceOpen || isStudioEditorFullscreen) return;

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        handleApplyStudioDirectorPreview();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        handleDiscardStudioDirectorPreview();
      }
    };

    window.addEventListener('keydown', handleDirectorPreviewKeydown);
    return () => {
      window.removeEventListener('keydown', handleDirectorPreviewKeydown);
    };
  }, [
    handleApplyStudioDirectorPreview,
    handleDiscardStudioDirectorPreview,
    isCreditsSurfaceOpen,
    isStudioEditorFullscreen,
    showSettings,
    studioDirectorPreview,
  ]);

  // Translation & Chat State
  const [targetLang, setTargetLang] = useState('Hinglish');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([
      { role: 'ai', text: "Hello! I'm your creative assistant. I can help you write, edit, or direct your video." }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [assistantAutoApply, setAssistantAutoApply] = useState(true);
  const [assistantApplyMode, setAssistantApplyMode] = useState<AssistantApplyMode>('append');
  const [lastAssistantDraft, setLastAssistantDraft] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Runtime Backend State ---
  const [backendHealth, setBackendHealth] = useState<BackendHealthState | null>(null);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);

  // --- Character Management State ---
  const [charTab, setCharTab] = useState<'CAST' | 'GALLERY'>('CAST');
  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceFilterGender, setVoiceFilterGender] = useState<'All' | 'Male' | 'Female'>('All');
  const [voiceFilterAccent, setVoiceFilterAccent] = useState<string>('All');
  const deferredVoiceSearch = useDeferredValue(voiceSearch);
  type StudioGenerateSpeechOptions = {
    context?: 'studio' | 'preview' | 'asyncJob';
    preferLiveChunks?: boolean;
    requestId?: string;
    traceId?: string;
    speakerVcReferenceMap?: Record<string, SpeakerVcReference>;
  };
  type VoiceCloneTarget = {
    speakerName: string | undefined;
    characterId: string | undefined;
    voiceId: string;
    sourceVoiceLabel: string;
    sourceVoiceEngine: string;
    sourceVoiceUrl: string;
    sourceVoiceUrlNeedsCleanup: boolean;
  };
  const [speakerVcReferenceMap, setSpeakerVcReferenceMap] = useState<Record<string, SpeakerVcReference>>({});
  const speakerVcReferenceStorageReadyRef = useRef(false);
  const [isVoiceCloneModalOpen, setIsVoiceCloneModalOpen] = useState(false);
  const [voiceCloneTarget, setVoiceCloneTarget] = useState<VoiceCloneTarget | null>(null);
  const voiceCloneTargetRef = useRef<VoiceCloneTarget | null>(null);

  useEffect(() => {
      voiceCloneTargetRef.current = voiceCloneTarget;
  }, [voiceCloneTarget]);

  useEffect(() => {
      if (!isStudioWorkspaceTab) {
          setSpeakerVcReferenceMap({});
          speakerVcReferenceStorageReadyRef.current = false;
          return;
      }
      const stored = readStorageJson(STORAGE_KEYS.studioSpeakerVcReferences);
      let nextMap: Record<string, SpeakerVcReference> = {};
      if (stored && typeof stored === 'object' && !Array.isArray(stored) && !hasSpeakerVcReferencePayloadShape(stored)) {
          const scopedStore = stored as SpeakerVcReferenceStore;
          nextMap = normalizeSpeakerVcReferenceMap(scopedStore[speakerVcReferenceOwnerKey]);
      } else {
          nextMap = normalizeSpeakerVcReferenceMap(stored);
      }
      setSpeakerVcReferenceMap(nextMap);
      speakerVcReferenceStorageReadyRef.current = true;
  }, [isStudioWorkspaceTab, speakerVcReferenceOwnerKey]);

  const [characterModalOpen, setCharacterModalOpen] = useState(false);
  const [editingChar, setEditingChar] = useState<CharacterProfile | null>(null);
  const [charForm, setCharForm] = useState<CharacterProfile>({
      id: '', name: '', voiceId: DEFAULT_GEM_VOICE_ID, gender: 'Unknown', age: 'Adult', avatarColor: '#6366f1'
  });

  const progressTimerRef = useRef<any>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const studioMainRef = useRef<HTMLDivElement>(null);
  const studioEditorShellRef = useRef<HTMLDivElement>(null);
  const creditsSurfaceRef = useRef<HTMLDivElement>(null);
  const creditsSurfaceTriggerRef = useRef<HTMLButtonElement>(null);

  // --- PREVIEW STATE ---
  const [previewState, setPreviewState] = useState<{ id: string, status: 'loading' | 'playing' } | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceSampleCacheRef = useRef<Map<string, VoiceSampleCacheEntry>>(new Map());
  const [engineSwitchInProgress, setEngineSwitchInProgress] = useState<GenerationSettings['engine'] | null>(null);
  const [managedActiveEngine, setManagedActiveEngine] = useState<GenerationSettings['engine'] | null>(null);
  const [ttsRuntimeStatus, setTtsRuntimeStatus] = useState<Record<ActiveTtsEngineKey, EngineRuntimeStatus>>({
    PRIME: { state: 'checking', detail: 'Checking...' },
    VECTOR: { state: 'checking', detail: 'Checking...' },
  });
  const ttsRuntimeStatusRef = useRef(ttsRuntimeStatus);
  const [ttsAccessState, setTtsAccessState] = useState<TtsAccessState>({
    blocked: false,
    detail: 'Checking authentication...',
    checkedAt: 0,
  });
  const runtimePollRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const [selectedEngineTelemetry, setSelectedEngineTelemetry] = useState<Record<ActiveTtsEngineKey, SelectedEngineTelemetry>>(
    createInitialSelectedEngineTelemetry
  );
  const [runtimeVoiceCatalogs, setRuntimeVoiceCatalogs] = useState<Record<ActiveTtsEngineKey, VoiceOption[]>>(
    EMPTY_RUNTIME_CATALOG
  );

  useEffect(() => {
    ttsRuntimeStatusRef.current = ttsRuntimeStatus;
  }, [ttsRuntimeStatus]);

  const normalizedPlanToken = normalizePlanToken(stats.planName);
  const isPaidBillingPlan = normalizedPlanToken !== 'free';
  const isFreeTierUser = !hasUnlimitedAccess && !isPaidBillingPlan;
  const walletPaidVfBalance = Math.max(0, Number(stats.wallet?.paidVfBalance || 0));
  const primeAllowedEngines: ActiveTtsEngineKey[] = useMemo(
    () => resolvePrimeAllowedEngines({
      hasUnlimitedAccess,
      isPaidBillingPlan,
      paidVfBalance: walletPaidVfBalance,
    }),
    [hasUnlimitedAccess, isPaidBillingPlan, walletPaidVfBalance]
  );
  const isPrimeEngineAllowed = useCallback(
    (engine: GenerationSettings['engine']) => primeAllowedEngines.includes(engine),
    [primeAllowedEngines]
  );
  const maxCharsPerGeneration = STUDIO_SINGLE_RUN_CHAR_CAP;
  const studioQueueSourceHash = useMemo(() => hashStudioQueueSource(text), [text]);
  const studioQueueEligible = useMemo(
    () => canUseStudioQueue(text, maxCharsPerGeneration),
    [maxCharsPerGeneration, text]
  );
  const studioQueueDraftPartCount = useMemo(() => {
    if (!studioQueueEligible) return 0;
    return createStudioQueueState(text, maxCharsPerGeneration, settings, true).items.length;
  }, [maxCharsPerGeneration, settings, studioQueueEligible, text]);
  const isStudioQueueModeEnabled = studioQueueState?.queueModeEnabled === true;
  const hasStudioQueueItems = Boolean(studioQueueState?.items.length);
  const selectedTokenPackMeta = TOKEN_PACK_MATRIX[selectedTokenPack];
  const tokenPackDiscountPercent = resolveTokenPackDiscountPercent(
    normalizedPlanToken,
    Number(stats.limits?.tokenPackDiscountPercent || 0)
  );
  const selectedTokenPackPriceInr = applyTokenPackDiscount(selectedTokenPackMeta.baseInr, tokenPackDiscountPercent);
  const selectedTokenPackSavingsInr = Math.max(0, selectedTokenPackMeta.baseInr - selectedTokenPackPriceInr);

  const currentEngineSpendable = Math.max(
    0,
    Number(stats.wallet?.spendableNowByEngine?.[managedActiveEngine || settings.engine] || 0)
  );
  const canRunVectorWithoutWallet = (managedActiveEngine || settings.engine) === 'VECTOR';
  const isWalletBlocked = currentEngineSpendable <= 0 && !hasUnlimitedAccess;
  const walletMonthlyFree = Math.max(0, Number(stats.wallet?.monthlyFreeRemaining || 0));
  const walletMonthlyFreeLimit = Math.max(0, Number(stats.wallet?.monthlyFreeLimit || 0));
  const walletPaid = walletPaidVfBalance;
  const availableCreditsPercentLabel = formatMobileAvailableCreditsPercent({
    hasUnlimitedAccess,
    monthlyFreeRemaining: walletMonthlyFree,
    monthlyFreeLimit: walletMonthlyFreeLimit,
    paidVfBalance: walletPaid,
  });
  const activePlanLabel = hasUnlimitedAccess ? 'Unlimited' : (isPaidBillingPlan ? String(stats.planName || 'Paid') : 'Free');
  const balanceRemainingLabel = hasUnlimitedAccess ? 'Unlimited' : walletMonthlyFree.toLocaleString();
  const allowedEngineSummary = primeAllowedEngines.map((engine) => getEngineDisplayName(engine)).join(', ');
  const toUserFriendlySystemMessage = useCallback((raw: unknown, fallback: string): string => {
    return formatFrontendError(raw, {
      fallback,
      context: 'runtime',
      isAdmin: hasAdminConsoleAccess,
    }).publicMessage;
  }, [hasAdminConsoleAccess]);
  const normalizeRuntimeErrorMessage = useCallback((raw: unknown, fallback: string): string => {
    const formatted = formatFrontendError(raw, {
      fallback,
      context: 'runtime',
      isAdmin: hasAdminConsoleAccess,
    });
    const safePublicMessage = sanitizeUiText(String(formatted.publicMessage || '').trim()) || fallback;
    if (isFalseFrontendOnlyRuntimeRestriction({
      rawMessage: raw,
      publicMessage: safePublicMessage,
    })) {
      return 'Runtime access could not be verified right now. Please retry in a moment.';
    }
    return safePublicMessage;
  }, [hasAdminConsoleAccess]);
  const isAuthOrProfileBlockingMessage = useCallback((raw: unknown): boolean => {
    const lowered = String(raw || '').trim().toLowerCase();
    if (!lowered) return false;
    return (
      lowered.includes('authentication required') ||
      lowered.includes('missing bearer token') ||
      lowered.includes('invalid auth token') ||
      lowered.includes('unauthorized') ||
      lowered.includes('auth token did not include uid') ||
      lowered.includes('authentication failed') ||
      lowered.includes('complete your userid') ||
      lowered.includes('complete your user id') ||
      lowered.includes('requireduserid') ||
      lowered.includes('token used too early') ||
      lowered.includes('token is not yet valid') ||
      lowered.includes('status code 401') ||
      lowered.includes('status code 428') ||
      lowered.includes('(401)') ||
      lowered.includes('(428)')
    );
  }, []);
  const isTokenTimingAuthMessage = useCallback((raw: unknown): boolean => {
    const lowered = String(raw || '').trim().toLowerCase();
    if (!lowered) return false;
    return (
      lowered.includes('token used too early') ||
      lowered.includes('token is not yet valid') ||
      lowered.includes('clock is out of sync') ||
      lowered.includes("check that your computer's clock is set correctly")
    );
  }, []);
  const mapTtsAccessBlockReason = useCallback((raw: unknown, fallback: string): string => {
    const source = sanitizeUiText(String(raw || '').trim());
    if (isTokenTimingAuthMessage(source)) {
      return 'System clock is out of sync. Sync your device clock, then sign in again to enable AI/TTS requests.';
    }
    const normalized = normalizeRuntimeErrorMessage(raw, fallback);
    const lowered = normalized.toLowerCase();
    if (
      lowered.includes('authentication failed') ||
      lowered.includes('authentication required') ||
      lowered.includes('missing bearer token') ||
      lowered.includes('invalid auth token')
    ) {
      return 'Sign in again to enable AI/TTS requests.';
    }
    if (lowered.includes('complete your userid') || lowered.includes('complete your user id')) {
      return 'Complete your user ID setup to enable AI/TTS requests.';
    }
    return normalized;
  }, [isTokenTimingAuthMessage, normalizeRuntimeErrorMessage]);
  const probeProtectedTtsAccess = useCallback(
    async (options?: { force?: boolean; signal?: AbortSignal }): Promise<RuntimeAccessProbe> => {
      const now = Date.now();
      const force = Boolean(options?.force);
      const cached = ttsAccessProbeRef.current;
      if (!hasSessionIdentity) {
        ttsAccessProbeAbortControllerRef.current?.abort();
        const detail = 'Sign in to enable AI/TTS requests.';
        const signedOutProbe = { ok: false, detail, checkedAt: now };
        ttsAccessProbeRef.current = signedOutProbe;
        return signedOutProbe;
      }
      if (!force && cached && now - cached.checkedAt < 15_000) {
        return cached;
      }

      const externalSignal = options?.signal;
      const inFlight = ttsAccessProbeInFlightRef.current;
      if (inFlight) {
        return awaitAbortablePromise(inFlight, externalSignal);
      }

      const controller = new AbortController();
      const forwardAbort = () => controller.abort();
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', forwardAbort, { once: true });
        }
      }

      const pendingProbe = (async (): Promise<RuntimeAccessProbe> => {
        try {
          const accountProfile = await fetchAccountProfile(undefined, { signal: controller.signal });
          if (controller.signal.aborted || externalSignal?.aborted) {
            throw createAbortError();
          }
          if (Boolean(accountProfile?.requiredUserId)) {
            const detail = 'Complete your user ID setup to enable AI/TTS requests.';
            const blockedProbe = { ok: false, detail, checkedAt: now };
            ttsAccessProbeRef.current = blockedProbe;
            return blockedProbe;
          }
          const detail = 'Authenticated';
          const authenticatedProbe = { ok: true, detail, checkedAt: now };
          ttsAccessProbeRef.current = authenticatedProbe;
          return authenticatedProbe;
        } catch (error: unknown) {
          if (controller.signal.aborted || externalSignal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw error instanceof Error && error.name === 'AbortError' ? error : createAbortError();
          }
          const detail = sanitizeUiText(
            mapTtsAccessBlockReason(error instanceof Error ? error.message : error, 'Authentication required.')
          );
          const safeDetail = detail || 'Sign in again to enable AI/TTS requests.';
          const shouldBlockForAuth = isAuthOrProfileBlockingMessage(safeDetail);
          if (shouldBlockForAuth) {
            const hasSessionIdentity = Boolean(String(user.uid || '').trim());
            const previous = ttsAccessProbeRef.current;
            const recentAuthenticatedProbe =
              Boolean(previous?.ok) && now - Number(previous?.checkedAt || 0) < 90_000;
            if (hasSessionIdentity && recentAuthenticatedProbe) {
              const authenticatedDetail = 'Authenticated';
              const authenticatedProbe = { ok: true, detail: authenticatedDetail, checkedAt: now };
              ttsAccessProbeRef.current = authenticatedProbe;
              return authenticatedProbe;
            }
            const blockedProbe = { ok: false, detail: safeDetail, checkedAt: now };
            ttsAccessProbeRef.current = blockedProbe;
            return blockedProbe;
          }

          // Non-auth probe failures (network/service hiccups) should not block active sessions.
          const optimisticDetail = 'Authenticated';
          const optimisticProbe = { ok: true, detail: optimisticDetail, checkedAt: now };
          ttsAccessProbeRef.current = optimisticProbe;
          return optimisticProbe;
        } finally {
          if (externalSignal) {
            externalSignal.removeEventListener('abort', forwardAbort);
          }
          if (ttsAccessProbeAbortControllerRef.current === controller) {
            ttsAccessProbeAbortControllerRef.current = null;
          }
        }
      })();

      ttsAccessProbeAbortControllerRef.current = controller;
      ttsAccessProbeInFlightRef.current = pendingProbe;
      return pendingProbe.finally(() => {
        if (ttsAccessProbeInFlightRef.current === pendingProbe) {
          ttsAccessProbeInFlightRef.current = null;
        }
      });
    },
    [hasSessionIdentity, isAuthOrProfileBlockingMessage, mapTtsAccessBlockReason, user.email, user.uid]
  );
  const refreshTtsAccessState = useCallback(
    async (force: boolean = false, options?: { signal?: AbortSignal }): Promise<RuntimeAccessProbe> => {
      const probeOptions = options?.signal ? { force, signal: options.signal } : { force };
      const probe = await probeProtectedTtsAccess(probeOptions);
      const checkedAt = probe.checkedAt ?? ttsAccessProbeRef.current?.checkedAt ?? Date.now();
      const safeDetail = sanitizeUiText(
        probe.detail || (probe.ok ? 'Authenticated' : 'Sign in again to enable AI/TTS requests.')
      );
      const detail = safeDetail || (probe.ok ? 'Authenticated' : 'Sign in again to enable AI/TTS requests.');
      setTtsAccessState({
        blocked: !probe.ok,
        detail,
        checkedAt,
      });
      return {
        ok: probe.ok,
        detail,
        checkedAt,
      };
    },
    [probeProtectedTtsAccess]
  );
  const rediscoverBackendRouting = useCallback(
    async (_reason: string): Promise<boolean> => {
      // Backend routing removed â€” Cloud TTS routes are local API routes
      return false;
    },
    []
  );
  const syncRuntimeBlockedStateFromError = useCallback(
    (_engine: GenerationSettings['engine'], error: unknown) => {
      const raw = String((error as { message?: string })?.message || error || '').trim();
      if (!isAuthOrProfileBlockingMessage(raw)) return;
      const detail = sanitizeUiText(mapTtsAccessBlockReason(raw, 'Authentication required.'));
      const safeDetail = detail || 'Sign in again to enable AI/TTS requests.';
      ttsAccessProbeRef.current = { ok: false, detail: safeDetail, checkedAt: Date.now() };
      setTtsAccessState({
        blocked: true,
        detail: safeDetail,
        checkedAt: Date.now(),
      });
    },
    [isAuthOrProfileBlockingMessage, mapTtsAccessBlockReason]
  );
  const showToast = useCallback((
    msg: string,
    type: 'success' | 'error' | 'info' = 'info',
    options?: { context?: FrontendErrorContext; category?: 'system' | 'activity' | 'security' | 'tips' }
  ) => {
    const inferContextFromMessage = (value: string): FrontendErrorContext => {
      const lowered = String(value || '').trim().toLowerCase();
      if (!lowered) return 'generic';
      if (
        lowered.includes('authentication')
        || lowered.includes('missing bearer token')
        || lowered.includes('invalid auth token')
        || lowered.includes('unauthorized')
        || lowered.includes('invalid email or password')
        || lowered.includes('email verification required')
        || lowered.includes('token used too early')
        || lowered.includes('token is not yet valid')
        || lowered.includes('clock is out of sync')
      ) {
        return 'auth';
      }
      if (lowered.includes('billing') || lowered.includes('stripe') || lowered.includes('checkout') || lowered.includes('coupon')) {
        return 'billing';
      }
      if (lowered.includes('support')) return 'support';
      if (
        lowered.includes('media')
        || lowered.includes('upload')
        || lowered.includes('download')
        || lowered.includes('audio')
        || lowered.includes('video')
      ) {
        return 'media';
      }
      if (
        lowered.includes('runtime')
        || lowered.includes('slot set')
        || lowered.includes('uid_not_allowlisted')
        || lowered.includes('admin-unlock')
        || lowered.includes('x-admin-unlock')
        || lowered.includes('forbidden')
        || lowered.includes('permission denied')
        || lowered.includes('missing permission')
        || lowered.includes('service account')
        || lowered.includes('google_application_credentials')
        || lowered.includes('provider_error')
        || lowered.includes('chunk_')
      ) {
        return 'runtime';
      }
      if (lowered.includes('generation') || lowered.includes('synthesis')) return 'generation';
      return 'generic';
    };

    const resolvedContext = options?.context || inferContextFromMessage(msg);
    const formatted = type === 'error'
      ? formatFrontendError(
          resolvedContext === 'runtime'
            ? normalizeRuntimeErrorMessage(
                msg,
                'Runtime action is temporarily unavailable. Please try again in a moment.'
              )
            : msg,
          { context: resolvedContext, isAdmin: hasAdminConsoleAccess }
        )
      : { publicMessage: sanitizeUiText(msg), adminDetails: undefined };
    const safeMessage = formatted.publicMessage;
    if (!safeMessage) return;
    const loweredSafeMessage = safeMessage.toLowerCase();
    const isSecurityError = type === 'error' && (
      resolvedContext === 'auth'
      || loweredSafeMessage.includes('restricted for your account')
      || loweredSafeMessage.includes('admin session unlock')
      || loweredSafeMessage.includes('service-account settings')
    );
    const category = options?.category
      || (isSecurityError ? 'security' : type === 'error' ? 'system' : 'activity');
    emit('custom.message', {
      message: safeMessage,
      ...(formatted.adminDetails ? { details: formatted.adminDetails } : {}),
      severity: type === 'success' ? 'success' : type === 'error' ? 'error' : 'info',
      category,
      channel: 'toast',
    });
  }, [emit, hasAdminConsoleAccess, normalizeRuntimeErrorMessage]);

  useEffect(() => {
      if (text.length <= STUDIO_EDITOR_HARD_CAP) return;
      setText((previous) => String(previous || '').slice(0, STUDIO_EDITOR_HARD_CAP));
      const now = Date.now();
      if (now - studioTextHardCapNoticeAtRef.current > 1800) {
          studioTextHardCapNoticeAtRef.current = now;
          showToast(`Input is capped at ${STUDIO_EDITOR_HARD_CAP.toLocaleString()} characters. Extra text was trimmed.`, 'info');
      }
  }, [showToast, text]);

  useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      const billingState = String(params.get('billing') || '').trim().toLowerCase();
      if (!billingState) return;

      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('billing');
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);

      if (billingState === 'success') {
          void (async () => {
              try {
                  await refreshEntitlements();
                  showToast('Billing updated successfully.', 'success');
              } catch {
                  showToast('Billing update received. Refresh failed.', 'info');
              }
          })();
          return;
      }
      if (billingState === 'cancel') {
          showToast('Billing checkout canceled.', 'info');
      }
  // Intentional one-time check on mount for checkout return query params.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
      const syncNotificationDeepLink = () => {
          const target = readNotificationDeepLink();
          if (target.tab) {
              const tabToken = String(target.tab || '').trim().toUpperCase();
              if (Object.values(Tab).includes(tabToken as Tab)) {
                  router.replace(resolveWorkspaceRoutePath(tabToken as Tab));
              }
          }
          if (target.adminTab) {
              const adminToken = String(target.adminTab || '').trim().toLowerCase();
              if (['usage', 'tokens', 'guardian', 'alerts', 'scheduler', 'audit', 'analytics'].includes(adminToken)) {
                  setInitialAdminOpsTab(adminToken as AdminOpsTab);
              }
          }
      };
      syncNotificationDeepLink();
      window.addEventListener(NOTIFICATION_DEEP_LINK_EVENT, syncNotificationDeepLink as EventListener);
      return () => window.removeEventListener(NOTIFICATION_DEEP_LINK_EVENT, syncNotificationDeepLink as EventListener);
  }, []);
  const billingActions = useBillingActions({ baseUrl: '/api/v1', returnPath: APP_ROUTE_PATHS.billing });
  const isGemRuntimeEngine = useCallback(
    (engine: GenerationSettings['engine']) => engine === 'PRIME' || engine === 'VECTOR',
    []
  );
  const normalizeRuntimeUrl = (url?: string): string => (url || '').trim().replace(/\/+$/, '');
  const getDefaultRuntimeUrlForEngine = (engine: GenerationSettings['engine']): string => {
      return FALLBACK_RUNTIME_URLS[engine] || '';
  };
  const getRuntimeUrlForEngine = (engine: GenerationSettings['engine']): string => {
      if (isGemRuntimeEngine(engine)) {
        const configured = normalizeRuntimeUrl(settings.geminiTtsServiceUrl);
        if (configured) return configured;
      }
      return normalizeRuntimeUrl(getDefaultRuntimeUrlForEngine(engine));
  };
  const resolveVoiceAccessTier = useCallback(
      (engine: GenerationSettings['engine'], voice: VoiceOption): 'free' | 'pro' => {
          const explicit = String(voice.accessTier || '').trim().toLowerCase();
          if (explicit === 'free' || explicit === 'pro') return explicit as 'free' | 'pro';
          const allowlist = FREE_TIER_ALLOWED_VOICE_IDS[engine] || [];
          const allowed = new Set(allowlist.map((token) => String(token || '').trim().toLowerCase()));
          return allowed.has(String(voice.id || '').trim().toLowerCase()) ? 'free' : 'pro';
      },
      []
  );
  const isVoiceLockedForFreeTier = useCallback(
      (engine: GenerationSettings['engine'], voice: VoiceOption): boolean => {
          if (!isFreeTierUser) return false;
          return resolveVoiceAccessTier(engine, voice) === 'pro';
      },
      [isFreeTierUser, resolveVoiceAccessTier]
  );
  const findSpeakerMappingKey = useCallback((mapping: Record<string, string> | undefined, speaker: string): string => {
      if (!mapping || typeof mapping !== 'object') return '';
      const rawSpeaker = String(speaker || '');
      if (!rawSpeaker.trim()) return '';
      if (mapping[rawSpeaker]) return rawSpeaker;
      const trimmed = rawSpeaker.trim();
      if (trimmed && mapping[trimmed]) return trimmed;
      const normalizedTarget = normalizeSpeakerMapKey(rawSpeaker);
      if (!normalizedTarget) return '';
      for (const key of Object.keys(mapping)) {
          if (!key) continue;
          if (normalizeSpeakerMapKey(key) === normalizedTarget) return key;
      }
      return '';
  }, []);
  const resolveMappedVoiceForSpeaker = useCallback(
      (speaker: string, mapping?: Record<string, string>): string => (
          resolveSpeakerMappedVoiceId(mapping || settings.speakerMapping, speaker)
      ),
      [settings.speakerMapping]
  );
  const upsertSpeakerVoiceMapping = useCallback(
      (speaker: string, voiceId: string, mapping?: Record<string, string>): Record<string, string> => {
          const nextMapping = { ...(mapping || settings.speakerMapping || {}) };
          const canonical = String(speaker || '').trim();
          if (!canonical) return nextMapping;
          const matchedKey = findSpeakerMappingKey(nextMapping, canonical);
          if (matchedKey && matchedKey !== canonical) delete nextMapping[matchedKey];
          nextMapping[canonical] = String(voiceId || '').trim();
          return nextMapping;
      },
      [findSpeakerMappingKey, settings.speakerMapping]
  );
  const applyFreeTierVoiceGate = useCallback(
      (engine: GenerationSettings['engine'], voices: VoiceOption[]): VoiceOption[] => {
          return voices.map((voice) => {
              const tier = resolveVoiceAccessTier(engine, voice);
              return {
                  ...voice,
                  accessTier: tier,
                  isPlanRestricted: typeof voice.isPlanRestricted === 'boolean' ? voice.isPlanRestricted : tier === 'pro',
              };
          });
      },
      [resolveVoiceAccessTier]
  );

  const resolveVoiceCountry = useCallback((voice: VoiceOption): string => {
      if (voice.country && voice.country.trim()) return voice.country.trim();
      const accent = (voice.accent || '').toLowerCase();
      if (accent.includes('india')) return 'India';
      if (accent.includes('united states') || accent.includes('american')) return 'United States';
      if (
          accent.includes('england') ||
          accent.includes('british') ||
          accent.includes('scottish') ||
          accent.includes('northern irish') ||
          accent.includes('united kingdom')
      ) {
          return 'United Kingdom';
      }
      if (accent.includes('canadian') || accent.includes('canada')) return 'Canada';
      if (accent.includes('australian') || accent.includes('australia')) return 'Australia';
      if (accent.includes('irish') || accent.includes('ireland')) return 'Ireland';
      return 'Unknown';
  }, []);

  const resolveVoiceAgeGroup = useCallback((voice: VoiceOption): string => {
      return (voice.ageGroup || 'Unknown').trim() || 'Unknown';
  }, []);

  const resolveVoicePersonaLabel = useCallback((voice: VoiceOption): string => {
      const gender = String(voice.gender || 'Unknown').trim();
      const ageGroup = resolveVoiceAgeGroup(voice).toLowerCase();
      const meta = `${voice.name || ''} ${voice.id || ''} ${voice.ageGroup || ''}`.toLowerCase();

      const isChild = /\b(child|kid|boy|girl|teen)\b/.test(`${ageGroup} ${meta}`);
      const isElder = /\b(elder|elderly|old|senior|aged|grand)\b/.test(`${ageGroup} ${meta}`);

      if (isChild) {
          if (gender === 'Female' || /\bgirl\b/.test(meta)) return 'Girl';
          if (gender === 'Male' || /\bboy\b/.test(meta)) return 'Boy';
          return 'Child';
      }
      if (isElder) {
          if (gender === 'Female' || /\b(lady|woman|female)\b/.test(meta)) return 'Old Lady';
          if (gender === 'Male' || /\b(man|male)\b/.test(meta)) return 'Old Man';
          return 'Elderly';
      }
      if (gender === 'Female') return 'Female Adult';
      if (gender === 'Male') return 'Male Adult';
      return 'Adult';
  }, [resolveVoiceAgeGroup]);

  const resolveVoiceCountryTag = useCallback((voice: VoiceOption): string => {
      const rawName = String(voice.name || '').trim();
      const trailingToken = rawName.split(/\s+/).filter(Boolean).pop() || '';
      if (/^[A-Za-z]{2,3}$/.test(trailingToken)) return trailingToken.toUpperCase();
      const normalizedCountry = resolveVoiceCountry(voice).trim().toLowerCase();
      if (!normalizedCountry || normalizedCountry === 'unknown') return '';
      return COUNTRY_TAG_BY_NAME[normalizedCountry] || normalizedCountry.slice(0, 3).toUpperCase();
  }, [resolveVoiceCountry]);

  const resolveVoiceDisplayMeta = useCallback((voice: VoiceOption): { name: string; countryTag: string } => {
      const countryTag = resolveVoiceCountryTag(voice);
      const rawName = String(
        resolvePublicVoiceLabel(voice.name, voice.geminiVoiceName, voice.id)
        || voice.name
        || voice.geminiVoiceName
        || voice.id
        || ''
      ).trim();
      if (!rawName) return { name: 'Voice', countryTag };

      const tokens = rawName.split(/\s+/).filter(Boolean);
      const trailingToken = tokens[tokens.length - 1] || '';
      if (countryTag && trailingToken.toUpperCase() === countryTag) {
          const strippedName = tokens.slice(0, -1).join(' ').trim();
          if (strippedName) return { name: strippedName, countryTag };
      }

      const countryName = resolveVoiceCountry(voice);
      if (countryTag && countryName && countryName !== 'Unknown') {
          const loweredRaw = rawName.toLowerCase();
          const loweredCountry = countryName.toLowerCase();
          if (loweredRaw.endsWith(` ${loweredCountry}`)) {
              const strippedName = rawName.slice(0, rawName.length - loweredCountry.length - 1).trim();
              if (strippedName) return { name: strippedName, countryTag };
          }
      }
      return { name: rawName, countryTag };
  }, [resolveVoiceCountry, resolveVoiceCountryTag]);

  const resolveVoiceDisplayLabel = useCallback((voice: VoiceOption): string => {
      const meta = resolveVoiceDisplayMeta(voice);
      return meta.countryTag ? `${meta.name} [${meta.countryTag}]` : meta.name;
  }, [resolveVoiceDisplayMeta]);

  const withVoiceMeta = useCallback((voice: VoiceOption, engine: GenerationSettings['engine']): VoiceOption => {
      const tier = resolveVoiceAccessTier(engine, voice);
      const publicName = resolvePublicVoiceLabel(voice.name, voice.geminiVoiceName, voice.id)
        || String(voice.name || '').trim()
        || String(voice.geminiVoiceName || '').trim()
        || String(voice.id || '').trim()
        || 'Voice';
      return {
          ...voice,
          name: publicName,
          engine,
          country: resolveVoiceCountry(voice),
          ageGroup: resolveVoiceAgeGroup(voice),
          accessTier: tier,
          isPlanRestricted: typeof voice.isPlanRestricted === 'boolean' ? voice.isPlanRestricted : tier === 'pro',
      };
  }, [resolveVoiceAccessTier, resolveVoiceAgeGroup, resolveVoiceCountry]);

  const getStaticVoicesForEngine = useCallback((engine: GenerationSettings['engine']): VoiceOption[] => {
      const clonedCatalog = clonedVoices.filter((voice) => {
          const sourceEngine = String(voice.sourceVoiceEngine || '').trim();
          if (!sourceEngine) return true;
          return resolveEngineToken(sourceEngine) === engine;
      });
      return [
          ...getStaticVoiceFallback(engine).map((voice) => withVoiceMeta(voice, engine)),
          ...clonedCatalog.map((voice) =>
              withVoiceMeta(
                  {
                      ...voice,
                      country: voice.country || 'Unknown',
                      ageGroup: voice.ageGroup || 'Unknown',
                  },
                  engine
              )
          ),
      ];
  }, [clonedVoices, isGemRuntimeEngine, withVoiceMeta]);

  const mergeVoiceCatalogs = useCallback((primary: VoiceOption[], fallback: VoiceOption[]): VoiceOption[] => {
      const out: VoiceOption[] = [];
      const seen = new Set<string>();
      const push = (voice: VoiceOption) => {
          const key = String(voice.id || '').trim();
          if (!key || seen.has(key)) return;
          seen.add(key);
          out.push(voice);
      };
      primary.forEach(push);
      fallback.forEach(push);
      return out;
  }, []);

  const getEngineVoiceCatalog = useCallback((engine: GenerationSettings['engine']): VoiceOption[] => {
      const runtimeVoices = runtimeVoiceCatalogs[engine] || [];
      if (isGemRuntimeEngine(engine)) {
          const runtimeBase = runtimeVoices.map((voice) => withVoiceMeta(voice, engine));
          const staticBase = getStaticVoiceFallback(engine).map((voice) => withVoiceMeta(voice, engine));
          const baseVoices = mergeVoiceCatalogs(runtimeBase, staticBase);
          const cloneVoices = clonedVoices.filter((voice) => {
              const sourceEngine = String(voice.sourceVoiceEngine || '').trim();
              if (!sourceEngine) return true;
              return resolveEngineToken(sourceEngine) === engine;
          }).map((voice) =>
              withVoiceMeta(
                  {
                      ...voice,
                      country: voice.country || 'Unknown',
                      ageGroup: voice.ageGroup || 'Unknown',
                  },
                  engine
              )
          );
          return applyFreeTierVoiceGate(engine, [...baseVoices, ...cloneVoices]);
      }
      const runtimeCatalog = runtimeVoices.map((voice) => withVoiceMeta(voice, engine));
      const staticCatalog = getStaticVoicesForEngine(engine);
      return applyFreeTierVoiceGate(engine, mergeVoiceCatalogs(runtimeCatalog, staticCatalog));
  }, [applyFreeTierVoiceGate, clonedVoices, getStaticVoicesForEngine, isGemRuntimeEngine, mergeVoiceCatalogs, runtimeVoiceCatalogs, withVoiceMeta]);

  const getVoiceById = useCallback((voiceId: string): VoiceOption | undefined => {
      if (!voiceId) return undefined;
      for (const engine of ENGINE_ORDER) {
          const found = getEngineVoiceCatalog(engine).find((voice) => voice.id === voiceId);
          if (found) return found;
      }
      return undefined;
  }, [getEngineVoiceCatalog]);

  const getValidVoiceIdForEngine = useCallback(
      (engine: GenerationSettings['engine'], candidateId: string): string => {
          const catalog = getEngineVoiceCatalog(engine);
          if (!catalog.length) return candidateId;
          const validIds = new Set(catalog.map((voice) => voice.id));
          const freeVoiceId = catalog.find((voice) => resolveVoiceAccessTier(engine, voice) === 'free')?.id || '';
          const fallbackVoiceId = freeVoiceId || catalog[0]?.id || candidateId;
          const resolvedId = validIds.has(candidateId) ? candidateId : fallbackVoiceId;
          if (!isFreeTierUser) return resolvedId;
          const resolvedVoice = catalog.find((voice) => voice.id === resolvedId);
          if (resolvedVoice && resolveVoiceAccessTier(engine, resolvedVoice) === 'pro') {
              return fallbackVoiceId;
          }
          return resolvedId;
      },
      [getEngineVoiceCatalog, isFreeTierUser, resolveVoiceAccessTier]
  );

  const selectVoiceIdFromCatalog = useCallback(
      (engine: GenerationSettings['engine'], catalog: VoiceOption[], candidateId: string): string => {
          if (!catalog.length) return candidateId;
          const validIds = new Set(catalog.map((voice) => voice.id));
          const freeVoiceId = catalog.find((voice) => resolveVoiceAccessTier(engine, voice) === 'free')?.id || '';
          const fallbackVoiceId = freeVoiceId || catalog[0]?.id || candidateId;
          const resolvedId = validIds.has(candidateId) ? candidateId : fallbackVoiceId;
          if (!isFreeTierUser) return resolvedId;
          const resolvedVoice = catalog.find((voice) => voice.id === resolvedId);
          if (resolvedVoice && resolveVoiceAccessTier(engine, resolvedVoice) === 'pro') {
              return fallbackVoiceId;
          }
          return resolvedId;
      },
      [isFreeTierUser, resolveVoiceAccessTier]
  );

  useEffect(() => {
      if (isPrimeEngineAllowed(settings.engine)) return;
      const fallbackEngine = primeAllowedEngines[0] || 'VECTOR';
      const fallbackVoiceId = getValidVoiceIdForEngine(fallbackEngine, settings.voiceId);
      setSettings((prev) => ({ ...prev, engine: fallbackEngine, voiceId: fallbackVoiceId }));
  }, [
      getValidVoiceIdForEngine,
      isPrimeEngineAllowed,
      primeAllowedEngines,
      settings.engine,
      settings.voiceId,
  ]);

  useEffect(() => {
      if (!isFreeTierUser) return;
      const validVoiceId = getValidVoiceIdForEngine(settings.engine, settings.voiceId);
      if (!validVoiceId || validVoiceId === settings.voiceId) return;
      setSettings((prev) => {
          if (prev.voiceId === validVoiceId) return prev;
          return { ...prev, voiceId: validVoiceId };
      });
  }, [getValidVoiceIdForEngine, isFreeTierUser, settings.engine, settings.voiceId]);

  const normalizeLanguageCode = useCallback((value?: string | null): string => {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return 'en';
      if (raw === 'auto') return 'en';
      return raw.split(/[-_]/)[0] || 'en';
  }, []);

  const inferLanguageFromSample = useCallback((sample: string): string => {
      const value = String(sample || '');
      if (!value.trim()) return 'unknown';
      if (/[\u0900-\u097F]/.test(value)) return 'hi';
      if (/\b(kya|kyu|kaise|main|tum|aap|hai|hain|tha|thi|kar|mera|meri|nahi|acha|accha)\b/i.test(value)) return 'hi';
      if (/[\u4e00-\u9fff]/.test(value)) return 'zh';
      if (/[\u3040-\u309f\u30a0-\u30ff]/.test(value)) return 'ja';
      if (/[\uac00-\ud7af]/.test(value)) return 'ko';
      return 'en';
  }, []);

  const resolveTextLanguageCode = useCallback((sample: string): string => {
      if (settings.language && settings.language !== 'Auto') {
          const configured = LANGUAGES.find(
              (entry) => entry.name === settings.language || entry.code.toLowerCase() === settings.language.toLowerCase()
          );
          return normalizeLanguageCode(configured?.code || settings.language);
      }
      const inferred = inferLanguageFromSample(sample);
      if (inferred !== 'unknown') return normalizeLanguageCode(inferred);
      if (detectedLang) return normalizeLanguageCode(detectedLang);
      if (settings.engine === 'VECTOR') return 'auto';
      return 'en';
  }, [detectedLang, inferLanguageFromSample, normalizeLanguageCode, settings.engine, settings.language]);

  const isHindiFamilyLanguage = useCallback((code: string): boolean => {
      return new Set(['hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'ur', 'ne', 'si']).has(code);
  }, []);

  type VoiceLanguageBucket = 'hi' | 'en' | 'other' | 'multi';

  const resolveVoiceLanguageBucket = useCallback((voice: VoiceOption): VoiceLanguageBucket => {
      const id = String(voice.id || '').toLowerCase();
      const accentMeta = String(voice.accent || '').toLowerCase();
      const nameMeta = String(voice.name || '').toLowerCase();
      const meta = `${nameMeta} ${accentMeta} ${voice.country || ''}`.toLowerCase();
      if (meta.includes('multilingual') || id.includes('multilingual')) return 'multi';

      const hindiLike =
          accentMeta.includes('hindi') ||
          accentMeta.includes('hinglish') ||
          nameMeta.includes('hindi') ||
          nameMeta.includes('devanagari') ||
          id.startsWith('hf_') ||
          id.startsWith('hm_') ||

          id.includes('_hi_');
      if (hindiLike) return 'hi';

      const englishLike =
          meta.includes('english') ||
          meta.includes('american') ||
          meta.includes('british') ||
          meta.includes('australian') ||
          meta.includes('canadian') ||
          meta.includes('irish') ||
          meta.includes('scottish') ||
          id.startsWith('af_') ||
          id.startsWith('am_') ||
          id.startsWith('bf_') ||
          id.startsWith('bm_') ||

          /^v\d+$/.test(id);
      if (englishLike) return 'en';
      return 'other';
  }, []);

  const voiceMatchesLanguage = useCallback(
      (voice: VoiceOption, engine: GenerationSettings['engine'], languageCode: string): boolean => {
          if (isGemRuntimeEngine(engine)) return true;
          const normalized = normalizeLanguageCode(languageCode);
          const bucket = resolveVoiceLanguageBucket(voice);
          if (bucket === 'multi') return true;
          if (isHindiFamilyLanguage(normalized)) return bucket === 'hi';
          if (normalized === 'en') return bucket === 'en';
          return bucket === 'en' || bucket === 'other';
      },
      [isGemRuntimeEngine, isHindiFamilyLanguage, normalizeLanguageCode, resolveVoiceLanguageBucket]
  );

  const getLanguageScopedVoiceCatalog = useCallback(
      (
          engine: GenerationSettings['engine'],
          languageCode: string,
          preserveVoiceIds: string[] = []
      ): VoiceOption[] => {
          const catalog = getEngineVoiceCatalog(engine);
          if (!catalog.length) return [];
          const filtered =
              isGemRuntimeEngine(engine)
                  ? catalog
                  : catalog.filter((voice) => voiceMatchesLanguage(voice, engine, languageCode));
          let scoped: VoiceOption[] = [];
          if (isGemRuntimeEngine(engine)) {
              scoped = catalog;
          } else if (filtered.length > 0 && filtered.length < catalog.length) {
              const preferred = new Set(filtered.map((voice) => voice.id));
              const fallback = catalog.filter((voice) => !preferred.has(voice.id));
              // Keep all voices visible while prioritizing matches for detected text language.
              scoped = [...filtered, ...fallback];
          } else {
              scoped = filtered.length > 0 ? filtered : catalog;
          }
          if (!preserveVoiceIds.length) return scoped;

          const seen = new Set(scoped.map((voice) => voice.id));
          const preserved = preserveVoiceIds
              .map((id) => catalog.find((voice) => voice.id === id))
              .filter((voice): voice is VoiceOption => {
                  if (!voice) return false;
                  return !seen.has(voice.id);
              });
          return [...preserved, ...scoped];
      },
      [getEngineVoiceCatalog, isGemRuntimeEngine, voiceMatchesLanguage]
  );

  const studioTextLanguageCode = useMemo(
      () => (isStudioWorkspaceTab ? resolveTextLanguageCode(text) : ''),
      [isStudioWorkspaceTab, resolveTextLanguageCode, text]
  );

  const activeScriptLanguageCode = studioTextLanguageCode;

  const studioParsedScript = useMemo(
      () => (isStudioWorkspaceTab ? parseMultiSpeakerScript(text) : EMPTY_PARSED_STUDIO_SCRIPT),
      [isStudioWorkspaceTab, text]
  );
  const studioCrewTags = useMemo(
      () => (studioParsedScript.crewTagsList || []).filter(Boolean),
      [studioParsedScript]
  );

  const castSpeakers = useMemo(() => {
      const names = new Set<string>();
      if (isStudioWorkspaceTab && text.trim()) {
          const parsed = studioParsedScript;
          parsed.speakersList
              .map((speaker) => speaker.trim())
              .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX')
              .forEach((speaker) => names.add(speaker));
      }
      if (!isStudioWorkspaceTab) {
          detectedSpeakers
              .map((speaker) => speaker.trim())
              .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX')
              .forEach((speaker) => names.add(speaker));
      }
      if (!names.size) names.add('Narrator');
      return [...names];
  }, [detectedSpeakers, isStudioWorkspaceTab, studioParsedScript, text]);
  const isStudioMultiSpeakerEnabled = settings.multiSpeakerEnabled !== false;
  const explicitStudioSpeakers = useMemo(
      () => studioParsedScript.speakersList.filter((speaker) => String(speaker || '').trim().length > 0),
      [studioParsedScript]
  );
  const hasStudioExplicitMultiSpeakerScript = explicitStudioSpeakers.length > 1;
  const shouldShowStudioQueuePanel = isStudioQueueModeEnabled;
  const normalizeStudioSpeakerHeaders = useCallback(
      (source: string): string => normalizeSpeakerHeaderScript(String(source || '')),
      []
  );
  const studioRailTabItems = useMemo(
    () =>
      STUDIO_RAIL_TAB_ITEMS.map((item) => ({
        ...item,
        disabled:
          item.id === 'voice'
            ? isStudioMultiSpeakerEnabled
            : item.id === 'cast'
              ? !isStudioMultiSpeakerEnabled
              : false,
      })),
    [isStudioMultiSpeakerEnabled]
  );
  const desktopDockTabItems = useMemo(
    () => studioRailTabItems.filter((item) => item.id !== 'mix' && item.id !== 'queue'),
    [studioRailTabItems]
  );
  const getStudioRailTabDotClassName = (isActive: boolean, isDisabled: boolean): string => {
    if (isActive) {
      return isDarkUi ? 'bg-cyan-300' : 'bg-cyan-500';
    }
    if (isDisabled) {
      return isDarkUi ? 'bg-slate-700/90' : 'bg-gray-300';
    }
    return isDarkUi ? 'bg-slate-500/80' : 'bg-slate-400';
  };
  const studioRailTabs = useManagedTabs({
    items: studioRailTabItems,
    activeId: studioRailTab,
    onChange: setStudioRailTab,
    label: 'Studio controls',
    idBase: 'studio-controls',
  });
  const creditsActionState = useMemo(
    () => getStudioCreditsActionState({
      isAuthenticated: hasSessionIdentity,
      isBuyingTokenPack,
      isRedeemingCoupon,
      couponCode,
    }),
    [couponCode, hasSessionIdentity, isBuyingTokenPack, isRedeemingCoupon]
  );

  const autoAssignCastVoices = useCallback(async () => {
      if (!isStudioMultiSpeakerEnabled) {
          showToast('Enable Multi-Speaker Mode first.', 'info');
          return;
      }
      if (!hasStudioExplicitMultiSpeakerScript) {
          showToast('Add at least two speaker-tagged lines like "[Speaker 1]: Dialogue" to use cast auto-assign.', 'info');
          return;
      }

      const scopedCatalog = getLanguageScopedVoiceCatalog(settings.engine, activeScriptLanguageCode);
      const catalog = scopedCatalog.length > 0 ? scopedCatalog : getEngineVoiceCatalog(settings.engine);
      const effectiveCatalog = isFreeTierUser
          ? catalog.filter((voice) => resolveVoiceAccessTier(settings.engine, voice) === 'free')
          : catalog;
      if (!effectiveCatalog.length) {
          showToast('No voices available for auto-assignment.', 'error');
          return;
      }

      const sourceScript = String(text || '').trim();
      if (!sourceScript.trim()) {
          showToast('Write or paste a script first.', 'info');
          return;
      }
      const canonicalSourceScript = normalizeStudioSpeakerHeaders(sourceScript);
      if (canonicalSourceScript !== sourceScript) {
          setText(canonicalSourceScript);
      }
      setIsAutoAssigningCast(true);
      try {
          const { inferSpeakerTraitHintsWithAi } = await loadGeminiService();
          const parsedSource = parseMultiSpeakerScript(canonicalSourceScript);
          const parsedSpeakers = parsedSource.speakersList
              .map((speaker) => String(speaker || '').trim())
              .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX');
          let resolvedSpeakers = [...parsedSpeakers];
          let traitHints: Record<string, { gender?: 'Male' | 'Female' | 'Unknown'; ageGroup?: 'Child' | 'Adult' | 'Elderly' | 'Unknown'; tone?: 'calm' | 'energetic' | 'serious' }> = {};

          try {
              const aiAnalysis = await inferSpeakerTraitHintsWithAi(canonicalSourceScript, settings, parsedSpeakers);
              if (aiAnalysis.speakers.length > 0) {
                  resolvedSpeakers = aiAnalysis.speakers;
              }
              traitHints = aiAnalysis.traitHints;
          } catch (error) {
              console.warn('[studio-cast] ai speaker detection failed, using local fallback', error);
          }

          if (!resolvedSpeakers.length) {
              showToast('No cast speakers found to map.', 'info');
              return;
          }

          const autoAssignOptions = {
              speakers: resolvedSpeakers,
              script: canonicalSourceScript,
              voices: effectiveCatalog,
              characterLibrary,
              traitHints,
              ...(settings.speakerMapping ? { currentMapping: settings.speakerMapping } : {}),
          };
          const { mapping: nextMapping, assignments } = refreshStudioSpeakerVoices(autoAssignOptions);

          if (!Object.keys(nextMapping).length) {
              showToast('No cast speakers available to auto-assign.', 'info');
              return;
          }

          startTransition(() => {
              setDetectedSpeakers(resolvedSpeakers);
          });

          assignments.forEach(({ speaker, voice, inferredGender, inferredAgeGroup }) => {
              if (BUILT_IN_VOICE_IDS.has(voice.id)) return;
              const existingCharacter = characterLibrary.find(
                  (item) => item.name.toLowerCase() === speaker.toLowerCase()
              );
              updateCharacter({
                  id: existingCharacter?.id || crypto.randomUUID(),
                  name: speaker,
                  voiceId: voice.id,
                  gender: voice.gender !== 'Unknown' ? voice.gender : inferredGender,
                  age:
                    resolveVoiceAgeGroup(voice) !== 'Unknown'
                      ? resolveVoiceAgeGroup(voice)
                      : (inferredAgeGroup !== 'Unknown' ? inferredAgeGroup : 'Adult'),
                  avatarColor: existingCharacter?.avatarColor || '#6366f1',
                  description: existingCharacter?.description || 'Auto-assigned from AI cast',
              });
          });

          setSettings((prev) => ({
              ...prev,
              speakerMapping: nextMapping,
          }));
          const mappedCount = assignments.length;
          const detectedCount = resolvedSpeakers.length;
          showToast(
              `AI refreshed ${detectedCount} speaker${detectedCount === 1 ? '' : 's'} and assigned ${mappedCount} voice${mappedCount === 1 ? '' : 's'}.`,
              'success'
          );
      } finally {
          setIsAutoAssigningCast(false);
      }
  }, [
    activeScriptLanguageCode,
    characterLibrary,
      getEngineVoiceCatalog,
      getLanguageScopedVoiceCatalog,
      isFreeTierUser,
      hasStudioExplicitMultiSpeakerScript,
      isStudioMultiSpeakerEnabled,
      resolveVoiceAccessTier,
      resolveVoiceAgeGroup,
      settings,
      settings.engine,
      settings.speakerMapping,
      showToast,
      text,
      refreshStudioSpeakerVoices,
      normalizeStudioSpeakerHeaders,
      updateCharacter,
  ]);

  const toggleStudioMultiSpeaker = useCallback(() => {
      const nextEnabled = !isStudioMultiSpeakerEnabled;
      setSettings((prev) => ({ ...prev, multiSpeakerEnabled: nextEnabled }));
      if (!nextEnabled) {
          setStudioRailTab('voice');
          return;
      }
      setStudioRailTab('cast');
  }, [isStudioMultiSpeakerEnabled]);

  const enableStudioMultiSpeaker = useCallback(() => {
      setSettings((prev) => (
          prev.multiSpeakerEnabled === false
              ? { ...prev, multiSpeakerEnabled: true }
              : prev
      ));
      setStudioRailTab('cast');
  }, []);

  const refreshEngineVoiceCatalog = useCallback(
      async (engine: GenerationSettings['engine'], _runtimeUrl?: string): Promise<VoiceOption[]> => {
          try {
              const { fetchEngineRuntimeVoices } = await loadTtsVoiceRegistryService();
              const voices = await fetchEngineRuntimeVoices(engine, studioApiBaseUrl, 7000);
              const normalizedVoices = voices.map((voice) => withVoiceMeta(voice, engine));
              const staticVoices = getStaticVoicesForEngine(engine);
              const mergedVoices = mergeVoiceCatalogs(normalizedVoices, staticVoices);
              setRuntimeVoiceCatalogs((prev) => ({ ...prev, [engine]: mergedVoices }));
              return mergedVoices;
          } catch {
              const staticVoices = getStaticVoicesForEngine(engine);
              setRuntimeVoiceCatalogs((prev) => ({ ...prev, [engine]: staticVoices }));
              return staticVoices;
          }
      },
      [getStaticVoicesForEngine, mergeVoiceCatalogs, studioApiBaseUrl, withVoiceMeta]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const snapshot = {
      fetchedAt: Date.now(),
      activeEngine: managedActiveEngine || settings.engine,
      engines: ENGINE_ORDER.reduce((acc, engine) => {
        acc[engine] = {
          ...(ttsRuntimeStatus[engine] || { state: 'offline', detail: 'Runtime status unavailable.' }),
          metadataSummary: formatRuntimeMetadataSummary(ttsRuntimeStatus[engine]),
        };
        return acc;
      }, {} as Record<ActiveTtsEngineKey, EngineRuntimeStatus & { metadataSummary: string }>),
    };
    try {
      (window as any).__vfLastTtsRuntimeStatus = snapshot;
      window.dispatchEvent(new CustomEvent(TTS_RUNTIME_STATUS_EVENT, { detail: snapshot }));
    } catch {
      // Keep telemetry best-effort only.
    }
  }, [managedActiveEngine, settings.engine, ttsRuntimeStatus]);

  const refreshTtsRuntimeStatus = useCallback(async (options?: { broadcast?: boolean }): Promise<void> => {
    if (runtimePollRefreshInFlightRef.current) {
      return runtimePollRefreshInFlightRef.current;
    }
    const selectedRuntimeEngine = managedActiveEngine || settings.engine;
    const idleDetail = `Idle (active: ${getEngineDisplayName(selectedRuntimeEngine)}). Switch to activate.`;
    const inFlight = (async () => {
      try {
        const { fetchTtsEngineStatus } = await loadMediaBackendService();
        const runtimePayload = await fetchTtsEngineStatus(studioApiBaseUrl, {
          engine: 'all',
          forceRefresh: Boolean(options?.broadcast),
        });
        const runtimeRows = runtimePayload?.engines && typeof runtimePayload.engines === 'object'
          ? runtimePayload.engines
          : {};

        const mappedStatuses = ENGINE_ORDER.reduce((acc, engine) => {
          const rawStatus = runtimeRows[engine];
          if (rawStatus) {
            acc[engine] = mapGatewayEngineRuntimeToUiStatus(rawStatus);
          }
          return acc;
        }, {} as Partial<Record<ActiveTtsEngineKey, EngineRuntimeStatus>>);

        const selectedStatus = mappedStatuses[selectedRuntimeEngine]
          || ttsRuntimeStatusRef.current[selectedRuntimeEngine]
          || {
            state: engineSwitchInProgress === selectedRuntimeEngine ? 'starting' : 'checking',
            detail: engineSwitchInProgress === selectedRuntimeEngine ? 'Starting runtime...' : 'Checking runtime status...',
          };

        setSelectedEngineTelemetry((prev) => {
          const existing = prev[selectedRuntimeEngine] ?? createSelectedEngineTelemetry();
          return {
            ...prev,
            [selectedRuntimeEngine]: {
              ...existing,
              kind: 'network',
              label: 'Status',
              detail: sanitizeUiText(selectedStatus.detail || 'Runtime status updated.') || 'Runtime status updated.',
              latencyMs: null,
              measuredAtMs: Date.now(),
            },
          };
        });

        setTtsRuntimeStatus((prev) => {
          const next = { ...prev };
          for (const engine of ENGINE_ORDER) {
            const mapped = mappedStatuses[engine];
            if (mapped) {
              next[engine] = mergeRuntimeStatus(prev[engine], mapped);
              continue;
            }
            if (engine === selectedRuntimeEngine) {
              next[engine] = mergeRuntimeStatus(prev[engine], selectedStatus);
              continue;
            }
            next[engine] = mergeRuntimeStatus(prev[engine], { state: 'standby', detail: idleDetail });
          }
          return next;
        });
      } catch (error: any) {
        const runtimeErrorDetail = sanitizeUiText(
          toUserFriendlySystemMessage(error?.message || error, 'Runtime health check failed.')
        ) || 'Runtime health check failed.';

        setSelectedEngineTelemetry((prev) => {
          const existing = prev[selectedRuntimeEngine] ?? createSelectedEngineTelemetry();
          return {
            ...prev,
            [selectedRuntimeEngine]: {
              ...existing,
              kind: 'error',
              label: 'Status',
              detail: runtimeErrorDetail,
              latencyMs: null,
              measuredAtMs: Date.now(),
            },
          };
        });

        setTtsRuntimeStatus((prev) => {
          const next = { ...prev };
          const currentSelected = prev[selectedRuntimeEngine];
          next[selectedRuntimeEngine] = mergeRuntimeStatus(currentSelected, {
            state: engineSwitchInProgress === selectedRuntimeEngine
              ? 'starting'
              : (currentSelected?.state === 'online' ? 'online' : 'offline'),
            detail: runtimeErrorDetail,
          });
          for (const engine of ENGINE_ORDER) {
            if (engine === selectedRuntimeEngine) continue;
            if (next[engine]?.state !== 'checking') continue;
            next[engine] = mergeRuntimeStatus(next[engine], { state: 'standby', detail: idleDetail });
          }
          return next;
        });
      }
    })().finally(() => {
        runtimePollRefreshInFlightRef.current = null;
      });
    runtimePollRefreshInFlightRef.current = inFlight;
    return inFlight;
  }, [
    engineSwitchInProgress,
    managedActiveEngine,
    settings.engine,
    studioApiBaseUrl,
    toUserFriendlySystemMessage,
  ]);

  useEffect(() => {
    if (!isStudioWorkspaceTab) {
      clearRuntimeAutoSelectSessionRun();
      cancelRuntimeAutoSelectProbe();
      return;
    }
    if (!hasSessionIdentity) {
      clearRuntimeAutoSelectSessionRun();
      cancelRuntimeAutoSelectProbe();
      return;
    }
    if (hasRuntimeAutoSelectSessionRun()) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    runtimeAutoSelectProbeInFlightRef.current = true;
    runtimeAutoSelectAbortControllerRef.current = null;
    try {
      const currentEngine = managedActiveEngine || settings.engine;
      const targetEngine = isPrimeEngineAllowed(currentEngine)
        ? currentEngine
        : (isPrimeEngineAllowed('PRIME') ? 'PRIME' : 'VECTOR');
      markRuntimeAutoSelectSessionRun();
      if (targetEngine === currentEngine) {
        return;
      }
      const targetCatalog = getEngineVoiceCatalog(targetEngine);
      const targetVoiceId = selectVoiceIdFromCatalog(targetEngine, targetCatalog, settings.voiceId);
      setManagedActiveEngine(targetEngine);
      setSettings((prev) => (
        prev.engine === targetEngine && prev.voiceId === targetVoiceId
          ? prev
          : { ...prev, engine: targetEngine, voiceId: targetVoiceId }
      ));
    } finally {
      runtimeAutoSelectProbeInFlightRef.current = false;
    }
  }, [
    cancelRuntimeAutoSelectProbe,
    getEngineVoiceCatalog,
    hasSessionIdentity,
    isPrimeEngineAllowed,
    managedActiveEngine,
    selectVoiceIdFromCatalog,
    setManagedActiveEngine,
    setSettings,
    settings.engine,
    settings.voiceId,
  ]);

  const ensureEngineOnline = async (
      engine: GenerationSettings['engine'],
      options?: {
        timeoutMs?: number;
        silent?: boolean;
        syncVoiceId?: string;
        requireAccess?: boolean;
        preferBrowserRuntime?: boolean;
        waitForOnline?: boolean;
        commitSettings?: boolean;
        signal?: AbortSignal;
      }
  ): Promise<{ runtimeUrl: string; catalog: VoiceOption[]; syncedVoiceId?: string }> => {
      throwIfSignalAborted(options?.signal);
      const engineLabel = getEngineDisplayName(engine);
      const shouldCommitSettings = options?.commitSettings !== false;
      if (!isPrimeEngineAllowed(engine)) {
          throw new Error(`${engineLabel} is not enabled for your current plan.`);
      }
      let runtimeUrl = getRuntimeUrlForEngine(engine);
      if (options?.requireAccess) {
          const access = await refreshTtsAccessState(true);
          if (!access.ok) {
              throw new Error(access.detail || 'Sign in again to enable AI/TTS requests.');
          }
      }
      const currentStatus = ttsRuntimeStatusRef.current[engine];
      const canReuseCurrentRuntime = Boolean(
        !engineSwitchInProgress
        && (managedActiveEngine === engine || settings.engine === engine)
        && currentStatus
        && currentStatus.state !== 'offline'
        && currentStatus.state !== 'not_configured'
      );
      if (canReuseCurrentRuntime) {
          const cachedCatalog = runtimeVoiceCatalogs[engine] || [];
          const shouldRefreshCatalog = cachedCatalog.length === 0;
          const refreshedCatalog = shouldRefreshCatalog
              ? await refreshEngineVoiceCatalog(engine, runtimeUrl).catch(() => cachedCatalog)
              : cachedCatalog;
          setManagedActiveEngine(engine);
          setTtsRuntimeStatus(prev => {
              const next = { ...prev };
                next[engine] = mergeRuntimeStatus(next[engine], {
                  state: currentStatus?.state || 'standby',
                  detail: currentStatus?.detail || 'Runtime status checks are disabled in compatibility mode.',
                });
              ENGINE_ORDER.forEach((other) => {
                  if (other === engine) return;
                  if (next[other].state === 'not_configured') return;
                    next[other] = mergeRuntimeStatus(next[other], { state: 'standby', detail: 'Idle (switch engine to activate).' });
              });
              return next;
          });
          let syncedVoiceId: string | undefined;
          if (options?.syncVoiceId) {
              const candidateVoiceId = options.syncVoiceId || settings.voiceId;
              const fallbackCatalog = refreshedCatalog.length > 0
                  ? refreshedCatalog
                  : getEngineVoiceCatalog(engine);
              const validVoiceId = selectVoiceIdFromCatalog(engine, fallbackCatalog, candidateVoiceId);
              syncedVoiceId = validVoiceId;
              if (shouldCommitSettings) {
                  setSettings((prev) => (
                      prev.engine === engine && prev.voiceId === validVoiceId
                          ? prev
                          : { ...prev, engine, voiceId: validVoiceId }
                  ));
              }
          }
          return {
              runtimeUrl,
              catalog: refreshedCatalog.length > 0 ? refreshedCatalog : getEngineVoiceCatalog(engine),
              ...(syncedVoiceId ? { syncedVoiceId } : {}),
          };
      }

      if (engineSwitchInProgress && engineSwitchInProgress !== engine) {
          throw new Error('Another TTS engine is currently starting. Please retry in a moment.');
      }

      setEngineSwitchInProgress(engine);
      setTtsRuntimeStatus(prev => ({
          ...prev,
            [engine]: mergeRuntimeStatus(prev[engine], { state: 'starting', detail: 'Starting runtime...' }),
      }));

      try {
          let switchResult;
          try {
              const { switchTtsEngineRuntime } = await loadMediaBackendService();
              switchResult = await switchTtsEngineRuntime(studioApiBaseUrl, engine);
          } catch (switchError: any) {
              const detail = String(switchError?.message || switchError || '').toLowerCase();
              if (
                  detail.includes('x-admin-unlock') ||
                  detail.includes('admin-unlock') ||
                  detail.includes('admin session unlock')
              ) {
                  throw new Error(`${engineLabel} activation is restricted by backend policy.`);
              }
              if (
                  detail.includes('unreachable') ||
                  detail.includes('fetch failed') ||
                  detail.includes('failed to fetch') ||
                  detail.includes('networkerror') ||
                  detail.includes('econnrefused')
              ) {
                  throw new Error(`Studio control plane is unreachable at ${studioApiBaseUrl}. Check service health and retry.`);
              }
              throw new Error(switchError?.message || `Failed to switch ${engineLabel} runtime.`);
          }

           const switchState = normalizeEngineRuntimeState(switchResult?.state, 'starting');
           if (switchState === 'not_configured') {
               throw new Error(switchResult?.detail || getRuntimeNotConfiguredMessage(engine));
           }
          if (switchState === 'offline') {
              throw new Error(switchResult?.detail || getRuntimeOfflineMessage(engine));
          }
          const switchHealthUrl = normalizeRuntimeUrl(switchResult?.healthUrl);
          if (switchHealthUrl) {
            runtimeUrl = switchHealthUrl;
          }
          setManagedActiveEngine(engine);
          setTtsRuntimeStatus(prev => {
              const next = { ...prev };
                next[engine] = mergeRuntimeStatus(next[engine], {
                    state: switchState === 'online' ? 'online' : 'starting',
                    detail: switchResult?.detail || (switchState === 'online' ? 'Runtime online' : 'Starting runtime...'),
                });
              ENGINE_ORDER.forEach((other) => {
                  if (other === engine) return;
                  if (next[other].state === 'not_configured') return;
                    next[other] = mergeRuntimeStatus(next[other], { state: 'standby', detail: 'Standby (auto-start on switch)' });
               });
               return next;
           });
           const refreshedCatalog = await refreshEngineVoiceCatalog(engine, runtimeUrl).catch(
             () => (
               runtimeVoiceCatalogs[engine]?.length > 0
                 ? runtimeVoiceCatalogs[engine]
                 : getEngineVoiceCatalog(engine)
             )
           );
           const optimisticOnline = switchState === 'online';
           setTtsRuntimeStatus(prev => ({
             ...prev,
             [engine]: mergeRuntimeStatus(prev[engine], {
              state: optimisticOnline ? 'online' : 'starting',
              detail: optimisticOnline
                ? 'Runtime online'
                : (switchResult?.detail || 'Runtime activation requested. Continuing without status polling.'),
             }),
           }));
           let syncedVoiceId: string | undefined;
           if (options?.syncVoiceId) {
               const candidateVoiceId = options.syncVoiceId || settings.voiceId;
               const fallbackCatalog = refreshedCatalog.length > 0
                   ? refreshedCatalog
                   : getEngineVoiceCatalog(engine);
               const validVoiceId = selectVoiceIdFromCatalog(engine, fallbackCatalog, candidateVoiceId);
               syncedVoiceId = validVoiceId;
               if (shouldCommitSettings) {
                   setSettings((prev) => (
                       prev.engine === engine && prev.voiceId === validVoiceId
                           ? prev
                           : { ...prev, engine, voiceId: validVoiceId }
                   ));
               }
           }
           if (!options?.silent) {
             if (optimisticOnline) {
               showToast(`${engineLabel} runtime is online.`, 'info');
             } else {
               showToast(`${engineLabel} activation requested. Continuing without runtime polling.`, 'info');
             }
           }
           return {
               runtimeUrl,
               catalog: refreshedCatalog,
              ...(syncedVoiceId ? { syncedVoiceId } : {}),
          };
      } catch (error: any) {
          if ((error as { name?: string } | null)?.name === 'AbortError') {
              setManagedActiveEngine(settings.engine);
              setTtsRuntimeStatus((prev) => ({
                ...prev,
                [engine]: mergeRuntimeStatus(prev[engine], {
                  state: 'standby',
                  detail: `${engineLabel} activation cancelled.`,
                }),
              }));
              throw error;
          }
          const reason = error?.message || 'Unknown runtime error';
          setTtsRuntimeStatus(prev => ({
            ...prev,
            [engine]: mergeRuntimeStatus(prev[engine], { state: 'offline', detail: reason }),
          }));
          throw new Error(reason);
      } finally {
          setEngineSwitchInProgress(null);
          void refreshTtsRuntimeStatus();
      }
  };

  const ensureEngineOnlineRef = useRef(ensureEngineOnline);
  useEffect(() => {
      ensureEngineOnlineRef.current = ensureEngineOnline;
  }, [ensureEngineOnline]);

  const refreshBackendHealth = async (silent: boolean = false, options?: { forceRefresh?: boolean }) => {
      setIsCheckingBackend(true);
      try {
          const { checkMediaBackendHealth } = await loadMediaBackendService();
          const health = await checkMediaBackendHealth(studioApiBaseUrl, { forceRefresh: Boolean(options?.forceRefresh) });
          const ffmpegMissing = !health.ffmpeg?.available;
          const whisperError = Boolean(health.whisper?.error);
          const hasSubsystemError = ffmpegMissing || whisperError;
          const severity: HealthSeverity = ffmpegMissing || !health.ok
            ? 'error'
            : hasSubsystemError
              ? 'warn'
              : 'ok';
          const languageHint = Array.isArray(health.whisper?.supportedLanguages)
            ? health.whisper?.supportedLanguages.join('/')
            : 'n/a';
          const summary = [
              health.ffmpeg?.available ? 'FFmpeg OK' : 'FFmpeg Missing',
              health.whisper?.error ? 'Whisper Error' : `Whisper ${health.whisper?.loaded ? 'Loaded' : 'Idle'} (${languageHint})`,
          ].join(' | ');
          setBackendHealth({ ok: Boolean(health.ok) && !ffmpegMissing, summary: sanitizeUiText(summary), severity });
      } catch (e: any) {
          const message = toUserFriendlySystemMessage(e?.message, 'Backend unreachable');
          setBackendHealth({ ok: false, summary: message, severity: 'error' });
          if (!silent) {
              showToast(message, 'error');
          }
          if (hasSessionIdentity && /unreachable|timeout|failed to fetch|network|econn|enotfound/i.test(message)) {
              void rediscoverBackendRouting('backend_health_probe_failed');
          }
      } finally {
          setIsCheckingBackend(false);
      }
  };

  // --- Effects ---
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiTheme, uiTheme); }, [uiTheme]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiBrandTheme, uiBrandTheme); }, [uiBrandTheme]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.studioSidebarMode, sidebarMode); }, [sidebarMode]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiFontScale, String(uiFontScale)); }, [uiFontScale]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiMotionLevel, uiMotionLevel); }, [uiMotionLevel]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.studioEditorMode, studioEditorMode); }, [studioEditorMode]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.workspaceActiveTab, activeTab); }, [activeTab]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.studioRailTab, studioRailTab); }, [studioRailTab]);
  useEffect(() => {
      if (!speakerVcReferenceStorageReadyRef.current) return;
      const safeMap = normalizeSpeakerVcReferenceMap(speakerVcReferenceMap);
      const stored = readStorageJson(STORAGE_KEYS.studioSpeakerVcReferences);
      const scopedStore: SpeakerVcReferenceStore = {};
      if (stored && typeof stored === 'object' && !Array.isArray(stored) && !hasSpeakerVcReferencePayloadShape(stored)) {
          Object.entries(stored as Record<string, unknown>).forEach(([rawKey, rawValue]) => {
              const ownerKey = String(rawKey || '').trim();
              if (!ownerKey) return;
              const ownerMap = normalizeSpeakerVcReferenceMap(rawValue);
              if (Object.keys(ownerMap).length === 0) return;
              scopedStore[ownerKey] = ownerMap;
          });
      }
      if (Object.keys(safeMap).length === 0) {
          delete scopedStore[speakerVcReferenceOwnerKey];
      } else {
          scopedStore[speakerVcReferenceOwnerKey] = safeMap;
      }
      if (Object.keys(scopedStore).length === 0) {
          removeStorageKey(STORAGE_KEYS.studioSpeakerVcReferences);
          return;
      }
      writeStorageJson(STORAGE_KEYS.studioSpeakerVcReferences, scopedStore);
  }, [speakerVcReferenceMap, speakerVcReferenceOwnerKey]);
  useEffect(() => {
      setMountedWorkspaceTabs((previous) => {
          if (previous[activeTab]) return previous;
          return { ...previous, [activeTab]: true };
      });
  }, [activeTab]);
  useEffect(() => {
      if (typeof window === 'undefined') return;
      const host = String(window.location.hostname || '').trim().toLowerCase();
      const isLocalHost = host === 'localhost' || host === '127.0.0.1';
      if (!isLocalHost) return;

      let sessionId = '';
      try {
          sessionId = String(window.sessionStorage.getItem(DEV_SESSION_STORAGE_KEY) || '').trim();
          if (!sessionId) {
              sessionId = createDevSessionId();
              window.sessionStorage.setItem(DEV_SESSION_STORAGE_KEY, sessionId);
          }
      } catch {
          sessionId = createDevSessionId();
      }

      let hasSentCloseSignal = false;
      const sendSessionSignal = (event: 'heartbeat' | 'close') => {
          if (event === 'close') {
              if (hasSentCloseSignal) return;
              hasSentCloseSignal = true;
          } else if (hasSentCloseSignal) {
              return;
          }
          if (event === 'heartbeat') {
              try {
                  window.sessionStorage.setItem(DEV_SESSION_LAST_HEARTBEAT_AT_KEY, String(Date.now()));
              } catch {
                  // no-op
              }
          }
          const payload = JSON.stringify({
              sessionId,
              event,
              path: window.location.pathname,
              at: Date.now(),
          });
          if (event === 'close' && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
              try {
                  const blob = new Blob([payload], { type: 'application/json' });
                  if (navigator.sendBeacon(DEV_SESSION_HEARTBEAT_ENDPOINT, blob)) return;
              } catch {
                  // Fall through to fetch keepalive.
              }
          }
          void fetch(DEV_SESSION_HEARTBEAT_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payload,
              cache: 'no-store',
              keepalive: event === 'close',
          }).catch(() => undefined);
      };

      let shouldSendInitialHeartbeat = true;
      try {
          const previousHeartbeatAt = Number(window.sessionStorage.getItem(DEV_SESSION_LAST_HEARTBEAT_AT_KEY) || 0);
          if (Number.isFinite(previousHeartbeatAt) && Date.now() - previousHeartbeatAt < 2000) {
              shouldSendInitialHeartbeat = false;
          }
      } catch {
          // Continue with initial heartbeat when storage is unavailable.
      }
      if (shouldSendInitialHeartbeat) {
          sendSessionSignal('heartbeat');
      }
      const heartbeatId = window.setInterval(() => {
          sendSessionSignal('heartbeat');
      }, DEV_SESSION_HEARTBEAT_INTERVAL_MS);
      const onPageExit = () => sendSessionSignal('close');
      window.addEventListener('pagehide', onPageExit);
      window.addEventListener('beforeunload', onPageExit);
      return () => {
          window.clearInterval(heartbeatId);
          window.removeEventListener('pagehide', onPageExit);
          window.removeEventListener('beforeunload', onPageExit);
          sendSessionSignal('close');
      };
  }, []);
  useEffect(() => {
      if (!isStudioWorkspaceTab || !studioWorkspaceBootHydratedRef.current) return;
      const nextDraft = String(text || '').slice(0, STUDIO_EDITOR_HARD_CAP);
      const persistDraft = () => {
          if (!nextDraft.trim()) {
              removeStorageKey(STORAGE_KEYS.studioDraftText);
              return;
          }
          writeStorageString(STORAGE_KEYS.studioDraftText, nextDraft);
      };
      const timeoutId = window.setTimeout(persistDraft, STUDIO_DRAFT_PERSIST_DEBOUNCE_MS);
      return () => window.clearTimeout(timeoutId);
  }, [isStudioWorkspaceTab, text]);
  useEffect(() => {
      if (!isStudioWorkspaceTab) return;
      if (isStudioMultiSpeakerEnabled && studioRailTab === 'voice') {
          setStudioRailTab('cast');
          return;
      }
      if (!isStudioMultiSpeakerEnabled && studioRailTab === 'cast') {
          setStudioRailTab('voice');
      }
  }, [isStudioMultiSpeakerEnabled, isStudioWorkspaceTab, studioRailTab]);
  useEffect(() => {
      if (!isDesktop || !isStudioWorkspaceTab) return;
      if (studioRailTab !== 'mix') return;
      const fallbackTab = desktopDockTabItems.find((item) => !item.disabled)?.id || 'voice';
      if (fallbackTab !== studioRailTab) {
          setStudioRailTab(fallbackTab);
      }
  }, [desktopDockTabItems, isDesktop, isStudioWorkspaceTab, studioRailTab]);
  useEffect(() => {
      if (isStudioWorkspaceTab) return;
      setIsStudioEditorFullscreen(false);
  }, [isStudioWorkspaceTab]);
  useEffect(() => {
      const handleFullscreenEscape = (event: KeyboardEvent) => {
          if (event.key !== 'Escape') return;
          if (!isStudioEditorFullscreen) return;
          event.preventDefault();
          event.stopPropagation();
          setIsStudioEditorFullscreen(false);
      };

      window.addEventListener('keydown', handleFullscreenEscape, true);
      return () => {
          window.removeEventListener('keydown', handleFullscreenEscape, true);
      };
  }, [isStudioEditorFullscreen]);
  useEffect(() => {
      const handlePointerDown = (event: MouseEvent) => {
          const target = event.target;
          if (!(target instanceof Node)) return;

          if (
              isCreditsSurfaceOpen &&
              !creditsSurfaceRef.current?.contains(target) &&
              !creditsSurfaceTriggerRef.current?.contains(target)
          ) {
              setIsCreditsSurfaceOpen(false);
          }
      };

      const handleEscape = (event: KeyboardEvent) => {
          if (event.key !== 'Escape') return;
          if (isCreditsSurfaceOpen) setIsCreditsSurfaceOpen(false);
      };

      window.addEventListener('mousedown', handlePointerDown);
      window.addEventListener('keydown', handleEscape);
      return () => {
          window.removeEventListener('mousedown', handlePointerDown);
          window.removeEventListener('keydown', handleEscape);
      };
  }, [isCreditsSurfaceOpen]);
  useEffect(() => {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      const mobileSafeBottom =
        isStudioWorkspaceTab
          ? (isChatOpen
              ? 'calc(env(safe-area-inset-bottom) + 20.5rem)'
              : 'calc(env(safe-area-inset-bottom) + 11.5rem)')
          : 'calc(env(safe-area-inset-bottom) + 9.5rem)';
      root.style.setProperty('--vf-toast-mobile-safe-bottom', mobileSafeBottom);
      return () => {
          root.style.removeProperty('--vf-toast-mobile-safe-bottom');
      };
  }, [isChatOpen, isStudioWorkspaceTab]);
  useEffect(() => {
      if (typeof document === 'undefined') return;
      document.documentElement.setAttribute('data-vf-settings-open', showSettings ? 'true' : 'false');
      return () => {
          document.documentElement.setAttribute('data-vf-settings-open', 'false');
      };
  }, [showSettings]);
  useEffect(() => {
      if (!hasSessionIdentity) {
          lastRuntimeStatesRef.current = ENGINE_ORDER.reduce((acc, engine) => {
              acc[engine] = ttsRuntimeStatus[engine]?.state || 'standby';
              return acc;
          }, {} as Record<ActiveTtsEngineKey, EngineRuntimeState>);
          return;
      }
      for (const engine of ENGINE_ORDER) {
          const previous = lastRuntimeStatesRef.current[engine];
          const next = ttsRuntimeStatus[engine]?.state || 'offline';
          if (!previous || previous === next) continue;
          const isSelectedEngine = engine === settings.engine || engine === managedActiveEngine;
          if (previous !== 'checking') {
              const engineLabel = getEngineDisplayName(engine);
              if (next === 'online') {
                  emit('runtime.online', {
                      entityKey: engine,
                      title: 'Runtime Online',
                      message: `${engineLabel} runtime is online.`,
                      dedupeKey: `runtime-online-${engine}`,
                      channel: 'inbox',
                  });
              } else if (next === 'offline') {
                  if (!isSelectedEngine) {
                      lastRuntimeStatesRef.current[engine] = next;
                      continue;
                  }
                  emit('runtime.offline', {
                      entityKey: engine,
                      title: 'Runtime Offline',
                      message: `${engineLabel} runtime is offline. Start services or retry activation.`,
                      sticky: true,
                      dedupeKey: `runtime-offline-${engine}`,
                      channel: isSelectedEngine ? 'toast' : 'inbox',
                      action: {
                          label: 'Open Settings',
                          onClick: () => setShowSettings(true),
                      },
                  });
              } else if (next === 'starting') {
                  emit('runtime.starting', {
                      entityKey: engine,
                      title: 'Runtime Starting',
                      message: `${engineLabel} runtime is starting...`,
                      dedupeKey: `runtime-starting-${engine}`,
                      channel: 'inbox',
                  });
              }
          }
          lastRuntimeStatesRef.current[engine] = next;
      }
  }, [emit, hasSessionIdentity, managedActiveEngine, settings.engine, ttsRuntimeStatus]);
  useEffect(() => {
      if (!hasSessionIdentity) {
          lastTtsAccessBlockedRef.current = ttsAccessState.blocked;
          return;
      }
      const previous = lastTtsAccessBlockedRef.current;
      const blocked = ttsAccessState.blocked;
      if (previous === null) {
          lastTtsAccessBlockedRef.current = blocked;
          return;
      }
      if (previous === blocked) return;
      if (blocked) {
          emit('custom.message', {
              title: 'TTS Access Blocked',
              message: sanitizeUiText(ttsAccessState.detail || 'Sign in again to enable AI/TTS requests.'),
              severity: 'warning',
              category: 'security',
              sticky: true,
              dedupeKey: 'tts-access-blocked',
              channel: 'toast',
          });
      } else {
          emit('custom.message', {
              title: 'TTS Access Restored',
              message: 'Authentication restored. AI/TTS requests are available again.',
              severity: 'info',
              category: 'system',
              dedupeKey: 'tts-access-restored',
              channel: 'inbox',
          });
      }
      lastTtsAccessBlockedRef.current = blocked;
  }, [emit, ttsAccessState.blocked, ttsAccessState.detail]);
  useEffect(() => {
      if (!ttsAccessState.blocked) {
          ttsAccessClockRetryAtRef.current = 0;
          return;
      }
      if (!isTokenTimingAuthMessage(ttsAccessState.detail)) return;
      const now = Date.now();
      if (now - ttsAccessClockRetryAtRef.current < 15000) return;
      ttsAccessClockRetryAtRef.current = now;
      const retryTimer = window.setTimeout(() => {
          void refreshTtsAccessState(true);
      }, 3500);
      return () => window.clearTimeout(retryTimer);
  }, [isTokenTimingAuthMessage, refreshTtsAccessState, ttsAccessState.blocked, ttsAccessState.detail]);
  useEffect(() => {
      if (hasUnlimitedAccess) return;
      const dayKey = String(stats.vfUsage?.daily?.key || new Date().toISOString().slice(0, 10));
      const lowBalanceThreshold = 600;

      const issueNotice = (
        key: string,
        send: () => void
      ) => {
          if (quotaNoticeRef.current[key]) return;
          quotaNoticeRef.current[key] = true;
          send();
      };

      if (currentEngineSpendable <= lowBalanceThreshold && currentEngineSpendable > 0) {
          issueNotice(`${dayKey}-low-balance-${settings.engine}`, () => {
              emit('wallet.low_balance', {
                title: 'Low Balance',
                message: `Low ${getEngineDisplayName(settings.engine)} balance: ${currentEngineSpendable.toLocaleString()} VF remaining.`,
                dedupeKey: `${dayKey}-low-balance-${settings.engine}`,
                channel: 'inbox',
              });
          });
      }
  }, [
      currentEngineSpendable,
      emit,
      hasUnlimitedAccess,
      settings.engine,
      stats.vfUsage?.daily?.key,
  ]);
  useEffect(() => {
      if (!backendHealth) return;
      const previous = lastBackendHealthyRef.current;
      if (previous === null) {
          lastBackendHealthyRef.current = backendHealth.ok;
          return;
      }
      if (previous !== backendHealth.ok) {
          if (backendHealth.ok) {
              emit('backend.online', {
                  title: 'Backend Online',
                  message: 'Backend connectivity restored.',
                  dedupeKey: 'backend-online',
                  channel: 'inbox',
              });
          } else {
              emit('backend.offline', {
                  title: 'Backend Unreachable',
                  message: toUserFriendlySystemMessage(backendHealth.summary, 'Backend unreachable.'),
                  sticky: true,
                  dedupeKey: 'backend-offline',
                  action: {
                      label: 'Retry',
                      onClick: () => { void refreshBackendHealth(false, { forceRefresh: true }); },
                  },
              });
          }
      }
      lastBackendHealthyRef.current = backendHealth.ok;
  }, [backendHealth, emit, toUserFriendlySystemMessage]);
  useEffect(() => {
      setSettings((prev) => (prev.uiMotionLevel === uiMotionLevel ? prev : { ...prev, uiMotionLevel }));
  }, [uiMotionLevel]);
  useEffect(() => {
      setSettings((prev) => {
          const next = {
              ...prev,
              geminiTtsServiceUrl: normalizeServiceSetting(prev.geminiTtsServiceUrl, FALLBACK_RUNTIME_URLS.PRIME),
          };
          if (
              next.geminiTtsServiceUrl === prev.geminiTtsServiceUrl
          ) {
              return prev;
          }
          return next;
      });
  }, []);

  useEffect(() => {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const applyTheme = () => {
          const nextTheme = uiTheme === 'system' ? (media.matches ? 'dark' : 'light') : uiTheme;
          setResolvedTheme(nextTheme);
      };

      applyTheme();
      if (uiTheme !== 'system') return () => {};

      media.addEventListener('change', applyTheme);
      return () => media.removeEventListener('change', applyTheme);
  }, [uiTheme]);

  useEffect(() => {
      let cancelled = false;
      const startupProbeController = new AbortController();
      ttsAccessProbeRef.current = null;
      setTtsAccessState({
          blocked: !hasSessionIdentity,
          detail: hasSessionIdentity ? 'Checking authentication...' : 'Sign in to enable AI/TTS requests.',
          checkedAt: 0,
      });
      if (!hasSessionIdentity) {
          ttsAccessProbeAbortControllerRef.current?.abort();
          ttsAccessProbeInFlightRef.current = null;
          clearNearestBackendRoutingState();
          return () => {
              cancelled = true;
              startupProbeController.abort();
          };
      }
      void (async () => {
          try {
              const authStateReady = (firebaseAuth as { authStateReady?: () => Promise<void> }).authStateReady;
              if (typeof authStateReady === 'function') {
                  await authStateReady.call(firebaseAuth).catch(() => undefined);
              }
              if (cancelled) return;
              await applyNearestBackendRoutingOnLogin({ signal: startupProbeController.signal });
              if (cancelled) return;
              await refreshTtsAccessState(true, { signal: startupProbeController.signal });
          } catch (error: unknown) {
              if (error instanceof Error && error.name === 'AbortError') return;
              const detail = sanitizeUiText(
                mapTtsAccessBlockReason(error instanceof Error ? error.message : error, 'Sign in again to enable AI/TTS requests.')
              ) || 'Sign in again to enable AI/TTS requests.';
              const checkedAt = Date.now();
              ttsAccessProbeRef.current = { ok: false, detail, checkedAt };
              setTtsAccessState({ blocked: true, detail, checkedAt });
              console.warn('[studio.auth_startup_probe]', error);
          }
      })();
      return () => {
          cancelled = true;
          startupProbeController.abort();
      };
  }, [hasSessionIdentity, mapTtsAccessBlockReason, refreshTtsAccessState, user.uid, user.userId, user.email]);

  useEffect(() => {
      if (!isStudioWorkspaceTab) return undefined;
      const onVisibility = () => {
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
          void refreshTtsRuntimeStatus();
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', onVisibility);
      return () => {
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('focus', onVisibility);
      };
  }, [isStudioWorkspaceTab, refreshTtsRuntimeStatus]);

  useEffect(() => {
      if (!hasSessionIdentity) {
          setSelectedEngineTelemetry(
            ENGINE_ORDER.reduce((acc, engine) => {
                acc[engine] = createSelectedEngineTelemetry({
                    label: 'Sign in',
                    detail: 'Sign in to measure latency.',
                });
                return acc;
            }, {} as Record<ActiveTtsEngineKey, SelectedEngineTelemetry>)
          );
      }
  }, [hasSessionIdentity]);

  useEffect(() => {
      if (!isStudioWorkspaceTab) return;
      if (!hasSessionIdentity) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (runtimeAutoSelectProbeInFlightRef.current) return;
      const currentTelemetry = selectedEngineTelemetry[settings.engine];
      if (!shouldRefreshSelectedEngineTelemetry(currentTelemetry, Date.now())) return;
      void refreshTtsRuntimeStatus({ broadcast: false });
  }, [hasSessionIdentity, isStudioWorkspaceTab, refreshTtsRuntimeStatus, selectedEngineTelemetry, settings.engine]);

  useEffect(() => {
      if (!isStudioWorkspaceTab) return;
      const validVoiceId = getValidVoiceIdForEngine(settings.engine, settings.voiceId);
      if (validVoiceId === settings.voiceId) return;

      const catalog = getEngineVoiceCatalog(settings.engine);
      const validIds = new Set(catalog.map((voice) => voice.id));
      const fallbackVoiceId = catalog[0]?.id || validVoiceId;
      setSettings((prev) => {
          const refreshedMapping: Record<string, string> = {};
          Object.entries(prev.speakerMapping || {}).forEach(([speaker, mappedVoiceId]) => {
              refreshedMapping[speaker] = validIds.has(mappedVoiceId) ? mappedVoiceId : fallbackVoiceId;
          });
          return {
              ...prev,
              voiceId: validVoiceId,
              speakerMapping: refreshedMapping,
          };
      });
  }, [isStudioWorkspaceTab, settings.engine, settings.voiceId, getValidVoiceIdForEngine, getEngineVoiceCatalog]);

  useEffect(() => {
      if (!isStudioWorkspaceTab) return;
      const scoped = getLanguageScopedVoiceCatalog(settings.engine, studioTextLanguageCode);
      if (!scoped.length) return;
      if (scoped.some((voice) => voice.id === settings.voiceId)) return;
      const fallbackVoiceId = scoped[0]?.id;
      if (!fallbackVoiceId) return;
      setSettings((prev) => ({ ...prev, voiceId: fallbackVoiceId }));
  }, [
      getLanguageScopedVoiceCatalog,
      isStudioWorkspaceTab,
      settings.engine,
      settings.voiceId,
      studioTextLanguageCode,
  ]);

  useEffect(() => {
      if (!isStudioWorkspaceTab) return;
      if (!castSpeakers.length) return;

      const scoped = getLanguageScopedVoiceCatalog(settings.engine, activeScriptLanguageCode);
      const catalog = scoped.length > 0 ? scoped : getEngineVoiceCatalog(settings.engine);
      if (!catalog.length) return;
      const validIds = new Set(catalog.map((voice) => voice.id));
      const fallbackVoiceId = catalog[0]?.id;
      if (!fallbackVoiceId) return;

      setSettings((prev) => {
          let nextMapping = { ...(prev.speakerMapping || {}) };
          let changed = false;

          castSpeakers.forEach((speaker, idx) => {
              const current = resolveSpeakerMappedVoiceId(nextMapping, speaker);
              if (current && validIds.has(current)) return;

              const rememberedVoiceId = getVoiceForCharacter(speaker);
              if (rememberedVoiceId && validIds.has(rememberedVoiceId)) {
                  const currentMapped = resolveSpeakerMappedVoiceId(nextMapping, speaker);
                  if (currentMapped !== rememberedVoiceId) {
                      nextMapping = upsertSpeakerVoiceMapping(speaker, rememberedVoiceId, nextMapping);
                      changed = true;
                  }
                  return;
              }

              const candidate = catalog[idx % Math.max(catalog.length, 1)]?.id || fallbackVoiceId;
              if (resolveSpeakerMappedVoiceId(nextMapping, speaker) !== candidate) {
                  nextMapping = upsertSpeakerVoiceMapping(speaker, candidate, nextMapping);
                  changed = true;
              }
          });

          return changed ? { ...prev, speakerMapping: nextMapping } : prev;
      });
  }, [
      activeScriptLanguageCode,
      castSpeakers,
      getEngineVoiceCatalog,
      getLanguageScopedVoiceCatalog,
      getVoiceForCharacter,
      isStudioWorkspaceTab,
      settings.engine,
      upsertSpeakerVoiceMapping,
  ]);

  useEffect(() => {
      const handleRuntimeDiagnostics = (event: Event) => {
          const detail = ((event as CustomEvent<RuntimeDiagnosticsEventDetail>).detail || {}) as RuntimeDiagnosticsEventDetail;
          const retryChunks = Number(detail.retryChunks || 0);
          const qualityGuardRecoveries = Number(detail.qualityGuardRecoveries || 0);
          const splitChunks = Number(detail.splitChunks || 0);
          const recoveryUsed = Boolean(
              detail.recoveryUsed ||
              retryChunks > 0 ||
              qualityGuardRecoveries > 0 ||
              splitChunks > 0
          );
          if (!recoveryUsed) return;

          const traceId = String(detail.traceId || '').trim();
          if (traceId) {
              if (seenRuntimeDiagnosticsTracesRef.current.has(traceId)) return;
              seenRuntimeDiagnosticsTracesRef.current.add(traceId);
              if (seenRuntimeDiagnosticsTracesRef.current.size > 200) {
                  seenRuntimeDiagnosticsTracesRef.current.clear();
                  seenRuntimeDiagnosticsTracesRef.current.add(traceId);
              }
          }

          const engineLabel = String(detail.engine || '').trim()
            ? getEngineDisplayName(resolveEngineToken(detail.engine) as GenerationSettings['engine'])
            : sanitizeUiText(String(detail.runtimeLabel || 'TTS Runtime').trim());
          emit('runtime.recovered', {
            title: 'Runtime Recovery',
            message: `${engineLabel} auto-recovered and continued generation.`,
            channel: 'inbox',
            ...(traceId ? { dedupeKey: `runtime-recovery-${traceId}` } : {}),
          });
      };
      window.addEventListener(TTS_RUNTIME_DIAGNOSTICS_EVENT, handleRuntimeDiagnostics as EventListener);
      return () => window.removeEventListener(TTS_RUNTIME_DIAGNOSTICS_EVENT, handleRuntimeDiagnostics as EventListener);
  }, [emit]);

  useEffect(() => {
      const handleGatewayProgress = (event: Event) => {
          const detail = ((event as CustomEvent<GatewayJobProgressEventDetail>).detail || {}) as GatewayJobProgressEventDetail;
          const generationActive = Boolean(generationAbortController.current || isStudioQueueRunActiveRef.current);
          if (!generationActive && !isGenerating) return;
          const queueState = studioQueueStateRef.current;
          const activeQueueItemId = String(activeStudioQueueItemIdRef.current || '').trim();
          const activeQueueItem = activeQueueItemId
              ? queueState?.items.find((item) => item.id === activeQueueItemId) || null
              : null;
          const expectedEngine = resolveEngineToken(activeQueueItem?.settingsSnapshot.engine || settings.engine || 'PRIME');
          const detailEngine = String(detail.engine || '').trim()
            ? resolveEngineToken(detail.engine)
            : '';
          if (detailEngine && expectedEngine && detailEngine !== expectedEngine) return;
          const detailRequestId = String(detail.requestId || '').trim();
          const activeRequestId = String(activeGatewayRequestIdRef.current || '').trim();
          if (detailRequestId) {
              if (activeRequestId && detailRequestId !== activeRequestId) return;
              if (!activeRequestId) activeGatewayRequestIdRef.current = detailRequestId;
          }
          const detailJobId = String(detail.jobId || '').trim();
          const activeJobId = String(activeGatewayJobIdRef.current || '').trim();
          if (detailJobId) {
              if (activeJobId && detailJobId !== activeJobId) return;
              if (!activeJobId) activeGatewayJobIdRef.current = detailJobId;
              if (activeQueueItem && String(activeQueueItem.jobId || '').trim() !== detailJobId) {
                  setStudioQueueState((prev) => {
                      if (!prev) return prev;
                      return {
                          ...prev,
                          items: prev.items.map((item) => (
                              item.id === activeQueueItem.id
                                  ? {
                                      ...item,
                                      jobId: detailJobId,
                                      requestId: String(item.requestId || activeGatewayRequestIdRef.current || detailRequestId || '').trim() || undefined,
                                    }
                                  : item
                          )),
                      };
                  });
              } else if (!activeQueueItem && singleInflightLedgerRef.current) {
                  patchSingleInflightGenerationLedger({
                      jobId: detailJobId,
                      requestId: detailRequestId || activeGatewayRequestIdRef.current || singleInflightLedgerRef.current.requestId,
                  });
              }
          }
          const pct = Number(detail.progressPct || 0);
          const stage = String(detail.stage || '').trim();
          generationActivityAtRef.current = Date.now();
          const stageLower = stage.toLowerCase();
          if (stageLower.includes('queued') && Number(detail.queueAgeMs || 0) >= 12_000) {
              const queueNoticeKey = String(detailRequestId || detailJobId || activeRequestId || activeJobId || expectedEngine || 'queue')
                .trim()
                || 'queue';
              emit('custom.message', {
                  title: 'Generation Delayed',
                  message: VOICE_GENERATION_DELAY_NOTICE,
                  details: Number(detail.queueDepth || 0) > 0
                    ? `Queue position is moving. We'll keep your request and start it as soon as a server is free.`
                    : `We're holding your request and will start it as soon as a server is free.`,
                  category: 'activity',
                  channel: 'toast',
                  dedupeKey: `generation-delay:${queueNoticeKey}`,
              }, { cooldownMs: 30_000 });
          }
          if (
              !generationFirstAudioAtRef.current
              && stageLower.includes('first live chunk ready')
          ) {
              const firstAudioAtMs = Date.now();
              generationFirstAudioAtRef.current = firstAudioAtMs;
              if (activeQueueItem?.id) {
                  const currentTiming = queueItemTimingRef.current[activeQueueItem.id];
                  if (currentTiming && !currentTiming.firstAudioAtMs) {
                      currentTiming.firstAudioAtMs = firstAudioAtMs;
                  }
              }
          }
          if (isStudioQueueRunActiveRef.current && queueState?.items.length) {
              const orderedItems = [...queueState.items].sort((left, right) => left.order - right.order);
              const totalItems = Math.max(1, orderedItems.length);
              const completedCount = orderedItems.filter((item) => item.status === 'completed').length;
              const activeIndex = activeQueueItem
                  ? Math.max(0, orderedItems.findIndex((item) => item.id === activeQueueItem.id))
                  : completedCount;
              const fractional = Number.isFinite(pct) && pct > 0 ? Math.max(0, Math.min(1, pct / 100)) : 0;
              const overallPct = Math.max(
                  6,
                  Math.min(98, Math.round(((completedCount + fractional) / totalItems) * 100))
              );
              const queueStage = stage
                  ? `Queue ${Math.min(totalItems, activeIndex + 1)}/${totalItems}: ${stage}`
                  : `Queue ${Math.min(totalItems, activeIndex + 1)}/${totalItems} in progress`;
              setProgress((prev) => Math.max(prev, overallPct));
              setProcessingStage(sanitizeUiText(queueStage));
              return;
          }

          if (Number.isFinite(pct) && pct > 0) {
              const safe = Math.max(6, Math.min(98, Math.round(pct)));
              setProgress((prev) => Math.max(prev, safe));
              if (stage) setProcessingStage(sanitizeUiText(stage));
          } else if (stage) {
              setProcessingStage(sanitizeUiText(stage));
          }
      };
      window.addEventListener(TTS_GATEWAY_JOB_PROGRESS_EVENT, handleGatewayProgress as EventListener);
      return () => window.removeEventListener(TTS_GATEWAY_JOB_PROGRESS_EVENT, handleGatewayProgress as EventListener);
  }, [isGenerating, settings.engine]);

  useEffect(() => {
      const handleGatewayAudioChunk = (event: Event) => {
          const detail = ((event as CustomEvent<GatewayAudioChunkEventDetail>).detail || {}) as GatewayAudioChunkEventDetail;
          const audioObjectUrl = String(detail.audioObjectUrl || '').trim();
          const audioBase64 = String(detail.audioBase64 || '').trim();
          const disposeUnclaimedAudioUrl = () => {
          if (!audioObjectUrl) return;
              if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
                  URL.revokeObjectURL(audioObjectUrl);
              }
          };
          const generationActive = Boolean(generationAbortController.current || isStudioQueueRunActiveRef.current);
          if (!generationActive && !isGenerating) {
              disposeUnclaimedAudioUrl();
              return;
          }
          const queueState = studioQueueStateRef.current;
          const activeQueueItemId = String(activeStudioQueueItemIdRef.current || '').trim();
          const activeQueueItem = activeQueueItemId
              ? queueState?.items.find((item) => item.id === activeQueueItemId) || null
              : null;
          const expectedEngine = resolveEngineToken(activeQueueItem?.settingsSnapshot.engine || settings.engine || 'PRIME');
          const detailEngine = String(detail.engine || '').trim()
            ? resolveEngineToken(detail.engine)
            : '';
          if (detailEngine && expectedEngine && detailEngine !== expectedEngine) {
              disposeUnclaimedAudioUrl();
              return;
          }
          const index = Number(detail.index);
          if (!Number.isFinite(index) || index < 0 || (!audioBase64 && !audioObjectUrl)) {
              disposeUnclaimedAudioUrl();
              return;
          }
          const detailRequestId = String(detail.requestId || '').trim();
          const activeRequestId = String(activeGatewayRequestIdRef.current || '').trim();
          if (detailRequestId) {
              if (activeRequestId && detailRequestId !== activeRequestId) {
                  disposeUnclaimedAudioUrl();
                  return;
              }
              if (!activeRequestId) activeGatewayRequestIdRef.current = detailRequestId;
          }
          const detailJobId = String(detail.jobId || '').trim();
          let activeJobId = String(activeGatewayJobIdRef.current || '').trim();
          if (!activeJobId && detailJobId) {
              activeGatewayJobIdRef.current = detailJobId;
              activeJobId = detailJobId;
              if (activeQueueItem && String(activeQueueItem.jobId || '').trim() !== detailJobId) {
                  setStudioQueueState((prev) => {
                      if (!prev) return prev;
                      return {
                          ...prev,
                          items: prev.items.map((item) => (
                              item.id === activeQueueItem.id
                                  ? {
                                      ...item,
                                      jobId: detailJobId,
                                      requestId: String(item.requestId || activeGatewayRequestIdRef.current || detailRequestId || '').trim() || undefined,
                                    }
                                  : item
                          )),
                      };
                  });
              } else if (!activeQueueItem && singleInflightLedgerRef.current) {
                  patchSingleInflightGenerationLedger({
                      jobId: detailJobId,
                      requestId: detailRequestId || activeGatewayRequestIdRef.current || singleInflightLedgerRef.current.requestId,
                  });
              }
          }
          if (!activeJobId) {
              disposeUnclaimedAudioUrl();
              return;
          }
          if (detailJobId && detailJobId !== activeJobId) {
              disposeUnclaimedAudioUrl();
              return;
          }
          const resolvedJobId = detailJobId || activeJobId;
          const key = `${resolvedJobId}:${Math.round(index)}`;
          if (seenLiveChunkKeysRef.current.has(key)) {
              disposeUnclaimedAudioUrl();
              return;
          }
          seenLiveChunkKeysRef.current.add(key);
          generationActivityAtRef.current = Date.now();
          const firstAudioAtMs = Date.now();
          if (!generationFirstAudioAtRef.current) {
              generationFirstAudioAtRef.current = firstAudioAtMs;
          }
          if (activeQueueItem?.id) {
              const currentTiming = queueItemTimingRef.current[activeQueueItem.id];
              if (currentTiming && !currentTiming.firstAudioAtMs) {
                  currentTiming.firstAudioAtMs = firstAudioAtMs;
              }
          }
          const nextChunk: LiveAudioChunkItem = {
              jobId: resolvedJobId,
              index: Math.round(index),
              engine: (detailEngine || resolveEngineToken(settings.engine)) as GenerationSettings['engine'],
              contentType: String(detail.contentType || 'audio/wav'),
              durationMs: Number(detail.durationMs || 0),
              textChars: Number(detail.textChars || 0),
              traceId: String(detail.traceId || ''),
              speakerId: String(detail.speakerId || ''),
              voiceId: String(detail.voiceId || ''),
              turnIndex: Number(detail.turnIndex || Math.round(index)),
              sessionEpoch: Number(detail.sessionEpoch || 0),
              resumeAttempt: Number(detail.resumeAttempt || 0),
              fallbackUsed: Boolean(detail.fallbackUsed),
              ...(audioBase64 ? { audioBase64 } : {}),
              ...(audioObjectUrl ? { audioObjectUrl } : {}),
          };
          setLiveAudioChunks((prev) => {
              const next = [...prev, nextChunk];
              return next.length > LIVE_AUDIO_CHUNK_STATE_CAP
                  ? next.slice(next.length - LIVE_AUDIO_CHUNK_STATE_CAP)
                  : next;
          });
      };
      window.addEventListener(TTS_GATEWAY_AUDIO_CHUNK_EVENT, handleGatewayAudioChunk as EventListener);
      return () => window.removeEventListener(TTS_GATEWAY_AUDIO_CHUNK_EVENT, handleGatewayAudioChunk as EventListener);
  }, [isGenerating, settings.engine]);

  useEffect(() => {
      if (!showSettings) return;
      const panel = settingsPanelRef.current;
      const previousActive = document.activeElement as HTMLElement | null;
      const focusableSelector = [
          'button:not([disabled])',
          '[href]',
          'input:not([disabled])',
          'select:not([disabled])',
          'textarea:not([disabled])',
          '[tabindex]:not([tabindex="-1"])',
      ].join(',');

      const getFocusable = (): HTMLElement[] => {
          if (!panel) return [];
          return (Array.from(panel.querySelectorAll(focusableSelector)) as HTMLElement[])
              .filter((item) => item.offsetParent !== null);
      };

      const focusable = getFocusable();
      const first = focusable[0];
      if (first) {
          first.focus();
      } else if (panel) {
          panel.focus();
      }

      const handleKeydown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
              event.preventDefault();
              setShowSettings(false);
              return;
          }
          if (event.key !== 'Tab') return;
          const currentFocusable = getFocusable();
          if (currentFocusable.length === 0) return;
          const firstEl = currentFocusable[0];
          const lastEl = currentFocusable[currentFocusable.length - 1];
          if (!firstEl || !lastEl) return;
          const active = document.activeElement as HTMLElement | null;
          if (!event.shiftKey && active === lastEl) {
              event.preventDefault();
              firstEl.focus();
          } else if (event.shiftKey && active === firstEl) {
              event.preventDefault();
              lastEl.focus();
          }
      };

      window.addEventListener('keydown', handleKeydown);
      return () => {
          window.removeEventListener('keydown', handleKeydown);
          if (previousActive && typeof previousActive.focus === 'function') {
              previousActive.focus();
          } else if (settingsTriggerRef.current) {
              settingsTriggerRef.current.focus();
          }
      };
  }, [showSettings]);

  useEffect(() => {
      if (typeof document === 'undefined') return undefined;
      return applyThemeModeToDocument(document, uiTheme, resolvedTheme);
  }, [uiTheme, resolvedTheme]);

  useEffect(() => {
      if (typeof document === 'undefined') return undefined;
      return applyBrandThemeToDocument(document, uiBrandTheme);
  }, [uiBrandTheme]);

  useEffect(() => {
      if (typeof document === 'undefined') return undefined;
      return applyMotionLevelToDocument(document, uiMotionLevel);
  }, [uiMotionLevel]);

  useEffect(() => {
      const previousFontSize = document.documentElement.style.fontSize;
      document.documentElement.style.fontSize = `${16 * uiFontScale}px`;
      return () => { document.documentElement.style.fontSize = previousFontSize; };
  }, [uiFontScale]);

  useEffect(() => {
      studioQueueStateRef.current = studioQueueState;
  }, [studioQueueState]);

  useEffect(() => {
      studioQueueAudioUrlsRef.current = studioQueueAudioUrls;
  }, [studioQueueAudioUrls]);

  useEffect(() => {
      if (studioQueueState && studioQueueState.items.length > 0) {
          writeStorageJson(STORAGE_KEYS.studioQueue, studioQueueState);
      } else {
          removeStorageKey(STORAGE_KEYS.studioQueue);
      }
  }, [studioQueueState]);

  useEffect(() => {
      let cancelled = false;
      const itemIds = new Set((studioQueueState?.items || []).map((item) => item.id));
      setStudioQueueAudioUrls((prev) => {
          const next = { ...prev };
          Object.entries(prev).forEach(([itemId, url]) => {
              if (itemIds.has(itemId)) return;
              URL.revokeObjectURL(url);
              delete next[itemId];
          });
          return next;
      });

      const hydrate = async () => {
          const completedItems = (studioQueueState?.items || []).filter((item) => (
              item.status === 'completed' && item.audioCacheKey
          ));
          for (const item of completedItems) {
              if (cancelled) return;
              if (studioQueueAudioUrlsRef.current[item.id]) continue;
              try {
                  const { buildStudioQueueBlobUrl } = await loadStudioQueueAudioService();
                  const blob = await readStudioQueueAudioBlob(item.audioCacheKey || '');
                  if (!blob || cancelled) continue;
                  const url = buildStudioQueueBlobUrl(blob);
                  if (!url) continue;
                  setStudioQueueAudioUrls((prev) => {
                      if (prev[item.id]) {
                          URL.revokeObjectURL(url);
                          return prev;
                      }
                      return { ...prev, [item.id]: url };
                  });
              } catch {
                  // Ignore hydration issues and let queue continue.
              }
          }
      };

      void hydrate();
      return () => {
          cancelled = true;
      };
  }, [studioQueueState]);

  useEffect(() => {
      if (typeof document === 'undefined') return undefined;

      const root = document.documentElement;
      const clearDockMetrics = () => {
          root.style.removeProperty('--vf-studio-dock-center-x');
          root.style.removeProperty('--vf-studio-dock-width');
      };

      if (!isStudioWorkspaceTab) {
          clearDockMetrics();
          return undefined;
      }

      let frameId = 0;
      const applyDockMetrics = () => {
          const dockTargetRect = studioEditorShellRef.current?.getBoundingClientRect() ?? studioMainRef.current?.getBoundingClientRect();
          const metrics = resolveStudioGenerateDockMetrics({
              viewportWidth: window.innerWidth,
              mode: viewportMode,
              editorLeft: dockTargetRect?.left ?? null,
              editorWidth: dockTargetRect?.width ?? null,
              isLargeDesktop,
              isNarrowDesktop,
          });
          root.style.setProperty('--vf-studio-dock-center-x', `${metrics.centerX}px`);
          root.style.setProperty('--vf-studio-dock-width', `${metrics.width}px`);
      };
      const scheduleDockMetrics = () => {
          if (frameId) window.cancelAnimationFrame(frameId);
          frameId = window.requestAnimationFrame(() => {
              applyDockMetrics();
          });
      };

      const observer = typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(() => {
              scheduleDockMetrics();
          })
          : null;
      if (observer && studioMainRef.current) {
          observer.observe(studioMainRef.current);
      }
      if (observer && studioEditorShellRef.current) {
          observer.observe(studioEditorShellRef.current);
      }

      scheduleDockMetrics();
      window.addEventListener('resize', scheduleDockMetrics, { passive: true });
      window.addEventListener('orientationchange', scheduleDockMetrics, { passive: true });
      return () => {
          if (frameId) window.cancelAnimationFrame(frameId);
          window.removeEventListener('resize', scheduleDockMetrics);
          window.removeEventListener('orientationchange', scheduleDockMetrics);
          if (observer) observer.disconnect();
          clearDockMetrics();
      };
  }, [isLargeDesktop, isNarrowDesktop, isStudioEditorFullscreen, isStudioWorkspaceTab, sidebarMode, uiFontScale, viewportMode]);

  useEffect(() => {
      if (isChatOpen && chatEndRef.current) {
          chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
  }, [chatHistory, isChatOpen]);

  useEffect(() => {
      const visibleHistoryAudioUrls = history.map((item) => item.audioUrl);
      const pinnedUrls = [
          generatedAudioUrl,
          masterQueueAudioUrlRef.current,
          ...Object.values(studioQueueAudioUrls),
      ];
      studioObjectUrlRegistryRef.current.reconcile(visibleHistoryAudioUrls, pinnedUrls);
  }, [generatedAudioUrl, history, studioQueueAudioUrls]);

  const cancelInflightTtsJobs = useCallback(() => {
      const jobIds = new Set<string>();
      void cancelTtsSession({ baseUrl: studioApiBaseUrl }).catch(() => undefined);
      const activeGatewayJobId = String(activeGatewayJobIdRef.current || '').trim();
      if (activeGatewayJobId) {
          jobIds.add(activeGatewayJobId);
      }
      const queueItems = studioQueueStateRef.current?.items || [];
      for (const item of queueItems) {
          const status = String(item.status || '').trim().toLowerCase();
          if (status !== 'running' && status !== 'queued' && status !== 'cooldown') continue;
          const jobId = String(item.jobId || '').trim();
          if (jobId) {
              jobIds.add(jobId);
          }
      }
      for (const jobId of jobIds) {
          void cancelTtsJob(jobId, { baseUrl: studioApiBaseUrl }).catch(() => undefined);
      }
  }, [studioApiBaseUrl]);

  // Cleanup timer on unmount
  useEffect(() => {
      return () => { 
          if(progressTimerRef.current) clearInterval(progressTimerRef.current);
          if(previewAudioRef.current) previewAudioRef.current.pause();
          voiceSampleCacheRef.current.forEach((entry) => {
              if (!entry.source?.needsCleanup) return;
              const sourceUrl = String(entry.source.url || '').trim();
              if (!sourceUrl) return;
              try {
                  URL.revokeObjectURL(sourceUrl);
              } catch {
                  // Ignore URL cleanup failures for cached previews.
              }
          });
          voiceSampleCacheRef.current.clear();
          if (generationWatchdogTimerRef.current) window.clearTimeout(generationWatchdogTimerRef.current);
          if (studioQueueCooldownTimerRef.current) window.clearTimeout(studioQueueCooldownTimerRef.current);
          if (queueMasterRebuildTimerRef.current) window.clearTimeout(queueMasterRebuildTimerRef.current);
          Object.values(studioQueueAudioUrlsRef.current).forEach((url) => studioObjectUrlRegistryRef.current.revoke(url));
          if (masterQueueAudioUrlRef.current) {
              studioObjectUrlRegistryRef.current.revoke(masterQueueAudioUrlRef.current);
              masterQueueAudioUrlRef.current = null;
          }
          studioObjectUrlRegistryRef.current.clear();
      }
  }, []);

  const deferredAnalysisText = useDeferredValue(
    isStudioWorkspaceTab ? text : ''
  );

  // Auto-detect language and speakers in text for the Studio editor.
  useEffect(() => {
    const textToAnalyze = deferredAnalysisText;
    if (!textToAnalyze.trim()) {
      setDetectedLang(null);
      setDetectedSpeakers([]);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (cancelled) return;
      if (textToAnalyze.length > 5 && settings.language === 'Auto') {
        const { detectLanguage } = await loadGeminiService();
        if (cancelled) return;
        const code = await detectLanguage(textToAnalyze, settings);
        if (cancelled) return;
        setDetectedLang(code.toUpperCase());
      } else {
        if (cancelled) return;
        setDetectedLang(null);
      }

      if (cancelled) return;
      const { isMultiSpeaker, speakersList } = parseMultiSpeakerScript(textToAnalyze);
      if (isMultiSpeaker && speakersList.length > 0) {
        if (cancelled) return;
        setDetectedSpeakers(speakersList);
        syncCast(speakersList);
      } else {
        if (cancelled) return;
        setDetectedSpeakers([]);
      }
    }, 1500); 
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [activeTab, deferredAnalysisText, settings.language, syncCast]);

  // --- Logic Functions ---

  const clearGenerationWatchdog = useCallback(() => {
      if (generationWatchdogTimerRef.current) {
          window.clearTimeout(generationWatchdogTimerRef.current);
          generationWatchdogTimerRef.current = null;
      }
  }, []);

  const abortGenerationStall = useCallback(() => {
      if (!generationAbortController.current) return;
      clearGenerationWatchdog();
      generationAbortReasonRef.current = 'stall';
      generationAbortController.current.abort();
      generationAbortController.current = null;
      activeGatewayRequestIdRef.current = '';
      activeGatewayJobIdRef.current = '';
      setLiveAudioChunks([]);
      seenLiveChunkKeysRef.current.clear();
      if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
      }
      setProcessingStage(sanitizeUiText('Generation timed out while waiting for runtime response.'));
  }, [clearGenerationWatchdog]);

  const markGenerationActivity = useCallback(() => {
      generationActivityAtRef.current = Date.now();
      if (!generationAbortController.current) return;
      clearGenerationWatchdog();
      generationWatchdogTimerRef.current = window.setTimeout(() => {
          if (!generationAbortController.current) return;
          if (Date.now() - generationActivityAtRef.current < GENERATION_STALL_TIMEOUT_MS) return;
          abortGenerationStall();
      }, GENERATION_STALL_TIMEOUT_MS);
  }, [abortGenerationStall, clearGenerationWatchdog]);

  const clearStudioQueueCooldownTimer = useCallback(() => {
      if (studioQueueCooldownTimerRef.current) {
          window.clearTimeout(studioQueueCooldownTimerRef.current);
          studioQueueCooldownTimerRef.current = null;
      }
  }, []);

  const waitForStudioQueueCooldownTick = useCallback((delayMs: number, signal: AbortSignal): Promise<void> => (
      new Promise((resolve, reject) => {
          if (signal.aborted) {
              reject(new DOMException('Queue cooldown cancelled.', 'AbortError'));
              return;
          }
          clearStudioQueueCooldownTimer();
          const handleAbort = () => {
              clearStudioQueueCooldownTimer();
              reject(new DOMException('Queue cooldown cancelled.', 'AbortError'));
          };
          signal.addEventListener('abort', handleAbort, { once: true });
          studioQueueCooldownTimerRef.current = window.setTimeout(() => {
              studioQueueCooldownTimerRef.current = null;
              signal.removeEventListener('abort', handleAbort);
              resolve();
          }, Math.max(0, delayMs));
      })
  ), [clearStudioQueueCooldownTimer]);

  const startGenerationWatchdog = useCallback(() => {
      clearGenerationWatchdog();
      generationActivityAtRef.current = Date.now();
      generationWatchdogTimerRef.current = window.setTimeout(() => {
          if (!generationAbortController.current) return;
          if (Date.now() - generationActivityAtRef.current < GENERATION_STALL_TIMEOUT_MS) return;
          abortGenerationStall();
      }, GENERATION_STALL_TIMEOUT_MS);
  }, [abortGenerationStall, clearGenerationWatchdog]);

  const setLiveProgress = useCallback((nextProgress: number, stageMessage?: string) => {
      const safe = Math.max(0, Math.min(99, Math.round(nextProgress)));
      setProgress((prev) => Math.max(prev, safe));
      markGenerationActivity();
      if (stageMessage) setProcessingStage(sanitizeUiText(stageMessage));
  }, [markGenerationActivity]);

  // Helper to start simulated progress
  const startSimulation = (
      estSeconds: number,
      startMsg: string,
      mode: 'simulated' | 'live' = 'simulated'
  ) => {
     if (progressTimerRef.current) clearInterval(progressTimerRef.current);
     if (generationStopResetTimerRef.current !== null) {
         window.clearTimeout(generationStopResetTimerRef.current);
         generationStopResetTimerRef.current = null;
     }
     
     setProgress(0);
     setTimeLeft(mode === 'simulated' ? estSeconds : 0);
     setProcessingStage(sanitizeUiText(startMsg));
     setIsGenerating(true);
     markGenerationActivity();
     startGenerationWatchdog();
     if (mode === 'live') {
         setProgress(6);
         return;
     }

     const increment = 90 / Math.max(1, Math.ceil((Math.max(1, estSeconds) * 1000) / SIMULATED_GENERATION_TICK_MS));
     
     progressTimerRef.current = setInterval(() => {
         setProgress(prev => {
             if (prev >= 90) return 90; // Stall at 90% until real completion
             return Math.min(90, prev + increment);
         });
         setTimeLeft(prev => Math.max(0, prev - (SIMULATED_GENERATION_TICK_MS / 1000)));
         markGenerationActivity();
     }, SIMULATED_GENERATION_TICK_MS);
  };

  const stopSimulation = () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      clearGenerationWatchdog();
      setProgress(100);
      setTimeLeft(0);
      if (generationStopResetTimerRef.current !== null) {
          window.clearTimeout(generationStopResetTimerRef.current);
      }
      // Short delay to show 100% before closing
      generationStopResetTimerRef.current = window.setTimeout(() => {
          generationStopResetTimerRef.current = null;
          setIsGenerating(false);
          setProgress(0);
      }, 500);
  };

  useEffect(() => {
      return () => {
          clearGenerationWatchdog();
          clearStudioQueueCooldownTimer();
          if (progressTimerRef.current) {
              clearInterval(progressTimerRef.current);
              progressTimerRef.current = null;
          }
          if (generationStopResetTimerRef.current !== null) {
              window.clearTimeout(generationStopResetTimerRef.current);
              generationStopResetTimerRef.current = null;
          }
      };
  }, [clearGenerationWatchdog, clearStudioQueueCooldownTimer]);

  const findNextStudioQueueProcessItem = (state: StudioQueueState | null | undefined): StudioQueueItem | null => {
      if (!state) return null;
      const sorted = [...state.items].sort((left, right) => left.order - right.order);
      return sorted.find((item) => item.status === 'running' || item.status === 'queued') || null;
  };

  const updateStudioQueueState = useCallback((
      updater: (prev: StudioQueueState | null) => StudioQueueState | null
  ) => {
      setStudioQueueState((prev) => {
          const next = updater(prev);
          if (!next) return null;
          const items = [...(next.items || [])]
              .sort((left, right) => left.order - right.order)
              .map((item, index) => ({
                  ...item,
                  order: index,
                  label: String(item.label || `Part ${index + 1}`),
              }));
           const activeItemId = items.some((item) => item.id === next.activeItemId)
               ? next.activeItemId
               : items.find((item) => item.status === 'running')?.id
                 || items.find((item) => item.status === 'queued')?.id
                 || items.find((item) => item.status === 'cooldown')?.id
                 || items[0]?.id;
          return {
              ...next,
              items,
              activeItemId,
              masterOrder: computeStudioQueueMasterOrder(items),
          };
      });
  }, []);

  const replaceStudioQueueItemAudioUrl = useCallback((itemId: string, nextUrl: string | null) => {
      setStudioQueueAudioUrls((prev) => {
          const current = prev[itemId];
          studioObjectUrlRegistryRef.current.replace(current, nextUrl);
          const next = { ...prev };
          if (nextUrl) next[itemId] = nextUrl;
          else delete next[itemId];
          return next;
      });
  }, []);

  const resetStudioQueueOutputState = useCallback(async (clearCache = false) => {
      clearStudioQueueCooldownTimer();
      if (queueMasterRebuildTimerRef.current) {
          window.clearTimeout(queueMasterRebuildTimerRef.current);
          queueMasterRebuildTimerRef.current = null;
      }
      Object.values(studioQueueAudioUrlsRef.current).forEach((url) => studioObjectUrlRegistryRef.current.revoke(url));
      studioQueueAudioUrlsRef.current = {};
      setStudioQueueAudioUrls({});
      if (masterQueueAudioUrlRef.current) {
          studioObjectUrlRegistryRef.current.revoke(masterQueueAudioUrlRef.current);
          masterQueueAudioUrlRef.current = null;
      }
      setGeneratedAudioUrlManaged(null);
      if (clearCache) {
          await clearStudioQueueAudioCache().catch(() => undefined);
      }
  }, [clearStudioQueueCooldownTimer, setGeneratedAudioUrlManaged]);

  const rebuildStudioQueueMasterAudio = useCallback(async (
      stateOverride?: StudioQueueState | null
  ): Promise<string | null> => {
      const sourceState = stateOverride || studioQueueStateRef.current;
      const completedItems = [...(sourceState?.items || [])]
          .sort((left, right) => left.order - right.order)
          .filter((item) => item.status === 'completed' && item.audioCacheKey);
      if (completedItems.length === 0) {
          if (masterQueueAudioUrlRef.current) {
              studioObjectUrlRegistryRef.current.revoke(masterQueueAudioUrlRef.current);
              masterQueueAudioUrlRef.current = null;
          }
          setGeneratedAudioUrlManaged(null);
          updateStudioQueueState((prev) => prev ? { ...prev, masterStatus: 'idle' } : prev);
          return null;
      }

      updateStudioQueueState((prev) => prev ? { ...prev, masterStatus: 'building' } : prev);
      const blobs: Blob[] = [];
      for (const item of completedItems) {
          const blob = await readStudioQueueAudioBlob(item.audioCacheKey || '').catch(() => null);
          if (blob) blobs.push(blob);
      }
      if (blobs.length === 0) {
          updateStudioQueueState((prev) => prev ? { ...prev, masterStatus: 'idle' } : prev);
          return null;
      }

      const { mergeStudioQueueAudioBlobs, buildStudioQueueBlobUrl } = await loadStudioQueueAudioService();
      const mergedBlob = await mergeStudioQueueAudioBlobs(blobs);
      const nextUrl = buildStudioQueueBlobUrl(mergedBlob);
      if (masterQueueAudioUrlRef.current) {
          studioObjectUrlRegistryRef.current.revoke(masterQueueAudioUrlRef.current);
      }
      masterQueueAudioUrlRef.current = nextUrl;
      studioObjectUrlRegistryRef.current.register(nextUrl);
      setGeneratedAudioUrlManaged(nextUrl);
      updateStudioQueueState((prev) => prev ? { ...prev, masterStatus: nextUrl ? 'ready' : 'idle' } : prev);
      return nextUrl;
  }, [setGeneratedAudioUrlManaged, updateStudioQueueState]);

  const scheduleStudioQueueMasterRebuild = useCallback((stateOverride?: StudioQueueState | null) => {
      if (queueMasterRebuildTimerRef.current) window.clearTimeout(queueMasterRebuildTimerRef.current);
      queueMasterRebuildTimerRef.current = window.setTimeout(() => {
          void rebuildStudioQueueMasterAudio(stateOverride);
      }, 180);
  }, [rebuildStudioQueueMasterAudio]);

  const setStudioQueueModeEnabled = useCallback((enabled: boolean) => {
      updateStudioQueueState((prev) => {
          if (!prev) {
              return {
                  items: [],
                  activeItemId: undefined,
                  masterOrder: '',
                  masterStatus: 'idle',
                  queueModeEnabled: enabled,
                  sourceHash: studioQueueSourceHash,
              };
          }
          return { ...prev, queueModeEnabled: enabled };
      });
  }, [studioQueueSourceHash, updateStudioQueueState]);

  const clearStudioQueueState = useCallback(async () => {
      await resetStudioQueueOutputState(true);
      updateStudioQueueState((prev) => prev ? {
          ...prev,
          items: [],
          activeItemId: undefined,
          masterOrder: '',
          masterStatus: 'idle',
      } : null);
  }, [resetStudioQueueOutputState, updateStudioQueueState]);

  const deleteStudioQueueItem = useCallback(async (itemId: string) => {
      const currentItem = studioQueueStateRef.current?.items.find((item) => item.id === itemId);
      if (currentItem?.audioCacheKey) {
          await deleteStudioQueueAudioBlob(currentItem.audioCacheKey).catch(() => undefined);
      }
      replaceStudioQueueItemAudioUrl(itemId, null);
      updateStudioQueueState((prev) => {
          if (!prev) return prev;
          const items = prev.items.filter((item) => item.id !== itemId);
          return { ...prev, items };
      });
      scheduleStudioQueueMasterRebuild();
  }, [replaceStudioQueueItemAudioUrl, scheduleStudioQueueMasterRebuild, updateStudioQueueState]);

  const reorderStudioQueueItems = useCallback((sourceIndex: number, targetIndex: number) => {
      startTransition(() => {
          updateStudioQueueState((prev) => {
              if (!prev) return prev;
              const items = [...prev.items].sort((left, right) => left.order - right.order);
              const [moved] = items.splice(sourceIndex, 1);
              if (!moved) return prev;
              items.splice(targetIndex, 0, moved);
              return {
                  ...prev,
                  items: items.map((item, index) => ({ ...item, order: index })),
              };
          });
      });
      scheduleStudioQueueMasterRebuild();
  }, [scheduleStudioQueueMasterRebuild, updateStudioQueueState]);

  const runStudioQueueItem = useCallback(async (
      item: StudioQueueItem,
      controller: AbortController
  ): Promise<void> => {
      const itemStartedAtMs = Date.now();
      const audioCacheKey = item.audioCacheKey || `studio-queue:${item.id}`;
      const normalizedQueueEngine = resolveEngineToken(item.settingsSnapshot.engine);
      const persistedRequestId = String(item.requestId || '').trim();
      const initialKnownJobId = String(item.jobId || '').trim();
      let runRequestId = persistedRequestId || initialKnownJobId || createSynthesisTraceId(normalizedQueueEngine as GenerationSettings['engine']);
      activeStudioQueueItemIdRef.current = item.id;
      syncActiveGatewayIds(runRequestId, initialKnownJobId);
      generationRunStartedAtRef.current = itemStartedAtMs;
      generationFirstAudioAtRef.current = 0;
      queueItemTimingRef.current[item.id] = {
          startedAtMs: itemStartedAtMs,
          firstAudioAtMs: 0,
      };
      seenLiveChunkKeysRef.current.clear();
      setLiveAudioChunks([]);

      updateStudioQueueState((prev) => {
          if (!prev) return prev;
          return {
              ...prev,
              activeItemId: item.id,
              items: prev.items.map((entry) => (
                  entry.id === item.id
                      ? {
                          ...entry,
                          status: 'running',
                          error: undefined,
                          requestId: runRequestId,
                          jobId: initialKnownJobId || undefined,
                          audioCacheKey,
                          startedAt: itemStartedAtMs,
                          firstAudioAt: undefined,
                          timeToFirstAudioMs: undefined,
                          totalGenerationMs: undefined,
                      }
                      : entry
              )),
          };
      });

      try {
          const runSettings: GenerationSettings = {
              ...item.settingsSnapshot,
              speakerMapping: {
                  ...(item.settingsSnapshot.speakerMapping || {}),
              },
          };
          let wavBlob: Blob | null = null;
          let generationOutput: Awaited<ReturnType<typeof performGeneration>> | null = null;
          let currentJobId = initialKnownJobId;
          let retryCount = 0;

          while (true) {
              try {
                  if (currentJobId) {
                      const { pollTtsGatewayJobForAudio } = await loadTtsGatewayJobService();
                      const queuedResult = await pollTtsGatewayJobForAudio({
                          baseUrl: studioApiBaseUrl,
                          jobId: currentJobId,
                          runtimeLabel: getEngineDisplayName(normalizedQueueEngine as GenerationSettings['engine']),
                          engine: normalizedQueueEngine as GenerationSettings['engine'],
                          signal: controller.signal,
                      });
                      const decoded = await getAudioContext().decodeAudioData(queuedResult.audioBytes.slice(0));
                      const { applyStudioAudioMix } = await loadStudioMixService();
                      const mixedBuffer = await applyStudioAudioMix(decoded, runSettings, {
                          customMusicTrackUrl: resolveCustomMusicTrackUrlForSettings(runSettings),
                      });
                      wavBlob = audioBufferToWav(mixedBuffer);
                  } else {
                      generationOutput = await performGeneration(
                          item.sourceText,
                          controller.signal,
                          runSettings,
                          { createObjectUrl: false, requestId: runRequestId }
                      );
                      wavBlob = generationOutput.wavBlob;
                  }
                  break;
              } catch (attemptError: any) {
                  if (attemptError?.name === 'AbortError') {
                      throw attemptError;
                  }
                  const shouldRetry = (
                      retryCount < TRANSIENT_GENERATION_RETRY_MAX
                      && shouldRetryTransientGenerationError(attemptError)
                  );
                  if (!shouldRetry) {
                      throw attemptError;
                  }
                  retryCount += 1;
                  const staleJobId = String(currentJobId || activeGatewayJobIdRef.current || '').trim();
                  if (staleJobId) {
                      try {
                          const { cancelTtsJob } = await import('../../shared/api/gatewayClient');
                          await cancelTtsJob(staleJobId, { baseUrl: studioApiBaseUrl });
                      } catch {
                          // Best-effort cancellation before retrying the same request id.
                      }
                  }
                  currentJobId = '';
                  syncActiveGatewayIds(runRequestId, undefined);
                  setLiveAudioChunks([]);
                  seenLiveChunkKeysRef.current.clear();
                  updateStudioQueueState((prev) => {
                      if (!prev) return prev;
                      return {
                          ...prev,
                          activeItemId: item.id,
                          items: prev.items.map((entry) => (
                              entry.id === item.id
                                  ? { ...entry, status: 'running', error: undefined, requestId: runRequestId, jobId: undefined }
                                  : entry
                          )),
                      };
                  });
                  setProcessingStage('Temporary delay detected. Retrying this queue item now...');
                  showToast('We hit a temporary delay. Retrying this queued item now.', 'info');
                  await waitForAbortableDelay(TRANSIENT_GENERATION_RETRY_DELAY_MS, controller.signal);
              }
          }

          if (!wavBlob) {
              throw new Error('Queue generation returned empty audio payload.');
          }

          await storeStudioQueueAudioBlob(audioCacheKey, wavBlob);
          const { buildStudioQueueBlobUrl } = await loadStudioQueueAudioService();
          replaceStudioQueueItemAudioUrl(item.id, buildStudioQueueBlobUrl(wavBlob));
          const completedAtMs = Date.now();
          const itemTiming = queueItemTimingRef.current[item.id] || {
              startedAtMs: itemStartedAtMs,
              firstAudioAtMs: 0,
          };
          const firstAudioAtMs = itemTiming.firstAudioAtMs || generationOutput?.firstAudioAtMs || generationFirstAudioAtRef.current || completedAtMs;
          updateStudioQueueState((prev) => {
              if (!prev) return prev;
              return {
                  ...prev,
                  activeItemId: item.id,
                  items: prev.items.map((entry) => (
                      entry.id === item.id
                              ? {
                                  ...entry,
                                  status: 'completed',
                                  error: undefined,
                                  audioCacheKey,
                                  requestId: runRequestId,
                                  jobId: String(activeGatewayJobIdRef.current || currentJobId || entry.jobId || '').trim(),
                                  completedAt: completedAtMs,
                                  startedAt: entry.startedAt || itemStartedAtMs,
                              firstAudioAt: firstAudioAtMs,
                              timeToFirstAudioMs: Math.max(0, firstAudioAtMs - itemStartedAtMs),
                              totalGenerationMs: Math.max(0, completedAtMs - itemStartedAtMs),
                          }
                          : entry
                  )),
              };
          });
      } catch (error: any) {
          const queueItemErrorMessage = error?.name === 'AbortError'
              ? undefined
              : formatFrontendError(error, {
                  fallback: 'Queue generation failed.',
                  context: 'generation',
                  isAdmin: hasAdminConsoleAccess,
              }).publicMessage;
          updateStudioQueueState((prev) => {
              if (!prev) return prev;
              return {
                  ...prev,
                  activeItemId: item.id,
                  items: prev.items.map((entry) => (
                      entry.id === item.id
                              ? {
                                  ...entry,
                                  status: error?.name === 'AbortError' ? 'cancelled' : 'failed',
                                  error: queueItemErrorMessage,
                                  audioCacheKey,
                                  requestId: runRequestId,
                                  jobId: String(activeGatewayJobIdRef.current || entry.jobId || '').trim(),
                                  startedAt: entry.startedAt || itemStartedAtMs,
                                  totalGenerationMs: Math.max(0, Date.now() - itemStartedAtMs),
                          }
                          : entry
                  )),
              };
          });
          throw error;
      } finally {
          delete queueItemTimingRef.current[item.id];
          activeGatewayRequestIdRef.current = '';
          activeGatewayJobIdRef.current = '';
      }
  }, [
      performGeneration,
      replaceStudioQueueItemAudioUrl,
      resolveCustomMusicTrackUrlForSettings,
      showToast,
      syncActiveGatewayIds,
      updateStudioQueueState,
  ]);

  const startStudioQueueInterPartCooldown = useCallback(async (
      nextItem: StudioQueueItem,
      totalItems: number,
      signal: AbortSignal
  ): Promise<void> => {
      const cooldownUntil = Date.now() + STUDIO_QUEUE_INTER_PART_DELAY_MS;
      updateStudioQueueState((prev) => {
          if (!prev) return prev;
          return {
              ...prev,
              activeItemId: nextItem.id,
              items: prev.items.map((item) => (
                  item.id === nextItem.id
                      ? {
                          ...item,
                          status: 'cooldown',
                          cooldownUntil,
                          error: undefined,
                      }
                      : item
              )),
          };
      });

      try {
          for (let remainingSeconds = Math.ceil(STUDIO_QUEUE_INTER_PART_DELAY_MS / 1000); remainingSeconds >= 1; remainingSeconds -= 1) {
              setProcessingStage(sanitizeUiText(`Queue ${Math.min(totalItems, nextItem.order + 1)}/${totalItems} starts in ${remainingSeconds}s`));
              markGenerationActivity();
              await waitForStudioQueueCooldownTick(1000, signal);
          }
      } finally {
          updateStudioQueueState((prev) => {
              if (!prev) return prev;
              return {
                  ...prev,
                  items: prev.items.map((item) => (
                      item.id === nextItem.id && item.status === 'cooldown'
                          ? { ...item, status: 'queued', cooldownUntil: undefined }
                          : item
                  )),
              };
          });
      }
  }, [markGenerationActivity, updateStudioQueueState, waitForStudioQueueCooldownTick]);

  const executeStudioQueue = useCallback(async (
      initialState?: StudioQueueState | null
  ): Promise<void> => {
      if (queueRunnerLockRef.current) return;
      queueRunnerLockRef.current = true;
      isStudioQueueRunActiveRef.current = true;
      clearStudioQueueCooldownTimer();
      const generationEngine = managedActiveEngine || settings.engine;
      const generationNotificationKey = `queue:${generationEngine}`;

      try {
          let nextItem = findNextStudioQueueProcessItem(initialState || studioQueueStateRef.current);
          while (nextItem) {
              const controller = new AbortController();
              generationAbortController.current = controller;
              await runStudioQueueItem(nextItem, controller);
              scheduleStudioQueueMasterRebuild();
              const queuedNextItem = findNextStudioQueueProcessItem(studioQueueStateRef.current);
              if (!queuedNextItem) {
                  generationAbortController.current = null;
                  break;
              }
              activeStudioQueueItemIdRef.current = queuedNextItem.id;
              const queueTotalItems = Math.max(1, [...(studioQueueStateRef.current?.items || [])].length);
              await startStudioQueueInterPartCooldown(queuedNextItem, queueTotalItems, controller.signal);
              generationAbortController.current = null;
              nextItem = findNextStudioQueueProcessItem(studioQueueStateRef.current);
          }

          const masterUrl = await rebuildStudioQueueMasterAudio(studioQueueStateRef.current);
          const completedItems = [...(studioQueueStateRef.current?.items || [])].filter((item) => item.status === 'completed');
          const queuePartDurationsMs = completedItems
              .map((entry) => {
                  const directDuration = Number(entry.totalGenerationMs || 0);
                  if (Number.isFinite(directDuration) && directDuration > 0) return directDuration;
                  const startedAt = Number(entry.startedAt || 0);
                  const completedAt = Number(entry.completedAt || 0);
                  if (startedAt > 0 && completedAt > startedAt) return completedAt - startedAt;
                  return 0;
              })
              .filter((durationMs) => Number.isFinite(durationMs) && durationMs > 0);
          const queueTotalGenerationMs = queuePartDurationsMs.reduce((sum, durationMs) => sum + durationMs, 0);
          const queueStartedAtMs = completedItems.reduce((min, entry) => {
              const startedAt = Number(entry.startedAt || 0);
              if (!startedAt) return min;
              return Math.min(min, startedAt);
          }, Number.MAX_SAFE_INTEGER);
          const queueFirstAudioAtMs = completedItems.reduce((min, entry) => {
              const firstAudioAt = Number(entry.firstAudioAt || 0);
              if (!firstAudioAt) return min;
              return Math.min(min, firstAudioAt);
          }, Number.MAX_SAFE_INTEGER);
          const queueCompletedAtMs = Date.now();
          if (queueTotalGenerationMs > 0) {
              const resolvedStartedAt = queueStartedAtMs === Number.MAX_SAFE_INTEGER
                  ? (generationRunStartedAtRef.current || queueCompletedAtMs)
                  : queueStartedAtMs;
              const resolvedFirstAudioAt = queueFirstAudioAtMs === Number.MAX_SAFE_INTEGER
                  ? (generationFirstAudioAtRef.current || resolvedStartedAt)
                  : queueFirstAudioAtMs;
              setGenerationTiming({
                  mode: 'queue',
                  startedAtMs: resolvedStartedAt,
                  firstAudioAtMs: resolvedFirstAudioAt,
                  completedAtMs: queueCompletedAtMs,
                  timeToFirstAudioMs: Math.max(0, resolvedFirstAudioAt - resolvedStartedAt),
                  totalGenerationMs: queueTotalGenerationMs,
                  partCount: completedItems.length,
                  partDurationsMs: queuePartDurationsMs,
                  coldStart: false,
              });
          }
          if (masterUrl && completedItems.length > 0) {
              addToHistory({
                  id: Date.now().toString(),
                  text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
                  audioUrl: masterUrl,
                  voiceName: isStudioMultiSpeakerEnabled && detectedSpeakers.length > 0
                      ? `Cast (${detectedSpeakers.length})`
                      : `Queue ${computeStudioQueueMasterOrder(completedItems)}`,
                  timestamp: Date.now(),
              });
              void loadHistory(30);
          }
          generationFailureBurstRef.current = 0;
          const queueTimingLabel = queueTotalGenerationMs > 0
              ? ` in ${formatGenerationDuration(queueTotalGenerationMs)}`
              : '';
          const queueFirstAudioLabel = queueTotalGenerationMs > 0
              ? ` First audio ${formatGenerationDuration(Math.max(0, (queueFirstAudioAtMs === Number.MAX_SAFE_INTEGER ? (generationFirstAudioAtRef.current || queueCompletedAtMs) : queueFirstAudioAtMs) - (queueStartedAtMs === Number.MAX_SAFE_INTEGER ? (generationRunStartedAtRef.current || queueCompletedAtMs) : queueStartedAtMs)))}.`
              : '';
          const queueCompletionMessage = `Queued audio ready (${completedItems.length} part${completedItems.length === 1 ? '' : 's'})${queueTimingLabel}.${queueFirstAudioLabel}`;
          emit('generation.completed', {
              title: 'Generation Completed',
              message: queueCompletionMessage,
              entityKey: generationNotificationKey,
              dedupeKey: `generation-completed-queue:${generationEngine}`,
              channel: 'inbox',
          });
          showToast(queueCompletionMessage, 'success');
      } finally {
          queueRunnerLockRef.current = false;
          isStudioQueueRunActiveRef.current = false;
          clearStudioQueueCooldownTimer();
          generationAbortController.current = null;
          activeGatewayRequestIdRef.current = '';
          activeGatewayJobIdRef.current = '';
          activeStudioQueueItemIdRef.current = '';
          stopSimulation();
      }
  }, [
      addToHistory,
      detectedSpeakers.length,
      isStudioMultiSpeakerEnabled,
      loadHistory,
      managedActiveEngine,
      rebuildStudioQueueMasterAudio,
      runStudioQueueItem,
      scheduleStudioQueueMasterRebuild,
      clearStudioQueueCooldownTimer,
      startStudioQueueInterPartCooldown,
      settings,
      emit,
      showToast,
      text,
  ]);

  const startStudioQueuedGeneration = useCallback(async (): Promise<void> => {
      if (queueRunnerLockRef.current || isStudioQueueRunActiveRef.current) return;
      const currentHash = hashStudioQueueSource(text);
      const existingState = studioQueueStateRef.current;
      const generationEngine = managedActiveEngine || settings.engine;
      const lockedQueueSettings: GenerationSettings = buildStudioGenerationSettings({
          ...settings,
          speakerMapping: {
              ...(settings.speakerMapping || {}),
          },
      });
      const hasResumableCurrentQueue = Boolean(
          existingState
          && existingState.sourceHash === currentHash
          && existingState.items.some((item) => item.status === 'queued' || item.status === 'cooldown' || item.status === 'running' || item.status === 'failed' || item.status === 'cancelled')
      );
      let nextState = hasResumableCurrentQueue
          ? {
              ...existingState!,
              queueModeEnabled: true,
          }
          : createStudioQueueState(text, maxCharsPerGeneration, lockedQueueSettings, true);
      if (hasResumableCurrentQueue && nextState.items.length > 0) {
          nextState = {
              ...nextState,
              items: nextState.items.map((entry) => ({
                  ...entry,
                  status: entry.status === 'cooldown' || entry.status === 'cancelled' ? 'queued' : entry.status,
                  cooldownUntil: undefined,
                  settingsSnapshot: {
                      ...entry.settingsSnapshot,
                      speakerMapping: {
                          ...(lockedQueueSettings.speakerMapping || {}),
                          ...(entry.settingsSnapshot?.speakerMapping || {}),
                      },
                  },
              })),
          };
      }
      if (!nextState.items.some((item) => item.status === 'queued' || item.status === 'cooldown' || item.status === 'running')) {
          const firstRecoverable = findFirstRecoverableStudioQueueItem(nextState.items);
          if (firstRecoverable) {
              nextState = {
                  ...nextState,
                  activeItemId: firstRecoverable.id,
                  items: nextState.items.map((item) => (
                      item.id === firstRecoverable.id
                          ? { ...item, status: 'queued', cooldownUntil: undefined, error: undefined, requestId: undefined, jobId: undefined }
                          : item
                  )),
              };
          }
      }

      if (!hasResumableCurrentQueue) {
          await resetStudioQueueOutputState(true);
      }
      setStudioQueueState(nextState);
      setLiveAudioChunks([]);
      seenLiveChunkKeysRef.current.clear();
      activeGatewayRequestIdRef.current = '';
      activeGatewayJobIdRef.current = '';
      generationRunStartedAtRef.current = Date.now();
      generationFirstAudioAtRef.current = 0;
      setGenerationTiming(null);
      setStudioRailTab('queue');
      const generationNotificationKey = `queue:${generationEngine}`;

      const estTime = Math.max(4, Math.ceil(text.length / 14));
      startSimulation(estTime, 'Preparing queued generation...', 'live');
      emit('generation.started', {
          title: 'Generation Started',
          message: 'Queued Studio generation started.',
          entityKey: generationNotificationKey,
          dedupeKey: `generation-started:${generationEngine}`,
          channel: 'inbox',
      });

      try {
          await executeStudioQueue(nextState);
      } catch (error: any) {
          if (error?.name === 'AbortError') {
              showToast('Queue cancelled.', 'info');
              return;
          }
          syncRuntimeBlockedStateFromError(generationEngine, error);
          generationFailureBurstRef.current += 1;
          const queueFailureMessage = formatFrontendError(error, {
              fallback: 'Queued generation could not finish right now. Please try again.',
              context: 'generation',
              isAdmin: hasAdminConsoleAccess,
          }).publicMessage;
          emit('generation.failed', {
              title: 'Generation Failure',
              message: queueFailureMessage,
              entityKey: generationNotificationKey,
              dedupeKey: `generation-failed-main:${generationEngine}`,
              action: {
                  label: 'Open Settings',
                  onClick: () => setShowSettings(true),
              },
          });
          showToast(queueFailureMessage || 'Queued generation could not finish right now. Please try again.', 'error');
      }
  }, [
      emit,
      executeStudioQueue,
      buildStudioGenerationSettings,
      maxCharsPerGeneration,
      managedActiveEngine,
      resetStudioQueueOutputState,
      settings,
      setStudioRailTab,
      showToast,
      text,
      toUserFriendlySystemMessage,
  ]);

  const retryStudioQueueItem = useCallback((itemId: string) => {
      updateStudioQueueState((prev) => {
          if (!prev) return prev;
          return {
              ...prev,
              activeItemId: itemId,
              items: prev.items.map((item) => (
                  item.id === itemId
                      ? { ...item, status: 'queued', cooldownUntil: undefined, error: undefined, requestId: undefined, jobId: undefined }
                      : item
              )),
          };
      });
  }, [updateStudioQueueState]);

  const resumeStudioQueue = useCallback(async () => {
      let currentState = studioQueueStateRef.current;
      if (!currentState || !currentState.items.length) return;
      if (isGenerating) return;
      if (currentState.items.some((item) => item.status === 'cooldown' || item.status === 'cancelled')) {
          currentState = {
              ...currentState,
              items: currentState.items.map((item) => (
                  item.status === 'cooldown' || item.status === 'cancelled'
                      ? { ...item, status: 'queued', cooldownUntil: undefined }
                      : item
              )),
          };
          setStudioQueueState(currentState);
      }
      setStudioRailTab('queue');
      generationRunStartedAtRef.current = Date.now();
      generationFirstAudioAtRef.current = 0;
      if (!currentState.items.some((item) => item.status === 'queued' || item.status === 'cooldown' || item.status === 'running')) {
          const firstRecoverable = findFirstRecoverableStudioQueueItem(currentState.items);
          if (firstRecoverable) {
              currentState = {
                  ...currentState,
                  activeItemId: firstRecoverable.id,
                   items: currentState.items.map((item) => (
                       item.id === firstRecoverable.id
                           ? { ...item, status: 'queued', cooldownUntil: undefined, error: undefined, requestId: undefined, jobId: undefined }
                           : item
                   )),
               };
              setStudioQueueState(currentState);
          }
      }
      startSimulation(Math.max(4, Math.ceil(text.length / 14)), 'Resuming queued generation...', 'live');
      try {
          await executeStudioQueue(currentState);
      } catch (error: any) {
          if (error?.name !== 'AbortError') {
              const resumeFailureMessage = formatFrontendError(error, {
                  fallback: 'Queued generation could not resume right now.',
                  context: 'generation',
                  isAdmin: hasAdminConsoleAccess,
              }).publicMessage;
              showToast(resumeFailureMessage || 'Queued generation could not resume right now.', 'error');
          }
      }
  }, [executeStudioQueue, hasAdminConsoleAccess, isGenerating, setStudioRailTab, showToast, text.length]);

  useEffect(() => {
      if (!isStudioWorkspaceTab) {
          studioQueueAutoResumeAttemptedRef.current = false;
          return;
      }
      if (!studioQueueState?.items.length) {
          studioQueueAutoResumeAttemptedRef.current = false;
          return;
      }

      const hasCompletedItems = studioQueueState.items.some((item) => item.status === 'completed' && item.audioCacheKey);
      if (hasCompletedItems && !masterQueueAudioUrlRef.current) {
          scheduleStudioQueueMasterRebuild(studioQueueState);
      }

      const runningItem = studioQueueState.items.find((item) => item.status === 'running' && String(item.jobId || '').trim());
      if (!runningItem || isGenerating || studioQueueAutoResumeAttemptedRef.current) return;

      studioQueueAutoResumeAttemptedRef.current = true;
      setStudioRailTab('queue');
      startSimulation(Math.max(4, Math.ceil(studioQueueState.items.reduce((sum, item) => sum + item.charCount, 0) / 14)), 'Reconnecting queued generation...', 'live');
      void executeStudioQueue(studioQueueState).catch((error: any) => {
          if (error?.name !== 'AbortError') {
              const recoveryFailureMessage = formatFrontendError(error, {
                  fallback: 'Queued generation could not reconnect cleanly.',
                  context: 'generation',
                  isAdmin: hasAdminConsoleAccess,
              }).publicMessage;
              showToast(recoveryFailureMessage || 'Queued generation could not reconnect cleanly.', 'error');
          }
      });
  }, [executeStudioQueue, hasAdminConsoleAccess, isGenerating, isStudioWorkspaceTab, scheduleStudioQueueMasterRebuild, setStudioRailTab, showToast, studioQueueState]);

  const handleCancelGeneration = () => {
      if (!isGenerating) return;

      clearStudioQueueCooldownTimer();
      const hadController = Boolean(generationAbortController.current);
      if (hadController) {
          generationAbortReasonRef.current = 'manual';
          generationAbortController.current?.abort();
          generationAbortController.current = null;
          setProcessingStage(sanitizeUiText('Cancelling generation...'));
      } else {
          stopSimulation();
      }

      clearGenerationWatchdog();
      activeGatewayRequestIdRef.current = '';
      activeGatewayJobIdRef.current = '';
      clearSingleInflightGenerationLedger();
      cancelInflightTtsJobs();
      updateStudioQueueState((prev) => {
          if (!prev) return prev;
          return {
              ...prev,
              items: prev.items.map((item) => (
                  item.status === 'cooldown'
                      ? { ...item, status: 'queued', cooldownUntil: undefined }
                      : item
              )),
          };
      });
      setLiveAudioChunks([]);
      seenLiveChunkKeysRef.current.clear();
      emit('generation.cancelled', {
          title: 'Generation Cancelled',
          message: 'Generation cancelled.',
          dedupeKey: 'generation-cancelled',
          channel: 'inbox',
      });
  };

  async function performGeneration(
      scriptText: string,
      signal?: AbortSignal,
      settingsOverride?: GenerationSettings,
      options?: { createObjectUrl?: boolean; requestId?: string }
  ) {
      if (!scriptText.trim()) throw new Error("Text is empty");
      throwIfSignalAborted(signal);
      const studioSettings = normalizeSettings(settingsOverride ?? buildStudioGenerationSettings(settings));
      const multiSpeakerEnabled = studioSettings.multiSpeakerEnabled !== false;
      const runtimeColdStart = false;
      const runtimePrepStage = `Checking ${studioSettings.engine} runtime...`;
      setLiveProgress(14, runtimePrepStage);
      let engineState: { runtimeUrl: string; catalog: VoiceOption[]; syncedVoiceId?: string };
      engineState = await ensureEngineOnline(studioSettings.engine, {
        silent: true,
        syncVoiceId: studioSettings.voiceId,
        requireAccess: true,
        ...(signal ? { signal } : {}),
      });
      throwIfSignalAborted(signal);
      setLiveProgress(28, 'Runtime ready. Preparing voice selection...');
      
      const parsedForRun = parseMultiSpeakerScript(scriptText);
      const runSpeakers = parsedForRun.speakersList
          .map((speaker) => String(speaker || '').trim())
          .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX');
      const shouldUseMultiSpeakerForRun = multiSpeakerEnabled;

      // Keep generation routing aligned with actual script structure.
      if (shouldUseMultiSpeakerForRun) {
          syncCast(runSpeakers);
      }

      const freshCatalog = engineState.catalog.length > 0
          ? engineState.catalog
          : getEngineVoiceCatalog(studioSettings.engine);
      const requestedVoiceId = engineState.syncedVoiceId || studioSettings.voiceId;
      const scopedCatalog = isGemRuntimeEngine(studioSettings.engine)
          ? freshCatalog
          : getLanguageScopedVoiceCatalog(studioSettings.engine, studioTextLanguageCode, [requestedVoiceId]);
      const voiceId = selectVoiceIdFromCatalog(
          studioSettings.engine,
          scopedCatalog.length > 0 ? scopedCatalog : freshCatalog,
          requestedVoiceId
      );
      const selectedVoice = getVoiceById(voiceId);
      const voiceNameDisplay = selectedVoice?.name || 'AI Voice';
      const engineVoiceName = selectedVoice?.geminiVoiceName || voiceId || 'Fenrir';
      const generationSettings = {
          ...studioSettings,
          multiSpeakerEnabled: shouldUseMultiSpeakerForRun,
          voiceId,
          runtimeVoiceCatalog: freshCatalog,
      } as GenerationSettings & { runtimeVoiceCatalog?: VoiceOption[] };

      // Pass signal to generateSpeech and then apply studio-level audio mix.
      setLiveProgress(40, 'Generating audio...');
      const { generateSpeech } = await loadGeminiService();
      const generationSpeechOptions: StudioGenerateSpeechOptions = {
          context: 'studio',
          preferLiveChunks: true,
          ...(options?.requestId ? { requestId: String(options.requestId).trim() } : {}),
          speakerVcReferenceMap,
      };
      const generationRequestId = String(generationSpeechOptions.requestId || '').trim();
      throwIfSignalAborted(signal);
      const ttsBuffer = await runSingleFlightTtsRequest(generationRequestId, async () => (
        generateSpeech(
            scriptText,
            engineVoiceName,
            generationSettings,
            'speech',
            signal,
            generationSpeechOptions
        )
      ));
      throwIfSignalAborted(signal);
      setLiveProgress(74, 'TTS response received. Applying studio mix...');
      const { applyStudioAudioMix } = await loadStudioMixService();
      const mixedBuffer = await applyStudioAudioMix(ttsBuffer, generationSettings, {
          customMusicTrackUrl: resolveCustomMusicTrackUrlForSettings(generationSettings),
      });
      throwIfSignalAborted(signal);
      setLiveProgress(90, 'Rendering final audio buffer...');
      const wavBlob = audioBufferToWav(mixedBuffer);
      const url = options?.createObjectUrl === false ? null : URL.createObjectURL(wavBlob);
      
      return {
          url,
          wavBlob,
          firstAudioAtMs: generationFirstAudioAtRef.current || 0,
          voiceNameDisplay,
          usedMultiSpeaker: shouldUseMultiSpeakerForRun,
          speakerCount: runSpeakers.length,
          runtimeColdStart,
      };
  }

  const runSingleGeneration = useCallback(async (options?: {
      inflightLedger?: StudioSingleInflightGenerationLedger | null;
      treatAsRecovery?: boolean;
  }) => {
      const inflightLedger = options?.inflightLedger || null;
      const recoveryText = String(inflightLedger?.textSnapshot || '');
      const generationText = inflightLedger ? recoveryText : text;
      if (!generationText.trim()) {
          if (inflightLedger) clearSingleInflightGenerationLedger();
          showToast('Please enter some text.', 'info');
          return;
      }
      if (singleRunLockRef.current) return;
      singleRunLockRef.current = true;

      if (generationAbortController.current) generationAbortController.current.abort();
      const controller = new AbortController();
      generationAbortController.current = controller;
      const resumedStartedAtMs = Number(inflightLedger?.startedAtMs || 0);
      const generationStartedAtMs = Number.isFinite(resumedStartedAtMs) && resumedStartedAtMs > 0
          ? resumedStartedAtMs
          : Date.now();
      generationRunStartedAtRef.current = generationStartedAtMs;
      generationFirstAudioAtRef.current = 0;
      setGenerationTiming(null);
      const generationEngine = managedActiveEngine || settings.engine;
      const generationRequestId = String(inflightLedger?.requestId || '').trim()
          || createSynthesisTraceId(resolveEngineToken(generationEngine) as GenerationSettings['engine']);
      let activeRequestId = generationRequestId;
      let currentJobId = String(inflightLedger?.jobId || '').trim();
      patchSingleInflightGenerationLedger({
          mode: 'single',
          requestId: activeRequestId,
          jobId: currentJobId,
          textSnapshot: generationText,
          startedAtMs: generationStartedAtMs,
      });
      syncActiveGatewayIds(activeRequestId, currentJobId);

      setGeneratedAudioUrlManaged(null);
      setLiveAudioChunks([]);
      seenLiveChunkKeysRef.current.clear();

      const estTime = Math.max(3, Math.ceil(generationText.length / 14));
      const generationNotificationKey = `single:${generationEngine}`;
      const preparingLabel = options?.treatAsRecovery
          ? 'Reconnecting generation...'
          : 'Preparing generation...';
      startSimulation(estTime, preparingLabel, 'live');
      emit('generation.started', {
        title: 'Generation Started',
        message: options?.treatAsRecovery ? 'Reconnecting existing generation.' : 'Generation started.',
        entityKey: generationNotificationKey,
        dedupeKey: `generation-started:${generationEngine}`,
        channel: 'inbox',
      });

      try {
          let generationResult: Awaited<ReturnType<typeof performGeneration>> | null = null;
          let retryCount = 0;
          while (!generationResult) {
              try {
                  if (currentJobId) {
                      const runSettings = normalizeSettings(buildStudioGenerationSettings(settings));
                      const normalizedRunEngine = resolveEngineToken(runSettings.engine);
                      const { pollTtsGatewayJobForAudio } = await loadTtsGatewayJobService();
                      const queuedResult = await pollTtsGatewayJobForAudio({
                          baseUrl: studioApiBaseUrl,
                          jobId: currentJobId,
                          runtimeLabel: getEngineDisplayName(normalizedRunEngine as GenerationSettings['engine']),
                          engine: normalizedRunEngine as GenerationSettings['engine'],
                          signal: controller.signal,
                      });
                      const decoded = await getAudioContext().decodeAudioData(queuedResult.audioBytes.slice(0));
                      const { applyStudioAudioMix } = await loadStudioMixService();
                      const mixedBuffer = await applyStudioAudioMix(decoded, runSettings, {
                          customMusicTrackUrl: resolveCustomMusicTrackUrlForSettings(runSettings),
                      });
                      const wavBlob = audioBufferToWav(mixedBuffer);
                      const parsedForRun = parseMultiSpeakerScript(generationText);
                      const runSpeakers = parsedForRun.speakersList
                          .map((speaker) => String(speaker || '').trim())
                          .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX');
                      const selectedVoice = getVoiceById(runSettings.voiceId);
                      generationResult = {
                          url: URL.createObjectURL(wavBlob),
                          wavBlob,
                          firstAudioAtMs: generationFirstAudioAtRef.current || 0,
                          voiceNameDisplay: selectedVoice?.name || 'AI Voice',
                          usedMultiSpeaker: runSettings.multiSpeakerEnabled !== false,
                          speakerCount: runSpeakers.length,
                          runtimeColdStart: false,
                      };
                  } else {
                      generationResult = await performGeneration(
                          generationText,
                          controller.signal,
                          undefined,
                          { requestId: activeRequestId }
                      );
                  }
              } catch (attemptError: any) {
                  if (attemptError?.name === 'AbortError') throw attemptError;
                  const shouldRetry = (
                      retryCount < TRANSIENT_GENERATION_RETRY_MAX
                      && shouldRetryTransientGenerationError(attemptError)
                  );
                  if (!shouldRetry) throw attemptError;
                  retryCount += 1;
                  const staleJobId = String(currentJobId || activeGatewayJobIdRef.current || '').trim();
                  if (staleJobId) {
                      try {
                          const { cancelTtsJob } = await import('../../shared/api/gatewayClient');
                          await cancelTtsJob(staleJobId, { baseUrl: studioApiBaseUrl });
                      } catch {
                          // Best-effort cancellation before retrying the same request id.
                      }
                  }
                  currentJobId = '';
                  syncActiveGatewayIds(activeRequestId, undefined);
                  patchSingleInflightGenerationLedger({
                      mode: 'single',
                      requestId: activeRequestId,
                      jobId: '',
                      textSnapshot: generationText,
                      startedAtMs: generationStartedAtMs,
                  });
                  setLiveAudioChunks([]);
                  seenLiveChunkKeysRef.current.clear();
                  setProcessingStage('Temporary delay detected. Retrying now...');
                  showToast('We hit a temporary delay. Retrying now.', 'info');
                  await waitForAbortableDelay(TRANSIENT_GENERATION_RETRY_DELAY_MS, controller.signal);
              }
          }
          const { url, voiceNameDisplay, usedMultiSpeaker, speakerCount, runtimeColdStart } = generationResult;
          if (!url) throw new Error('Generated audio URL missing.');
          setLiveProgress(96, 'Finalizing output and updating history...');
          setGeneratedAudioUrlManaged(url);
          const completedAtMs = Date.now();
          const startedAtMs = generationRunStartedAtRef.current || completedAtMs;
          const firstAudioAtMs = generationResult.firstAudioAtMs || generationFirstAudioAtRef.current || completedAtMs;
          const totalGenerationMs = Math.max(0, completedAtMs - startedAtMs);
          const timeToFirstAudioMs = Math.max(0, firstAudioAtMs - startedAtMs);
          setGenerationTiming({
              mode: 'single',
              startedAtMs,
              firstAudioAtMs,
              completedAtMs,
              timeToFirstAudioMs,
              totalGenerationMs,
              partCount: 1,
              partDurationsMs: [totalGenerationMs],
              coldStart: Boolean(runtimeColdStart),
          });

          addToHistory({
              id: Date.now().toString(),
              text: generationText.substring(0, 100) + (generationText.length > 100 ? '...' : ''),
              audioUrl: url,
              voiceName: usedMultiSpeaker
                  ? `Cast (${speakerCount})`
                  : voiceNameDisplay,
              timestamp: Date.now(),
          });
          void loadHistory(30);

          clearSingleInflightGenerationLedger();
          generationFailureBurstRef.current = 0;
          const coldStartLabel = runtimeColdStart ? ' (cold start)' : '';
          const completionMessage = `Audio generated in ${formatGenerationDuration(totalGenerationMs)}${coldStartLabel}. First audio ${formatGenerationDuration(timeToFirstAudioMs)}.`;
          emit('generation.completed', {
              title: 'Generation Completed',
              message: completionMessage,
              entityKey: generationNotificationKey,
              dedupeKey: `generation-completed-single:${generationEngine}`,
              channel: 'inbox',
          });
          showToast(completionMessage, 'success');
      } catch (e: any) {
          if (e.name === 'AbortError') {
              if (generationAbortReasonRef.current === 'manual') {
                  clearSingleInflightGenerationLedger();
              } else if (generationAbortReasonRef.current === 'stall') {
                  const stallMessage = 'Servers are busy right now. Please try again in a little while.';
                  showToast(stallMessage, 'error');
                  emit('generation.failed', {
                      title: 'Generation Stalled',
                      message: stallMessage,
                      entityKey: generationNotificationKey,
                      dedupeKey: `generation-stalled-main:${generationEngine}`,
                      action: {
                          label: 'Open Settings',
                          onClick: () => setShowSettings(true),
                      },
                  });
              }
          } else {
              clearSingleInflightGenerationLedger();
              syncRuntimeBlockedStateFromError(generationEngine, e);
              generationFailureBurstRef.current += 1;
              const failureMessage = formatFrontendError(e, {
                  fallback: 'Generation could not finish right now. Please try again.',
                  context: 'generation',
                  isAdmin: hasAdminConsoleAccess,
              }).publicMessage;
              emit('generation.failed', {
                  title: 'Generation Failure',
                  message: failureMessage,
                  entityKey: generationNotificationKey,
                  dedupeKey: `generation-failed-main:${generationEngine}`,
                  action: {
                      label: 'Open Settings',
                      onClick: () => setShowSettings(true),
                  },
              });
          }
      } finally {
          singleRunLockRef.current = false;
          stopSimulation();
          generationAbortController.current = null;
          activeGatewayRequestIdRef.current = '';
          activeGatewayJobIdRef.current = '';
          generationAbortReasonRef.current = '';
          generationRunStartedAtRef.current = 0;
          generationFirstAudioAtRef.current = 0;
      }
  }, [
      addToHistory,
      buildStudioGenerationSettings,
      clearSingleInflightGenerationLedger,
      emit,
      hasAdminConsoleAccess,
      loadHistory,
      managedActiveEngine,
      patchSingleInflightGenerationLedger,
      performGeneration,
      resolveCustomMusicTrackUrlForSettings,
      settings,
      showToast,
      stopSimulation,
      syncActiveGatewayIds,
      syncRuntimeBlockedStateFromError,
  ]);

  const handleGenerate = async () => {
    if (isGenerating || singleRunLockRef.current) return;
    if (isStudioQueueRunActiveRef.current || queueRunnerLockRef.current) return;
    if (engineSwitchInProgress) {
      showToast('Wait for the engine switch to finish before generating.', 'info');
      return;
    }
    if (studioDirectorPreview) {
      showToast('Apply or discard the AI Director preview first. The directed pass is waiting for review.', 'info');
      return;
    }
    const inflightSingle = singleInflightLedgerRef.current;
    if (inflightSingle) {
        if (!shouldResumeSingleGenerationFromLedger(text, inflightSingle)) {
          clearSingleInflightGenerationLedger();
        } else {
        await runSingleGeneration({ inflightLedger: inflightSingle, treatAsRecovery: true });
        return;
        }
    }
    if (!text.trim()) return showToast("Please enter some text.", "info");
    const activeEngineForGeneration = managedActiveEngine || settings.engine;
    if (text.length > maxCharsPerGeneration) {
      if (!isStudioQueueModeEnabled) {
        emit('custom.message', {
          title: 'Queue Recommended',
          message: `This script is ${text.length.toLocaleString()} chars. Single generation is capped at ${maxCharsPerGeneration.toLocaleString()} chars.`,
          dedupeKey: 'studio-queue-recommended',
          channel: 'inbox',
          action: {
            label: 'Enable Queue',
            onClick: () => {
              if (isGenerating || isStudioQueueRunActiveRef.current) return;
              setStudioQueueModeEnabled(true);
              setStudioRailTab('queue');
              void startStudioQueuedGeneration();
            },
          },
        });
        return showToast(`Single generation is capped at ${maxCharsPerGeneration.toLocaleString()} chars. Tap "Enable Queue" to run this script.`, 'info');
      }
      setStudioRailTab('queue');
      await startStudioQueuedGeneration();
      return;
    }
    if (isWalletBlocked && !canRunVectorWithoutWallet) {
      showToast(`Insufficient ${getEngineDisplayName(activeEngineForGeneration)} VF balance. Open Billing to top up or upgrade.`, 'error');
      openBillingCenter();
      return;
    }
    await runSingleGeneration();
  };

  useEffect(() => {
      if (!isStudioWorkspaceTab) {
          singleInflightAutoResumeAttemptedRef.current = false;
          return;
      }
      const inflightSingle = singleInflightLedgerRef.current;
      if (!inflightSingle) return;
      if (!hasRecoverableSingleInflightGenerationState(inflightSingle)) return;
      if (!shouldResumeSingleGenerationFromLedger(text, inflightSingle)) {
          clearSingleInflightGenerationLedger();
          return;
      }
      const inflightStartedAtMs = Number(inflightSingle.startedAtMs || 0);
      if (
          Number.isFinite(inflightStartedAtMs)
          && inflightStartedAtMs > 0
          && (Date.now() - inflightStartedAtMs) > SINGLE_INFLIGHT_AUTO_RESUME_MAX_AGE_MS
      ) {
          clearSingleInflightGenerationLedger();
          return;
      }
      if (singleInflightAutoResumeAttemptedRef.current) return;
      if (isGenerating || isStudioQueueRunActiveRef.current) return;
      if (singleRunLockRef.current) return;
      if (studioQueueState?.items.some((item) => item.status === 'running')) return;
      singleInflightAutoResumeAttemptedRef.current = true;
      void runSingleGeneration({ inflightLedger: inflightSingle, treatAsRecovery: true });
  }, [clearSingleInflightGenerationLedger, isGenerating, isStudioWorkspaceTab, runSingleGeneration, studioQueueState]);

  // --- Character Management Logic ---
  const openCharacterModal = (char?: CharacterProfile, presetVoiceId?: string) => {
      if (char) {
          setEditingChar(char);
          setCharForm(char);
      } else {
          setEditingChar(null);
          // Auto-color assignment
          const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'];
          const randomColor = colors[Math.floor(Math.random() * colors.length)] || '#6366f1';
          const defaultCatalog = getEngineVoiceCatalog(settings.engine);
          
          setCharForm({
              id: Date.now().toString(),
              name: '',
              voiceId: getValidVoiceIdForEngine(
                  settings.engine,
                  presetVoiceId || defaultCatalog[0]?.id || DEFAULT_GEM_VOICE_ID
              ),
              gender: 'Unknown',
              age: 'Adult',
              avatarColor: randomColor
          });
      }
      setCharacterModalOpen(true);
  };

  const saveCharacter = () => {
      if (!charForm.name.trim()) return showToast("Character Name required", "error");
      updateCharacter(charForm);
      setCharacterModalOpen(false);
      showToast(editingChar ? "Character Updated" : "Character Added", "success");
  };

  const deleteChar = (id: string) => {
      if (confirm("Delete this character?")) {
          deleteCharacter(id);
          showToast("Character Deleted", "info");
      }
  };

  // --- VOICE PREVIEW LOGIC ---
  const handleVoicePreview = async (voiceId: string, name: string) => {
      const voice = getVoiceById(voiceId);
      const engine: GenerationSettings['engine'] = resolveEngineToken(voice?.engine) as GenerationSettings['engine'];
      await playVoiceSample(voiceId, name, engine);
  };

  const resolveVoicePreviewUrl = useCallback((voice?: VoiceOption): string => {
      const raw = String(voice?.previewUrl || '').trim();
      if (!raw) return '';
      return raw;
  }, []);

  const resolveClonedVoicePlaybackUrl = useCallback((voice?: VoiceOption): string => {
      if (!voice) return '';
      const preview = resolveVoicePreviewUrl(voice);
      if (preview) return preview;
      if (!voice.isCloned) return '';
      const clonedVoice = voice as ClonedVoice;
      return String(clonedVoice.originalSampleUrl || clonedVoice.referenceAudioUrl || '').trim();
  }, [resolveVoicePreviewUrl]);

  const buildVoiceSampleCacheKey = useCallback(
      (
          voiceId: string,
          _name: string,
          engine: GenerationSettings['engine'] = 'PRIME'
      ): string => buildVoiceSampleSingleFlightKey(voiceId, engine),
      []
  );

  const buildVoiceSampleSource = useCallback(async (
      voiceId: string,
      name: string,
      engine: GenerationSettings['engine'] = 'PRIME'
  ): Promise<{ url: string; needsCleanup: boolean }> => {
      const normalizedVoiceId = String(voiceId || '').trim();
      const normalizedName = String(name || '').trim();
      const normalizedEngine = resolveEngineToken(engine) as GenerationSettings['engine'];
      if (!normalizedVoiceId) {
          throw new Error('Select a voice before previewing.');
      }

      const cacheKey = buildVoiceSampleCacheKey(normalizedVoiceId, normalizedName, normalizedEngine);
      const cache = voiceSampleCacheRef.current;
      const cachedEntry = cache.get(cacheKey);
      if (cachedEntry?.source) {
          return { url: cachedEntry.source.url, needsCleanup: false };
      }
      if (cachedEntry?.inFlight) {
          const source = await cachedEntry.inFlight;
          return { url: source.url, needsCleanup: false };
      }

      const inFlight = (async (): Promise<VoiceSampleSource> => {
      const selectedVoice = getVoiceById(normalizedVoiceId);
      const fallbackPreviewUrl = resolveVoicePreviewUrl(selectedVoice);
      const clonedPlaybackUrl = resolveClonedVoicePlaybackUrl(selectedVoice);

      if (clonedPlaybackUrl) {
          return { url: clonedPlaybackUrl, needsCleanup: false };
      }
      if (fallbackPreviewUrl) {
          return { url: fallbackPreviewUrl, needsCleanup: false };
      }

      await ensureEngineOnline(normalizedEngine, { silent: true, syncVoiceId: normalizedVoiceId, requireAccess: true });

      const previewSettings: GenerationSettings = {
          ...settings,
          engine: normalizedEngine,
          voiceId: normalizedVoiceId,
          speed: 1.0,
          emotion: 'Neutral',
      };

      const text = `Hello! I am ${normalizedName || 'the speaker'}. I can bring your story to life.`;

      let voiceParam = normalizedName;
      if (isGemRuntimeEngine(normalizedEngine)) {
        voiceParam = selectedVoice?.geminiVoiceName || clonedVoices.find((voice) => voice.id === normalizedVoiceId)?.geminiVoiceName || 'Fenrir';
      } else {
        voiceParam = normalizedVoiceId;
      }

      const { generateSpeech } = await loadGeminiService();
      const previewRequestId = `voice-preview:${resolveEngineToken(normalizedEngine)}:${String(normalizedVoiceId || normalizedName || 'voice').trim().replace(/\s+/g, '_')}`;
      const buffer = await runSingleFlightTtsRequest(previewRequestId, async () => (
        generateSpeech(
            text,
            voiceParam,
            previewSettings,
            'speech',
            undefined,
            { context: 'preview', preferLiveChunks: true, requestId: previewRequestId }
        )
      ));
      const blob = audioBufferToWav(buffer);
      return { url: URL.createObjectURL(blob), needsCleanup: true };
      })();

      cache.set(cacheKey, { inFlight });
      try {
          const source = await inFlight;
          cache.set(cacheKey, { source });
          return { url: source.url, needsCleanup: false };
      } catch (error) {
          const latest = cache.get(cacheKey);
          if (latest?.inFlight === inFlight) {
              cache.delete(cacheKey);
          }
          throw error;
      }
  }, [buildVoiceSampleCacheKey, clonedVoices, ensureEngineOnline, getVoiceById, isGemRuntimeEngine, resolveClonedVoicePlaybackUrl, resolveVoicePreviewUrl, runSingleFlightTtsRequest, settings]);

  const warmVoiceSample = useCallback(async (
      voiceId: string,
      name: string,
      engine: GenerationSettings['engine'] = 'PRIME',
      options?: { silent?: boolean }
  ): Promise<void> => {
      try {
          await buildVoiceSampleSource(voiceId, name, engine);
      } catch (error: any) {
          if (options?.silent) return;
          syncRuntimeBlockedStateFromError(engine, error);
          showToast(error?.message || 'Unable to prepare the voice preview.', 'error');
      }
  }, [buildVoiceSampleSource, showToast, syncRuntimeBlockedStateFromError]);

  const playVoiceSample = async (voiceId: string, name: string, engine: GenerationSettings['engine'] = 'PRIME') => {
      const normalizedEngine = resolveEngineToken(engine) as GenerationSettings['engine'];
      // Stop current
      if (previewAudioRef.current) {
          previewAudioRef.current.pause();
          previewAudioRef.current = null;
      }
      
      // Toggle off if clicking same
      if (previewState?.id === voiceId && previewState.status === 'playing') {
          setPreviewState(null);
          return;
      }

      setPreviewState({ id: voiceId, status: 'loading' });

      const playAudioSource = async (sourceUrl: string): Promise<void> => {
          const audio = new Audio(sourceUrl);
          audio.crossOrigin = 'anonymous';
          previewAudioRef.current = audio;
          applySafeMediaVolume(audio, 1.0, {
              fallback: 1,
              context: 'voice_preview',
              onError: (error, info) => {
                  void reportFrontendSignal({
                      message: 'studio.media_volume_assignment_failed',
                      component: 'MainApp',
                      severity: 'warning',
                      metadata: {
                          channel: 'voice_preview',
                          attemptedVolume: info.attemptedVolume,
                          appliedFallback: info.appliedFallback,
                          context: info.context,
                          error: error instanceof Error ? error.message : String(error || 'unknown'),
                      },
                  });
              },
          });
          audio.onended = () => {
              setPreviewState(null);
              previewAudioRef.current = null;
          };
          await audio.play();
          setPreviewState({ id: voiceId, status: 'playing' });
      };

      try {
          const sampleSource = await buildVoiceSampleSource(voiceId, name, normalizedEngine);
          await playAudioSource(sampleSource.url);
      } catch (e: any) {
          syncRuntimeBlockedStateFromError(normalizedEngine, e);
          showToast(e.message, 'error');
          setPreviewState(null);
      }
  };

  const handlePreviewCharacter = async (char: CharacterProfile) => {
     const vid = char.voiceId;
       const engine: GenerationSettings['engine'] = resolveEngineToken(getVoiceById(vid)?.engine) as GenerationSettings['engine'];
      await playVoiceSample(char.voiceId, char.name, engine);
  };




  const isGuestSession =
    !user.email ||
    user.email.toLowerCase() === 'guest@v-flow-ai.com' ||
    user.email.toLowerCase() === 'guest@voiceflow.ai' ||
    user.googleId === 'guest_mode';

  // --- AI Tools (Shared) ---

  const requireSignedInForAiTool = useCallback((actionLabel: string): boolean => {
      if (hasSessionIdentity && !isGuestSession) return true;
      writeStorageString(STORAGE_KEYS.authIntent, 'login');
      setIsChatOpen(false);
      setIsMobileMenuOpen(false);
      if (typeof window !== 'undefined') {
          window.location.href = resolveLoginPath('login');
          showToast(`Sign in to use ${actionLabel}.`, 'info');
          return false;
      }
      setScreen(AppScreen.LOGIN);
      showToast(`Sign in to use ${actionLabel}.`, 'info');
      return false;
  }, [hasSessionIdentity, isGuestSession, setScreen, showToast]);

  // --- PROOFREADER ---
  const handleProofread = async (mode: 'grammar' | 'flow' | 'creative' | 'novel' = 'flow') => {
      if (!requireSignedInForAiTool(mode === 'grammar' ? 'Grammar' : mode === 'novel' ? 'Audio Novel' : 'Flow')) return;
      const currentText = text;
      const setFn = setText;
      
      if (!currentText || !currentText.trim()) return showToast("Enter text to proofread", "info");
      
      setIsAiWriting(true);
      showToast(mode === 'grammar' ? "Fixing Grammar..." : mode === 'novel' ? "Directing Audio Novel..." : "Optimizing...", "info");
      
      try {
          const { proofreadScript } = await loadGeminiService();
          const polished = await proofreadScript(currentText, settings, mode, {
              languageCode: activeScriptLanguageCode,
          });
          setFn(polished);
          showToast("Script Enhanced", "success");
      } catch (e: any) {
          syncRuntimeBlockedStateFromError(settings.engine, e);
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };

  const handleDirectorAI = async (targetText: string) => {
      if (!requireSignedInForAiTool('AI Director')) return;
      const safeInput = String(targetText || '');
      if (!safeInput.trim()) {
          showToast('Enter text first', 'info');
          return;
      }
      const activeDirectorModes = describeStudioDirectorModeState(studioDirectorModeState);
      const directorOptions =
          studioDirectorModeState.expressiveEmotion || studioDirectorModeState.autoRewrite
              ? {
                    style: 'natural' as const,
                    tone: studioDirectorModeState.expressiveEmotion ? ('dramatic' as const) : ('neutral' as const),
                    expressiveEmotion: studioDirectorModeState.expressiveEmotion,
                    autoRewrite: studioDirectorModeState.autoRewrite,
                }
              : undefined;
      setIsAiWriting(true);
      try {
          const { autoDirectStudioScript } = await loadGeminiService();
          const { mood, cast, directedText } = await autoDirectStudioScript(
              safeInput,
              settings,
              directorOptions,
              characterLibrary
          );
          const tagInjection = injectDirectorTagsPreservingFormat(safeInput, directedText || safeInput);
          const appliedText = String(tagInjection.text || directedText || safeInput);
          const castNames = (cast || [])
              .map((entry) => String(entry.name || '').trim())
              .filter((name) => name.length > 0);

          // Apply immediately (legacy behaviour from the first shipped build)
          setStudioDirectorPreview(null);
          setStudioEditorMode('raw');
          setText(appliedText);

          if (castNames.length > 0) {
              startTransition(() => setDetectedSpeakers(castNames));
              syncCast(cast as any);
          }

          const moodLabel = String(mood || '').trim() || 'Neutral';
          const speakerNote =
              castNames.length > 0
                  ? `${castNames.length} speaker${castNames.length === 1 ? '' : 's'} detected.`
                  : 'No new speakers detected.';
          showToast(`AI Director applied (${activeDirectorModes}). Mood: ${moodLabel}. ${speakerNote}`, 'success');
      } catch (e: any) {
          syncRuntimeBlockedStateFromError(settings.engine, e);
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };

  const handleStudioImportFiles = useCallback(async (incoming: FileList | File[] | null | undefined) => {
      const files = Array.from(incoming || []).filter((file): file is File => Boolean(file));
      if (files.length <= 0) return;
      setIsStudioImporting(true);
      try {
          const settled = await Promise.allSettled(
              files.map(async (file) => {
                  const extracted = await extractNovelTextFromFile(file, 'auto');
                  return { file, extracted };
              })
          );

          const importedChunks: string[] = [];
          const failures: string[] = [];
          let aiFallbackCount = 0;

          for (const item of settled) {
              if (item.status === 'fulfilled') {
                  const fileName = String(item.value.file.name || 'Imported File').trim() || 'Imported File';
                  const rawText = String(item.value.extracted.rawText || '').trim();
                  if (!rawText) {
                      failures.push(`${fileName}: empty text`);
                      continue;
                  }
                  if (item.value.extracted.diagnostics?.usedAiFallback) {
                      aiFallbackCount += 1;
                  }
                  importedChunks.push(`===== ${fileName} =====\n${rawText}`);
              } else {
                  const reason = item.reason as { message?: string } | undefined;
                  const message = toUserFriendlySystemMessage(reason?.message || 'Import failed', 'Import failed');
                  failures.push(message);
              }
          }

          if (importedChunks.length <= 0) {
              throw new Error(failures[0] || 'No readable text was extracted from the selected files.');
          }

          const mergedImport = importedChunks.join('\n\n');
          setText((previous) => {
              const current = String(previous || '').trim();
              return current ? `${current}\n\n${mergedImport}` : mergedImport;
          });
          setStudioEditorMode('raw');

          showToast(
              `Imported ${importedChunks.length}/${files.length} file(s)${aiFallbackCount > 0 ? `, AI extracted ${aiFallbackCount}` : ''}.`,
              'success'
          );

          if (failures.length > 0) {
              showToast(`Skipped ${failures.length} file(s): ${failures[0]}`, 'info');
          }
      } catch (error: any) {
          showToast(toUserFriendlySystemMessage(error?.message || 'Import failed.', 'Import failed.'), 'error');
      } finally {
          setIsStudioImporting(false);
      }
  }, [showToast, toUserFriendlySystemMessage]);

  const handleCustomMusicTrackInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0] || null;
      if (!selectedFile) {
          event.target.value = '';
          return;
      }
      const mimeType = String(selectedFile.type || '').trim().toLowerCase();
      const fileName = String(selectedFile.name || '').trim();
      const hasKnownAudioExtension = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(fileName);
      if (!mimeType.startsWith('audio/') && !hasKnownAudioExtension) {
          showToast('Please upload a valid audio file for background music.', 'info');
          event.target.value = '';
          return;
      }
      if (selectedFile.size > STUDIO_CUSTOM_MUSIC_MAX_FILE_BYTES) {
          const maxMb = Math.round(STUDIO_CUSTOM_MUSIC_MAX_FILE_BYTES / (1024 * 1024));
          showToast(`Background track is too large. Use a file up to ${maxMb}MB.`, 'info');
          event.target.value = '';
          return;
      }
      const objectUrl = URL.createObjectURL(selectedFile);
      setCustomMusicTrackUploadManaged({
          name: fileName || 'Uploaded track',
          url: objectUrl,
          sizeBytes: selectedFile.size,
          mimeType: mimeType || 'audio/*',
      });
      setSettings((prev) => ({ ...prev, musicTrackId: STUDIO_CUSTOM_MUSIC_TRACK_ID }));
      showToast(`Background track "${fileName || 'uploaded file'}" is ready.`, 'success');
      event.target.value = '';
  }, [setCustomMusicTrackUploadManaged, showToast]);

  const clearCustomMusicTrackUpload = useCallback(() => {
      const hadUpload = Boolean(customMusicTrackUploadRef.current?.url);
      if (customMusicTrackInputRef.current) {
          customMusicTrackInputRef.current.value = '';
      }
      setCustomMusicTrackUploadManaged(null);
      setSettings((prev) => (
          prev.musicTrackId === STUDIO_CUSTOM_MUSIC_TRACK_ID
              ? { ...prev, musicTrackId: DEFAULT_SETTINGS.musicTrackId }
              : prev
      ));
      if (hadUpload) {
          showToast('Custom background track removed.', 'info');
      }
  }, [setCustomMusicTrackUploadManaged, showToast]);

  const handleStudioImportInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
          void handleStudioImportFiles(files);
      }
      event.target.value = '';
  }, [handleStudioImportFiles]);
  
  const handleTranslate = async () => {
      if (!requireSignedInForAiTool('Translate')) return;
      const currentText = text;
      const setFn = setText;
      
      if(!currentText) return showToast("Enter text first", "info");
      
      setIsAiWriting(true);
      try {
          const { translateText } = await loadGeminiService();
          const translated = await translateText(currentText, targetLang, settings);
          setFn(translated);
          showToast("Translation Complete", "success");
      } catch(e: any) {
          syncRuntimeBlockedStateFromError(settings.engine, e);
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };

  const normalizeAssistantEditorDraft = useCallback((raw: string): string => {
      const normalized = String(raw || '').replace(/\r\n/g, '\n').trim();
      if (!normalized) return '';

      const fenced = normalized.match(/^```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```$/i);
      const content = fenced ? String(fenced[1] || '') : normalized;
      return content.trim();
  }, []);

  const applyAssistantDraftToEditor = useCallback((rawDraft: string, mode: AssistantApplyMode): boolean => {
      const nextDraft = normalizeAssistantEditorDraft(rawDraft);
      if (!nextDraft) return false;

      setText((previous) => {
          const current = String(previous || '');
          if (mode === 'replace' || !current.trim()) return nextDraft;
          const joiner = current.endsWith('\n') ? '\n' : '\n\n';
          return `${current}${joiner}${nextDraft}`;
      });
      setStudioEditorMode('raw');
      return true;
  }, [normalizeAssistantEditorDraft]);

  const handleAssistantRequest = useCallback(async (
      requestText: string,
      options: AssistantRequestOptions = {}
  ) => {
      if (!requireSignedInForAiTool('Assistant')) return;
      const userText = String(requestText || '').trim();
      if (!userText) return;

      const applyToEditor = options.applyToEditor ?? assistantAutoApply;
      const applyMode = options.applyMode ?? assistantApplyMode;
      const historyText = String(options.historyText || userText);

      setChatHistory((prev) => [...prev, { role: 'user', text: historyText }]);
      setIsChatLoading(true);

      const context = text;

      try {
          const { generateTextContent } = await loadGeminiService();
          const response = await generateTextContent(userText, context, settings);
          const sanitizedResponse = sanitizeUiText(response);
          setLastAssistantDraft(sanitizedResponse);
          setChatHistory((prev) => [...prev, { role: 'ai', text: sanitizedResponse }]);

          if (applyToEditor) {
              const applied = applyAssistantDraftToEditor(sanitizedResponse, applyMode);
              if (applied) {
                  showToast(
                      applyMode === 'append'
                          ? 'Assistant appended content to the editor.'
                          : 'Assistant replaced editor content.',
                      'success'
                  );
              }
          }
      } catch (e: any) {
          syncRuntimeBlockedStateFromError(settings.engine, e);
          const message = formatFrontendError(e, {
              fallback: 'Assistant request failed.',
              context: 'generation',
              isAdmin: hasAdminConsoleAccess,
          }).publicMessage;
          setChatHistory((prev) => [...prev, { role: 'ai', text: `[Assistant error] ${message}` }]);
          showToast(message, 'error');
      } finally {
          setIsChatLoading(false);
      }
  }, [
      assistantApplyMode,
      assistantAutoApply,
      applyAssistantDraftToEditor,
      hasAdminConsoleAccess,
      requireSignedInForAiTool,
      settings,
      showToast,
      text,
  ]);

  const assistantQuickActions = useMemo<AssistantQuickAction[]>(() => ([
      {
          id: 'continue',
          label: 'Continue',
          prompt: 'Continue the current script from the exact ending. Keep the same language, tone, and speaker format. Output only the new lines.',
          applyToEditor: true,
          applyMode: 'append',
          requiresContext: true,
      },
      {
          id: 'rewrite',
          label: 'Rewrite',
          prompt: 'Rewrite the full script to sound more cinematic and emotionally engaging while preserving intent. Keep it production-ready. Output script only.',
          applyToEditor: true,
          applyMode: 'replace',
          requiresContext: true,
      },
      {
          id: 'tighten',
          label: 'Tighten',
          prompt: 'Condense the script by around 25% while keeping the core meaning and emotional beat. Output script only.',
          applyToEditor: true,
          applyMode: 'replace',
          requiresContext: true,
      },
      {
          id: 'dialogue',
          label: 'Add Dialogue',
          prompt: 'Add a short dialogue beat (4-6 lines) that increases conflict and clarity. Keep speaker names consistent. Output only the new lines.',
          applyToEditor: true,
          applyMode: 'append',
          requiresContext: true,
      },
      {
          id: 'hook',
          label: 'Hook',
          prompt: 'Write a strong opening hook for a voice-over script in 3-5 lines. Make it instantly attention-grabbing and narratable.',
          applyToEditor: true,
          applyMode: 'replace',
      },
      {
          id: 'guide',
          label: 'Guide Me',
          prompt: 'Review the current script and provide concise writing guidance with sections: Hook, Pacing, Emotion, Voice, and Next Revision Step. Include one improved sample paragraph.',
          applyToEditor: false,
          applyMode: 'append',
          requiresContext: true,
      },
  ]), []);

  const handleAssistantQuickAction = useCallback((action: AssistantQuickAction) => {
      if (action.requiresContext && !text.trim()) {
          showToast('Write or import script text first so the assistant has context.', 'info');
          return;
      }

      void handleAssistantRequest(action.prompt, {
          applyToEditor: action.applyToEditor,
          applyMode: action.applyMode,
          historyText: `Quick action: ${action.label}`,
      });
  }, [handleAssistantRequest, showToast, text]);

  const handleApplyLastAssistantDraft = useCallback(() => {
      if (!lastAssistantDraft.trim()) {
          showToast('No assistant draft available yet.', 'info');
          return;
      }
      const applied = applyAssistantDraftToEditor(lastAssistantDraft, assistantApplyMode);
      if (applied) {
          showToast(
              assistantApplyMode === 'append'
                  ? 'Last assistant draft appended to the editor.'
                  : 'Editor replaced with the last assistant draft.',
              'success'
          );
      }
  }, [applyAssistantDraftToEditor, assistantApplyMode, lastAssistantDraft, showToast]);

  const handleChatSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const userText = String(chatInput || '').trim();
      if (!userText) return;
      setChatInput('');
      await handleAssistantRequest(userText);
  };

  const openVoiceCloneModal = useCallback((target: VoiceCloneTarget) => {
      setVoiceCloneTarget(target);
      setIsVoiceCloneModalOpen(true);
  }, []);

  const cleanupVoiceCloneTargetSource = useCallback((target?: VoiceCloneTarget | null) => {
      if (!target?.sourceVoiceUrlNeedsCleanup) return;
      try {
          URL.revokeObjectURL(target.sourceVoiceUrl);
      } catch {
          // Ignore URL cleanup failures.
      }
  }, []);

  const closeVoiceCloneModal = useCallback(() => {
      cleanupVoiceCloneTargetSource(voiceCloneTargetRef.current);
      setIsVoiceCloneModalOpen(false);
      setVoiceCloneTarget(null);
  }, [cleanupVoiceCloneTargetSource]);

  const handleVoiceCloneCreated = useCallback((result: VoiceCloneModalResult) => {
      const target = voiceCloneTargetRef.current;
      const speakerName = String(target?.speakerName || '').trim();
      if (!speakerName) {
          closeVoiceCloneModal();
          showToast('Reference audio saved for this session.', 'success');
          return;
      }
      const speakerKey = normalizeSpeakerMapKey(speakerName);
      if (!speakerKey) {
          closeVoiceCloneModal();
          showToast('Reference audio saved for this session.', 'success');
          return;
      }
      const nextReference: SpeakerVcReference = {
          referenceArtifactId: String(result.referenceArtifactId || '').trim() || undefined,
          referenceAudioUrl: String(result.referenceAudioUrl || '').trim(),
          referenceAudioName: String(result.referenceAudioName || 'reference.wav').trim() || 'reference.wav',
          sourceVoiceId: String(result.sourceVoiceId || target?.voiceId || '').trim(),
          sourceVoiceName: String(result.sourceVoiceName || target?.sourceVoiceLabel || speakerName).trim(),
          sourceVoiceEngine: String(result.sourceVoiceEngine || target?.sourceVoiceEngine || settings.engine || '').trim(),
          consumedVcUnits: Math.max(0, Number(result.consumedVcUnits || 0)),
          updatedAt: Date.now(),
      };
      const existingReference = speakerVcReferenceMap[speakerKey];
      setSpeakerVcReferenceMap((prev) => ({
          ...prev,
          [speakerKey]: nextReference,
      }));
      closeVoiceCloneModal();
      showToast(
          existingReference ? `Reference audio updated for ${speakerName}.` : `Reference audio added for ${speakerName}.`,
          'success'
      );
  }, [closeVoiceCloneModal, settings.engine, showToast, speakerVcReferenceMap]);

  function buildStudioGenerationSettings(baseSettings: GenerationSettings): GenerationSettings {
      const resolvedEngine = managedActiveEngine || baseSettings.engine;
      return {
          ...baseSettings,
          engine: resolvedEngine,
          runtimeProvider: ttsRuntimeStatus[resolvedEngine]?.provider || '',
          speakerMapping: {
              ...(baseSettings.speakerMapping || {}),
          },
      };
  }

  const clearSpeakerVcReference = useCallback((speakerName: string) => {
      const speakerKey = normalizeSpeakerMapKey(String(speakerName || '').trim());
      if (!speakerKey) return;
      setSpeakerVcReferenceMap((prev) => {
          if (!prev[speakerKey]) return prev;
          const next = { ...prev };
          delete next[speakerKey];
          return next;
      });
  }, []);

  const openVoiceConversionForVoiceId = useCallback((
      voiceId: string,
      speakerName?: string,
      characterId?: string
  ) => {
      enableStudioMultiSpeaker();
      const voice = getVoiceById(voiceId);
      const sourceVoiceLabel = voice ? resolveVoiceDisplayLabel(voice) : String(speakerName || 'Selected speaker').trim() || 'Selected speaker';
      openVoiceCloneModal({
          voiceId,
          speakerName: speakerName ? String(speakerName).trim() : undefined,
          characterId,
          sourceVoiceLabel,
          sourceVoiceEngine: String(voice?.engine || settings.engine || '').trim(),
          sourceVoiceUrl: '',
          sourceVoiceUrlNeedsCleanup: false,
      });
  }, [enableStudioMultiSpeaker, getVoiceById, openVoiceCloneModal, resolveVoiceDisplayLabel, settings.engine]);

  // --- Derived State for Gallery ---
  const galleryVoicePool = useMemo(() => {
      const dedup = new Map<string, VoiceOption>();
      clonedVoices.forEach((voice) => {
          if (!voice?.id) return;
          const voiceEngine = resolveEngineToken(voice.engine || settings.engine) as GenerationSettings['engine'];
          dedup.set(voice.id, withVoiceMeta(voice, voiceEngine));
      });
      ENGINE_ORDER.forEach((engine) => {
          getEngineVoiceCatalog(engine).forEach((voice) => {
              dedup.set(voice.id, voice);
          });
      });
      return [...dedup.values()];
  }, [clonedVoices, getEngineVoiceCatalog]);

  const filteredVoices = useMemo(() => {
      const normalizedSearch = deferredVoiceSearch.trim().toLowerCase();
      return galleryVoicePool.filter((voice) => {
          const searchable = [
              voice.name,
              voice.accent,
              resolveVoiceCountry(voice),
              voice.engine || '',
          ]
              .join(' ')
              .toLowerCase();
          const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
          const matchesGender = voiceFilterGender === 'All' || voice.gender === voiceFilterGender;
          const matchesAccent = voiceFilterAccent === 'All' || resolveVoiceCountry(voice) === voiceFilterAccent;
          return matchesSearch && matchesGender && matchesAccent;
      });
  }, [deferredVoiceSearch, galleryVoicePool, voiceFilterAccent, voiceFilterGender]);

  const uniqueAccents = useMemo(
      () => Array.from(new Set(galleryVoicePool.map((voice) => resolveVoiceCountry(voice)))).sort(),
      [galleryVoicePool]
  );
  const studioVoiceOptions = useMemo(
      () => getLanguageScopedVoiceCatalog(settings.engine, studioTextLanguageCode),
      [getLanguageScopedVoiceCatalog, settings.engine, studioTextLanguageCode]
  );
  const studioFreeVoiceOptions = useMemo(
      () => studioVoiceOptions.filter((voice) => resolveVoiceAccessTier(settings.engine, voice) === 'free'),
      [resolveVoiceAccessTier, settings.engine, studioVoiceOptions]
  );
  const studioProVoiceOptions = useMemo(
      () => studioVoiceOptions.filter((voice) => resolveVoiceAccessTier(settings.engine, voice) === 'pro'),
      [resolveVoiceAccessTier, settings.engine, studioVoiceOptions]
  );
  const castVoiceOptions = useMemo(
      () => getLanguageScopedVoiceCatalog(
          settings.engine,
          activeScriptLanguageCode,
          [
              settings.voiceId,
              ...castSpeakers
                  .map((speaker) => resolveMappedVoiceForSpeaker(speaker))
                  .filter((voiceId): voiceId is string => Boolean(voiceId)),
          ]
      ),
      [activeScriptLanguageCode, castSpeakers, getLanguageScopedVoiceCatalog, resolveMappedVoiceForSpeaker, settings.engine, settings.voiceId]
  );
  const castFreeVoiceOptions = useMemo(
      () => castVoiceOptions.filter((voice) => resolveVoiceAccessTier(settings.engine, voice) === 'free'),
      [castVoiceOptions, resolveVoiceAccessTier, settings.engine]
  );
  const castProVoiceOptions = useMemo(
      () => castVoiceOptions.filter((voice) => resolveVoiceAccessTier(settings.engine, voice) === 'pro'),
      [castVoiceOptions, resolveVoiceAccessTier, settings.engine]
  );
  const speakerPreviewWarmTargets = useMemo(() => {
      if (activeTab !== Tab.STUDIO && activeTab !== Tab.VOICE_CLONING) {
          return [];
      }
      const targets = new Map<string, { voiceId: string; speakerName: string; engine: GenerationSettings['engine'] }>();
      const registerTarget = (voiceId: string, speakerName: string) => {
          const normalizedVoiceId = String(voiceId || '').trim();
          const normalizedSpeakerName = String(speakerName || '').trim();
          if (!normalizedVoiceId || !normalizedSpeakerName) return;
          const engine = resolveEngineToken(getVoiceById(normalizedVoiceId)?.engine || settings.engine) as GenerationSettings['engine'];
          const cacheKey = buildVoiceSampleCacheKey(normalizedVoiceId, normalizedSpeakerName, engine);
          if (targets.has(cacheKey)) return;
          targets.set(cacheKey, {
              voiceId: normalizedVoiceId,
              speakerName: normalizedSpeakerName,
              engine,
          });
      };

      characterLibrary.forEach((character) => {
          registerTarget(character.voiceId, character.name);
      });

      if (isStudioWorkspaceTab && isStudioMultiSpeakerEnabled) {
          castSpeakers.forEach((speaker) => {
              const mappedVoiceId = resolveMappedVoiceForSpeaker(speaker) || settings.voiceId;
              registerTarget(mappedVoiceId, speaker);
          });
      }

      return Array.from(targets.values());
  }, [
      activeTab,
      buildVoiceSampleCacheKey,
      castSpeakers,
      characterLibrary,
      getVoiceById,
      isStudioMultiSpeakerEnabled,
      isStudioWorkspaceTab,
      resolveMappedVoiceForSpeaker,
      settings.engine,
      settings.voiceId,
  ]);
  useEffect(() => {
      if (speakerPreviewWarmTargets.length <= 0) return;
      let cancelled = false;

      const warmAllSpeakerSamples = async () => {
          for (const target of speakerPreviewWarmTargets) {
              if (cancelled) return;
              await warmVoiceSample(target.voiceId, target.speakerName, target.engine, { silent: true });
          }
      };

      void warmAllSpeakerSamples();
      return () => {
          cancelled = true;
      };
  }, [speakerPreviewWarmTargets, warmVoiceSample]);
  const getEngineLabel = (engine: GenerationSettings['engine']) => getEngineDisplayName(engine);
  const getEngineSubLabel = (engine: GenerationSettings['engine']) => (
    engine === 'VECTOR'
      ? 'Cloud Runtime'
      : 'Cloud Runtime'
  );
  const getEngineDescription = (engine: GenerationSettings['engine']) => {
    if (engine === 'VECTOR') return 'Balanced cloud engine for clear narration and dependable multilingual output.';
    return 'Premium cloud engine for richer expression, stronger direction follow-through, and complex scenes.';
  };
  const getRuntimeOfflineMessage = (engine: GenerationSettings['engine']) => (
    `${getEngineDisplayName(engine)} runtime is offline. Start services or retry activation.`
  );
  const getRuntimeNotConfiguredMessage = (engine: GenerationSettings['engine']) => (
    `${getEngineDisplayName(engine)} runtime is not configured.`
  );
  const formatCompactRate = (value: number): string => {
    const safe = Math.max(0, Number(value || 0));
    if (!Number.isFinite(safe) || safe <= 0) return '0';
    return safe.toFixed(safe < 1 ? 2 : 1).replace(/\.?0+$/, '');
  };
  const getEngineVfRate = (engine: GenerationSettings['engine']): number =>
    Math.max(0, Number(stats?.vfUsage?.rates?.[engine] || 0));
  const getEngineRateLabel = (engine: GenerationSettings['engine']): string => {
    const rate = getEngineVfRate(engine);
    if (rate <= 0) return 'VF rate syncing';
    return `${formatCompactRate(rate)} VF / char`;
  };
  const getEngineCharsPerVfLabel = (engine: GenerationSettings['engine']): string => {
    const rate = getEngineVfRate(engine);
    if (rate <= 0) return 'chars/VF pending';
    return `~${formatCompactRate(1 / rate)} chars / VF`;
  };
  const getRuntimeStateLabel = (state: EngineRuntimeState) => {
    if (state === 'online') return 'Online';
    if (state === 'offline') return 'Offline';
    if (state === 'standby') return 'Standby';
    if (state === 'starting' || state === 'warming') return 'Starting';
    if (state === 'not_configured') return 'Not Set';
    return 'Checking';
  };
  const getRuntimeStateClasses = (state: EngineRuntimeState) => {
    if (resolvedTheme === 'dark') {
      if (state === 'online') return 'bg-emerald-950/45 text-emerald-300 border-emerald-700/60';
      if (state === 'offline') return 'bg-red-950/45 text-red-300 border-red-700/60';
      if (state === 'standby') return 'bg-slate-800 text-slate-300 border-slate-700';
      if (state === 'starting' || state === 'warming') return 'bg-indigo-950/45 text-indigo-200 border-indigo-700/60';
      if (state === 'not_configured') return 'bg-amber-950/45 text-amber-300 border-amber-700/60';
      return 'bg-slate-900 text-slate-300 border-slate-700';
    }
    if (state === 'online') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (state === 'offline') return 'bg-red-50 text-red-700 border-red-200';
    if (state === 'standby') return 'bg-slate-100 text-slate-700 border-slate-200';
    if (state === 'starting' || state === 'warming') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    if (state === 'not_configured') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  };
  const activateTtsEngine = async (engine: GenerationSettings['engine']) => {
      const targetEngine = resolveEngineToken(engine) as GenerationSettings['engine'];
      if (engineSwitchInProgress) return;
      const previousActiveEngine = managedActiveEngine || settings.engine;
      const activationRequestId = runtimeActivationRequestIdRef.current + 1;
      runtimeActivationRequestIdRef.current = activationRequestId;
      if (!isPrimeEngineAllowed(targetEngine)) {
          if (!hasUnlimitedAccess && !isPaidBillingPlan && walletPaidVfBalance <= 0) {
              setShowSubscriptionModal(true);
              showToast(`${getEngineDisplayName(targetEngine)} is available on paid subscriptions or with paid token balance. Upgrade to continue.`, 'info');
          } else {
              showToast(`${getEngineLabel(targetEngine)} is not enabled for this account.`, 'info');
          }
          return;
      }
      if (targetEngine === settings.engine && ttsRuntimeStatus[targetEngine].state === 'online') return;
      cancelRuntimeAutoSelectProbe({ lockSession: true });

      const nextVoiceId = getValidVoiceIdForEngine(targetEngine, settings.voiceId);

      try {
          setTtsRuntimeStatus((prev) => ({
              ...prev,
              [targetEngine]: mergeRuntimeStatus(prev[targetEngine], { state: 'starting', detail: 'Starting runtime...' }),
          }));

          const activation = await ensureEngineOnline(targetEngine, {
              syncVoiceId: nextVoiceId,
              waitForOnline: true,
              commitSettings: true,
          });
          if (runtimeActivationRequestIdRef.current !== activationRequestId) return;
          const runtimeCatalog = activation.catalog.length > 0
              ? activation.catalog
              : getEngineVoiceCatalog(targetEngine);
          const preferredVoiceId = activation.syncedVoiceId
              || selectVoiceIdFromCatalog(targetEngine, runtimeCatalog, nextVoiceId);
          const resolvedVoiceId = getValidVoiceIdForEngine(targetEngine, preferredVoiceId);
          setSettings((prev) => {
              const fallbackVoiceId = getValidVoiceIdForEngine(
                  targetEngine,
                  runtimeCatalog[0]?.id || resolvedVoiceId || prev.voiceId
              );
              const refreshedMapping: Record<string, string> = {};
              Object.entries(prev.speakerMapping || {}).forEach(([speaker, mappedVoiceId]) => {
                  refreshedMapping[speaker] = getValidVoiceIdForEngine(targetEngine, mappedVoiceId || fallbackVoiceId);
              });
              return {
                  ...prev,
                  engine: targetEngine,
                  voiceId: getValidVoiceIdForEngine(targetEngine, resolvedVoiceId || prev.voiceId),
                  speakerMapping: refreshedMapping,
              };
          });
      } catch (error: any) {
          if (runtimeActivationRequestIdRef.current !== activationRequestId) return;
          showToast(`${getEngineLabel(targetEngine)} could not start right now. Please try again.`, 'error');
          setManagedActiveEngine(previousActiveEngine);
      }
  };
  const workspaceTabs = useMemo(() => buildWorkspaceTabs(hasAdminConsoleAccess), [hasAdminConsoleAccess]);
  const contentMaxWidthClass = isNovelWorkspaceTab || isStudioWorkspaceTab
      ? 'max-w-[1480px]'
      : activeTab === Tab.VOICE_CLONING
        ? 'max-w-[1360px]'
        : 'max-w-5xl';

  useEffect(() => {
      const nextTab = resolveWorkspaceTabFromPathname(pathname) || Tab.STUDIO;
      if (nextTab !== activeTab) {
          setActiveTab(nextTab);
      }
  }, [activeTab, pathname]);

  useEffect(() => {
      if (!hasAdminConsoleAccess && activeTab === Tab.ADMIN) {
          setActiveTab(Tab.STUDIO);
      }
  }, [activeTab, hasAdminConsoleAccess]);
  useEffect(() => {
      const activeTabExists = workspaceTabs.some((item) => item.id === activeTab);
      if (!activeTabExists) {
          setActiveTab(Tab.STUDIO);
      }
  }, [activeTab, workspaceTabs]);
  useEffect(() => {
      if (!hasWorkspaceInteracted) return undefined;
      const nextTab = resolveWorkspaceNextPreloadTab(workspaceTabs, activeTab, {
        allowNextPreloadFromStudio: false,
      });
      const preloadNext = nextTab ? TAB_PRELOADERS[nextTab] : undefined;
      if (!preloadNext) return undefined;
      if (typeof window === 'undefined') return undefined;
      const win = window as Window & { requestIdleCallback?: (callback: IdleRequestCallback) => number; cancelIdleCallback?: (id: number) => void };
      let idleId: number | null = null;
      const timeoutId = window.setTimeout(() => {
          if (document.visibilityState !== 'visible') return;
          if (win.requestIdleCallback) {
              idleId = win.requestIdleCallback(() => { void preloadNext(); });
              return;
          }
          void preloadNext();
      }, 4000);
      return () => {
          window.clearTimeout(timeoutId);
          if (idleId !== null) {
              win.cancelIdleCallback?.(idleId);
          }
      };
  }, [activeTab, hasWorkspaceInteracted, workspaceTabs]);
  const openAuthScreen = (mode: 'login' | 'signup') => {
      writeStorageString(STORAGE_KEYS.authIntent, mode);
      setIsMobileMenuOpen(false);
      router.push(resolveLoginPath(mode, pathname || resolveWorkspaceRoutePath(activeTab)));
  };

  const openBillingCenter = useCallback(() => {
      if (hasSessionIdentity && !isGuestSession) {
          setIsMobileMenuOpen(false);
          router.push(APP_ROUTE_PATHS.billing);
          return;
      }
      writeStorageString(STORAGE_KEYS.authIntent, 'login');
      setIsMobileMenuOpen(false);
      router.push(resolveLoginPath('login', APP_ROUTE_PATHS.billing));
  }, [hasSessionIdentity, isGuestSession, router]);

  const handleSignOut = async () => {
      try {
          await signOutUser();
          setIsMobileMenuOpen(false);
          setScreen(AppScreen.LOGIN);
          showToast('Signed out successfully.', 'success');
      } catch (error: any) {
          showToast(error?.message || 'Sign out failed.', 'error');
      }
  };

  const handleRedeemCoupon = async () => {
      const code = couponCode.trim();
      if (!code) return;
      setIsRedeemingCoupon(true);
      try {
          const result = await billingActions.redeemWalletCoupon(code);
          setCouponCode('');
          showToast(`Coupon applied: +${result.creditedVf.toLocaleString()} VF`, 'success');
          await refreshEntitlements();
      } catch (error: any) {
          showToast(error?.message || 'Coupon redeem failed.', 'error');
      } finally {
          setIsRedeemingCoupon(false);
      }
  };

  const handleBuyTokenPack = async () => {
      setIsBuyingTokenPack(true);
      try {
          const result = await billingActions.startTokenPackCheckout(selectedTokenPack);
          await billingActions.launchCheckout(result, {
              onSuccess: () => {
                  window.location.href = `${APP_ROUTE_PATHS.billing}?billing=success`;
              },
              onDismiss: () => {
                  setIsBuyingTokenPack(false);
              },
          });
          if (Number.isFinite(result.packVf) && Number.isFinite(result.finalAmountInr)) {
              const checkoutDiscount = Math.max(0, Number(result.discountPercent ?? tokenPackDiscountPercent));
              showToast(
                  `Checkout: ${(result.packVf || 0).toLocaleString()} VF for ${formatInr(result.finalAmountInr || 0)}${checkoutDiscount > 0 ? ` after ${checkoutDiscount}% plan savings` : ''}.`,
                  'info'
              );
          }
      } catch (error: any) {
          showToast(error?.message || 'Could not start token pack checkout.', 'error');
      } finally {
          setIsBuyingTokenPack(false);
      }
  };

  const handleRefreshHistory = async () => {
      setIsRefreshingHistory(true);
      try {
          await loadHistory(200);
      } catch (error: any) {
          showToast(error?.message || 'Failed to refresh generation history.', 'error');
      } finally {
          setIsRefreshingHistory(false);
      }
  };

  const handleClearHistory = async () => {
      if (!window.confirm('Clear all generation history from the server for this account?')) return;
      setIsClearingHistory(true);
      try {
          await clearHistory();
          showToast('Generation history cleared.', 'success');
      } catch (error: any) {
          showToast(error?.message || 'Failed to clear generation history.', 'error');
      } finally {
          setIsClearingHistory(false);
      }
  };

  useEffect(() => {
      if (activeTab !== Tab.HISTORY) return;
      void loadHistory(200);
  }, [activeTab]);

  // --- UI Components ---

  const isDarkUi = resolvedTheme === 'dark';
  const renderCreditsSurfaceContent = (isSheet = false) => (
    <div
      className={`rounded-2xl border p-3 shadow-xl ${isSheet ? 'max-h-[78dvh] overflow-y-auto' : ''} ${
        isDarkUi ? 'border-slate-700 bg-slate-950/96' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[10px] font-black uppercase tracking-[0.2em] ${isDarkUi ? 'text-cyan-200/80' : 'text-cyan-700/70'}`}>
            Plan & Credits
          </div>
          <div className={`mt-2 text-base font-semibold ${isDarkUi ? 'text-slate-100' : 'text-slate-900'}`}>
            {activePlanLabel} workspace
          </div>
          <div className={`mt-1 text-[11px] leading-5 ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
            {hasUnlimitedAccess
              ? 'Unlimited access is active for this account.'
              : isPaidBillingPlan
                ? 'Recurring billing and larger monthly caps are enabled.'
                : 'Upgrade only when you need bigger caps or more engines.'}
          </div>
        </div>
        <button
          onClick={() => setShowSubscriptionModal(true)}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
            isPaidBillingPlan
              ? (isDarkUi ? 'bg-cyan-500/14 text-cyan-100 hover:bg-cyan-500/24' : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100')
              : (isDarkUi ? 'bg-amber-400 text-slate-950 hover:bg-amber-300' : 'bg-amber-500 text-white hover:bg-amber-400')
          }`}
        >
          {isPaidBillingPlan ? 'Manage' : 'Upgrade'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <div className={`rounded-xl border px-3 py-3 ${isDarkUi ? 'border-slate-700 bg-slate-950/70' : 'border-gray-200 bg-gray-50/90'}`}>
          <div className={`text-[10px] font-bold uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Spendable</div>
          <div className={`mt-2 text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-slate-900'}`}>
            {hasUnlimitedAccess ? 'Unlimited' : `${currentEngineSpendable.toLocaleString()} VF`}
          </div>
          <div className={`mt-1 text-[10px] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>
            {getEngineDisplayName(settings.engine)}
          </div>
        </div>
      </div>

      {!hasUnlimitedAccess && (
        <>
          <div className={`mt-3 rounded-xl border px-3 py-3 text-[11px] ${isDarkUi ? 'border-slate-700 bg-slate-950/60 text-slate-300' : 'border-gray-200 bg-white/90 text-gray-600'}`}>
            <div className="flex items-center justify-between gap-2">
              <span>Monthly free pool</span>
              <strong className={isDarkUi ? 'text-slate-100' : 'text-slate-900'}>{balanceRemainingLabel}</strong>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span>Paid VF</span>
              <strong className={isDarkUi ? 'text-slate-100' : 'text-slate-900'}>{walletPaid.toLocaleString()}</strong>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span>Allowed engines</span>
              <strong className={`max-w-[9rem] truncate text-right ${isDarkUi ? 'text-slate-100' : 'text-slate-900'}`}>
                {allowedEngineSummary}
              </strong>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span>Token-pack savings</span>
              <strong className={isDarkUi ? 'text-slate-100' : 'text-slate-900'}>
                {tokenPackDiscountPercent > 0 ? `${tokenPackDiscountPercent}% off` : 'No plan discount'}
              </strong>
            </div>
          </div>

          {!hasSessionIdentity ? (
            <div className={`mt-3 rounded-xl border px-3 py-2 text-[11px] ${
              isDarkUi
                ? 'border-amber-400/25 bg-amber-500/10 text-amber-100'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}>
              Sign in to buy token packs or redeem coupons.
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={openBillingCenter}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold ${
                isDarkUi
                  ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                  : 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
              }`}
            >
              <Bell size={12} />
              Open Billing
            </button>
            <button
              onClick={() => { void handleBuyTokenPack(); }}
              disabled={creditsActionState.buyTokenPackDisabled}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold disabled:opacity-50 ${
                isDarkUi
                  ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {isBuyingTokenPack ? <Loader2 size={12} className="animate-spin" /> : <Coins size={12} />}
              Buy {selectedTokenPackMeta.label}
            </button>
          </div>
          <div className="mt-2">
            <label className={`mb-1 block text-[10px] font-semibold uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
              Token Pack
            </label>
            <select
              value={selectedTokenPack}
              onChange={(event) => setSelectedTokenPack(event.target.value as TokenPackKey)}
              aria-label="Token pack"
              title="Token pack"
              className={`h-8 w-full rounded-lg border px-2 text-[11px] font-semibold outline-none transition-colors ${
                isDarkUi
                  ? 'border-slate-700 bg-slate-950/70 text-slate-100 focus:border-cyan-400'
                  : 'border-gray-200 bg-white text-gray-900 focus:border-cyan-300'
              }`}
            >
              {(Object.keys(TOKEN_PACK_MATRIX) as TokenPackKey[]).map((packKey) => {
                const item = TOKEN_PACK_MATRIX[packKey];
                const displayPrice = applyTokenPackDiscount(item.baseInr, tokenPackDiscountPercent);
                return (
                  <option key={packKey} value={packKey}>
                    {joinUiFragments([item.label, `${item.vf.toLocaleString()} VF`, formatInr(displayPrice)])}
                  </option>
                );
              })}
            </select>
            <div className={`mt-1 text-[10px] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>
              Checkout price: {formatInr(selectedTokenPackPriceInr)} ({tokenPackDiscountPercent > 0 ? `${tokenPackDiscountPercent}% plan discount saves ${formatInr(selectedTokenPackSavingsInr)}` : 'Standard pricing'})
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <input
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value)}
              placeholder="Wallet coupon"
              className={`h-8 min-w-0 flex-1 rounded-lg border px-2 text-[11px] outline-none transition-colors ${
                isDarkUi
                  ? 'border-slate-700 bg-slate-950/70 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400'
                  : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-cyan-300'
              }`}
            />
            <button
              onClick={() => { void handleRedeemCoupon(); }}
              disabled={creditsActionState.redeemCouponDisabled}
              className={`h-8 rounded-lg border px-2 text-[11px] font-semibold disabled:opacity-50 ${
                isDarkUi
                  ? 'border-cyan-400/35 text-cyan-200 hover:bg-cyan-500/10'
                  : 'border-cyan-200 text-cyan-700 hover:bg-cyan-50'
              }`}
            >
              {isRedeemingCoupon ? <Loader2 size={12} className="animate-spin" /> : 'Redeem'}
            </button>
          </div>
        </>
      )}
    </div>
  );

  const Sidebar = () => {
    const isDesktopCompact = isDesktop && sidebarMode === 'compact';
    const primaryWorkspaceTabs = workspaceTabs.filter((item) => item.id !== Tab.ADMIN);
    const createWorkspaceTabs = primaryWorkspaceTabs.filter((item) => item.section === 'create');
    const accountWorkspaceTabs = primaryWorkspaceTabs.filter((item) => item.section === 'account');
    const adminWorkspaceTab = workspaceTabs.find((item) => item.id === Tab.ADMIN);
    const getSidebarButtonClassName = (isActive: boolean) => `flex w-full items-center rounded-xl text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] ${
      isDesktopCompact ? 'flex-col justify-center gap-0.5 px-1.5 py-2' : 'gap-3 px-3.5 py-2.5'
    } ${
      isActive
        ? isDarkUi
          ? 'border border-cyan-500/35 bg-cyan-500/15 text-cyan-100 shadow-[0_6px_18px_rgba(6,182,212,0.16)]'
          : 'border border-cyan-100 bg-cyan-50 text-cyan-700 shadow-sm'
        : isDarkUi
          ? 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2`;
    const sectionHeaderClassName = `px-3 pb-1 text-[10px] font-black uppercase tracking-[0.16em] ${
      isDarkUi ? 'text-slate-500' : 'text-gray-400'
    }`;

    return (
    <aside
      className={`vf-sidebar-shell fixed inset-y-0 left-0 z-[52] w-72 max-w-[90vw] ${
        isDesktopCompact ? 'xl:w-[4.5rem]' : 'xl:w-64'
      } transform transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] duration-300 xl:sticky xl:inset-y-auto xl:top-0 xl:z-20 xl:h-[100dvh] xl:translate-x-0 ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      } ${
        isDarkUi
          ? 'border-r border-slate-800 bg-slate-950/92 shadow-[0_24px_56px_rgba(2,6,23,0.72)]'
          : 'border-r border-gray-200 bg-white/95 shadow-2xl md:shadow-xl'
      } flex h-full flex-col overflow-hidden backdrop-blur-lg`}
    >
      <div
        className={`vf-sidebar-brand flex items-center border-b ${isDesktopCompact ? 'justify-center px-2 py-4' : 'gap-3 px-5 py-5'} ${isDarkUi ? 'border-slate-800' : 'border-gray-100'}`}
      >
        <BrandLogo size={isDesktopCompact ? 'sm' : 'md'} tone={isDarkUi ? 'light' : 'dark'} showWordmark={!isDesktopCompact} />
      </div>

      <nav className={`vf-sidebar-nav space-y-1 border-b ${isDesktopCompact ? 'px-2 py-3' : 'px-3 py-3'} ${isDarkUi ? 'border-slate-800' : 'border-gray-100'}`}>
        <div className={isDesktopCompact ? 'space-y-2' : 'space-y-3'}>
          {createWorkspaceTabs.length > 0 ? (
            <div className="space-y-1">
              {!isDesktopCompact && (
                <p className={sectionHeaderClassName}>{WORKSPACE_NAV_SECTION_LABELS.create}</p>
              )}
              {createWorkspaceTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    router.push(item.route);
                  }}
                  aria-current={!isCreditsSurfaceOpen && activeTab === item.id ? 'page' : undefined}
                  aria-label={item.label}
                  title={item.label}
                  className={getSidebarButtonClassName(!isCreditsSurfaceOpen && activeTab === item.id)}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {!isDesktopCompact && <span className="truncate">{item.label}</span>}
                  {isDesktopCompact && (
                    <span className="max-w-full truncate text-[9px] font-bold leading-none tracking-wide">
                      {item.label}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
          {accountWorkspaceTabs.length > 0 ? (
            <div className="space-y-1">
              {!isDesktopCompact && (
                <p className={sectionHeaderClassName}>{WORKSPACE_NAV_SECTION_LABELS.account}</p>
              )}
              {accountWorkspaceTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    router.push(item.route);
                  }}
                  aria-current={!isCreditsSurfaceOpen && activeTab === item.id ? 'page' : undefined}
                  aria-label={item.label}
                  title={item.label}
                  className={getSidebarButtonClassName(!isCreditsSurfaceOpen && activeTab === item.id)}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {!isDesktopCompact && <span className="truncate">{item.label}</span>}
                  {isDesktopCompact && (
                    <span className="max-w-full truncate text-[9px] font-bold leading-none tracking-wide">
                      {item.label}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
          {adminWorkspaceTab ? (
            <div className="space-y-1">
              {!isDesktopCompact && (
                <p className={sectionHeaderClassName}>{WORKSPACE_NAV_SECTION_LABELS.admin}</p>
              )}
              <button
                key={adminWorkspaceTab.id}
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  router.push(adminWorkspaceTab.route);
                }}
                aria-current={!isCreditsSurfaceOpen && activeTab === adminWorkspaceTab.id ? 'page' : undefined}
                aria-label={adminWorkspaceTab.label}
                title={adminWorkspaceTab.label}
                className={getSidebarButtonClassName(!isCreditsSurfaceOpen && activeTab === adminWorkspaceTab.id)}
              >
                <span className="shrink-0">{adminWorkspaceTab.icon}</span>
                {!isDesktopCompact && <span className="truncate">{adminWorkspaceTab.label}</span>}
                {isDesktopCompact && (
                  <span className="max-w-full truncate text-[9px] font-bold leading-none tracking-wide">
                    {adminWorkspaceTab.label}
                  </span>
                )}
              </button>
            </div>
          ) : null}
        </div>
      </nav>

      <div className="vf-sidebar-scroll custom-scrollbar flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col">
          <div className={`vf-sidebar-footer sticky bottom-0 z-10 mt-auto shrink-0 border-t p-3 backdrop-blur-sm ${isDarkUi ? 'border-slate-800 bg-slate-950/88' : 'border-gray-200 bg-white/90'}`}>
            {isDesktopCompact ? (
              <div className="space-y-2">
                {isGuestSession ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => openAuthScreen('login')}
                      className={`inline-flex items-center justify-center rounded-lg border py-2 ${isDarkUi ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
                      title="Login"
                      aria-label="Login"
                    >
                      <LogIn size={13} />
                    </button>
                    <button
                      onClick={() => openAuthScreen('signup')}
                      className={`inline-flex items-center justify-center rounded-lg border py-2 ${isDarkUi ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-100' : 'border-cyan-300 bg-cyan-50 text-cyan-700'}`}
                      title="Sign up"
                      aria-label="Sign up"
                    >
                      <UserPlus size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { void handleSignOut(); }}
                    className={`mb-1 inline-flex w-full items-center justify-center rounded-lg border py-2 ${isDarkUi ? 'border-rose-400/40 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700'}`}
                    title="Sign out"
                    aria-label="Sign out"
                  >
                    <LogOut size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className={`vf-sidebar-profile flex w-full items-center justify-center rounded-xl border p-2 text-left transition-colors ${
                    isDarkUi
                      ? 'border-slate-700 bg-slate-900/70 hover:bg-slate-900'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                  onClick={() => (isGuestSession ? openAuthScreen('login') : setScreen(AppScreen.PROFILE))}
                  aria-label="Open profile"
                  title={user.name}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full font-bold shadow-sm ${
                    isDarkUi
                      ? 'border border-slate-600 bg-cyan-500/20 text-cyan-100'
                      : 'border border-white bg-cyan-100 text-cyan-700'
                  }`}>
                    <OptimizedAvatar
                      src={user.avatarUrl}
                      alt={`${user.name} avatar`}
                      width={40}
                      height={40}
                      containerClassName="h-full w-full"
                      className="h-full w-full rounded-full"
                      fallback={user.name?.[0]}
                      quality={85}
                      sizes="(max-width: 640px) 32px, (max-width: 1024px) 40px, 48px"
                    />
                  </div>
                </button>
              </div>
            ) : (
              <>
                {isGuestSession && (
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => openAuthScreen('login')}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-bold transition-colors ${
                        isDarkUi
                          ? 'border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800'
                          : 'border-cyan-200 bg-white text-cyan-700 hover:bg-cyan-50'
                      }`}
                    >
                      <LogIn size={12} /> Login
                    </button>
                    <button
                      onClick={() => openAuthScreen('signup')}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-bold transition-colors ${
                        isDarkUi
                          ? 'border-cyan-400/40 bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                          : 'border-cyan-600 bg-cyan-600 text-white hover:bg-cyan-700'
                      }`}
                    >
                      <UserPlus size={12} /> Sign Up
                    </button>
                  </div>
                )}
                {!isGuestSession && (
                  <button
                    onClick={() => { void handleSignOut(); }}
                    className={`mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-bold transition-colors ${
                      isDarkUi
                        ? 'border-rose-400/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                        : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    <LogOut size={12} /> Sign Out
                  </button>
                )}
                <button
                  type="button"
                  className={`vf-sidebar-profile flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors ${
                    isDarkUi
                      ? 'border-slate-700 bg-slate-900/70 hover:bg-slate-900'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                  onClick={() => (isGuestSession ? openAuthScreen('login') : setScreen(AppScreen.PROFILE))}
                  aria-label="Open profile"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full font-bold shadow-sm ${
                    isDarkUi
                      ? 'border border-slate-600 bg-cyan-500/20 text-cyan-100'
                      : 'border border-white bg-cyan-100 text-cyan-700'
                  }`}>
                    <OptimizedAvatar
                      src={user.avatarUrl}
                      alt={`${user.name} avatar`}
                      width={36}
                      height={36}
                      containerClassName="h-full w-full"
                      className="h-full w-full rounded-full"
                      fallback={user.name?.[0]}
                      quality={85}
                      sizes="(max-width: 640px) 32px, (max-width: 1024px) 36px, 44px"
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className={`truncate text-sm font-bold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>{user.name}</div>
                    <div className={`truncate text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{user.email}</div>
                  </div>
                  <Settings size={16} className={isDarkUi ? 'text-slate-400' : 'text-gray-400'} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
    );
  };

  const renderSettingsPanel = () => {
      const settingsCardClass = isDarkUi
        ? 'space-y-2.5 rounded-xl border border-slate-700 bg-slate-900/70 p-3'
        : 'space-y-2.5 rounded-xl border border-slate-200 bg-white p-3';
      const settingsLabelClass = isDarkUi
        ? 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400'
        : 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500';

      return (
      <div
          className="vf-scrim vf-scrim--drawer fixed inset-0 z-50 flex justify-end"
          onClick={() => setShowSettings(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Configuration panel"
      >
          <div
              className={`h-full w-full max-w-[26.5rem] shadow-2xl animate-in slide-in-from-right duration-200 flex flex-col overflow-hidden ${
                isDarkUi
                  ? 'bg-slate-950/95 border-l border-slate-700/70'
                  : 'bg-slate-50/95 border-l border-slate-200'
              }`}
              onClick={(event) => event.stopPropagation()}
              ref={settingsPanelRef}
              tabIndex={-1}
          >
              <div className={`p-3 border-b z-10 ${
                isDarkUi ? 'border-slate-800 bg-slate-950/95' : 'border-slate-200 bg-slate-50/95'
              }`}>
                  <div className="flex items-start justify-between gap-2.5">
                      <div>
                          <h2 className={`flex items-center gap-2 text-sm font-bold ${isDarkUi ? 'text-slate-100' : 'text-slate-900'}`}>
                              <Settings size={15} className="text-indigo-500" />
                              Workspace Settings
                          </h2>
                      </div>
                      <button
                        onClick={() => setShowSettings(false)}
                        className={`rounded-full p-1.5 transition-colors ${isDarkUi ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-200 text-slate-700'}`}
                        aria-label="Close settings panel"
                      >
                        <X size={17}/>
                      </button>
                  </div>
              </div>

              <div className={`flex-1 overflow-y-auto p-3 space-y-3 ${isDarkUi ? 'bg-slate-950/90' : 'bg-slate-100/60'}`}>
                  {/* Appearance */}
                  <section>
                      <label className={settingsLabelClass}>Appearance</label>
                      <div className={settingsCardClass}>
                          <div>
                              <div className="hidden">
                                  {/* Light/Dark theme selector removed per request. Forced to dark. */}
                              </div>
                              <div className="mt-3">
                                  <div className={`mb-2 flex items-center gap-1 text-[10px] font-bold uppercase ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                      <Sparkles size={12} /> Brand palette
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                      {UI_BRAND_THEME_ORDER.map((brandId) => {
                                          const theme = UI_BRAND_THEME_CONFIGS[brandId];
                                          const active = uiBrandTheme === brandId;
                                            if (active) {
                                              return (
                                                <button
                                                  key={brandId}
                                                  type="button"
                                                  onClick={() => setUiBrandTheme(brandId)}
                                                  className="vf-brand-chip flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-[11px] font-semibold text-white transition-colors"
                                                  aria-pressed="true"
                                                  data-active={true}
                                                  data-brand-theme={brandId}
                                                >
                                                  <span
                                                    className="vf-brand-swatch h-3.5 w-3.5 shrink-0 rounded-full border border-white/30"
                                                    data-brand-swatch={brandId}
                                                    aria-hidden="true"
                                                  />
                                                  <span className="min-w-0">
                                                    <span className="block truncate">{theme.label}</span>
                                                    <span className="block truncate text-[10px] font-medium text-[color:var(--vf-text-muted)]">{theme.description}</span>
                                                  </span>
                                                </button>
                                              );
                                            }
                                            return (
                                              <button
                                                key={brandId}
                                                type="button"
                                                onClick={() => setUiBrandTheme(brandId)}
                                                className="vf-brand-chip flex items-center gap-2 rounded-lg border border-[color:var(--vf-border)] bg-[color:var(--vf-surface-soft)] px-2.5 py-2 text-left text-[11px] font-semibold text-[color:var(--vf-text-muted)] transition-colors hover:bg-[color:var(--vf-surface-muted)]"
                                                aria-pressed="false"
                                                data-active={false}
                                                data-brand-theme={brandId}
                                              >
                                                <span
                                                  className="vf-brand-swatch h-3.5 w-3.5 shrink-0 rounded-full border border-white/30"
                                                  data-brand-swatch={brandId}
                                                  aria-hidden="true"
                                                />
                                                <span className="min-w-0">
                                                  <span className="block truncate">{theme.label}</span>
                                                  <span className="block truncate text-[10px] font-medium text-[color:var(--vf-text-muted)]">{theme.description}</span>
                                                </span>
                                              </button>
                                            );
                                      })}
                                  </div>
                              </div>
                              <div className="mt-1.5 text-[10px] text-[color:var(--vf-text-muted)]">Active: {uiTheme === 'system' ? `System (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})` : uiTheme === 'dark' ? 'Dark' : 'Light'} Â· {UI_BRAND_THEME_CONFIGS[uiBrandTheme].label}</div>
                          </div>

                          <div>
                              <div className={`flex justify-between text-[11px] mb-1 font-semibold ${isDarkUi ? 'text-slate-200' : 'text-gray-700'}`}>
                              <span className="flex items-center gap-1"><Type size={11}/> UI Scale</span>
                              <span>{Math.round(uiFontScale * 100)}%</span>
                          </div>
                          <div className={`rounded-md border px-2 py-1 text-[10px] font-medium ${isDarkUi ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-gray-200 bg-white text-gray-600'}`}>
                                  Locked at 100%
                              </div>
                          </div>
                      </div>
                  </section>

                  {/* Engine Selection */}
                  <section>
                      <label className={settingsLabelClass}>Audio Engine</label>
                      <div className={settingsCardClass}>
                        <div className="grid grid-cols-1 gap-1.5">
                          {ENGINE_ORDER.map(engine => {
                              const isActive = (managedActiveEngine || settings.engine) === engine;
                              const status = ttsRuntimeStatus[engine];
                              const pending = engineSwitchInProgress === engine;
                              const switchLocked = Boolean(engineSwitchInProgress) && !pending;
                              const planLockedEngine = !isPrimeEngineAllowed(engine);
                              const showAccessBlockedNote = status.state === 'online' && ttsAccessState.blocked;
                              const accessBlockedDetail = sanitizeUiText(
                                ttsAccessState.detail || 'Sign in again to enable AI/TTS requests.'
                              );
                              const connectedServer = sanitizeUiText(formatRuntimeServerLabel(status));
                              return (
                                  <button
                                  key={engine}
                                  type="button"
                                  onClick={() => {
                                      if (switchLocked || pending) return;
                                      if (planLockedEngine) {
                                          setShowSubscriptionModal(true);
                                          showToast(PRIME_ACCESS_LOCK_MESSAGE, 'info');
                                          return;
                                      }
                                      void activateTtsEngine(engine);
                                  }}
                                      className={`rounded-xl border p-2.5 transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] flex items-center gap-2 ${
                                        isActive
                                          ? isDarkUi
                                            ? 'border-indigo-400/70 bg-indigo-500/20'
                                            : 'border-indigo-200 bg-indigo-50'
                                          : isDarkUi
                                            ? 'border-slate-700 bg-slate-950/75 hover:bg-slate-900'
                                            : 'border-gray-200 bg-white hover:border-indigo-200'
                                      } ${(switchLocked || pending || planLockedEngine) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                  >
                                      {engine === 'PRIME' && <Sparkles size={18} className={`shrink-0 ${isActive ? 'text-indigo-500' : isDarkUi ? 'text-slate-400' : 'text-gray-400'}`} />}
                                      {engine === 'VECTOR' && <Zap size={18} className={`shrink-0 ${isActive ? 'text-amber-500' : isDarkUi ? 'text-slate-400' : 'text-gray-400'}`} />}
                                      <div className="flex-1 min-w-0">
                                          <div className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-100' : 'text-slate-800'}`}>{getEngineLabel(engine)} Runtime</div>
                                          <div className={`text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{getEngineSubLabel(engine)}</div>
                                          <div className={`mt-0.5 text-[10px] leading-[1rem] ${isDarkUi ? 'text-slate-300' : 'text-slate-600'}`}>
                                              {getEngineDescription(engine)}
                                          </div>
                                          <div className="mt-1 flex flex-wrap items-center gap-1">
                                              <span
                                                className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                                                  isDarkUi ? 'border-slate-600 bg-slate-800/80 text-slate-200' : 'border-slate-200 bg-slate-100 text-slate-700'
                                                }`}
                                              >
                                                {getEngineRateLabel(engine)}
                                              </span>
                                              <span
                                                className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                                                  isDarkUi ? 'border-slate-600 bg-slate-800/80 text-slate-300' : 'border-slate-200 bg-slate-100 text-slate-600'
                                                }`}
                                              >
                                                {getEngineCharsPerVfLabel(engine)}
                                              </span>
                                            </div>
                                          {connectedServer ? (
                                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                                  <span
                                                    className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                                                      isDarkUi ? 'border-cyan-500/30 bg-cyan-500/12 text-cyan-100' : 'border-cyan-200 bg-cyan-50 text-cyan-700'
                                                    }`}
                                                  >
                                                    Server: {connectedServer}
                                                  </span>
                                              </div>
                                          ) : null}
                                          {showAccessBlockedNote && (
                                              <div className={`mt-1 text-[10px] font-medium ${isDarkUi ? 'text-amber-300' : 'text-amber-700'}`}>
                                                  {accessBlockedDetail}
                                              </div>
                                          )}
                                          {planLockedEngine && (
                                              <div className={`mt-1 text-[10px] font-medium ${isDarkUi ? 'text-amber-300' : 'text-amber-700'}`}>
                                                  {PRIME_ACCESS_LOCK_MESSAGE}
                                              </div>
                                          )}
                                      </div>
                                      <span className={`text-[10px] font-bold rounded-md border px-2 py-1 ${getRuntimeStateClasses(status.state)}`}>
                                          {pending ? 'Starting' : getRuntimeStateLabel(status.state)}
                                      </span>
                                  </button>
                              );
                          })}
                        </div>
                      </div>
                  </section>

              </div>

              <div className={`p-3 border-t flex justify-end ${isDarkUi ? 'border-slate-800 bg-slate-950/90' : 'border-slate-200 bg-slate-50/95'}`}>
                  <Button className="px-5" size="sm" onClick={() => setShowSettings(false)}>Save Changes</Button>
              </div>
          </div>
      </div>
  );
  };

  const usesFloatingStudioDock = isStudioWorkspaceTab;
  const shouldHideAssistantInWorkspace = false;
  const isStudioCastPanelOpen = !isPhone || studioMobilePanels.cast;
  const studioMainSpacingClass = isPhone
    ? isShortPhone
      ? 'space-y-1.5'
      : 'space-y-2'
    : isNarrowDesktop
      ? 'space-y-2.5'
      : 'space-y-4';
  const studioEditorHeightClass = isPhone
    ? isShortPhone
      ? 'min-h-[15.5rem] h-[min(24.5rem,calc(100dvh-9rem))]'
      : 'min-h-[17.5rem] h-[min(28.5rem,calc(100dvh-11.6rem))]'
    : isTablet
      ? 'min-h-[22rem] h-[min(39.5rem,calc(100dvh-11.5rem))]'
      : isLargeDesktop
        ? 'min-h-[24rem] h-[min(36rem,calc(100dvh-9.75rem))]'
        : isNarrowDesktop
          ? 'min-h-[18.5rem] h-[min(30rem,calc(100dvh-15.5rem))]'
          : 'min-h-[23rem] h-[min(42rem,calc(100dvh-11rem))]';
  const studioScrollPaddingClass =
    isStudioWorkspaceTab
      ? isPhone
        ? isShortPhone
          ? 'pb-[calc(env(safe-area-inset-bottom)+7.25rem)]'
          : 'pb-[calc(env(safe-area-inset-bottom)+9.25rem)]'
        : isTablet
          ? 'pb-[calc(env(safe-area-inset-bottom)+8rem)]'
          : isNarrowDesktop
            ? 'pb-56'
            : isLargeDesktop
              ? 'pb-44'
              : 'pb-52'
      : 'pb-36';
  const workspaceHorizontalPaddingClass = isPhone ? 'px-2.5 sm:px-4 md:px-8' : 'px-4 md:px-8';
  const workspaceScrollFrameClass =
    `vf-main-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain ${workspaceHorizontalPaddingClass} ${studioScrollPaddingClass}`;
  const topbarShellSizeClass = isPhone
    ? isShortPhone
      ? 'mx-1.5 mt-1.5 h-11 rounded-xl'
      : 'mx-1.5 mt-1.5 h-12 rounded-xl'
    : 'mx-2 mt-2 h-14 rounded-2xl';
  const topbarInnerClass = isPhone
    ? isShortPhone
      ? 'relative flex h-full w-full items-center gap-1 px-1'
      : 'relative flex h-full w-full items-center gap-1.5 px-1.5'
    : 'relative flex h-full w-full items-center gap-2 px-2 xl:px-3';
  const workspaceContentStackClass = isPhone
    ? isShortPhone
      ? 'space-y-3'
      : 'space-y-4'
    : 'space-y-6';
  const studioFloatingDockVariantClass = isPhone
    ? 'vf-studio-generate-anchor--phone'
    : isDesktop
      ? 'vf-studio-generate-anchor--desktop'
      : 'vf-studio-generate-anchor--tablet';
  const studioGenerateButtonSize = isDesktop && !isNarrowDesktop ? 'default' : 'compact';
  const shouldDockStudioPanelBelowEditor = isDesktop && (studioRailTab === 'voice' || studioRailTab === 'cast');
  const studioAssistantPositionClass = isPhone
    ? 'right-3 items-end'
    : 'right-4 xl:right-6 items-end';
  const showTopbarAssistantButton = isPhone && !shouldHideAssistantInWorkspace && !isStudioWorkspaceTab;
  const assistantPanelSizeClass = isPhone
    ? 'w-[min(23rem,calc(100vw-0.75rem))] h-[min(30rem,calc(100vh-10.5rem))]'
    : 'w-[min(23rem,calc(100vw-1.5rem))] h-[min(30rem,calc(100vh-8rem))]';
  const studioAssistantBottomClass =
    isStudioWorkspaceTab
      ? isPhone
        ? 'bottom-[calc(env(safe-area-inset-bottom)+6.9rem)]'
        : isDesktop
          ? 'bottom-[calc(env(safe-area-inset-bottom)+7.1rem)] xl:bottom-32'
          : 'bottom-[calc(env(safe-area-inset-bottom)+6.25rem)]'
      : 'bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] xl:bottom-6';
  const shouldRenderFloatingAssistant = !shouldHideAssistantInWorkspace && isChatOpen;

  return (
    <div className={`relative h-[100dvh] min-h-screen overflow-hidden vf-motion-${uiMotionLevel} ${resolvedTheme === 'dark' ? 'vf-theme-dark theme-dark vf-hybrid-aod' : 'vf-hybrid-light'}`}>
      <div className="vf-app-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent font-sans text-gray-900 xl:grid xl:grid-cols-[auto_minmax(0,1fr)] xl:gap-4">
        {/* Mobile Overlay */}
        {isMobileMenuOpen && (
          <button
            type="button"
          className="vf-scrim vf-scrim--sheet fixed inset-0 z-[51] xl:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Close mobile menu"
          />
        )}

        {/* Sidebar Navigation */}
        <Sidebar />

        {/* Main Content */}
        <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden transition-[background-color,border-color,color,box-shadow,transform,opacity,filter]">
        
        {/* Floating Top Bar */}
        <header className={`vf-topbar vf-topbar-shell relative z-[25] shrink-0 border backdrop-blur-xl transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] duration-300 hover:-translate-y-0.5 ${topbarShellSizeClass} ${
          resolvedTheme === 'dark'
            ? 'border-slate-700/80 bg-slate-950/82 shadow-[0_18px_38px_rgba(2,6,23,0.72)]'
            : 'border-white/70 bg-white/85 shadow-[0_18px_38px_rgba(15,23,42,0.14)]'
        }`}>
             <div className={`vf-topbar-glow pointer-events-none absolute inset-0 ${isPhone ? 'rounded-xl' : 'rounded-2xl'} ${
               resolvedTheme === 'dark'
                 ? 'bg-gradient-to-r from-cyan-500/10 via-indigo-500/8 to-fuchsia-500/10'
                 : 'bg-gradient-to-r from-cyan-100/70 via-indigo-100/70 to-fuchsia-100/70'
             }`} />
             <div className={topbarInnerClass}>
                 <button
                    className={`xl:hidden -ml-1 inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full ${resolvedTheme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}
                    onClick={() => setIsMobileMenuOpen(true)}
                    aria-label="Open navigation menu"
                 >
                    <Menu size={isPhone ? 18 : 20} />
                 </button>
                 <button
                    type="button"
                    className={`hidden xl:inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full transition-colors ${resolvedTheme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}
                    onClick={() => setSidebarMode((current) => (current === 'compact' ? 'expanded' : 'compact'))}
                    aria-label={sidebarMode === 'compact' ? 'Expand sidebar' : 'Compact sidebar'}
                    title={sidebarMode === 'compact' ? 'Expand sidebar' : 'Compact sidebar'}
                  >
                    {sidebarMode === 'compact' ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
                  </button>
                 <div className="flex shrink-0 items-center">
                   <img
                     src="/brand-logo.svg"
                     alt="V Flow AI"
                     draggable={false}
                     className="h-8 w-8 shrink-0 select-none object-contain"
                   />
                 </div>

                 <div className={`vf-topbar-runtime-wrap min-w-0 flex-1 ${isPhone ? 'hidden' : 'overflow-hidden'}`}>
                     <EngineRuntimeStrip
                       engineOrder={ENGINE_ORDER}
                       statuses={ttsRuntimeStatus}
                        accessState={ttsAccessState}
                        allowedEngines={primeAllowedEngines}
                        activeEngine={managedActiveEngine || settings.engine}
                        switchingEngine={engineSwitchInProgress}
                        compact={!isDesktop}
                        dense={isPhone}
                       resolvedTheme={resolvedTheme}
                       onActivate={activateTtsEngine}
                     />
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
                     <button
                        type="button"
                        ref={creditsSurfaceTriggerRef}
                        onClick={openBillingCenter}
                        aria-label="Open billing"
                        className={`inline-flex items-center rounded-full border font-bold gap-1.5 px-3 py-1.5 text-[11px] ${
                          resolvedTheme === 'dark'
                            ? 'border-slate-700 bg-slate-900/85 text-slate-300 hover:bg-slate-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Coins size={14} className="text-amber-500" />
                        <span>
                          {hasUnlimitedAccess
                            ? 'âœ¨ Unlimited'
                            : `${currentEngineSpendable.toLocaleString()} VF`}
                        </span>
                      </button>

                     {showTopbarAssistantButton ? (
                       <button
                          type="button"
                          onClick={() => setIsChatOpen((open) => !open)}
                          aria-label={isChatOpen ? 'Close assistant' : 'Open assistant'}
                          className={`relative inline-flex h-[44px] w-[44px] items-center justify-center rounded-full transition-colors ${
                          resolvedTheme === 'dark'
                           ? 'hover:bg-slate-800 text-slate-300'
                           : 'hover:bg-gray-100 text-gray-500'
                       }`}
                        >
                            <Sparkles size={isPhone ? 16 : 18} />
                            {isChatOpen && <span className="absolute inset-0 rounded-full ring-1 ring-indigo-400/70" />}
                       </button>
                     ) : null}

                     <button
                        onClick={() => setCenterOpen((open) => !open)}
                        aria-label="Open notifications"
                        className={`relative inline-flex h-[44px] w-[44px] items-center justify-center rounded-full transition-colors ${
                        resolvedTheme === 'dark'
                         ? 'hover:bg-slate-800 text-slate-300'
                         : 'hover:bg-gray-100 text-gray-500'
                     }`}
                      >
                          <Bell size={isPhone ? 18 : 20} />
                          {unreadCount > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-rose-500 px-1 py-0.5 text-center text-[9px] font-extrabold leading-none text-white">
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                          {isCenterOpen && <span className="absolute inset-0 rounded-full ring-1 ring-indigo-400/70" />}
                     </button>

                     <button
                        ref={settingsTriggerRef}
                        onClick={() => setShowSettings(true)}
                        aria-label="Open configuration"
                        className={`inline-flex h-[44px] w-[44px] items-center justify-center rounded-full transition-colors ${
                        resolvedTheme === 'dark'
                         ? 'hover:bg-slate-800 text-slate-300'
                         : 'hover:bg-gray-100 text-gray-500'
                     }`}>
                          <Settings size={isPhone ? 18 : 20} />
                     </button>
                 </div>
             </div>
        </header>
        {isCreditsSurfaceOpen && (
          <>
            {isPhone && (
              <button
                type="button"
                className="vf-scrim vf-scrim--sheet fixed inset-0 z-[48]"
                onClick={() => setIsCreditsSurfaceOpen(false)}
                aria-label="Close plan and credits panel"
              />
            )}
            <div
              ref={creditsSurfaceRef}
              className={`fixed z-[49] ${isPhone ? 'inset-x-3 bottom-3' : 'right-3 top-[4.2rem] w-[23rem]'}`}
            >
              {renderCreditsSurfaceContent(isPhone)}
            </div>
          </>
        )}

        {/* Scrollable Content Area */}
        <div
          ref={contentScrollRef}
          className={`studio-scrollbar relative ${workspaceScrollFrameClass}`}
        >
            <div className={`mx-auto w-full ${workspaceContentStackClass} ${contentMaxWidthClass}`}>
                
                {isStudioWorkspaceTab && (
                  <div className="vf-studio-focus-wrap xl:min-h-[calc(100vh-12rem)] flex items-start justify-center">
                  <div className={`vf-studio-grid w-full grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_18rem] ${isPhone ? 'gap-3' : 'gap-4 xl:gap-5'} animate-in fade-in duration-300`}>
                      {/* Editor Section */}
                      <div ref={studioMainRef} className={`vf-studio-main min-w-0 ${studioMainSpacingClass}`}>
                            {/* Reduced Height Editor */}
                            {isStudioEditorFullscreen && (
                                <button
                                    type="button"
                                    className="vf-scrim vf-scrim--modal vf-editor-fullscreen-scrim fixed inset-0 z-[57]"
                                    aria-label="Exit fullscreen editor"
                                    onClick={() => setIsStudioEditorFullscreen(false)}
                                />
                            )}
                            <div ref={studioEditorShellRef} className="min-w-0">
                            <SectionCard className={`vf-editor-shell rounded-3xl overflow-hidden flex flex-col ${studioEditorHeightClass} relative ${
                                isStudioEditorFullscreen ? 'vf-editor-shell--fullscreen z-[58]' : 'group transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] hover:shadow-md'
                            }`}>
                                {/* Toolbar */}
                                <div className="vf-studio-toolbar vf-studio-toolbar--compact border-b px-2 py-1.5 sm:px-3 sm:py-2.5">
                                    <div className="vf-toolbar-primary vf-toolbar-primary--end flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto pb-0.5">
                                        <ProofreadCluster
                                            isBusy={isAiWriting}
                                            onProofread={(mode) => { void handleProofread(mode); }}
                                            novelLabel="Audio Novel"
                                        />

                                         {!isPhone && detectedLang && <span className="vf-toolbar-tag text-[10px] font-bold border px-2 py-1 rounded-md uppercase">{detectedLang}</span>}
                                         <button
                                            type="button"
                                            onClick={() => studioImportInputRef.current?.click()}
                                            disabled={isStudioImporting || isAiWriting}
                                            className="vf-toolbar-action text-xs font-bold disabled:opacity-50 transition-colors"
                                            title="Import local files (URL import is not supported)"
                                         >
                                            {isStudioImporting ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                                            <span>{isStudioImporting ? 'Importing...' : 'Import'}</span>
                                         </button>

                                        <button
                                            onClick={() => { setText(''); setGeneratedAudioUrlManaged(null); }}
                                            className="vf-toolbar-action vf-toolbar-action--danger text-xs font-bold transition-colors"
                                            title="Clear"
                                            aria-label="Clear studio script"
                                        >
                                            <Trash2 size={14}/>
                                        </button>
                                    </div>
                                    <input
                                        ref={studioImportInputRef}
                                        type="file"
                                        className="hidden"
                                        multiple
                                      aria-label="Import studio files"
                                      title="Import studio files"
                                        onChange={handleStudioImportInputChange}
                                    />
                                </div>
                                
                                <div className="flex-1 min-h-0">
                                    {studioDirectorPreview ? (
                                      <DirectorPreview
                                        sourceText={studioDirectorPreview.sourceText}
                                        previewText={studioDirectorPreview.previewText}
                                        modeLabel={studioDirectorPreview.modeLabel}
                                        speakerCount={studioDirectorPreview.castNames.length}
                                        patchedLineCount={studioDirectorPreview.patchedLineCount}
                                        onApply={handleApplyStudioDirectorPreview}
                                        onDiscard={handleDiscardStudioDirectorPreview}
                                        {...(studioDirectorPreview.mood ? { mood: studioDirectorPreview.mood } : {})}
                                      />
                                    ) : (
                                      <Suspense fallback={<div className={`flex h-full items-center justify-center text-sm ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Loading editor...</div>}>
                                        <LazyBlockScriptEditor
                                          value={text}
                                          mode={studioEditorMode}
                                          emotions={EMOTIONS}
                                          speakerSuggestions={castSpeakers}
                                          onChange={setText}
                                          onRawBlurNormalize={normalizeStudioSpeakerHeaders}
                                          maxChars={STUDIO_EDITOR_HARD_CAP}
                                          assistantActionLabel={isPhone ? 'Assist' : 'Assistant'}
                                          assistantActionTitle="Open creative assistant"
                                          onAssistantAction={() => setIsChatOpen(true)}
                                          directorActionLabel="AI Director"
                                          directorActionTitle={`Analyze the current text and apply an AI Director pass. Current mode: ${describeStudioDirectorModeState(studioDirectorModeState)}.`}
                                          onDirectorAction={() => handleDirectorAI(text)}
                                          directorActionBusy={isAiWriting}
                                          onOverflow={({ maxChars }) => {
                                            const now = Date.now();
                                            if (now - studioTextHardCapNoticeAtRef.current < 1800) return;
                                            studioTextHardCapNoticeAtRef.current = now;
                                            showToast(`Input is capped at ${maxChars.toLocaleString()} characters.`, 'info');
                                          }}
                                          onModeChange={setStudioEditorMode}
                                          placeholder="Write your script here... Use [Speaker Name]: tags or let AI Director add them."
                                          className="h-full"
                                          isFullscreen={isStudioEditorFullscreen}
                                          onToggleFullscreen={() => setIsStudioEditorFullscreen((current) => !current)}
                                        />
                                      </Suspense>
                                    )}
                                </div>

                                <StudioTranslateBar
                                    targetLang={targetLang}
                                    isBusy={isAiWriting}
                                    languages={LANGUAGES}
                                    layoutMode={viewportMode}
                                    onTargetLang={setTargetLang}
                                    onTranslate={() => { void handleTranslate(); }}
                                />

                                <div className={`vf-editor-footer border-t text-xs flex flex-wrap items-center justify-start ${isPhone ? 'px-2 py-1 gap-1' : 'px-4 sm:px-6 py-3 gap-3'}`}>
                                    <div className={`flex min-w-0 flex-1 flex-wrap items-center ${isPhone ? 'gap-1' : 'gap-2'}`}>
                                        <span className="vf-editor-count">{`${text.length.toLocaleString()} / ${maxCharsPerGeneration.toLocaleString()} chars`}</span>
                                        {studioDirectorPreview && (
                                            <span className="vf-director-preview__pending">
                                                AI Director preview pending
                                            </span>
                                        )}
                                        {studioQueueEligible && (
                                            <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                                                isDarkUi
                                                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                                                    : 'border-cyan-200 bg-cyan-50 text-cyan-700'
                                            }`}>
                                                {studioQueueDraftPartCount} parts
                                            </span>
                                        )}
                                    </div>
                                    <div className={`ml-auto flex min-w-0 items-center ${isPhone ? 'vf-scrollbar-invisible snap-x snap-proximity flex-nowrap gap-1 overflow-x-auto pb-0.5' : 'flex-wrap gap-2'}`}>
                                        <button
                                            type="button"
                                            onClick={() => setStudioQueueModeEnabled(!isStudioQueueModeEnabled)}
                                            disabled={isGenerating || studioQueueState?.items.some((item) => item.status === 'running' || item.status === 'cooldown')}
                                            className={`inline-flex items-center gap-1 rounded-xl border font-bold uppercase tracking-wide transition whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60 ${isPhone ? 'shrink-0 snap-start min-h-[36px] px-2 py-1 text-[9px] leading-none' : 'px-3 py-1.5 text-[10px]'} ${
                                                isStudioQueueModeEnabled
                                                    ? isDarkUi
                                                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                                                        : 'border-cyan-300 bg-cyan-50 text-cyan-700'
                                                    : isDarkUi
                                                        ? 'border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-500/30 hover:text-cyan-200'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:border-cyan-200 hover:text-cyan-700'
                                            }`}
                                        >
                                            <Clock size={12} />
                                            Queue {isStudioQueueModeEnabled ? 'On' : 'Off'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!isStudioMultiSpeakerEnabled) {
                                                    setStudioRailTab('cast');
                                                }
                                                toggleStudioMultiSpeaker();
                                            }}
                                            className={`inline-flex items-center gap-1 rounded-xl border font-bold uppercase tracking-wide transition whitespace-nowrap ${isPhone ? 'shrink-0 snap-start min-h-[36px] px-2 py-1 text-[9px] leading-none' : 'px-3 py-1.5 text-[10px]'} ${
                                                isStudioMultiSpeakerEnabled
                                                    ? isDarkUi
                                                        ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
                                                        : 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                                    : isDarkUi
                                                        ? 'border-slate-700 bg-slate-950 text-slate-300 hover:border-indigo-500/30 hover:text-indigo-200'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-200 hover:text-indigo-700'
                                            }`}
                                        >
                                            <Users size={12} />
                                            Multi-Speaker {isStudioMultiSpeakerEnabled ? 'On' : 'Off'}
                                        </button>
                                    </div>
                                </div>
                            </SectionCard>
                            </div>

                            {isDesktop && (
                              <SectionCard className="mt-6 rounded-2xl p-3">
                                <div
                                  className="vf-scrollbar-invisible flex flex-nowrap justify-center gap-1.5 overflow-x-auto pb-0.5"
                                  {...studioRailTabs.listProps}
                                >
                                  {desktopDockTabItems.map((tabItem) => {
                                    const isActive = studioRailTab === tabItem.id;
                                    const isDisabled = Boolean(tabItem.disabled);
                                    return (
                                      <button
                                        key={`desktop-dock-${tabItem.id}`}
                                        type="button"
                                        {...studioRailTabs.getTabProps(tabItem.id, isDisabled)}
                                        title={isDisabled ? 'Voice controls are disabled while Multi-Speaker mode is on. Use Cast.' : undefined}
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
                                          isActive
                                            ? (isDarkUi ? 'border-cyan-500/45 bg-cyan-500/14 text-cyan-100' : 'border-cyan-300 bg-cyan-50 text-cyan-700')
                                          : isDisabled
                                              ? (isDarkUi ? 'cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500' : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400')
                                              : (isDarkUi ? 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/30 hover:text-cyan-200' : 'border-gray-200 bg-white text-gray-600 hover:border-cyan-200 hover:text-cyan-700')
                                        }`}
                                      >
                                        <span
                                          aria-hidden="true"
                                          className={`h-2 w-2 shrink-0 rounded-full ${getStudioRailTabDotClassName(isActive, isDisabled)}`}
                                        />
                                        <span className={`leading-none ${isDisabled ? 'opacity-70' : ''}`}>
                                          {tabItem.label}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </SectionCard>
                            )}

                            {/* Generated Audio Player */}
                            {(generatedAudioUrl || isGenerating || liveAudioChunks.length > 0) && (
                                <div className="animate-in slide-in-from-bottom-4">
                                    <Suspense fallback={<div className={`rounded-3xl border px-4 py-4 text-sm ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-300' : 'border-gray-200 bg-white text-gray-600'}`}>Loading audio player...</div>}>
                                      <AudioPlayer
                                        audioUrl={generatedAudioUrl}
                                        isGenerating={isGenerating}
                                        liveChunks={liveAudioChunks}
                                        isLiveStreaming={isGenerating || liveAudioChunks.length > 0}
                                        autoPlayOnFirstChunk={settings.autoPlayGeneratedAudio !== false}
                                        onReset={() => {
                                          setGeneratedAudioUrlManaged(null);
                                          setLiveAudioChunks([]);
                                          seenLiveChunkKeysRef.current.clear();
                                          activeGatewayRequestIdRef.current = '';
                                          activeGatewayJobIdRef.current = '';
                                        }}
                                      />
                                    </Suspense>
                                    {generationTiming && (
                                      <div className={`mt-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[11px] ${
                                        isDarkUi
                                          ? 'border-cyan-500/30 bg-slate-950 text-cyan-100'
                                          : 'border-cyan-200 bg-cyan-50 text-cyan-700'
                                      }`}>
                                        <span className="font-bold uppercase tracking-wide">{generationTiming.mode === 'queue' ? 'Queue timing' : 'Run timing'}</span>
                                        <span>First audio {formatGenerationDuration(generationTiming.timeToFirstAudioMs)}</span>
                                        <span>Total {formatGenerationDuration(generationTiming.totalGenerationMs)}</span>
                                        {generationTiming.mode === 'queue' && generationTiming.partCount ? (
                                          <span>{generationTiming.partCount} part{generationTiming.partCount === 1 ? '' : 's'}</span>
                                        ) : null}
                                        {generationTiming.coldStart ? <span className="font-semibold">(cold start)</span> : null}
                                      </div>
                                    )}
                                </div>
                            )}
                        </div>

	                        {/* Controls Sidebar */}
                        {shouldDockStudioPanelBelowEditor && (
                          <div className="vf-studio-rail h-fit xl:sticky xl:top-24 xl:self-start">
                            <SectionCard className="p-5 rounded-3xl">
	                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
	                                    <Sliders size={13} /> Audio Mix
	                                </h3>
                                    <div>
	                                <div className="space-y-4">
		                                    <div>
		                                        <div className="flex justify-between text-xs mb-1 font-bold text-gray-700">
		                                            <span>Speech Speed</span>
		                                            <span>{settings.speed.toFixed(1)}x</span>
		                                        </div>
		                                        <input
	                                            type="range"
	                                            min="0.5"
	                                            max="2.0"
	                                            step="0.1"
	                                            value={settings.speed}
                                              aria-label="Speech speed"
                                              title="Speech speed"
	                                            onChange={(e) => setSettings(s => ({ ...s, speed: parseFloat(e.target.value) }))}
	                                            className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"
	                                        />
	                                    </div>
	                                    <div>
	                                        <div className="text-xs mb-1 font-bold text-gray-700">TTS Output Language</div>
	                                        <select
	                                            value={settings.language}
                                              aria-label="TTS output language"
                                              title="TTS output language"
	                                            onChange={(e) => setSettings(s => ({ ...s, language: e.target.value }))}
	                                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
	                                        >
	                                            <option value="Auto">Auto-Detect</option>
	                                            {LANGUAGES.map(l => <option key={l.code} value={l.name}>{l.name}</option>)}
	                                        </select>
	                                    </div>
	                                    <div>
	                                        <div className="text-xs mb-1 font-bold text-gray-700">Background Music Track</div>
	                                        <select
	                                            value={settings.musicTrackId}
                                              aria-label="Background music track"
                                              title="Background music track"
	                                            onChange={(e) => setSettings(s => ({ ...s, musicTrackId: e.target.value }))}
	                                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
	                                        >
	                                            {studioMusicTrackOptions.map((option) => (
	                                                <option key={option.id} value={option.id}>{option.label}</option>
	                                            ))}
	                                        </select>
	                                        <div className="mt-2 flex flex-wrap items-center gap-2">
	                                            <button
	                                                type="button"
	                                                onClick={() => customMusicTrackInputRef.current?.click()}
	                                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
	                                            >
	                                                <UploadCloud size={12} />
	                                                <span>{customMusicTrackUpload ? 'Replace Upload' : 'Upload Music'}</span>
	                                            </button>
	                                            {customMusicTrackUpload && (
	                                                <button
	                                                    type="button"
	                                                    onClick={clearCustomMusicTrackUpload}
	                                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
	                                                >
	                                                    <X size={12} />
	                                                    <span>Remove</span>
	                                                </button>
	                                            )}
	                                        </div>
	                                        <input
	                                            ref={customMusicTrackInputRef}
	                                            type="file"
	                                            accept={STUDIO_CUSTOM_MUSIC_FILE_ACCEPT}
	                                            className="hidden"
                                              aria-label="Upload background music track"
                                              title="Upload background music track"
	                                            onChange={handleCustomMusicTrackInputChange}
	                                        />
	                                        <div className="mt-1 text-[10px] font-medium text-gray-500">
	                                            {customMusicTrackUpload
	                                                ? `Uploaded: ${customMusicTrackUpload.name}`
	                                                : 'Upload an MP3/WAV/M4A/OGG track to use as background music.'}
	                                        </div>
	                                    </div>
	                                    <div>
	                                        <div className="flex justify-between text-xs mb-1 font-bold text-gray-700">
	                                            <span>Speech Volume</span>
	                                            <span>
                                                {resolveStudioSpeechGain(settings.speechVolume).toFixed(2)}x
                                                <span className="ml-1 text-[10px] font-semibold text-gray-500">
                                                  ({Math.round((resolveStudioSpeechGain(settings.speechVolume) / STUDIO_SPEECH_GAIN_MAX) * 100)}% of max)
                                                </span>
                                              </span>
	                                        </div>
	                                        <input
	                                            type="range"
	                                            min={String(STUDIO_SPEECH_GAIN_MIN)}
	                                            max={String(STUDIO_SPEECH_GAIN_MAX)}
	                                            step="0.05"
	                                            value={resolveStudioSpeechGain(settings.speechVolume)}
	                                            onChange={(e) => setSettings(s => ({ ...s, speechVolume: parseFloat(e.target.value) }))}
                                                aria-label="Speech volume gain"
	                                            className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"
	                                        />
	                                    </div>
	                                    <div>
	                                        <div className="flex justify-between text-xs mb-1 font-bold text-gray-700">
	                                            <span>Music Volume</span>
	                                            <span>{resolveStudioMusicGain(settings.musicVolume).toFixed(2)}x ({Math.round(resolveStudioMusicGain(settings.musicVolume) * 100)}%)</span>
	                                        </div>
		                                        <input
		                                            type="range"
		                                            min="0"
		                                            max="1"
		                                            step="0.05"
		                                            value={resolveStudioMusicGain(settings.musicVolume)}
		                                            onChange={(e) => setSettings(s => ({ ...s, musicVolume: parseFloat(e.target.value) }))}
                                                    aria-label="Music volume gain"
		                                            className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"
		                                        />
		                                </div>
			                                </div>
                                    </div>
                            </SectionCard>
                          </div>
                        )}
                        <div className={`vf-studio-rail h-fit ${isPhone ? 'space-y-4' : 'space-y-5'} ${
                          shouldDockStudioPanelBelowEditor
                            ? 'xl:col-start-1 xl:min-w-0'
                            : 'xl:sticky xl:top-24 xl:self-start'
                        }`}>
                              {!isDesktop && (
                              <SectionCard className={isPhone ? 'p-3 rounded-2xl' : 'p-3 rounded-3xl'}>
                                <div
                                  className={
                                    isPhone
                                      ? 'vf-scrollbar-invisible flex snap-x snap-proximity flex-nowrap gap-1.5 overflow-x-auto pb-0.5'
                                      : 'vf-scrollbar-invisible flex flex-nowrap justify-end gap-1.5 overflow-x-auto pb-0.5'
                                  }
                                  {...studioRailTabs.listProps}
                                >
                                  {studioRailTabItems.map((tabItem) => {
                                    const isActive = studioRailTab === tabItem.id;
                                    const isDisabled = Boolean(tabItem.disabled);
                                    return (
                                      <button
                                        key={tabItem.id}
                                        type="button"
                                        {...studioRailTabs.getTabProps(tabItem.id, isDisabled)}
                                        title={isDisabled ? 'Voice controls are disabled while Multi-Speaker mode is on. Use Cast.' : undefined}
                                        className={`inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-wide transition ${isPhone ? 'shrink-0 snap-start px-2 py-1 text-[9px]' : 'px-3 py-1.5 text-[10px]'} ${
                                          isActive
                                            ? (isDarkUi ? 'border-cyan-500/45 bg-cyan-500/14 text-cyan-100' : 'border-cyan-300 bg-cyan-50 text-cyan-700')
                                          : isDisabled
                                              ? (isDarkUi ? 'cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500' : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400')
                                            : (isDarkUi ? 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/30 hover:text-cyan-200' : 'border-gray-200 bg-white text-gray-600 hover:border-cyan-200 hover:text-cyan-700')
                                        }`}
                                      >
                                        <span
                                          aria-hidden="true"
                                          className={`h-2 w-2 shrink-0 rounded-full ${getStudioRailTabDotClassName(isActive, isDisabled)}`}
                                        />
                                        <span className={`leading-none ${isDisabled ? 'opacity-70' : ''}`}>
                                          {tabItem.label}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </SectionCard>
                              )}
		                            {studioRailTab === 'voice' && (
                                <div className={shouldDockStudioPanelBelowEditor ? 'xl:col-start-1 xl:row-start-1 xl:min-w-0' : ''}>
	                            <SectionCard className={isPhone ? 'p-3 rounded-2xl' : 'p-5 rounded-3xl'}>
                                    {isPhone ? (
                                        <div className="flex w-full items-start justify-between gap-2">
                                            <button
                                                type="button"
                                                onClick={() => toggleStudioMobilePanel('speaker')}
                                                className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                                            >
                                                <div>
                                                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Speaker</h3>
                                                    <div className="mt-1 flex items-center gap-1.5">
                                                        <span className="text-[10px] font-semibold text-gray-500">{studioVoiceOptions.length} voices</span>
                                                    </div>
                                                </div>
                                                {studioMobilePanels.speaker ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                                            </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openVoiceConversionForVoiceId(
                                                      settings.voiceId,
                                                      characterLibrary.find((char) => char.voiceId === settings.voiceId)?.name,
                                                      characterLibrary.find((char) => char.voiceId === settings.voiceId)?.id
                                                    )}
                                                    className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 font-semibold transition ${
                                                      isPhone ? 'h-[44px] min-h-[44px] min-w-[7rem] px-3.5 text-sm' : 'h-8 min-w-[4.8rem] text-[11px]'
                                                    } ${
                                                      isDarkUi
                                                        ? 'border-slate-700 bg-slate-900 text-fuchsia-200 hover:border-fuchsia-500/30 hover:bg-fuchsia-500/10'
                                                        : 'border-gray-200 bg-white text-fuchsia-600 hover:border-fuchsia-200 hover:bg-fuchsia-50'
                                                    }`}
                                                title="Clone this speaker with reference audio"
                                                aria-label="Clone this speaker with reference audio"
                                            >
                                                <Mic2 size={13} />
                                                <span>Clone</span>
                                            </button>
                                        </div>
                                    ) : (
	                                    <div className="mb-4 flex items-center justify-between">
	                                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Speaker</h3>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold ${
                                                        settings.engine === 'VECTOR'
                                                          ? 'text-amber-600'
                                                          : 'text-indigo-600'
                                                    }`}>
	                                                {getEngineDisplayName(settings.engine)}
	                                            </span>
                                                <span className="text-[10px] font-semibold text-gray-500">{studioVoiceOptions.length} voices</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => openVoiceConversionForVoiceId(
                                                          settings.voiceId,
                                                          characterLibrary.find((char) => char.voiceId === settings.voiceId)?.name,
                                                          characterLibrary.find((char) => char.voiceId === settings.voiceId)?.id
                                                        )}
                                                        className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 font-semibold transition ${
                                                          isPhone ? 'h-[44px] min-h-[44px] min-w-[7rem] px-3.5 text-sm' : 'h-8 min-w-[4.8rem] text-[11px]'
                                                        } ${
                                                          isDarkUi
                                                            ? 'border-slate-700 bg-slate-900 text-fuchsia-200 hover:border-fuchsia-500/30 hover:bg-fuchsia-500/10'
                                                            : 'border-gray-200 bg-white text-fuchsia-600 hover:border-fuchsia-200 hover:bg-fuchsia-50'
                                                        }`}
                                                    title="Clone this speaker with reference audio"
                                                    aria-label="Clone this speaker with reference audio"
                                                >
                                                    <Mic2 size={13} />
                                                    <span>Clone</span>
                                                </button>
	                                    </div>
                                    </div>
                                    )}

                                    {(!isPhone || studioMobilePanels.speaker) && (
                                    <>
	                                <div className={`mb-3 rounded-2xl border px-3 py-2 text-[11px] font-medium ${
                                          isDarkUi
                                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                                            : 'border-amber-200 bg-amber-50 text-amber-800'
                                        }`}>
                                          {VOICE_GENERATION_DELAY_NOTICE}
                                        </div>
	                                <div className={`max-h-60 overflow-y-auto studio-scrollbar space-y-3 pr-1 ${isPhone ? 'mt-4 mb-3' : 'mb-4'}`}>
                                        <div>
                                            <div className="mb-2 flex items-center justify-between">
                                                <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Free Speakers</span>
                                                <span className="text-[10px] font-semibold text-gray-500">{studioFreeVoiceOptions.length}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {studioFreeVoiceOptions.map((v: any) => {
                                                    const isSelected = settings.voiceId === v.id;
                                                    const voiceMeta = resolveVoiceDisplayMeta(v);
                                                    return (
                                                        <button
                                                            key={v.id}
                                                            onClick={() => setSettings(s => ({ ...s, voiceId: v.id }))}
                                                            className={`vf-voice-chip ${isSelected ? 'vf-voice-chip--active' : ''} flex min-h-[2.85rem] min-w-[7.35rem] max-w-[10rem] items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-2 text-xs font-bold transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'}`}
                                                        >
                                                            <div className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center ${isSelected ? 'bg-white/20' : 'bg-gray-200'}`}>{voiceMeta.name[0] || 'V'}</div>
                                                            <div className="min-w-0 flex flex-col items-start leading-tight">
                                                                <div className="flex w-full items-center gap-1.5">
                                                                    <span className="truncate">{voiceMeta.name}</span>
                                                                    {voiceMeta.countryTag && (
                                                                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-extrabold leading-none ${isSelected ? 'border-white/40 bg-white/15 text-white/90' : 'border-gray-300 bg-gray-100 text-gray-600'}`}>
                                                                            {voiceMeta.countryTag}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className={`w-full truncate text-[10px] font-semibold ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                                                                    {resolveVoicePersonaLabel(v)}
                                                                </span>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="mb-2 flex items-center justify-between">
                                                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Pro Speakers</span>
                                                <span className="text-[10px] font-semibold text-gray-500">{studioProVoiceOptions.length}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {studioProVoiceOptions.map((v: any) => {
                                                    const isSelected = settings.voiceId === v.id;
                                                    const locked = isVoiceLockedForFreeTier(settings.engine, v);
                                                    const voiceMeta = resolveVoiceDisplayMeta(v);
                                                    return (
                                                        <button
                                                            key={v.id}
                                                            onClick={() => {
                                                                if (locked) {
                                                                    setShowSubscriptionModal(true);
                                                                    return;
                                                                }
                                                                setSettings((s) => ({ ...s, voiceId: v.id }));
                                                            }}
                                                            className={`vf-voice-chip ${isSelected && !locked ? 'vf-voice-chip--active' : ''} flex min-h-[2.85rem] min-w-[7.35rem] max-w-[10rem] items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-2 text-xs font-bold transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] ${locked ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'}`}
                                                            title={locked ? 'Upgrade to use Pro voices' : undefined}
                                                        >
                                                            <div className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center ${isSelected && !locked ? 'bg-white/20' : locked ? 'bg-amber-200' : 'bg-gray-200'}`}>{voiceMeta.name[0] || 'V'}</div>
                                                            <div className="min-w-0 flex flex-col items-start leading-tight">
                                                                <div className="flex w-full items-center gap-1.5">
                                                                    <span className="truncate">{voiceMeta.name}</span>
                                                                    {voiceMeta.countryTag && (
                                                                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-extrabold leading-none ${isSelected && !locked ? 'border-white/40 bg-white/15 text-white/90' : locked ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-gray-300 bg-gray-100 text-gray-600'}`}>
                                                                            {voiceMeta.countryTag}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className={`w-full truncate text-[10px] font-semibold ${locked ? 'text-amber-700' : isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                                                                    {locked ? 'Pro - Upgrade' : resolveVoicePersonaLabel(v)}
                                                                </span>
                                                            </div>
                                                            {locked && <Lock size={12} />}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
	                                </div>
                                    </>
                                    )}
			                            </SectionCard>
                                  </div>
                                  )}

	                            {/* Studio Audio Mix */}
                                  {((isDesktop && !shouldDockStudioPanelBelowEditor) || studioRailTab === 'mix') && (
                                    <div className={shouldDockStudioPanelBelowEditor ? 'xl:col-start-2 xl:row-start-2' : ''}>
		                            <SectionCard className={isPhone ? 'p-3 rounded-2xl' : 'p-5 rounded-3xl'}>
                                    {isPhone ? (
                                        <button
                                            type="button"
                                            onClick={() => toggleStudioMobilePanel('mix')}
                                            className="flex w-full items-center justify-between gap-3 text-left"
                                        >
	                                        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
	                                            <Sliders size={13} /> Audio Mix
	                                        </h3>
                                            {studioMobilePanels.mix ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                                        </button>
                                    ) : (
	                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
	                                    <Sliders size={13} /> Audio Mix
	                                </h3>
                                    )}
                                    {(!isPhone || studioMobilePanels.mix) && (
                                    <div className={isPhone ? 'mt-4' : ''}>
	                                <div className="space-y-4">
		                                    <div>
		                                        <div className="flex justify-between text-xs mb-1 font-bold text-gray-700">
		                                            <span>Speech Speed</span>
		                                            <span>{settings.speed.toFixed(1)}x</span>
		                                        </div>
		                                        <input
	                                            type="range"
	                                            min="0.5"
	                                            max="2.0"
	                                            step="0.1"
	                                            value={settings.speed}
                                              aria-label="Speech speed"
                                              title="Speech speed"
	                                            onChange={(e) => setSettings(s => ({ ...s, speed: parseFloat(e.target.value) }))}
	                                            className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"
	                                        />
	                                    </div>
	                                    <div>
	                                        <div className="text-xs mb-1 font-bold text-gray-700">TTS Output Language</div>
	                                        <select
	                                            value={settings.language}
                                              aria-label="TTS output language"
                                              title="TTS output language"
	                                            onChange={(e) => setSettings(s => ({ ...s, language: e.target.value }))}
	                                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
	                                        >
	                                            <option value="Auto">Auto-Detect</option>
	                                            {LANGUAGES.map(l => <option key={l.code} value={l.name}>{l.name}</option>)}
	                                        </select>
	                                    </div>
	                                    <div>
	                                        <div className="text-xs mb-1 font-bold text-gray-700">Background Music Track</div>
	                                        <select
	                                            value={settings.musicTrackId}
                                              aria-label="Background music track"
                                              title="Background music track"
	                                            onChange={(e) => setSettings(s => ({ ...s, musicTrackId: e.target.value }))}
	                                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
	                                        >
	                                            {studioMusicTrackOptions.map((option) => (
	                                                <option key={option.id} value={option.id}>{option.label}</option>
	                                            ))}
	                                        </select>
	                                        <div className="mt-2 flex flex-wrap items-center gap-2">
	                                            <button
	                                                type="button"
	                                                onClick={() => customMusicTrackInputRef.current?.click()}
	                                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
	                                            >
	                                                <UploadCloud size={12} />
	                                                <span>{customMusicTrackUpload ? 'Replace Upload' : 'Upload Music'}</span>
	                                            </button>
	                                            {customMusicTrackUpload && (
	                                                <button
	                                                    type="button"
	                                                    onClick={clearCustomMusicTrackUpload}
	                                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
	                                                >
	                                                    <X size={12} />
	                                                    <span>Remove</span>
	                                                </button>
	                                            )}
	                                        </div>
	                                        <input
	                                            ref={customMusicTrackInputRef}
	                                            type="file"
	                                            accept={STUDIO_CUSTOM_MUSIC_FILE_ACCEPT}
	                                            className="hidden"
                                              aria-label="Upload background music track"
                                              title="Upload background music track"
	                                            onChange={handleCustomMusicTrackInputChange}
	                                        />
	                                        <div className="mt-1 text-[10px] font-medium text-gray-500">
	                                            {customMusicTrackUpload
	                                                ? `Uploaded: ${customMusicTrackUpload.name}`
	                                                : 'Upload an MP3/WAV/M4A/OGG track to use as background music.'}
	                                        </div>
	                                    </div>
	                                    <div>
	                                        <div className="flex justify-between text-xs mb-1 font-bold text-gray-700">
	                                            <span>Speech Volume</span>
	                                            <span>
                                                {resolveStudioSpeechGain(settings.speechVolume).toFixed(2)}x
                                                <span className="ml-1 text-[10px] font-semibold text-gray-500">
                                                  ({Math.round((resolveStudioSpeechGain(settings.speechVolume) / STUDIO_SPEECH_GAIN_MAX) * 100)}% of max)
                                                </span>
                                              </span>
	                                        </div>
	                                        <input
	                                            type="range"
	                                            min={String(STUDIO_SPEECH_GAIN_MIN)}
	                                            max={String(STUDIO_SPEECH_GAIN_MAX)}
	                                            step="0.05"
	                                            value={resolveStudioSpeechGain(settings.speechVolume)}
	                                            onChange={(e) => setSettings(s => ({ ...s, speechVolume: parseFloat(e.target.value) }))}
                                                aria-label="Speech volume gain"
	                                            className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"
	                                        />
	                                    </div>
	                                    <div>
	                                        <div className="flex justify-between text-xs mb-1 font-bold text-gray-700">
	                                            <span>Music Volume</span>
	                                            <span>{resolveStudioMusicGain(settings.musicVolume).toFixed(2)}x ({Math.round(resolveStudioMusicGain(settings.musicVolume) * 100)}%)</span>
	                                        </div>
		                                        <input
		                                            type="range"
		                                            min="0"
		                                            max="1"
		                                            step="0.05"
		                                            value={resolveStudioMusicGain(settings.musicVolume)}
		                                            onChange={(e) => setSettings(s => ({ ...s, musicVolume: parseFloat(e.target.value) }))}
                                                    aria-label="Music volume gain"
		                                            className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"
		                                        />
		                                </div>
			                                </div>
                                    </div>
                                    )}
			                            </SectionCard>
                                    </div>
                                  )}

                                    {studioRailTab === 'cast' && (
                                      <div className={shouldDockStudioPanelBelowEditor ? 'xl:col-start-1 xl:row-start-1 xl:min-w-0' : ''}>
                                      {isStudioMultiSpeakerEnabled ? (
		                            <>
		                            {/* Cast & Crew */}
	                            <SectionCard className={`${isPhone ? 'p-3 rounded-2xl' : 'p-4 rounded-3xl'} border animate-in fade-in ${
                                      isDarkUi
                                        ? 'bg-slate-900/75 border-indigo-500/20'
                                        : 'bg-indigo-50 border-indigo-100'
                                    }`}>
                                    {isPhone ? (
                                        <div className="mb-3 flex flex-col gap-2">
                                            <div className="flex items-start justify-between gap-3">
                                              {isStudioCastPanelOpen ? (
                                                <button
                                                  type="button"
                                                  onClick={() => toggleStudioMobilePanel('cast')}
                                                  className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                                                  aria-expanded="true"
                                                  aria-controls="studio-cast-panel"
                                                >
                                                  <div className="min-w-0">
                                                    <h3 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${
                                                      isDarkUi ? 'text-indigo-200' : 'text-indigo-400'
                                                    }`}><Bot size={14}/> Cast &amp; Crew</h3>
                                                    <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                                      {isStudioMultiSpeakerEnabled
                                                        ? `${activeScriptLanguageCode.toUpperCase()} - ${castSpeakers.length} speakers`
                                                        : 'Disabled'}
                                                    </p>
                                                  </div>
                                                  <div className="flex items-center gap-1.5">
                                                    {studioCrewTags.length > 0 && (
                                                      <span className={`vf-studio-chip shrink-0 border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                                        isDarkUi
                                                          ? 'border-cyan-500/30 bg-slate-950 text-cyan-200'
                                                          : 'border-cyan-100 bg-white text-cyan-600'
                                                      }`}>
                                                        {studioCrewTags.length} crew
                                                      </span>
                                                    )}
                                                    <ChevronUp size={16} className="text-gray-500" />
                                                  </div>
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => toggleStudioMobilePanel('cast')}
                                                  className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                                                  aria-expanded="false"
                                                  aria-controls="studio-cast-panel"
                                                >
                                                  <div className="min-w-0">
                                                    <h3 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${
                                                      isDarkUi ? 'text-indigo-200' : 'text-indigo-400'
                                                    }`}><Bot size={14}/> Cast &amp; Crew</h3>
                                                    <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                                      {isStudioMultiSpeakerEnabled
                                                        ? `${activeScriptLanguageCode.toUpperCase()} - ${castSpeakers.length} speakers`
                                                        : 'Disabled'}
                                                    </p>
                                                  </div>
                                                  <div className="flex items-center gap-1.5">
                                                    {studioCrewTags.length > 0 && (
                                                      <span className={`vf-studio-chip shrink-0 border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                                        isDarkUi
                                                          ? 'border-cyan-500/30 bg-slate-950 text-cyan-200'
                                                          : 'border-cyan-100 bg-white text-cyan-600'
                                                      }`}>
                                                        {studioCrewTags.length} crew
                                                      </span>
                                                    )}
                                                    <ChevronDown size={16} className="text-gray-500" />
                                                  </div>
                                                </button>
                                              )}
                                                <button
                                                    type="button"
                                                    onClick={autoAssignCastVoices}
                                                    disabled={
                                                        !isStudioMultiSpeakerEnabled ||
                                                        !hasStudioExplicitMultiSpeakerScript ||
                                                        isAutoAssigningCast ||
                                                        castSpeakers.length === 0 ||
                                                        castVoiceOptions.length === 0
                                                    }
                                                    title="Refresh cast from the current text and assign voices"
                                                    className={`vf-studio-chip inline-flex items-center gap-1 border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] transition ${
                                                        isDarkUi
                                                            ? 'border-indigo-500/30 bg-slate-950 text-indigo-200 hover:bg-slate-900'
                                                            : 'border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50'
                                                    } disabled:opacity-60`}
                                                >
                                                    {isAutoAssigningCast ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                                    AI Auto
                                                </button>
                                            </div>
                                            {!isStudioCastPanelOpen && (
                                                <p className={`text-[11px] font-medium ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                                    Tap to expand cast mappings and reference audio.
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                    <div className="mb-3 flex items-center justify-between gap-2">
                                        <h3 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${
                                            isDarkUi ? 'text-indigo-200' : 'text-indigo-400'
                                        }`}><Bot size={14}/> Cast &amp; Crew</h3>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={autoAssignCastVoices}
                                                disabled={
                                                    !isStudioMultiSpeakerEnabled ||
                                                    !hasStudioExplicitMultiSpeakerScript ||
                                                    isAutoAssigningCast ||
                                                    castSpeakers.length === 0 ||
                                                    castVoiceOptions.length === 0
                                                }
                                                title="Refresh cast from the current text and assign voices"
                                                className={`vf-studio-chip inline-flex items-center gap-1 border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] transition ${
                                                    isDarkUi
                                                        ? 'border-indigo-500/30 bg-slate-950 text-indigo-200 hover:bg-slate-900'
                                                        : 'border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50'
                                                } disabled:opacity-60`}
                                            >
                                                {isAutoAssigningCast ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                                AI Auto
                                            </button>
                                            {studioCrewTags.length > 0 && (
                                                <span className={`vf-studio-chip px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                                    isDarkUi
                                                      ? 'bg-slate-950 text-cyan-200 border border-cyan-500/30'
                                                      : 'bg-white text-cyan-600 border border-cyan-100'
                                                }`}>
                                                    {studioCrewTags.length} crew
                                                </span>
                                            )}
                                            <span className={`vf-studio-chip px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                                isDarkUi
                                                  ? 'bg-slate-950 text-indigo-200 border border-indigo-500/30'
                                                  : 'bg-white text-indigo-500 border border-indigo-100'
                                            }`}>
                                                {isStudioMultiSpeakerEnabled ? activeScriptLanguageCode.toUpperCase() : 'Disabled'}
                                            </span>
                                        </div>
                                    </div>
                                    )}
                                    {isStudioCastPanelOpen && (
                                      <>
                                    {!isStudioMultiSpeakerEnabled && (
                                      <p className="mb-3 text-[11px] font-medium text-gray-500">
                                        Enable Multi-Speaker Mode to edit cast mappings.
                                      </p>
                                    )}
                                    <div className="space-y-2" id="studio-cast-panel">
                                        {castSpeakers.map(speaker => {
                                            const char = characterLibrary.find(c => c.name.toLowerCase() === speaker.toLowerCase()) || null;
                                            const selectedVoiceId = char?.voiceId || resolveMappedVoiceForSpeaker(speaker) || castFreeVoiceOptions[0]?.id || castVoiceOptions[0]?.id || '';
                                            const speakerMapKey = normalizeSpeakerMapKey(speaker);
                                            const speakerVcReference = speakerMapKey ? speakerVcReferenceMap[speakerMapKey] : undefined;
                                            const speakerVcReferenceTime = speakerVcReference?.updatedAt
                                                ? new Intl.DateTimeFormat(undefined, {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: 'numeric',
                                                    minute: '2-digit',
                                                }).format(new Date(speakerVcReference.updatedAt))
                                                : '';
                                            const isSpeakerVoicePresetLocked = Boolean(speakerVcReference);
                                            return (
                                                <div key={speaker} className={`flex flex-nowrap items-center justify-between gap-2 rounded-2xl border p-2 shadow-sm ${
                                                    isDarkUi
                                                      ? 'bg-slate-950 border-indigo-500/20'
                                                      : 'bg-white border-indigo-100'
                                                }`}>
                                                    <div className="flex min-w-0 flex-col gap-0.5">
                                                        <span className={`truncate text-[11px] font-bold ${isDarkUi ? 'text-slate-100' : 'text-gray-700'}`}>{speaker}</span>
                                                        {speakerVcReference && (
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <span className={`vf-studio-chip inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                                                    isDarkUi
                                                                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                                                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                                }`}>
                                                                    Ref audio set
                                                                </span>
                                                                <span className={`truncate text-[10px] font-medium ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                                                    {speakerVcReference.sourceVoiceName || speakerVcReference.referenceAudioName}
                                                                    {speakerVcReferenceTime ? ` - ${speakerVcReferenceTime}` : ''}
                                                                </span>
                                                                <span className={`vf-studio-chip inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                                                    isDarkUi
                                                                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                                                                        : 'border-amber-200 bg-amber-50 text-amber-700'
                                                                }`}>
                                                                    Preset locked
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-1.5">
                                                        {speakerVcReference && (
                                                            <button
                                                                type="button"
                                                                onClick={() => clearSpeakerVcReference(speaker)}
                                                                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition ${
                                                                  isDarkUi
                                                                    ? 'border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-200'
                                                                    : 'border-gray-200 bg-white text-gray-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
                                                                }`}
                                                                title={`Clear reference audio for ${speaker}`}
                                                                aria-label={`Clear reference audio for ${speaker}`}
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => openVoiceConversionForVoiceId(
                                                              selectedVoiceId,
                                                              speaker,
                                                              char?.id
                                                            )}
                                                            className={`vf-studio-chip inline-flex h-8 min-w-[6.2rem] shrink-0 items-center justify-center gap-1.5 border px-2.5 text-[10px] font-semibold transition ${
                                                              isDarkUi
                                                                ? 'border-slate-700 bg-slate-900 text-fuchsia-200 hover:border-fuchsia-500/30 hover:bg-fuchsia-500/10'
                                                                : 'border-gray-200 bg-white text-fuchsia-600 hover:border-fuchsia-200 hover:bg-fuchsia-50'
                                                            }`}
                                                            title={`${speakerVcReference ? 'Update Ref' : 'Add Ref'} for ${speaker}`}
                                                            aria-label={`${speakerVcReference ? 'Update Ref' : 'Add Ref'} for ${speaker}`}
                                                        >
                                                            <Mic2 size={13} />
                                                            <span>{speakerVcReference ? 'Update Ref' : 'Add Ref'}</span>
                                                        </button>
                                                        <select 
                                                            className={`vf-studio-chip h-8 min-w-[10.5rem] max-w-[11.5rem] rounded-full px-2.5 py-1 text-[10px] font-semibold outline-none ${
                                                                isDarkUi ? 'bg-slate-900 text-slate-100' : 'bg-gray-50 text-gray-700'
                                                            } ${
                                                                isSpeakerVoicePresetLocked ? 'cursor-not-allowed opacity-60' : ''
                                                            }`}
                                                            aria-label={`Voice for ${speaker}`}
                                                            data-testid={`studio-cast-voice-${speaker}`}
                                                            value={selectedVoiceId}
                                                            disabled={!isStudioMultiSpeakerEnabled || isSpeakerVoicePresetLocked}
                                                            title={isSpeakerVoicePresetLocked
                                                                ? `Voice preset is locked for ${speaker} while reference audio is attached. Clear reference audio to change preset.`
                                                                : `Voice preset for ${speaker}`
                                                            }
                                                            onChange={(e) => {
                                                                if (isSpeakerVoicePresetLocked) return;
                                                                const newVoiceId = e.target.value;
                                                                const selectedVoice = castVoiceOptions.find((voice) => voice.id === newVoiceId);
                                                                if (selectedVoice && isVoiceLockedForFreeTier(settings.engine, selectedVoice)) {
                                                                    setShowSubscriptionModal(true);
                                                                    return;
                                                                }
                                                                setSettings((s) => ({
                                                                    ...s,
                                                                    speakerMapping: upsertSpeakerVoiceMapping(speaker, newVoiceId, s.speakerMapping),
                                                                }));
                                                                
                                                                if (char) {
                                                                    updateCharacter({ ...char, voiceId: newVoiceId });
                                                                } else {
                                                                    const voice =
                                                                        getVoiceById(newVoiceId) ||
                                                                        castVoiceOptions.find(v => v.id === newVoiceId) ||
                                                                        castVoiceOptions[0];
                                                                    updateCharacter({
                                                                        id: Date.now().toString(),
                                                                        name: speaker,
                                                                        voiceId: newVoiceId,
                                                                        gender: voice?.gender || 'Unknown',
                                                                        age: voice ? resolveVoiceAgeGroup(voice) : 'Unknown'
                                                                    });
                                                                }
                                                            }}
                                                        >
                                                            {castFreeVoiceOptions.length > 0 && (
                                                                <optgroup label="Free Speakers">
                                                                    {castFreeVoiceOptions.map((v: any) => (
                                                                        <option key={v.id} value={v.id}>
                                                                            {`${resolveVoiceDisplayLabel(v)} (${resolveVoicePersonaLabel(v)})`}
                                                                        </option>
                                                                    ))}
                                                                </optgroup>
                                                            )}
                                                            {castProVoiceOptions.length > 0 && (
                                                                <optgroup label="Pro Speakers">
                                                                    {castProVoiceOptions.map((v: any) => (
                                                                        <option
                                                                            key={v.id}
                                                                            value={v.id}
                                                                            disabled={isVoiceLockedForFreeTier(settings.engine, v)}
                                                                        >
                                                                            {`${resolveVoiceDisplayLabel(v)} (${resolveVoicePersonaLabel(v)}) - Pro`}
                                                                        </option>
                                                                    ))}
                                                                </optgroup>
                                                            )}
                                                        </select>
                                                    </div>
                                                </div>
                                            );
                                        })}
	                                    </div>
                                        {studioCrewTags.length > 0 && (
                                            <div className={`mt-3 rounded-2xl border p-3 ${isDarkUi ? 'border-cyan-500/20 bg-slate-950' : 'border-cyan-100 bg-white/90'}`}>
                                                <div className="mb-2 flex items-center justify-between gap-2">
                                                    <span className={`text-[10px] font-bold uppercase tracking-wide ${isDarkUi ? 'text-cyan-200' : 'text-cyan-600'}`}>Crew Cues</span>
                                                    <span className={`text-[10px] font-semibold ${isDarkUi ? 'text-cyan-100/80' : 'text-cyan-700'}`}>{studioCrewTags.length}</span>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {studioCrewTags.map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${isDarkUi ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200' : 'border-cyan-200 bg-cyan-50 text-cyan-700'}`}
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
	                                    <div className={`mt-2 text-[10px] text-center ${isDarkUi ? 'text-slate-400' : 'text-gray-400'}`}>
		                                        {!isStudioMultiSpeakerEnabled
	                                                ? 'Single-speaker mode active. Voice is enabled and Cast & Crew is disabled.'
	                                                : 'Multi-speaker mode active. Cast & Crew is enabled and Voice is disabled.'}
		                                    </div>
                                      </>
                                    )}
		                                </SectionCard>
                                    </>
                                      ) : (
                                        <SectionCard className={isPhone ? 'p-3 rounded-2xl' : 'p-5 rounded-3xl'}>
                                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Cast &amp; Crew</h3>
                                          <p className={`mt-2 text-[11px] ${isDarkUi ? 'text-slate-300' : 'text-gray-600'}`}>
                                            Enable Multi-Speaker Mode from the editor toolbar to configure cast mappings.
                                          </p>
                                          <button
                                            type="button"
                                            onClick={enableStudioMultiSpeaker}
                                            className={`mt-3 inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
                                              isDarkUi
                                                ? 'border-indigo-500/40 bg-indigo-500/12 text-indigo-200 hover:bg-indigo-500/18'
                                                : 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                                            }`}
                                          >
                                            <Users size={12} />
                                            Enable Multi-Speaker
                                          </button>
                                        </SectionCard>
                                      )
                                      }
                                      </div>
                                    )}

                                    {studioRailTab === 'queue' && shouldShowStudioQueuePanel && (
                                        <Suspense fallback={<SectionCard className={isPhone ? 'p-3 rounded-2xl' : 'p-5 rounded-3xl'}><div className={`text-sm ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Loading queue...</div></SectionCard>}>
                                          <LazyStudioQueuePanel
                                              queueState={studioQueueState}
                                              draftPartCount={studioQueueDraftPartCount}
                                              planCap={maxCharsPerGeneration}
                                              queueEligible={studioQueueEligible}
                                              isQueueModeEnabled={isStudioQueueModeEnabled}
                                              isGenerating={isGenerating}
                                              audioUrls={studioQueueAudioUrls}
                                              isDarkUi={isDarkUi}
                                              visualVariant="embedded"
                                              isPhone={isPhone}
                                              isOpen={studioMobilePanels.queue}
                                              onToggleOpen={() => toggleStudioMobilePanel('queue')}
                                              onResumeQueue={() => { void resumeStudioQueue(); }}
                                              onClearQueue={() => { void clearStudioQueueState(); }}
                                              onDeleteItem={(itemId) => { void deleteStudioQueueItem(itemId); }}
                                              onRetryItem={retryStudioQueueItem}
                                              onReorderItems={reorderStudioQueueItems}
                                          />
                                        </Suspense>
                                    )}
                                    {studioRailTab === 'queue' && !shouldShowStudioQueuePanel && (
                                      <SectionCard className={isPhone ? 'p-3 rounded-2xl' : 'p-5 rounded-3xl'}>
                                        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
                                          <Clock size={13} /> Queue
                                        </h3>
                                        <p className={`mt-2 text-[11px] ${isDarkUi ? 'text-slate-300' : 'text-gray-600'}`}>
                                          Queue panel appears after you turn Queue mode on in the Studio editor footer.
                                        </p>
                                      </SectionCard>
                                    )}

                        </div>
                    </div>
                    </div>
                )}


                {isVoiceCloneModalOpen && voiceCloneTarget ? (
                  <Suspense
                    fallback={
                      <div className="vf-scrim vf-scrim--modal fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-2xl">
                          <Loader2 size={16} className="animate-spin" />
                          Loading reference audio tools...
                        </div>
                      </div>
                    }
                  >
                    <VoiceCloneModal
                      isOpen={isVoiceCloneModalOpen}
                      onClose={closeVoiceCloneModal}
                      onCloneCreated={handleVoiceCloneCreated}
                      sourceVoiceId={voiceCloneTarget.voiceId}
                      sourceVoiceLabel={voiceCloneTarget.sourceVoiceLabel}
                      sourceVoiceEngine={voiceCloneTarget.sourceVoiceEngine || settings.engine}
                      sourceVoiceUrl={voiceCloneTarget.sourceVoiceUrl}
                      prepareSourceVoiceUrl={() => buildVoiceSampleSource(
                        voiceCloneTarget.voiceId,
                        voiceCloneTarget.sourceVoiceLabel,
                        getVoiceById(voiceCloneTarget.voiceId)?.engine || settings.engine
                      )}
                    />
                  </Suspense>
                ) : null}

                {activeTab === Tab.HISTORY && (
                    <div className={`animate-in fade-in rounded-3xl border p-5 md:p-6 ${
                      isDarkUi ? 'border-slate-800 bg-slate-900/75' : 'border-gray-200 bg-white'
                    }`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className={`text-lg font-bold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>Generation History</h2>
                                <p className={`mt-1 text-xs ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                    Full generation details. Entries older than 1 year are removed automatically.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { void handleRefreshHistory(); }}
                                  disabled={isRefreshingHistory}
                                  className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                                    isDarkUi
                                      ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                                      : 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
                                  }`}
                                  title="Refresh from server"
                                >
                                  {isRefreshingHistory ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                  Refresh
                                </button>
                                <button
                                  onClick={() => { void handleClearHistory(); }}
                                  disabled={isClearingHistory || history.length === 0}
                                  className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                                    isDarkUi
                                      ? 'border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                                      : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                  }`}
                                  title="Clear server history"
                                >
                                  {isClearingHistory ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                  Clear
                                </button>
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            {history.length === 0 && (
                              <div className={`rounded-xl border p-4 text-sm italic ${
                                isDarkUi ? 'border-slate-800 bg-slate-950/60 text-slate-400' : 'border-gray-200 bg-gray-50 text-gray-500'
                              }`}>
                                No generation history found.
                              </div>
                            )}
                            {history.map((item, index) => {
                              const itemKey = `${item.id || 'history'}_${index}`;
                              const isExpanded = expandedHistoryItemKey === itemKey;
                              const historyEngine: GenerationSettings['engine'] = item.engine === 'VECTOR'
                                ? 'VECTOR'
                                : 'PRIME';
                              const voiceLabel = resolveHistoryVoiceLabel(item);
                              const normalizedPreview = String(item.text || '').replace(/\s+/g, ' ').trim();
                              const previewText = normalizedPreview || 'No text preview.';
                              const charCount = Math.max(0, Number(item.chars || (item.text || '').length || 0));

                              return (
                                <div
                                  key={itemKey}
                                  className={`overflow-hidden rounded-2xl border ${
                                    isDarkUi ? 'border-slate-800 bg-slate-950/60' : 'border-gray-200 bg-gray-50/50'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setExpandedHistoryItemKey((prev) => (prev === itemKey ? null : itemKey))}
                                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                                      isDarkUi ? 'hover:bg-slate-900/70' : 'hover:bg-white/70'
                                    }`}
                                  >
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                      historyEngine === 'VECTOR'
                                        ? isDarkUi
                                          ? 'bg-amber-500/20 text-amber-100'
                                          : 'bg-amber-100 text-amber-700'
                                        : isDarkUi
                                          ? 'bg-cyan-500/20 text-cyan-100'
                                          : 'bg-cyan-100 text-cyan-700'
                                    }`}>
                                      {getEngineDisplayName(historyEngine).toUpperCase()}
                                    </span>
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                      isDarkUi ? 'bg-slate-800 text-slate-300' : 'bg-gray-100 text-gray-600'
                                    }`}>
                                      {String(item.status || 'completed')}
                                    </span>
                                    <span className={`shrink-0 font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>
                                      {voiceLabel}:
                                    </span>
                                    <span className={`min-w-0 flex-1 truncate ${isDarkUi ? 'text-slate-300' : 'text-gray-700'}`}>
                                      {previewText}
                                    </span>
                                    <span className={`shrink-0 ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                      {new Date(Number(item.timestamp || Date.now())).toLocaleString()}
                                    </span>
                                    {isExpanded ? (
                                      <ChevronUp size={14} className={isDarkUi ? 'text-slate-400' : 'text-gray-500'} />
                                    ) : (
                                      <ChevronDown size={14} className={isDarkUi ? 'text-slate-400' : 'text-gray-500'} />
                                    )}
                                  </button>

                                  {isExpanded && (
                                    <div className={`border-t px-3 pb-3 pt-2 ${
                                      isDarkUi ? 'border-slate-800 text-slate-300' : 'border-gray-200 text-gray-700'
                                    }`}>
                                      <div className="text-sm leading-relaxed">
                                        {item.text || ''}
                                      </div>
                                      <div className={`mt-2 text-xs ${isDarkUi ? 'text-slate-400' : 'text-gray-600'}`}>
                                        Chars: {charCount.toLocaleString()}
                                      </div>
                                      {item.audioUrl && (
                                        <audio controls src={item.audioUrl} className="mt-2 h-9 w-full" />
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                      </div>
                  </div>
                )}

                {mountedWorkspaceTabs[Tab.NOVEL] && (
                  <div
                    hidden={activeTab !== Tab.NOVEL}
                    aria-hidden={activeTab !== Tab.NOVEL}
                    className={activeTab === Tab.NOVEL ? '' : 'hidden'}
                  >
                    <Suspense fallback={<SectionCard className="rounded-3xl p-6 text-sm">Loading writing workspace...</SectionCard>}>
                      <NovelTabContent
                        settings={settings}
                        onToast={showToast}
                        onSendToStudio={(content: string) => {
                          if (!content.trim()) return;
                          setText(content);
                          void router.push(resolveWorkspaceRoutePath(Tab.STUDIO));
                          showToast('Sent to Studio for Audio Generation', 'success');
                        }}
                      />
                    </Suspense>
                  </div>
                )}
                
                {mountedWorkspaceTabs[Tab.VOICE_CLONING] && (
                  <div
                    hidden={activeTab !== Tab.VOICE_CLONING}
                    aria-hidden={activeTab !== Tab.VOICE_CLONING}
                    className={activeTab === Tab.VOICE_CLONING ? '' : 'hidden'}
                  >
                    <Suspense fallback={<SectionCard className="rounded-3xl p-6 text-sm">Loading voice cloning workspace...</SectionCard>}>
                      <VoiceCloningTabContent
                        selectedEngine={settings.engine}
                        voiceLibraryVoices={getEngineVoiceCatalog(settings.engine)}
                        voicePreviewState={previewState}
                        onPreviewVoice={handleVoicePreview}
                        denseTabs={isPhone || isTablet || isNarrowDesktop}
                      />
                    </Suspense>
                  </div>
                )}

                {hasAdminConsoleAccess && mountedWorkspaceTabs[Tab.ADMIN] && (
                  <div
                    hidden={activeTab !== Tab.ADMIN}
                    aria-hidden={activeTab !== Tab.ADMIN}
                    className={activeTab === Tab.ADMIN ? '' : 'hidden'}
                  >
                    <Suspense fallback={<SectionCard className="rounded-3xl p-6 text-sm">Loading admin controls...</SectionCard>}>
                      <AdminTabContent
                        adminApiBaseUrl={adminApiBaseUrl}
                        onToast={showToast}
                        onRefreshEntitlements={refreshEntitlements}
                        initialOpsTab={initialAdminOpsTab}
                      />
                    </Suspense>
                   </div>
                 )}
                
                {/* Mobile Safe Area Spacer for generate dock collision avoidance */}
                {usesFloatingStudioDock && (
                  <div className={`w-full shrink-0 ${isPhone ? 'h-32' : 'h-24'}`} aria-hidden="true" />
                )}
            </div>
        </div>

        {usesFloatingStudioDock && !isChatOpen && (
            <div
                data-testid="studio-generate-dock"
                className={`vf-studio-generate-anchor ${studioFloatingDockVariantClass} fixed z-[47]`}
            >
                <div className={`vf-studio-generate-dock rounded-2xl border border-indigo-400/35 backdrop-blur-lg ${isDesktop ? 'p-1.5' : 'p-1'}`}>
                    <MorphingGenerateButton
                      onClick={handleGenerate}
                      onCancel={handleCancelGeneration}
                      disabled={!text.trim()}
                      isGenerating={isGenerating}
                      progress={progress}
                      stage=""
                      size={studioGenerateButtonSize}
                    />
                </div>
            </div>
        )}

      </main>

      {!shouldHideAssistantInWorkspace && isChatOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[49] bg-transparent"
          aria-label="Close assistant by clicking outside"
          onClick={() => setIsChatOpen(false)}
        />
      )}

      {/* Floating AI Assistant */}
      {shouldRenderFloatingAssistant ? (
      <div
        className={`fixed z-50 flex flex-col gap-3 ${studioAssistantPositionClass} ${studioAssistantBottomClass}`}
      >
          {isChatOpen && (
              <div className={`${assistantPanelSizeClass} rounded-2xl border backdrop-blur-lg flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300 relative z-50 ring-1 ${
                  isDarkUi
                      ? 'bg-slate-950/95 border-slate-700/80 ring-slate-700/45 shadow-2xl shadow-black/60'
                      : 'bg-white/95 border-white/70 ring-gray-200/80 shadow-2xl shadow-indigo-200/65'
              }`}>
                  <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-3 flex items-center justify-between text-white relative overflow-hidden">
                      <div className="flex items-center gap-2 font-bold text-sm relative z-10">
                        <Sparkles size={16} className="text-yellow-300"/>
                        Creative Assistant
                      </div>
                      <button
                        onClick={() => setIsChatOpen(false)}
                        className="hover:bg-white/20 p-1 rounded-full relative z-10"
                        aria-label="Close assistant panel"
                      >
                        <X size={14}/>
                      </button>
                  </div>

                  <div className={`px-3 py-2 border-b ${isDarkUi ? 'border-slate-700/70 bg-slate-900/60' : 'border-gray-200 bg-slate-50/70'}`}>
                      <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setAssistantAutoApply((prev) => !prev)}
                            className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors ${
                                assistantAutoApply
                                    ? isDarkUi
                                        ? 'border-cyan-500/45 bg-cyan-500/12 text-cyan-200'
                                        : 'border-cyan-300 bg-cyan-50 text-cyan-700'
                                    : isDarkUi
                                        ? 'border-slate-700 bg-slate-900 text-slate-300'
                                        : 'border-gray-200 bg-white text-gray-600'
                            }`}
                          >
                            {assistantAutoApply ? 'Auto Apply On' : 'Auto Apply Off'}
                          </button>
                          <div className={`inline-flex rounded-lg border p-0.5 ${
                              isDarkUi ? 'border-slate-700 bg-slate-900' : 'border-gray-200 bg-white'
                          }`}>
                              <button
                                type="button"
                                onClick={() => setAssistantApplyMode('append')}
                                className={`rounded-md px-2 py-1 text-[10px] font-bold ${
                                    assistantApplyMode === 'append'
                                        ? 'bg-indigo-600 text-white'
                                        : isDarkUi
                                            ? 'text-slate-300'
                                            : 'text-gray-600'
                                }`}
                              >
                                Append
                              </button>
                              <button
                                type="button"
                                onClick={() => setAssistantApplyMode('replace')}
                                className={`rounded-md px-2 py-1 text-[10px] font-bold ${
                                    assistantApplyMode === 'replace'
                                        ? 'bg-indigo-600 text-white'
                                        : isDarkUi
                                            ? 'text-slate-300'
                                            : 'text-gray-600'
                                }`}
                              >
                                Replace
                              </button>
                          </div>
                          <button
                            type="button"
                            onClick={handleApplyLastAssistantDraft}
                            className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors ${
                                isDarkUi
                                    ? 'border-slate-700 bg-slate-900 text-slate-200 hover:border-indigo-500/45 hover:text-indigo-200'
                                    : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-200 hover:text-indigo-700'
                            }`}
                          >
                            Paste Last
                          </button>
                      </div>
                  </div>

                  <div className={`px-3 py-2 border-b ${isDarkUi ? 'border-slate-700/70 bg-slate-900/55' : 'border-gray-200 bg-white/70'}`}>
                      <div className="flex flex-wrap gap-1.5">
                          {assistantQuickActions.map((action) => (
                              <button
                                key={action.id}
                                type="button"
                                onClick={() => handleAssistantQuickAction(action)}
                                disabled={isChatLoading}
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors disabled:opacity-55 ${
                                    isDarkUi
                                        ? 'border-slate-700 bg-slate-900/80 text-slate-200 hover:border-indigo-500/50 hover:text-indigo-200'
                                        : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-200 hover:text-indigo-700'
                                }`}
                              >
                                {action.label}
                              </button>
                          ))}
                      </div>
                  </div>

                  <div className={`flex-1 overflow-y-auto p-3 space-y-3 studio-scrollbar ${
                      isDarkUi ? 'bg-slate-950/70' : 'bg-slate-50/80'
                  }`}>
                      {chatHistory.map((msg, i) => (
                          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                              <div className={`max-w-[92%] p-2.5 rounded-2xl text-xs leading-relaxed shadow-sm ${
                                  msg.role === 'user'
                                      ? 'bg-indigo-600 text-white rounded-br-none'
                                      : isDarkUi
                                          ? 'bg-slate-900 border border-slate-700 text-slate-100 rounded-bl-none'
                                          : 'bg-white border border-gray-200 text-gray-700 rounded-bl-none'
                              }`}>
                                {msg.text}
                              </div>
                          </div>
                      ))}
                      {isChatLoading && (
                          <div className="flex items-start">
                              <div className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-[11px] ${
                                  isDarkUi
                                      ? 'border-slate-700 bg-slate-900 text-slate-300'
                                      : 'border-gray-200 bg-white text-gray-500'
                              }`}>
                                  <Loader2 size={12} className="animate-spin" />
                                  Thinking...
                              </div>
                          </div>
                      )}
                      <div ref={chatEndRef} />
                  </div>
                  <form onSubmit={handleChatSubmit} className={`p-3 border-t flex gap-2 ${
                      isDarkUi ? 'bg-slate-950 border-slate-700/80' : 'bg-white border-gray-100'
                  }`}>
                      <input
                        className={`flex-1 rounded-lg px-3 py-2 text-xs outline-none border ${
                            isDarkUi
                                ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500'
                                : 'bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-400'
                        }`}
                        placeholder="Ask to write, rewrite, guide, or edit..."
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                      />
                      <button
                        disabled={isChatLoading}
                        type="submit"
                        className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {isChatLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14}/>}
                      </button>
                  </form>
              </div>
          )}
          
      </div>
      ) : null}

      {/* Resource Monitor */}
      {ENABLE_RESOURCE_MONITOR ? (
        <ResourceMonitor
          isWorking={isGenerating || isAiWriting || isChatLoading}
          hidden={shouldHideAssistantInWorkspace}
        />
      ) : null}

      {/* Modals & Overlays */}
      {showSettings && renderSettingsPanel()}
      </div>
    </div>
  );
};


