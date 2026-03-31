'use client';

import React, { Suspense, lazy, startTransition, useDeferredValue, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { 
    Mic, Play, Pause, Settings, X, Wand2, Trash2, Sparkles, 
    Music, Video, 
    Save, Fingerprint, UploadCloud, Loader2,
    Download, Menu, Box,
    Plus, Bot, Volume2, Clock, Send, 
    Film, Mic2, Sliders,
    Lock, RefreshCw, Users, Edit2, Palette, Timer, Cpu, Minimize2, Maximize2, Zap, Laptop, Activity, Search, Sun, Moon, Type, ChevronDown, ChevronUp, LogIn, LogOut, UserPlus, Coins, Bell
} from 'lucide-react';
import { Button } from '../components/Button';
import { UploadDropzone } from '../components/ui/UploadDropzone';
import { VOICES, MUSIC_TRACKS, LANGUAGES, EMOTIONS, DUNO_VOICES } from '../constants';
import {
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
  DubbingClip,
  DubbingClipboard,
  CpuDubbingProfile,
} from '../types';
import { USER_CONTEXT_CHARACTER_SYNC_WARNING_EVENT, useUser } from '../contexts/UserContext';
import { refreshStudioSpeakerVoices } from '../src/shared/voices/castAssignment';
import { getEngineDisplayName } from '../services/engineDisplay';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson, readStorageString, removeStorageKey, writeStorageJson, writeStorageString } from '../src/shared/storage/localStore';
import { UI_BRAND_THEME_CONFIGS, UI_BRAND_THEME_ORDER, type UiBrandThemeId } from '../src/shared/theme/brandThemes';
import { applyBrandThemeToDocument, applyThemeModeToDocument } from '../src/shared/theme/themeDom';
import { EngineRuntimeStrip } from '../components/EngineRuntimeStrip';
import { ProofreadCluster } from '../components/ProofreadCluster';
import { StudioTranslateBar } from '../components/StudioTranslateBar';
import { SectionCard } from '../components/SectionCard';
import { BrandLogo } from '../components/BrandLogo';
import { MorphingGenerateButton } from '../components/studio/MorphingGenerateButton';
import { DirectorPreview } from '../components/studio/DirectorPreview';
import { normalizeDirectorPreviewComparisonText } from '../components/studio/directorPreviewDiff';
import { TelemetrySparkline } from '../components/ui/TelemetrySparkline';
import { buildWorkspaceTabs, resolveWorkspaceNextPreloadTab, WORKSPACE_NAV_SECTION_LABELS, WorkspaceTab as Tab } from '../src/features/workspace/model/tabs';
import { useBillingActions } from '../src/features/billing/hooks/useBillingActions';
import { cancelTtsJob, createTtsJob, fetchTtsEngineLatency, fetchTtsEnginesStatus, getTtsJob } from '../src/shared/api/gatewayClient';
import { getDefaultApiBaseUrl, sanitizeConfiguredApiBaseUrl } from '../src/shared/api/config';
import { applySafeMediaVolume, normalizeMediaVolume } from '../src/shared/media/safeMediaVolume';
import { useWorkspaceViewport } from '../src/shared/ui/useWorkspaceViewport';
import { useManagedTabs } from '../src/shared/ui/tabs';
import {
  createRuntimePollTabId,
  isRuntimePollCoordinationAvailable,
  readRuntimePollSnapshot,
  releaseRuntimePollLeadership,
  renewRuntimePollLeadership,
  RUNTIME_POLL_LEADER_KEY,
  RUNTIME_POLL_SNAPSHOT_KEY,
  writeRuntimePollSnapshot,
} from '../src/shared/runtime/runtimePollCoordinator';
import { resolveRuntimePollMode } from '../src/shared/runtime/runtimePollScheduler';
import {
  normalizeAssistantProviderControlsEnabled,
  normalizePreferUserGeminiKey,
} from '../src/shared/settings/assistantProvider';
import { hasAdminConsoleAccess as canUseAdminConsole } from '../src/shared/auth/adminAccess';
import { formatFrontendError, type FrontendErrorContext } from '../src/shared/errors/formatFrontendError';
import { joinUiFragments, sanitizeUiText } from '../src/shared/ui/terminology';
import { useNotifications } from '../src/shared/notifications/NotificationProvider';
import { NOTIFICATION_DEEP_LINK_EVENT, readNotificationDeepLink } from '../src/shared/notifications/deepLink';
import { reportFrontendSignal } from '../src/shared/telemetry/frontendErrors';
import { fetchAccountProfile, type TokenPackKey } from '../services/accountService';
import { firebaseAuth } from '../services/firebaseClient';
import { extractNovelTextFromFile } from '../services/novelImportService';
import {
  type AdminOpsTab,
  COUNTRY_TAG_BY_NAME,
  TOKEN_PACK_MATRIX,
  STUDIO_SPEECH_GAIN_MAX,
  STUDIO_SPEECH_GAIN_MIN,
  SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT,
  applyTokenPackDiscount,
  appendRollingSample,
  createDubbingClip,
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
  resolveMediaBackendUrl,
  normalizePlanToken,
  PRIME_ACCESS_LOCK_MESSAGE,
  resolveSpeakerMappedVoiceId,
  resolveStudioMusicGain,
  resolveStudioSpeechGain,
  resolvePrimeAllowedEngines,
  resolveWorkspaceRoutePath,
  resolveWorkspaceTabFromPathname,
  runDubbingEditorTool,
  shouldRefreshSelectedEngineTelemetry,
} from './mainAppHelpers';
import {
  canUseStudioQueue,
  computeStudioQueueMasterOrder,
  createStudioQueueState,
  hashStudioQueueSource,
  normalizeStoredStudioQueueState,
} from '../src/features/studio/model/queue';
import {
  STUDIO_RAIL_TAB_ITEMS,
  getStudioCreditsActionState,
  resolveSidebarMode,
  resolveStudioRailTab,
  type SidebarMode,
  type StudioRailTab,
} from '../src/features/studio/model/layout';
import {
  clearStudioQueueAudioCache,
  deleteStudioQueueAudioBlob,
  readStudioQueueAudioBlob,
  storeStudioQueueAudioBlob,
} from '../services/studioQueueCacheService';
import { createStudioObjectUrlRegistry } from '../services/studioObjectUrlRegistry';
import { audioBufferToWav } from '../src/shared/audio/wav';
import { getSharedAudioContext as getAudioContext } from '../src/shared/audio/audioContext';
import { hydrateRuntimeStatusSnapshot } from '../src/shared/runtime/runtimeStatusHydration';
import {
  BACKEND_ROUTING_APPLIED_EVENT,
  applyNearestBackendRoutingOnLogin,
  clearNearestBackendRoutingState,
  primeLoginTtsSessionKey,
} from '../services/backendRoutingService';
import { resolveHistoryVoiceLabel } from '../src/shared/voices/historyVoiceLabel';
import type { EngineRuntimeUiState, EngineRuntimeUiStatus } from '../services/runtimeStatusMapping';
import { createSynthesisTraceId } from '../services/synthesisContractService';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../src/app/navigation';
import type { VoiceCloneModalResult } from '../src/features/voice-cloning/VoiceCloneModal';
import { applyMotionLevelToDocument } from '../src/shared/theme/themeDom';

const TTS_RUNTIME_STATUS_EVENT = 'voiceflow:tts-runtime-status';

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

const DEFAULT_STUDIO_DIRECTOR_MODE_STATE: StudioDirectorModeState = {
  expressiveEmotion: false,
  autoRewrite: false,
};

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

const normalizeRuntimeToken = (value: unknown): string => String(value || '').trim();

const formatRuntimeServerLabel = (status: Partial<EngineRuntimeUiStatus> | null | undefined): string => {
  if (!status || typeof status !== 'object') return '';
  const locationLabel = (
    normalizeRuntimeToken(status.selectedRegion) ||
    normalizeRuntimeToken(status.cloudTtsLocation) ||
    normalizeRuntimeToken(status.vertexLocation) ||
    normalizeRuntimeToken(status.regionHint)
  ).replace(/_/g, '-');
  if (locationLabel) return locationLabel;
  const token = normalizeRuntimeToken(status.runtimeUrl || status.healthUrl);
  if (!token) return '';
  try {
    return new URL(token).host || token;
  } catch {
    return token.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || token;
  }
};

const formatRuntimeMetadataSummary = (status: Partial<EngineRuntimeUiStatus> | null | undefined): string => {
  if (!status || typeof status !== 'object') return '';
  const provider = normalizeRuntimeToken(status.provider);
  const lane = normalizeRuntimeToken(status.lane);
  const server = formatRuntimeServerLabel(status);
  const modelId = normalizeRuntimeToken(status.modelId);
  return [provider, lane, server, modelId].filter(Boolean).join(' / ');
};

const mapGatewayEngineRuntimeToUiStatus = (engineItem: unknown): EngineRuntimeUiStatus => {
  if (!engineItem || typeof engineItem !== 'object') {
    return { state: 'offline', detail: 'Gateway did not return runtime status.' };
  }
  const candidate = engineItem as Record<string, unknown> & {
    ready?: unknown;
    capabilities?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  };
  const capabilities = candidate.capabilities && typeof candidate.capabilities === 'object' && !Array.isArray(candidate.capabilities)
    ? candidate.capabilities
    : null;
  const metadata = candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
    ? candidate.metadata
    : null;
  const metadataSource = capabilities?.metadata && typeof capabilities.metadata === 'object' && !Array.isArray(capabilities.metadata)
    ? capabilities.metadata
    : metadata || capabilities || candidate;
  const stateToken = normalizeEngineRuntimeState(candidate.state, 'offline');
  const runtimeReady = typeof candidate.ready === 'boolean' ? candidate.ready : stateToken === 'online';
  const detail = String(candidate.detail || 'Runtime status updated.') || 'Runtime status updated.';
  const standbyHint = Boolean((metadataSource as Record<string, unknown>).standby);
  const mappedState: EngineRuntimeUiState =
    stateToken === 'not_configured' ? 'not_configured' :
    stateToken === 'warming' && standbyHint ? 'standby' :
    stateToken === 'warming' ? 'starting' :
    (stateToken === 'starting' || (stateToken === 'online' && !runtimeReady)) ? 'starting' :
    stateToken === 'online' ? 'online' :
    (stateToken === 'standby' || (stateToken === 'offline' && standbyHint)) ? 'standby' :
    'offline';
  return {
    state: mappedState,
    detail,
    provider: normalizeRuntimeToken((metadataSource as Record<string, unknown>).provider),
    lane: normalizeRuntimeToken((metadataSource as Record<string, unknown>).lane),
    selectedRegion: normalizeRuntimeToken((metadataSource as Record<string, unknown>).selectedRegion),
    modelId: normalizeRuntimeToken((metadataSource as Record<string, unknown>).modelId),
    runtimeUrl: normalizeRuntimeToken((metadataSource as Record<string, unknown>).runtimeUrl),
    healthUrl: normalizeRuntimeToken((metadataSource as Record<string, unknown>).healthUrl),
    cloudTtsLocation: normalizeRuntimeToken((metadataSource as Record<string, unknown>).cloudTtsLocation),
    vertexLocation: normalizeRuntimeToken((metadataSource as Record<string, unknown>).vertexLocation),
    regionHint: normalizeRuntimeToken((metadataSource as Record<string, unknown>).regionHint),
    regionSource: normalizeRuntimeToken((metadataSource as Record<string, unknown>).regionSource),
  };
};

const loadStudioMixService = (() => {
  let cached: Promise<typeof import('../services/studioMixService')> | null = null;
  return () => {
    cached ??= import('../services/studioMixService');
    return cached;
  };
})();
const REMOVED_DUBBING_FEATURE_MESSAGE = 'Video dubbing services have been removed from this build.';
const reportRemovedDubbingFeature = (feature: string) => {
  console.warn(`[MainApp] ${feature} requested, but ${REMOVED_DUBBING_FEATURE_MESSAGE}`);
};
type RemovedDubbingTimelineUndoRedo = {
  past: DubbingClip[][];
  current: DubbingClip[];
  future: DubbingClip[][];
  changed: boolean;
};
type RemovedDubbingTimelineService = {
  removeClip: (clips: DubbingClip[], clipId: string) => { clips: DubbingClip[]; removed: DubbingClip | null };
  removeCompletedClips: (clips: DubbingClip[]) => DubbingClip[];
  clearAllClips: () => DubbingClip[];
  undoTimeline: (past: DubbingClip[][], current: DubbingClip[], future: DubbingClip[][]) => RemovedDubbingTimelineUndoRedo;
  redoTimeline: (past: DubbingClip[][], current: DubbingClip[], future: DubbingClip[][]) => RemovedDubbingTimelineUndoRedo;
  copyClip: (clips: DubbingClip[], clipId: string) => DubbingClipboard | null;
  pasteClipAfterSelection: (
    clips: DubbingClip[],
    selectedClipId: string,
    clipboard: DubbingClipboard | null
  ) => { clips: DubbingClip[]; pastedId: string | null };
  cutClip: (clips: DubbingClip[], clipId: string) => { clips: DubbingClip[]; removed: DubbingClip | null };
  splitClipAtPlayhead: (
    clips: DubbingClip[],
    clipId: string,
    playheadMs: number
  ) => { clips: DubbingClip[]; splitIds: [string, string] | null };
  trimClipWindow: (
    clips: DubbingClip[],
    clipId: string,
    options: { trimInMs?: number; trimOutMs?: number }
  ) => DubbingClip[];
  moveClipLayer: (clips: DubbingClip[], clipId: string, layer: DubbingClip['layer']) => DubbingClip[];
};
type RemovedDubbingStemPack = {
  fullMix: AudioBuffer;
  speechStem: AudioBuffer;
  backgroundStem: AudioBuffer;
  speechStemBlob: Blob;
  backgroundStemBlob: Blob;
  duration: number;
};
type RemovedDubbingService = {
  extractAndSeparateDubbingStems: (
    file: File,
    options?: { backendUrl?: string; preferBackendModel?: boolean; onStatus?: (message: string) => void }
  ) => Promise<RemovedDubbingStemPack>;
};
const loadDubbingTimelineService = (() => {
  let cached: Promise<RemovedDubbingTimelineService> | null = null;
  return () => {
    cached ??= Promise.resolve({
      removeClip: (clips, clipId) => {
        reportRemovedDubbingFeature('Timeline clip remove');
        const index = clips.findIndex((clip) => clip.id === clipId);
        if (index < 0) return { clips, removed: null };
        return { clips: [...clips.slice(0, index), ...clips.slice(index + 1)], removed: clips[index] ?? null };
      },
      removeCompletedClips: (clips) => {
        reportRemovedDubbingFeature('Timeline remove completed');
        return clips.filter((clip) => clip.status !== 'completed');
      },
      clearAllClips: () => {
        reportRemovedDubbingFeature('Timeline clear queue');
        return [];
      },
      undoTimeline: (past, current, future) => {
        reportRemovedDubbingFeature('Timeline undo');
        return { past, current, future, changed: false };
      },
      redoTimeline: (past, current, future) => {
        reportRemovedDubbingFeature('Timeline redo');
        return { past, current, future, changed: false };
      },
      copyClip: (_clips, _clipId) => {
        reportRemovedDubbingFeature('Timeline copy');
        return null;
      },
      pasteClipAfterSelection: (clips, _selectedClipId, _clipboard) => {
        reportRemovedDubbingFeature('Timeline paste');
        return { clips, pastedId: null };
      },
      cutClip: (clips, clipId) => {
        reportRemovedDubbingFeature('Timeline cut');
        const index = clips.findIndex((clip) => clip.id === clipId);
        if (index < 0) return { clips, removed: null };
        return { clips: [...clips.slice(0, index), ...clips.slice(index + 1)], removed: clips[index] ?? null };
      },
      splitClipAtPlayhead: (clips, _clipId, _playheadMs) => {
        reportRemovedDubbingFeature('Timeline split');
        return { clips, splitIds: null };
      },
      trimClipWindow: (clips, _clipId, _options) => {
        reportRemovedDubbingFeature('Timeline trim');
        return clips;
      },
      moveClipLayer: (clips, _clipId, _layer) => {
        reportRemovedDubbingFeature('Timeline layer move');
        return clips;
      },
    });
    return cached;
  };
})();

const cloneDubbingTimelineSnapshot = (clips: DubbingClip[]): DubbingClip[] => clips.map((clip) => ({ ...clip }));
const pushDubbingTimelineHistory = (
  past: DubbingClip[][],
  current: DubbingClip[],
  maxEntries: number = 40
): DubbingClip[][] => {
  const next = [...past, cloneDubbingTimelineSnapshot(current)];
  if (next.length <= maxEntries) return next;
  return next.slice(next.length - maxEntries);
};

const loadAdminTabContent = () => import('../src/features/admin/components/AdminTabContent');
const loadNovelTabContent = () => import('../src/features/novel/components/NovelTabContent');
const loadReaderTabContent = () => import('../src/features/reader/components/ReaderTabContent');
const loadVoiceCloningTabContent = () => import('../src/features/voice-cloning/VoiceCloningTabContent');
const loadAudioPlayer = () => import('../components/AudioPlayer');
const LazyBlockScriptEditor = lazy(async () => {
  const module = await import('../components/studio/BlockScriptEditor');
  return { default: module.BlockScriptEditor };
});
const LazyStudioQueuePanel = lazy(async () => {
  const module = await import('../components/studio/StudioQueuePanel');
  return { default: module.StudioQueuePanel };
});
const loadDubbingService = (() => {
  let cached: Promise<RemovedDubbingService> | null = null;
  return () => {
    cached ??= Promise.resolve({
      extractAndSeparateDubbingStems: async (_file, options) => {
        reportRemovedDubbingFeature('Stem extraction');
        options?.onStatus?.('Video dubbing service removed from this build.');
        throw new Error(REMOVED_DUBBING_FEATURE_MESSAGE);
      },
    });
    return cached;
  };
})();
const loadStudioQueueAudioService = (() => {
  let cached: Promise<typeof import('../services/studioQueueAudioService')> | null = null;
  return () => {
    cached ??= import('../services/studioQueueAudioService');
    return cached;
  };
})();
const loadTtsVoiceRegistryService = (() => {
  let cached: Promise<typeof import('../services/ttsVoiceRegistryService')> | null = null;
  return () => {
    cached ??= import('../services/ttsVoiceRegistryService');
    return cached;
  };
})();
const loadMediaBackendService = (() => {
  let cached: Promise<typeof import('../services/mediaBackendService')> | null = null;
  return () => {
    cached ??= import('../services/mediaBackendService');
    return cached;
  };
})();
const loadTtsGatewayJobService = (() => {
  let cached: Promise<typeof import('../services/ttsGatewayJobService')> | null = null;
  return () => {
    cached ??= import('../services/ttsGatewayJobService');
    return cached;
  };
})();

export const findFirstRecoverableStudioQueueItem = (items: StudioQueueItem[]): StudioQueueItem | null => (
  [...items]
    .sort((left, right) => left.order - right.order)
    .find((item) => item.status === 'failed' || item.status === 'cancelled') || null
);

const normalizeStoredSingleInflightGenerationLedger = (
  value: unknown
): StudioSingleInflightGenerationLedger | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StudioSingleInflightGenerationLedger>;
  if (candidate.mode !== 'single') return null;
  const requestId = String(candidate.requestId || '').trim();
  const jobId = String(candidate.jobId || '').trim();
  if (!requestId && !jobId) return null;
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
const ReaderTabContent = lazy(async () => loadReaderTabContent().then((module) => ({ default: module.ReaderTabContent })));
const VoiceCloningTabContent = lazy(async () => loadVoiceCloningTabContent().then((module) => ({ default: module.VoiceCloningTabContent })));
const VoiceCloneModal = lazy(async () => import('../src/features/voice-cloning/VoiceCloneModal').then((module) => ({ default: module.VoiceCloneModal })));
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
const ENABLE_STUDIO_READER_PRELOAD = readBooleanEnv(process.env.NEXT_PUBLIC_STUDIO_PRELOAD_READER ?? process.env.VITE_STUDIO_PRELOAD_READER, false);

const TAB_PRELOADERS: Partial<Record<Tab, () => Promise<unknown>>> = {
  [Tab.ADMIN]: loadAdminTabContent,
  [Tab.NOVEL]: loadNovelTabContent,
  [Tab.VOICE_CLONING]: loadVoiceCloningTabContent,
  ...(ENABLE_STUDIO_READER_PRELOAD ? { [Tab.READER]: loadReaderTabContent } : {}),
};

