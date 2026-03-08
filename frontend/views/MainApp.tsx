

import React, { Suspense, lazy, startTransition, useDeferredValue, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { 
    Mic, Play, Pause, Settings, X, Wand2, Trash2, Sparkles, 
    Music, Video, 
    Save, FileText, Fingerprint, UploadCloud, FileAudio, Loader2, 
    Download, Menu, Box,
    Plus, Bot, Volume2, Clock, Send, 
    Film, Mic2, Sliders,
    Key, Lock, Terminal, RefreshCw, Users, Edit2, Palette, Timer, Cpu, Minimize2, Maximize2, Zap, Laptop, Activity, Search, Sun, Moon, Type, ChevronDown, ChevronUp, LogIn, LogOut, UserPlus, Coins, Gift, Bell
} from 'lucide-react';
import { Button } from '../components/Button';
import { VOICES, MUSIC_TRACKS, LANGUAGES, EMOTIONS, KOKORO_VOICES } from '../constants';
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
  DubbingClip,
  DubbingClipboard,
  CpuDubbingProfile,
} from '../types';
import { generateSpeech, audioBufferToWav, generateTextContent, translateText, analyzeVoiceSample, translateVideoContent, detectLanguage, parseMultiSpeakerScript, autoFormatScript, proofreadScript, DirectorOptions, getAudioContext, TTS_RUNTIME_DIAGNOSTICS_EVENT, TTS_GATEWAY_JOB_PROGRESS_EVENT, TTS_GATEWAY_AUDIO_CHUNK_EVENT, inferSpeakerTraitHintsWithAi, normalizeSpeakerMapKey, resolveSpeakerMappedVoiceId } from '../services/geminiService';
import { extractAndSeparateDubbingStems } from '../services/dubbingService';
import { AudioPlayer } from '../components/AudioPlayer';
import { useUser } from '../contexts/UserContext';
import { AdModal } from '../components/AdModal';
import { autoAssignSpeakerVoices } from '../src/shared/voices/castAssignment';
import {
  applyStudioAudioMix,
  resolveStudioMusicGain,
  resolveStudioSpeechGain,
  STUDIO_SPEECH_GAIN_MAX,
  STUDIO_SPEECH_GAIN_MIN,
} from '../services/studioMixService';
import {
  clearAllClips,
  copyClip,
  cutClip,
  moveClipLayer,
  pasteClipAfterSelection,
  pushUndoHistory,
  redoTimeline,
  removeCompletedClips,
  removeClip,
  splitClipAtPlayhead,
  trimClipWindow,
  undoTimeline,
} from '../services/dubbingTimelineService';
import {
  cancelDubbingJob,
  checkMediaBackendHealth,
  convertVoiceTransferCover,
  createDubbingJobV2,
  downloadDubbingChunk,
  downloadDubbingReport,
  downloadDubbingResult,
  getDubbingJob,
  listVoiceTransferModels,
  loadVoiceTransferModel,
  resolveMediaBackendUrl,
  switchTtsEngineRuntime,
  transcribeVideoWithBackend,
} from '../services/mediaBackendService';
import { fetchEngineRuntimeVoices, getStaticVoiceFallback } from '../services/ttsVoiceRegistryService';
import { normalizeEmotionTag } from '../services/emotionTagRules';
import { getEngineDisplayName } from '../services/engineDisplay';
import { loadKokoroBrowserRuntimeModule } from '../services/loadKokoroBrowserRuntime';
import {
  isBrowserKokoroExecutionEnabled,
  shouldUseBrowserKokoroExecution,
} from '../services/kokoroBrowserRuntimeFlags';
import { EngineRuntimeStrip } from '../components/EngineRuntimeStrip';
import { ProofreadCluster } from '../components/ProofreadCluster';
import { StudioTranslateBar } from '../components/StudioTranslateBar';
import { DubbingTranslateBar } from '../components/DubbingTranslateBar';
import { SectionCard } from '../components/SectionCard';
import { BrandLogo } from '../components/BrandLogo';
import { BlockScriptEditor } from '../components/studio/BlockScriptEditor';
import { MorphingGenerateButton } from '../components/studio/MorphingGenerateButton';
import { StudioQueuePanel } from '../components/studio/StudioQueuePanel';
import { TelemetrySparkline } from '../components/ui/TelemetrySparkline';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson, readStorageString, removeStorageKey, writeStorageJson, writeStorageString } from '../src/shared/storage/localStore';
import { buildWorkspaceTabs, WorkspaceTab as Tab } from '../src/features/workspace/model/tabs';
import { useBillingActions } from '../src/features/billing/hooks/useBillingActions';
import { fetchTtsEnginesStatus } from '../src/shared/api/gatewayClient';
import { getDefaultApiBaseUrl, sanitizeConfiguredApiBaseUrl } from '../src/shared/api/config';
import { useWorkspaceViewport } from '../src/shared/ui/useWorkspaceViewport';
import {
  normalizeAssistantProviderControlsEnabled,
  normalizePreferUserGeminiKey,
  resolveAssistantProviderRouting,
} from '../src/shared/settings/assistantProvider';
import { hasAdminConsoleAccess as canUseAdminConsole } from '../src/shared/auth/adminAccess';
import { ASSISTANT_PROVIDER_UI_LABELS, sanitizeUiText } from '../src/shared/ui/terminology';
import { useNotifications } from '../src/shared/notifications/NotificationProvider';
import { NOTIFICATION_DEEP_LINK_EVENT, readNotificationDeepLink } from '../src/shared/notifications/deepLink';
import { fetchAccountProfile, type TokenPackKey } from '../services/accountService';
import { firebaseAuth } from '../services/firebaseClient';
import { SimplifiedDubbingTab } from '../src/features/dubbing/components/SimplifiedDubbingTab';
import {
  canUseStudioQueue,
  computeStudioQueueMasterOrder,
  createStudioQueueState,
  hashStudioQueueSource,
  normalizeStoredStudioQueueState,
} from '../src/features/studio/model/queue';
import {
  clearStudioQueueAudioCache,
  deleteStudioQueueAudioBlob,
  readStudioQueueAudioBlob,
  storeStudioQueueAudioBlob,
} from '../services/studioQueueCacheService';
import { buildStudioQueueBlobUrl, mergeStudioQueueAudioBlobs } from '../services/studioQueueAudioService';
import { buildSentenceAlignedCharWindows } from '../services/ttsLongTextService';
import { pollTtsGatewayJobForAudio } from '../services/ttsGatewayJobService';

const AdminTabContent = lazy(async () =>
  import('../src/features/admin/components/AdminTabContent').then((module) => ({ default: module.AdminTabContent }))
);
const NovelTabContent = lazy(async () =>
  import('../src/features/novel/components/NovelTabContent').then((module) => ({ default: module.NovelTabContent }))
);
const ReaderTabContent = lazy(async () =>
  import('../src/features/reader/components/ReaderTabContent').then((module) => ({ default: module.ReaderTabContent }))
);

interface MainAppProps {
  setScreen: (screen: AppScreen) => void;
}

type LabMode = 'CLONING' | 'COVERS';
type UiTheme = 'light' | 'dark' | 'system';
type UiDensity = 'comfortable' | 'compact';
type UiMotionLevel = 'off' | 'balanced' | 'rich';
type EngineRuntimeState = 'checking' | 'starting' | 'online' | 'offline' | 'not_configured' | 'standby';

interface EngineRuntimeStatus {
  state: EngineRuntimeState;
  detail: string;
}

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
  status?: string;
  engine?: string;
  queueAgeMs?: number;
  queueDepth?: number;
  stage?: string;
  progressPct?: number;
}

interface GatewayAudioChunkEventDetail {
  jobId?: string;
  index?: number;
  engine?: string;
  contentType?: string;
  durationMs?: number;
  textChars?: number;
  traceId?: string;
  audioBase64?: string;
}

interface LiveAudioChunkItem {
  jobId: string;
  index: number;
  engine: string;
  contentType: string;
  durationMs: number;
  textChars: number;
  traceId: string;
  audioBase64: string;
}

interface CachedDubbingStems {
  key: string;
  speechFile: File;
  backgroundBuffer: AudioBuffer;
  speechObjectUrl: string;
  backgroundObjectUrl: string;
  duration: number;
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

const ENGINE_ORDER: GenerationSettings['engine'][] = ['KOKORO', 'GOOD', 'NEURAL2', 'GEM'];
const FALLBACK_RUNTIME_URLS: Record<GenerationSettings['engine'], string> = {
  GEM: 'http://127.0.0.1:7810',
  GOOD: 'http://127.0.0.1:7810',
  NEURAL2: 'http://127.0.0.1:7810',
  KOKORO: 'http://127.0.0.1:7820',
};
const DEFAULT_MEDIA_BACKEND_URL = getDefaultApiBaseUrl();

const EMPTY_RUNTIME_CATALOG: Record<GenerationSettings['engine'], VoiceOption[]> = {
  GEM: [],
  GOOD: [],
  NEURAL2: [],
  KOKORO: [],
};
const DEFAULT_GEM_VOICE_ID = VOICES[0]?.id ?? 'gem_default_voice';
const DEFAULT_KOKORO_VOICE_ID = KOKORO_VOICES[0]?.id ?? DEFAULT_GEM_VOICE_ID;
const BUILT_IN_VOICE_IDS = new Set([...VOICES.map((voice) => voice.id), ...KOKORO_VOICES.map((voice) => voice.id)]);
const FREE_TIER_ALLOWED_VOICE_IDS: Record<GenerationSettings['engine'], string[]> = {
  GEM: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  GOOD: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  NEURAL2: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  KOKORO: [
      'af_heart',
      'af_bella',
      'af_nova',
      'af_sarah',
      'am_fenrir',
      'am_michael',
      'am_onyx',
      'am_echo',
      'bf_emma',
      'bf_isabella',
      'bm_george',
      'bm_fable',
      'hf_alpha',
      'hf_beta',
      'hm_omega',
      'hm_psi',
  ],
};
const COUNTRY_TAG_BY_NAME: Record<string, string> = {
  'united states': 'US',
  'united kingdom': 'UK',
  india: 'IN',
  canada: 'CA',
  australia: 'AU',
  ireland: 'IE',
  france: 'FR',
  germany: 'DE',
  russia: 'RU',
  'united arab emirates': 'UAE',
};
const TOKEN_PACK_MATRIX: Record<TokenPackKey, { label: string; vf: number; standardInr: number; scaleInr: number }> = {
  micro: { label: 'Micro', vf: 50000, standardInr: 550, scaleInr: 440 },
  standard: { label: 'Standard', vf: 150000, standardInr: 1450, scaleInr: 1160 },
  mega: { label: 'Mega', vf: 300000, standardInr: 2900, scaleInr: 2320 },
  ultra: { label: 'Ultra', vf: 600000, standardInr: 5200, scaleInr: 4160 },
};
type AdminOpsTab = 'usage' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics';
const LEGACY_DUBBING_UI_ENABLED = false;

const resolveWorkspaceTabFromUrl = (): Tab => {
  if (typeof window === 'undefined') return Tab.STUDIO;
  const token = String(new URLSearchParams(window.location.search).get('vf-tab') || '').trim().toUpperCase();
  return Object.values(Tab).includes(token as Tab) ? (token as Tab) : Tab.STUDIO;
};

const resolveAdminOpsTabFromUrl = (): AdminOpsTab => {
  if (typeof window === 'undefined') return 'usage';
  const token = String(new URLSearchParams(window.location.search).get('vf-admin-tab') || '').trim().toLowerCase();
  return ['usage', 'guardian', 'alerts', 'scheduler', 'audit', 'analytics'].includes(token)
    ? (token as AdminOpsTab)
    : 'usage';
};

const normalizePlanToken = (planName: unknown): 'free' | 'starter' | 'creator' | 'pro' | 'scale' => {
  const token = String(planName || '').trim().toLowerCase();
  if (token === 'starter') return 'starter';
  if (token === 'creator') return 'creator';
  if (token === 'pro') return 'pro';
  if (token === 'scale' || token === 'plus' || token === 'pro_plus' || token === 'pro-plus') return 'scale';
  return 'free';
};

const normalizeAllowedEngines = (value: unknown): GenerationSettings['engine'][] => {
  if (!Array.isArray(value)) return [];
  const out = new Set<GenerationSettings['engine']>();
  value.forEach((item) => {
    const token = String(item || '').trim().toUpperCase();
    if (token === 'KOKORO' || token === 'GOOD' || token === 'NEURAL2' || token === 'GEM') {
      out.add(token as GenerationSettings['engine']);
    }
  });
  return Array.from(out);
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
  engine: 'GEM',
  helperProvider: 'GEMINI',
  assistantProviderControlsEnabled: true,
  preferUserGeminiKey: false,
  perplexityApiKey: '',
  localLlmUrl: 'http://localhost:5000',
  geminiApiKey: '',
  mediaBackendUrl: DEFAULT_MEDIA_BACKEND_URL,
  backendApiKey: '',
  voiceModel: '',
  geminiTtsServiceUrl: FALLBACK_RUNTIME_URLS.GEM,
  kokoroTtsServiceUrl: FALLBACK_RUNTIME_URLS.KOKORO,
  kokoroStandbyIdleMs: 900000,

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
  const legacyEngine = typeof value.engine === 'string' ? value.engine : DEFAULT_SETTINGS.engine;
  const engine = (legacyEngine === 'GEM' || legacyEngine === 'GOOD' || legacyEngine === 'NEURAL2' || legacyEngine === 'KOKORO') ? legacyEngine : 'GEM';
  const defaultVoice = engine === 'KOKORO'
    ? DEFAULT_KOKORO_VOICE_ID
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
    helperProvider: value.helperProvider === 'GEMINI' || value.helperProvider === 'PERPLEXITY' || value.helperProvider === 'LOCAL' ? value.helperProvider : DEFAULT_SETTINGS.helperProvider,
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
    voiceModel:
      typeof value.voiceModel === 'string'
        ? value.voiceModel
        : typeof value.llvcModel === 'string'
          ? value.llvcModel
          : DEFAULT_SETTINGS.voiceModel,
    geminiTtsServiceUrl: normalizeServiceSetting(value.geminiTtsServiceUrl, DEFAULT_SETTINGS.geminiTtsServiceUrl || FALLBACK_RUNTIME_URLS.GEM),
    kokoroTtsServiceUrl: normalizeServiceSetting(value.kokoroTtsServiceUrl, DEFAULT_SETTINGS.kokoroTtsServiceUrl || FALLBACK_RUNTIME_URLS.KOKORO),
    kokoroStandbyIdleMs: typeof value.kokoroStandbyIdleMs === 'number' && Number.isFinite(value.kokoroStandbyIdleMs)
      ? Math.max(1000, Math.round(value.kokoroStandbyIdleMs))
      : (DEFAULT_SETTINGS.kokoroStandbyIdleMs || 900000),
    autoPlayGeneratedAudio: typeof value.autoPlayGeneratedAudio === 'boolean'
      ? value.autoPlayGeneratedAudio
      : (DEFAULT_SETTINGS.autoPlayGeneratedAudio !== false),
  };

  const validVoiceIds = new Set([
    ...VOICES.map(v => v.id),
    ...KOKORO_VOICES.map(v => v.id),

    ...((value.clonedVoices || []) as any[]).map(v => v?.id).filter(Boolean),
  ]);

  if (!validVoiceIds.has(normalized.voiceId)) {
    normalized.voiceId = defaultVoice;
  }

  return normalized;
};

const DUBBING_SOURCE_LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'auto', label: 'Auto Detect' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ru', label: 'Russian' },
];

const VIDEO_PIPELINE_2026_PHASES: Array<{ title: string; body: string }> = [
  {
    title: 'Phase 1: Deep Acoustic Deconstruction (Acoustic Isolation)',
    body: 'Isolate dialogue from M&E, then dereverb to produce a dry vocal stem for clean remixing. Default stack: UVR5-compatible BS-Roformer-Viperx-1297 with UVR DeEcho/DeReverb.',
  },
  {
    title: 'Phase 2: Multimodal Analysis (Director Layer)',
    body: 'Gemini 3 Flash builds Director JSON with speaker diarization, affective tags (whisper, grit, sarcasm), and exact start_ms/end_ms timing markers.',
  },
  {
    title: 'Phase 3: Isochrony-Aware Translation (Sync Script)',
    body: 'Translation is iteratively rewritten until syllable ratio stays within configured tolerance (default +-10%) so timing remains aligned.',
  },
  {
    title: 'Phase 4: Base Performance Generation (Gemini TTS)',
    body: 'Gemini 2.5 Flash TTS generates the acting base with director tags injected and segment-level dynamic speaking_rate fitted to duration windows.',
  },
  {
    title: 'Phase 5: CPU-Optimized Voice Transfer',
    body: 'W-Okada voice transfer applies the target timbre onto translated performance while preserving rhythm and expressive cues, with per-segment RTF tracking.',
  },
  {
    title: 'Phase 6: Visual Lip-Sync (Final Assembly)',
    body: 'Wav2Lip-ONNX re-animates mouth movement to match target phonemes. LPIPS validation runs when available, otherwise warns and continues.',
  },
];

const VIDEO_PIPELINE_2026_SUMMARY_ROWS: Array<{ step: string; tool: string; modality: string; benefit: string }> = [
  {
    step: 'Isolation',
    tool: 'UVR5 (RoFormer)',
    modality: 'Audio',
    benefit: 'Removes music bleed and original room reverb.',
  },
  {
    step: 'Logic',
    tool: 'Gemini 3 Flash',
    modality: 'Multimodal',
    benefit: 'Precise emotional and temporal mapping.',
  },
  {
    step: 'Translation',
    tool: 'IAMT Prompting',
    modality: 'Text',
    benefit: 'Syllable-matched for duration alignment.',
  },
  {
    step: 'Base Vocal',
    tool: 'Gemini 2.5 TTS',
    modality: 'Audio',
    benefit: 'High-fidelity emotional performance.',
  },
  {
    step: 'Cloning',
    tool: 'Voice Transfer',
    modality: 'Audio',
    benefit: 'CPU-friendly timbre transfer with acting preserved.',
  },
  {
    step: 'Lip-Sync',
    tool: 'Wav2Lip-ONNX',
    modality: 'Video',
    benefit: 'Aligns mouth movement at 256x256 output path.',
  },
];

const cleanDubbingLine = (line: string): string => (
  String(line || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([,:;!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
);

const runDubbingEditorTool = (
  script: string,
  mode: 'clean' | 'speakerize' | 'dedupe' | 'compact'
): string => {
  const lines = String(script || '')
    .split(/\r?\n/)
    .map((line) => cleanDubbingLine(line));

  if (mode === 'clean') {
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (mode === 'speakerize') {
    return lines
      .map((line) => {
        if (!line) return '';
        if (/^\([^)]*\)\s+[^:]+:\s+/i.test(line)) return line;
        if (/^[^:]{1,40}:\s+/i.test(line)) return line;
        if (/^\([^)]*\)\s+/.test(line)) {
          return line.replace(/^(\([^)]*\)\s+)/, '$1Speaker 1: ');
        }
        return `Speaker 1: ${line}`;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  if (mode === 'dedupe') {
    const deduped: string[] = [];
    for (const line of lines) {
      if (!line) {
        if (deduped.length > 0 && deduped[deduped.length - 1] !== '') deduped.push('');
        continue;
      }
      if (deduped.length > 0 && deduped[deduped.length - 1] === line) continue;
      deduped.push(line);
    }
    return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // compact
  return lines.filter(Boolean).join('\n').trim();
};

const DUBBING_TIMELINE_LAYERS: Array<DubbingClip['layer']> = ['V1', 'V2'];

const DUBBING_CPU_PROFILE_LABELS: Record<CpuDubbingProfile, string> = {
  cpu_quality: 'CPU Quality',
  cpu_balanced: 'CPU Balanced',
  cpu_fast: 'CPU Fast',
};

const buildDubbingClipId = (): string => `dub_clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createDubbingClip = (file: File, objectUrl: string, durationMs: number = 0): DubbingClip => ({
  id: buildDubbingClipId(),
  file,
  objectUrl,
  durationMs: Math.max(0, Math.round(durationMs || 0)),
  trimInMs: 0,
  trimOutMs: Math.max(240, Math.round(durationMs || 0)),
  layer: 'V1',
  script: '',
  status: 'idle',
  jobId: '',
  resultUrl: null,
  reportUrl: null,
  error: '',
});

const formatClipDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

// --- SYSTEM RESOURCE MONITOR ---
const ResourceMonitor = ({ isWorking }: { isWorking: boolean }) => {
  const [stats, setStats] = useState({
    cpu: 0,
    ram: 0,
    gpu: 'Unknown GPU',
    cpuHistory: Array(20).fill(5) as number[],
    ramHistory: Array(20).fill(0) as number[],
  });

  useEffect(() => {
    // 1. Get GPU Renderer Name (Once)
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                // Clean up renderer string
                const cleanName = renderer.replace(/ANGLE \((.*)\)/, '$1').replace(/Direct3D11 vs_.* ps_.*/, '').substring(0, 20);
                setStats(s => ({ ...s, gpu: cleanName }));
            }
        }
    } catch(e) {}

    const interval = setInterval(() => {
        // 2. RAM Usage (Chrome only)
        const mem = (performance as any).memory;
        const ramUsage = mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024) : 0;

        // 3. CPU Simulation
        // We can't get real CPU load in JS, so we simulate based on "isWorking" + randomness
        let targetCpu = isWorking ? 65 : 5; 
        const fluctuation = Math.random() * 10 - 5;
        
        setStats(prev => {
            const currentCpu = prev.cpu;
            const drift = (targetCpu + fluctuation) - currentCpu;
            const nextCpu = Math.max(1, Math.min(100, Math.round(currentCpu + (drift * 0.1))));
            const nextRam = ramUsage;
            return {
                ...prev,
                ram: nextRam,
                cpu: nextCpu,
                cpuHistory: [...prev.cpuHistory.slice(-19), nextCpu],
                ramHistory: [...prev.ramHistory.slice(-19), nextRam],
            };
        });

    }, 1000);

    return () => clearInterval(interval);
  }, [isWorking]);

  return (
    <div className="fixed bottom-4 left-[calc(16rem+1rem)] z-40 hidden xl:flex items-center gap-4 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-gray-200 shadow-sm text-[10px] font-mono text-gray-500">
        <div className="flex items-center gap-2" title="Estimated CPU load from UI activity">
            <Activity size={12} className={isWorking ? "text-amber-500 animate-pulse" : "text-gray-400"} />
            <span>CPU est: {stats.cpu}%</span>
            <TelemetrySparkline
              values={stats.cpuHistory}
              colorClassName={isWorking ? 'text-amber-400' : 'text-slate-400'}
              glow={isWorking}
              title="Estimated CPU trend"
            />
        </div>
        <div className="w-px h-3 bg-gray-300"></div>
        <div className="flex items-center gap-2" title="JS heap usage">
            <Cpu size={12} className="text-gray-400" />
            <span>RAM: {stats.ram > 0 ? `${stats.ram} MB` : 'N/A'}</span>
            <TelemetrySparkline
              values={stats.ramHistory}
              colorClassName="text-cyan-400"
              title="RAM trend"
            />
        </div>
        <div className="w-px h-3 bg-gray-300"></div>
        <div className="flex items-center gap-1.5" title="Active GPU Renderer">
            <Zap size={12} className={isWorking ? "text-violet-500" : "text-gray-400"} />
            <span className="truncate max-w-[120px]">{stats.gpu}</span>
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
    watchAd,
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
  const { mode: viewportMode, isPhone, isTablet, isDesktop } = useWorkspaceViewport();
  const hasSessionIdentity = Boolean(String(user.uid || user.email || '').trim());
  const hasAdminConsoleAccess = useMemo(() => canUseAdminConsole(user), [user]);
  
  // --- State ---
  const [activeTab, setActiveTab] = useState<Tab>(resolveWorkspaceTabFromUrl);
  const [initialAdminOpsTab, setInitialAdminOpsTab] = useState<AdminOpsTab>(resolveAdminOpsTabFromUrl);
  const [labMode, setLabMode] = useState<LabMode>('CLONING');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Studio Text State
  const [text, setText] = useState('');
  
  // Settings State
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    const saved = readStorageJson(STORAGE_KEYS.settings);
    return normalizeSettings(saved || DEFAULT_SETTINGS);
  });
  const mediaBackendUrl = resolveMediaBackendUrl(settings);
  const deferredSettings = useDeferredValue(settings);

  useEffect(() => { writeStorageJson(STORAGE_KEYS.settings, deferredSettings); }, [deferredSettings]);

  // Generation Status State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [processingStage, setProcessingStage] = useState('');
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [liveAudioChunks, setLiveAudioChunks] = useState<LiveAudioChunkItem[]>([]);
  const [studioQueueState, setStudioQueueState] = useState<StudioQueueState | null>(() => (
    normalizeStoredStudioQueueState(readStorageJson(STORAGE_KEYS.studioQueue))
  ));
  const [studioQueueAudioUrls, setStudioQueueAudioUrls] = useState<Record<string, string>>({});
  
  // Abort Controller for Cancellation
  const generationAbortController = useRef<AbortController | null>(null);
  const seenRuntimeDiagnosticsTracesRef = useRef<Set<string>>(new Set());
  const activeGatewayJobIdRef = useRef<string>('');
  const seenLiveChunkKeysRef = useRef<Set<string>>(new Set());
  const studioQueueStateRef = useRef<StudioQueueState | null>(studioQueueState);
  const isStudioQueueRunActiveRef = useRef(false);
  const activeStudioQueueItemIdRef = useRef<string>('');
  const studioQueueAudioUrlsRef = useRef<Record<string, string>>({});
  const masterQueueAudioUrlRef = useRef<string | null>(null);
  const queueMasterRebuildTimerRef = useRef<number | null>(null);
  const queueRunnerLockRef = useRef(false);
  const studioQueueAutoResumeAttemptedRef = useRef(false);
  const generationFailureBurstRef = useRef(0);
  const lastRuntimeStatesRef = useRef<Record<GenerationSettings['engine'], EngineRuntimeState>>({
    GEM: 'checking',
    GOOD: 'checking',
    NEURAL2: 'checking',
    KOKORO: 'checking',
  });
  const lastBackendHealthyRef = useRef<boolean | null>(null);
  const quotaNoticeRef = useRef<Record<string, boolean>>({});
  const ttsAccessProbeRef = useRef<RuntimeAccessProbe | null>(null);
  const lastTtsAccessBlockedRef = useRef<boolean | null>(null);
  const ttsAccessClockRetryAtRef = useRef<number>(0);
  
  // Modals & Overlays
  const [showSettings, setShowSettings] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
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
  const [uiDensity, setUiDensity] = useState<UiDensity>(() => {
    const saved = readStorageString(STORAGE_KEYS.uiDensity);
    return saved === 'comfortable' ? 'comfortable' : 'compact';
  });
  const [uiFontScale, setUiFontScale] = useState<number>(() => {
    const saved = parseFloat(readStorageString(STORAGE_KEYS.uiFontScale) || '1');
    return Number.isFinite(saved) ? Math.min(1.15, Math.max(0.9, saved)) : 1;
  });
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
  const [isAutoAssigningCast, setIsAutoAssigningCast] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);
  const [studioMobilePanels, setStudioMobilePanels] = useState({
    speaker: true,
    mix: false,
    multiSpeaker: false,
    cast: false,
    queue: false,
  });
  const [studioEditorMode, setStudioEditorMode] = useState<StudioEditorMode>(() => {
      const saved = readStorageString(STORAGE_KEYS.studioEditorMode);
      return saved === 'blocks' ? 'blocks' : 'raw';
  });
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);

  const toggleStudioMobilePanel = useCallback((panel: keyof typeof studioMobilePanels) => {
    setStudioMobilePanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  // Translation & Chat State
  const [targetLang, setTargetLang] = useState('Hinglish');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([
      { role: 'ai', text: "Hello! I'm your creative assistant. I can help you write, edit, or direct your video." }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Lab & Dubbing State
  const [cloneName, setCloneName] = useState('');
  const [uploadVoiceFile, setUploadVoiceFile] = useState<File | null>(null);
  
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
  const directorOptions: DirectorOptions = {
      style: 'natural',
      tone: 'neutral'
  };
  
  // Mixing
  const [videoVolume, setVideoVolume] = useState(1.0);
  const [dubVolume, setDubVolume] = useState(1.0);
  const [renderedDubVideoUrl, setRenderedDubVideoUrl] = useState<string | null>(null);

  // --- Real Media Backend State (Voice Transfer + Video Tools) ---
  const [backendHealth, setBackendHealth] = useState<BackendHealthState | null>(null);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);
  const [voiceTransferModels, setVoiceTransferModels] = useState<string[]>([]);
  const [isLoadingLlvcModels, setIsLoadingLlvcModels] = useState(false);
  const [llvcSourceFile, setLlvcSourceFile] = useState<File | null>(null);
  const [llvcSourcePreviewUrl, setLlvcSourcePreviewUrl] = useState<string | null>(null);
  const [isLlvcSourcePlaying, setIsLlvcSourcePlaying] = useState(false);
  const [llvcPitchShift, setLlvcPitchShift] = useState(0);
  const [llvcPreset, setLlvcPreset] = useState<'tts_realtime'>('tts_realtime');
  const [llvcF0Method, setLlvcF0Method] = useState<'rmvpe' | 'harvest' | 'crepe' | 'pm'>('rmvpe');
  const [llvcIndexRate, setLlvcIndexRate] = useState(0.5);
  const [llvcFilterRadius, setLlvcFilterRadius] = useState(3);
  const [llvcRmsMixRate, setLlvcRmsMixRate] = useState(1.0);
  const [llvcProtect, setLlvcProtect] = useState(0.33);
  const [isGeneratingLlvcCover, setIsGeneratingLlvcCover] = useState(false);
  const [llvcCoverUrl, setLlvcCoverUrl] = useState<string | null>(null);
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

  const [characterModalOpen, setCharacterModalOpen] = useState(false);
  const [editingChar, setEditingChar] = useState<CharacterProfile | null>(null);
  const [charForm, setCharForm] = useState<CharacterProfile>({
      id: '', name: '', voiceId: DEFAULT_GEM_VOICE_ID, gender: 'Unknown', age: 'Adult', avatarColor: '#6366f1'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const dubAudioRef = useRef<HTMLAudioElement>(null);
  const llvcSourceMediaRef = useRef<HTMLMediaElement | null>(null);
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
  const selectedDubbingClip = useMemo(
    () => dubbingClips.find((clip) => clip.id === selectedDubbingClipId) || null,
    [dubbingClips, selectedDubbingClipId]
  );

  const mutateDubbingTimeline = useCallback(
    (mutator: (current: DubbingClip[]) => DubbingClip[]) => {
      setDubbingClips((current) => {
        const next = mutator(current);
        if (next === current) return current;
        setDubbingHistoryPast((past) => pushUndoHistory(past, current));
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
    GEM: { state: 'checking', detail: 'Checking...' },
    GOOD: { state: 'checking', detail: 'Checking...' },
    NEURAL2: { state: 'checking', detail: 'Checking...' },
    KOKORO: { state: 'checking', detail: 'Checking...' },

  });
  const [ttsAccessState, setTtsAccessState] = useState<TtsAccessState>({
    blocked: false,
    detail: 'Checking authentication...',
    checkedAt: 0,
  });
  const [runtimeVoiceCatalogs, setRuntimeVoiceCatalogs] = useState<Record<GenerationSettings['engine'], VoiceOption[]>>(
    EMPTY_RUNTIME_CATALOG
  );

  const normalizedPlanToken = normalizePlanToken(stats.planName);
  const isPaidBillingPlan = normalizedPlanToken !== 'free';
  const isFreeTierUser = !hasUnlimitedAccess && !isPaidBillingPlan;
  const entitlementAllowedEngines = useMemo(
    () => normalizeAllowedEngines(stats.limits?.allowedEngines),
    [stats.limits?.allowedEngines]
  );
  const planAllowedEngines: GenerationSettings['engine'][] = useMemo(
    () => (
      hasUnlimitedAccess
        ? [...ENGINE_ORDER]
        : entitlementAllowedEngines.length > 0
          ? entitlementAllowedEngines
          : isPaidBillingPlan
            ? [...ENGINE_ORDER]
            : ['KOKORO', 'GOOD', 'NEURAL2']
    ),
    [entitlementAllowedEngines, hasUnlimitedAccess, isPaidBillingPlan]
  );
  const maxCharsPerGeneration = Math.max(
    1,
    Number(
      stats.limits?.maxCharsPerGeneration ||
      (normalizedPlanToken === 'scale' ? 15000 : isPaidBillingPlan ? 10000 : 8000)
    )
  );
  const studioQueueSourceHash = useMemo(() => hashStudioQueueSource(text), [text]);
  const studioQueueEligible = useMemo(
    () => canUseStudioQueue(text, maxCharsPerGeneration),
    [maxCharsPerGeneration, text]
  );
  const studioQueueDraftPartCount = useMemo(() => {
    if (!studioQueueEligible) return 0;
    return buildSentenceAlignedCharWindows(text, maxCharsPerGeneration).length;
  }, [maxCharsPerGeneration, studioQueueEligible, text]);
  const isStudioQueueModeEnabled = studioQueueState?.queueModeEnabled === true;
  const hasStudioQueueItems = Boolean(studioQueueState?.items.length);
  const selectedTokenPackMeta = TOKEN_PACK_MATRIX[selectedTokenPack];
  const selectedTokenPackPriceInr = normalizedPlanToken === 'scale'
    ? selectedTokenPackMeta.scaleInr
    : selectedTokenPackMeta.standardInr;

  const isLimitReached = stats.generationsUsed >= stats.generationsLimit && !hasUnlimitedAccess;
  const currentEngineSpendable = Math.max(
    0,
    Number(stats.wallet?.spendableNowByEngine?.[settings.engine] || 0)
  );
  const isWalletBlocked = currentEngineSpendable <= 0 && !hasUnlimitedAccess;
  const hasAdClaimsRemaining =
    Math.max(0, Number(stats.wallet?.adClaimsToday || 0)) < Math.max(1, Number(stats.wallet?.adClaimsDailyLimit || 3));
  const canClaimAdReward = hasUnlimitedAccess || hasAdClaimsRemaining;
  const walletMonthlyFree = Math.max(0, Number(stats.wallet?.monthlyFreeRemaining || 0));
  const walletVff = Math.max(0, Number(stats.wallet?.vffBalance || 0));
  const walletPaid = Math.max(0, Number(stats.wallet?.paidVfBalance || 0));
  const walletMonthlyLimit = Math.max(0, Number(stats.wallet?.monthlyFreeLimit || 0));
  const balanceTotalLabel = hasUnlimitedAccess ? 'Unlimited' : `${walletMonthlyLimit.toLocaleString()} credits`;
  const balanceRemainingLabel = hasUnlimitedAccess ? 'Unlimited' : walletMonthlyFree.toLocaleString();
  const toUserFriendlySystemMessage = useCallback((raw: unknown, fallback: string): string => {
    const source = sanitizeUiText(String(raw || '').trim());
    const lowered = source.toLowerCase();
    if (
      lowered.includes('missing bearer token') ||
      lowered.includes('invalid auth token') ||
      lowered.includes('authentication was rejected') ||
      lowered.includes('auth token')
    ) {
      return 'Backend is reachable, but authentication failed. Sign in again and retry.';
    }
    if (
      lowered.includes('cannot reach backend') ||
      lowered.includes('backend gateway is unreachable') ||
      lowered.includes('cors') ||
      lowered.includes('fetch failed') ||
      lowered.includes('failed to fetch')
    ) {
      return 'Cannot connect to backend service. Verify backend health and CORS configuration, then retry.';
    }
    if (lowered.includes('did not become online') || lowered.includes('timeout')) {
      return 'Runtime is taking too long to start. Retry or check service health.';
    }
    if (lowered.includes('key pool')) {
      return 'Primary AI runtime keys are not ready. Update key settings or switch engine.';
    }
    if (
      lowered.includes('service_disabled') ||
      lowered.includes('firestore.googleapis.com') ||
      lowered.includes('googleapis.com') ||
      lowered.includes('cloud firestore api has not been used')
    ) {
      return 'Profile service is temporarily unavailable. Please try again in a few minutes.';
    }
    return source || sanitizeUiText(fallback);
  }, []);
  const isAuthOrProfileBlockingMessage = useCallback((raw: unknown): boolean => {
    const lowered = String(raw || '').trim().toLowerCase();
    if (!lowered) return false;
    return (
      lowered.includes('authentication required') ||
      lowered.includes('missing bearer token') ||
      lowered.includes('invalid auth token') ||
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
    async (options?: { force?: boolean }): Promise<{ ok: boolean; detail: string }> => {
      const now = Date.now();
      const force = Boolean(options?.force);
      const cached = ttsAccessProbeRef.current;
      if (!hasSessionIdentity) {
        const detail = 'Sign in to enable AI/TTS requests.';
        ttsAccessProbeRef.current = { ok: false, detail, checkedAt: now };
        return { ok: false, detail };
      }
      const backendUrl = mediaBackendUrl;
      if (!force && cached && now - cached.checkedAt < 15_000) {
        return { ok: cached.ok, detail: cached.detail };
      }

      try {
        const accountProfile = await fetchAccountProfile(backendUrl);
        if (Boolean(accountProfile?.requiredUserId)) {
          const detail = 'Complete your user ID setup to enable AI/TTS requests.';
          ttsAccessProbeRef.current = { ok: false, detail, checkedAt: now };
          return { ok: false, detail };
        }
        const detail = 'Authenticated';
        ttsAccessProbeRef.current = { ok: true, detail, checkedAt: now };
        return { ok: true, detail };
      } catch (error: unknown) {
        const detail = sanitizeUiText(
          mapTtsAccessBlockReason(error instanceof Error ? error.message : error, 'Authentication required.')
        );
        const safeDetail = detail || 'Sign in again to enable AI/TTS requests.';
        const shouldBlockForAuth = isAuthOrProfileBlockingMessage(safeDetail);
        if (shouldBlockForAuth) {
          const hasSessionIdentity = Boolean(String(user.uid || user.email || '').trim());
          const previous = ttsAccessProbeRef.current;
          const recentAuthenticatedProbe =
            Boolean(previous?.ok) && now - Number(previous?.checkedAt || 0) < 90_000;
          if (hasSessionIdentity && recentAuthenticatedProbe) {
            const authenticatedDetail = 'Authenticated';
            ttsAccessProbeRef.current = { ok: true, detail: authenticatedDetail, checkedAt: now };
            return { ok: true, detail: authenticatedDetail };
          }
          ttsAccessProbeRef.current = { ok: false, detail: safeDetail, checkedAt: now };
          return { ok: false, detail: safeDetail };
        }

        // Non-auth probe failures (network/service hiccups) should not block active sessions.
        const optimisticDetail = 'Authenticated';
        ttsAccessProbeRef.current = { ok: true, detail: optimisticDetail, checkedAt: now };
        return { ok: true, detail: optimisticDetail };
      }
    },
    [hasSessionIdentity, isAuthOrProfileBlockingMessage, mapTtsAccessBlockReason, mediaBackendUrl, user.email, user.uid]
  );
  const refreshTtsAccessState = useCallback(
    async (force: boolean = false): Promise<RuntimeAccessProbe> => {
      const probe = await probeProtectedTtsAccess({ force });
      const checkedAt = ttsAccessProbeRef.current?.checkedAt ?? Date.now();
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
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    const safeMessage = type === 'error' ? toUserFriendlySystemMessage(msg, msg) : sanitizeUiText(msg);
    if (!safeMessage) return;
    emit('custom.message', {
      message: safeMessage,
      severity: type === 'success' ? 'success' : type === 'error' ? 'error' : 'info',
      category: type === 'error' ? 'system' : 'activity',
      channel: 'toast',
    });
  }, [emit, toUserFriendlySystemMessage]);

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
                  setActiveTab(tabToken as Tab);
              }
          }
          if (target.adminTab) {
              const adminToken = String(target.adminTab || '').trim().toLowerCase();
              if (['usage', 'guardian', 'alerts', 'scheduler', 'audit', 'analytics'].includes(adminToken)) {
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
  const billingActions = useBillingActions({ baseUrl: mediaBackendUrl });
  const isGemRuntimeEngine = useCallback(
    (engine: GenerationSettings['engine']) => engine === 'GEM' || engine === 'GOOD' || engine === 'NEURAL2',
    []
  );
  const normalizeRuntimeUrl = (url?: string): string => (url || '').trim().replace(/\/+$/, '');
  const getDefaultRuntimeUrlForEngine = (engine: GenerationSettings['engine']): string => {
      return FALLBACK_RUNTIME_URLS[engine] || '';
  };
  const getRuntimeUrlForEngine = (engine: GenerationSettings['engine']): string => {
      const configured = isGemRuntimeEngine(engine)
        ? settings.geminiTtsServiceUrl
        : settings.kokoroTtsServiceUrl;
      const normalized = normalizeRuntimeUrl(configured);
      if (normalized) return normalized;
      return normalizeRuntimeUrl(getDefaultRuntimeUrlForEngine(engine));
  };
  const isEnginePlanAllowed = useCallback(
      (engine: GenerationSettings['engine']) => hasUnlimitedAccess || planAllowedEngines.includes(engine),
      [hasUnlimitedAccess, planAllowedEngines]
  );
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
      if (isGemRuntimeEngine(engine)) {
          return [
              ...getStaticVoiceFallback(engine).map((voice) => withVoiceMeta(voice, engine)),
              ...clonedVoices.map((voice) =>
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
      }
      return getStaticVoiceFallback(engine).map((voice) => withVoiceMeta(voice, engine));
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
          const cloneVoices = clonedVoices.map((voice) =>
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
      if (isEnginePlanAllowed(settings.engine)) return;
      const fallbackEngine = planAllowedEngines[0] || 'KOKORO';
      const fallbackVoiceId = getValidVoiceIdForEngine(fallbackEngine, settings.voiceId);
      setSettings((prev) => ({ ...prev, engine: fallbackEngine, voiceId: fallbackVoiceId }));
  }, [
      getValidVoiceIdForEngine,
      isEnginePlanAllowed,
      planAllowedEngines,
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
      activeTab === Tab.DUBBING ? dubbingTextLanguageCode : studioTextLanguageCode;

  const studioParsedScript = useMemo(() => parseMultiSpeakerScript(text), [text]);
  const studioCrewTags = useMemo(
      () => (studioParsedScript.crewTagsList || []).filter(Boolean),
      [studioParsedScript]
  );

  const castSpeakers = useMemo(() => {
      const names = new Set<string>();
      const script = activeTab === Tab.DUBBING ? dubScript : text;
      if (script.trim()) {
          const parsed = activeTab === Tab.STUDIO ? studioParsedScript : parseMultiSpeakerScript(script);
          parsed.speakersList
              .map((speaker) => speaker.trim())
              .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX')
              .forEach((speaker) => names.add(speaker));
      }
      detectedSpeakers
          .map((speaker) => speaker.trim())
          .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX')
          .forEach((speaker) => names.add(speaker));
      if (!names.size) names.add('Narrator');
      return [...names];
  }, [activeTab, detectedSpeakers, dubScript, studioParsedScript, text]);
  const isStudioMultiSpeakerEnabled = settings.multiSpeakerEnabled !== false;
  const shouldShowStudioQueuePanel = isStudioQueueModeEnabled;

  const autoAssignCastVoices = useCallback(async () => {
      if (!isStudioMultiSpeakerEnabled) {
          showToast('Enable Multi-Speaker Mode first.', 'info');
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

      const sourceScript = activeTab === Tab.DUBBING ? dubScript : text;
      if (!sourceScript.trim()) {
          showToast('Write or paste a script first.', 'info');
          return;
      }
      setIsAutoAssigningCast(true);
      try {
          let resolvedSpeakers = [...castSpeakers];
          let traitHints: Record<string, { gender?: 'Male' | 'Female' | 'Unknown'; ageGroup?: 'Child' | 'Adult' | 'Elderly' | 'Unknown'; tone?: 'calm' | 'energetic' | 'serious' }> = {};

          try {
              const aiAnalysis = await inferSpeakerTraitHintsWithAi(sourceScript, settings, castSpeakers);
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

          const rememberedVoices = resolvedSpeakers.reduce<Record<string, string>>((acc, speaker) => {
              const voiceId = String(getVoiceForCharacter(speaker) || '').trim();
              if (voiceId) acc[speaker] = voiceId;
              return acc;
          }, {});
          const autoAssignOptions = {
              speakers: resolvedSpeakers,
              script: sourceScript,
              voices: effectiveCatalog,
              characterLibrary,
              rememberedVoices,
              traitHints,
          };
          const { mapping: nextMapping, assignments } = autoAssignSpeakerVoices(
              settings.speakerMapping
                ? { ...autoAssignOptions, existingMapping: settings.speakerMapping }
                : autoAssignOptions
          );

          if (!Object.keys(nextMapping).length) {
              showToast('No cast speakers available to auto-assign.', 'info');
              return;
          }

          startTransition(() => {
              setDetectedSpeakers((prev) => {
                  const merged = new Set(
                      [...prev, ...resolvedSpeakers]
                          .map((speaker) => String(speaker || '').trim())
                          .filter(Boolean)
                  );
                  return merged.size > 0 ? [...merged] : prev;
              });
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
              speakerMapping: {
                  ...prev.speakerMapping,
                  ...nextMapping,
                  },
          }));
          const mappedCount = Object.keys(nextMapping).length;
          const detectedCount = resolvedSpeakers.length;
          showToast(
              `AI detected ${detectedCount} speaker${detectedCount === 1 ? '' : 's'} and assigned ${mappedCount} voice${mappedCount === 1 ? '' : 's'}.`,
              'success'
          );
      } finally {
          setIsAutoAssigningCast(false);
      }
  }, [
      activeScriptLanguageCode,
      activeTab,
      castSpeakers,
      characterLibrary,
      dubScript,
      getEngineVoiceCatalog,
      getLanguageScopedVoiceCatalog,
      getVoiceForCharacter,
      inferSpeakerTraitHintsWithAi,
      isFreeTierUser,
      isStudioMultiSpeakerEnabled,
      resolveVoiceAccessTier,
      resolveVoiceAgeGroup,
      settings,
      settings.engine,
      settings.speakerMapping,
      showToast,
      text,
      updateCharacter,
  ]);

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
              subtitle: dubbingUiState.stage || 'Processing backend 2026 dubbing pipeline.',
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
          title: 'Ready for dubbing',
          subtitle: 'Upload source clips, select language, and press AI Dub.',
          progressPct: 0,
      };
  }, [dubbingUiState.phase, dubbingUiState.progress, dubbingUiState.stage, resolvedTheme]);

  const refreshEngineVoiceCatalog = useCallback(
      async (engine: GenerationSettings['engine'], _runtimeUrl?: string): Promise<VoiceOption[]> => {
          try {
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

  const probeRuntimeStatus = useCallback(async (_engine: GenerationSettings['engine']): Promise<EngineRuntimeStatus> => {
      try {
          const payload = await fetchTtsEnginesStatus(_engine, mediaBackendUrl);
          const engineItem = payload.engines?.[_engine];
          if (!engineItem) {
              return { state: 'offline', detail: sanitizeUiText('Gateway did not return runtime status.') };
          }
          if (engineItem.state === 'online' || engineItem.state === 'starting' || engineItem.state === 'offline') {
              const runtimeReady = typeof engineItem.ready === 'boolean' ? engineItem.ready : engineItem.state === 'online';
              const runtimeState: EngineRuntimeState =
                  engineItem.state === 'online' && !runtimeReady ? 'starting' : engineItem.state;
              const runtimeDetail = sanitizeUiText(engineItem.detail || 'Runtime status updated.');
              return { state: runtimeState, detail: runtimeDetail };
          }
          return { state: 'offline', detail: sanitizeUiText(engineItem.detail || 'Runtime status unavailable.') };
      } catch (error: unknown) {
          const rawDetail = error instanceof Error ? error.message : 'Runtime offline';
          const detail = sanitizeUiText(rawDetail || 'Runtime offline');
          return { state: 'offline', detail };
      }
  }, [mediaBackendUrl]);

  const refreshTtsRuntimeStatus = async () => {
      const browserKokoroEnabled = isBrowserKokoroExecutionEnabled();
      const statuses = await Promise.all(
          ENGINE_ORDER.map(async (engine) => {
              if (engine === 'KOKORO' && browserKokoroEnabled) {
                  const { kokoroBrowserRuntime } = await loadKokoroBrowserRuntimeModule();
                  const browserState = kokoroBrowserRuntime.getState();
                  if (isLimitReached) {
                      return [engine, { state: 'standby', detail: 'Daily limit reached. Local ONNX CPU runtime disabled.' }] as const;
                  }
                  if (browserState === 'ready') {
                      return [engine, { state: 'online', detail: 'Local ONNX CPU runtime ready' }] as const;
                  }
                  if (browserState === 'warming') {
                      return [engine, { state: 'starting', detail: 'Preparing local ONNX CPU runtime...' }] as const;
                  }
                  if (browserState === 'suspended') {
                      return [engine, { state: 'standby', detail: 'Local ONNX CPU runtime suspended (auto-resume on generate)' }] as const;
                  }
                  return [engine, { state: 'standby', detail: 'Local ONNX CPU runtime idle' }] as const;
              }
              const status = await probeRuntimeStatus(engine);
              if (
                  managedActiveEngine &&
                  engine !== managedActiveEngine &&
                  status.state === 'offline'
              ) {
                  return [engine, { state: 'standby', detail: 'Standby (auto-start on switch)' }] as const;
              }
              return [engine, status] as const;
          })
      );

      setTtsRuntimeStatus(
          ENGINE_ORDER.reduce((acc, engine) => {
              acc[engine] = statuses.find(([name]) => name === engine)?.[1] || { state: 'offline', detail: 'Unknown' };
              return acc;
          }, {} as Record<GenerationSettings['engine'], EngineRuntimeStatus>)
      );

  };

  const waitForRuntimeOnline = async (engine: GenerationSettings['engine'], timeoutMs: number): Promise<boolean> => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
          const status = await probeRuntimeStatus(engine);
          if (status.state === 'online') return true;
          await new Promise((resolve) => setTimeout(resolve, 900));
      }
      return false;
  };

  const ensureEngineOnline = async (
      engine: GenerationSettings['engine'],
      options?: { timeoutMs?: number; silent?: boolean; syncVoiceId?: string; requireAccess?: boolean }
  ): Promise<{ runtimeUrl: string; catalog: VoiceOption[]; syncedVoiceId?: string }> => {
      const engineLabel = getEngineDisplayName(engine);
      if (!isEnginePlanAllowed(engine)) {
          throw new Error(`${engineLabel} is not enabled for your current plan.`);
      }
      let runtimeUrl = getRuntimeUrlForEngine(engine);
      try {
          const statusPayload = await fetchTtsEnginesStatus(engine, mediaBackendUrl);
          const gatewayRuntimeUrl = normalizeRuntimeUrl(statusPayload.engines?.[engine]?.runtimeUrl);
          if (gatewayRuntimeUrl) runtimeUrl = gatewayRuntimeUrl;
      } catch {
          // Runtime URL is now gateway-managed; keep backward-compat fallback value if status call fails.
      }

      const currentStatus = await probeRuntimeStatus(engine);
      if (
          isGemRuntimeEngine(engine) &&
          currentStatus.state === 'offline' &&
          String(currentStatus.detail || '').toLowerCase().includes('key pool')
      ) {
          throw new Error(currentStatus.detail || 'Primary AI key pool is not configured.');
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
              next[engine] = { state: 'online', detail: currentStatus.detail || 'Runtime online' };
              ENGINE_ORDER.forEach((other) => {
                  if (other === engine) return;
                  if (next[other].state === 'not_configured') return;
                  if (next[other].state === 'offline' || next[other].state === 'checking' || next[other].state === 'starting') {
                      next[other] = { state: 'standby', detail: 'Standby (auto-start on switch)' };
                  }
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
          [engine]: { state: 'starting', detail: 'Starting runtime...' },
      }));

      try {
          let switchResult;
          try {
              switchResult = await switchTtsEngineRuntime(mediaBackendUrl, engine);
          } catch (switchError: any) {
              const detail = String(switchError?.message || switchError || '').toLowerCase();
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
          setTtsRuntimeStatus(prev => {
              const next = { ...prev };
              next[engine] = { state: 'starting', detail: switchResult?.detail || 'Starting runtime...' };
              ENGINE_ORDER.forEach((other) => {
                  if (other === engine) return;
                  if (next[other].state === 'not_configured') return;
                  next[other] = { state: 'standby', detail: 'Standby (auto-start on switch)' };
              });
              return next;
          });

          const timeoutMs = options?.timeoutMs ?? (switchResult?.state === 'starting' ? 90000 : 60000);
          const online = await waitForRuntimeOnline(engine, timeoutMs);
          if (!online) {
              throw new Error(`${engineLabel} runtime did not become online within ${Math.round(timeoutMs / 1000)}s. Check gateway status and runtime logs.`);
          }

          const refreshedCatalog = await refreshEngineVoiceCatalog(engine, runtimeUrl);
          setTtsRuntimeStatus(prev => ({ ...prev, [engine]: { state: 'online', detail: 'Runtime online' } }));
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
          const reason = error?.message || 'Unknown runtime error';
          setTtsRuntimeStatus(prev => ({ ...prev, [engine]: { state: 'offline', detail: reason } }));
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

  const refreshBackendHealth = async (silent: boolean = false) => {
      setIsCheckingBackend(true);
      try {
          const health = await checkMediaBackendHealth(mediaBackendUrl);
          const ffmpegMissing = !health.ffmpeg?.available;
          const llvcError = Boolean(health.voiceTransfer?.error);
          const whisperError = Boolean(health.whisper?.error);
          const separationError = Boolean(health.sourceSeparation?.enabled && !health.sourceSeparation?.available);
          const hasSubsystemError = ffmpegMissing || llvcError || whisperError || separationError;
          const severity: HealthSeverity = ffmpegMissing || !health.ok
            ? 'error'
            : hasSubsystemError
              ? 'warn'
              : 'ok';
          const separationState = health.sourceSeparation?.enabled
            ? (health.sourceSeparation?.available ? 'Separation Model Ready' : 'Separation Model Error')
            : 'Separation Disabled';
          const languageHint = Array.isArray(health.whisper?.supportedLanguages)
            ? health.whisper?.supportedLanguages.join('/')
            : 'n/a';
          const summary = [
              health.ffmpeg?.available ? 'FFmpeg OK' : 'FFmpeg Missing',
              health.voiceTransfer?.error ? 'Voice Transfer Error' : 'Voice Transfer Ready',
              health.whisper?.error ? 'Whisper Error' : `Whisper ${health.whisper?.loaded ? 'Loaded' : 'Idle'} (${languageHint})`,
              separationState,
          ].join(' | ');
          setBackendHealth({ ok: Boolean(health.ok) && !ffmpegMissing, summary: sanitizeUiText(summary), severity });
      } catch (e: any) {
          const message = toUserFriendlySystemMessage(e?.message, 'Backend unreachable');
          setBackendHealth({ ok: false, summary: message, severity: 'error' });
          if (!silent) {
              showToast(message, 'error');
          }
      } finally {
          setIsCheckingBackend(false);
      }
  };

  const refreshLlvcModels = async (silent: boolean = false) => {
      setIsLoadingLlvcModels(true);
      try {
          const payload = await listVoiceTransferModels(mediaBackendUrl);
          setVoiceTransferModels(payload.models);
          setSettings(prev => {
              const preferred = prev.voiceModel && payload.models.includes(prev.voiceModel) ? prev.voiceModel : '';
              const nextModel = preferred || payload.currentModel || payload.models[0] || '';
              return { ...prev, voiceModel: nextModel };
          });
      } catch (e: any) {
          setVoiceTransferModels([]);
          if (!silent) {
              showToast(e?.message || 'Failed to load voice transfer models', 'error');
          }
      } finally {
          setIsLoadingLlvcModels(false);
      }
  };

  const prepareKokoroExecution = useCallback(async (
      context: 'studio' | 'preview',
      voiceId: string,
      speed: number,
      signal?: AbortSignal
  ): Promise<{ runtimeUrl: string; catalog: VoiceOption[]; syncedVoiceId?: string }> => {
      if (isLimitReached && !hasUnlimitedAccess) {
          if (isBrowserKokoroExecutionEnabled()) {
              const { kokoroBrowserRuntime } = await loadKokoroBrowserRuntimeModule();
              await kokoroBrowserRuntime.suspend();
          }
          setTtsRuntimeStatus((prev) => ({
              ...prev,
              KOKORO: { state: 'standby', detail: 'Daily limit reached. Local ONNX CPU runtime disabled.' },
          }));
          throw new Error('Daily generation limit reached. Kokoro local runtime is disabled for today.');
      }
      const access = await refreshTtsAccessState(true);
      if (!access.ok) {
          throw new Error(access.detail || 'Sign in again to enable AI/TTS requests.');
      }

      const useBrowserKokoro = shouldUseBrowserKokoroExecution('KOKORO', context);
      if (!useBrowserKokoro) {
          if (isBrowserKokoroExecutionEnabled()) {
              const { kokoroBrowserRuntime } = await loadKokoroBrowserRuntimeModule();
              await kokoroBrowserRuntime.suspend();
          }
          setTtsRuntimeStatus((prev) => (
              prev.KOKORO?.state === 'online'
                  ? prev
                  : {
                      ...prev,
                      KOKORO: { state: 'checking', detail: 'Checking Kokoro runtime...' },
                  }
          ));
          return await ensureEngineOnlineRef.current('KOKORO', { silent: true, syncVoiceId: voiceId });
      }

      setManagedActiveEngine('KOKORO');
      setTtsRuntimeStatus((prev) => ({
          ...prev,
          KOKORO: { state: 'starting', detail: 'Preparing local ONNX CPU runtime...' },
      }));

      try {
          const { kokoroBrowserRuntime } = await loadKokoroBrowserRuntimeModule();
          await kokoroBrowserRuntime.ensureReady({
              backendBaseUrl: mediaBackendUrl,
              voiceId,
              speed,
              ...(signal ? { signal } : {}),
          });
          setTtsRuntimeStatus((prev) => ({
              ...prev,
              KOKORO: { state: 'online', detail: 'Local ONNX CPU runtime ready' },
          }));
          return {
              runtimeUrl: settings.kokoroTtsServiceUrl || FALLBACK_RUNTIME_URLS.KOKORO,
              catalog: getEngineVoiceCatalog('KOKORO'),
              syncedVoiceId: voiceId,
          };
      } catch (error: any) {
          if (error?.name === 'AbortError') {
              throw error;
          }
          const detail = error?.message || (
              useBrowserKokoro
                  ? `Kokoro local runtime unavailable in ${context}.`
                  : `Kokoro runtime unavailable in ${context}.`
          );
          setTtsRuntimeStatus((prev) => ({
              ...prev,
              KOKORO: { state: 'offline', detail },
          }));
          throw new Error(detail);
      }
  }, [
      getEngineVoiceCatalog,
      hasUnlimitedAccess,
      isLimitReached,
      mediaBackendUrl,
      refreshTtsAccessState,
      settings.kokoroTtsServiceUrl,
  ]);

  // --- Effects ---
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiTheme, uiTheme); }, [uiTheme]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiDensity, uiDensity); }, [uiDensity]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiFontScale, String(uiFontScale)); }, [uiFontScale]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.uiMotionLevel, uiMotionLevel); }, [uiMotionLevel]);
  useEffect(() => { writeStorageString(STORAGE_KEYS.studioEditorMode, studioEditorMode); }, [studioEditorMode]);
  useEffect(() => {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      const mobileSafeBottom =
        activeTab === Tab.STUDIO
          ? (isChatOpen
              ? 'calc(env(safe-area-inset-bottom) + 20.5rem)'
              : 'calc(env(safe-area-inset-bottom) + 11.5rem)')
          : 'calc(env(safe-area-inset-bottom) + 9.5rem)';
      root.style.setProperty('--vf-toast-mobile-safe-bottom', mobileSafeBottom);
      return () => {
          root.style.removeProperty('--vf-toast-mobile-safe-bottom');
      };
  }, [activeTab, isChatOpen]);
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
                  const isSelectedEngine = engine === settings.engine;
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
              category: 'system',
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
      const dailyLimit = Math.max(1, Number(stats.generationsLimit || 30));
      const dailyUsed = Math.max(0, Number(stats.generationsUsed || 0));
      const usageRatio = dailyUsed / dailyLimit;
      const lowBalanceThreshold = 600;

      const issueNotice = (
        key: string,
        send: () => void
      ) => {
          if (quotaNoticeRef.current[key]) return;
          quotaNoticeRef.current[key] = true;
          send();
      };

      if (usageRatio >= 0.8) {
          issueNotice(`${dayKey}-quota-80`, () => {
              emit('quota.daily.80', {
                  title: 'Usage Notice',
                  message: `Daily generation usage is above 80% (${dailyUsed}/${dailyLimit}).`,
                  dedupeKey: `${dayKey}-daily-80`,
                  channel: 'inbox',
              });
          });
      }
      if (usageRatio >= 0.95) {
          issueNotice(`${dayKey}-quota-95`, () => {
              emit('quota.daily.95', {
                  title: 'Usage Warning',
                  message: `Daily generation usage is above 95% (${dailyUsed}/${dailyLimit}).`,
                  dedupeKey: `${dayKey}-daily-95`,
                  channel: 'inbox',
              });
          });
      }
      if (dailyUsed >= dailyLimit) {
          issueNotice(`${dayKey}-quota-limit`, () => {
              emit('quota.daily.reached', {
                  title: 'Daily Limit Reached',
                  message: `Daily generation limit reached (${dailyUsed}/${dailyLimit}).`,
                  sticky: true,
                  dedupeKey: `${dayKey}-daily-limit`,
              });
          });
      }

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
      stats.generationsLimit,
      stats.generationsUsed,
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
                      onClick: () => { void refreshBackendHealth(false); },
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
              geminiTtsServiceUrl: normalizeServiceSetting(prev.geminiTtsServiceUrl, FALLBACK_RUNTIME_URLS.GEM),
              kokoroTtsServiceUrl: normalizeServiceSetting(prev.kokoroTtsServiceUrl, FALLBACK_RUNTIME_URLS.KOKORO),
          };
          if (
              next.geminiTtsServiceUrl === prev.geminiTtsServiceUrl &&
              next.kokoroTtsServiceUrl === prev.kokoroTtsServiceUrl
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
      ttsAccessProbeRef.current = null;
      setTtsAccessState({
          blocked: !hasSessionIdentity,
          detail: hasSessionIdentity ? 'Checking authentication...' : 'Sign in to enable AI/TTS requests.',
          checkedAt: 0,
      });
      if (!hasSessionIdentity) {
          return () => {
              cancelled = true;
          };
      }
      void (async () => {
          const authStateReady = (firebaseAuth as { authStateReady?: () => Promise<void> }).authStateReady;
          if (typeof authStateReady === 'function') {
              await authStateReady.call(firebaseAuth).catch(() => undefined);
          }
          if (cancelled) return;
          await refreshTtsAccessState(true);
      })();
      return () => {
          cancelled = true;
      };
  }, [hasSessionIdentity, mediaBackendUrl, refreshTtsAccessState, user.uid, user.userId, user.email]);

  useEffect(() => {
      if (activeTab === Tab.LAB && labMode === 'COVERS') {
          void refreshBackendHealth(true);
          void refreshLlvcModels(true);
      }
  }, [activeTab, labMode, mediaBackendUrl]);

  useEffect(() => {
      const tick = async () => {
          if (isGenerating || Boolean(engineSwitchInProgress)) return;
          if (!hasSessionIdentity) {
              setTtsRuntimeStatus((prev) =>
                  ENGINE_ORDER.reduce((acc, engine) => {
                      acc[engine] =
                          prev[engine]?.state === 'standby' && prev[engine]?.detail === 'Sign in to check runtime status.'
                              ? prev[engine]
                              : { state: 'standby', detail: 'Sign in to check runtime status.' };
                      return acc;
                  }, {} as Record<GenerationSettings['engine'], EngineRuntimeStatus>)
              );
              return;
          }
          await Promise.all([refreshTtsRuntimeStatus(), refreshTtsAccessState()]);
      };
      void tick();
      const interval = setInterval(() => {
          void tick();
      }, 90000);
      return () => clearInterval(interval);
  }, [
      hasUnlimitedAccess,
      isLimitReached,
      settings.geminiTtsServiceUrl,
      settings.kokoroTtsServiceUrl,
      managedActiveEngine,
      isGenerating,
      hasSessionIdentity,
      engineSwitchInProgress,
      refreshTtsAccessState,
  ]);

  useEffect(() => {
      if (settings.engine !== 'KOKORO') return;
      if (isLimitReached && !hasUnlimitedAccess) return;
      let cancelled = false;
      void (async () => {
          try {
              await prepareKokoroExecution('studio', settings.voiceId, 1.0);
              if (cancelled) return;
          } catch (error: any) {
              if (cancelled) return;
              setTtsRuntimeStatus((prev) => ({
                  ...prev,
                  KOKORO: {
                      state: 'offline',
                      detail: error?.message || 'Local ONNX CPU runtime unavailable.',
                  },
              }));
          }
      })();
      return () => {
          cancelled = true;
      };
  }, [hasUnlimitedAccess, isLimitReached, prepareKokoroExecution, settings.engine, settings.voiceId]);

  useEffect(() => {
      if (activeTab !== Tab.STUDIO) return;
      if (!hasSessionIdentity) return;
      if (!isBrowserKokoroExecutionEnabled()) return;
      if (isLimitReached && !hasUnlimitedAccess) return;
      let cancelled = false;
      const timer = setTimeout(() => {
          void (async () => {
              try {
                  const { kokoroBrowserRuntime } = await loadKokoroBrowserRuntimeModule();
                  const state = kokoroBrowserRuntime.getState();
                  if (state === 'ready' || state === 'warming') return;
                  setTtsRuntimeStatus((prev) => ({
                      ...prev,
                      KOKORO: { state: 'starting', detail: 'Preparing local ONNX CPU runtime...' },
                  }));
                  await kokoroBrowserRuntime.ensureReady({
                      backendBaseUrl: mediaBackendUrl,
                      voiceId: settings.voiceId || DEFAULT_KOKORO_VOICE_ID,
                      speed: 1.0,
                  });
                  if (cancelled) return;
                  setTtsRuntimeStatus((prev) => ({
                      ...prev,
                      KOKORO: { state: 'online', detail: 'Local ONNX CPU runtime ready' },
                  }));
              } catch {
                  // Best-effort Studio warmup. Generation flow still falls back to normal runtime prep.
              }
          })();
      }, 1200);

      return () => {
          cancelled = true;
          clearTimeout(timer);
      };
  }, [
      activeTab,
      hasSessionIdentity,
      hasUnlimitedAccess,
      isLimitReached,
      mediaBackendUrl,
      settings.voiceId,
  ]);

  useEffect(() => {
      if (!isLimitReached || hasUnlimitedAccess) return;
      if (isBrowserKokoroExecutionEnabled()) {
          void loadKokoroBrowserRuntimeModule().then(({ kokoroBrowserRuntime }) => kokoroBrowserRuntime.suspend());
      }
      setTtsRuntimeStatus((prev) => ({
          ...prev,
          KOKORO: { state: 'standby', detail: 'Daily limit reached. Local ONNX CPU runtime disabled.' },
      }));
  }, [hasUnlimitedAccess, isLimitReached]);

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

          const engineLabel = String(detail.engine || detail.runtimeLabel || 'TTS Runtime').trim();
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
          if (!isGenerating) return;
          const queueState = studioQueueStateRef.current;
          const activeQueueItemId = String(activeStudioQueueItemIdRef.current || '').trim();
          const activeQueueItem = activeQueueItemId
              ? queueState?.items.find((item) => item.id === activeQueueItemId) || null
              : null;
          const expectedEngine = String(activeQueueItem?.settingsSnapshot.engine || settings.engine || '').trim().toUpperCase();
          const detailEngine = String(detail.engine || '').trim().toUpperCase();
          if (detailEngine && expectedEngine && detailEngine !== expectedEngine) return;
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
                                  ? { ...item, jobId: detailJobId }
                                  : item
                          )),
                      };
                  });
              }
          }
          const pct = Number(detail.progressPct || 0);
          const stage = String(detail.stage || '').trim();
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
          if (!isGenerating) return;
          const queueState = studioQueueStateRef.current;
          const activeQueueItemId = String(activeStudioQueueItemIdRef.current || '').trim();
          const activeQueueItem = activeQueueItemId
              ? queueState?.items.find((item) => item.id === activeQueueItemId) || null
              : null;
          const expectedEngine = String(activeQueueItem?.settingsSnapshot.engine || settings.engine || '').trim().toUpperCase();
          const detailEngine = String(detail.engine || '').trim().toUpperCase();
          if (detailEngine && expectedEngine && detailEngine !== expectedEngine) return;
          const index = Number(detail.index);
          const audioBase64 = String(detail.audioBase64 || '').trim();
          if (!Number.isFinite(index) || index < 0 || !audioBase64) return;
          const activeJobId = String(activeGatewayJobIdRef.current || '').trim();
          if (!activeJobId) return;
          const detailJobId = String(detail.jobId || '').trim();
          if (!detailJobId || detailJobId !== activeJobId) return;
          const key = `${detailJobId}:${Math.round(index)}`;
          if (seenLiveChunkKeysRef.current.has(key)) return;
          seenLiveChunkKeysRef.current.add(key);
          setLiveAudioChunks((prev) => {
              const next = [
                  ...prev,
                  {
                      jobId: detailJobId,
                      index: Math.round(index),
                      engine: detailEngine || String(settings.engine || 'GEM'),
                      contentType: String(detail.contentType || 'audio/wav'),
                      durationMs: Number(detail.durationMs || 0),
                      textChars: Number(detail.textChars || 0),
                      traceId: String(detail.traceId || ''),
                      audioBase64,
                  },
              ];
              next.sort((a, b) => a.index - b.index);
              return next;
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
          if (llvcCoverUrl) URL.revokeObjectURL(llvcCoverUrl);
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
  }, [llvcCoverUrl, renderedDubVideoUrl, dubbingJobResultUrl, dubbingReportUrl, resetDubbingLivePlayback]);

  useEffect(() => {
      document.body.classList.toggle('theme-dark', resolvedTheme === 'dark');
      return () => document.body.classList.remove('theme-dark');
  }, [resolvedTheme]);

  useEffect(() => {
      const previousCompact = document.body.dataset.compact;
      document.body.dataset.compact = uiDensity === 'compact' ? 'true' : 'false';
      return () => {
          if (previousCompact) document.body.dataset.compact = previousCompact;
          else delete document.body.dataset.compact;
      };
  }, [uiDensity]);

  useEffect(() => {
      const previousMotion = document.body.dataset.motion;
      document.body.dataset.motion = uiMotionLevel;
      document.body.classList.toggle('vf-motion-off', uiMotionLevel === 'off');
      document.body.classList.toggle('vf-motion-balanced', uiMotionLevel === 'balanced');
      document.body.classList.toggle('vf-motion-rich', uiMotionLevel === 'rich');
      return () => {
          if (previousMotion) document.body.dataset.motion = previousMotion;
          else delete document.body.dataset.motion;
          document.body.classList.remove('vf-motion-off', 'vf-motion-balanced', 'vf-motion-rich');
      };
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
      if (activeTab !== Tab.STUDIO) return;
      let frameId = 0;
      const applyDockCenter = () => {
          if (frameId) window.cancelAnimationFrame(frameId);
          frameId = window.requestAnimationFrame(() => {
          const studioMainRect = studioMainRef.current?.getBoundingClientRect();
          const fallback = Math.round(window.innerWidth / 2);
          const centerX = studioMainRect ? Math.round(studioMainRect.left + (studioMainRect.width / 2)) : fallback;
          document.documentElement.style.setProperty('--vf-studio-dock-center-x', `${centerX}px`);
          });
      };
      applyDockCenter();
      window.addEventListener('resize', applyDockCenter, { passive: true });
      return () => {
          if (frameId) window.cancelAnimationFrame(frameId);
          window.removeEventListener('resize', applyDockCenter);
      };
  }, [activeTab, uiDensity, uiFontScale]);

  useEffect(() => {
      if (isChatOpen && chatEndRef.current) {
          chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
  }, [chatHistory, isChatOpen]);

  // Cleanup timer on unmount
  useEffect(() => {
      return () => { 
          if(progressTimerRef.current) clearInterval(progressTimerRef.current);
          if(previewAudioRef.current) previewAudioRef.current.pause();
          if(generationAbortController.current) generationAbortController.current.abort();
          if (queueMasterRebuildTimerRef.current) window.clearTimeout(queueMasterRebuildTimerRef.current);
          Object.values(studioQueueAudioUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
          if (masterQueueAudioUrlRef.current) {
              URL.revokeObjectURL(masterQueueAudioUrlRef.current);
              masterQueueAudioUrlRef.current = null;
          }
      }
  }, []);

  const deferredAnalysisText = useDeferredValue(
    activeTab === Tab.STUDIO ? text : (activeTab === Tab.DUBBING ? dubScript : '')
  );

  // Auto-detect language and speakers in text (Studio Mode AND Dubbing Mode)
  useEffect(() => {
    const textToAnalyze = deferredAnalysisText;
    if (!textToAnalyze.trim()) {
      setDetectedLang(null);
      setDetectedSpeakers([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      if (textToAnalyze.length > 5 && settings.language === 'Auto') {
        const code = await detectLanguage(textToAnalyze, settings);
        setDetectedLang(code.toUpperCase());
      } else {
        setDetectedLang(null);
      }

      const { isMultiSpeaker, speakersList } = parseMultiSpeakerScript(textToAnalyze);
      if (isMultiSpeaker && speakersList.length > 0) {
        setDetectedSpeakers(speakersList);
        syncCast(speakersList);
      } else {
        setDetectedSpeakers([]);
      }
    }, 1500); 
    return () => clearTimeout(timeoutId);
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
      if (videoRef.current) videoRef.current.volume = videoVolume;
      if (dubAudioRef.current) dubAudioRef.current.volume = dubVolume;
  }, [videoVolume, dubVolume]);


  // --- Logic Functions ---

  const setLiveProgress = useCallback((nextProgress: number, stageMessage?: string) => {
      const safe = Math.max(0, Math.min(99, Math.round(nextProgress)));
      setProgress((prev) => Math.max(prev, safe));
      if (stageMessage) setProcessingStage(sanitizeUiText(stageMessage));
  }, []);

  // Helper to start simulated progress
  const startSimulation = (
      estSeconds: number,
      startMsg: string,
      mode: 'simulated' | 'live' = 'simulated'
  ) => {
     if (progressTimerRef.current) clearInterval(progressTimerRef.current);
     
     setProgress(0);
     setTimeLeft(mode === 'simulated' ? estSeconds : 0);
     setProcessingStage(sanitizeUiText(startMsg));
     setIsGenerating(true);
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
     }, 100);
  };

  const stopSimulation = () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      setProgress(100);
      setTimeLeft(0);
      // Short delay to show 100% before closing
      setTimeout(() => {
          setIsGenerating(false);
          setProgress(0);
      }, 500);
  };

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
          if (current && current !== nextUrl) URL.revokeObjectURL(current);
          const next = { ...prev };
          if (nextUrl) next[itemId] = nextUrl;
          else delete next[itemId];
          return next;
      });
  }, []);

  const resetStudioQueueOutputState = useCallback(async (clearCache = false) => {
      if (queueMasterRebuildTimerRef.current) {
          window.clearTimeout(queueMasterRebuildTimerRef.current);
          queueMasterRebuildTimerRef.current = null;
      }
      Object.values(studioQueueAudioUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      studioQueueAudioUrlsRef.current = {};
      setStudioQueueAudioUrls({});
      if (masterQueueAudioUrlRef.current) {
          URL.revokeObjectURL(masterQueueAudioUrlRef.current);
          masterQueueAudioUrlRef.current = null;
      }
      setGeneratedAudioUrl(null);
      if (clearCache) {
          await clearStudioQueueAudioCache().catch(() => undefined);
      }
  }, []);

  const rebuildStudioQueueMasterAudio = useCallback(async (
      stateOverride?: StudioQueueState | null
  ): Promise<string | null> => {
      const sourceState = stateOverride || studioQueueStateRef.current;
      const completedItems = [...(sourceState?.items || [])]
          .sort((left, right) => left.order - right.order)
          .filter((item) => item.status === 'completed' && item.audioCacheKey);
      if (completedItems.length === 0) {
          if (masterQueueAudioUrlRef.current) {
              URL.revokeObjectURL(masterQueueAudioUrlRef.current);
              masterQueueAudioUrlRef.current = null;
          }
          setGeneratedAudioUrl(null);
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

      const mergedBlob = await mergeStudioQueueAudioBlobs(blobs);
      const nextUrl = buildStudioQueueBlobUrl(mergedBlob);
      if (masterQueueAudioUrlRef.current) {
          URL.revokeObjectURL(masterQueueAudioUrlRef.current);
      }
      masterQueueAudioUrlRef.current = nextUrl;
      setGeneratedAudioUrl(nextUrl);
      updateStudioQueueState((prev) => prev ? { ...prev, masterStatus: nextUrl ? 'ready' : 'idle' } : prev);
      return nextUrl;
  }, [updateStudioQueueState]);

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
      const audioCacheKey = item.audioCacheKey || `studio-queue:${item.id}`;
      activeStudioQueueItemIdRef.current = item.id;
      activeGatewayJobIdRef.current = String(item.jobId || '').trim();
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
                          audioCacheKey,
                      }
                      : entry
              )),
          };
      });

      try {
          let wavBlob: Blob;
          if (String(item.jobId || '').trim()) {
              const queuedResult = await pollTtsGatewayJobForAudio({
                  baseUrl: resolveMediaBackendUrl(item.settingsSnapshot),
                  jobId: item.jobId || '',
                  runtimeLabel: getEngineDisplayName(item.settingsSnapshot.engine),
                  engine: item.settingsSnapshot.engine,
                  signal: controller.signal,
              });
              const decoded = await getAudioContext().decodeAudioData(queuedResult.audioBytes.slice(0));
              const mixedBuffer = await applyStudioAudioMix(decoded, item.settingsSnapshot);
              wavBlob = audioBufferToWav(mixedBuffer);
          } else {
              const result = await performGeneration(
                  item.sourceText,
                  controller.signal,
                  item.settingsSnapshot,
                  { createObjectUrl: false }
              );
              wavBlob = result.wavBlob;
          }

          await storeStudioQueueAudioBlob(audioCacheKey, wavBlob);
          replaceStudioQueueItemAudioUrl(item.id, buildStudioQueueBlobUrl(wavBlob));
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
                              jobId: String(activeGatewayJobIdRef.current || entry.jobId || '').trim(),
                              completedAt: Date.now(),
                          }
                          : entry
                  )),
              };
          });
      } catch (error: any) {
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
                              error: error?.name === 'AbortError' ? undefined : (error?.message || 'Queue generation failed.'),
                              audioCacheKey,
                              jobId: String(activeGatewayJobIdRef.current || entry.jobId || '').trim(),
                          }
                          : entry
                  )),
              };
          });
          throw error;
      } finally {
          activeGatewayJobIdRef.current = '';
      }
  }, [performGeneration, replaceStudioQueueItemAudioUrl, updateStudioQueueState]);

  const executeStudioQueue = useCallback(async (
      initialState?: StudioQueueState | null
  ): Promise<void> => {
      if (queueRunnerLockRef.current) return;
      queueRunnerLockRef.current = true;
      isStudioQueueRunActiveRef.current = true;

      try {
          let nextItem = findNextStudioQueueProcessItem(initialState || studioQueueStateRef.current);
          while (nextItem) {
              const controller = new AbortController();
              generationAbortController.current = controller;
              await runStudioQueueItem(nextItem, controller);
              scheduleStudioQueueMasterRebuild();
              generationAbortController.current = null;
              nextItem = findNextStudioQueueProcessItem(studioQueueStateRef.current);
          }

          const masterUrl = await rebuildStudioQueueMasterAudio(studioQueueStateRef.current);
          const completedItems = [...(studioQueueStateRef.current?.items || [])].filter((item) => item.status === 'completed');
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
          showToast(`Queued audio ready (${completedItems.length} part${completedItems.length === 1 ? '' : 's'}).`, 'success');
      } finally {
          queueRunnerLockRef.current = false;
          isStudioQueueRunActiveRef.current = false;
          generationAbortController.current = null;
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
      showToast,
      text,
  ]);

  const startStudioQueuedGeneration = useCallback(async (): Promise<void> => {
      const currentHash = hashStudioQueueSource(text);
      const existingState = studioQueueStateRef.current;
      const hasResumableCurrentQueue = Boolean(
          existingState
          && existingState.sourceHash === currentHash
          && existingState.items.some((item) => item.status === 'queued' || item.status === 'running' || item.status === 'failed')
      );
      let nextState = hasResumableCurrentQueue
          ? {
              ...existingState!,
              queueModeEnabled: true,
          }
          : createStudioQueueState(text, maxCharsPerGeneration, settings, true);
      if (!nextState.items.some((item) => item.status === 'queued' || item.status === 'running')) {
          const firstFailed = [...nextState.items].sort((left, right) => left.order - right.order).find((item) => item.status === 'failed');
          if (firstFailed) {
              nextState = {
                  ...nextState,
                  activeItemId: firstFailed.id,
                  items: nextState.items.map((item) => (
                      item.id === firstFailed.id
                          ? { ...item, status: 'queued', error: undefined, jobId: undefined }
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
      activeGatewayJobIdRef.current = '';

      const estTime = Math.max(4, Math.ceil(text.length / 18));
      startSimulation(estTime, 'Preparing queued generation...', 'live');
      emit('generation.started', {
          title: 'Generation Started',
          message: 'Queued Studio generation started.',
          dedupeKey: 'generation-started',
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
          emit('generation.failed', {
              title: 'Generation Failure',
              message: error?.message || 'Queue generation failed. Check runtime health and retry.',
              dedupeKey: 'generation-failed-main',
              action: {
                  label: 'Open Settings',
                  onClick: () => setShowSettings(true),
              },
          });
          showToast(error?.message || 'Queue generation failed.', 'error');
      }
  }, [
      emit,
      executeStudioQueue,
      maxCharsPerGeneration,
      resetStudioQueueOutputState,
      settings,
      showToast,
      text,
  ]);

  const retryStudioQueueItem = useCallback((itemId: string) => {
      updateStudioQueueState((prev) => {
          if (!prev) return prev;
          return {
              ...prev,
              activeItemId: itemId,
              items: prev.items.map((item) => (
                  item.id === itemId
                      ? { ...item, status: 'queued', error: undefined, jobId: undefined }
                      : item
              )),
          };
      });
  }, [updateStudioQueueState]);

  const resumeStudioQueue = useCallback(async () => {
      let currentState = studioQueueStateRef.current;
      if (!currentState || !currentState.items.length) return;
      if (isGenerating) return;
      if (!currentState.items.some((item) => item.status === 'queued' || item.status === 'running')) {
          const firstFailed = [...currentState.items].sort((left, right) => left.order - right.order).find((item) => item.status === 'failed');
          if (firstFailed) {
              currentState = {
                  ...currentState,
                  activeItemId: firstFailed.id,
                  items: currentState.items.map((item) => (
                      item.id === firstFailed.id
                          ? { ...item, status: 'queued', error: undefined, jobId: undefined }
                          : item
                  )),
              };
              setStudioQueueState(currentState);
          }
      }
      startSimulation(Math.max(4, Math.ceil(text.length / 18)), 'Resuming queued generation...', 'live');
      try {
          await executeStudioQueue(currentState);
      } catch (error: any) {
          if (error?.name !== 'AbortError') {
              showToast(error?.message || 'Queue resume failed.', 'error');
          }
      }
  }, [executeStudioQueue, isGenerating, showToast, text.length]);

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
      startSimulation(Math.max(4, Math.ceil(studioQueueState.items.reduce((sum, item) => sum + item.charCount, 0) / 18)), 'Reconnecting queued generation...', 'live');
      void executeStudioQueue(studioQueueState).catch((error: any) => {
          if (error?.name !== 'AbortError') {
              showToast(error?.message || 'Queue recovery failed.', 'error');
          }
      });
  }, [executeStudioQueue, isGenerating, scheduleStudioQueueMasterRebuild, showToast, studioQueueState]);

  const handleCancelGeneration = () => {
      if (!isGenerating) return;

      const hadController = Boolean(generationAbortController.current);
      if (hadController) {
          generationAbortController.current?.abort();
          generationAbortController.current = null;
          setProcessingStage(sanitizeUiText('Cancelling generation...'));
          const activeDubJobId = String(activeDubbingJobIdRef.current || '').trim();
          if (activeDubJobId) {
              void cancelDubbingJob(mediaBackendUrl, activeDubJobId).catch(() => undefined);
          }
      } else {
          stopSimulation();
      }

      activeGatewayJobIdRef.current = '';
      activeDubbingJobIdRef.current = '';
      setLiveAudioChunks([]);
      seenLiveChunkKeysRef.current.clear();
      emit('generation.cancelled', {
          title: 'Generation Cancelled',
          message: 'Generation cancelled.',
          dedupeKey: 'generation-cancelled',
          channel: 'inbox',
      });
  };

  const shouldUseBrowserKokoro = (
      engine: GenerationSettings['engine'],
      context: 'studio' | 'preview' | 'dubbing'
  ): boolean => shouldUseBrowserKokoroExecution(engine, context);
  
  async function performGeneration(
      scriptText: string,
      signal?: AbortSignal,
      settingsOverride?: GenerationSettings,
      options?: { createObjectUrl?: boolean }
  ) {
      if (!scriptText.trim()) throw new Error("Text is empty");
      const studioSettings = normalizeSettings(settingsOverride || settings);
      const multiSpeakerEnabled = studioSettings.multiSpeakerEnabled !== false;
      const preferBrowserKokoro = shouldUseBrowserKokoro(studioSettings.engine, 'studio');
      setLiveProgress(14, preferBrowserKokoro ? 'Preparing local ONNX CPU runtime...' : `Checking ${studioSettings.engine} runtime...`);
      let engineState: { runtimeUrl: string; catalog: VoiceOption[]; syncedVoiceId?: string };
      if (studioSettings.engine === 'KOKORO') {
          engineState = await prepareKokoroExecution('studio', studioSettings.voiceId, studioSettings.speed, signal);
      } else {
          engineState = await ensureEngineOnline(studioSettings.engine, { silent: true, syncVoiceId: studioSettings.voiceId, requireAccess: true });
      }
      const browserKokoro = studioSettings.engine === 'KOKORO' && preferBrowserKokoro;
      setLiveProgress(28, browserKokoro ? 'Local ONNX CPU runtime ready. Preparing voice selection...' : 'Runtime ready. Preparing voice selection...');
      
      // Auto-Add Characters to Library before generation
      if (multiSpeakerEnabled && detectedSpeakers.length > 0) {
          syncCast(detectedSpeakers);
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
      const engineVoiceName = studioSettings.engine === 'KOKORO'
        ? voiceId
        : (selectedVoice?.geminiVoiceName || voiceId || 'Fenrir');
      const generationSettings = {
          ...studioSettings,
          multiSpeakerEnabled,
          voiceId,
          runtimeVoiceCatalog: freshCatalog,
      } as GenerationSettings & { runtimeVoiceCatalog?: VoiceOption[] };

      // Pass signal to generateSpeech and then apply studio-level audio mix.
      setLiveProgress(40, 'Generating audio...');
      const ttsBuffer = await generateSpeech(
          scriptText,
          engineVoiceName,
          generationSettings,
          'speech',
          signal,
          { context: 'studio', preferLiveChunks: true }
      );
      if (browserKokoro) {
          const { kokoroBrowserRuntime } = await loadKokoroBrowserRuntimeModule();
          kokoroBrowserRuntime.scheduleSuspend(studioSettings.kokoroStandbyIdleMs || 300000);
      }
      setLiveProgress(74, 'TTS response received. Applying studio mix...');
      const mixedBuffer = await applyStudioAudioMix(ttsBuffer, generationSettings);
      setLiveProgress(90, 'Rendering final audio buffer...');
      const wavBlob = audioBufferToWav(mixedBuffer);
      const url = options?.createObjectUrl === false ? null : URL.createObjectURL(wavBlob);
      
      return { url, wavBlob, voiceNameDisplay };
  }

  const handleGenerate = async () => {
    if (!text.trim()) return showToast("Please enter some text.", "info");
    if (!hasUnlimitedAccess && text.length > maxCharsPerGeneration) {
      if (!isStudioQueueModeEnabled) {
        return showToast(`This plan allows up to ${maxCharsPerGeneration.toLocaleString()} characters per generation. Enable Queue to process long scripts in parts.`, 'error');
      }
      await startStudioQueuedGeneration();
      return;
    }
    if (isLimitReached) return showToast('Daily generation limit reached (30/day).', 'error');
    if (isWalletBlocked) {
      if (hasAdClaimsRemaining) {
        setShowAdModal(true);
        return;
      }
      return showToast(`Insufficient ${getEngineDisplayName(settings.engine)} VF balance.`, 'error');
    }
    
    // Setup Abort Controller
    if (generationAbortController.current) generationAbortController.current.abort();
    const controller = new AbortController();
    generationAbortController.current = controller;
    
    setGeneratedAudioUrl(null);
    setLiveAudioChunks([]);
    seenLiveChunkKeysRef.current.clear();
    activeGatewayJobIdRef.current = '';
    
    // Calculate Estimate
    // TTS speed is roughly 20 chars per second for runtime estimate
    const estTime = Math.max(3, Math.ceil(text.length / 20));
    startSimulation(estTime, "Preparing backend generation...", 'live');
    emit('generation.started', {
      title: 'Generation Started',
      message: 'Generation started.',
      dedupeKey: 'generation-started',
      channel: 'inbox',
    });

    try {
      const { url, voiceNameDisplay } = await performGeneration(text, controller.signal);
      if (!url) throw new Error('Generated audio URL missing.');
      setLiveProgress(96, 'Finalizing output and updating history...');
      setGeneratedAudioUrl(url);

      addToHistory({
        id: Date.now().toString(),
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        audioUrl: url,
        voiceName: isStudioMultiSpeakerEnabled && detectedSpeakers.length > 0
          ? `Cast (${detectedSpeakers.length})`
          : voiceNameDisplay,
        timestamp: Date.now()
      });
      void loadHistory(30);

      generationFailureBurstRef.current = 0;
      showToast("Audio Generated!", "success");
    } catch (e: any) {
      if (e.name === 'AbortError') {
          // Cancelled cleanly
      } else {
          syncRuntimeBlockedStateFromError(settings.engine, e);
          generationFailureBurstRef.current += 1;
          emit('generation.failed', {
              title: 'Generation Failure',
              message: e.message || 'Generation failed. Check runtime health and retry.',
              dedupeKey: 'generation-failed-main',
              action: {
                  label: 'Open Settings',
                  onClick: () => setShowSettings(true),
              },
          });
      }
    } finally {
      stopSimulation();
      generationAbortController.current = null;
      activeGatewayJobIdRef.current = '';
    }
  };

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
      const engine: GenerationSettings['engine'] = voice?.engine || 'GEM';
      await playVoiceSample(voiceId, name, engine);
  };

  const resolveVoicePreviewUrl = useCallback((voice?: VoiceOption): string => {
      const raw = String(voice?.previewUrl || '').trim();
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) return raw;
      const base = String(mediaBackendUrl || '').trim().replace(/\/+$/, '');
      if (!base) return raw;
      return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
  }, [mediaBackendUrl]);

  const playVoiceSample = async (voiceId: string, name: string, engine: GenerationSettings['engine'] = 'GEM') => {
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
      const selectedVoice = getVoiceById(voiceId);
      const fallbackPreviewUrl = resolveVoicePreviewUrl(selectedVoice);

      const playAudioSource = async (sourceUrl: string, revokeOnEnd: boolean): Promise<void> => {
          const audio = new Audio(sourceUrl);
          audio.crossOrigin = 'anonymous';
          previewAudioRef.current = audio;
          audio.volume = 1.0;
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
              if (engine === 'KOKORO' && shouldUseBrowserKokoroExecution(engine, 'preview')) {
                  void loadKokoroBrowserRuntimeModule().then(({ kokoroBrowserRuntime }) => {
                      kokoroBrowserRuntime.scheduleSuspend(settings.kokoroStandbyIdleMs || 300000);
                  });
              }
          };
          await audio.play();
          setPreviewState({ id: voiceId, status: 'playing' });
      };

      try {
          if (engine === 'KOKORO') {
              await prepareKokoroExecution('preview', voiceId, 1.0);
          } else {
              await ensureEngineOnline(engine, { silent: true, syncVoiceId: voiceId, requireAccess: true });
          }

          const previewSettings: GenerationSettings = {
              ...settings,
              engine,
              voiceId,
              speed: 1.0,
              emotion: 'Neutral',
          };

          const text = `Hello! I am ${name}. I can bring your story to life.`;
          
          // Use the correct voice name parameter expected by generateSpeech
          let voiceParam = name;
          if (isGemRuntimeEngine(engine)) {
            voiceParam = getVoiceById(voiceId)?.geminiVoiceName || clonedVoices.find(v => v.id === voiceId)?.geminiVoiceName || 'Fenrir';
          } else {
            voiceParam = voiceId;
          }

          const buffer = await generateSpeech(
              text,
              voiceParam,
              previewSettings,
              'speech',
              undefined,
              { context: 'preview', preferLiveChunks: true }
          );
          const blob = audioBufferToWav(buffer);
          const url = URL.createObjectURL(blob);
          await playAudioSource(url, true);
      } catch (e: any) {
          if (fallbackPreviewUrl) {
              try {
                  await playAudioSource(fallbackPreviewUrl, false);
                  showToast('Playing speaker reference preview.', 'info');
                  return;
              } catch {
                  // Fall through to primary error handling.
              }
          }
          syncRuntimeBlockedStateFromError(engine, e);
          showToast(e.message, 'error');
          setPreviewState(null);
      }
  };

  const handlePreviewCharacter = async (char: CharacterProfile) => {
     const vid = char.voiceId;
      const engine: GenerationSettings['engine'] = getVoiceById(vid)?.engine || 'GEM';
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
          const jobId = String(clip.jobId || '').trim();
          if (jobId) {
              try {
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

  const handleRemoveCompletedQueue = useCallback(() => {
      const completed = dubbingClips.filter((clip) => clip.status === 'completed');
      completed.forEach((clip) => releaseClipArtifacts(clip));
      mutateDubbingTimeline((current) => removeCompletedClips(current));
  }, [dubbingClips, mutateDubbingTimeline, releaseClipArtifacts]);

  const handleClearDubbingQueue = useCallback(async () => {
      for (const clip of dubbingClips) {
          const jobId = String(clip.jobId || '').trim();
          if (jobId) {
              try {
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

  const handleTimelineUndo = useCallback(() => {
      setDubbingHistoryPast((past) => {
          const undone = undoTimeline(past, dubbingClips, dubbingHistoryFuture);
          if (undone.changed) {
              setDubbingClips(undone.current);
              setDubbingHistoryFuture(undone.future);
          }
          return undone.past;
      });
  }, [dubbingClips, dubbingHistoryFuture]);

  const handleTimelineRedo = useCallback(() => {
      setDubbingHistoryFuture((future) => {
          const redone = redoTimeline(dubbingHistoryPast, dubbingClips, future);
          if (redone.changed) {
              setDubbingClips(redone.current);
              setDubbingHistoryPast(redone.past);
          }
          return redone.future;
      });
  }, [dubbingClips, dubbingHistoryPast]);

  const handleDubbingTimelineTool = useCallback((tool: 'cut' | 'copy' | 'paste' | 'split' | 'trim_in' | 'trim_out' | 'layer' | 'remove') => {
      if (!selectedDubbingClipId) {
          showToast('Select a clip first.', 'info');
          return;
      }
      if (tool === 'copy') {
          const copied = copyClip(dubbingClips, selectedDubbingClipId);
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
              const pasted = pasteClipAfterSelection(current, selectedDubbingClipId, dubbingClipboard);
              pastedAny = Boolean(pasted.pastedId);
              if (pasted.pastedId) setSelectedDubbingClipId(String(pasted.pastedId));
              return pasted.clips;
          });
          showToast(pastedAny ? 'Clip pasted.' : 'Clipboard is empty.', pastedAny ? 'success' : 'info');
          return;
      }
      if (tool === 'cut') {
          mutateDubbingTimeline((current) => cutClip(current, selectedDubbingClipId).clips);
          showToast('Clip cut from timeline.', 'success');
          return;
      }
      if (tool === 'split') {
          let didSplit = false;
          mutateDubbingTimeline((current) => {
              const split = splitClipAtPlayhead(current, selectedDubbingClipId, dubbingPlayheadMs);
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
              trimClipWindow(current, selectedDubbingClipId, { trimInMs: Math.max(0, dubbingPlayheadMs) })
          );
          showToast('Trim-in updated.', 'success');
          return;
      }
      if (tool === 'trim_out') {
          mutateDubbingTimeline((current) =>
              trimClipWindow(current, selectedDubbingClipId, { trimOutMs: Math.max(0, dubbingPlayheadMs) })
          );
          showToast('Trim-out updated.', 'success');
          return;
      }
      if (tool === 'layer') {
          const target = dubbingClips.find((clip) => clip.id === selectedDubbingClipId);
          const nextLayer: DubbingClip['layer'] = target?.layer === 'V2' ? 'V1' : 'V2';
          mutateDubbingTimeline((current) => moveClipLayer(current, selectedDubbingClipId, nextLayer));
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
          speakerize: 'Applied speaker labels to dialogue lines.',
          dedupe: 'Removed duplicate consecutive lines.',
          compact: 'Compacted script to non-empty lines.',
      };
      showToast(labels[mode], 'success');
  };

  const handleGenerateDub = async () => {
      if (dubbingClips.length <= 0) return showToast("Upload at least one video first", "info");
      if (isLimitReached) return showToast('Daily generation limit reached (30/day).', 'error');
      if (isWalletBlocked) {
          if (hasAdClaimsRemaining) {
              setShowAdModal(true);
              return;
          }
          return showToast(`Insufficient ${getEngineDisplayName(settings.engine)} VF balance.`, 'error');
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
          tts: 'Phase 4/6: Gemini TTS',
          voice_transfer: 'Phase 5/6: Voice transfer',
          video_lipsync: 'Phase 6/6: Video lip-sync',
          preflight: 'Preflight checks',
          queued: 'Queued',
      };

      resetDubbingLivePlayback();
      startSimulation(26, 'Submitting backend dubbing job...', 'live');
      patchDubbingUiState({
          phase: 'running',
          progress: 6,
          stage: 'Queue started (CPU sequential mode)',
          error: '',
      });
      emit('generation.started', {
          title: 'Generation Started',
          message: 'Generation started for dubbing queue workflow.',
          dedupeKey: 'generation-started-dubbing',
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
                  if (!jobId) throw new Error('Backend did not return a dubbing job id.');
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
                              stage: `${stageLabel} (${index + 1}/${queue.length}) • ${speakerToken} • ${qosToken}`,
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
                  setDubbingClips((current) =>
                      current.map((item) =>
                          item.id === clip.id
                              ? { ...item, status: 'failed', error: clipError?.message || 'Clip dubbing failed' }
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
              emit('generation.failed', {
                  title: 'Generation Failure',
                  message: e?.message || 'Generation failed. Check backend health and retry.',
                  dedupeKey: 'generation-failed-dubbing',
                  action: {
                      label: 'Open Settings',
                      onClick: () => setShowSettings(true),
                  },
              });
              patchDubbingUiState({
                  phase: 'error',
                  progress: 100,
                  stage: 'Dubbing failed',
                  error: e?.message || 'Unknown dubbing error',
              });
              showToast(e?.message || 'Dubbing failed.', 'error');
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

  // --- AI Tools (Shared) ---

  // --- PROOFREADER ---
  const handleProofread = async (mode: 'grammar' | 'flow' | 'creative' | 'novel' = 'flow') => {
      const currentText = activeTab === Tab.DUBBING ? dubScript : text;
      const setFn = activeTab === Tab.DUBBING ? setDubScript : setText;
      
      if (!currentText || !currentText.trim()) return showToast("Enter text to proofread", "info");
      
      setIsAiWriting(true);
      showToast(mode === 'grammar' ? "Fixing Grammar..." : mode === 'novel' ? "Directing Audio Novel..." : "Optimizing...", "info");
      
      try {
          const polished = await proofreadScript(currentText, settings, mode);
          setFn(polished);
          showToast("Script Enhanced", "success");
      } catch (e: any) {
          syncRuntimeBlockedStateFromError(settings.engine, e);
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };

  const handleDirectorAI = async (targetText: string, mode: 'audio_drama' | 'video_dub' = 'audio_drama') => {
      const safeInput = String(targetText || '');
      if (!safeInput.trim()) return showToast('Enter text first', 'info');
      setIsAiWriting(true);
      try {
          const options = mode === 'video_dub' ? directorOptions : undefined;
          // Speaker assignment only: keep original script unchanged.
          const { mood, cast } = await autoFormatScript(safeInput, settings, 'audio_drama', options, characterLibrary);
          
          if (cast && cast.length > 0) {
              syncCast(cast as CharacterProfile[]);
              showToast(`AI Director assigned cast for ${cast.length} speaker${cast.length === 1 ? '' : 's'}.`, "success");
          } else {
              showToast(`No speakers found to assign. Mood: ${mood || 'Neutral'}`, "info");
          }

      } catch (e: any) {
          syncRuntimeBlockedStateFromError(settings.engine, e);
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };
  
  const handleTranslate = async () => {
      const isDubbing = activeTab === Tab.DUBBING;
      const currentText = isDubbing ? dubScript : text;
      const setFn = isDubbing ? setDubScript : setText;
      
      if(!currentText) return showToast("Enter text first", "info");
      
      setIsAiWriting(true);
      try {
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

  const handleChatSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!chatInput.trim()) return;
      
      const userText = chatInput;
      setChatHistory(prev => [...prev, { role: 'user', text: userText }]);
      setChatInput('');
      setIsChatLoading(true);
      
      const context = activeTab === Tab.DUBBING ? dubScript : text;
      
      try {
          const response = await generateTextContent(userText, context, settings);
          setChatHistory(prev => [...prev, { role: 'ai', text: sanitizeUiText(response) }]);
      } catch (e: any) {
          syncRuntimeBlockedStateFromError(settings.engine, e);
          const message = sanitizeUiText(e?.message || 'Assistant request failed.');
          setChatHistory(prev => [...prev, { role: 'ai', text: `[Assistant error] ${message}` }]);
          showToast(message, 'error');
      } finally {
          setIsChatLoading(false);
      }
  };

  const handleVoiceClone = async () => {
      if (!cloneName || !uploadVoiceFile) return showToast("Missing name or file", "info");
      const file = uploadVoiceFile; 
      if(!file) return;

      startSimulation(5, "Analyzing Voice Print...");

      try {
          const analysis = await analyzeVoiceSample(file, settings);
          const description = analysis.description;

          const newVoice: ClonedVoice = {
              id: `clone_${Date.now()}`,
              name: cloneName,
              gender: 'Unknown',
              accent: 'Custom',
              geminiVoiceName: 'Fenrir', 
              originalSampleUrl: URL.createObjectURL(file),
              dateCreated: Date.now(),
              description,
              isCloned: true
          };
          addClonedVoice(newVoice);
          setSettings((s) => ({ ...s, voiceId: newVoice.id }));
          if (analysis.emotionHint) {
              const confidencePct = Math.round((analysis.emotionHint.confidence || 0) * 100);
              showToast(
                  `Emotion helper: ${analysis.emotionHint.emotion}${confidencePct > 0 ? ` (${confidencePct}%)` : ''}`,
                  'info'
              );
          }
          showToast("Voice Cloned Successfully!", "success");
          setCloneName('');
          setUploadVoiceFile(null);
      } catch(e: any) {
          showToast(e.message, "error");
      } finally {
          stopSimulation();
      }
  };

  useEffect(() => {
      if (!llvcSourceFile) {
          setLlvcSourcePreviewUrl((previous) => {
              if (previous) URL.revokeObjectURL(previous);
              return null;
          });
          setIsLlvcSourcePlaying(false);
          llvcSourceMediaRef.current = null;
          return;
      }
      const nextUrl = URL.createObjectURL(llvcSourceFile);
      setLlvcSourcePreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return nextUrl;
      });
      setIsLlvcSourcePlaying(false);
      return () => {
          URL.revokeObjectURL(nextUrl);
      };
  }, [llvcSourceFile]);

  const isLlvcSourceVideo = useMemo(() => {
      if (!llvcSourceFile) return false;
      const mime = String(llvcSourceFile.type || '').toLowerCase();
      if (mime.startsWith('video/')) return true;
      return /\.(mp4|mov|m4v|webm|mkv|avi|flv|wmv)$/i.test(llvcSourceFile.name);
  }, [llvcSourceFile]);

  const handleToggleLlvcSourcePlayback = useCallback(() => {
      const media = llvcSourceMediaRef.current;
      if (!media) return;
      if (media.paused) {
          media.play().catch(() => {
              showToast('Cannot play selected source file.', 'error');
          });
      } else {
          media.pause();
      }
  }, [showToast]);

  const handleClearLlvcSourceFile = useCallback(() => {
      const media = llvcSourceMediaRef.current;
      if (media && !media.paused) media.pause();
      setIsLlvcSourcePlaying(false);
      setLlvcSourceFile(null);
  }, []);

  const handleGenerateLlvcCover = async () => {
      if (!llvcSourceFile) return showToast('Upload a source audio/video file first.', 'info');
      if (!settings.voiceModel) return showToast('Select a voice transfer model.', 'info');

      setIsGeneratingLlvcCover(true);
      try {
          await loadVoiceTransferModel(mediaBackendUrl, settings.voiceModel);
          const coverBlob = await convertVoiceTransferCover(mediaBackendUrl, llvcSourceFile, settings.voiceModel, {
              preset: llvcPreset,
              pitchShift: llvcPitchShift,
              f0Method: llvcF0Method,
              indexRate: llvcIndexRate,
              filterRadius: llvcFilterRadius,
              rmsMixRate: llvcRmsMixRate,
              protect: llvcProtect,
          });

          if (llvcCoverUrl) URL.revokeObjectURL(llvcCoverUrl);
          const nextUrl = URL.createObjectURL(coverBlob);
          setLlvcCoverUrl(nextUrl);
          showToast('Voice transfer generated.', 'success');
      } catch (e: any) {
          showToast(e?.message || 'Voice transfer failed.', 'error');
      } finally {
          setIsGeneratingLlvcCover(false);
      }
  };

  // --- Derived State for Gallery ---
  const galleryVoicePool = useMemo(() => {
      const dedup = new Map<string, VoiceOption>();
      ENGINE_ORDER.forEach((engine) => {
          getEngineVoiceCatalog(engine).forEach((voice) => {
              dedup.set(voice.id, voice);
          });
      });
      return [...dedup.values()];
  }, [getEngineVoiceCatalog]);

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
    isGemRuntimeEngine(engine)
      ? 'Cloud Runtime'
      : 'Basic Runtime'
  );
  const getRuntimeStateLabel = (state: EngineRuntimeState) => {
    if (state === 'online') return 'Online';
    if (state === 'offline') return 'Offline';
    if (state === 'standby') return 'Standby';
    if (state === 'starting') return 'Starting';
    if (state === 'not_configured') return 'Not Set';
    return 'Checking';
  };
  const getRuntimeStateClasses = (state: EngineRuntimeState) => {
    if (resolvedTheme === 'dark') {
      if (state === 'online') return 'bg-emerald-950/45 text-emerald-300 border-emerald-700/60';
      if (state === 'offline') return 'bg-red-950/45 text-red-300 border-red-700/60';
      if (state === 'standby') return 'bg-slate-800 text-slate-300 border-slate-700';
      if (state === 'starting') return 'bg-indigo-950/45 text-indigo-200 border-indigo-700/60';
      if (state === 'not_configured') return 'bg-amber-950/45 text-amber-300 border-amber-700/60';
      return 'bg-slate-900 text-slate-300 border-slate-700';
    }
    if (state === 'online') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (state === 'offline') return 'bg-red-50 text-red-700 border-red-200';
    if (state === 'standby') return 'bg-slate-100 text-slate-700 border-slate-200';
    if (state === 'starting') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    if (state === 'not_configured') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  };
  const activateTtsEngine = async (engine: GenerationSettings['engine']) => {
      if (engineSwitchInProgress) return;
      if (!isEnginePlanAllowed(engine)) {
          if (!hasUnlimitedAccess && !isPaidBillingPlan) {
              setShowSubscriptionModal(true);
              showToast('Prime engine is available on paid plans. Upgrade to continue.', 'info');
          } else {
              showToast(`${getEngineLabel(engine)} is not enabled for this plan.`, 'info');
          }
          return;
      }
      if (engine === settings.engine && ttsRuntimeStatus[engine].state === 'online') return;

      const nextVoiceId = getValidVoiceIdForEngine(engine, settings.voiceId);

      setSettings(prev => {
          const catalog = getEngineVoiceCatalog(engine);
          const fallbackVoiceId = getValidVoiceIdForEngine(engine, catalog[0]?.id || nextVoiceId || prev.voiceId);
          const refreshedMapping: Record<string, string> = {};
          Object.entries(prev.speakerMapping || {}).forEach(([speaker, mappedVoiceId]) => {
              refreshedMapping[speaker] = getValidVoiceIdForEngine(engine, mappedVoiceId || fallbackVoiceId);
          });
          return {
              ...prev,
              engine,
              voiceId: getValidVoiceIdForEngine(engine, prev.voiceId),
              speakerMapping: refreshedMapping,
          };
      });

      try {
          if (engine !== 'KOKORO') {
              await ensureEngineOnline(engine, { syncVoiceId: nextVoiceId });
              return;
          }
          await prepareKokoroExecution('studio', nextVoiceId, settings.speed);
      } catch (error: any) {
          showToast(`Failed to activate ${getEngineLabel(engine)}: ${error?.message || 'Unknown error'}`, 'error');
      }
  };
  const activeTabLabel = activeTab === Tab.STUDIO
    ? 'Studio'
    : activeTab === Tab.DUBBING
      ? 'Video Dub'
      : activeTab === Tab.CHARACTERS
        ? 'Characters'
        : activeTab === Tab.NOVEL
          ? 'Novel Workspace'
          : activeTab === Tab.READER
            ? 'Reader'
          : activeTab === Tab.HISTORY
            ? 'History'
            : activeTab === Tab.ADMIN
              ? 'Admin'
              : 'Voice Lab';
  const contentMaxWidthClass = activeTab === Tab.STUDIO
    ? 'max-w-[1140px]'
    : activeTab === Tab.READER
      ? 'max-w-[1360px]'
      : 'max-w-5xl';
  const workspaceTabs = useMemo(() => buildWorkspaceTabs(hasAdminConsoleAccess), [hasAdminConsoleAccess]);

  useEffect(() => {
      if (!hasAdminConsoleAccess && activeTab === Tab.ADMIN) {
          setActiveTab(Tab.STUDIO);
      }
  }, [activeTab, hasAdminConsoleAccess]);
  const isGuestSession =
    !user.email ||
    user.email.toLowerCase() === 'guest@voiceflow.ai' ||
    user.googleId === 'guest_mode';

  const openAuthScreen = (mode: 'login' | 'signup') => {
      writeStorageString(STORAGE_KEYS.authIntent, mode);
      setIsMobileMenuOpen(false);
      setScreen(AppScreen.LOGIN);
  };

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
          if (!result.url) throw new Error('Checkout URL is missing.');
          if (Number.isFinite(result.packVf) && Number.isFinite(result.finalAmountInr)) {
              showToast(
                  `Checkout: ${(result.packVf || 0).toLocaleString()} VF for ₹${(result.finalAmountInr || 0).toLocaleString()}.`,
                  'info'
              );
          }
          window.location.href = result.url;
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

  const Sidebar = () => (
    <aside
      className={`vf-sidebar-shell fixed inset-y-0 left-0 z-[56] xl:z-40 w-72 max-w-[90vw] xl:w-64 transform transition-transform duration-300 xl:translate-x-0 ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      } ${
        isDarkUi
          ? 'border-r border-slate-800 bg-slate-950/92 shadow-[0_24px_56px_rgba(2,6,23,0.72)]'
          : 'border-r border-gray-200 bg-white/95 shadow-2xl md:shadow-xl'
      } flex h-full flex-col overflow-hidden backdrop-blur-xl`}
    >
      <div className={`vf-sidebar-brand flex items-center gap-3 border-b px-5 py-5 ${isDarkUi ? 'border-slate-800' : 'border-gray-100'}`}>
        <BrandLogo size="md" tone={isDarkUi ? 'light' : 'dark'} />
      </div>

      <nav className={`vf-sidebar-nav space-y-1 border-b px-3 py-3 ${isDarkUi ? 'border-slate-800' : 'border-gray-100'}`}>
        {workspaceTabs.map(item => (
          <button
            key={item.id}
            onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
            className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all ${
              activeTab === item.id
                ? isDarkUi
                  ? 'border border-cyan-500/35 bg-cyan-500/15 text-cyan-100 shadow-[0_6px_18px_rgba(6,182,212,0.16)]'
                  : 'border border-cyan-100 bg-cyan-50 text-cyan-700 shadow-sm'
                : isDarkUi
                  ? 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </nav>

      <div className="vf-sidebar-scroll custom-scrollbar flex-1 min-h-0 overflow-y-auto">
        {activeTab === Tab.STUDIO && (
          <div className="animate-in fade-in space-y-5 px-4 pb-3 pt-4">
            <div>
              <div className={`mb-2.5 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.14em] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                <span className="whitespace-nowrap">Recent Drafts</span>
                <button
                  onClick={() => { setText(''); setSettings(s => ({ ...s, speakerMapping: {} })); }}
                  className={`text-[11px] font-semibold normal-case tracking-normal ${isDarkUi ? 'text-cyan-300 hover:text-cyan-200' : 'text-cyan-700 hover:text-cyan-800'}`}
                >
                  New
                </button>
              </div>
              <div className="custom-scrollbar max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {drafts.length === 0 && <div className={`text-xs italic ${isDarkUi ? 'text-slate-500' : 'text-gray-400'}`}>No drafts yet</div>}
                {drafts.map(d => (
                  <div key={d.id} className={`group flex items-center justify-between rounded-lg border px-2 py-2 transition-colors ${
                    isDarkUi ? 'border-slate-800 bg-slate-900/60 hover:bg-slate-900' : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}>
                    <button
                      type="button"
                      onClick={() => { setText(d.text); setSettings(normalizeSettings(d.settings)); setIsMobileMenuOpen(false); }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <FileText size={14} className={`flex-shrink-0 ${isDarkUi ? 'text-slate-400' : 'text-gray-400'}`} />
                      <span className={`truncate text-sm ${isDarkUi ? 'text-slate-200' : 'text-gray-700'}`}>{d.name}</span>
                    </button>
                    <button
                      onClick={() => { deleteDraft(d.id); }}
                      className={`opacity-0 transition-opacity group-hover:opacity-100 ${isDarkUi ? 'text-rose-300 hover:text-rose-200' : 'text-rose-500 hover:text-rose-700'}`}
                      aria-label={`Delete draft ${d.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        <div className="px-4 pb-4">
          <div className={`vf-sidebar-balance rounded-2xl border p-3 shadow-sm ${
            isDarkUi ? 'border-slate-800 bg-slate-900/75 shadow-black/20' : 'border-gray-200 bg-white'
          }`}>
            <div className={`rounded-xl border px-3 py-2.5 ${
              isDarkUi ? 'border-slate-700 bg-slate-950/70' : 'border-gray-200 bg-gray-50/90'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${isDarkUi ? 'text-slate-200' : 'text-gray-800'}`}>
                  <span className={`h-2.5 w-2.5 rounded-full border ${isDarkUi ? 'border-slate-500 bg-cyan-400' : 'border-gray-300 bg-white'}`} />
                  <span>Balance</span>
                </div>
                <button
                  onClick={() => setShowSubscriptionModal(true)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    isDarkUi ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400' : 'bg-cyan-600 text-white hover:bg-cyan-500'
                  }`}
                >
                  Upgrade
                </button>
              </div>
              <div className={`mt-2.5 space-y-1 text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                <div className="flex items-center justify-between">
                  <span>Total</span>
                  <strong className={isDarkUi ? 'text-slate-100' : 'text-gray-900'}>{balanceTotalLabel}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Remaining</span>
                  <strong className={isDarkUi ? 'text-slate-100' : 'text-gray-900'}>{balanceRemainingLabel}</strong>
                </div>
              </div>
            </div>

            <div className={`mt-2 text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
              Spendable now ({getEngineDisplayName(settings.engine)}): {hasUnlimitedAccess ? 'Unlimited' : `${currentEngineSpendable.toLocaleString()} VF`}
            </div>
            <div className={`mt-1 text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
              VFF Free: {walletVff.toLocaleString()} | Paid VF: {walletPaid.toLocaleString()}
            </div>
            <div className={`mt-1 text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
              Ads today: {Math.max(0, Number(stats.wallet?.adClaimsToday || 0))}/{Math.max(1, Number(stats.wallet?.adClaimsDailyLimit || 3))}
            </div>
            <div className={`mt-1 text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
              Per-generation cap: {maxCharsPerGeneration.toLocaleString()} chars
            </div>
            <div className={`mt-1 text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
              Engines: {planAllowedEngines.map((engine) => getEngineDisplayName(engine)).join(', ')}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowAdModal(true)}
                disabled={!canClaimAdReward}
                className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold disabled:opacity-50 ${
                  isDarkUi
                    ? 'border-amber-400/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                    : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                <Gift size={12} />
                Watch Ad
              </button>
              <button
                onClick={() => { void handleBuyTokenPack(); }}
                disabled={isBuyingTokenPack}
                className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold disabled:opacity-50 ${
                  isDarkUi
                    ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {isBuyingTokenPack ? <Loader2 size={12} className="animate-spin" /> : <Coins size={12} />}
                {`${selectedTokenPackMeta.label} ${Math.round(selectedTokenPackMeta.vf / 1000)}k`}
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
                  const displayPrice = normalizedPlanToken === 'scale' ? item.scaleInr : item.standardInr;
                  return (
                    <option key={packKey} value={packKey}>
                      {`${item.label} • ${item.vf.toLocaleString()} VF • ₹${displayPrice.toLocaleString()}`}
                    </option>
                  );
                })}
              </select>
              <div className={`mt-1 text-[10px] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>
                Checkout price: ₹{selectedTokenPackPriceInr.toLocaleString()} ({normalizedPlanToken === 'scale' ? 'Scale discount applied' : 'Standard pricing'})
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <input
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value)}
                placeholder="Coupon code"
                className={`h-8 min-w-0 flex-1 rounded-lg border px-2 text-[11px] outline-none transition-colors ${
                  isDarkUi
                    ? 'border-slate-700 bg-slate-950/70 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400'
                    : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-cyan-300'
                }`}
              />
              <button
                onClick={() => { void handleRedeemCoupon(); }}
                disabled={isRedeemingCoupon || !couponCode.trim()}
                className={`h-8 rounded-lg border px-2 text-[11px] font-semibold disabled:opacity-50 ${
                  isDarkUi
                    ? 'border-cyan-400/35 text-cyan-200 hover:bg-cyan-500/10'
                    : 'border-cyan-200 text-cyan-700 hover:bg-cyan-50'
                }`}
              >
                {isRedeemingCoupon ? <Loader2 size={12} className="animate-spin" /> : 'Redeem'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`vf-sidebar-footer shrink-0 border-t p-4 backdrop-blur-md ${isDarkUi ? 'border-slate-800 bg-slate-950/88' : 'border-gray-200 bg-white/90'}`}>
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
          onClick={() => setScreen(AppScreen.PROFILE)}
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
      </div>
    </aside>
  );

  const renderSettingsPanel = () => {
      const assistantRouting = resolveAssistantProviderRouting(settings);
      const providerControlsEnabled = assistantRouting.controlsEnabled;
      const activeAssistantProvider = assistantRouting.provider;
      const settingsCardClass = isDarkUi
        ? 'space-y-3 rounded-xl border border-slate-700 bg-slate-900/70 p-3.5'
        : 'space-y-3 rounded-xl border border-slate-200 bg-white p-3.5';
      const settingsLabelClass = isDarkUi
        ? 'mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400'
        : 'mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500';
      const settingsInputClass = isDarkUi
        ? 'w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-mono text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-400'
        : 'w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs font-mono text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:bg-white';

      return (
      <div
          className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-[3px]"
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
                          <p className={`mt-1 text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                              Compact controls for UI, engines, assistant, and backend.
                          </p>
                      </div>
                      <button
                        onClick={() => setShowSettings(false)}
                        className={`p-2 rounded-full transition-colors ${isDarkUi ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-200 text-slate-700'}`}
                        aria-label="Close settings panel"
                      >
                        <X size={18}/>
                      </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className={`rounded-lg border px-2 py-1 text-[10px] ${isDarkUi ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-white text-slate-600'}`}>
                          Theme: <span className="font-semibold">{resolvedTheme === 'dark' ? 'Dark' : 'Light'}</span>
                      </div>
                      <div className={`rounded-lg border px-2 py-1 text-[10px] ${isDarkUi ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-white text-slate-600'}`}>
                          Density: <span className="font-semibold capitalize">{uiDensity}</span>
                      </div>
                      <div className={`rounded-lg border px-2 py-1 text-[10px] ${isDarkUi ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-white text-slate-600'}`}>
                          Engine: <span className="font-semibold">{getEngineLabel(settings.engine)}</span>
                      </div>
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
                              <div className={`text-[10px] mt-2 ${isDarkUi ? 'text-slate-400' : 'text-gray-400'}`}>Active: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}</div>
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
                                  <span>{uiFontScale.toFixed(2)}x</span>
                              </div>
                              <input
                                  type="range"
                                  min="0.9"
                                  max="1.15"
                                  step="0.05"
                                  value={uiFontScale}
                                  onChange={(e) => setUiFontScale(parseFloat(e.target.value))}
                                  className={`w-full accent-indigo-600 h-1.5 rounded-lg appearance-none ${isDarkUi ? 'bg-slate-700' : 'bg-gray-200'}`}
                              />
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
                              const planLockedEngine = !isEnginePlanAllowed(engine);
                              const showAccessBlockedNote = status.state === 'online' && ttsAccessState.blocked;
                              const accessBlockedDetail = sanitizeUiText(
                                ttsAccessState.detail || 'Sign in again to enable AI/TTS requests.'
                              );
                              return (
                                  <button
                                      key={engine}
                                      type="button"
                                      onClick={() => {
                                          if (switchLocked || pending) return;
                                          if (planLockedEngine) {
                                              setShowSubscriptionModal(true);
                                              showToast('Prime engine is available on paid plans. Upgrade to continue.', 'info');
                                              return;
                                          }
                                          void activateTtsEngine(engine);
                                      }}
                                      className={`p-2.5 rounded-xl border transition-all flex items-center gap-2.5 ${
                                        isActive
                                          ? isDarkUi
                                            ? 'border-indigo-400/70 bg-indigo-500/20'
                                            : 'border-indigo-200 bg-indigo-50'
                                          : isDarkUi
                                            ? 'border-slate-700 bg-slate-950/75 hover:bg-slate-900'
                                            : 'border-gray-200 bg-white hover:border-indigo-200'
                                      } ${(switchLocked || pending || planLockedEngine) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                  >
                                      {engine === 'GEM' && <Sparkles size={18} className={`shrink-0 ${isActive ? 'text-indigo-500' : isDarkUi ? 'text-slate-400' : 'text-gray-400'}`} />}
                                      {engine === 'GOOD' && <Wand2 size={18} className={`shrink-0 ${isActive ? 'text-blue-500' : isDarkUi ? 'text-slate-400' : 'text-gray-400'}`} />}
                                      {engine === 'NEURAL2' && <Zap size={18} className={`shrink-0 ${isActive ? 'text-amber-500' : isDarkUi ? 'text-slate-400' : 'text-gray-400'}`} />}
                                      {engine === 'KOKORO' && <Cpu size={18} className={`shrink-0 ${isActive ? 'text-cyan-500' : isDarkUi ? 'text-slate-400' : 'text-gray-400'}`} />}
                                      <div className="flex-1 min-w-0">
                                          <div className={`font-semibold text-xs ${isDarkUi ? 'text-slate-100' : 'text-slate-800'}`}>{getEngineLabel(engine)} Runtime</div>
                                          <div className={`text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{getEngineSubLabel(engine)}</div>
                                          {showAccessBlockedNote && (
                                              <div className={`mt-1 text-[10px] font-medium ${isDarkUi ? 'text-amber-300' : 'text-amber-700'}`}>
                                                  {accessBlockedDetail}
                                              </div>
                                          )}
                                          {planLockedEngine && (
                                              <div className={`mt-1 text-[10px] font-medium ${isDarkUi ? 'text-amber-300' : 'text-amber-700'}`}>
                                                  Upgrade required for this engine.
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

                  {/* AI Helper */}
                  <section>
                      <label className={settingsLabelClass}>AI Assistant Provider</label>
                      <div className={settingsCardClass}>
                          <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${isDarkUi ? 'border-slate-700 bg-slate-950/75' : 'border-gray-200 bg-gray-50'}`}>
                              <div className="min-w-0">
                                  <p className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-700'}`}>Provider Controls</p>
                                  <p className={`text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                      {providerControlsEnabled
                                          ? 'Use Primary AI / Perplexity / Local selector.'
                                          : 'Forced to Primary AI runtime path.'}
                                  </p>
                              </div>
                              <button
                                  type="button"
                                  onClick={() => setSettings((s) => ({ ...s, assistantProviderControlsEnabled: s.assistantProviderControlsEnabled === false }))}
                                  className={`relative h-5 w-9 rounded-full transition-colors ${providerControlsEnabled ? 'bg-indigo-500' : isDarkUi ? 'bg-slate-600' : 'bg-gray-300'}`}
                                  aria-label="Toggle assistant provider controls"
                                  aria-pressed={providerControlsEnabled}
                              >
                                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${providerControlsEnabled ? 'translate-x-4' : ''}`} />
                              </button>
                          </div>

                          <div className={`p-1 rounded-lg border flex ${isDarkUi ? 'border-slate-700 bg-slate-950/75' : 'border-gray-200 bg-white'}`}>
                              {(['GEMINI', 'PERPLEXITY', 'LOCAL'] as const).map((p) => {
                                  const isDisabled = !providerControlsEnabled && p !== 'GEMINI';
                                  const isActive = activeAssistantProvider === p;
                                  return (
                                      <button
                                          key={p}
                                          type="button"
                                          disabled={isDisabled}
                                          onClick={() => {
                                              if (isDisabled) return;
                                              setSettings((s) => ({ ...s, helperProvider: p }));
                                          }}
                                          className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-all ${
                                              isActive
                                                  ? isDarkUi
                                                    ? 'bg-slate-800 text-slate-100'
                                                    : 'bg-slate-100 text-slate-900 shadow-sm'
                                                  : isDisabled
                                                      ? isDarkUi
                                                        ? 'text-slate-600 cursor-not-allowed'
                                                        : 'text-gray-300 cursor-not-allowed'
                                                      : isDarkUi
                                                        ? 'text-slate-400 hover:text-slate-200'
                                                        : 'text-gray-500 hover:text-gray-700'
                                          }`}
                                      >
                                          {ASSISTANT_PROVIDER_UI_LABELS[p]}
                                      </button>
                                  );
                              })}
                          </div>

                          {!providerControlsEnabled && (
                              <p className={`text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                  Perplexity and Local routes are currently disabled until provider controls are turned back on.
                              </p>
                          )}

                          <div className={`space-y-2 animate-in fade-in rounded-lg border p-2.5 ${isDarkUi ? 'border-slate-700 bg-slate-950/75' : 'border-gray-100 bg-white'}`}>
                              {activeAssistantProvider === 'GEMINI' && (
                                  <div>
                                      <div className="flex items-center justify-between gap-2 mb-1">
                                          <label className={`${settingsLabelClass} mb-0 flex items-center gap-1`}><Key size={10}/> Primary AI API Key</label>
                                          <button
                                              type="button"
                                              onClick={async () => {
                                                  try {
                                                      const clip = await navigator.clipboard.readText();
                                                      const nextKey = String(clip || '').trim();
                                                      if (!nextKey) {
                                                          showToast('Clipboard is empty.', 'info');
                                                          return;
                                                      }
                                                      setSettings((s) => ({ ...s, geminiApiKey: nextKey }));
                                                      showToast('Primary AI API key pasted.', 'success');
                                                  } catch {
                                                      showToast('Clipboard access failed. Paste manually.', 'error');
                                                  }
                                              }}
                                              className={`px-2 py-1 text-[10px] font-semibold rounded-md border transition-colors ${
                                                  isDarkUi
                                                    ? 'border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                                                    : 'border-gray-200 text-gray-600 hover:text-gray-800 hover:border-gray-300'
                                              }`}
                                          >
                                              Paste
                                          </button>
                                      </div>
                                      <input
                                          type="password"
                                          value={settings.geminiApiKey || ''}
                                          onChange={(e) => setSettings(s => ({ ...s, geminiApiKey: e.target.value }))}
                                          placeholder="AIza..."
                                          className={settingsInputClass}
                                      />
                                      <div className={`mt-2 flex items-center justify-between rounded-lg border p-2.5 ${isDarkUi ? 'border-slate-700 bg-slate-900/80' : 'border-gray-200 bg-gray-50'}`}>
                                          <div className="pr-2">
                                              <p className={`text-[10px] font-bold uppercase ${isDarkUi ? 'text-slate-300' : 'text-gray-600'}`}>Use Personal API Key</p>
                                              <p className={`text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>When OFF, requests use backend runtime key-pool.</p>
                                          </div>
                                          <button
                                              type="button"
                                              onClick={() => setSettings((s) => ({ ...s, preferUserGeminiKey: !(s.preferUserGeminiKey === true) }))}
                                              className={`relative h-5 w-9 rounded-full transition-colors ${settings.preferUserGeminiKey === true ? 'bg-indigo-500' : isDarkUi ? 'bg-slate-600' : 'bg-gray-300'}`}
                                              aria-label="Toggle personal API key preference"
                                              aria-pressed={settings.preferUserGeminiKey === true}
                                          >
                                              <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.preferUserGeminiKey === true ? 'translate-x-4' : ''}`} />
                                          </button>
                                      </div>
                                      <p className={`text-[10px] mt-1 ${isDarkUi ? 'text-slate-400' : 'text-gray-400'}`}>Used by AI Assistant and cloud fallback tasks.</p>
                                  </div>
                              )}

                              {activeAssistantProvider === 'PERPLEXITY' && (
                                  <div>
                                      <label className={`${settingsLabelClass} mb-1 flex items-center gap-1`}><Lock size={10}/> Perplexity API Key</label>
                                      <input
                                          type="password"
                                          value={settings.perplexityApiKey || ''}
                                          onChange={(e) => setSettings(s => ({...s, perplexityApiKey: e.target.value}))}
                                          placeholder="pplx-..."
                                          className={settingsInputClass}
                                      />
                                      <p className={`text-[10px] mt-1 ${isDarkUi ? 'text-slate-400' : 'text-gray-400'}`}>Required for advanced web-search translation.</p>
                                  </div>
                              )}

                              {activeAssistantProvider === 'LOCAL' && (
                                  <div>
                                      <label className={`${settingsLabelClass} mb-1 flex items-center gap-1`}><Terminal size={10}/> Local LLM URL</label>
                                      <input
                                          type="text"
                                          value={settings.localLlmUrl || ''}
                                          onChange={(e) => setSettings(s => ({...s, localLlmUrl: e.target.value}))}
                                          placeholder="http://localhost:1234/v1"
                                          className={settingsInputClass}
                                      />
                                      <p className={`text-[10px] mt-1 ${isDarkUi ? 'text-slate-400' : 'text-gray-400'}`}>Compatible with LM Studio, Ollama, etc.</p>
                                  </div>
                              )}
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

  const usesPhoneStudioDock = activeTab === Tab.STUDIO && isPhone;
  const usesCompactFloatingStudioDock = activeTab === Tab.STUDIO && (isTablet || isDesktop);
  const studioScrollPaddingClass =
    activeTab === Tab.STUDIO
      ? isPhone
        ? 'pb-[calc(env(safe-area-inset-bottom)+11rem)]'
        : isTablet
          ? 'pb-[calc(env(safe-area-inset-bottom)+8rem)]'
          : 'pb-52'
      : 'pb-36';
  const studioFloatingDockWidthClass = isDesktop
    ? 'w-[clamp(17rem,28vw,20.25rem)] max-w-[calc(100vw-2rem)]'
    : 'w-[clamp(15.5rem,31vw,18.25rem)] max-w-[calc(100vw-2rem)]';
  const studioFloatingDockVariantClass = isDesktop
    ? 'vf-studio-generate-anchor--desktop'
    : 'vf-studio-generate-anchor--tablet';
  const studioAssistantBottomClass =
    activeTab === Tab.STUDIO
      ? isPhone
        ? 'bottom-[calc(env(safe-area-inset-bottom)+8.25rem)]'
        : isDesktop
          ? 'bottom-[calc(env(safe-area-inset-bottom)+7.1rem)] xl:bottom-32'
          : 'bottom-[calc(env(safe-area-inset-bottom)+6.25rem)]'
      : 'bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] xl:bottom-6';

  return (
    <div className={`relative min-h-screen vf-motion-${uiMotionLevel} ${resolvedTheme === 'dark' ? 'vf-theme-dark theme-dark vf-hybrid-aod' : 'vf-hybrid-light'}`}>
      <div className="vf-live-wallpaper" aria-hidden />
      <div className={`vf-app-shell flex min-h-screen bg-transparent font-sans text-gray-900 ${uiDensity === 'compact' ? 'vf-compact' : ''}`}>
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 bg-black/45 backdrop-blur-[2px] z-[55] xl:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-label="Close mobile menu"
        />
      )}
      
      {/* Sidebar Navigation */}
      <Sidebar />
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col xl:pl-64 relative h-screen overflow-hidden transition-all">
        
        {/* Floating Top Bar */}
        <header className={`vf-topbar vf-topbar-shell fixed top-2 left-2 right-2 xl:left-[calc(16rem+0.75rem)] xl:right-3 z-[45] h-14 rounded-2xl border backdrop-blur-2xl transition-all duration-300 hover:-translate-y-0.5 ${
          resolvedTheme === 'dark'
            ? 'border-slate-700/80 bg-slate-950/82 shadow-[0_18px_38px_rgba(2,6,23,0.72)]'
            : 'border-white/70 bg-white/85 shadow-[0_18px_38px_rgba(15,23,42,0.14)]'
        }`}>
             <div className={`vf-topbar-glow pointer-events-none absolute inset-0 rounded-2xl ${
               resolvedTheme === 'dark'
                 ? 'bg-gradient-to-r from-cyan-500/10 via-indigo-500/8 to-fuchsia-500/10'
                 : 'bg-gradient-to-r from-cyan-100/70 via-indigo-100/70 to-fuchsia-100/70'
             }`} />
             <div className="relative flex h-full w-full items-center gap-2 px-2 xl:px-3">
                 <button
                    className={`xl:hidden p-2 -ml-1 shrink-0 ${resolvedTheme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}
                    onClick={() => setIsMobileMenuOpen(true)}
                    aria-label="Open navigation menu"
                 >
                    <Menu />
                 </button>
                 <div className="sm:hidden flex shrink-0 items-center">
                   <BrandLogo size="sm" showWordmark={false} />
                 </div>

                 <div className={`vf-topbar-title-shell hidden sm:flex h-9 shrink-0 items-center gap-2 rounded-lg border px-2.5 ${
                   resolvedTheme === 'dark'
                    ? 'border-slate-700 bg-slate-900/85 text-slate-200'
                    : 'border-slate-200 bg-white/90 text-slate-700'
                 }`}>
                    <span className={`vf-topbar-product-pill inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                      resolvedTheme === 'dark' ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>
                      <Mic size={11} className="text-indigo-500" />
                      Audio Studio
                    </span>
                    <span className="vf-topbar-tab-label text-sm font-semibold">{activeTabLabel}</span>
                 </div>

                 <div className="vf-topbar-runtime-wrap hidden sm:block min-w-0 flex-1 overflow-x-auto no-scrollbar">
                     <EngineRuntimeStrip
                       engineOrder={ENGINE_ORDER}
                       statuses={ttsRuntimeStatus}
                       accessState={ttsAccessState}
                       activeEngine={settings.engine}
                       switchingEngine={engineSwitchInProgress}
                       compact={isTablet}
                       resolvedTheme={resolvedTheme}
                       onActivate={(engine) => { void activateTtsEngine(engine); }}
                     />
                  </div>
                  <div className="sm:hidden min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        const cycleOrder = planAllowedEngines.length > 0 ? planAllowedEngines : ENGINE_ORDER;
                        const activeIndex = cycleOrder.indexOf(settings.engine);
                        const nextEngine: GenerationSettings['engine'] = cycleOrder[(activeIndex + 1) % cycleOrder.length] ?? 'KOKORO';
                        void activateTtsEngine(nextEngine);
                      }}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-bold uppercase tracking-wide ${
                        resolvedTheme === 'dark'
                          ? 'border-slate-700 bg-slate-900/85 text-slate-200'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                      title={`Active: ${getEngineDisplayName(settings.engine)}. Tap to switch engine.`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        ttsRuntimeStatus[settings.engine]?.state === 'online'
                          ? 'bg-emerald-400'
                          : ttsRuntimeStatus[settings.engine]?.state === 'starting'
                            ? 'bg-amber-400'
                            : 'bg-rose-400'
                      }`} />
                      {getEngineDisplayName(settings.engine)}
                    </button>
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
                      <div className={`hidden xl:flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                         resolvedTheme === 'dark'
                           ? 'bg-slate-900/85 border-slate-700 text-slate-300'
                           : 'bg-gray-100 border-gray-200 text-gray-600'
                       }`}>
                           <Box size={14} />
                           {`${currentEngineSpendable.toLocaleString()} VF (${getEngineDisplayName(settings.engine).toUpperCase()})`}
                       </div>
                     <div className={`hidden sm:flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-bold border ${
                        resolvedTheme === 'dark'
                          ? 'bg-slate-900/85 border-slate-700 text-slate-300'
                          : 'bg-gray-100 border-gray-200 text-gray-600'
                      }`}>
                        <Timer size={12} />
                        {`Daily ${Math.max(0, Number(stats.generationsUsed || 0))}/${Math.max(1, Number(stats.generationsLimit || 30))}`}
                      </div>
                     <div className={`hidden md:flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-bold border ${
                        resolvedTheme === 'dark'
                          ? 'bg-slate-900/85 border-slate-700 text-slate-300'
                          : 'bg-gray-100 border-gray-200 text-gray-600'
                      }`}>
                        <Gift size={12} />
                        {`VFF Left ${walletVff.toLocaleString()}`}
                      </div>

                      {!stats.isPremium && (
                          <button onClick={() => setShowSubscriptionModal(true)} className="hidden sm:inline-flex px-2.5 py-1 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[11px] font-bold rounded-full shadow-md shadow-orange-200 transition-transform hover:scale-105">
                              Upgrade
                          </button>
                      )}

                     <button
                        onClick={() => setCenterOpen((open) => !open)}
                        aria-label="Open notifications"
                        className={`relative p-2 rounded-full transition-colors ${
                        resolvedTheme === 'dark'
                         ? 'hover:bg-slate-800 text-slate-300'
                         : 'hover:bg-gray-100 text-gray-500'
                     }`}
                      >
                          <Bell size={20} />
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
                        className={`p-2 rounded-full transition-colors ${
                        resolvedTheme === 'dark'
                         ? 'hover:bg-slate-800 text-slate-300'
                         : 'hover:bg-gray-100 text-gray-500'
                     }`}>
                          <Settings size={20} />
                     </button>
                 </div>
             </div>
        </header>

        {/* Scrollable Content Area */}
        <div
          ref={contentScrollRef}
          className={`vf-main-scroll flex-1 overflow-y-auto custom-scrollbar px-4 md:px-8 pt-20 md:pt-24 relative ${studioScrollPaddingClass}`}
        >
            <div className={`mx-auto w-full space-y-6 ${contentMaxWidthClass}`}>
                
                {activeTab === Tab.STUDIO && (
                    <div className="vf-studio-focus-wrap xl:min-h-[calc(100vh-12rem)] flex items-center justify-center">
                    <div className="vf-studio-grid w-full grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-5 xl:gap-6 animate-in fade-in duration-300">
                        {/* Editor Section */}
                        <div ref={studioMainRef} className="vf-studio-main min-w-0 space-y-4">
                            {/* Reduced Height Editor */}
                            <SectionCard className="vf-editor-shell rounded-3xl overflow-hidden flex flex-col min-h-[23rem] h-[min(42rem,calc(100dvh-11rem))] relative group transition-all hover:shadow-md">
                                {/* Toolbar */}
                                <div className={`vf-studio-toolbar px-4 py-3 border-b gap-2 ${isPhone ? 'flex flex-col items-stretch' : 'flex flex-wrap items-start justify-between'}`}>
                                    <div className="flex flex-wrap items-center gap-1">
                                        <button onClick={() => setText(t => t + ' [pause] ')} className="vf-toolbar-action p-1.5 text-xs font-bold rounded-lg flex items-center gap-1 transition-colors" title="Insert Pause"><Clock size={14}/> <span className="hidden sm:inline">Pause</span></button>
                                        <button onClick={() => setText(t => t + ' (Whisper): ')} className="vf-toolbar-action p-1.5 text-xs font-bold rounded-lg flex items-center gap-1 transition-colors" title="Whisper"><Volume2 size={14}/> <span className="hidden sm:inline">Whisper</span></button>
                                        
                                        <div className="vf-toolbar-divider"></div>
                                        
                                        <ProofreadCluster
                                            isBusy={isAiWriting}
                                            onProofread={(mode) => { void handleProofread(mode); }}
                                            novelLabel="Audio Novel"
                                        />
                                        
                                        <div className="vf-toolbar-divider"></div>

                                        <button
                                            onClick={() => { setText(''); setGeneratedAudioUrl(null); }}
                                            className="vf-toolbar-action vf-toolbar-action--danger p-1.5 text-xs font-bold rounded-lg transition-colors"
                                            title="Clear"
                                            aria-label="Clear studio script"
                                        >
                                            <Trash2 size={14}/>
                                        </button>
                                    </div>
                                    
                                    <div className={`flex items-center gap-2 ${isPhone ? 'w-full justify-between' : 'ml-auto shrink-0'}`}>
                                         {!isPhone && detectedLang && <span className="vf-toolbar-tag text-[10px] font-bold border px-2 py-1 rounded-md uppercase">{detectedLang}</span>}
                                         <button onClick={() => handleDirectorAI(text, 'audio_drama')} disabled={isAiWriting} className="vf-toolbar-ai text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors shadow-sm">
                                            {isAiWriting ? <Loader2 size={13} className="animate-spin"/> : <Wand2 size={13}/>} 
                                            <span>AI Director</span>
                                         </button>
                                    </div>
                                </div>
                                
                                <div className="flex-1 min-h-0">
                                    <BlockScriptEditor
                                      value={text}
                                      mode={studioEditorMode}
                                      emotions={EMOTIONS}
                                      speakerSuggestions={castSpeakers}
                                      onChange={setText}
                                      onModeChange={setStudioEditorMode}
                                      placeholder="Write your script here... The AI Director can auto-assign voices for characters."
                                      className="h-full"
                                    />
                                </div>

                                <StudioTranslateBar
                                    targetLang={targetLang}
                                    isBusy={isAiWriting}
                                    languages={LANGUAGES}
                                    layoutMode={viewportMode}
                                    onTargetLang={setTargetLang}
                                    onTranslate={() => { void handleTranslate(); }}
                                />

                                <div className="vf-editor-footer px-4 sm:px-6 py-3 border-t text-xs flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="vf-editor-count">{text.length} chars</span>
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
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setStudioQueueModeEnabled(!isStudioQueueModeEnabled)}
                                            className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
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
                                            onClick={() => setSettings((prev) => ({ ...prev, multiSpeakerEnabled: !(prev.multiSpeakerEnabled !== false) }))}
                                            className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
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
                                        <button onClick={() => saveDraft(`Draft ${new Date().toLocaleTimeString()}`, text, settings)} className="vf-editor-link flex items-center gap-1"><Save size={12}/> Save Draft</button>
                                    </div>
                                </div>
                            </SectionCard>

                            {/* Generated Audio Player */}
                            {(generatedAudioUrl || isGenerating || liveAudioChunks.length > 0) && (
                                <div className="animate-in slide-in-from-bottom-4">
                                    <AudioPlayer
                                      audioUrl={generatedAudioUrl}
                                      isGenerating={isGenerating}
                                      liveChunks={liveAudioChunks}
                                      isLiveStreaming={isGenerating}
                                      autoPlayOnFirstChunk={settings.autoPlayGeneratedAudio !== false}
                                      onReset={() => {
                                        setGeneratedAudioUrl(null);
                                        setLiveAudioChunks([]);
                                        seenLiveChunkKeysRef.current.clear();
                                        activeGatewayJobIdRef.current = '';
                                      }}
                                    />
                                </div>
                            )}
                        </div>

	                        {/* Controls Sidebar */}
		                        <div className={`vf-studio-rail h-fit xl:self-center ${isPhone ? 'space-y-4' : 'space-y-5'}`}>
		                            {!isStudioMultiSpeakerEnabled && (
                                    <>
		                            {/* Voice Selector Card */}
	                            <SectionCard className={isPhone ? 'p-4 rounded-2xl' : 'p-5 rounded-3xl'}>
                                    {isPhone ? (
                                        <button
                                            type="button"
                                            onClick={() => toggleStudioMobilePanel('speaker')}
                                            className="flex w-full items-start justify-between gap-3 text-left"
                                        >
                                            <div>
                                                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Speaker</h3>
                                                <div className="mt-1 flex items-center gap-2">
                                                    <span className={`text-xs font-bold ${
                                                        settings.engine === 'KOKORO'
                                                          ? 'text-cyan-600'
                                                          : settings.engine === 'GOOD'
                                                            ? 'text-blue-600'
                                                          : settings.engine === 'NEURAL2'
                                                            ? 'text-amber-600'
                                                            : 'text-indigo-600'
                                                    }`}>
                                                        {getEngineDisplayName(settings.engine)}
                                                    </span>
                                                    <span className="text-[10px] font-semibold text-gray-500">{studioVoiceOptions.length} voices</span>
                                                </div>
                                            </div>
                                            {studioMobilePanels.speaker ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                                        </button>
                                    ) : (
	                                    <div className="mb-4 flex items-center justify-between">
	                                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Speaker</h3>
                                            <div className="flex items-center gap-2">
	                                            <span className={`text-xs font-bold ${
                                                        settings.engine === 'KOKORO'
                                                          ? 'text-cyan-600'
                                                          : settings.engine === 'GOOD'
                                                            ? 'text-blue-600'
                                                          : settings.engine === 'NEURAL2'
                                                            ? 'text-amber-600'
                                                            : 'text-indigo-600'
                                                    }`}>
	                                                {getEngineDisplayName(settings.engine)}
	                                            </span>
                                                <span className="text-[10px] font-semibold text-gray-500">{studioVoiceOptions.length} voices</span>
                                            </div>
	                                    </div>
                                    )}

                                    {(!isPhone || studioMobilePanels.speaker) && (
                                    <>
	                                <div className={`max-h-60 overflow-y-auto custom-scrollbar space-y-3 ${isPhone ? 'mt-4 mb-3' : 'mb-4'}`}>
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
                                                            className={`vf-voice-chip ${isSelected ? 'vf-voice-chip--active' : ''} flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'}`}
                                                        >
                                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isSelected ? 'bg-white/20' : 'bg-gray-200'}`}>{voiceMeta.name[0] || 'V'}</div>
                                                            <div className="flex flex-col items-start leading-tight">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span>{voiceMeta.name}</span>
                                                                    {voiceMeta.countryTag && (
                                                                        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-extrabold leading-none ${isSelected ? 'border-white/40 bg-white/15 text-white/90' : 'border-gray-300 bg-gray-100 text-gray-600'}`}>
                                                                            {voiceMeta.countryTag}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className={`text-[10px] font-semibold ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
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
                                                            className={`vf-voice-chip flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${locked ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'}`}
                                                            title={locked ? 'Upgrade to use Pro voices' : undefined}
                                                        >
                                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isSelected && !locked ? 'bg-white/20' : 'bg-amber-200'}`}>{voiceMeta.name[0] || 'V'}</div>
                                                            <div className="flex flex-col items-start leading-tight">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span>{voiceMeta.name}</span>
                                                                    {voiceMeta.countryTag && (
                                                                        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-extrabold leading-none ${isSelected && !locked ? 'border-white/40 bg-white/15 text-white/90' : 'border-amber-300 bg-amber-100 text-amber-700'}`}>
                                                                            {voiceMeta.countryTag}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className={`text-[10px] font-semibold ${isSelected && !locked ? 'text-white/80' : 'text-amber-700'}`}>
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

	                            {/* Studio Audio Mix */}
		                            <SectionCard className={isPhone ? 'p-4 rounded-2xl' : 'p-5 rounded-3xl'}>
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
                                    </>
                                    )}

                                    {isStudioMultiSpeakerEnabled && (
		                            <>
		                            {/* Cast & Crew */}
	                            <SectionCard className={`${isPhone ? 'p-4 rounded-2xl' : 'p-5 rounded-3xl'} border animate-in fade-in ${
                                      isDarkUi
                                        ? 'bg-slate-900/75 border-indigo-500/20'
                                        : 'bg-indigo-50 border-indigo-100'
                                    }`}>
                                    {isPhone ? (
                                        <button
                                            type="button"
                                            onClick={() => toggleStudioMobilePanel('cast')}
                                            className="mb-3 flex w-full items-center justify-between gap-3 text-left"
                                        >
                                            <div>
                                                <h3 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${
                                                    isDarkUi ? 'text-indigo-200' : 'text-indigo-400'
                                                }`}><Bot size={14}/> Cast &amp; Crew</h3>
                                                <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                                                    {isStudioMultiSpeakerEnabled ? `${activeScriptLanguageCode.toUpperCase()} - ${studioCrewTags.length} crew cues` : 'Disabled'}
                                                </p>
                                            </div>
                                            {studioMobilePanels.cast ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                                        </button>
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
                                                    isAutoAssigningCast ||
                                                    castSpeakers.length === 0 ||
                                                    castVoiceOptions.length === 0
                                                }
                                                title="AI auto-detect speakers from script text and assign voices"
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
                                    {(!isPhone || studioMobilePanels.cast) && (
                                    <>
                                    {isPhone && (
                                        <button
                                            type="button"
                                            onClick={autoAssignCastVoices}
                                            disabled={
                                                !isStudioMultiSpeakerEnabled ||
                                                isAutoAssigningCast ||
                                                castSpeakers.length === 0 ||
                                                castVoiceOptions.length === 0
                                            }
                                            title="AI auto-detect speakers from script text and assign voices"
                                            className={`mb-3 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                                                isDarkUi
                                                    ? 'bg-slate-950 text-indigo-200 border-indigo-500/30 hover:bg-slate-900'
                                                    : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'
                                            } disabled:opacity-60`}
                                        >
                                            {isAutoAssigningCast ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                            AI Auto
                                        </button>
                                    )}
                                    {!isStudioMultiSpeakerEnabled && (
                                      <p className="mb-3 text-[11px] font-medium text-gray-500">
                                        Enable Multi-Speaker Mode to edit cast mappings.
                                      </p>
                                    )}
                                    <div className="space-y-2">
                                        {castSpeakers.map(speaker => (
                                            <div key={speaker} className={`flex items-center justify-between gap-2 p-2 rounded-lg border shadow-sm ${
                                                isDarkUi
                                                  ? 'bg-slate-950 border-indigo-500/20'
                                                  : 'bg-white border-indigo-100'
                                            }`}>
                                                <span className={`text-xs font-bold truncate ${isDarkUi ? 'text-slate-100' : 'text-gray-700'}`}>{speaker}</span>
                                                <select 
                                                    className={`text-[10px] font-bold rounded p-1 outline-none max-w-[150px] ${isDarkUi ? 'bg-slate-900 text-slate-100' : 'bg-gray-50 text-gray-700'}`}
                                                    value={resolveMappedVoiceForSpeaker(speaker) || castFreeVoiceOptions[0]?.id || castVoiceOptions[0]?.id || ''}
                                                    disabled={!isStudioMultiSpeakerEnabled}
                                                    onChange={(e) => {
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
                                                        
                                                        const char = characterLibrary.find(c => c.name.toLowerCase() === speaker.toLowerCase());
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
			                                        ))}
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
                                                ? 'Enable Multi-Speaker Mode to apply cast mappings during Studio generation.'
                                                : detectedSpeakers.length > 0
                                                ? 'Voices are automatically saved to your Character Library.'
                                                : 'No explicit speaker tags detected. Narrator mapping is active.'}
	                                    </div>
                                    </>
                                    )}
	                                </SectionCard>
                                    </>
                                    )}

                                    {shouldShowStudioQueuePanel && (
                                        <StudioQueuePanel
                                            queueState={studioQueueState}
                                            draftPartCount={studioQueueDraftPartCount}
                                            planCap={maxCharsPerGeneration}
                                            queueEligible={studioQueueEligible}
                                            isQueueModeEnabled={isStudioQueueModeEnabled}
                                            isGenerating={isGenerating}
                                            audioUrls={studioQueueAudioUrls}
                                            isDarkUi={isDarkUi}
                                            isPhone={isPhone}
                                            isOpen={studioMobilePanels.queue}
                                            onToggleOpen={() => toggleStudioMobilePanel('queue')}
                                            onResumeQueue={() => { void resumeStudioQueue(); }}
                                            onClearQueue={() => { void clearStudioQueueState(); }}
                                            onDeleteItem={(itemId) => { void deleteStudioQueueItem(itemId); }}
                                            onRetryItem={retryStudioQueueItem}
                                            onReorderItems={reorderStudioQueueItems}
                                        />
                                    )}

                        </div>
                    </div>
                    </div>
                )}
                
                {/* --- REDESIGNED CHARACTER TAB --- */}
                {activeTab === Tab.CHARACTERS && (
                    <div className="max-w-5xl mx-auto animate-in fade-in">
                        
                        {/* Tab Switcher & Header */}
                        <div className="mb-8 flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
                            <div>
                                <h2 className="text-2xl font-bold text-gray-800">Character & Voice Studio</h2>
                                <p className="text-sm text-gray-500">Manage your cast or browse the gallery to find the perfect voice.</p>
                            </div>
                            
                            <div className="flex w-full rounded-xl border border-gray-200 bg-white p-1 shadow-sm sm:w-auto">
                                <button 
                                    onClick={() => setCharTab('CAST')}
                                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all sm:flex-none sm:px-5 ${charTab === 'CAST' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                                >
                                    <Users size={16}/> My Cast
                                </button>
                                <button 
                                    onClick={() => setCharTab('GALLERY')}
                                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all sm:flex-none sm:px-5 ${charTab === 'GALLERY' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                                >
                                    <StoreIcon size={16}/> Voice Gallery
                                </button>
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
                                             <div key={char.id} className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                                                 <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-gray-50 to-transparent rounded-bl-full pointer-events-none"></div>
                                                 
                                                 <div className="flex items-start gap-4 mb-4 relative z-10">
                                                     <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg transform group-hover:scale-105 transition-transform" style={{ backgroundColor: char.avatarColor || '#6366f1' }}>
                                                         {char.name.substring(0, 2).toUpperCase()}
                                                     </div>
                                                     <div className="flex-1">
                                                         <h3 className="font-bold text-lg text-gray-900 leading-tight">{char.name}</h3>
                                                         <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                                                             {char.age || 'Adult'} • {char.gender || 'Unknown'}
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
                                                           className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isPlayingPreview ? 'bg-indigo-600 text-white shadow-md' : 'bg-white border border-gray-200 text-indigo-600 hover:bg-indigo-50'}`}
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
                                             <div key={v.id} className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-indigo-200 hover:shadow-md transition-all group flex flex-col gap-3">
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
                                                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-indigo-100 hover:text-indigo-600'}`}
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
                             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                                 <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 animate-in zoom-in duration-200">
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
                              const historyEngine: GenerationSettings['engine'] = item.engine === 'KOKORO'
                                ? 'KOKORO'
                                : item.engine === 'GOOD'
                                  ? 'GOOD'
                                : item.engine === 'NEURAL2'
                                  ? 'NEURAL2'
                                  : 'GEM';
                              const voiceLabel = item.voiceName || 'AI Voice';
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
                                      historyEngine === 'KOKORO'
                                        ? isDarkUi
                                          ? 'bg-emerald-500/20 text-emerald-200'
                                          : 'bg-emerald-100 text-emerald-700'
                                        : historyEngine === 'GOOD'
                                          ? isDarkUi
                                            ? 'bg-blue-500/20 text-blue-100'
                                            : 'bg-blue-100 text-blue-700'
                                        : historyEngine === 'NEURAL2'
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
                
                {activeTab === Tab.NOVEL && (
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
                )}

                {activeTab === Tab.READER && (
                    <Suspense fallback={<SectionCard className="rounded-3xl p-6 text-sm">Loading reader...</SectionCard>}>
                      <ReaderTabContent
                          settings={settings}
                          mediaBackendUrl={mediaBackendUrl}
                          resolvedTheme={resolvedTheme}
                          onToast={showToast}
                      />
                    </Suspense>
                )}

                {activeTab === Tab.ADMIN && hasAdminConsoleAccess && (
                    <Suspense fallback={<SectionCard className="rounded-3xl p-6 text-sm">Loading admin controls...</SectionCard>}>
                      <AdminTabContent
                          mediaBackendUrl={mediaBackendUrl}
                          onToast={showToast}
                          onRefreshEntitlements={refreshEntitlements}
                          initialOpsTab={initialAdminOpsTab}
                      />
                    </Suspense>
                )}
                
                {activeTab === Tab.LAB && (
                     <div className="max-w-2xl mx-auto bg-white p-4 sm:p-6 md:p-8 rounded-3xl shadow-sm border border-gray-200 animate-in fade-in">
                         {/* ... Lab Content ... */}
                         <div className="mb-8 flex justify-center">
                             <div className="flex w-full flex-col rounded-xl bg-gray-100 p-1 sm:w-auto sm:flex-row">
                                 <button onClick={() => setLabMode('CLONING')} className={`rounded-lg px-6 py-2 text-sm font-bold transition-all ${labMode === 'CLONING' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Voice Cloning</button>
                                 <button onClick={() => setLabMode('COVERS')} className={`rounded-lg px-6 py-2 text-sm font-bold transition-all ${labMode === 'COVERS' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>AI Covers (Voice Transfer)</button>
                             </div>
                         </div>
                         {labMode === 'CLONING' && (
                             <div className="space-y-6">
                                 <div className="text-center">
                                     <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl mx-auto flex items-center justify-center mb-4"><Fingerprint size={32}/></div>
                                     <h2 className="text-xl font-bold">Create a Voice Clone</h2>
                                     <p className="text-sm text-gray-500 mt-1">Upload a sample to create a digital replica.</p>
                                 </div>
                                 
                                 <div className="grid grid-cols-1 gap-4">
                                     <div>
                                         <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Voice Name</label>
                                         <input 
                                            value={cloneName} 
                                            onChange={e => setCloneName(e.target.value)} 
                                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                                            placeholder="e.g. My Custom Voice"
                                         />
                                     </div>
                                     <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:bg-gray-50 transition-colors relative cursor-pointer">
                                         <input type="file" accept="audio/*" onChange={(e) => setUploadVoiceFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                         {uploadVoiceFile ? (
                                             <div className="flex items-center justify-center gap-2 text-indigo-600 font-bold">
                                                 <FileAudio size={20} /> {uploadVoiceFile.name}
                                             </div>
                                         ) : (
                                             <div className="text-gray-400">
                                                 <UploadCloud size={24} className="mx-auto mb-2"/>
                                                 <p className="text-xs font-bold">Click to Upload Sample</p>
                                                 <p className="text-[10px]">WAV or MP3, max 10MB</p>
                                             </div>
                                         )}
                                     </div>
                                 </div>

                                 <Button fullWidth onClick={handleVoiceClone} disabled={isGenerating}>{isGenerating ? 'Cloning...' : 'Create Clone'}</Button>
                                 
                                 <div className="bg-blue-50 p-3 rounded-xl text-xs text-blue-800 flex items-start gap-2">
                                     <Sparkles size={14} className="shrink-0 mt-0.5"/>
                                     <span>
	                                         <strong>Pro Tip:</strong> Voice samples help AI analysis and cast consistency, while playback uses {getEngineDisplayName('GEM')} or {getEngineDisplayName('KOKORO')} voices.
	                                     </span>
	                                 </div>
                             </div>
                         )}
                         {labMode === 'COVERS' && (
                             <div className="space-y-5">
                                 <div className="text-center">
                                     <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl mx-auto flex items-center justify-center mb-4"><Music size={32}/></div>
                                     <h2 className="text-xl font-bold">AI Covers (Voice Transfer)</h2>
                                     <p className="text-sm text-gray-500 mt-2">Real voice transfer inference via local media backend.</p>
                                 </div>

                                 <div className="space-y-2">
                                     <label className="text-xs font-bold text-gray-500 uppercase">Voice Model</label>
                                     <select
                                         value={settings.voiceModel || ''}
                                         onChange={(e) => setSettings(s => ({ ...s, voiceModel: e.target.value }))}
                                         className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                     >
                                         <option value="">Select model...</option>
                                         {voiceTransferModels.map(modelName => (
                                             <option key={modelName} value={modelName}>{modelName}</option>
                                         ))}
                                     </select>
                                     <div>
                                         <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Pitch Shift ({llvcPitchShift})</label>
                                         <input
                                            type="range"
                                            min={-12}
                                            max={12}
                                            step={1}
                                            value={llvcPitchShift}
                                            onChange={(e) => setLlvcPitchShift(parseInt(e.target.value, 10))}
                                            className="w-full accent-purple-600"
                                         />
                                     </div>
                                 </div>

                                 <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                                     <input
                                         id="voice-transfer-source-file-input"
                                         type="file"
                                         accept="audio/*,video/*"
                                         onChange={(e) => setLlvcSourceFile(e.target.files?.[0] || null)}
                                         className="hidden"
                                     />
                                     {!llvcSourceFile && (
                                         <label htmlFor="voice-transfer-source-file-input" className="block cursor-pointer text-gray-400 hover:text-gray-500 transition-colors">
                                             <UploadCloud size={24} className="mx-auto mb-2"/>
                                             <p className="text-xs font-bold">Upload source audio or video</p>
                                             <p className="text-[10px]">WAV/MP3/M4A/MP4/MOV/WebM</p>
                                         </label>
                                     )}
                                     {llvcSourceFile && (
                                         <div className="space-y-3">
                                             <div className="flex items-center justify-center gap-2 text-purple-700 font-bold text-sm break-all">
                                                 <FileAudio size={20} /> {llvcSourceFile.name}
                                             </div>
                                             <div className="flex flex-wrap items-center justify-center gap-2">
                                                 <button
                                                     type="button"
                                                     onClick={handleToggleLlvcSourcePlayback}
                                                     className="inline-flex items-center gap-1 rounded border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100"
                                                 >
                                                     {isLlvcSourcePlaying ? <Pause size={14} /> : <Play size={14} />}
                                                     {isLlvcSourcePlaying ? 'Pause' : 'Play'}
                                                 </button>
                                                 <label
                                                     htmlFor="voice-transfer-source-file-input"
                                                     className="inline-flex cursor-pointer items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                                                 >
                                                     <UploadCloud size={14} />
                                                     Replace
                                                 </label>
                                                 <button
                                                     type="button"
                                                     onClick={handleClearLlvcSourceFile}
                                                     className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                                                 >
                                                     <X size={14} />
                                                     Clear
                                                 </button>
                                             </div>
                                             {llvcSourcePreviewUrl && !isLlvcSourceVideo && (
                                                 <audio
                                                     ref={(node) => { llvcSourceMediaRef.current = node; }}
                                                     src={llvcSourcePreviewUrl}
                                                     controls
                                                     onPlay={() => setIsLlvcSourcePlaying(true)}
                                                     onPause={() => setIsLlvcSourcePlaying(false)}
                                                     onEnded={() => setIsLlvcSourcePlaying(false)}
                                                     className="w-full"
                                                 />
                                             )}
                                             {llvcSourcePreviewUrl && isLlvcSourceVideo && (
                                                 <video
                                                     ref={(node) => { llvcSourceMediaRef.current = node; }}
                                                     src={llvcSourcePreviewUrl}
                                                     controls
                                                     onPlay={() => setIsLlvcSourcePlaying(true)}
                                                     onPause={() => setIsLlvcSourcePlaying(false)}
                                                     onEnded={() => setIsLlvcSourcePlaying(false)}
                                                     className="mx-auto max-h-44 w-full rounded-lg bg-black"
                                                 />
                                             )}
                                         </div>
                                     )}
                                 </div>

                                 <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                                     <div className="text-xs font-bold text-gray-500 uppercase">Advanced Voice Transfer Options</div>
                                     <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                         <label className="space-y-1 text-left">
                                             <span className="text-[10px] font-semibold uppercase text-gray-500">Preset</span>
                                             <select
                                                 value={llvcPreset}
                                                 onChange={(e) => setLlvcPreset(e.target.value as 'tts_realtime')}
                                                 className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs"
                                             >
                                                 <option value="tts_realtime">tts_realtime</option>
                                             </select>
                                         </label>
                                         <label className="space-y-1 text-left">
                                             <span className="text-[10px] font-semibold uppercase text-gray-500">F0 Method</span>
                                             <select
                                                 value={llvcF0Method}
                                                 onChange={(e) => setLlvcF0Method(e.target.value as 'rmvpe' | 'harvest' | 'crepe' | 'pm')}
                                                 className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs"
                                             >
                                                 <option value="rmvpe">rmvpe</option>
                                                 <option value="harvest">harvest</option>
                                                 <option value="crepe">crepe</option>
                                                 <option value="pm">pm</option>
                                             </select>
                                         </label>
                                     </div>
                                     <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                         <label className="space-y-1 text-left">
                                             <span className="text-[10px] font-semibold uppercase text-gray-500">Index Rate ({llvcIndexRate.toFixed(2)})</span>
                                             <input
                                                 type="range"
                                                 min={0}
                                                 max={1}
                                                 step={0.01}
                                                 value={llvcIndexRate}
                                                 onChange={(e) => setLlvcIndexRate(Number(e.target.value))}
                                                 className="w-full accent-indigo-600"
                                             />
                                         </label>
                                         <label className="space-y-1 text-left">
                                             <span className="text-[10px] font-semibold uppercase text-gray-500">Protect ({llvcProtect.toFixed(2)})</span>
                                             <input
                                                 type="range"
                                                 min={0}
                                                 max={0.5}
                                                 step={0.01}
                                                 value={llvcProtect}
                                                 onChange={(e) => setLlvcProtect(Number(e.target.value))}
                                                 className="w-full accent-indigo-600"
                                             />
                                         </label>
                                         <label className="space-y-1 text-left">
                                             <span className="text-[10px] font-semibold uppercase text-gray-500">RMS Mix ({llvcRmsMixRate.toFixed(2)})</span>
                                             <input
                                                 type="range"
                                                 min={0}
                                                 max={1}
                                                 step={0.01}
                                                 value={llvcRmsMixRate}
                                                 onChange={(e) => setLlvcRmsMixRate(Number(e.target.value))}
                                                 className="w-full accent-indigo-600"
                                             />
                                         </label>
                                         <label className="space-y-1 text-left">
                                             <span className="text-[10px] font-semibold uppercase text-gray-500">Filter Radius ({llvcFilterRadius})</span>
                                             <input
                                                 type="range"
                                                 min={0}
                                                 max={7}
                                                 step={1}
                                                 value={llvcFilterRadius}
                                                 onChange={(e) => setLlvcFilterRadius(Number.parseInt(e.target.value, 10))}
                                                 className="w-full accent-indigo-600"
                                             />
                                         </label>
                                     </div>
                                 </div>

                                 <Button fullWidth onClick={handleGenerateLlvcCover} disabled={isGeneratingLlvcCover || !llvcSourceFile || !settings.voiceModel}>
                                     {isGeneratingLlvcCover ? <><Loader2 className="animate-spin mr-2" /> Converting...</> : 'Generate Voice Transfer'}
                                 </Button>

                                 {llvcCoverUrl && (
                                     <div className="p-4 rounded-xl border border-purple-200 bg-purple-50 space-y-3">
                                         <audio controls src={llvcCoverUrl} className="w-full" />
                                         <a
                                            href={llvcCoverUrl}
                                            download={`voice_transfer_${settings.voiceModel || 'output'}.wav`}
                                            className="inline-flex items-center gap-2 text-xs font-bold text-purple-700 hover:text-purple-900"
                                         >
                                            <Download size={14} /> Download cover WAV
                                         </a>
                                     </div>
                                 )}
                             </div>
                         )}
                     </div>
                )}

                {activeTab === Tab.DUBBING && (
                    <SimplifiedDubbingTab
                      isDarkUi={isDarkUi}
                      mediaBackendUrl={mediaBackendUrl}
                      voiceOptions={runtimeVoiceCatalogs.GEM.length > 0 ? runtimeVoiceCatalogs.GEM : getStaticVoicesForEngine('GEM')}
                      initialTargetLanguage={targetLang}
                      onToast={showToast}
                    />
                )}

                {LEGACY_DUBBING_UI_ENABLED && activeTab === Tab.DUBBING && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 xl:gap-6 animate-in fade-in">
                        {/* ... Dubbing UI ... */}
                        <div className="space-y-4">
                             {/* ... Video Player ... */}
                             <div className={`rounded-3xl overflow-hidden flex flex-col h-[clamp(14rem,32vh,26rem)] sm:h-[420px] xl:h-[500px] relative group ${
                               isDarkUi
                                 ? 'bg-slate-950 border border-slate-700/80 shadow-sm'
                                 : 'bg-white border border-slate-200/90 shadow-[0_12px_34px_rgba(15,23,42,0.08)]'
                             }`}>
                                {videoUrl ? (
                                    <div className={`relative w-full h-full flex flex-col justify-center ${
                                      isDarkUi
                                        ? 'bg-gradient-to-br from-slate-950 via-indigo-950/35 to-slate-900'
                                        : 'bg-gradient-to-br from-slate-100 via-indigo-100/30 to-slate-50'
                                    }`}>
                                        <video ref={videoRef} src={videoUrl} className="max-h-full max-w-full mx-auto object-contain" controls={false} />
                                        <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col gap-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 opacity-100 transition-opacity xl:opacity-0 xl:group-hover:opacity-100">
                                            <div className="flex justify-center items-center gap-6">
                                                <button onClick={toggleDubPlayback} className={`p-4 rounded-full text-white transition-all transform hover:scale-110 bg-indigo-600 shadow-lg shadow-indigo-500/50`}>
                                                    {isPlayingDub ? <Pause size={28} fill="currentColor"/> : <Play size={28} fill="currentColor" className="ml-1"/>}
                                                </button>
                                            </div>
                                            {dubAudioUrl && (
                                                <div className="bg-gray-900/80 rounded-xl p-3 flex items-center gap-4 backdrop-blur-md border border-white/10">
                                                     <div className="flex-1">
                                                         <div className="text-[10px] text-gray-300 font-bold mb-1">Dub Track</div>
                                                         <input
                                                             type="range"
                                                             min={0}
                                                             max={1}
                                                             step={0.01}
                                                             value={dubVolume}
                                                             onChange={(e) => setDubVolume(parseFloat(e.target.value))}
                                                             className="w-full accent-indigo-500"
                                                         />
                                                     </div>
                                                     <div className="flex-1">
                                                         <div className="text-[10px] text-gray-300 font-bold mb-1">Original Audio</div>
                                                         <input
                                                             type="range"
                                                             min={0}
                                                             max={1}
                                                             step={0.01}
                                                             value={videoVolume}
                                                             onChange={(e) => setVideoVolume(parseFloat(e.target.value))}
                                                             className="w-full accent-cyan-500"
                                                         />
                                                     </div>
                                                </div>
                                            )}
                                        </div>
                                        {dubAudioUrl && <audio ref={dubAudioRef} src={dubAudioUrl} className="hidden" />}
                                    </div>
                                ) : (
                                    <div className={`w-full h-full flex flex-col items-center justify-center p-8 ${
                                      isDarkUi
                                        ? 'text-slate-300 bg-slate-900'
                                        : 'text-slate-500 bg-gradient-to-br from-slate-50 to-indigo-50/60'
                                    }`}>
                                        <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 ${
                                          isDarkUi ? 'bg-slate-800' : 'bg-slate-200/70'
                                        }`}><UploadCloud size={32} className={isDarkUi ? 'text-indigo-400' : 'text-indigo-500'}/></div>
                                        <p className={`font-bold ${isDarkUi ? 'text-slate-200' : 'text-slate-700'}`}>Upload Video Source</p>
                                        <div className="relative group/btn mt-6"><input type="file" accept="video/*" multiple onChange={handleVideoUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" /><Button variant="secondary">Select Files</Button></div>
                                    </div>
                                )}
                            </div>
                            {dubbingJobResultUrl && dubbingUiState.phase === 'done' && (
                                <div className={`rounded-2xl p-4 flex flex-wrap items-center gap-3 ${
                                  isDarkUi
                                    ? 'bg-slate-900/75 border border-slate-700 text-slate-200'
                                    : 'bg-white border border-gray-200 text-slate-700'
                                }`}>
                                    <a
                                        href={dubbingJobResultUrl}
                                        download={renderedDubVideoUrl ? 'dubbed_video_final.mp4' : 'dubbed_audio_final.wav'}
                                        className={`text-xs font-bold inline-flex items-center gap-1.5 ${
                                          isDarkUi ? 'text-indigo-300 hover:text-indigo-200' : 'text-indigo-600 hover:text-indigo-800'
                                        }`}
                                    >
                                        <Download size={12} /> Download Output
                                    </a>
                                    {dubbingReportUrl && (
                                        <a
                                            href={dubbingReportUrl}
                                            download="dubbing_report.json"
                                            className={`text-xs font-bold inline-flex items-center gap-1.5 ${
                                              isDarkUi ? 'text-emerald-300 hover:text-emerald-200' : 'text-emerald-600 hover:text-emerald-800'
                                            }`}
                                        >
                                            <Download size={12} /> Download Report
                                        </a>
                                    )}
                                </div>
                            )}
                            {/* ... Detected Cast Dubbing ... */}
                        </div>

                        {/* Right Column: Scripting & Generation */}
                        <div className="space-y-4 h-full flex flex-col">
                                 <SectionCard className={`vf-dub-status rounded-2xl border p-4 ${dubbingStatusAppearance.tone}`}>
                                     <div className="flex items-start justify-between gap-2">
                                         <div className="min-w-0 flex items-start gap-2.5">
                                             <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border ${
                                               isDarkUi ? 'border-indigo-400/40 bg-indigo-500/15' : 'border-indigo-200 bg-indigo-100/70'
                                             }`}>
                                               {dubbingUiState.phase === 'running'
                                                 ? <Loader2 size={13} className="animate-spin" />
                                                 : <Activity size={13} />}
                                             </span>
                                             <div className="min-w-0">
                                                 <p className="text-[11px] font-black uppercase tracking-widest opacity-80">Dubbing</p>
                                                 <p className="text-sm font-semibold leading-tight">{dubbingStatusAppearance.title}</p>
                                                 <p className={`mt-1 text-[11px] leading-tight ${isDarkUi ? 'text-slate-300' : 'text-gray-600'}`}>{dubbingStatusAppearance.subtitle}</p>
                                             </div>
                                         </div>
                                         <span className="shrink-0 rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-bold uppercase">
                                           {dubbingStatusAppearance.badge}
                                         </span>
                                     </div>
                                     <div className={`mt-3 h-1.5 w-full rounded-full ${isDarkUi ? 'bg-white/10' : 'bg-black/10'}`}>
                                       <div
                                         className={`vf-dub-status__fill h-full rounded-full transition-all duration-300 ${dubbingStatusAppearance.bar} ${dubbingUiState.phase === 'running' ? 'vf-dub-status__fill--running' : ''}`}
                                         style={{ width: `${dubbingStatusAppearance.progressPct}%` }}
                                       />
                                     </div>
                                     {dubbingUiState.phase === 'error' && dubbingUiState.error && (
                                       <p className={`mt-2 rounded-lg border px-2 py-1 text-[10px] font-semibold ${
                                         isDarkUi ? 'border-rose-400/40 bg-rose-500/15 text-rose-100' : 'border-red-200/70 bg-red-100/70 text-red-800'
                                       }`}>
                                         {dubbingUiState.error}
                                       </p>
                                      )}
                                  </SectionCard>
                                 <SectionCard className={`rounded-2xl border ${isDarkUi ? 'border-slate-700 bg-slate-900/70 text-slate-200' : 'border-slate-200 bg-white text-slate-700'}`}>
                                     <button
                                       type="button"
                                       onClick={() => setIsVideoPipelineGuideOpen((prev) => !prev)}
                                       className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left"
                                     >
                                       <div>
                                         <p className="text-xs font-black uppercase tracking-wide opacity-80">Guide</p>
                                         <p className="text-sm font-semibold">Video Pipeline (2026)</p>
                                       </div>
                                       {isVideoPipelineGuideOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                     </button>
                                     {isVideoPipelineGuideOpen && (
                                       <div className={`border-t px-4 py-3 space-y-3 text-xs leading-relaxed ${isDarkUi ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>
                                         <p>
                                           The 2026 dubbing stack uses a hybrid architecture: Gemini orchestrates content, timing, and emotion while W-Okada voice transfer applies voice identity with CPU-first conversion.
                                         </p>
                                         <div className="space-y-2">
                                           {VIDEO_PIPELINE_2026_PHASES.map((phase) => (
                                             <div key={phase.title} className={`rounded-xl border p-2.5 ${isDarkUi ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50'}`}>
                                               <p className={`font-semibold ${isDarkUi ? 'text-slate-100' : 'text-slate-800'}`}>{phase.title}</p>
                                               <p className="mt-1">{phase.body}</p>
                                             </div>
                                           ))}
                                         </div>
                                         <div className="overflow-x-auto rounded-xl border border-current/20">
                                           <table className="min-w-full text-left text-[11px]">
                                             <thead className={isDarkUi ? 'bg-slate-800/80 text-slate-200' : 'bg-slate-100 text-slate-700'}>
                                               <tr>
                                                 <th className="px-2.5 py-2 font-semibold">Step</th>
                                                 <th className="px-2.5 py-2 font-semibold">Tool/Model</th>
                                                 <th className="px-2.5 py-2 font-semibold">Modality</th>
                                                 <th className="px-2.5 py-2 font-semibold">Accuracy Benefit</th>
                                               </tr>
                                             </thead>
                                             <tbody>
                                               {VIDEO_PIPELINE_2026_SUMMARY_ROWS.map((row) => (
                                                 <tr key={row.step} className={isDarkUi ? 'border-t border-slate-800' : 'border-t border-slate-200'}>
                                                   <td className="px-2.5 py-2">{row.step}</td>
                                                   <td className="px-2.5 py-2">{row.tool}</td>
                                                   <td className="px-2.5 py-2">{row.modality}</td>
                                                   <td className="px-2.5 py-2">{row.benefit}</td>
                                                 </tr>
                                               ))}
                                             </tbody>
                                           </table>
                                         </div>
                                         <div className={`rounded-lg border px-3 py-2 ${isDarkUi ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100' : 'border-cyan-200 bg-cyan-50 text-cyan-800'}`}>
                                           Pro-tip: use thinking level low for straightforward single-speaker segments, and switch to high for complex multi-speaker overlap scenes.
                                         </div>
                                       </div>
                                     )}
                                 </SectionCard>
                                 <SectionCard className={`rounded-3xl flex-1 flex flex-col overflow-hidden min-h-[420px] ${isDarkUi ? 'bg-slate-950/70 border-slate-700' : ''}`}>
                                 <div className={`px-4 py-3 border-b space-y-2.5 ${isDarkUi ? 'border-slate-700 bg-slate-900/70' : 'border-gray-100 bg-gray-50/70'}`}>
                                      <div className="flex flex-wrap items-center gap-2">
                                          <div className="relative">
                                              <input
                                                type="file"
                                                accept="video/*"
                                                multiple
                                                onChange={handleVideoUpload}
                                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                                title="Add one or more videos to queue"
                                              />
                                              <button
                                                type="button"
                                                className={`h-8 px-3 text-[11px] font-bold rounded-lg border inline-flex items-center gap-1.5 transition-colors ${
                                                  isDarkUi
                                                    ? 'text-slate-200 hover:text-cyan-200 hover:bg-cyan-500/10 border-slate-600 bg-slate-800'
                                                    : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50 border-gray-200 bg-white'
                                                }`}
                                              >
                                                <Plus size={14} />
                                                <span>Add Videos</span>
                                              </button>
                                          </div>
                                          <div className={`flex items-center gap-1 rounded-lg border px-2 py-0.5 ${
                                            isDarkUi ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'
                                          }`}>
                                              <Film size={12} className={isDarkUi ? 'text-slate-400' : 'text-gray-500'} />
                                              <select
                                                  value={selectedDubbingClipId}
                                                  onChange={(e) => setSelectedDubbingClipId(e.target.value)}
                                                  className={`h-7 bg-transparent text-[11px] font-semibold outline-none min-w-0 w-full sm:min-w-[11rem] sm:w-auto vf-theme-select ${
                                                    isDarkUi ? 'text-slate-200' : 'text-gray-700'
                                                  }`}
                                                  title="Active clip"
                                              >
                                                  <option value="">Select active clip</option>
                                                  {dubbingClips.map((clip, index) => (
                                                      <option key={clip.id} value={clip.id}>
                                                          {index + 1}. {clip.file.name} ({formatClipDuration(clip.trimOutMs - clip.trimInMs)})
                                                      </option>
                                                  ))}
                                              </select>
                                          </div>
                                          <div className={`flex items-center gap-1 rounded-lg border px-2 py-0.5 ${
                                            isDarkUi ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'
                                          }`}>
                                              <Type size={12} className={isDarkUi ? 'text-slate-400' : 'text-gray-500'} />
                                              <select
                                                  value={settings.dubbingSourceLanguage || 'auto'}
                                                  onChange={(e) => setSettings((s) => ({ ...s, dubbingSourceLanguage: e.target.value }))}
                                                  className={`h-7 bg-transparent text-[11px] font-semibold outline-none min-w-0 w-full sm:min-w-[8.25rem] sm:w-auto vf-theme-select ${
                                                    isDarkUi ? 'text-slate-200' : 'text-gray-700'
                                                  }`}
                                                  title="Source language hint for transcription"
                                              >
                                                  {DUBBING_SOURCE_LANGUAGE_OPTIONS.map((langOption) => (
                                                      <option key={langOption.code} value={langOption.code}>{langOption.label}</option>
                                                  ))}
                                              </select>
                                          </div>
                                          <button
                                            onClick={handleGenerateDub}
                                            disabled={isGenerating || dubbingClips.length === 0}
                                            className={`h-8 text-[11px] font-bold px-3 rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors ${
                                              isDarkUi
                                                ? 'bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30 border border-indigo-400/40'
                                                : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 shadow-sm shadow-indigo-200/50'
                                            }`}
                                            title="One-click AI dubbing for queue"
                                          >
                                            {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                                            <span>AI Dub</span>
                                          </button>
                                          <button
                                            onClick={() => handleTranslateVideo('transcribe')}
                                            disabled={!selectedDubbingClip || isProcessingVideo}
                                            className={`h-8 px-3 text-[11px] font-bold rounded-lg border inline-flex items-center gap-1.5 transition-colors disabled:opacity-60 ${
                                              isDarkUi
                                                ? 'text-slate-200 hover:text-cyan-200 hover:bg-cyan-500/10 border-slate-600 bg-slate-800'
                                                : 'text-gray-700 hover:text-indigo-700 hover:bg-indigo-50 border-gray-200 bg-white'
                                            }`}
                                            title="Transcribe active clip"
                                          >
                                              {isProcessingVideo ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>}
                                              <span>Transcribe</span>
                                          </button>
                                          <button
                                            onClick={() => { void handleRemoveSelectedClip(); }}
                                            disabled={!selectedDubbingClip}
                                            className={`h-8 px-2.5 text-[11px] font-bold rounded-lg border inline-flex items-center gap-1.5 transition-colors disabled:opacity-60 ${
                                              isDarkUi
                                                ? 'text-rose-200 hover:text-rose-100 hover:bg-rose-500/10 border-rose-400/35 bg-rose-500/5'
                                                : 'text-rose-700 hover:text-rose-800 hover:bg-rose-50 border-rose-200 bg-white'
                                            }`}
                                            title="Remove active clip from queue"
                                          >
                                            <Trash2 size={14} />
                                            <span>Remove</span>
                                          </button>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => setIsDubbingAdvancedOpen((prev) => !prev)}
                                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-[11px] font-bold ${
                                          isDarkUi ? 'border-slate-700 bg-slate-950/60 text-slate-200' : 'border-slate-200 bg-white text-slate-700'
                                        }`}
                                      >
                                        <span>Advanced</span>
                                        {isDubbingAdvancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                      </button>

                                      {isDubbingAdvancedOpen && (
                                        <div className={`space-y-2 rounded-xl border p-2.5 ${
                                          isDarkUi ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50'
                                        }`}>
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className={`text-[10px] font-black uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Script</span>
                                            <button onClick={() => handleDubbingEditorTool('clean')} className="h-7 px-2 text-[10px] font-semibold rounded border">Clean</button>
                                            <button onClick={() => handleDubbingEditorTool('speakerize')} className="h-7 px-2 text-[10px] font-semibold rounded border">Speakerize</button>
                                            <button onClick={() => handleDubbingEditorTool('dedupe')} className="h-7 px-2 text-[10px] font-semibold rounded border">Dedupe</button>
                                            <button onClick={() => handleDubbingEditorTool('compact')} className="h-7 px-2 text-[10px] font-semibold rounded border">Compact</button>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className={`text-[10px] font-black uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Timeline</span>
                                            <button onClick={() => handleDubbingTimelineTool('cut')} className="h-7 px-2 text-[10px] font-semibold rounded border">Cut</button>
                                            <button onClick={() => handleDubbingTimelineTool('copy')} className="h-7 px-2 text-[10px] font-semibold rounded border">Copy</button>
                                            <button onClick={() => handleDubbingTimelineTool('paste')} className="h-7 px-2 text-[10px] font-semibold rounded border">Paste</button>
                                            <button onClick={() => handleDubbingTimelineTool('split')} className="h-7 px-2 text-[10px] font-semibold rounded border">Split</button>
                                            <button onClick={() => handleDubbingTimelineTool('trim_in')} className="h-7 px-2 text-[10px] font-semibold rounded border">Trim In</button>
                                            <button onClick={() => handleDubbingTimelineTool('trim_out')} className="h-7 px-2 text-[10px] font-semibold rounded border">Trim Out</button>
                                            <button onClick={() => handleDubbingTimelineTool('layer')} className="h-7 px-2 text-[10px] font-semibold rounded border">Move Layer</button>
                                            <button onClick={() => handleDubbingTimelineTool('remove')} className="h-7 px-2 text-[10px] font-semibold rounded border">Remove</button>
                                            <button onClick={handleTimelineUndo} className="h-7 px-2 text-[10px] font-semibold rounded border">Undo</button>
                                            <button onClick={handleTimelineRedo} className="h-7 px-2 text-[10px] font-semibold rounded border">Redo</button>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className={`text-[10px] font-black uppercase tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Queue</span>
                                            <button onClick={() => handleRetryClip(selectedDubbingClipId)} className="h-7 px-2 text-[10px] font-semibold rounded border" disabled={!selectedDubbingClipId}>Retry</button>
                                            <button onClick={() => { void handleRemoveSelectedClip(); }} className="h-7 px-2 text-[10px] font-semibold rounded border" disabled={!selectedDubbingClipId}>Remove Selected</button>
                                            <button onClick={handleRemoveCompletedQueue} className="h-7 px-2 text-[10px] font-semibold rounded border">Remove Completed</button>
                                            <button onClick={() => { void handleClearDubbingQueue(); }} className="h-7 px-2 text-[10px] font-semibold rounded border">Remove All</button>
                                            <div className={`flex items-center gap-1 rounded border px-1.5 ${isDarkUi ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
                                              <span className="text-[10px] font-semibold">CPU</span>
                                              <select
                                                value={dubbingCpuProfile}
                                                onChange={(e) => setDubbingCpuProfile(e.target.value as CpuDubbingProfile)}
                                                className="h-6 bg-transparent text-[10px] font-semibold outline-none"
                                              >
                                                {Object.entries(DUBBING_CPU_PROFILE_LABELS).map(([value, label]) => (
                                                  <option key={value} value={value}>{label}</option>
                                                ))}
                                              </select>
                                            </div>
                                          </div>
                                          {selectedDubbingClip && (
                                            <div className="space-y-1">
                                              <div className="text-[10px] font-semibold opacity-80">Playhead / Trim</div>
                                              <input
                                                type="range"
                                                min={selectedDubbingClip.trimInMs}
                                                max={selectedDubbingClip.trimOutMs}
                                                value={Math.max(selectedDubbingClip.trimInMs, Math.min(dubbingPlayheadMs, selectedDubbingClip.trimOutMs))}
                                                onChange={(e) => setDubbingPlayheadMs(Number(e.target.value))}
                                                className="w-full accent-indigo-500"
                                              />
                                            </div>
                                          )}
                                          <div className="space-y-1">
                                            <div className="text-[10px] font-semibold opacity-80">Mini Timeline</div>
                                            {DUBBING_TIMELINE_LAYERS.map((layer) => (
                                              <div key={layer} className="flex flex-wrap items-center gap-1">
                                                <span className="text-[10px] font-bold">{layer}</span>
                                                {dubbingClips.filter((clip) => clip.layer === layer).map((clip, index) => (
                                                  <div key={clip.id} className="inline-flex items-center gap-1">
                                                    <button
                                                      type="button"
                                                      onClick={() => setSelectedDubbingClipId(clip.id)}
                                                      className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                                                        clip.id === selectedDubbingClipId
                                                          ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100'
                                                          : isDarkUi
                                                            ? 'border-slate-700 bg-slate-900 text-slate-200'
                                                            : 'border-slate-200 bg-white text-slate-700'
                                                      }`}
                                                    >
                                                      {index + 1}. {clip.file.name}
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => { void handleRemoveClipFromQueue(clip.id); }}
                                                      className={`h-5 w-5 rounded border text-[10px] font-bold ${
                                                        isDarkUi
                                                          ? 'border-rose-400/35 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                                                          : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                                      }`}
                                                      title="Remove clip"
                                                    >
                                                      x
                                                    </button>
                                                  </div>
                                                ))}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                 </div>
                                 
                                 <DubbingTranslateBar
                                     targetLang={targetLang}
                                     isBusy={isAiWriting || isProcessingVideo}
                                     hasDubScript={Boolean(dubScript.trim())}
                                     hasVideoFile={Boolean(videoFile)}
                                     isDarkUi={isDarkUi}
                                     languages={LANGUAGES}
                                     onTargetLang={setTargetLang}
                                     onTranslateText={() => { void handleTranslate(); }}
                                     onTranslateAudio={() => { void handleTranslateVideo('translate'); }}
                                  />

                                  <textarea 
                                    value={dubScript} 
                                    onChange={(e) => setDubScript(e.target.value)} 
                                    placeholder="Enter script or transcribe video..." 
                                    className={`flex-1 p-5 sm:p-6 resize-none outline-none text-sm sm:text-base leading-relaxed font-mono bg-transparent custom-scrollbar ${
                                      isDarkUi ? 'text-slate-200 placeholder:text-slate-400' : 'text-gray-700'
                                    }`} 
                                 />
                                  
                                  <div className={`px-4 py-3 border-t text-[11px] font-semibold flex flex-wrap items-center justify-between gap-2 ${
                                    isDarkUi ? 'bg-slate-900/75 border-slate-700 text-slate-300' : 'bg-gray-50 border-gray-100 text-gray-600'
                                  }`}>
                                      <span>
                                        Queue: {dubbingClips.length} clip{dubbingClips.length === 1 ? '' : 's'}
                                      </span>
                                      <span>
                                        Completed: {dubbingClips.filter((clip) => clip.status === 'completed').length}
                                      </span>
                                  </div>
                              </SectionCard>
                        </div>
                    </div>
                )}

                {usesPhoneStudioDock && (
                    <div className="sticky bottom-0 z-[47] mx-auto w-full max-w-[1140px] px-1 pt-4">
                        <div className="mx-auto w-full max-w-xl pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                            <div className="vf-studio-generate-dock rounded-2xl border border-indigo-400/35 p-2 backdrop-blur-xl">
                                <MorphingGenerateButton
                                  onClick={handleGenerate}
                                  onCancel={handleCancelGeneration}
                                  disabled={!text.trim()}
                                  isGenerating={isGenerating}
                                  progress={progress}
                                  stage=""
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {usesCompactFloatingStudioDock && (
            <div className={`vf-studio-generate-anchor ${studioFloatingDockVariantClass} fixed z-[47] ${studioFloatingDockWidthClass}`}>
                <div className={`vf-studio-generate-dock rounded-2xl border border-indigo-400/35 backdrop-blur-xl ${isDesktop ? 'p-2' : 'p-1.5'}`}>
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

      {/* Floating AI Assistant */}
      <div
        className={`fixed right-4 xl:right-6 z-50 flex flex-col items-end gap-4 ${studioAssistantBottomClass}`}
      >
          {isChatOpen && (
              <div className="w-[min(20rem,calc(100vw-1.5rem))] h-[min(28rem,calc(100vh-8rem))] bg-white rounded-2xl shadow-2xl border border-white/50 backdrop-blur-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300 relative z-50 ring-1 ring-gray-100">
                  {/* ... Chat UI ... */}
                  <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-3 flex items-center justify-between text-white relative overflow-hidden">
                      <div className="flex items-center gap-2 font-bold text-sm relative z-10"><Sparkles size={16} className="text-yellow-300"/> Creative Assistant</div>
                      <button
                        onClick={() => setIsChatOpen(false)}
                        className="hover:bg-white/20 p-1 rounded-full relative z-10"
                        aria-label="Close assistant panel"
                      >
                        <X size={14}/>
                      </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/80 custom-scrollbar">
                      {chatHistory.map((msg, i) => (
                          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                              <div className={`max-w-[90%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-700 rounded-bl-none'}`}>{msg.text}</div>
                          </div>
                      ))}
                      <div ref={chatEndRef} />
                  </div>
                  <form onSubmit={handleChatSubmit} className="p-3 bg-white border-t border-gray-100 flex gap-2">
                      <input className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none" placeholder="Message..." value={chatInput} onChange={e => setChatInput(e.target.value)} />
                      <button disabled={isChatLoading} type="submit" className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"><Send size={14}/></button>
                  </form>
              </div>
          )}
          
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="group relative w-16 h-16 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-indigo-400/50"
            aria-label={isChatOpen ? 'Close assistant' : 'Open assistant'}
          >
              <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 animate-ping opacity-20 duration-1000"></span>
              <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 ring-4 ring-white/30"></span>
              <div className="relative z-10 text-white transform transition-transform group-hover:rotate-12">{isChatOpen ? <X size={28} strokeWidth={3}/> : <Sparkles size={28} fill="currentColor" className="animate-pulse"/>}</div>
          </button>
      </div>

      {/* Resource Monitor */}
      <ResourceMonitor isWorking={isGenerating || isProcessingVideo || isAiWriting || isChatLoading} />

      {/* Modals & Overlays */}
      {showSettings && renderSettingsPanel()}
      <AdModal
        isOpen={showAdModal}
        onClose={() => setShowAdModal(false)}
        onReward={() => {
          void (async () => {
            try {
              await watchAd();
              showToast('Reward granted: +1000 VFF', 'success');
            } catch (error: any) {
              showToast(error?.message || 'Ad reward claim failed.', 'error');
            } finally {
              setShowAdModal(false);
            }
          })();
        }}
      />
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