const loadGeminiService = (() => {
  let cached: Promise<typeof import('../services/geminiService')> | null = null;
  return () => {
    cached ??= import('../services/geminiService');
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
type UiDensity = 'comfortable' | 'compact';
type UiMotionLevel = 'off' | 'balanced' | 'rich';
type EngineRuntimeState = EngineRuntimeUiState;

const UI_FONT_SCALE_DEFAULT = 1;

const STUDIO_OBJECT_URL_REGISTRY_MAX = 64;
const STUDIO_SINGLE_RUN_CHAR_CAP = 8000;
const STUDIO_EDITOR_HARD_CAP = 50000;
const STUDIO_QUEUE_INTER_PART_DELAY_MS = 3000;
const TRANSIENT_GENERATION_RETRY_MAX = 1;
const TRANSIENT_GENERATION_RETRY_DELAY_MS = 700;
const SINGLE_INFLIGHT_AUTO_RESUME_MAX_AGE_MS = 10 * 60 * 1000;
const GENERATION_STALL_TIMEOUT_MS = 90000;
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

const createInitialSelectedEngineTelemetry = (): Record<GenerationSettings['engine'], SelectedEngineTelemetry> => ({
  PRIME: createSelectedEngineTelemetry(),
  VECTOR: createSelectedEngineTelemetry(),
  DUNO: createSelectedEngineTelemetry(),
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

interface CachedDubbingStems {
  key: string;
  speechFile: File;
  backgroundBuffer: AudioBuffer;
  speechObjectUrl: string;
  backgroundObjectUrl: string;
  duration: number;
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

type DubbingPhase = 'idle' | 'running' | 'error' | 'done';

interface DubbingUiState {
  phase: DubbingPhase;
  progress: number;
  stage: string;
  error: string;
  updatedAt: number;
}

const ENGINE_ORDER: GenerationSettings['engine'][] = ['DUNO', 'VECTOR', 'PRIME'];
const FALLBACK_RUNTIME_URLS: Record<GenerationSettings['engine'], string> = {
  PRIME: 'http://127.0.0.1:7810',
  VECTOR: 'http://127.0.0.1:7810',
  DUNO: 'http://127.0.0.1:7840',
};
const DEFAULT_MEDIA_BACKEND_URL = getDefaultApiBaseUrl();
const readPositiveIntEnv = (value: unknown, fallback: number): number => { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed <= 0) return fallback; return Math.floor(parsed); };
const RUNTIME_STATUS_ACTIVE_POLL_MS = readPositiveIntEnv(process.env.NEXT_PUBLIC_RUNTIME_STATUS_ACTIVE_POLL_MS ?? process.env.VITE_RUNTIME_STATUS_ACTIVE_POLL_MS, 3000);
const RUNTIME_STATUS_LATENCY_TIMEOUT_MS = readPositiveIntEnv(process.env.NEXT_PUBLIC_RUNTIME_STATUS_LATENCY_TIMEOUT_MS ?? process.env.VITE_RUNTIME_STATUS_LATENCY_TIMEOUT_MS, 5000);
const RUNTIME_STATUS_COOLDOWN_POLL_MS = readPositiveIntEnv(process.env.NEXT_PUBLIC_RUNTIME_STATUS_COOLDOWN_POLL_MS ?? process.env.VITE_RUNTIME_STATUS_COOLDOWN_POLL_MS, 60000);
const RUNTIME_STATUS_COOLDOWN_WINDOW_MS = readPositiveIntEnv(process.env.NEXT_PUBLIC_RUNTIME_STATUS_COOLDOWN_WINDOW_MS ?? process.env.VITE_RUNTIME_STATUS_COOLDOWN_WINDOW_MS, 120000);
const RUNTIME_STATUS_LEADER_HEARTBEAT_MS = 10000;
const RUNTIME_STATUS_LEADER_LEASE_MS = 40000;
const EMPTY_RUNTIME_CATALOG: Record<GenerationSettings['engine'], VoiceOption[]> = { PRIME: [], VECTOR: [], DUNO: [] };
const DEFAULT_GEM_VOICE_ID = VOICES[0]?.id ?? 'gem_default_voice';
const DEFAULT_DUNO_VOICE_ID = DUNO_VOICES[0]?.id ?? DEFAULT_GEM_VOICE_ID;
const BUILT_IN_VOICE_IDS = new Set([...VOICES.map((voice) => voice.id), ...DUNO_VOICES.map((voice) => voice.id)]);
const FREE_TIER_ALLOWED_VOICE_IDS: Record<GenerationSettings['engine'], string[]> = {
  PRIME: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  VECTOR: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  DUNO: ['af_heart', 'af_bella', 'af_nova', 'af_sarah', 'am_fenrir', 'am_michael', 'am_onyx', 'am_echo', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_fable', 'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi'],
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
  mediaBackendUrl: DEFAULT_MEDIA_BACKEND_URL,
  backendApiKey: '',
  voiceModel: '',
  geminiTtsServiceUrl: FALLBACK_RUNTIME_URLS.PRIME,

  musicTrackId: 'm_none',
  musicVolume: 0.3,
  speechVolume: 1.0,
  autoEnhance: true,
  useModelSourceSeparation: true,
  preserveDubVoiceTone: false,
  dubbingSourceLanguage: 'auto',
  multiSpeakerEnabled: true,
  speakerMapping: {},
  uiMotionLevel: 'off',
  autoPlayGeneratedAudio: true,
};

const normalizeServiceSetting = (value: unknown, fallback: string): string => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const normalizeSettings = (input: unknown): GenerationSettings => {
  const value = (input && typeof input === 'object') ? input as Record<string, any> : {};
  const engine = normalizeEngineToken(value.engine, DEFAULT_SETTINGS.engine);
  const defaultVoice = engine === 'DUNO'
    ? DEFAULT_DUNO_VOICE_ID
    : DEFAULT_GEM_VOICE_ID;
  const rawMediaBackendUrl = typeof value.mediaBackendUrl === 'string' ? value.mediaBackendUrl : '';
  const mediaBackendSanitized = sanitizeConfiguredApiBaseUrl(rawMediaBackendUrl, DEFAULT_MEDIA_BACKEND_URL);

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
    musicTrackId: typeof value.musicTrackId === 'string' ? value.musicTrackId : DEFAULT_SETTINGS.musicTrackId,
    musicVolume: resolveStudioMusicGain(value.musicVolume),
    speechVolume: resolveStudioSpeechGain(value.speechVolume),
    useModelSourceSeparation: typeof value.useModelSourceSeparation === 'boolean'
      ? value.useModelSourceSeparation
      : DEFAULT_SETTINGS.useModelSourceSeparation,
    preserveDubVoiceTone: typeof value.preserveDubVoiceTone === 'boolean'
      ? value.preserveDubVoiceTone
      : DEFAULT_SETTINGS.preserveDubVoiceTone,
    dubbingSourceLanguage: typeof value.dubbingSourceLanguage === 'string' && value.dubbingSourceLanguage.trim()
      ? value.dubbingSourceLanguage.trim()
      : DEFAULT_SETTINGS.dubbingSourceLanguage,
    uiMotionLevel:
      value.uiMotionLevel === 'off' || value.uiMotionLevel === 'balanced' || value.uiMotionLevel === 'rich'
        ? value.uiMotionLevel
    : (DEFAULT_SETTINGS.uiMotionLevel || 'off'),
    multiSpeakerEnabled: typeof value.multiSpeakerEnabled === 'boolean'
      ? value.multiSpeakerEnabled
      : DEFAULT_SETTINGS.multiSpeakerEnabled,
    mediaBackendUrl: mediaBackendSanitized.value,
    backendApiKey: typeof value.backendApiKey === 'string' ? value.backendApiKey.trim() : DEFAULT_SETTINGS.backendApiKey,
    voiceModel: typeof value.voiceModel === 'string' ? value.voiceModel : DEFAULT_SETTINGS.voiceModel,
    geminiTtsServiceUrl: normalizeServiceSetting(value.geminiTtsServiceUrl, DEFAULT_SETTINGS.geminiTtsServiceUrl || FALLBACK_RUNTIME_URLS.PRIME),
    autoPlayGeneratedAudio: typeof value.autoPlayGeneratedAudio === 'boolean'
      ? value.autoPlayGeneratedAudio
      : (DEFAULT_SETTINGS.autoPlayGeneratedAudio !== false),
  };

  const validVoiceIds = new Set([
    ...VOICES.map(v => v.id),
    ...DUNO_VOICES.map(v => v.id),

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
const ResourceMonitor = ({ isWorking }: { isWorking: boolean }) => {
  const [stats, setStats] = useState({
    cpu: 0,
    ram: 0,
    cpuHistory: Array(20).fill(4) as number[],
    ramHistory: Array(20).fill(0) as number[],
  });

  useEffect(() => {
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
  }, [isWorking]);

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
    drafts,
    saveDraft,
    deleteDraft,
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

    const syncViewportHeight = () => {
      setViewportHeight(Math.max(0, Math.round(window.innerHeight || 0)));
    };

    syncViewportHeight();
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', syncViewportHeight);
    return () => {
      window.removeEventListener('resize', syncViewportHeight);
      window.removeEventListener('orientationchange', syncViewportHeight);
    };
  }, []);

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
  const [text, setText] = useState<string>(() => resolveInitialStudioDraftText(STUDIO_EDITOR_HARD_CAP));
  
  // Settings State
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    const saved = readStorageJson(STORAGE_KEYS.settings);
    return normalizeSettings(saved || DEFAULT_SETTINGS);
  });
  const mediaBackendUrl = resolveMediaBackendUrl(settings);
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
  useEffect(() => {
    const onBackendRoutingApplied = (event: Event) => {
      const custom = event as CustomEvent<{ baseUrl?: string }>;
      const nextBaseUrl = String(custom?.detail?.baseUrl || '').trim();
      if (!nextBaseUrl) return;
      setSettings((prev) => {
        const currentBase = sanitizeConfiguredApiBaseUrl(
          String(prev.mediaBackendUrl || ''),
          DEFAULT_MEDIA_BACKEND_URL
        ).value;
        const nextBase = sanitizeConfiguredApiBaseUrl(nextBaseUrl, DEFAULT_MEDIA_BACKEND_URL).value;
        if (currentBase === nextBase) return prev;
        return { ...prev, mediaBackendUrl: nextBase };
      });
    };
    window.addEventListener(BACKEND_ROUTING_APPLIED_EVENT, onBackendRoutingApplied as EventListener);
    return () => {
      window.removeEventListener(BACKEND_ROUTING_APPLIED_EVENT, onBackendRoutingApplied as EventListener);
    };
  }, []);

  // Generation Status State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [processingStage, setProcessingStage] = useState('');
  const [generationTiming, setGenerationTiming] = useState<GenerationTimingSnapshot | null>(null);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [liveAudioChunks, setLiveAudioChunks] = useState<LiveAudioChunkItem[]>([]);
  const [studioQueueState, setStudioQueueState] = useState<StudioQueueState | null>(() => (
    normalizeStoredStudioQueueState(readStorageJson(STORAGE_KEYS.studioQueue))
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
  const activeGatewayRequestIdRef = useRef<string>('');
  const activeGatewayJobIdRef = useRef<string>('');
  const singleInflightLedgerRef = useRef<StudioSingleInflightGenerationLedger | null>(
    normalizeStoredSingleInflightGenerationLedger(readStorageJson(STORAGE_KEYS.studioSingleInflightGeneration))
  );
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
  const lastRuntimeStatesRef = useRef<Record<GenerationSettings['engine'], EngineRuntimeState>>({
    PRIME: 'checking',
    VECTOR: 'checking',
    DUNO: 'checking',
  });
  const lastBackendHealthyRef = useRef<boolean | null>(null);
  const quotaNoticeRef = useRef<Record<string, boolean>>({});
  const studioTextHardCapNoticeAtRef = useRef(0);
  const ttsAccessProbeRef = useRef<RuntimeAccessProbe | null>(null);
  const ttsAccessProbeInFlightRef = useRef<Promise<RuntimeAccessProbe> | null>(null);
  const ttsAccessProbeAbortControllerRef = useRef<AbortController | null>(null);
  const lastTtsAccessBlockedRef = useRef<boolean | null>(null);
  const ttsAccessClockRetryAtRef = useRef<number>(0);
  const runtimeAutoSelectProbeInFlightRef = useRef(false);
  
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
  const [uiDensity, setUiDensity] = useState<UiDensity>(() => {
    const saved = readStorageString(STORAGE_KEYS.uiDensity);
    return saved === 'comfortable' ? 'comfortable' : 'compact';
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
  const patchSingleInflightGenerationLedger = useCallback((
    patch: Partial<StudioSingleInflightGenerationLedger>
  ): StudioSingleInflightGenerationLedger | null => {
    const current = singleInflightLedgerRef.current;
    const requestId = String(patch.requestId ?? current?.requestId ?? '').trim();
    const jobId = String(patch.jobId ?? current?.jobId ?? '').trim();
    const textSnapshot = String(patch.textSnapshot ?? current?.textSnapshot ?? '');
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
    return DEFAULT_SETTINGS.uiMotionLevel || 'off';
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

  // --- Video Dubbing State ---
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [dubScript, setDubScript] = useState('');
  const [dubbingClips, setDubbingClips] = useState<DubbingClip[]>([]);
  const [selectedDubbingClipId, setSelectedDubbingClipId] = useState('');
  const [dubbingClipboard, setDubbingClipboard] = useState<DubbingClipboard | null>(null);
  const [dubbingHistoryPast, setDubbingHistoryPast] = useState<DubbingClip[][]>([]);
  const [dubbingHistoryFuture, setDubbingHistoryFuture] = useState<DubbingClip[][]>([]);
  const [dubbingCpuProfile, setDubbingCpuProfile] = useState<CpuDubbingProfile>('cpu_quality');
  const [isDubbingAdvancedOpen, setIsDubbingAdvancedOpen] = useState(false);
  const [dubbingPlayheadMs, setDubbingPlayheadMs] = useState(0);
  const [dubAudioUrl, setDubAudioUrl] = useState<string | null>(null);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [isPlayingDub, setIsPlayingDub] = useState(false);
  const [isVideoPipelineGuideOpen, setIsVideoPipelineGuideOpen] = useState(false);
  const [dubbingJobResultUrl, setDubbingJobResultUrl] = useState<string | null>(null);
  const [dubbingReportUrl, setDubbingReportUrl] = useState<string | null>(null);
  // Mixing
  const [videoVolume, setVideoVolume] = useState(1.0);
  const [dubVolume, setDubVolume] = useState(1.0);
  const [renderedDubVideoUrl, setRenderedDubVideoUrl] = useState<string | null>(null);

  // --- Real Media Backend State (Voice Transfer + Video Tools) ---
  const [backendHealth, setBackendHealth] = useState<BackendHealthState | null>(null);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);
  const [dubbingUiState, setDubbingUiState] = useState<DubbingUiState>({
      phase: 'idle',
      progress: 0,
      stage: 'Waiting for source file',
      error: '',
      updatedAt: Date.now(),
  });

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
  }, [speakerVcReferenceOwnerKey]);

  const [characterModalOpen, setCharacterModalOpen] = useState(false);
  const [editingChar, setEditingChar] = useState<CharacterProfile | null>(null);
  const [charForm, setCharForm] = useState<CharacterProfile>({
      id: '', name: '', voiceId: DEFAULT_GEM_VOICE_ID, gender: 'Unknown', age: 'Adult', avatarColor: '#6366f1'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const dubAudioRef = useRef<HTMLAudioElement>(null);
  const dubbingStemsRef = useRef<CachedDubbingStems | null>(null);
  const activeDubbingJobIdRef = useRef<string>('');
  const dubbingLiveAudioRef = useRef<HTMLAudioElement | null>(null);
  const dubbingLiveChunkUrlsRef = useRef<string[]>([]);
  const dubbingLiveQueueRef = useRef<string[]>([]);
  const dubbingLiveSeenChunkKeysRef = useRef<Set<string>>(new Set());
  const dubbingLiveChunkCursorRef = useRef<number>(0);
  const progressTimerRef = useRef<any>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const studioMainRef = useRef<HTMLDivElement>(null);
  const creditsSurfaceRef = useRef<HTMLDivElement>(null);
  const creditsSurfaceTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedDubbingClip = useMemo(
    () => dubbingClips.find((clip) => clip.id === selectedDubbingClipId) || null,
    [dubbingClips, selectedDubbingClipId]
  );

  const mutateDubbingTimeline = useCallback(
    (mutator: (current: DubbingClip[]) => DubbingClip[]) => {
      setDubbingClips((current) => {
        const next = mutator(current);
        if (next === current) return current;
        setDubbingHistoryPast((past) => pushDubbingTimelineHistory(past, current));
        setDubbingHistoryFuture([]);
        return next;
      });
    },
    []
  );

  const syncSelectedClipPatch = useCallback(
    (patch: Partial<DubbingClip>) => {
      if (!selectedDubbingClipId) return;
      setDubbingClips((current) =>
        current.map((clip) => (clip.id === selectedDubbingClipId ? { ...clip, ...patch } : clip))
      );
    },
    [selectedDubbingClipId]
  );

  const resolveClipDurationMs = useCallback(async (file: File): Promise<number> => {
    if (typeof document === 'undefined') return 0;
    return new Promise((resolve) => {
      const probe = document.createElement('video');
      const objectUrl = URL.createObjectURL(file);
      const cleanup = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {}
      };
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        const durationSec = Number(probe.duration || 0);
        cleanup();
        resolve(Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 1000) : 0);
      };
      probe.onerror = () => {
        cleanup();
        resolve(0);
      };
      probe.src = objectUrl;
    });
  }, []);

  useEffect(() => {
    if (dubbingClips.length <= 0) {
      if (selectedDubbingClipId) setSelectedDubbingClipId('');
      return;
    }
    const selectedExists = dubbingClips.some((clip) => clip.id === selectedDubbingClipId);
    if (!selectedExists) {
      setSelectedDubbingClipId(dubbingClips[0]?.id || '');
    }
  }, [dubbingClips, selectedDubbingClipId]);

  useEffect(() => {
    if (!selectedDubbingClip) {
      setVideoFile(null);
      setVideoUrl(null);
      setDubScript('');
      setDubAudioUrl(null);
      return;
    }
    setVideoFile(selectedDubbingClip.file);
    setVideoUrl(selectedDubbingClip.objectUrl);
    setDubScript(selectedDubbingClip.script || '');
    setDubbingPlayheadMs((current) =>
      Math.max(selectedDubbingClip.trimInMs, Math.min(current, selectedDubbingClip.trimOutMs))
    );
    const selectedResultUrl = selectedDubbingClip.resultUrl ? String(selectedDubbingClip.resultUrl) : null;
    setDubAudioUrl(selectedResultUrl);
  }, [selectedDubbingClip]);

  useEffect(() => {
    if (!selectedDubbingClipId) return;
    setDubbingClips((current) =>
      current.map((clip) => {
        if (clip.id !== selectedDubbingClipId) return clip;
        if ((clip.script || '') === dubScript) return clip;
        return { ...clip, script: dubScript };
      })
    );
  }, [dubScript, selectedDubbingClipId]);

  // --- PREVIEW STATE ---
  const [previewState, setPreviewState] = useState<{ id: string, status: 'loading' | 'playing' } | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [engineSwitchInProgress, setEngineSwitchInProgress] = useState<GenerationSettings['engine'] | null>(null);
  const [managedActiveEngine, setManagedActiveEngine] = useState<GenerationSettings['engine'] | null>(null);
  const [ttsRuntimeStatus, setTtsRuntimeStatus] = useState<Record<GenerationSettings['engine'], EngineRuntimeStatus>>({
    PRIME: { state: 'checking', detail: 'Checking...' },
    VECTOR: { state: 'checking', detail: 'Checking...' },
    DUNO: { state: 'checking', detail: 'Checking...' },
  });
  const ttsRuntimeStatusRef = useRef(ttsRuntimeStatus);
  const [ttsAccessState, setTtsAccessState] = useState<TtsAccessState>({
    blocked: false,
    detail: 'Checking authentication...',
    checkedAt: 0,
  });
  const [runtimePollLeaderVersion, setRuntimePollLeaderVersion] = useState(0);
  const runtimePollTabIdRef = useRef<string>(createRuntimePollTabId());
  const runtimePollIsLeaderRef = useRef(false);
  const runtimePollActiveUntilRef = useRef(0);
  const runtimePollCooldownUntilRef = useRef(0);
  const runtimePollRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const runtimePollWasBusyRef = useRef(false);
  const [selectedEngineTelemetry, setSelectedEngineTelemetry] = useState<Record<GenerationSettings['engine'], SelectedEngineTelemetry>>(
    createInitialSelectedEngineTelemetry
  );
  const [runtimeVoiceCatalogs, setRuntimeVoiceCatalogs] = useState<Record<GenerationSettings['engine'], VoiceOption[]>>(
    EMPTY_RUNTIME_CATALOG
  );

  useEffect(() => {
    ttsRuntimeStatusRef.current = ttsRuntimeStatus;
  }, [ttsRuntimeStatus]);

  const normalizedPlanToken = normalizePlanToken(stats.planName);
  const isPaidBillingPlan = normalizedPlanToken !== 'free';
  const isFreeTierUser = !hasUnlimitedAccess && !isPaidBillingPlan;
  const walletPaidVfBalance = Math.max(0, Number(stats.wallet?.paidVfBalance || 0));
  const primeAllowedEngines: GenerationSettings['engine'][] = useMemo(
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
    Number(stats.wallet?.spendableNowByEngine?.[settings.engine] || 0)
  );
  const canRunDunoWithoutWallet = settings.engine === 'DUNO';
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
    const normalized = toUserFriendlySystemMessage(raw, fallback);
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
  }, [isTokenTimingAuthMessage, toUserFriendlySystemMessage]);
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
      const backendUrl = mediaBackendUrl;
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
          const accountProfile = await fetchAccountProfile(backendUrl, { signal: controller.signal });
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
    [hasSessionIdentity, isAuthOrProfileBlockingMessage, mapTtsAccessBlockReason, mediaBackendUrl, user.email, user.uid]
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
    async (reason: string): Promise<boolean> => {
      if (!hasSessionIdentity) return false;
      const now = Date.now();
      if (backendRoutingRediscoveryInFlightRef.current) return false;
      if ((now - backendRoutingRediscoveryLastAttemptAtRef.current) < 30_000) return false;
      backendRoutingRediscoveryInFlightRef.current = true;
      backendRoutingRediscoveryLastAttemptAtRef.current = now;
      try {
        clearNearestBackendRoutingState();
        const routingResult = await applyNearestBackendRoutingOnLogin();
        void primeLoginTtsSessionKey({
          baseUrl: routingResult.baseUrl || mediaBackendUrl,
          ...(routingResult.regionHint ? { regionHint: routingResult.regionHint } : {}),
          ...(routingResult.regionSource ? { regionSource: routingResult.regionSource } : {}),
        });
        return true;
      } catch (error: unknown) {
        console.warn('[studio.backend_routing_rediscovery]', reason, error);
        return false;
      } finally {
        backendRoutingRediscoveryInFlightRef.current = false;
      }
    },
    [hasSessionIdentity, mediaBackendUrl]
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
      ? formatFrontendError(msg, { context: resolvedContext, isAdmin: hasAdminConsoleAccess })
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
  }, [emit, hasAdminConsoleAccess]);

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
  const patchDubbingUiState = useCallback((patch: Partial<DubbingUiState>) => {
      setDubbingUiState((prev) => ({
          ...prev,
          ...patch,
          progress: Math.max(0, Math.min(100, Number.isFinite(Number(patch.progress)) ? Number(patch.progress) : prev.progress)),
          stage: typeof patch.stage === 'string' && patch.stage.trim() ? sanitizeUiText(patch.stage) : prev.stage,
          error: typeof patch.error === 'string' ? sanitizeUiText(patch.error) : prev.error,
          updatedAt: Date.now(),
      }));
  }, []);
  const resetDubbingLivePlayback = useCallback(() => {
      const player = dubbingLiveAudioRef.current;
      if (player) {
          try {
              player.pause();
              player.src = '';
          } catch {}
      }
      for (const url of dubbingLiveChunkUrlsRef.current) {
          try {
              URL.revokeObjectURL(url);
          } catch {}
      }
      dubbingLiveChunkUrlsRef.current = [];
      dubbingLiveQueueRef.current = [];
      dubbingLiveSeenChunkKeysRef.current = new Set();
      dubbingLiveChunkCursorRef.current = 0;
  }, []);
  const pumpDubbingLivePlayback = useCallback(() => {
      if (typeof Audio === 'undefined') return;
      if (!dubbingLiveAudioRef.current) {
          const player = new Audio();
          player.preload = 'auto';
          player.onended = () => {
              const queue = dubbingLiveQueueRef.current;
              const next = queue.shift();
              if (!next) return;
              player.src = next;
              void player.play().catch(() => undefined);
          };
          dubbingLiveAudioRef.current = player;
      }
      const player = dubbingLiveAudioRef.current;
      if (!player) return;
      if (!player.paused) return;
      const queue = dubbingLiveQueueRef.current;
      const next = queue.shift();
      if (!next) return;
      player.src = next;
      void player.play().catch(() => undefined);
  }, []);
  const enqueueDubbingLiveChunk = useCallback((blob: Blob) => {
      if (!blob || blob.size <= 0) return;
      const url = URL.createObjectURL(blob);
      dubbingLiveChunkUrlsRef.current.push(url);
      dubbingLiveQueueRef.current.push(url);
      pumpDubbingLivePlayback();
  }, [pumpDubbingLivePlayback]);
  const billingActions = useBillingActions({ baseUrl: mediaBackendUrl, returnPath: APP_ROUTE_PATHS.billing });
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
      if (engine === 'DUNO') {
        const backendGateway = normalizeRuntimeUrl(mediaBackendUrl);
        if (backendGateway) return backendGateway;
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

  const getVideoCacheKey = useCallback((file: File): string => {
      return `${file.name}::${file.size}::${file.lastModified}`;
  }, []);

  const clearDubbingStemCache = useCallback(() => {
      if (!dubbingStemsRef.current) return;
      try {
          URL.revokeObjectURL(dubbingStemsRef.current.speechObjectUrl);
          URL.revokeObjectURL(dubbingStemsRef.current.backgroundObjectUrl);
      } catch {
          // ignore cleanup errors
      } finally {
          dubbingStemsRef.current = null;
      }
  }, []);

  const ensureDubbingStemCache = useCallback(async (file: File): Promise<CachedDubbingStems> => {
      const key = getVideoCacheKey(file);
      const cached = dubbingStemsRef.current;
      if (cached && cached.key === key) return cached;

      clearDubbingStemCache();
      const { extractAndSeparateDubbingStems } = await loadDubbingService();
      const stems = await extractAndSeparateDubbingStems(file, {
          backendUrl: mediaBackendUrl,
          preferBackendModel: settings.useModelSourceSeparation !== false,
          onStatus: (message) => {
              setProcessingStage(sanitizeUiText(message));
              patchDubbingUiState({
                  phase: 'running',
                  stage: message,
              });
          },
      });
      const safeBaseName = (file.name || 'video')
          .replace(/\.[^/.]+$/, '')
          .replace(/[^a-z0-9_\-]+/gi, '_')
          .slice(0, 48) || 'video';
      const speechFile = new File([stems.speechStemBlob], `${safeBaseName}_speech_stem.wav`, { type: 'audio/wav' });
      const speechObjectUrl = URL.createObjectURL(stems.speechStemBlob);
      const backgroundObjectUrl = URL.createObjectURL(stems.backgroundStemBlob);

      const nextCache: CachedDubbingStems = {
          key,
          speechFile,
          backgroundBuffer: stems.backgroundStem,
          speechObjectUrl,
          backgroundObjectUrl,
          duration: stems.duration,
      };
      dubbingStemsRef.current = nextCache;
      return nextCache;
  }, [clearDubbingStemCache, getVideoCacheKey, mediaBackendUrl, patchDubbingUiState, settings.useModelSourceSeparation]);

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
      const rawName = String(voice.name || '').trim();
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
      return {
          ...voice,
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
      const fallbackEngine = primeAllowedEngines[0] || 'DUNO';
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
      return 'en';
  }, [detectedLang, inferLanguageFromSample, normalizeLanguageCode, settings.language]);

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
          const bucket = resolveVoiceLanguageBucket(voice);
          if (bucket === 'multi') return true;
          const normalized = normalizeLanguageCode(languageCode);
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
      () => resolveTextLanguageCode(text),
      [resolveTextLanguageCode, text]
  );

  const dubbingTextLanguageCode = useMemo(
      () => resolveTextLanguageCode(dubScript),
      [dubScript, resolveTextLanguageCode]
  );

  const activeScriptLanguageCode =
      false ? dubbingTextLanguageCode : studioTextLanguageCode;

  const studioParsedScript = useMemo(() => parseMultiSpeakerScript(text), [text]);
  const studioCrewTags = useMemo(
      () => (studioParsedScript.crewTagsList || []).filter(Boolean),
      [studioParsedScript]
  );

  const castSpeakers = useMemo(() => {
      const names = new Set<string>();
      const script = false ? dubScript : text;
      if (script.trim()) {
          const parsed = isStudioWorkspaceTab ? studioParsedScript : parseMultiSpeakerScript(script);
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
  }, [detectedSpeakers, dubScript, isStudioWorkspaceTab, studioParsedScript, text]);
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

  const dubbingStatusAppearance = useMemo(() => {
      const darkTheme = resolvedTheme === 'dark';
      if (dubbingUiState.phase === 'running') {
          return {
              badge: 'Generating',
              tone: darkTheme
                ? 'border-indigo-400/45 bg-indigo-500/12 text-indigo-200'
                : 'border-indigo-200 bg-indigo-50 text-indigo-700',
              bar: darkTheme ? 'bg-indigo-400' : 'bg-indigo-500',
              title: 'Generating dub track',
              subtitle: dubbingUiState.stage || 'Processing backend async generation pipeline.',
              progressPct: Math.max(14, Math.min(94, Number(dubbingUiState.progress || 0))),
          };
      }
      if (dubbingUiState.phase === 'error') {
          return {
              badge: 'Retry',
              tone: darkTheme
                ? 'border-rose-400/45 bg-rose-500/12 text-rose-200'
                : 'border-red-200 bg-red-50 text-red-700',
              bar: darkTheme ? 'bg-rose-400' : 'bg-red-500',
              title: 'Could not generate dub',
              subtitle: 'Please retry after checking your source media.',
              progressPct: 100,
          };
      }
      if (dubbingUiState.phase === 'done') {
          return {
              badge: 'Ready',
              tone: darkTheme
                ? 'border-emerald-400/45 bg-emerald-500/12 text-emerald-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700',
              bar: darkTheme ? 'bg-emerald-400' : 'bg-emerald-500',
              title: 'Dub track is ready',
              subtitle: dubbingUiState.stage || 'Preview, export, or continue editing your script.',
              progressPct: 100,
          };
      }
      return {
          badge: 'Idle',
          tone: darkTheme
            ? 'border-slate-600 bg-slate-900/80 text-slate-200'
            : 'border-gray-200 bg-gray-50 text-gray-600',
          bar: darkTheme ? 'bg-slate-400' : 'bg-gray-300',
          title: 'Ready for async generation',
          subtitle: 'Upload source clips, select language, and press AI Dub.',
          progressPct: 0,
      };
  }, [dubbingUiState.phase, dubbingUiState.progress, dubbingUiState.stage, resolvedTheme]);

  const refreshEngineVoiceCatalog = useCallback(
      async (engine: GenerationSettings['engine'], _runtimeUrl?: string): Promise<VoiceOption[]> => {
          try {
              const { fetchEngineRuntimeVoices } = await loadTtsVoiceRegistryService();
              const voices = await fetchEngineRuntimeVoices(engine, mediaBackendUrl, 7000);
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
      [getStaticVoicesForEngine, mediaBackendUrl, mergeVoiceCatalogs, withVoiceMeta]
  );

  const toRuntimeStatus = useCallback((
      engine: GenerationSettings['engine'],
      engineItem: any
  ): EngineRuntimeStatus => {
      void engine;
    const mapped = mapGatewayEngineRuntimeToUiStatus(engineItem);
    return {
      state: mapped.state as EngineRuntimeState,
      detail: sanitizeUiText(mapped.detail) || 'Runtime status updated.',
      provider: cleanRuntimeMetadataField(mapped.provider),
      lane: cleanRuntimeMetadataField(mapped.lane),
      selectedRegion: cleanRuntimeMetadataField(mapped.selectedRegion),
      modelId: cleanRuntimeMetadataField(mapped.modelId),
      runtimeUrl: cleanRuntimeMetadataField(mapped.runtimeUrl),
      healthUrl: cleanRuntimeMetadataField(mapped.healthUrl),
      cloudTtsLocation: cleanRuntimeMetadataField(mapped.cloudTtsLocation),
      vertexLocation: cleanRuntimeMetadataField(mapped.vertexLocation),
      regionHint: cleanRuntimeMetadataField(mapped.regionHint),
      regionSource: cleanRuntimeMetadataField(mapped.regionSource),
    };
  }, []);

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
      }, {} as Record<GenerationSettings['engine'], EngineRuntimeStatus & { metadataSummary: string }>),
    };
    try {
      (window as any).__vfLastTtsRuntimeStatus = snapshot;
      window.dispatchEvent(new CustomEvent(TTS_RUNTIME_STATUS_EVENT, { detail: snapshot }));
    } catch {
      // Keep telemetry best-effort only.
    }
  }, [managedActiveEngine, settings.engine, ttsRuntimeStatus]);

  const probeRuntimeStatus = useCallback(async (
    engine: GenerationSettings['engine'],
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<EngineRuntimeStatus> => {
    throwIfSignalAborted(options?.signal);
    try {
      const payload = await fetchTtsEnginesStatus(engine, mediaBackendUrl, {
        ...(typeof options?.timeoutMs === 'number' ? { timeoutMs: options.timeoutMs } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      throwIfSignalAborted(options?.signal);
      const engineItem = payload.engines?.[engine];
      return toRuntimeStatus(engine, engineItem);
    } catch (error: unknown) {
      if ((error as { name?: string } | null)?.name === 'AbortError') {
        throw error;
      }
      const rawDetail = error instanceof Error ? error.message : 'Runtime offline';
      const detail = sanitizeUiText(rawDetail || 'Runtime offline');
      return { state: 'offline', detail };
    }
  }, [mediaBackendUrl, toRuntimeStatus]);

  const refreshTtsRuntimeStatus = useCallback(async (options?: { broadcast?: boolean }): Promise<void> => {
    if (runtimePollRefreshInFlightRef.current) {
      return runtimePollRefreshInFlightRef.current;
    }
    const selectedRuntimeEngine = managedActiveEngine || settings.engine;
    const shouldBroadcast = options?.broadcast !== false;
    const idleDetail = `Idle (active: ${getEngineDisplayName(selectedRuntimeEngine)}). Switch to activate.`;
    const inFlight = (async () => {
      const updateSelectedEngineTelemetry = (
        engine: GenerationSettings['engine'],
        updater: (current: SelectedEngineTelemetry) => SelectedEngineTelemetry
      ) => {
        if (engine !== selectedRuntimeEngine) return;
        setSelectedEngineTelemetry((prev) => {
          const current = prev[engine] ?? createSelectedEngineTelemetry();
          return {
            ...prev,
            [engine]: updater(current),
          };
        });
      };
      const writeSelectedStatus = (
        status: EngineRuntimeStatus,
        otherDetail: string = idleDetail
      ) => {
        setTtsRuntimeStatus((prev) => {
          const next = { ...prev };
          next[selectedRuntimeEngine] = mergeRuntimeStatus(prev[selectedRuntimeEngine], status);
          for (const engine of ENGINE_ORDER) {
            if (engine === selectedRuntimeEngine) continue;
            if (next[engine]?.state !== 'checking') continue;
            next[engine] = mergeRuntimeStatus(next[engine], { state: 'standby', detail: otherDetail });
          }
          if (shouldBroadcast) {
            void writeRuntimePollSnapshot(runtimePollTabIdRef.current, next);
          }
          return next;
        });
      };

      const payload = await fetchTtsEngineLatency(selectedRuntimeEngine, mediaBackendUrl, {
        timeoutMs: RUNTIME_STATUS_LATENCY_TIMEOUT_MS,
      });
      const status = toRuntimeStatus(selectedRuntimeEngine, payload);
      const latencySampleMs = Number.isFinite(payload.gcpPingMs)
        ? Math.max(1, Math.floor(Number(payload.gcpPingMs)))
        : (Number.isFinite(payload.latencyMs) ? Math.max(1, Math.floor(payload.latencyMs)) : null);
      updateSelectedEngineTelemetry(selectedRuntimeEngine, (current) => ({
        ...current,
        kind: 'network',
        label: typeof latencySampleMs === 'number' ? `${latencySampleMs} ms` : 'Pending',
        detail: sanitizeUiText(status.detail || 'Runtime status updated.') || 'Runtime status updated.',
        latencyMs: latencySampleMs,
        measuredAtMs: Date.now(),
        samples: typeof latencySampleMs === 'number'
          ? appendRollingSample(
              current.samples,
              latencySampleMs,
              SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT
            )
          : current.samples,
      }));
      writeSelectedStatus(status);
    })()
      .catch((error) => {
        runtimePollActiveUntilRef.current = Math.max(
          runtimePollActiveUntilRef.current,
          Date.now() + Math.max(RUNTIME_STATUS_ACTIVE_POLL_MS * 3, 15000)
        );
        const safeDetail = sanitizeUiText(
          error instanceof Error ? error.message : String(error || 'Runtime status unavailable')
        ) || 'Runtime status unavailable';
        const authBlocked = isAuthOrProfileBlockingMessage(safeDetail);
        if (authBlocked) {
          syncRuntimeBlockedStateFromError(managedActiveEngine || settings.engine, error);
        }
        if (selectedRuntimeEngine) {
          setSelectedEngineTelemetry((prev) => {
            const current = prev[selectedRuntimeEngine] ?? createSelectedEngineTelemetry();
            return {
              ...prev,
              [selectedRuntimeEngine]: {
                ...current,
                kind: 'error',
                label: /timeout/i.test(safeDetail) ? 'Timed out' : 'Unavailable',
                detail: safeDetail,
                latencyMs: null,
                measuredAtMs: Date.now(),
              },
            };
          });
        }
        setTtsRuntimeStatus((prev) => {
          const next = { ...prev };
          const nextStatus: Partial<EngineRuntimeStatus> = authBlocked
            ? { state: 'standby' as EngineRuntimeStatus['state'], detail: 'Sign in to check runtime status.' }
            : { state: 'offline' as EngineRuntimeStatus['state'], detail: safeDetail };
          next[selectedRuntimeEngine] = mergeRuntimeStatus(prev[selectedRuntimeEngine], nextStatus);
          for (const engine of ENGINE_ORDER) {
            if (engine === selectedRuntimeEngine) continue;
            if (next[engine]?.state !== 'checking') continue;
            next[engine] = mergeRuntimeStatus(prev[engine], {
              state: 'standby',
              detail: !hasSessionIdentity || authBlocked ? 'Sign in to check runtime status.' : idleDetail,
            });
          }
          if (shouldBroadcast) {
            void writeRuntimePollSnapshot(runtimePollTabIdRef.current, next);
          }
          return next;
        });
        console.warn('[studio.runtime_status.refresh]', error);
      })
      .finally(() => {
        runtimePollRefreshInFlightRef.current = null;
      });
    runtimePollRefreshInFlightRef.current = inFlight;
    return inFlight;
  }, [
    hasSessionIdentity,
    isAuthOrProfileBlockingMessage,
    managedActiveEngine,
    mediaBackendUrl,
    settings.engine,
    syncRuntimeBlockedStateFromError,
    toRuntimeStatus,
  ]);

  useEffect(() => {
    if (!hasSessionIdentity) {
      clearRuntimeAutoSelectSessionRun();
      runtimeAutoSelectProbeInFlightRef.current = false;
      return;
    }
    if (hasRuntimeAutoSelectSessionRun()) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (isGenerating || Boolean(engineSwitchInProgress)) return;

    let cancelled = false;
    const controller = new AbortController();
    runtimeAutoSelectProbeInFlightRef.current = true;

    const probeAllRuntimesAndAutoSelect = async (): Promise<void> => {
      try {
        const dunoProbeStartedAtMs = Date.now();
        const statusProbeStartedAtMs = Date.now();
        const [dunoProbeResult, statusResult] = await Promise.allSettled([
          probeRuntimeStatus('DUNO', {
            timeoutMs: RUNTIME_STATUS_LATENCY_TIMEOUT_MS,
            signal: controller.signal,
          }).then((status) => ({
            status,
            latencyMs: Math.max(0, Date.now() - dunoProbeStartedAtMs),
          })),
          fetchTtsEnginesStatus(undefined, mediaBackendUrl, {
            timeoutMs: RUNTIME_STATUS_LATENCY_TIMEOUT_MS,
            signal: controller.signal,
          }).then((payload) => ({
            payload,
            latencyMs: Math.max(0, Date.now() - statusProbeStartedAtMs),
          })),
        ]);

        if (cancelled) return;

        const dunoProbe = dunoProbeResult.status === 'fulfilled' ? dunoProbeResult.value : null;
        const statusProbe = statusResult.status === 'fulfilled' ? statusResult.value : null;
        const dunoStatus = dunoProbe?.status || null;
        const statusPayload = statusProbe?.payload || null;
        const statusPayloadLatencyMs = statusProbe ? Math.max(0, Math.floor(statusProbe.latencyMs)) : null;
        if (!dunoStatus && !statusPayload) return;

        const nextStatuses = { ...ttsRuntimeStatusRef.current };
        const candidateLatencies: Partial<Record<GenerationSettings['engine'], { state?: string; latencyMs?: number | null }>> = {};

        if (dunoStatus) {
          nextStatuses.DUNO = mergeRuntimeStatus(nextStatuses.DUNO, dunoStatus);
          const dunoAutoSelectState = String(dunoStatus.state || '').trim().toLowerCase();
          const dunoLatencyMs = Math.max(0, Math.floor(Number(dunoProbe?.latencyMs || 0)));
          candidateLatencies.DUNO = {
            state: dunoAutoSelectState,
            latencyMs: dunoAutoSelectState === 'online' ? dunoLatencyMs : null,
          };
        }

        const enginePayloads = statusPayload?.engines || {};
        for (const engine of ['PRIME', 'VECTOR'] as const) {
          const payload = enginePayloads[engine];
          if (!payload || typeof payload !== 'object') continue;
          const runtimeStatus = toRuntimeStatus(engine, payload);
          nextStatuses[engine] = mergeRuntimeStatus(nextStatuses[engine], runtimeStatus);
          const runtimeLatencyMs = Number((payload as { latencyMs?: unknown }).latencyMs);
          const latencyMs = (
            Number.isFinite(runtimeLatencyMs) && runtimeLatencyMs >= 0
              ? Math.floor(runtimeLatencyMs)
              : (runtimeStatus.state === 'online' ? statusPayloadLatencyMs : null)
          );
          candidateLatencies[engine] = {
            state: runtimeStatus.state,
            latencyMs,
          };
        }

        setTtsRuntimeStatus(nextStatuses);

        if (!hasSessionIdentity) return;

        const bestEngine = pickLowestLatencyRuntimeEngine(
          candidateLatencies,
          primeAllowedEngines
        );
        if (!bestEngine) return;

        const currentEngine = managedActiveEngine || settings.engine;
        markRuntimeAutoSelectSessionRun();
        if (bestEngine === currentEngine) return;

        const bestCatalog = getEngineVoiceCatalog(bestEngine);
        const nextVoiceId = selectVoiceIdFromCatalog(bestEngine, bestCatalog, settings.voiceId);
        setManagedActiveEngine(bestEngine);
        setSettings((prev) => (
          prev.engine === bestEngine && prev.voiceId === nextVoiceId
            ? prev
            : { ...prev, engine: bestEngine, voiceId: nextVoiceId }
        ));
      } catch (error) {
        if ((error as { name?: string } | null)?.name === 'AbortError') return;
        console.warn('[studio.runtime_auto_select]', error);
      } finally {
        runtimeAutoSelectProbeInFlightRef.current = false;
      }
    };

    void probeAllRuntimesAndAutoSelect();
    return () => {
      cancelled = true;
      runtimeAutoSelectProbeInFlightRef.current = false;
      controller.abort();
    };
  }, [
    engineSwitchInProgress,
    getEngineVoiceCatalog,
    hasSessionIdentity,
    isGenerating,
    managedActiveEngine,
    mediaBackendUrl,
    primeAllowedEngines,
    probeRuntimeStatus,
    selectVoiceIdFromCatalog,
    setManagedActiveEngine,
    setSettings,
    settings.engine,
    settings.voiceId,
    toRuntimeStatus,
  ]);

  const waitForRuntimeOnline = async (
    engine: GenerationSettings['engine'],
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<boolean> => {
    const started = Date.now();
    let pollDelayMs = Math.max(RUNTIME_STATUS_ACTIVE_POLL_MS, 2000);
    const maxDelayMs = Math.max(RUNTIME_STATUS_COOLDOWN_POLL_MS / 6, 10000);
    while (Date.now() - started < timeoutMs) {
      throwIfSignalAborted(signal);
      const status = await probeRuntimeStatus(engine, {
        timeoutMs: RUNTIME_STATUS_LATENCY_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      if (status.state === 'online') return true;
      await waitForAbortableDelay(pollDelayMs, signal);
      pollDelayMs = Math.min(maxDelayMs, Math.round(pollDelayMs * 1.5));
    }
    throwIfSignalAborted(signal);
    return false;
  };

  const ensureEngineOnline = async (
      engine: GenerationSettings['engine'],
      options?: {
        timeoutMs?: number;
        silent?: boolean;
        syncVoiceId?: string;
        requireAccess?: boolean;
        preferBrowserRuntime?: boolean;
        signal?: AbortSignal;
      }
  ): Promise<{ runtimeUrl: string; catalog: VoiceOption[]; syncedVoiceId?: string }> => {
      throwIfSignalAborted(options?.signal);
      const engineLabel = getEngineDisplayName(engine);
      if (!isPrimeEngineAllowed(engine)) {
          throw new Error(`${engineLabel} is not enabled for your current plan.`);
      }
      let runtimeUrl = getRuntimeUrlForEngine(engine);
      try {
          const statusPayload = await fetchTtsEnginesStatus(engine, mediaBackendUrl, {
            timeoutMs: RUNTIME_STATUS_LATENCY_TIMEOUT_MS,
            ...(options?.signal ? { signal: options.signal } : {}),
          });
          const gatewayRuntimeUrl = normalizeRuntimeUrl(statusPayload.engines?.[engine]?.runtimeUrl);
          if (gatewayRuntimeUrl) runtimeUrl = gatewayRuntimeUrl;
      } catch (error) {
          if ((error as { name?: string } | null)?.name === 'AbortError') {
              throw error;
          }
          // Runtime URL is now gateway-managed; keep backward-compat fallback value if status call fails.
      }

      const currentStatus = await probeRuntimeStatus(engine, {
        timeoutMs: RUNTIME_STATUS_LATENCY_TIMEOUT_MS,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if (
          isGemRuntimeEngine(engine) &&
          currentStatus.state === 'offline' &&
          String(currentStatus.detail || '').toLowerCase().includes('slot')
      ) {
          throw new Error(currentStatus.detail || 'Primary AI slot set is not configured.');
      }
      if (currentStatus.state === 'offline' && isAuthOrProfileBlockingMessage(currentStatus.detail)) {
          throw new Error(currentStatus.detail || 'Sign in again to enable AI/TTS requests.');
      }
      if (options?.requireAccess) {
          const access = await refreshTtsAccessState(true);
          if (!access.ok) {
              throw new Error(access.detail || 'Sign in again to enable AI/TTS requests.');
          }
      }
      if (currentStatus.state === 'online') {
          const cachedCatalog = runtimeVoiceCatalogs[engine] || [];
          const shouldRefreshCatalog = cachedCatalog.length === 0;
          const refreshedCatalog = shouldRefreshCatalog
              ? await refreshEngineVoiceCatalog(engine, runtimeUrl)
              : cachedCatalog;
          setManagedActiveEngine(engine);
          setTtsRuntimeStatus(prev => {
              const next = { ...prev };
                next[engine] = mergeRuntimeStatus(next[engine], { state: 'online', detail: currentStatus.detail || 'Runtime online' });
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
              setSettings((prev) => (
                  prev.engine === engine && prev.voiceId === validVoiceId
                      ? prev
                      : { ...prev, engine, voiceId: validVoiceId }
              ));
          }
          return {
              runtimeUrl,
              catalog: refreshedCatalog,
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
              switchResult = await switchTtsEngineRuntime(mediaBackendUrl, engine);
          } catch (switchError: any) {
              const detail = String(switchError?.message || switchError || '').toLowerCase();
              if (
                  detail.includes('x-admin-unlock') ||
                  detail.includes('admin-unlock') ||
                  detail.includes('admin session unlock')
              ) {
                  const fallbackCatalog = await refreshEngineVoiceCatalog(engine, runtimeUrl).catch(() => getEngineVoiceCatalog(engine));
                  const standbyDetail = `${engineLabel} runtime activation is admin-locked. Continuing with managed runtime auto-recovery.`;
                  setTtsRuntimeStatus((prev) => ({
                      ...prev,
                      [engine]: { state: 'standby', detail: standbyDetail },
                  }));
                  let syncedVoiceId: string | undefined;
                  if (options?.syncVoiceId) {
                      const candidateVoiceId = options.syncVoiceId || settings.voiceId;
                      const validVoiceId = selectVoiceIdFromCatalog(
                          engine,
                          fallbackCatalog.length > 0 ? fallbackCatalog : getEngineVoiceCatalog(engine),
                          candidateVoiceId
                      );
                      syncedVoiceId = validVoiceId;
                      setSettings((prev) => (
                          prev.engine === engine && prev.voiceId === validVoiceId
                              ? prev
                              : { ...prev, engine, voiceId: validVoiceId }
                      ));
                  }
                  if (!options?.silent) {
                      showToast(`${engineLabel} runtime switch is admin-locked. Continuing with auto-recovery.`, 'info');
                  }
                  return {
                      runtimeUrl,
                      catalog: fallbackCatalog,
                      ...(syncedVoiceId ? { syncedVoiceId } : {}),
                  };
              }
              if (
                  detail.includes('unreachable') ||
                  detail.includes('fetch failed') ||
                  detail.includes('failed to fetch') ||
                  detail.includes('networkerror') ||
                  detail.includes('econnrefused')
              ) {
                  throw new Error(`Media backend is unreachable at ${mediaBackendUrl}. Check backend health and retry.`);
              }
              throw new Error(switchError?.message || `Failed to switch ${engineLabel} runtime.`);
          }

          setManagedActiveEngine(engine);
          const switchState = normalizeEngineRuntimeState(switchResult?.state, 'starting');
          if (switchState === 'not_configured') {
              throw new Error(switchResult?.detail || getRuntimeNotConfiguredMessage(engine));
          }
          if (switchState === 'offline') {
              throw new Error(switchResult?.detail || getRuntimeOfflineMessage(engine));
          }
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

          if (switchState !== 'online') {
              const timeoutMs = options?.timeoutMs ?? (switchResult?.state === 'starting' ? 90000 : 60000);
              const online = await waitForRuntimeOnline(engine, timeoutMs, options?.signal);
              if (!online) {
                  throw new Error(`${engineLabel} runtime did not become online within ${Math.round(timeoutMs / 1000)}s. Check gateway status and runtime logs.`);
              }
          }

          const refreshedCatalog = await refreshEngineVoiceCatalog(engine, runtimeUrl);
          setTtsRuntimeStatus(prev => ({
            ...prev,
            [engine]: mergeRuntimeStatus(prev[engine], { state: 'online', detail: 'Runtime online' }),
          }));
          let syncedVoiceId: string | undefined;
          if (options?.syncVoiceId) {
              const candidateVoiceId = options.syncVoiceId || settings.voiceId;
              const fallbackCatalog = refreshedCatalog.length > 0
                  ? refreshedCatalog
                  : getEngineVoiceCatalog(engine);
              const validVoiceId = selectVoiceIdFromCatalog(engine, fallbackCatalog, candidateVoiceId);
              syncedVoiceId = validVoiceId;
              setSettings((prev) => (
                  prev.engine === engine && prev.voiceId === validVoiceId
                      ? prev
                      : { ...prev, engine, voiceId: validVoiceId }
              ));
          }
          if (!options?.silent) {
              showToast(`${engineLabel} runtime is online.`, 'info');
          }
          return {
              runtimeUrl,
              catalog: refreshedCatalog,
              ...(syncedVoiceId ? { syncedVoiceId } : {}),
          };
      } catch (error: any) {
          if ((error as { name?: string } | null)?.name === 'AbortError') {
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
          const health = await checkMediaBackendHealth(mediaBackendUrl, { forceRefresh: Boolean(options?.forceRefresh) });
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
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiDensity, uiDensity); }, [uiDensity]);
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
      const nextDraft = String(text || '').slice(0, STUDIO_EDITOR_HARD_CAP);
      if (!nextDraft.trim()) {
          removeStorageKey(STORAGE_KEYS.studioDraftText);
          return;
      }
      writeStorageString(STORAGE_KEYS.studioDraftText, nextDraft);
  }, [text]);
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
          }, {} as Record<GenerationSettings['engine'], EngineRuntimeState>);
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
  }, [emit, hasSessionIdentity, settings.engine, ttsRuntimeStatus]);
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
              const routingResult = await applyNearestBackendRoutingOnLogin({ signal: startupProbeController.signal });
              if (cancelled) return;
              void primeLoginTtsSessionKey({
                baseUrl: routingResult.baseUrl || mediaBackendUrl,
                ...(routingResult.regionHint ? { regionHint: routingResult.regionHint } : {}),
                ...(routingResult.regionSource ? { regionSource: routingResult.regionSource } : {}),
                signal: startupProbeController.signal,
              });
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
  }, [hasSessionIdentity, mapTtsAccessBlockReason, mediaBackendUrl, refreshTtsAccessState, user.uid, user.userId, user.email]);

  useEffect(() => {
      const busy = isGenerating || Boolean(engineSwitchInProgress);
      const now = Date.now();
      if (busy) {
          runtimePollActiveUntilRef.current = Math.max(
            runtimePollActiveUntilRef.current,
            now + RUNTIME_STATUS_ACTIVE_POLL_MS
          );
      } else if (runtimePollWasBusyRef.current) {
          runtimePollCooldownUntilRef.current = Math.max(
            runtimePollCooldownUntilRef.current,
            now + RUNTIME_STATUS_COOLDOWN_WINDOW_MS
          );
      }
      runtimePollWasBusyRef.current = busy;
  }, [engineSwitchInProgress, isGenerating]);

  useEffect(() => {
      const tabId = runtimePollTabIdRef.current;
      const coordinationAvailable = isRuntimePollCoordinationAvailable();
      const busy = isGenerating || Boolean(engineSwitchInProgress);
      const applySnapshot = () => {
          if (!coordinationAvailable) return;
          const snapshot = readRuntimePollSnapshot<Record<GenerationSettings['engine'], EngineRuntimeStatus>>();
          if (!snapshot || snapshot.tabId === tabId) return;
          const payload = snapshot.payload;
          if (!payload || typeof payload !== 'object') return;
          setTtsRuntimeStatus((prev) => {
              const nextStatuses = {} as Record<GenerationSettings['engine'], EngineRuntimeStatus>;
              for (const engine of ENGINE_ORDER) {
                  const row = payload[engine];
                  nextStatuses[engine] = hydrateRuntimeStatusSnapshot(
                    prev[engine],
                    row && typeof row === 'object' ? (row as Partial<EngineRuntimeStatus>) : null
                  );
              }
              return nextStatuses;
          });
      };
      const refreshLeadership = () => {
          const previous = runtimePollIsLeaderRef.current;
          if (typeof document === 'undefined' || document.visibilityState !== 'visible' || !busy) {
              if (coordinationAvailable) {
                  releaseRuntimePollLeadership(tabId);
              }
              runtimePollIsLeaderRef.current = false;
              if (previous) setRuntimePollLeaderVersion((value) => value + 1);
              return;
          }
          const nextLeader = coordinationAvailable
            ? renewRuntimePollLeadership(
                tabId,
                Date.now(),
                RUNTIME_STATUS_LEADER_LEASE_MS
              )
            : true;
          runtimePollIsLeaderRef.current = nextLeader;
          if (previous !== nextLeader) {
              setRuntimePollLeaderVersion((value) => value + 1);
          }
      };

      refreshLeadership();
      applySnapshot();
      const heartbeatId = coordinationAvailable && busy
        ? window.setInterval(refreshLeadership, RUNTIME_STATUS_LEADER_HEARTBEAT_MS)
        : null;
      const onStorage = (event: StorageEvent) => {
          if (!coordinationAvailable) return;
          if (event.key === RUNTIME_POLL_LEADER_KEY) {
              refreshLeadership();
              return;
          }
          if (event.key === RUNTIME_POLL_SNAPSHOT_KEY) {
              applySnapshot();
          }
      };
      const onVisibility = () => {
          refreshLeadership();
          if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
          if (!runtimePollIsLeaderRef.current) {
              applySnapshot();
              return;
          }
          runtimePollCooldownUntilRef.current = Math.max(
            runtimePollCooldownUntilRef.current,
            Date.now() + RUNTIME_STATUS_COOLDOWN_POLL_MS
          );
          void refreshTtsRuntimeStatus();
      };
      if (coordinationAvailable) {
          window.addEventListener('storage', onStorage);
      }
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', onVisibility);
      onVisibility();
      return () => {
          if (heartbeatId !== null) {
              window.clearInterval(heartbeatId);
          }
          if (coordinationAvailable) {
              window.removeEventListener('storage', onStorage);
          }
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('focus', onVisibility);
          if (coordinationAvailable) {
              releaseRuntimePollLeadership(tabId);
          }
      };
  }, [engineSwitchInProgress, isGenerating, refreshTtsRuntimeStatus]);

  useEffect(() => {
      let cancelled = false;
      let timerId: number | null = null;

      const scheduleNext = (delayMs: number) => {
          if (cancelled) return;
          if (timerId !== null) {
              window.clearTimeout(timerId);
              timerId = null;
          }
          if (delayMs <= 0) return;
          timerId = window.setTimeout(() => {
              void runTick();
          }, delayMs);
      };

      const runTick = async () => {
          if (cancelled) return;
          const now = Date.now();
          const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
          const mode = resolveRuntimePollMode({
              nowMs: now,
              isBusy: isGenerating || Boolean(engineSwitchInProgress),
              activeUntilMs: runtimePollActiveUntilRef.current,
              cooldownUntilMs: runtimePollCooldownUntilRef.current,
              isVisible,
              isLeader: runtimePollIsLeaderRef.current,
          });
          if (mode === 'none') return;
          try {
              await refreshTtsRuntimeStatus();
          } catch {
              // Keep polling to preserve runtime indicator continuity during transient failures.
          }
          const nextDelay = mode === 'active' ? RUNTIME_STATUS_ACTIVE_POLL_MS : RUNTIME_STATUS_COOLDOWN_POLL_MS;
          scheduleNext(nextDelay);
      };

      void runTick();
      return () => {
          cancelled = true;
          if (timerId !== null) {
              window.clearTimeout(timerId);
          }
      };
  }, [
      engineSwitchInProgress,
      isGenerating,
      runtimePollLeaderVersion,
      refreshTtsRuntimeStatus,
  ]);

  useEffect(() => {
      if (!hasSessionIdentity) {
          setSelectedEngineTelemetry(
            ENGINE_ORDER.reduce((acc, engine) => {
                acc[engine] = createSelectedEngineTelemetry({
                    label: 'Sign in',
                    detail: 'Sign in to measure latency.',
                });
                return acc;
            }, {} as Record<GenerationSettings['engine'], SelectedEngineTelemetry>)
          );
      }
  }, [hasSessionIdentity]);

  useEffect(() => {
      if (!hasSessionIdentity) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (runtimeAutoSelectProbeInFlightRef.current) return;
      const currentTelemetry = selectedEngineTelemetry[settings.engine];
      if (!shouldRefreshSelectedEngineTelemetry(currentTelemetry, Date.now())) return;
      void refreshTtsRuntimeStatus({ broadcast: false });
  }, [hasSessionIdentity, refreshTtsRuntimeStatus, selectedEngineTelemetry, settings.engine]);

  useEffect(() => {
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
  }, [settings.engine, settings.voiceId, getValidVoiceIdForEngine, getEngineVoiceCatalog]);

  useEffect(() => {
      const scoped = getLanguageScopedVoiceCatalog(settings.engine, studioTextLanguageCode);
      if (!scoped.length) return;
      if (scoped.some((voice) => voice.id === settings.voiceId)) return;
      const fallbackVoiceId = scoped[0]?.id;
      if (!fallbackVoiceId) return;
      setSettings((prev) => ({ ...prev, voiceId: fallbackVoiceId }));
  }, [
      getLanguageScopedVoiceCatalog,
      settings.engine,
      settings.voiceId,
      studioTextLanguageCode,
  ]);

  useEffect(() => {
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
      return () => {
          if (renderedDubVideoUrl) URL.revokeObjectURL(renderedDubVideoUrl);
          if (dubbingJobResultUrl) URL.revokeObjectURL(dubbingJobResultUrl);
          if (dubbingReportUrl) URL.revokeObjectURL(dubbingReportUrl);
          resetDubbingLivePlayback();
          if (dubbingStemsRef.current) {
              URL.revokeObjectURL(dubbingStemsRef.current.speechObjectUrl);
              URL.revokeObjectURL(dubbingStemsRef.current.backgroundObjectUrl);
              dubbingStemsRef.current = null;
          }
      };
  }, [renderedDubVideoUrl, dubbingJobResultUrl, dubbingReportUrl, resetDubbingLivePlayback]);

  useEffect(() => {
      if (typeof document === 'undefined') return undefined;
      return applyThemeModeToDocument(document, uiTheme, resolvedTheme);
  }, [uiTheme, resolvedTheme]);

  useEffect(() => {
      if (typeof document === 'undefined') return undefined;
      return applyBrandThemeToDocument(document, uiBrandTheme);
  }, [uiBrandTheme]);

  useEffect(() => {
      const previousCompact = document.body.dataset.compact;
      document.body.dataset.compact = uiDensity === 'compact' ? 'true' : 'false';
      return () => {
          if (previousCompact) document.body.dataset.compact = previousCompact;
          else delete document.body.dataset.compact;
      };
  }, [uiDensity]);

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
      if (!isStudioWorkspaceTab) return;
      let frameId = 0;
      const applyDockCenter = () => {
          const studioMainRect = studioMainRef.current?.getBoundingClientRect();
          const fallback = Math.round(window.innerWidth / 2);
          const centerX = studioMainRect ? Math.round(studioMainRect.left + (studioMainRect.width / 2)) : fallback;
          document.documentElement.style.setProperty('--vf-studio-dock-center-x', `${centerX}px`);
      };
      const scheduleDockCenter = () => {
          if (frameId) window.cancelAnimationFrame(frameId);
          frameId = window.requestAnimationFrame(() => {
              applyDockCenter();
          });
      };

      const observer = typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(() => {
              scheduleDockCenter();
          })
          : null;
      if (observer && studioMainRef.current) {
          observer.observe(studioMainRef.current);
      }

      scheduleDockCenter();
      window.addEventListener('resize', scheduleDockCenter, { passive: true });
      window.addEventListener('orientationchange', scheduleDockCenter, { passive: true });
      return () => {
          if (frameId) window.cancelAnimationFrame(frameId);
          window.removeEventListener('resize', scheduleDockCenter);
          window.removeEventListener('orientationchange', scheduleDockCenter);
          if (observer) observer.disconnect();
      };
  }, [isStudioWorkspaceTab, uiDensity, uiFontScale, sidebarMode]);

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
          void cancelTtsJob(jobId, { baseUrl: mediaBackendUrl }).catch(() => undefined);
      }
  }, [mediaBackendUrl]);

  // Cleanup timer on unmount
  useEffect(() => {
      return () => { 
          if(progressTimerRef.current) clearInterval(progressTimerRef.current);
          if(previewAudioRef.current) previewAudioRef.current.pause();
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
    isStudioWorkspaceTab ? text : (false ? dubScript : '')
  );

  // Auto-detect language and speakers in text (Studio Mode AND Dubbing Mode)
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

  // Video Playback Sync
  useEffect(() => {
    const video = videoRef.current;
    const audio = dubAudioRef.current;
    
    if (video && audio) {
        const handlePlay = () => {
            if (video.readyState >= 2 && audio.readyState >= 2) {
                 video.play().catch(e => console.error("Video play fail", e));
                 audio.play().catch(e => console.error("Audio play fail", e));
                 setIsPlayingDub(true);
            }
        };
        const handlePause = () => {
            video.pause();
            audio.pause();
            setIsPlayingDub(false);
        };
        const handleSeek = () => {
            const drift = Math.abs(audio.currentTime - video.currentTime);
            if (drift > 0.1) {
                audio.currentTime = video.currentTime;
            }
        };
        const handleEnded = () => {
            setIsPlayingDub(false);
            video.currentTime = 0;
            audio.currentTime = 0;
            video.pause();
            audio.pause();
        };

        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('seeking', handleSeek);
        video.addEventListener('ended', handleEnded);
        audio.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('seeking', handleSeek);
            video.removeEventListener('ended', handleEnded);
            audio.removeEventListener('ended', handleEnded);
        };
    }
  }, [dubAudioUrl, videoUrl]);

  useEffect(() => {
      if (videoRef.current) {
          applySafeMediaVolume(videoRef.current, videoVolume, {
              fallback: 1,
              context: 'studio_video',
              onError: (error, info) => {
                  void reportFrontendSignal({
                      message: 'studio.media_volume_assignment_failed',
                      component: 'MainApp',
                      severity: 'warning',
                      metadata: {
                          channel: 'video',
                          attemptedVolume: info.attemptedVolume,
                          appliedFallback: info.appliedFallback,
                          context: info.context,
                          error: error instanceof Error ? error.message : String(error || 'unknown'),
                      },
                  });
              },
          });
      }
      if (dubAudioRef.current) {
          applySafeMediaVolume(dubAudioRef.current, dubVolume, {
              fallback: 1,
              context: 'studio_dub',
              onError: (error, info) => {
                  void reportFrontendSignal({
                      message: 'studio.media_volume_assignment_failed',
                      component: 'MainApp',
                      severity: 'warning',
                      metadata: {
                          channel: 'dub',
                          attemptedVolume: info.attemptedVolume,
                          appliedFallback: info.appliedFallback,
                          context: info.context,
                          error: error instanceof Error ? error.message : String(error || 'unknown'),
                      },
                  });
              },
          });
      }
  }, [videoVolume, dubVolume]);

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

     const increment = 100 / (estSeconds * 10); // update every 100ms
     
     progressTimerRef.current = setInterval(() => {
         setProgress(prev => {
             if (prev >= 90) return 90; // Stall at 90% until real completion
             return prev + increment;
         });
         setTimeLeft(prev => Math.max(0, prev - 0.1)); // inaccurate but visual
         markGenerationActivity();
     }, 100);
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
      const runRequestId = persistedRequestId || initialKnownJobId || createSynthesisTraceId(normalizedQueueEngine as GenerationSettings['engine']);
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
                          baseUrl: resolveMediaBackendUrl(runSettings),
                          jobId: currentJobId,
                          runtimeLabel: getEngineDisplayName(normalizedQueueEngine as GenerationSettings['engine']),
                          engine: normalizedQueueEngine as GenerationSettings['engine'],
                          signal: controller.signal,
                      });
                      const decoded = await getAudioContext().decodeAudioData(queuedResult.audioBytes.slice(0));
                      const { applyStudioAudioMix } = await loadStudioMixService();
                      const mixedBuffer = await applyStudioAudioMix(decoded, runSettings);
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
                          const { cancelTtsJob } = await import('../src/shared/api/gatewayClient');
                          await cancelTtsJob(staleJobId, { baseUrl: resolveMediaBackendUrl(runSettings) });
                      } catch {
                          // Best-effort cancellation before retrying with the same request id.
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
                  setProcessingStage('Transient runtime issue detected. Retrying queue item once...');
                  showToast('Transient runtime issue detected. Retrying queue item once...', 'info');
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
  }, [performGeneration, replaceStudioQueueItemAudioUrl, showToast, syncActiveGatewayIds, updateStudioQueueState]);

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
      const generationNotificationKey = `queue:${settings.engine}`;

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
              dedupeKey: `generation-completed-queue:${settings.engine}`,
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
      rebuildStudioQueueMasterAudio,
      runStudioQueueItem,
      scheduleStudioQueueMasterRebuild,
      clearStudioQueueCooldownTimer,
      startStudioQueueInterPartCooldown,
      emit,
      showToast,
      text,
  ]);

  const startStudioQueuedGeneration = useCallback(async (): Promise<void> => {
      const currentHash = hashStudioQueueSource(text);
      const existingState = studioQueueStateRef.current;
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
      const generationNotificationKey = `queue:${settings.engine}`;

      const estTime = Math.max(4, Math.ceil(text.length / 14));
      startSimulation(estTime, 'Preparing queued generation...', 'live');
      emit('generation.started', {
          title: 'Generation Started',
          message: 'Queued Studio generation started.',
          entityKey: generationNotificationKey,
          dedupeKey: `generation-started:${settings.engine}`,
          channel: 'inbox',
      });

      try {
          await executeStudioQueue(nextState);
      } catch (error: any) {
          if (error?.name === 'AbortError') {
              showToast('Queue cancelled.', 'info');
              return;
          }
          syncRuntimeBlockedStateFromError(settings.engine, error);
          generationFailureBurstRef.current += 1;
          const queueFailureMessage = formatFrontendError(error, {
              fallback: 'Queue generation failed. Check runtime health and retry.',
              context: 'generation',
              isAdmin: hasAdminConsoleAccess,
          }).publicMessage;
          emit('generation.failed', {
              title: 'Generation Failure',
              message: queueFailureMessage,
              entityKey: generationNotificationKey,
              dedupeKey: `generation-failed-main:${settings.engine}`,
              action: {
                  label: 'Open Settings',
                  onClick: () => setShowSettings(true),
              },
          });
          showToast(queueFailureMessage || 'Queue generation failed.', 'error');
      }
  }, [
      emit,
      executeStudioQueue,
      buildStudioGenerationSettings,
      maxCharsPerGeneration,
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
                  fallback: 'Queue resume failed.',
                  context: 'generation',
                  isAdmin: hasAdminConsoleAccess,
              }).publicMessage;
              showToast(resumeFailureMessage || 'Queue resume failed.', 'error');
          }
      }
  }, [executeStudioQueue, hasAdminConsoleAccess, isGenerating, setStudioRailTab, showToast, text.length]);

  useEffect(() => {
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
                  fallback: 'Queue recovery failed.',
                  context: 'generation',
                  isAdmin: hasAdminConsoleAccess,
              }).publicMessage;
              showToast(recoveryFailureMessage || 'Queue recovery failed.', 'error');
          }
      });
  }, [executeStudioQueue, hasAdminConsoleAccess, isGenerating, scheduleStudioQueueMasterRebuild, setStudioRailTab, showToast, studioQueueState]);

  const handleCancelGeneration = () => {
      if (!isGenerating) return;

      clearStudioQueueCooldownTimer();
      const hadController = Boolean(generationAbortController.current);
      if (hadController) {
          generationAbortReasonRef.current = 'manual';
          generationAbortController.current?.abort();
          generationAbortController.current = null;
          setProcessingStage(sanitizeUiText('Cancelling generation...'));
          const activeDubJobId = String(activeDubbingJobIdRef.current || '').trim();
          if (activeDubJobId) {
              void loadMediaBackendService()
                .then(({ cancelDubbingJob }) => cancelDubbingJob(mediaBackendUrl, activeDubJobId))
                .catch(() => undefined);
          }
      } else {
          stopSimulation();
      }

      clearGenerationWatchdog();
      activeGatewayRequestIdRef.current = '';
      activeGatewayJobIdRef.current = '';
      clearSingleInflightGenerationLedger();
      activeDubbingJobIdRef.current = '';
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
      const engineVoiceName = studioSettings.engine === 'DUNO'
        ? voiceId
        : (selectedVoice?.geminiVoiceName || voiceId || 'Fenrir');
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
      throwIfSignalAborted(signal);
      const ttsBuffer = await generateSpeech(
          scriptText,
          engineVoiceName,
          generationSettings,
          'speech',
          signal,
          generationSpeechOptions
      );
      throwIfSignalAborted(signal);
      setLiveProgress(74, 'TTS response received. Applying studio mix...');
      const { applyStudioAudioMix } = await loadStudioMixService();
      const mixedBuffer = await applyStudioAudioMix(ttsBuffer, generationSettings);
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
      const generationRequestId = String(inflightLedger?.requestId || '').trim()
          || createSynthesisTraceId(resolveEngineToken(settings.engine) as GenerationSettings['engine']);
      let currentJobId = String(inflightLedger?.jobId || '').trim();
      patchSingleInflightGenerationLedger({
          mode: 'single',
          requestId: generationRequestId,
          jobId: currentJobId,
          textSnapshot: generationText,
          startedAtMs: generationStartedAtMs,
      });
      syncActiveGatewayIds(generationRequestId, currentJobId);

      setGeneratedAudioUrlManaged(null);
      setLiveAudioChunks([]);
      seenLiveChunkKeysRef.current.clear();

      const estTime = Math.max(3, Math.ceil(generationText.length / 14));
      const generationNotificationKey = `single:${settings.engine}`;
      const preparingLabel = options?.treatAsRecovery
          ? 'Reconnecting generation...'
          : (settings.engine === 'DUNO' ? 'Preparing DUNO synthesis...' : 'Preparing generation...');
      startSimulation(estTime, preparingLabel, 'live');
      emit('generation.started', {
        title: 'Generation Started',
        message: options?.treatAsRecovery ? 'Reconnecting existing generation.' : 'Generation started.',
        entityKey: generationNotificationKey,
        dedupeKey: `generation-started:${settings.engine}`,
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
                          baseUrl: resolveMediaBackendUrl(runSettings),
                          jobId: currentJobId,
                          runtimeLabel: getEngineDisplayName(normalizedRunEngine as GenerationSettings['engine']),
                          engine: normalizedRunEngine as GenerationSettings['engine'],
                          signal: controller.signal,
                      });
                      const decoded = await getAudioContext().decodeAudioData(queuedResult.audioBytes.slice(0));
                      const { applyStudioAudioMix } = await loadStudioMixService();
                      const mixedBuffer = await applyStudioAudioMix(decoded, runSettings);
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
                          { requestId: generationRequestId }
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
                          const { cancelTtsJob } = await import('../src/shared/api/gatewayClient');
                          await cancelTtsJob(staleJobId, { baseUrl: resolveMediaBackendUrl(settings) });
                      } catch {
                          // Best-effort cancellation before retrying with the same request id.
                      }
                  }
                  currentJobId = '';
                  syncActiveGatewayIds(generationRequestId, undefined);
                  patchSingleInflightGenerationLedger({
                      mode: 'single',
                      requestId: generationRequestId,
                      jobId: '',
                      textSnapshot: generationText,
                      startedAtMs: generationStartedAtMs,
                  });
                  setLiveAudioChunks([]);
                  seenLiveChunkKeysRef.current.clear();
                  setProcessingStage('Transient runtime issue detected. Retrying once...');
                  showToast('Transient runtime issue detected. Retrying once...', 'info');
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
              dedupeKey: `generation-completed-single:${settings.engine}`,
              channel: 'inbox',
          });
          showToast(completionMessage, 'success');
      } catch (e: any) {
          if (e.name === 'AbortError') {
              if (generationAbortReasonRef.current === 'manual') {
                  clearSingleInflightGenerationLedger();
              } else if (generationAbortReasonRef.current === 'stall') {
                  const stallMessage = 'Generation stalled for over 90 seconds. Retry or switch engine/runtime.';
                  showToast(stallMessage, 'error');
                  emit('generation.failed', {
                      title: 'Generation Stalled',
                      message: stallMessage,
                      entityKey: generationNotificationKey,
                      dedupeKey: `generation-stalled-main:${settings.engine}`,
                      action: {
                          label: 'Open Settings',
                          onClick: () => setShowSettings(true),
                      },
                  });
              }
          } else {
              clearSingleInflightGenerationLedger();
              syncRuntimeBlockedStateFromError(settings.engine, e);
              generationFailureBurstRef.current += 1;
              const failureMessage = formatFrontendError(e, {
                  fallback: 'Generation failed. Check runtime health and retry.',
                  context: 'generation',
                  isAdmin: hasAdminConsoleAccess,
              }).publicMessage;
              emit('generation.failed', {
                  title: 'Generation Failure',
                  message: failureMessage,
                  entityKey: generationNotificationKey,
                  dedupeKey: `generation-failed-main:${settings.engine}`,
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
      patchSingleInflightGenerationLedger,
      performGeneration,
      settings,
      showToast,
      stopSimulation,
      syncActiveGatewayIds,
      syncRuntimeBlockedStateFromError,
  ]);

  const handleGenerate = async () => {
    if (isGenerating || singleRunLockRef.current) return;
    if (studioDirectorPreview) {
      showToast('Apply or discard the AI Director preview first. The directed pass is waiting for review.', 'info');
      return;
    }
    const inflightSingle = singleInflightLedgerRef.current;
    if (inflightSingle) {
        await runSingleGeneration({ inflightLedger: inflightSingle, treatAsRecovery: true });
        return;
    }
    if (!text.trim()) return showToast("Please enter some text.", "info");
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
    if (isWalletBlocked && !canRunDunoWithoutWallet) {
      showToast(`Insufficient ${getEngineDisplayName(settings.engine)} VF balance. Open Billing to top up or upgrade.`, 'error');
      openBillingCenter();
      return;
    }
    await runSingleGeneration();
  };

  useEffect(() => {
      const inflightSingle = singleInflightLedgerRef.current;
      if (!inflightSingle) return;
      const inflightJobId = String(inflightSingle.jobId || '').trim();
      if (!inflightJobId) return;
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
  }, [clearSingleInflightGenerationLedger, isGenerating, runSingleGeneration, studioQueueState]);

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
      if (/^(?:https?:|blob:|data:)/i.test(raw)) return raw;
      const base = String(mediaBackendUrl || '').trim().replace(/\/+$/, '');
      if (!base) return raw;
      return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
  }, [mediaBackendUrl]);

  const resolveClonedVoicePlaybackUrl = useCallback((voice?: VoiceOption): string => {
      if (!voice) return '';
      const preview = resolveVoicePreviewUrl(voice);
      if (preview) return preview;
      if (!voice.isCloned) return '';
      const clonedVoice = voice as ClonedVoice;
      return String(clonedVoice.originalSampleUrl || clonedVoice.referenceAudioUrl || '').trim();
  }, [resolveVoicePreviewUrl]);

  const buildVoiceSampleSource = useCallback(async (
      voiceId: string,
      name: string,
      engine: GenerationSettings['engine'] = 'PRIME'
  ): Promise<{ url: string; needsCleanup: boolean }> => {
      const selectedVoice = getVoiceById(voiceId);
      const fallbackPreviewUrl = resolveVoicePreviewUrl(selectedVoice);
      const clonedPlaybackUrl = resolveClonedVoicePlaybackUrl(selectedVoice);

      if (clonedPlaybackUrl) {
          return { url: clonedPlaybackUrl, needsCleanup: false };
      }
      if (fallbackPreviewUrl) {
          return { url: fallbackPreviewUrl, needsCleanup: false };
      }

      await ensureEngineOnline(engine, { silent: true, syncVoiceId: voiceId, requireAccess: true });

      const previewSettings: GenerationSettings = {
          ...settings,
          engine,
          voiceId,
          speed: 1.0,
          emotion: 'Neutral',
      };

      const text = `Hello! I am ${name}. I can bring your story to life.`;

      let voiceParam = name;
      if (isGemRuntimeEngine(engine)) {
        voiceParam = getVoiceById(voiceId)?.geminiVoiceName || clonedVoices.find((voice) => voice.id === voiceId)?.geminiVoiceName || 'Fenrir';
      } else {
        voiceParam = voiceId;
      }

      const { generateSpeech } = await loadGeminiService();
      const previewRequestId = `voice-preview:${resolveEngineToken(engine)}:${String(voiceId || name || 'voice').trim().replace(/\s+/g, '_')}`;
      const buffer = await generateSpeech(
          text,
          voiceParam,
          previewSettings,
          'speech',
          undefined,
          { context: 'preview', preferLiveChunks: true, requestId: previewRequestId }
      );
      const blob = audioBufferToWav(buffer);
      return { url: URL.createObjectURL(blob), needsCleanup: true };
  }, [clonedVoices, ensureEngineOnline, getVoiceById, isGemRuntimeEngine, resolveClonedVoicePlaybackUrl, resolveVoicePreviewUrl, settings]);

  const playVoiceSample = async (voiceId: string, name: string, engine: GenerationSettings['engine'] = 'PRIME') => {
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

      const playAudioSource = async (sourceUrl: string, revokeOnEnd: boolean): Promise<void> => {
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
              if (revokeOnEnd) {
                  try {
                      URL.revokeObjectURL(sourceUrl);
                  } catch {
                      // ignore cleanup errors
                  }
              }
          };
          await audio.play();
          setPreviewState({ id: voiceId, status: 'playing' });
      };

      try {
          const sampleSource = await buildVoiceSampleSource(voiceId, name, engine);
          await playAudioSource(sampleSource.url, sampleSource.needsCleanup);
      } catch (e: any) {
          syncRuntimeBlockedStateFromError(engine, e);
          showToast(e.message, 'error');
          setPreviewState(null);
      }
  };

  const handlePreviewCharacter = async (char: CharacterProfile) => {
     const vid = char.voiceId;
       const engine: GenerationSettings['engine'] = resolveEngineToken(getVoiceById(vid)?.engine) as GenerationSettings['engine'];
      await playVoiceSample(char.voiceId, char.name, engine);
  };

  // --- Video Dubbing Functions ---

  const releaseClipArtifacts = useCallback((clip: DubbingClip | null | undefined) => {
      if (!clip) return;
      try { if (clip.objectUrl) URL.revokeObjectURL(clip.objectUrl); } catch {}
      try { if (clip.resultUrl) URL.revokeObjectURL(String(clip.resultUrl)); } catch {}
      try { if (clip.reportUrl) URL.revokeObjectURL(String(clip.reportUrl)); } catch {}
  }, []);

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []).filter((file) => Boolean(file));
      if (files.length <= 0) return;
      clearDubbingStemCache();
      const nextClips: DubbingClip[] = [];
      for (const file of files) {
          const objectUrl = URL.createObjectURL(file);
          const durationMs = await resolveClipDurationMs(file);
          nextClips.push(createDubbingClip(file, objectUrl, durationMs));
      }
      mutateDubbingTimeline((current) => [...current, ...nextClips]);
      const firstAdded = nextClips[0];
      if (firstAdded) {
          setSelectedDubbingClipId(firstAdded.id);
          patchDubbingUiState({
              phase: 'idle',
              progress: 0,
              stage: `Loaded ${nextClips.length} source clip${nextClips.length === 1 ? '' : 's'}`,
              error: '',
          });
      }
      e.target.value = '';
  };

  const handleRetryClip = useCallback((clipId: string) => {
      setDubbingClips((current) =>
          current.map((clip) =>
              clip.id === clipId
                  ? { ...clip, status: 'idle', error: '', jobId: '', resultUrl: null, reportUrl: null }
                  : clip
          )
      );
  }, []);

  const handleRemoveClipFromQueue = useCallback(
      async (clipId: string, options?: { skipHistory?: boolean }) => {
          const clip = dubbingClips.find((item) => item.id === clipId) || null;
          if (!clip) return;
          const { removeClip } = await loadDubbingTimelineService();
          const jobId = String(clip.jobId || '').trim();
          if (jobId) {
              try {
                  const { cancelDubbingJob } = await loadMediaBackendService();
                  await cancelDubbingJob(mediaBackendUrl, jobId);
              } catch {
                  // best effort cancel
              }
          }
          releaseClipArtifacts(clip);
          if (options?.skipHistory) {
              setDubbingClips((current) => removeClip(current, clipId).clips);
          } else {
              mutateDubbingTimeline((current) => removeClip(current, clipId).clips);
          }
      },
      [dubbingClips, mediaBackendUrl, mutateDubbingTimeline, releaseClipArtifacts]
  );

  const handleRemoveSelectedClip = useCallback(async () => {
      if (!selectedDubbingClipId) return;
      await handleRemoveClipFromQueue(selectedDubbingClipId);
  }, [handleRemoveClipFromQueue, selectedDubbingClipId]);

  const handleRemoveCompletedQueue = useCallback(async () => {
      const completed = dubbingClips.filter((clip) => clip.status === 'completed');
      const { removeCompletedClips } = await loadDubbingTimelineService();
      completed.forEach((clip) => releaseClipArtifacts(clip));
      mutateDubbingTimeline((current) => removeCompletedClips(current));
  }, [dubbingClips, mutateDubbingTimeline, releaseClipArtifacts]);

  const handleClearDubbingQueue = useCallback(async () => {
      const { clearAllClips } = await loadDubbingTimelineService();
      for (const clip of dubbingClips) {
          const jobId = String(clip.jobId || '').trim();
          if (jobId) {
              try {
                  const { cancelDubbingJob } = await loadMediaBackendService();
                  await cancelDubbingJob(mediaBackendUrl, jobId);
              } catch {}
          }
          releaseClipArtifacts(clip);
      }
      mutateDubbingTimeline(() => clearAllClips());
      setSelectedDubbingClipId('');
      patchDubbingUiState({
          phase: 'idle',
          progress: 0,
          stage: 'Queue cleared',
          error: '',
      });
  }, [dubbingClips, mediaBackendUrl, mutateDubbingTimeline, releaseClipArtifacts]);

  const handleTimelineUndo = useCallback(async () => {
      const { undoTimeline } = await loadDubbingTimelineService();
      setDubbingHistoryPast((past) => {
          const undone = undoTimeline(past, dubbingClips, dubbingHistoryFuture);
          if (undone.changed) {
              setDubbingClips(undone.current);
              setDubbingHistoryFuture(undone.future);
          }
          return undone.past;
      });
  }, [dubbingClips, dubbingHistoryFuture]);

  const handleTimelineRedo = useCallback(async () => {
      const { redoTimeline } = await loadDubbingTimelineService();
      setDubbingHistoryFuture((future) => {
          const redone = redoTimeline(dubbingHistoryPast, dubbingClips, future);
          if (redone.changed) {
              setDubbingClips(redone.current);
              setDubbingHistoryPast(redone.past);
          }
          return redone.future;
      });
  }, [dubbingClips, dubbingHistoryPast]);

  const handleDubbingTimelineTool = useCallback(async (tool: 'cut' | 'copy' | 'paste' | 'split' | 'trim_in' | 'trim_out' | 'layer' | 'remove') => {
      if (!selectedDubbingClipId) {
          showToast('Select a clip first.', 'info');
          return;
      }
      const timelineService = await loadDubbingTimelineService();
      if (tool === 'copy') {
          const copied = timelineService.copyClip(dubbingClips, selectedDubbingClipId);
          if (!copied) {
              showToast('Unable to copy selected clip.', 'error');
              return;
          }
          setDubbingClipboard(copied);
          showToast('Clip copied.', 'success');
          return;
      }
      if (tool === 'paste') {
          let pastedAny = false;
          mutateDubbingTimeline((current) => {
              const pasted = timelineService.pasteClipAfterSelection(current, selectedDubbingClipId, dubbingClipboard);
              pastedAny = Boolean(pasted.pastedId);
              if (pasted.pastedId) setSelectedDubbingClipId(String(pasted.pastedId));
              return pasted.clips;
          });
          showToast(pastedAny ? 'Clip pasted.' : 'Clipboard is empty.', pastedAny ? 'success' : 'info');
          return;
      }
      if (tool === 'cut') {
          mutateDubbingTimeline((current) => timelineService.cutClip(current, selectedDubbingClipId).clips);
          showToast('Clip cut from timeline.', 'success');
          return;
      }
      if (tool === 'split') {
          let didSplit = false;
          mutateDubbingTimeline((current) => {
              const split = timelineService.splitClipAtPlayhead(current, selectedDubbingClipId, dubbingPlayheadMs);
              didSplit = Boolean(split.splitIds);
              if (split.splitIds?.[1]) setSelectedDubbingClipId(String(split.splitIds[1]));
              return split.clips;
          });
          showToast(
              didSplit ? 'Clip split at playhead.' : 'Move playhead inside clip window to split.',
              didSplit ? 'success' : 'info'
          );
          return;
      }
      if (tool === 'trim_in') {
          mutateDubbingTimeline((current) =>
              timelineService.trimClipWindow(current, selectedDubbingClipId, { trimInMs: Math.max(0, dubbingPlayheadMs) })
          );
          showToast('Trim-in updated.', 'success');
          return;
      }
      if (tool === 'trim_out') {
          mutateDubbingTimeline((current) =>
              timelineService.trimClipWindow(current, selectedDubbingClipId, { trimOutMs: Math.max(0, dubbingPlayheadMs) })
          );
          showToast('Trim-out updated.', 'success');
          return;
      }
      if (tool === 'layer') {
          const target = dubbingClips.find((clip) => clip.id === selectedDubbingClipId);
          const nextLayer: DubbingClip['layer'] = target?.layer === 'V2' ? 'V1' : 'V2';
          mutateDubbingTimeline((current) => timelineService.moveClipLayer(current, selectedDubbingClipId, nextLayer));
          showToast(`Moved clip to Layer ${nextLayer}.`, 'success');
          return;
      }
      void handleRemoveSelectedClip();
      showToast('Clip removed.', 'success');
  }, [
      dubbingClips,
      dubbingClipboard,
      dubbingPlayheadMs,
      handleRemoveSelectedClip,
      mutateDubbingTimeline,
      selectedDubbingClipId,
      showToast,
  ]);

  const handleTranslateVideo = async (mode: 'transcribe' | 'translate' = 'transcribe') => {
      if (!videoFile) return showToast("Upload a video first", "info");
      setIsProcessingVideo(true);
      patchDubbingUiState({
          phase: 'running',
          progress: 8,
          stage: 'Extracting dialogue stems...',
          error: '',
      });
      try {
          setProcessingStage(sanitizeUiText('Extracting audio and separating dialogue/bed...'));
          const stemCache = await ensureDubbingStemCache(videoFile);
          patchDubbingUiState({
              phase: 'running',
              progress: 24,
              stage: 'Transcribing source audio...',
              error: '',
          });

          const task = mode === 'translate' && targetLang === 'English' ? 'translate' : 'transcribe';
          const { transcribeVideoWithBackend } = await loadMediaBackendService();
          const backendResult = await transcribeVideoWithBackend(mediaBackendUrl, stemCache.speechFile, {
              language: settings.dubbingSourceLanguage || 'auto',
              task,
              captureEmotions: true,
              speakerLabel: 'Speaker 1',
          });

          let nextScript = backendResult.script;
          if (mode === 'translate' && targetLang !== 'English') {
              setProcessingStage(sanitizeUiText(`Translating script to ${targetLang}...`));
              patchDubbingUiState({
                  phase: 'running',
                  progress: 62,
                  stage: `Translating to ${targetLang}...`,
                  error: '',
              });
              const { translateText } = await loadGeminiService();
              nextScript = await translateText(backendResult.script, targetLang, settings);
          }

          setDubScript(nextScript);
          const discoveredSpeakers = Array.from(new Set((backendResult.segments || []).map((seg) => String(seg.speaker || '').trim()).filter(Boolean)));
          if (discoveredSpeakers.length > 0) {
              setDetectedSpeakers(discoveredSpeakers);
              syncCast(discoveredSpeakers);
          }
          const lineCount = Array.isArray(backendResult.segments) ? backendResult.segments.length : 0;
          const emotionState = backendResult.emotionCapture?.enabled ? 'emotion captured' : 'emotion fallback';
          showToast(
              mode === 'translate'
                  ? `Dubbing script ready (${lineCount} segments, ${emotionState}).`
                  : `Transcription complete (${lineCount} segments, ${emotionState}).`,
              "success"
          );
          patchDubbingUiState({
              phase: 'done',
              progress: 100,
              stage: mode === 'translate' ? `Script translated to ${targetLang}` : 'Transcription complete',
              error: '',
          });
      } catch (e: any) {
          try {
              const lang = mode === 'translate' ? targetLang : 'Original';
              const { translateVideoContent } = await loadGeminiService();
              const fallback = await translateVideoContent(videoFile, lang, settings);
              setDubScript(fallback);
              showToast('Used fallback transcription path.', 'info');
              patchDubbingUiState({
                  phase: 'done',
                  progress: 100,
                  stage: 'Fallback transcription complete',
                  error: '',
              });
          } catch (fallbackError: any) {
              const message = fallbackError?.message || e?.message || 'Video processing failed.';
              patchDubbingUiState({
                  phase: 'error',
                  progress: 100,
                  stage: 'Transcription failed',
                  error: message,
              });
              showToast(fallbackError?.message || e?.message || 'Video processing failed.', 'error');
          }
      } finally {
          setIsProcessingVideo(false);
      }
  };

  const handleDubbingEditorTool = (mode: 'clean' | 'speakerize' | 'dedupe' | 'compact') => {
      const nextValue = runDubbingEditorTool(dubScript, mode);
      if (!nextValue) {
          showToast('Editor tool produced empty output. Script unchanged.', 'info');
          return;
      }
      setDubScript(nextValue);
      const labels: Record<typeof mode, string> = {
          clean: 'Cleaned script spacing and punctuation.',
          speakerize: 'Applied "[Speaker Name]:" tags to dialogue lines.',
          dedupe: 'Removed duplicate consecutive lines.',
          compact: 'Compacted script to non-empty lines.',
      };
      showToast(labels[mode], 'success');
  };

  const handleGenerateDub = async () => {
      if (dubbingClips.length <= 0) return showToast("Upload at least one video first", "info");
      if (isWalletBlocked && !canRunDunoWithoutWallet) {
          showToast(`Insufficient ${getEngineDisplayName(settings.engine)} VF balance. Open Billing to top up or upgrade.`, 'error');
          openBillingCenter();
          return;
      }

      if (generationAbortController.current) generationAbortController.current.abort();
      const controller = new AbortController();
      generationAbortController.current = controller;
      activeDubbingJobIdRef.current = '';
      if (dubbingJobResultUrl) {
          URL.revokeObjectURL(dubbingJobResultUrl);
          setDubbingJobResultUrl(null);
      }
      if (dubbingReportUrl) {
          URL.revokeObjectURL(dubbingReportUrl);
          setDubbingReportUrl(null);
      }
      if (renderedDubVideoUrl) {
          URL.revokeObjectURL(renderedDubVideoUrl);
          setRenderedDubVideoUrl(null);
      }
      if (dubAudioUrl) {
          URL.revokeObjectURL(dubAudioUrl);
          setDubAudioUrl(null);
      }

      const phaseLabels: Record<string, string> = {
          acoustic_isolation: 'Phase 1/6: Acoustic isolation',
          speaker_segmentation: 'Phase 2/6: Speaker segmentation',
          translation: 'Phase 3/6: Segment translation',
          tts: 'Phase 4/6: PRIME TTS',
          voice_transfer: 'Phase 5/6: Voice transfer',
          video_lipsync: 'Phase 6/6: Video lip-sync',
          preflight: 'Preflight checks',
          queued: 'Queued',
      };
      const {
        transcribeVideoWithBackend,
        createDubbingJobV2,
        getDubbingJob,
        downloadDubbingChunk,
        downloadDubbingResult,
        downloadDubbingReport,
      } = await loadMediaBackendService();

      resetDubbingLivePlayback();
      const generationNotificationKey = `async-job:${settings.engine}`;
      startSimulation(26, 'Submitting backend async job...', 'live');
      patchDubbingUiState({
          phase: 'running',
          progress: 6,
          stage: 'Queue started (CPU sequential mode)',
          error: '',
      });
      emit('generation.started', {
          title: 'Generation Started',
          message: 'Generation started for async queue workflow.',
          entityKey: generationNotificationKey,
          dedupeKey: `generation-started-async:${settings.engine}`,
          channel: 'inbox',
      });

      const queue = dubbingClips.filter((clip) => clip.status !== 'completed');
      if (queue.length <= 0) {
          patchDubbingUiState({
              phase: 'done',
              progress: 100,
              stage: 'All clips already completed',
              error: '',
          });
          stopSimulation();
          generationAbortController.current = null;
          return;
      }

      try {
          const targetLanguageHint =
              targetLang === 'Hinglish'
                  ? 'hi'
                  : (String(targetLang || settings.language || 'auto').toLowerCase() || 'auto');
          let completedCount = 0;
          for (let index = 0; index < queue.length; index += 1) {
              if (controller.signal.aborted) break;
              const clip = queue[index];
              if (!clip) continue;
              try {
                  setSelectedDubbingClipId(clip.id);
                  setDubbingClips((current) =>
                      current.map((item) => (item.id === clip.id ? { ...item, status: 'running', error: '' } : item))
                  );
                  patchDubbingUiState({
                      phase: 'running',
                      progress: Math.max(8, Math.round((index / Math.max(1, queue.length)) * 92)),
                      stage: `Processing clip ${index + 1}/${queue.length}: ${clip.file.name}`,
                      error: '',
                  });

                  let resolvedScript = String(clip.script || '').trim();
                  if (!resolvedScript) {
                      setDubbingClips((current) =>
                          current.map((item) => (item.id === clip.id ? { ...item, status: 'transcribing', error: '' } : item))
                      );
                      const transcribeResult = await transcribeVideoWithBackend(mediaBackendUrl, clip.file, {
                          language: settings.dubbingSourceLanguage || 'auto',
                          task: 'transcribe',
                          captureEmotions: true,
                          speakerLabel: 'Speaker 1',
                      });
                      resolvedScript = String(transcribeResult.script || '').trim();
                      setDubbingClips((current) =>
                          current.map((item) =>
                              item.id === clip.id ? { ...item, script: resolvedScript, status: 'queued', error: '' } : item
                          )
                      );
                      if (selectedDubbingClipId === clip.id) setDubScript(resolvedScript);
                  }
                  if (!resolvedScript) {
                      throw new Error(`Clip ${clip.file.name} has empty script after transcription.`);
                  }

                  const advancedPayload: Record<string, unknown> = {
                      processing_profile: dubbingCpuProfile,
                      tts_route: 'gem_only',
                      engine_policy: 'auto_reliable',
                      multispeaker_policy: 'hybrid_auto',
                      voice_binding_policy: 'stable_fallback',
                      qos_policy: 'adaptive_hq_first',
                      hardware_policy: 'gpu_preferred',
                      timeout_policy: 'adaptive',
                      source_language_mode: 'auto_per_segment',
                      language_coverage_profile: 'core12',
                      live_play_mode: 'progressive_audio',
                      live_chunk_target_ms: 3000,
                      live_include_chunk_audio: false,
                      max_speaker_count: 8,
                      segment_failure_policy: 'hard_fail',
                      clone_scope: 'job_only',
                      transcript_override: resolvedScript,
                      clip_window: { start_ms: Math.max(0, clip.trimInMs), end_ms: Math.max(clip.trimInMs + 240, clip.trimOutMs) },
                      voice_map: settings.speakerMapping || {},
                      preserve_voice_tone: Boolean(settings.preserveDubVoiceTone),
                  };
                  advancedPayload.voice_model = settings.voiceModel;

                  const created = await createDubbingJobV2(mediaBackendUrl, clip.file, {
                      targetLanguage: targetLanguageHint,
                      mode: 'strict_full',
                      output: 'audio+video',
                      advanced: advancedPayload,
                  });
                  const jobId = String(created.job_id || '').trim();
                  if (!jobId) throw new Error('Backend did not return an async job id.');
                  activeDubbingJobIdRef.current = jobId;
                  setDubbingClips((current) =>
                      current.map((item) => (item.id === clip.id ? { ...item, status: 'running', jobId, error: '' } : item))
                  );
                  dubbingLiveChunkCursorRef.current = 0;
                  dubbingLiveSeenChunkKeysRef.current = new Set();

                  while (!controller.signal.aborted) {
                      const statusPayload = await getDubbingJob(mediaBackendUrl, jobId, {
                          includeChunks: true,
                          chunkCursor: Math.max(0, Math.floor(Number(dubbingLiveChunkCursorRef.current || 0))),
                          chunkLimit: 4,
                          includeChunkAudio: false,
                      });
                      const job = statusPayload?.job || {};
                      const jobStatus = String(job.status || '').toLowerCase();
                      const stageKey = String(job.stage || '').trim();
                      const progressPct = Math.max(0, Math.min(100, Number(job.progress || 0)));
                      const stageLabel = phaseLabels[stageKey] || (stageKey ? stageKey.replace(/_/g, ' ') : 'Running backend pipeline');
                      const chunks = Array.isArray((job as any).chunks) ? (job as any).chunks : [];
                      const speakerStats = ((job as any).speakerStats && typeof (job as any).speakerStats === 'object')
                          ? (job as any).speakerStats as Record<string, unknown>
                          : {};
                      const qosState = ((job as any).qosState && typeof (job as any).qosState === 'object')
                          ? (job as any).qosState as Record<string, unknown>
                          : {};
                      const detectedSpeakers = Number(speakerStats.detectedSpeakers || 0);
                      const selectedProfile = String(qosState.selectedProfile || '').trim();

                      for (const chunk of chunks) {
                          if (!chunk || typeof chunk !== 'object') continue;
                          const chunkIndex = Number((chunk as any).index);
                          if (!Number.isFinite(chunkIndex) || chunkIndex < 0) continue;
                          const safeIndex = Math.round(chunkIndex);
                          const chunkKey = `${jobId}:${safeIndex}`;
                          if (dubbingLiveSeenChunkKeysRef.current.has(chunkKey)) continue;

                          try {
                              const chunkBlob = await downloadDubbingChunk(mediaBackendUrl, jobId, safeIndex);
                              if (chunkBlob.size > 0) {
                                  enqueueDubbingLiveChunk(chunkBlob);
                                  dubbingLiveSeenChunkKeysRef.current.add(chunkKey);
                              }
                          } catch {
                              const inlineBase64 = String((chunk as any).audioBase64 || '').trim();
                              if (!inlineBase64) continue;
                              try {
                                  const binary = atob(inlineBase64);
                                  const bytes = new Uint8Array(binary.length);
                                  for (let i = 0; i < binary.length; i += 1) {
                                      bytes[i] = binary.charCodeAt(i);
                                  }
                                  const blob = new Blob([bytes], { type: String((chunk as any).contentType || 'audio/wav') });
                                  enqueueDubbingLiveChunk(blob);
                                  dubbingLiveSeenChunkKeysRef.current.add(chunkKey);
                              } catch {
                                  // ignore malformed inline chunk payload
                              }
                          }
                      }

                      const responseChunkCursorNext = Number((job as any).chunkCursorNext || ((job as any).live || {}).chunkCursorNext || 0);
                      if (Number.isFinite(responseChunkCursorNext) && responseChunkCursorNext >= 0) {
                          dubbingLiveChunkCursorRef.current = Math.max(dubbingLiveChunkCursorRef.current, Math.round(responseChunkCursorNext));
                      } else if (chunks.length > 0) {
                          const maxChunkIndex = chunks.reduce((max: number, item: any) => {
                              const idx = Number(item?.index);
                              if (!Number.isFinite(idx)) return max;
                              return Math.max(max, Math.round(idx));
                          }, -1);
                          if (maxChunkIndex >= 0) {
                              dubbingLiveChunkCursorRef.current = Math.max(dubbingLiveChunkCursorRef.current, maxChunkIndex + 1);
                          }
                      }

                      if (jobStatus === 'queued' || jobStatus === 'running' || jobStatus === 'cancelling') {
                          const safeProgress = Math.max(10, Math.min(97, progressPct || 10));
                          setLiveProgress(safeProgress, stageLabel);
                          const speakerToken = detectedSpeakers > 0 ? `spk:${detectedSpeakers}` : 'spk:-';
                          const qosToken = selectedProfile ? `qos:${selectedProfile}` : 'qos:auto';
                          patchDubbingUiState({
                              phase: 'running',
                              progress: safeProgress,
                              stage: joinUiFragments([`${stageLabel} (${index + 1}/${queue.length})`, speakerToken, qosToken]),
                              error: '',
                          });
                      }

                      if (jobStatus === 'completed') {
                          const [resultBlob, reportBlob] = await Promise.all([
                              downloadDubbingResult(mediaBackendUrl, jobId),
                              downloadDubbingReport(mediaBackendUrl, jobId).catch(() => null),
                          ]);
                          const resultUrl = URL.createObjectURL(resultBlob);
                          const reportUrl = reportBlob ? URL.createObjectURL(reportBlob) : null;
                          setDubbingClips((current) =>
                              current.map((item) =>
                                  item.id === clip.id
                                      ? { ...item, status: 'completed', jobId, resultUrl, reportUrl, error: '' }
                                      : item
                              )
                          );
                          setDubbingJobResultUrl(resultUrl);
                          setDubbingReportUrl(reportUrl);
                          const outputFiles = job.outputFiles as Record<string, any> | undefined;
                          const hasVideoOutput =
                              String(resultBlob.type || '').toLowerCase().includes('video') || Boolean(outputFiles?.video?.path);
                          if (hasVideoOutput) {
                              setRenderedDubVideoUrl(resultUrl);
                          } else {
                              setDubAudioUrl(resultUrl);
                          }
                          completedCount += 1;
                          break;
                      }

                      if (jobStatus === 'failed') {
                          throw new Error(String(job.error || job.errorCode || 'Dubbing job failed.'));
                      }
                      if (jobStatus === 'cancelled') {
                          throw new DOMException('Dubbing cancelled', 'AbortError');
                      }

                      await new Promise((resolve) => setTimeout(resolve, 1600));
                  }
              } catch (clipError: any) {
                  if (clipError?.name === 'AbortError') {
                      throw clipError;
                  }
                  const clipErrorMessage = formatFrontendError(clipError, {
                      fallback: 'Clip async generation failed.',
                      context: 'generation',
                      isAdmin: hasAdminConsoleAccess,
                  }).publicMessage;
                  setDubbingClips((current) =>
                      current.map((item) =>
                          item.id === clip.id
                              ? { ...item, status: 'failed', error: clipErrorMessage || 'Clip async generation failed' }
                              : item
                      )
                  );
                  continue;
              }
          }
          generationFailureBurstRef.current = 0;
          patchDubbingUiState({
              phase: completedCount > 0 ? 'done' : 'idle',
              progress: completedCount > 0 ? 100 : 0,
              stage: completedCount > 0
                  ? `AI Dub completed for ${completedCount}/${queue.length} clips`
                  : 'AI Dub queue finished',
              error: '',
          });
          showToast(`AI Dub completed for ${completedCount}/${queue.length} clips.`, completedCount > 0 ? 'success' : 'info');
      } catch (e: any) {
          if (e?.name === 'AbortError') {
              patchDubbingUiState({
                  phase: 'idle',
                  progress: 0,
                  stage: 'Dubbing cancelled',
                  error: '',
              });
              showToast('Dubbing cancelled.', 'info');
          } else {
              syncRuntimeBlockedStateFromError(settings.engine, e);
              generationFailureBurstRef.current += 1;
              const dubbingFailureMessage = formatFrontendError(e, {
                  fallback: 'Generation failed. Check backend health and retry.',
                  context: 'generation',
                  isAdmin: hasAdminConsoleAccess,
              }).publicMessage;
              emit('generation.failed', {
                  title: 'Generation Failure',
                  message: dubbingFailureMessage,
                  entityKey: generationNotificationKey,
                  dedupeKey: `generation-failed-async:${settings.engine}`,
                  action: {
                      label: 'Open Settings',
                      onClick: () => setShowSettings(true),
                  },
              });
              patchDubbingUiState({
                  phase: 'error',
                  progress: 100,
                  stage: 'Dubbing failed',
                  error: dubbingFailureMessage || 'Unknown async job error',
              });
              showToast(dubbingFailureMessage || 'Dubbing failed.', 'error');
          }
      } finally {
          activeDubbingJobIdRef.current = '';
          resetDubbingLivePlayback();
          stopSimulation();
          generationAbortController.current = null;
      }
  };

  const toggleDubPlayback = () => {
      const video = videoRef.current;
      const audio = dubAudioRef.current;
      if (!video) return;

      if (isPlayingDub) {
          video.pause();
          if (audio) audio.pause();
          setIsPlayingDub(false);
      } else {
          video.play();
          if (audio) audio.play();
          setIsPlayingDub(true);
      }
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
      const currentText = false ? dubScript : text;
      const setFn = false ? setDubScript : setText;
      
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
      if (!safeInput.trim()) return showToast('Enter text first', 'info');
      const activeDirectorModes = describeStudioDirectorModeState(studioDirectorModeState);
      const directorOptions = studioDirectorModeState.expressiveEmotion || studioDirectorModeState.autoRewrite
        ? {
            style: 'natural' as const,
            tone: studioDirectorModeState.expressiveEmotion ? 'dramatic' as const : 'neutral' as const,
            expressiveEmotion: studioDirectorModeState.expressiveEmotion,
            autoRewrite: studioDirectorModeState.autoRewrite,
          }
        : undefined;
      setIsAiWriting(true);
      try {
          const { autoDirectStudioScript } = await loadGeminiService();
          const { mood, cast, directedText } = await autoDirectStudioScript(safeInput, settings, directorOptions, characterLibrary);
          const tagInjection = injectDirectorTagsPreservingFormat(safeInput, directedText || safeInput);
          const previewText = String(tagInjection.text || directedText || safeInput);
          const castNames = cast
              .map((entry) => String(entry.name || '').trim())
              .filter((name) => name.length > 0);
          const hasPreviewChange = normalizeDirectorPreviewComparisonText(previewText) !== normalizeDirectorPreviewComparisonText(safeInput);

          if (hasPreviewChange) {
              const previewMood = String(mood || '').trim();
              setStudioDirectorPreview({
                  sourceText: safeInput,
                  previewText,
                  castNames,
                  modeLabel: activeDirectorModes,
                  patchedLineCount: tagInjection.patchedLineCount,
                  ...(previewMood ? { mood: previewMood } : {}),
              });
              showToast(
                  `AI Director (${activeDirectorModes}) preview ready${castNames.length > 0 ? ` with ${castNames.length} speaker${castNames.length === 1 ? '' : 's'}` : ''}.`,
                  'success'
              );
              return;
          }

          if (castNames.length > 0) {
              startTransition(() => {
                  setDetectedSpeakers(castNames);
              });
              showToast(`AI Director (${activeDirectorModes}) identified ${castNames.length} speaker${castNames.length === 1 ? '' : 's'}.`, 'success');
          } else {
              showToast(`No preview-worthy changes found. Mode: ${activeDirectorModes}. Mood: ${mood || 'Neutral'}`, 'info');
          }

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
                  const extracted = await extractNovelTextFromFile(mediaBackendUrl, file, 'auto');
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
  }, [mediaBackendUrl, showToast, toUserFriendlySystemMessage]);

  const handleStudioImportInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
          void handleStudioImportFiles(files);
      }
      event.target.value = '';
  }, [handleStudioImportFiles]);
  
  const handleTranslate = async () => {
      if (!requireSignedInForAiTool('Translate')) return;
      const isDubbing = false;
      const currentText = isDubbing ? dubScript : text;
      const setFn = isDubbing ? setDubScript : setText;
      
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

      const context = false ? dubScript : text;

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
      dubScript,
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
      return {
          ...baseSettings,
          runtimeProvider: ttsRuntimeStatus[baseSettings.engine]?.provider || '',
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
          if (voice?.id) dedup.set(voice.id, voice);
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
  const getEngineLabel = (engine: GenerationSettings['engine']) => getEngineDisplayName(engine);
  const getEngineSubLabel = (engine: GenerationSettings['engine']) => (
    engine === 'DUNO'
      ? 'DeepInfra Runtime'
      : engine === 'VECTOR'
      ? 'Cloud Runtime'
      : 'Cloud Runtime'
  );
  const getEngineDescription = (engine: GenerationSettings['engine']) => {
    if (engine === 'DUNO') return 'Backend-routed DUNO engine tuned for fast startup, built-in voice cloning, and low-latency playback.';
    if (engine === 'VECTOR') return 'Balanced cloud engine for clear narration and dependable multilingual output.';
    return 'Premium cloud engine for richer expression, stronger direction follow-through, and complex scenes.';
  };
  const getRuntimeOfflineMessage = (engine: GenerationSettings['engine']) => (
    engine === 'DUNO'
      ? 'DUNO runtime is unavailable. Check the runtime endpoint or retry once it recovers.'
      : `${getEngineDisplayName(engine)} runtime is offline. Start services or retry activation.`
  );
  const getRuntimeNotConfiguredMessage = (engine: GenerationSettings['engine']) => (
    engine === 'DUNO'
      ? 'DUNO runtime is not configured. Add `VF_DUNO_RUNTIME_URL` in backend settings.'
      : `${getEngineDisplayName(engine)} runtime is not configured.`
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

      const nextVoiceId = getValidVoiceIdForEngine(targetEngine, settings.voiceId);

      setSettings(prev => {
          const catalog = getEngineVoiceCatalog(targetEngine);
          const fallbackVoiceId = getValidVoiceIdForEngine(targetEngine, catalog[0]?.id || nextVoiceId || prev.voiceId);
          const refreshedMapping: Record<string, string> = {};
          Object.entries(prev.speakerMapping || {}).forEach(([speaker, mappedVoiceId]) => {
              refreshedMapping[speaker] = getValidVoiceIdForEngine(targetEngine, mappedVoiceId || fallbackVoiceId);
          });
          return {
              ...prev,
              engine: targetEngine,
              voiceId: getValidVoiceIdForEngine(targetEngine, prev.voiceId),
              speakerMapping: refreshedMapping,
          };
      });

      try {
          if (targetEngine !== 'DUNO') {
              await ensureEngineOnline(targetEngine, { syncVoiceId: nextVoiceId });
              return;
          }
          await ensureEngineOnline(targetEngine, { syncVoiceId: nextVoiceId });
      } catch (error: any) {
          showToast(`Failed to activate ${getEngineLabel(targetEngine)}: ${error?.message || 'Unknown error'}`, 'error');
      }
  };
  const workspaceTabs = useMemo(() => buildWorkspaceTabs(hasAdminConsoleAccess), [hasAdminConsoleAccess]);
  const contentMaxWidthClass = isStudioWorkspaceTab
      ? 'max-w-[1320px]'
      : activeTab === Tab.READER || activeTab === Tab.VOICE_CLONING
        ? 'max-w-[1360px]'
        : 'max-w-5xl';
  const isStandaloneReaderRoute = String(pathname || '').trim().toLowerCase().startsWith('/reader');

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
      const preloadActive = TAB_PRELOADERS[activeTab];
      if (preloadActive) {
          void preloadActive();
      }
      const nextTab = resolveWorkspaceNextPreloadTab(workspaceTabs, activeTab, {
        allowReaderPreload: ENABLE_STUDIO_READER_PRELOAD,
        allowNextPreloadFromStudio: ENABLE_STUDIO_READER_PRELOAD,
      });
      const preloadNext = nextTab ? TAB_PRELOADERS[nextTab] : undefined;
      if (!preloadNext) return undefined;
      const win = typeof window !== 'undefined'
        ? window as Window & { requestIdleCallback?: (callback: IdleRequestCallback) => number; cancelIdleCallback?: (id: number) => void }
        : undefined;
      if (win?.requestIdleCallback) {
          const idleId = win.requestIdleCallback(() => { void preloadNext(); });
          return () => win.cancelIdleCallback?.(idleId);
      }
      const timeoutId = window.setTimeout(() => { void preloadNext(); }, 300);
      return () => window.clearTimeout(timeoutId);
  }, [activeTab, workspaceTabs]);
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
    const libraryWorkspaceTabs = primaryWorkspaceTabs.filter((item) => item.section === 'library');
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
          {libraryWorkspaceTabs.length > 0 ? (
            <div className="space-y-1">
              {!isDesktopCompact && (
                <p className={sectionHeaderClassName}>{WORKSPACE_NAV_SECTION_LABELS.library}</p>
              )}
              {libraryWorkspaceTabs.map((item) => (
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

        {false && (
        <div className="px-4 pb-4">
          <div className={`vf-sidebar-balance rounded-2xl border p-3 shadow-sm ${
            isDarkUi ? 'border-slate-800 bg-slate-900/75 shadow-black/20' : 'border-gray-200 bg-white'
          }`}>
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

            {!hasUnlimitedAccess && (
              <>
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
                  {primeAllowedEngines.map((engine) => getEngineDisplayName(engine)).join(', ')}
                </strong>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span>Token-pack savings</span>
                <strong className={isDarkUi ? 'text-slate-100' : 'text-slate-900'}>
                  {tokenPackDiscountPercent > 0 ? `${tokenPackDiscountPercent}% off` : 'No plan discount'}
                </strong>
              </div>
            </div>

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
                Purchase {selectedTokenPackMeta.label}
              </button>
            </div>
            <div className="mt-2">
              <label className={`mb-1 block text-[10px] font-semibold uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                Token Pack
              </label>
              <select
                value={selectedTokenPack}
                onChange={(event) => setSelectedTokenPack(event.target.value as TokenPackKey)}
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
        </div>
        )}
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
                    {user.avatarUrl ? <img src={user.avatarUrl} className="h-full w-full rounded-full object-cover" alt={`${user.name} avatar`} /> : user.name[0]}
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
                    {user.avatarUrl ? <img src={user.avatarUrl} className="h-full w-full rounded-full object-cover" alt={`${user.name} avatar`} /> : user.name[0]}
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
        ? 'space-y-3 rounded-xl border border-slate-700 bg-slate-900/70 p-3.5'
        : 'space-y-3 rounded-xl border border-slate-200 bg-white p-3.5';
      const settingsLabelClass = isDarkUi
        ? 'mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400'
        : 'mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500';

      return (
      <div
          className="vf-scrim vf-scrim--drawer fixed inset-0 z-50 flex justify-end"
          onClick={() => setShowSettings(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Configuration panel"
      >
          <div
              className={`h-full w-full max-w-[29rem] shadow-2xl animate-in slide-in-from-right duration-200 flex flex-col ${
                isDarkUi
                  ? 'bg-slate-950/95 border-l border-slate-700/70'
                  : 'bg-slate-50/95 border-l border-slate-200'
              }`}
              onClick={(event) => event.stopPropagation()}
              ref={settingsPanelRef}
              tabIndex={-1}
          >
              <div className={`p-4 border-b z-10 ${
                isDarkUi ? 'border-slate-800 bg-slate-950/90' : 'border-slate-200 bg-slate-50/95'
              }`}>
                  <div className="flex items-start justify-between gap-3">
                      <div>
                          <h2 className={`text-base font-bold flex items-center gap-2 ${isDarkUi ? 'text-slate-100' : 'text-slate-900'}`}>
                              <Settings size={16} className="text-indigo-500" />
                              Workspace Settings
                          </h2>
                      </div>
                      <button
                        onClick={() => setShowSettings(false)}
                        className={`p-2 rounded-full transition-colors ${isDarkUi ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-200 text-slate-700'}`}
                        aria-label="Close settings panel"
                      >
                        <X size={18}/>
                      </button>
                  </div>
              </div>

              <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${isDarkUi ? 'bg-slate-950/90' : 'bg-slate-100/60'}`}>
                  {/* Appearance */}
                  <section>
                      <label className={settingsLabelClass}>Appearance</label>
                      <div className={settingsCardClass}>
                          <div>
                              <div className={`text-[10px] font-bold uppercase mb-2 flex items-center gap-1 ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                  <Palette size={12} /> Theme
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                  <button
                                      onClick={() => setUiTheme('light')}
                                      className={`px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-colors flex items-center justify-center gap-1 ${
                                          uiTheme === 'light'
                                            ? isDarkUi
                                              ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-200'
                                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                            : isDarkUi
                                              ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                      }`}
                                  >
                                      <Sun size={12} /> Light
                                  </button>
                                  <button
                                      onClick={() => setUiTheme('dark')}
                                      className={`px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-colors flex items-center justify-center gap-1 ${
                                          uiTheme === 'dark'
                                            ? isDarkUi
                                              ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-200'
                                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                            : isDarkUi
                                              ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                      }`}
                                  >
                                      <Moon size={12} /> Dark
                                  </button>
                                  <button
                                      onClick={() => setUiTheme('system')}
                                      className={`px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-colors flex items-center justify-center gap-1 ${
                                          uiTheme === 'system'
                                            ? isDarkUi
                                              ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-200'
                                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                            : isDarkUi
                                              ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                      }`}
                                  >
                                      <Laptop size={12} /> System
                                  </button>
                              </div>
                              <div className="mt-4">
                                  <div className={`mb-2 flex items-center gap-1 text-[10px] font-bold uppercase ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                      <Sparkles size={12} /> Brand palette
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                      {UI_BRAND_THEME_ORDER.map((brandId) => {
                                          const theme = UI_BRAND_THEME_CONFIGS[brandId];
                                          const active = uiBrandTheme === brandId;
                                                  return (
                                                  <button
                                                          key={brandId}
                                                          type="button"
                                                          onClick={() => setUiBrandTheme(brandId)}
                                                  className={`vf-brand-chip flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors ${
                                                      active
                                                        ? 'text-white border-transparent'
                                                        : 'bg-[color:var(--vf-surface-soft)] text-[color:var(--vf-text-muted)] border-[color:var(--vf-border)] hover:bg-[color:var(--vf-surface-muted)]'
                                                  }`}
                                                  aria-pressed={active}
                                                  data-active={active}
                                                  data-brand-theme={brandId}
                                                  >
                                                      <span
                                                      className="vf-brand-swatch h-3.5 w-3.5 shrink-0 rounded-full border border-white/30"
                                                      style={{ background: `linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent2} 55%, ${theme.accent3} 100%)` }}
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
                              <div className="mt-2 text-[10px] text-[color:var(--vf-text-muted)]">Active: {uiTheme === 'system' ? `System (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})` : uiTheme === 'dark' ? 'Dark' : 'Light'} · {UI_BRAND_THEME_CONFIGS[uiBrandTheme].label}</div>
                          </div>

                          <div className={`flex items-center justify-between p-2.5 rounded-lg border ${isDarkUi ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
                              <span className={`text-[11px] font-semibold flex items-center gap-1.5 ${isDarkUi ? 'text-slate-200' : 'text-gray-700'}`}>
                                  {uiDensity === 'compact' ? <Minimize2 size={11} /> : <Maximize2 size={11} />} Compact Density
                              </span>
                              <button
                                  type="button"
                                  onClick={() => setUiDensity(d => d === 'compact' ? 'comfortable' : 'compact')}
                                  className={`relative h-5 w-9 rounded-full transition-colors ${uiDensity === 'compact' ? 'bg-indigo-500' : isDarkUi ? 'bg-slate-600' : 'bg-gray-300'}`}
                                  aria-label="Toggle interface density"
                                  aria-pressed={uiDensity === 'compact'}
                              >
                                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${uiDensity === 'compact' ? 'translate-x-4' : ''}`}></span>
                              </button>
                          </div>

                          <div className={`p-2.5 rounded-lg border ${isDarkUi ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
                              <div className={`text-[11px] font-semibold mb-2 ${isDarkUi ? 'text-slate-200' : 'text-gray-700'}`}>Motion</div>
                              <div className="grid grid-cols-3 gap-2">
                                  {(['off', 'balanced', 'rich'] as const).map((level) => {
                                      const active = uiMotionLevel === level;
                                      return (
                                          <button
                                              key={level}
                                              type="button"
                                              onClick={() => setUiMotionLevel(level)}
                                              className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold capitalize transition-colors ${
                                                  active
                                                    ? isDarkUi
                                                      ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-300'
                                                      : 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                                    : isDarkUi
                                                      ? 'border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-800'
                                                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
                                              }`}
                                          >
                                              {level}
                                          </button>
                                      );
                                  })}
                              </div>
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
                        <div className="grid grid-cols-1 gap-2">
                          {ENGINE_ORDER.map(engine => {
                              const isActive = settings.engine === engine;
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
                                      className={`p-2.5 rounded-xl border transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] flex items-center gap-2.5 ${
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
                                      {engine === 'DUNO' && <Cpu size={18} className={`shrink-0 ${isActive ? 'text-cyan-500' : isDarkUi ? 'text-slate-400' : 'text-gray-400'}`} />}
                                      <div className="flex-1 min-w-0">
                                          <div className={`font-semibold text-xs ${isDarkUi ? 'text-slate-100' : 'text-slate-800'}`}>{getEngineLabel(engine)} Runtime</div>
                                          <div className={`text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{getEngineSubLabel(engine)}</div>
                                          <div className={`mt-1 text-[10px] leading-4 ${isDarkUi ? 'text-slate-300' : 'text-slate-600'}`}>
                                              {getEngineDescription(engine)}
                                          </div>
                                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
                                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
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

              <div className={`p-4 border-t ${isDarkUi ? 'border-slate-800 bg-slate-950/90' : 'border-slate-200 bg-slate-50/95'}`}>
                  <Button fullWidth onClick={() => setShowSettings(false)}>Save Changes</Button>
              </div>
          </div>
      </div>
  );
  };

  const usesPhoneStudioDock = isStudioWorkspaceTab && isPhone;
  const usesCompactFloatingStudioDock = isStudioWorkspaceTab && (isTablet || isDesktop);
  const shouldHideAssistantForReader = activeTab === Tab.READER;
  const useDesktopPinnedMixRail = isDesktop && !isPhone;
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
  const studioFloatingDockWidthClass = isDesktop
    ? (isLargeDesktop
      ? 'w-[clamp(16.25rem,25vw,18.5rem)] max-w-[calc(100vw-2rem)]'
      : isNarrowDesktop
        ? 'w-[clamp(15.5rem,27vw,17.25rem)] max-w-[calc(100vw-2rem)]'
        : 'w-[clamp(16rem,26vw,19rem)] max-w-[calc(100vw-2rem)]')
    : 'w-[clamp(15.5rem,31vw,18.25rem)] max-w-[calc(100vw-2rem)]';
  const studioFloatingDockVariantClass = isDesktop
    ? 'vf-studio-generate-anchor--desktop'
    : 'vf-studio-generate-anchor--tablet';
  const studioAssistantPositionClass = isPhone
    ? 'right-3 items-end'
    : 'right-4 xl:right-6 items-end';
  const showTopbarAssistantButton = isPhone && !shouldHideAssistantForReader && !isStudioWorkspaceTab;
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
  const shouldRenderFloatingAssistant = !shouldHideAssistantForReader && isChatOpen;

  return (
    <div className={`relative h-[100dvh] min-h-screen overflow-hidden vf-motion-${uiMotionLevel} ${resolvedTheme === 'dark' ? 'vf-theme-dark theme-dark vf-hybrid-aod' : 'vf-hybrid-light'}`}>
      <div className={`vf-app-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent font-sans text-gray-900 xl:grid xl:grid-cols-[auto_minmax(0,1fr)] xl:gap-4 ${uiDensity === 'compact' ? 'vf-compact' : ''}`}>
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
                       activeEngine={settings.engine}
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
                        className={`inline-flex items-center rounded-full border font-bold ${isPhone ? 'gap-1 px-1.5 py-0.5 text-[9px]' : 'gap-1.5 sm:gap-2 px-2 py-1 sm:px-2.5 text-[10px]'} ${
                          resolvedTheme === 'dark'
                            ? 'border-slate-700 bg-slate-900/85 text-slate-200 hover:bg-slate-800'
                            : 'border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <Box size={13} className="hidden sm:inline" />
                        <Coins size={12} className="sm:hidden" />
                        <span className="sm:hidden">{`Credits ${availableCreditsPercentLabel}`}</span>
                        <span className="hidden sm:inline">
                          {hasUnlimitedAccess
                            ? `Unlimited (${availableCreditsPercentLabel})`
                            : `${currentEngineSpendable.toLocaleString()} VF (${availableCreditsPercentLabel})`}
                        </span>
                        <span className={`hidden sm:inline rounded-full px-2 py-0.5 text-[9px] ${
                          isPaidBillingPlan
                            ? (resolvedTheme === 'dark' ? 'bg-cyan-500/20 text-cyan-100' : 'bg-cyan-50 text-cyan-700')
                            : (resolvedTheme === 'dark' ? 'bg-amber-400 text-slate-950' : 'bg-amber-500 text-white')
                        }`}>
                          {isPaidBillingPlan ? 'Manage' : 'Upgrade'}
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
                            <SectionCard className={`vf-editor-shell rounded-3xl overflow-hidden flex flex-col ${studioEditorHeightClass} relative ${
                                isStudioEditorFullscreen ? 'vf-editor-shell--fullscreen z-[58]' : 'group transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] hover:shadow-md'
                            }`}>
                                {/* Toolbar */}
                                <div className={`vf-studio-toolbar border-b ${isPhone ? 'flex flex-col items-stretch gap-1 px-2 py-1.5' : 'flex items-center justify-between gap-2.5 px-3 py-2.5'}`}>
                                    <div className={`${isPhone ? 'vf-toolbar-primary vf-toolbar-primary--phone flex min-w-0 items-center gap-1 overflow-x-auto pr-0' : 'vf-toolbar-primary flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-2'}`}>
                                        <button onClick={() => setText(t => t + ' [pause] ')} className="vf-toolbar-action text-xs font-bold transition-colors" title="Insert Pause"><Clock size={14}/> <span className="hidden sm:inline">Pause</span></button>
                                        <button onClick={() => setText(t => t + ' (Whisper): ')} className="vf-toolbar-action text-xs font-bold transition-colors" title="Whisper"><Volume2 size={14}/> <span className="hidden sm:inline">Whisper</span></button>

                                        {!isPhone && <div className="vf-toolbar-divider"></div>}

                                        <ProofreadCluster
                                            isBusy={isAiWriting}
                                            onProofread={(mode) => { void handleProofread(mode); }}
                                            novelLabel="Audio Novel"
                                        />

                                        {!isPhone && <div className="vf-toolbar-divider"></div>}

                                        <button
                                            onClick={() => { setText(''); setGeneratedAudioUrlManaged(null); }}
                                            className="vf-toolbar-action vf-toolbar-action--danger text-xs font-bold transition-colors"
                                            title="Clear"
                                            aria-label="Clear studio script"
                                        >
                                            <Trash2 size={14}/>
                                        </button>
                                    </div>

                                    <div className={`vf-toolbar-secondary ${isPhone ? 'w-full justify-start flex-nowrap overflow-x-auto pb-0.5' : 'ml-2 shrink-0'}`}>
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
                                            type="button"
                                            onClick={() => setIsChatOpen(true)}
                                            className="vf-toolbar-action text-xs font-bold transition-colors"
                                            title="Open creative assistant"
                                         >
                                            <Sparkles size={13}/>
                                            <span>{isPhone ? 'Assist' : 'Assistant'}</span>
                                         </button>
                                         <button
                                            type="button"
                                            onClick={() => handleDirectorAI(text)}
                                            disabled={isAiWriting}
                                            title={`${studioDirectorPreview ? 'Refresh' : 'Analyze'} the current text and review an AI Director pass before applying. Current mode: ${describeStudioDirectorModeState(studioDirectorModeState)}.`}
                                            className="vf-toolbar-ai text-xs font-bold disabled:opacity-50 transition-colors shadow-sm"
                                         >
                                            {isAiWriting ? <Loader2 size={13} className="animate-spin"/> : <Wand2 size={13}/>} 
                                            <span>{studioDirectorPreview ? 'Refresh Preview' : 'AI Director'}</span>
                                         </button>
                                         <input
                                            ref={studioImportInputRef}
                                            type="file"
                                            className="hidden"
                                            multiple
                                            onChange={handleStudioImportInputChange}
                                         />
                                    </div>
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

                                <div className={`vf-editor-footer border-t text-xs flex flex-wrap items-center justify-between ${isPhone ? 'px-2 py-1 gap-1' : 'px-4 sm:px-6 py-3 gap-3'}`}>
                                    <div className={`flex flex-wrap items-center ${isPhone ? 'gap-1' : 'gap-2'}`}>
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
                                    <div className={`flex items-center ${isPhone ? 'vf-scrollbar-invisible snap-x snap-proximity flex-nowrap gap-1 overflow-x-auto pb-0.5' : 'flex-wrap gap-2'}`}>
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
                                        <button onClick={() => saveDraft(`Draft ${new Date().toLocaleTimeString()}`, text, settings)} className="vf-editor-link flex shrink-0 snap-start items-center gap-1 whitespace-nowrap"><Save size={11}/> Save Draft</button>
                                    </div>
                                </div>
                            </SectionCard>

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
		                        <div className={`vf-studio-rail h-fit xl:sticky xl:top-24 xl:self-start ${isPhone ? 'space-y-4' : 'space-y-5'}`}>
                              {!useDesktopPinnedMixRail && (
                              <SectionCard className={isPhone ? 'p-3 rounded-2xl' : 'p-3 rounded-3xl'}>
                                <div className={isPhone ? 'vf-scrollbar-invisible flex snap-x snap-proximity flex-nowrap gap-1.5 overflow-x-auto pb-0.5' : 'flex flex-wrap gap-2'} {...studioRailTabs.listProps}>
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
                                              ? (isDarkUi ? 'cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500 opacity-65' : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400')
                                            : (isDarkUi ? 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/30 hover:text-cyan-200' : 'border-gray-200 bg-white text-gray-600 hover:border-cyan-200 hover:text-cyan-700')
                                        }`}
                                      >
                                        {tabItem.id === 'voice'
                                          ? <Mic2 size={12} />
                                          : tabItem.id === 'mix'
                                            ? <Sliders size={12} />
                                            : tabItem.id === 'cast'
                                              ? <Bot size={12} />
                                              : tabItem.id === 'queue'
                                                ? <Clock size={12} />
                                                : <Activity size={12} />}
                                        {tabItem.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </SectionCard>
                              )}
		                            {studioRailTab === 'voice' && !useDesktopPinnedMixRail && (
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
                                                        settings.engine === 'DUNO'
                                                          ? 'text-cyan-600'
                                                          : settings.engine === 'VECTOR'
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
                                
                                {/* Emotion/Speed Selector */}
                                <div className="pt-4 border-t border-gray-100 space-y-3">
                                    {isGemRuntimeEngine(settings.engine) && (
                                        <div>
                                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Emotion</h3>
                                            <select 
                                                value={settings.emotion} 
                                                onChange={(e) => setSettings(s => ({...s, emotion: e.target.value}))}
                                                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
	                                            >
	                                                {EMOTIONS.map(e => <option key={e} value={e}>{e}</option>)}
	                                            </select>
	                                        </div>
	                                    )}
		                                </div>
                                    </>
                                    )}
		                            </SectionCard>
                                  )}

	                            {/* Studio Audio Mix */}
                                  {(studioRailTab === 'mix' || useDesktopPinnedMixRail) && (
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
	                                            onChange={(e) => setSettings(s => ({ ...s, speed: parseFloat(e.target.value) }))}
	                                            className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"
	                                        />
	                                    </div>
	                                    <div>
	                                        <div className="text-xs mb-1 font-bold text-gray-700">TTS Output Language</div>
	                                        <select
	                                            value={settings.language}
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
	                                            onChange={(e) => setSettings(s => ({ ...s, musicTrackId: e.target.value }))}
	                                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
	                                        >
	                                            {MUSIC_TRACKS.map(t => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
	                                        </select>
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
                                  )}

                                    {studioRailTab === 'cast' && !useDesktopPinnedMixRail && (
                                      isStudioMultiSpeakerEnabled ? (
		                            <>
		                            {/* Cast & Crew */}
	                            <SectionCard className={`${isPhone ? 'p-3 rounded-2xl' : 'p-5 rounded-3xl'} border animate-in fade-in ${
                                      isDarkUi
                                        ? 'bg-slate-900/75 border-indigo-500/20'
                                        : 'bg-indigo-50 border-indigo-100'
                                    }`}>
                                    {isPhone ? (
                                        <div className="mb-3 flex flex-col gap-2">
                                            <div className="flex items-start justify-between gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleStudioMobilePanel('cast')}
                                                    className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                                                    aria-expanded={isStudioCastPanelOpen}
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
                                                    <div className="flex items-center gap-2">
                                                        {studioCrewTags.length > 0 && (
                                                            <span className={`shrink-0 rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${
                                                                isDarkUi
                                                                  ? 'border-cyan-500/30 bg-slate-950 text-cyan-200'
                                                                  : 'border-cyan-100 bg-white text-cyan-600'
                                                            }`}>
                                                                {studioCrewTags.length} crew
                                                            </span>
                                                        )}
                                                        {isStudioCastPanelOpen ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                                                    </div>
                                                </button>
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
                                                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                                                        isDarkUi
                                                            ? 'bg-slate-950 text-indigo-200 border-indigo-500/30 hover:bg-slate-900'
                                                            : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'
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
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${
                                            isDarkUi ? 'text-indigo-200' : 'text-indigo-400'
                                        }`}><Bot size={14}/> Cast &amp; Crew</h3>
                                        <div className="flex items-center gap-2">
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
                                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                                                    isDarkUi
                                                        ? 'bg-slate-950 text-indigo-200 border-indigo-500/30 hover:bg-slate-900'
                                                        : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'
                                                } disabled:opacity-60`}
                                            >
                                                {isAutoAssigningCast ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                                AI Auto
                                            </button>
                                            {studioCrewTags.length > 0 && (
                                                <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase ${
                                                    isDarkUi
                                                      ? 'bg-slate-950 text-cyan-200 border border-cyan-500/30'
                                                      : 'bg-white text-cyan-600 border border-cyan-100'
                                                }`}>
                                                    {studioCrewTags.length} crew
                                                </span>
                                            )}
                                            <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase ${
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
                                                <div key={speaker} className={`flex items-center justify-between gap-2 p-2 rounded-lg border shadow-sm ${
                                                    isDarkUi
                                                      ? 'bg-slate-950 border-indigo-500/20'
                                                      : 'bg-white border-indigo-100'
                                                }`}>
                                                    <div className="flex min-w-0 flex-col gap-0.5">
                                                        <span className={`truncate text-xs font-bold ${isDarkUi ? 'text-slate-100' : 'text-gray-700'}`}>{speaker}</span>
                                                        {speakerVcReference && (
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
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
                                                                <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                                                                    isDarkUi
                                                                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                                                                        : 'border-amber-200 bg-amber-50 text-amber-700'
                                                                }`}>
                                                                    Preset locked
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {speakerVcReference && (
                                                            <button
                                                                type="button"
                                                                onClick={() => clearSpeakerVcReference(speaker)}
                                                                className={`inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border transition xl:h-7 xl:w-7 ${
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
                                                            className={`inline-flex h-[44px] min-w-[6.8rem] shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition xl:h-8 xl:min-w-[4.8rem] ${
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
                                                            className={`max-w-[150px] rounded p-1 text-[10px] font-bold outline-none ${
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
                                    )}

                                    {studioRailTab === 'queue' && !useDesktopPinnedMixRail && shouldShowStudioQueuePanel && (
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
                                    {studioRailTab === 'queue' && !useDesktopPinnedMixRail && !shouldShowStudioQueuePanel && (
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

                {/* --- REDESIGNED CHARACTER TAB (legacy, removed from nav) --- */}
                {false && (
                    <div className="max-w-5xl mx-auto animate-in fade-in">
                        
                        {/* Tab Switcher & Header */}
                        <div className="mb-8 flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
                            <div>
                                <h2 className="text-2xl font-bold text-gray-800">Character & Voice Studio</h2>
                                <p className="text-sm text-gray-500">Manage your cast or browse the gallery to find the perfect voice.</p>
                            </div>
                            
                            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                                <div className="flex w-full rounded-xl border border-gray-200 bg-white p-1 shadow-sm sm:w-auto">
                                    <button
                                        onClick={() => setCharTab('CAST')}
                                        className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] sm:flex-none sm:px-5 ${charTab === 'CAST' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                                    >
                                        <Users size={16}/> My Cast
                                    </button>
                                    <button
                                        onClick={() => setCharTab('GALLERY')}
                                        className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] sm:flex-none sm:px-5 ${charTab === 'GALLERY' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                                    >
                                        <StoreIcon size={16}/> Voice Gallery
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* --- MY CAST VIEW --- */}
                        {charTab === 'CAST' && (
                             <>
                                 <div className="flex justify-end mb-4">
                                     <Button onClick={() => openCharacterModal()} className="shadow-lg shadow-indigo-200">
                                         <Plus size={18} className="mr-2"/> Add Character
                                     </Button>
                                 </div>
                                 
                                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
	                                     {characterLibrary.map(char => {
	                                         const voice = getVoiceById(char.voiceId) || clonedVoices.find(v => v.id === char.voiceId);
                                         const isLoadingPreview = previewState?.id === char.voiceId && previewState.status === 'loading';
                                         const isPlayingPreview = previewState?.id === char.voiceId && previewState.status === 'playing';

                                         return (
                                             <div key={char.id} className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] group relative overflow-hidden">
                                                 <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-gray-50 to-transparent rounded-bl-full pointer-events-none"></div>
                                                 
                                                 <div className="flex items-start gap-4 mb-4 relative z-10">
                                                     <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg transform group-hover:scale-105 transition-transform" style={{ backgroundColor: char.avatarColor || '#6366f1' }}>
                                                         {char.name.substring(0, 2).toUpperCase()}
                                                     </div>
                                                     <div className="flex-1">
                                                         <h3 className="font-bold text-lg text-gray-900 leading-tight">{char.name}</h3>
                                                         <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                                                             {joinUiFragments([char.age || 'Adult', char.gender || 'Unknown'])}
                                                         </span>
                                                     </div>
                                                     
                                                     <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                         <button onClick={() => openCharacterModal(char)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"><Edit2 size={16}/></button>
                                                         <button onClick={() => deleteChar(char.id)} className="p-2 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                                                     </div>
                                                 </div>

                                                  <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 flex items-center justify-between">
                                                       <div className="flex flex-col">
                                                           <span className="text-[10px] font-bold text-gray-400 uppercase">Assigned Voice</span>
                                                           <span className="text-sm font-bold text-indigo-600 truncate max-w-[120px]">{voice ? resolveVoiceDisplayLabel(voice) : char.voiceId}</span>
                                                       </div>
                                                       <button 
                                                           onClick={(e) => { e.stopPropagation(); handlePreviewCharacter(char); }} 
                                                           className={`w-10 h-10 rounded-full flex items-center justify-center transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] ${isPlayingPreview ? 'bg-indigo-600 text-white shadow-md' : 'bg-white border border-gray-200 text-indigo-600 hover:bg-indigo-50'}`}
                                                      >
                                                          {isLoadingPreview ? <Loader2 size={18} className="animate-spin"/> : isPlayingPreview ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor" className="ml-0.5"/>}
                                                      </button>
                                                 </div>
                                             </div>
                                         );
                                     })}
                                 </div>
                             </>
                        )}

                        {/* --- VOICE GALLERY VIEW --- */}
                        {charTab === 'GALLERY' && (
                             <div className="space-y-6">
                                 {/* Filters */}
                                 <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
                                     <div className="relative w-full md:w-64">
                                         <Search size={16} className="absolute left-3 top-3 text-gray-400"/>
                                         <input 
                                            type="text" 
                                            placeholder="Search voices..." 
                                            value={voiceSearch}
                                            onChange={(e) => {
                                              const nextValue = e.target.value;
                                              startTransition(() => {
                                                setVoiceSearch(nextValue);
                                              });
                                            }}
                                            className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                         />
                                     </div>
                                     
                                     <div className="flex gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
                                         <select 
                                            value={voiceFilterGender}
                                            onChange={(e) => setVoiceFilterGender(e.target.value as any)}
                                            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 outline-none cursor-pointer hover:bg-gray-100"
                                         >
                                             <option value="All">All Genders</option>
                                             <option value="Male">Male</option>
                                             <option value="Female">Female</option>
                                         </select>
                                         <select 
                                            value={voiceFilterAccent}
                                            onChange={(e) => setVoiceFilterAccent(e.target.value)}
                                            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 outline-none cursor-pointer hover:bg-gray-100"
                                         >
                                             <option value="All">All Countries</option>
                                             {uniqueAccents.map(a => <option key={a} value={a}>{a}</option>)}
                                         </select>
                                     </div>
                                 </div>

                                 {/* Voice Grid */}
                                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                     {filteredVoices.map(v => {
                                         const voiceMeta = resolveVoiceDisplayMeta(v);
                                         const isLoading = previewState?.id === v.id && previewState.status === 'loading';
                                         const isPlaying = previewState?.id === v.id && previewState.status === 'playing';
                                         const voiceEngine = (v.engine || settings.engine) as GenerationSettings['engine'];
                                         const accessTier = resolveVoiceAccessTier(voiceEngine, v);
                                         const isLocked = isVoiceLockedForFreeTier(voiceEngine, v);
                                         
                                         return (
                                             <div key={v.id} className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-indigo-200 hover:shadow-md transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] group flex flex-col gap-3">
                                                  <div className="flex items-center justify-between">
                                                      <div className="flex items-center gap-3">
                                                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${v.gender === 'Female' ? 'bg-pink-500' : v.gender === 'Male' ? 'bg-blue-500' : 'bg-purple-500'}`}>
                                                              {voiceMeta.name[0] || 'V'}
                                                          </div>
                                                             <div>
                                                                 <div className="flex items-center gap-1.5">
                                                                     <h4 className="font-bold text-gray-900 text-sm">{voiceMeta.name}</h4>
                                                                     {voiceMeta.countryTag && (
                                                                         <span className="rounded-full border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-gray-600">
                                                                             {voiceMeta.countryTag}
                                                                         </span>
                                                                     )}
                                                                 </div>
                                                                 <div className="text-[10px] text-gray-500 font-medium">{resolveVoicePersonaLabel(v)}</div>
                                                                 <div className={`inline-flex mt-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                                                                     accessTier === 'free'
                                                                         ? 'bg-emerald-100 text-emerald-700'
                                                                        : 'bg-amber-100 text-amber-700'
                                                                }`}>
                                                                    {accessTier}
                                                                </div>
                                                            </div>
                                                        </div>
                                                     
                                                     <button 
                                                        onClick={() => handleVoicePreview(v.id, v.name)}
                                                        className={`inline-flex items-center justify-center rounded-full transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] ${
                                                          isPhone ? 'h-[44px] w-[44px]' : 'h-8 w-8'
                                                        } ${isPlaying ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-indigo-100 hover:text-indigo-600'}`}
                                                     >
                                                         {isLoading ? <Loader2 size={14} className="animate-spin"/> : isPlaying ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}
                                                     </button>
                                                 </div>
                                                 
                                                 <button 
                                                    onClick={() => {
                                                        if (isLocked) {
                                                            setShowSubscriptionModal(true);
                                                            return;
                                                        }
                                                        openCharacterModal(undefined, v.id);
                                                    }}
                                                    className={`w-full py-2 rounded-lg border text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                                                        isLocked
                                                            ? 'border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100'
                                                            : 'border-gray-200 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200'
                                                    }`}
                                                 >
                                                     {isLocked ? <Lock size={14}/> : <Plus size={14}/>} {isLocked ? 'Upgrade for Pro Voice' : 'Create Character'}
                                                 </button>
                                             </div>
                                         )
                                     })}
                                     
                                  </div>
                              </div>
                         )}

                         {/* ... modal ... */}
                        {characterModalOpen && (
                             <div className="vf-scrim vf-scrim--modal fixed inset-0 z-50 flex items-center justify-center p-4">
                                 <div className="bg-white w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl shadow-2xl p-6 animate-in zoom-in duration-200">
                                     <div className="flex justify-between items-center mb-6">
                                         <h3 className="text-lg font-bold">{editingChar ? 'Edit Character' : 'New Character'}</h3>
                                         <button onClick={() => setCharacterModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={18}/></button>
                                     </div>
                                     <div className="space-y-4">
                                         {/* ... form fields ... */}
                                         <div className="flex items-center gap-4">
                                             <div className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-sm relative group/color cursor-pointer" style={{ backgroundColor: charForm.avatarColor }}>
                                                  {charForm.name ? charForm.name.substring(0, 2).toUpperCase() : '?'}
                                                  <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={charForm.avatarColor} onChange={e => setCharForm({...charForm, avatarColor: e.target.value})} />
                                             </div>
                                             <div className="flex-1">
                                                 <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Name</label>
                                                 <input value={charForm.name} onChange={e => setCharForm({...charForm, name: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Narrator, Hero" />
                                             </div>
                                         </div>
                                         
                                         <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                             <div>
                                                 <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Gender</label>
                                                 <select value={charForm.gender} onChange={e => setCharForm({...charForm, gender: e.target.value as any})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
                                                     <option value="Male">Male</option>
                                                     <option value="Female">Female</option>
                                                     <option value="Unknown">Non-Binary / Other</option>
                                                 </select>
                                             </div>
                                             <div>
                                                 <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Age Group</label>
                                                 <select value={charForm.age} onChange={e => setCharForm({...charForm, age: e.target.value as any})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
                                                     <option value="Child">Child</option>
                                                     <option value="Young Adult">Young Adult</option>
                                                     <option value="Adult">Adult</option>
                                                     <option value="Elderly">Elderly</option>
                                                 </select>
                                             </div>
                                         </div>

	                                         <div>
	                                              <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Voice</label>
	                                              <select value={charForm.voiceId} onChange={e => setCharForm({...charForm, voiceId: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none font-medium">
                                                      <optgroup label="Free Speakers">
                                                          {galleryVoicePool
                                                              .filter((voice) => resolveVoiceAccessTier((voice.engine || settings.engine) as GenerationSettings['engine'], voice) === 'free')
                                                              .map((voice) => (
                                                                  <option key={voice.id} value={voice.id}>
                                                                      {`${resolveVoiceDisplayLabel(voice)} (${resolveVoicePersonaLabel(voice)})`}
                                                                  </option>
                                                              ))}
                                                      </optgroup>
                                                      <optgroup label="Pro Speakers">
                                                          {galleryVoicePool
                                                              .filter((voice) => resolveVoiceAccessTier((voice.engine || settings.engine) as GenerationSettings['engine'], voice) === 'pro')
                                                              .map((voice) => (
                                                                  <option
                                                                      key={voice.id}
                                                                      value={voice.id}
                                                                      disabled={isVoiceLockedForFreeTier((voice.engine || settings.engine) as GenerationSettings['engine'], voice)}
                                                                  >
                                                                      {`${resolveVoiceDisplayLabel(voice)} (${resolveVoicePersonaLabel(voice)}) - Pro`}
                                                                  </option>
                                                              ))}
                                                     </optgroup>
                                                  </select>
	                                         </div>

                                         <Button fullWidth onClick={saveCharacter} className="mt-4">{editingChar ? 'Save Changes' : 'Create Character'}</Button>
                                     </div>
                                 </div>
                             </div>
                        )}
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
                      backendBaseUrl={mediaBackendUrl}
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
                              const historyEngine: GenerationSettings['engine'] = item.engine === 'DUNO'
                                ? 'DUNO'
                                : item.engine === 'VECTOR'
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
                                      historyEngine === 'DUNO'
                                        ? isDarkUi
                                          ? 'bg-emerald-500/20 text-emerald-200'
                                          : 'bg-emerald-100 text-emerald-700'
                                        : historyEngine === 'VECTOR'
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
                    <Suspense fallback={<SectionCard className="rounded-3xl p-6 text-sm">Loading novel workspace...</SectionCard>}>
                      <NovelTabContent
                        settings={settings}
                        mediaBackendUrl={mediaBackendUrl}
                        onToast={showToast}
                        onSendToStudio={(content: string) => {
                          if (!content.trim()) return;
                          setText(content);
                          setActiveTab(Tab.STUDIO);
                          showToast("Sent to Studio for Audio Generation", "success");
                        }}
                      />
                    </Suspense>
                  </div>
                )}

                {mountedWorkspaceTabs[Tab.READER] && (
                  <div
                    hidden={activeTab !== Tab.READER}
                    aria-hidden={activeTab !== Tab.READER}
                    className={activeTab === Tab.READER ? '' : 'hidden'}
                  >
                    <Suspense fallback={<SectionCard className="rounded-3xl p-6 text-sm">Loading reader workspace...</SectionCard>}>
                      <ReaderTabContent
                        settings={settings}
                        mediaBackendUrl={mediaBackendUrl}
                        resolvedTheme={resolvedTheme}
                        onToast={showToast}
                        syncLocation={isStandaloneReaderRoute && activeTab === Tab.READER}
                        isActive={activeTab === Tab.READER}
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
                        backendBaseUrl={mediaBackendUrl}
                        selectedEngine={settings.engine}
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
                        mediaBackendUrl={mediaBackendUrl}
                        onToast={showToast}
                        onRefreshEntitlements={refreshEntitlements}
                        initialOpsTab={initialAdminOpsTab}
                      />
                    </Suspense>
                  </div>
                )}
                
                {usesPhoneStudioDock && !isChatOpen && (
                    <div
                        className="fixed inset-x-0 bottom-0 z-[47] px-2 pointer-events-none"
                        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.55rem)' }}
                    >
                        <div className="mx-auto w-full max-w-[1140px]">
                            <div className="mx-auto w-full max-w-xl pointer-events-auto">
                                <div className="vf-studio-generate-dock rounded-xl border border-indigo-400/35 p-1 backdrop-blur-lg">
                                    <MorphingGenerateButton
                                      onClick={handleGenerate}
                                      onCancel={handleCancelGeneration}
                                      disabled={!text.trim()}
                                      isGenerating={isGenerating}
                                      progress={progress}
                                      stage=""
                                      size="compact"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {usesCompactFloatingStudioDock && !isChatOpen && (
            <div className={`vf-studio-generate-anchor ${studioFloatingDockVariantClass} fixed z-[47] ${studioFloatingDockWidthClass}`}>
                <div className={`vf-studio-generate-dock rounded-2xl border border-indigo-400/35 backdrop-blur-lg ${isDesktop ? 'p-1.5' : 'p-1'}`}>
                    <MorphingGenerateButton
                      onClick={handleGenerate}
                      onCancel={handleCancelGeneration}
                      disabled={!text.trim()}
                      isGenerating={isGenerating}
                      progress={progress}
                      stage=""
                      size="compact"
                    />
                </div>
            </div>
        )}

      </main>

      {!shouldHideAssistantForReader && isChatOpen && (
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
        <ResourceMonitor isWorking={isGenerating || isProcessingVideo || isAiWriting || isChatLoading} />
      ) : null}

      {/* Modals & Overlays */}
      {showSettings && renderSettingsPanel()}
      </div>
    </div>
  );
};
// Add missing StoreIcon component definition (it was used in the redesign)
const StoreIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg 
      width={size || 24} 
      height={size || 24} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      className={className}
    >
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
      <path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7" />
    </svg>
);


