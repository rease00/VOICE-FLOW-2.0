import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileAudio,
  Gauge,
  LibraryBig,
  Loader2,
  Mic2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '../../../components/Button';
import { SectionCard } from '../../../components/SectionCard';
import { UploadDropzone } from '../../../components/ui/UploadDropzone';
import { VoiceClonePreviewPlayer } from './VoiceClonePreviewPlayer';
import { VoiceCloneTaskProgressCard } from './VoiceCloneTaskProgressCard';
import { useUser } from '../../../contexts/UserContext';
import { getSharedAudioContext } from '../../../src/shared/audio/audioContext';
import { arrayBufferToBase64 } from '../../../src/shared/audio/base64';
import { audioBufferToWav } from '../../../src/shared/audio/wav';
import { resolvePublicVoiceLabel } from '../../../src/shared/voices/voicePublicName';
import { useManagedTabs } from '../../../src/shared/ui/tabs';
import type { ClonedVoice, TtsEngineKey, UserProfile, VoiceOption } from '../../../types';
import { resolveVoiceClonePlayableAudioUrlWithFallback } from './audio';
import {
  canViewVoiceCloneStressControls,
  deriveStressRpmFromConcurrency,
  getErrorMessage,
  getStressRuntimeDeviceLabel,
  getStressValidationMessage,
  isVoiceCloneStressActiveStatus,
  isVoiceCloneStressTerminalStatus,
  mapVoiceCloneStressError,
  normalizeVoiceCloneStressTarget,
  shouldPollVoiceCloneStressStatus,
} from './voiceCloneStressHelpers';
import {
  formatVoiceCloneStatusRetryDelayLabel,
  resolveVoiceCloneStatusRetryDelayMs,
  VOICE_CLONE_STATUS_RETRY_INTERVAL_MS,
} from './voiceCloneStatusRetry';
import {
  cancelVoiceCloneJob,
  cancelVoiceCloneStressTest,
  fetchVoiceCloneStatus,
  fetchVoiceCloneJobStatus,
  fetchVoiceCloneJobStatusByRequest,
  fetchVoiceCloneStressTestStatus,
  separateVoiceAndBackgroundWithDemucs,
  startVoiceCloneRenderJob,
  startVoiceCloneStressTest,
  type VoiceCloneJobError,
  type VoiceCloneJobProgress,
  type VoiceCloneJobStatusResponse,
  type VoiceCloneStressBenchmarkTarget,
  type VoiceCloneStressConfig,
  type VoiceCloneStressStartRequest,
  type VoiceCloneStressStatusResponse,
  type VoiceCloneRenderResponse,
} from './api';
import {
  getVoiceCloneProviderDisplayStatus,
  type VoiceCloneBenchmarkStatusResponse,
} from './openvoiceTypes';
import {
  buildVoiceCloneStemSeparationRequest,
  getVoiceCloneStemExtractionMaxBytes,
  isFullDurationTrimRange,
} from './stemSeparation';
import {
  deleteVoiceCloneWorkspaceFile,
  readVoiceCloneWorkspaceDraft,
  readVoiceCloneWorkspaceFile,
  type PersistedVoiceCloneActiveJob,
  type PersistedVoiceCloneFileRef,
  type PersistedVoiceCloneResult,
  writeVoiceCloneWorkspaceDraft,
  storeVoiceCloneWorkspaceFile,
} from './workspacePersistence';

interface VoiceCloningTabContentProps {
  backendBaseUrl?: string | undefined;
  selectedEngine?: TtsEngineKey;
  voiceLibraryVoices?: VoiceOption[];
  voicePreviewState?: { id: string; status: 'loading' | 'playing' } | null;
  onPreviewVoice?: (voiceId: string, name: string) => Promise<void> | void;
  layout?: 'stacked' | 'workspace';
  denseTabs?: boolean;
  showRail?: boolean;
  diagnosticsExpanded?: boolean;
  onDiagnosticsExpandedChange?: (expanded: boolean) => void;
}

type VoiceCloneResponse = VoiceCloneRenderResponse;

interface CloningResultState {
  previewUrl: string;
  downloadUrl: string;
  fileName: string;
  response: VoiceCloneResponse;
  cloneMode: 'modal_vc';
}

interface StemExtractionResultState {
  vocalsPreviewUrl: string;
  vocalsDownloadUrl: string;
  vocalsFileName: string;
  backgroundPreviewUrl: string;
  backgroundDownloadUrl: string;
  backgroundFileName: string;
  durationSec: number;
  consumedVcUnits: number;
  chargedInr: number;
}

interface TrimmedStemExtractionResultState {
  vocalsPreviewUrl: string;
  vocalsDownloadUrl: string;
  vocalsFileName: string;
  backgroundPreviewUrl: string;
  backgroundDownloadUrl: string;
  backgroundFileName: string;
  startSec: number;
  endSec: number;
}

interface TrimmedSourceMixState {
  previewUrl: string;
  startSec: number;
  endSec: number;
}

const PAID_VOICE_CLONE_PLANS = new Set(['Launcher', 'Starter', 'Creator', 'Pro', 'Scale', 'Enterprise']);

type VoiceUtilityTab = 'clone' | 'separate' | 'library';
type VoiceCloneTaskKind = 'clone' | 'separate';

interface VoiceCloneTaskState {
  kind: VoiceCloneTaskKind;
  title: string;
  stage: string;
  detail: string;
  progress: number;
}

interface VoiceCloneJobRuntimeState extends PersistedVoiceCloneActiveJob {
  progress?: VoiceCloneJobProgress;
  result?: VoiceCloneResponse;
  error?: VoiceCloneJobError;
}

const VOICE_UTILITY_TAB_ITEMS: Array<{ id: VoiceUtilityTab }> = [
  { id: 'clone' },
  { id: 'separate' },
  { id: 'library' },
];

const TRIM_DURATION_EPSILON = 0.001;
const MAX_STEM_EXTRACTION_SOURCE_BYTES = getVoiceCloneStemExtractionMaxBytes();
const VOICE_CLONE_STATUS_EVENT_REFRESH_COOLDOWN_MS = 5_000;
const VOICE_CLONE_CONSENT_STORAGE_KEY = 'vf_voice_clone_consent_v1';
const VOICE_CLONE_JOB_POLL_INTERVAL_MS = 2_500;
const VOICE_LIBRARY_CARD_RENDER_STYLE: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: '110px 140px',
};
type VoiceUtilityTabStatusTone = 'ready' | 'usable' | 'down';

const getVoiceUtilityTabDotClass = (tone: VoiceUtilityTabStatusTone): string => {
  if (tone === 'usable') return 'bg-emerald-500';
  if (tone === 'ready') return 'bg-amber-500';
  return 'bg-red-500';
};

const getVoiceUtilityTabStatusLabel = (tone: VoiceUtilityTabStatusTone): string => {
  if (tone === 'usable') return 'Can start using';
  if (tone === 'ready') return 'Ready';
  return 'Server down';
};

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Number(value) || 0));

const buildVoiceCloneTaskState = (
  kind: VoiceCloneTaskKind,
  progress: number,
  stage: string,
  detail: string
): VoiceCloneTaskState => ({
  kind,
  title: kind === 'clone' ? 'Cloning in progress' : 'Stem extraction in progress',
  stage,
  detail,
  progress: clampProgress(progress),
});

const isVoiceCloneJobTerminalStatus = (status: string): boolean => {
  const token = String(status || '').trim().toLowerCase();
  return token === 'completed' || token === 'failed' || token === 'cancelled';
};

const isVoiceCloneJobReconnectPendingStatus = (status: string): boolean => {
  const token = String(status || '').trim().toLowerCase();
  return token === 'starting' || token === 'queued' || token === 'running';
};

const isVoiceCloneJobNotFoundError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status) === 404
    : false;

const isRetryableVoiceCloneConnectionError = (error: unknown): boolean => {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  if (status >= 500) return true;
  const message = String((error as { message?: unknown } | null | undefined)?.message || error || '').trim().toLowerCase();
  return [
    'failed to fetch',
    'fetch failed',
    'networkerror',
    'network error',
    'load failed',
    'econnrefused',
    'err_connection_refused',
  ].some((token) => message.includes(token));
};

const normalizeVoiceCloneJobRuntimeState = (
  job: VoiceCloneJobStatusResponse | PersistedVoiceCloneActiveJob | null | undefined
): VoiceCloneJobRuntimeState | null => {
  if (!job) return null;
  const requestId = String(job.requestId || '').trim();
  const rawKind = String((job as { kind?: unknown }).kind || '').trim().toLowerCase();
  const kind = rawKind === 'openvoice' ? 'voice_clone' : rawKind;
  if (!requestId || kind !== 'voice_clone') return null;
  const typedJob = job as VoiceCloneJobStatusResponse;
  const result = typedJob.result && typeof typedJob.result === 'object'
    ? (typedJob.result as VoiceCloneResponse)
    : undefined;
  const error = typedJob.error && typeof typedJob.error === 'object'
    ? typedJob.error
    : undefined;
  return {
    requestId,
    ...(String((job as { jobId?: unknown }).jobId || '').trim() ? { jobId: String((job as { jobId?: unknown }).jobId || '').trim() } : {}),
    kind,
    status: String(job.status || '').trim() || 'starting',
    ...(typedJob.progress && typeof typedJob.progress === 'object' ? { progress: typedJob.progress } : {}),
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
  };
};

const mergeVoiceCloneRuntimeJobState = (
  job: VoiceCloneJobStatusResponse | PersistedVoiceCloneActiveJob | null | undefined,
  fallback: VoiceCloneJobRuntimeState | null
): VoiceCloneJobRuntimeState | null => {
  const normalized = normalizeVoiceCloneJobRuntimeState(job);
  if (normalized) return normalized;
  if (!fallback) return null;
  const nextStatus = String((job as { status?: unknown } | null | undefined)?.status || '').trim();
  const nextJobId = String((job as { jobId?: unknown } | null | undefined)?.jobId || '').trim();
  const rawKind = String((job as { kind?: unknown } | null | undefined)?.kind || '').trim().toLowerCase();
  const nextKind = rawKind === 'openvoice' ? 'voice_clone' : rawKind;
  const merged: VoiceCloneJobRuntimeState = {
    ...fallback,
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(nextJobId ? { jobId: nextJobId } : {}),
  };
  if (nextKind === 'voice_clone') {
    merged.kind = nextKind as VoiceCloneJobRuntimeState['kind'];
  }
  return merged;
};

const buildVoiceCloneTaskFromRuntimeJob = (
  job: VoiceCloneJobRuntimeState,
  isOnline: boolean
): VoiceCloneTaskState => {
  const status = String(job.status || '').trim().toLowerCase();
  const progress = clampProgress(Number(job.progress?.percent || (status === 'starting' ? 8 : status === 'queued' ? 16 : status === 'running' ? 56 : 100)));
  if (!isOnline && isVoiceCloneJobReconnectPendingStatus(status)) {
    return buildVoiceCloneTaskState(
      'clone',
      progress,
      'Waiting for connection',
      'The browser is offline. Your cached inputs will reconnect automatically when the network returns.'
    );
  }
  if (status === 'starting') {
    return buildVoiceCloneTaskState(
      'clone',
      progress,
      'Restoring reconnect-safe request',
      'Checking whether the backend already has this request, then resubmitting only if needed.'
    );
  }
  if (status === 'queued' || status === 'running') {
    return buildVoiceCloneTaskState(
      'clone',
      progress,
      String(job.progress?.stage || 'Processing voice clone').trim() || 'Processing voice clone',
      String(job.progress?.detail || 'The backend is keeping this voice clone available for reconnect and refresh recovery.').trim()
        || 'The backend is keeping this voice clone available for reconnect and refresh recovery.'
    );
  }
  if (status === 'completed') {
    return buildVoiceCloneTaskState('clone', 100, 'Completed', 'The finished voice clone is ready to preview.');
  }
  if (status === 'cancelled') {
    return buildVoiceCloneTaskState('clone', progress, 'Cancelled', 'The active voice clone run was cancelled.');
  }
  return buildVoiceCloneTaskState(
    'clone',
    progress,
    'Clone failed',
    String(job.error?.message || job.error?.detail || 'Voice cloning failed.').trim() || 'Voice cloning failed.'
  );
};

const getVoiceCloneJobFailureMessage = (job: VoiceCloneJobRuntimeState | null): string => {
  if (!job) return 'Voice cloning failed.';
  if (String(job.status || '').trim().toLowerCase() === 'cancelled') {
    return 'Cloning cancelled.';
  }
  return String(job.error?.message || job.error?.detail || 'Voice cloning failed.').trim() || 'Voice cloning failed.';
};

const toPersistedCloningResult = (result: CloningResultState | null): PersistedVoiceCloneResult | null => {
  if (!result) return null;
  const response = result.response && typeof result.response === 'object'
    ? ({ ...result.response } as VoiceCloneResponse & { audioBase64?: string })
    : ({} as VoiceCloneResponse & { audioBase64?: string });
  delete response.audioBase64;
  return {
    previewUrl: String(result.previewUrl || '').trim(),
    downloadUrl: String(result.downloadUrl || '').trim(),
    fileName: String(result.fileName || '').trim() || 'voice-clone.wav',
    response,
    cloneMode: result.cloneMode,
  };
};

const isAbortError = (error: unknown): boolean => {
  const name = String((error as { name?: unknown } | null | undefined)?.name || '').trim().toLowerCase();
  const message = String((error as { message?: unknown } | null | undefined)?.message || '').trim().toLowerCase();
  return name === 'aborterror' || message.includes('aborted') || message.includes('cancelled') || message.includes('canceled');
};

type VoiceCloneConsentStore = Record<string, number>;

const resolveVoiceCloneConsentUserKey = (user: UserProfile | null | undefined): string => {
  const uid = String(user?.uid || '').trim().toLowerCase();
  if (uid) return `uid:${uid}`;
  const userId = String(user?.userId || '').trim().toLowerCase();
  if (userId) return `user:${userId}`;
  const username = String(user?.username || '').trim().toLowerCase();
  if (username) return `username:${username}`;
  const email = String(user?.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  return 'guest';
};

const readVoiceCloneConsentStore = (): VoiceCloneConsentStore => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = String(window.localStorage.getItem(VOICE_CLONE_CONSENT_STORAGE_KEY) || '').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.entries(parsed).reduce<VoiceCloneConsentStore>((acc, [key, value]) => {
      const safeKey = String(key || '').trim();
      const acceptedAt = Number(value);
      if (!safeKey || !Number.isFinite(acceptedAt) || acceptedAt <= 0) return acc;
      acc[safeKey] = acceptedAt;
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const writeVoiceCloneConsentStore = (store: VoiceCloneConsentStore): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(VOICE_CLONE_CONSENT_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
};

const hasPersistedVoiceCloneConsent = (userKey: string): boolean => {
  const safeUserKey = String(userKey || '').trim();
  if (!safeUserKey) return false;
  const acceptedAt = Number(readVoiceCloneConsentStore()[safeUserKey] || 0);
  return Number.isFinite(acceptedAt) && acceptedAt > 0;
};

const persistVoiceCloneConsentAcceptance = (userKey: string): boolean => {
  const safeUserKey = String(userKey || '').trim();
  if (!safeUserKey) return false;
  const store = readVoiceCloneConsentStore();
  store[safeUserKey] = Date.now();
  return writeVoiceCloneConsentStore(store);
};

const toAudioFileName = (label: string, fallback: string): string => {
  const safeLabel = String(label || '').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safeLabel || fallback}.wav`;
};

const makeRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `vc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const measureAudioDurationSec = async (file: File): Promise<number> => {
  try {
    const context = getSharedAudioContext();
    const bytes = await file.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(bytes.slice(0));
    const duration = Number(audioBuffer?.duration || 0);
    if (Number.isFinite(duration) && duration > 0) {
      return Math.max(1, Math.ceil(duration));
    }
  } catch {
    // Fall back to the minimum billable unit when duration detection fails.
  }
  return 1;
};

const measureAudioDurationSecPrecise = async (file: File): Promise<number> => {
  try {
    const context = getSharedAudioContext();
    const bytes = await file.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(bytes.slice(0));
    const duration = Number(audioBuffer?.duration || 0);
    if (Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  } catch {
    // Fall back to the minimum duration unit when duration detection fails.
  }
  return 1;
};

const formatFileSize = (file: File | null): string => {
  if (!file) return 'No file selected';
  const sizeKb = Math.max(1, Math.round(file.size / 1024));
  return `${sizeKb.toLocaleString()} KB`;
};

const formatDuration = (durationSec: number): string => {
  const safeDuration = Math.max(0, Number(durationSec || 0));
  const wholeSeconds = Math.round(safeDuration);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatBytes = (bytes: number): string => {
  const safeBytes = Math.max(0, Number(bytes || 0));
  if (safeBytes < 1024) return `${safeBytes} B`;
  const kb = safeBytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
};

const deriveStemFileName = (artifactName: string | undefined, fallbackName: string): string => {
  const safeArtifactName = String(artifactName || '').trim();
  return safeArtifactName || fallbackName;
};

const toStemFallbackBaseName = (inputName: string): string => {
  const safeName = String(inputName || '').trim();
  if (!safeName) return 'source-audio';
  const withoutExt = safeName.replace(/\.[^./\\]+$/, '').trim();
  return withoutExt || 'source-audio';
};

const formatTrimSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '0';
  const rounded = Math.round(seconds * 1000) / 1000;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
};

const splitFileName = (fileName: string): { baseName: string; extension: string } => {
  const safeName = String(fileName || '').trim();
  if (!safeName) {
    return { baseName: 'audio', extension: '.wav' };
  }

  const match = safeName.match(/^(.*?)(\.[^./\\]+)$/);
  if (!match) {
    return { baseName: safeName, extension: '.wav' };
  }

  return {
    baseName: match[1] || 'audio',
    extension: match[2] || '.wav',
  };
};

const formatTrimLabelForFileName = (seconds: number): string =>
  formatTrimSeconds(seconds).replace(/\./g, 'p');

const buildTrimmedStemFileName = (fileName: string, startSec: number, endSec: number): string => {
  const { baseName, extension } = splitFileName(fileName);
  return `${baseName}_trim_${formatTrimLabelForFileName(startSec)}s-${formatTrimLabelForFileName(endSec)}s${extension}`;
};

const validateTrimRange = (
  startValue: string,
  endValue: string,
  maxDurationSec: number
): string => {
  if (!String(startValue || '').trim() || !String(endValue || '').trim()) {
    return 'Trim start and end are both required.';
  }

  const startSec = Number(startValue);
  const endSec = Number(endValue);

  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    return 'Trim start and end must both be valid numbers.';
  }

  if (startSec < 0 || endSec < 0) {
    return 'Trim start and end must be 0 or greater.';
  }

  if (startSec >= endSec) {
    return 'Trim start must be before trim end.';
  }

  if (!Number.isFinite(maxDurationSec) || maxDurationSec <= 0) {
    return 'Trim validation is unavailable because the stem duration could not be determined.';
  }

  if (startSec > maxDurationSec + TRIM_DURATION_EPSILON) {
    return `Trim start cannot exceed the stem duration of ${formatTrimSeconds(maxDurationSec)} seconds.`;
  }

  if (endSec > maxDurationSec + TRIM_DURATION_EPSILON) {
    return `Trim end cannot exceed the stem duration of ${formatTrimSeconds(maxDurationSec)} seconds.`;
  }

  return '';
};

const trimAudioBuffer = (
  audioBuffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer => {
  const sampleRate = audioBuffer.sampleRate;
  const safeStartSec = Math.max(0, Math.min(startSec, audioBuffer.duration));
  const safeEndSec = Math.max(safeStartSec, Math.min(endSec, audioBuffer.duration));
  const startFrame = Math.max(0, Math.min(audioBuffer.length, Math.floor(safeStartSec * sampleRate)));
  const endFrame = Math.max(startFrame + 1, Math.min(audioBuffer.length, Math.ceil(safeEndSec * sampleRate)));
  const frameCount = endFrame - startFrame;
  if (frameCount <= 0) {
    throw new Error('Trim range produced an empty audio segment.');
  }

  const context = getSharedAudioContext();
  const trimmedBuffer = context.createBuffer(audioBuffer.numberOfChannels, frameCount, sampleRate);

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const sourceChannelData = audioBuffer.getChannelData(channel).subarray(startFrame, endFrame);
    trimmedBuffer.copyToChannel(sourceChannelData, channel, 0);
  }

  return trimmedBuffer;
};

const trimAudioUrlToBlob = async (audioUrl: string, startSec: number, endSec: number): Promise<Blob> => {
  const safeUrl = String(audioUrl || '').trim();
  if (!safeUrl) {
    throw new Error('Missing audio URL for trim operation.');
  }

  const response = await fetch(safeUrl);
  if (!response.ok) {
    throw new Error(`Unable to load audio for trimming (${response.status} ${response.statusText}).`);
  }

  const context = getSharedAudioContext();
  const bytes = await response.arrayBuffer();
  const audioBuffer = await context.decodeAudioData(bytes.slice(0));
  const trimmedBuffer = trimAudioBuffer(audioBuffer, startSec, endSec);
  return audioBufferToWav(trimmedBuffer);
};

const trimAudioFileToBlob = async (sourceFile: File, startSec: number, endSec: number): Promise<Blob> => {
  const bytes = await sourceFile.arrayBuffer();
  const context = getSharedAudioContext();
  const audioBuffer = await context.decodeAudioData(bytes.slice(0));
  const trimmedBuffer = trimAudioBuffer(audioBuffer, startSec, endSec);
  return audioBufferToWav(trimmedBuffer);
};

const useFilePreviewUrl = (file: File | null): string => {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return previewUrl;
};

const VOICE_CLONE_STRESS_DEFAULT_GEMINI_TEXT =
  'V FLOW AI stress test benchmark sample for Gemini Flash throughput.';

const VOICE_CLONE_STRESS_DEFAULT_CONCURRENCY = 2;

const VOICE_CLONE_STRESS_DEFAULT_RPM = deriveStressRpmFromConcurrency(VOICE_CLONE_STRESS_DEFAULT_CONCURRENCY);

const VOICE_CLONE_STRESS_DEFAULT_CONFIG: VoiceCloneStressConfig = {
  startRpm: VOICE_CLONE_STRESS_DEFAULT_RPM.startRpm,
  stepRpm: VOICE_CLONE_STRESS_DEFAULT_RPM.stepRpm,
  maxRpm: VOICE_CLONE_STRESS_DEFAULT_RPM.maxRpm,
  stepDurationSec: 15,
  concurrency: VOICE_CLONE_STRESS_DEFAULT_CONCURRENCY,
  maxFailureRate: 0.05,
  maxP95Ms: 20_000,
  warmupRequests: 2,
  requestTimeoutSec: 60,
};

const formatStressPercent = (value: number): string => {
  if (!Number.isFinite(value)) return '0.0%';
  return `${(value * 100).toFixed(1)}%`;
};

const formatStressNumber = (value: number, digits = 1): string => {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(digits);
};

const getStressStopReason = (status: VoiceCloneStressStatusResponse | null): string => {
  const summary = status?.summary && typeof status.summary === 'object'
    ? (status.summary as Record<string, unknown>)
    : null;
  const stopReason = String(summary?.stopReason || '').trim();
  if (stopReason) return stopReason;
  const statusToken = String(status?.status || '').trim().toLowerCase();
  return isVoiceCloneStressTerminalStatus(statusToken) ? 'Unknown' : '--';
};

interface VoiceCloneStressModalProps {
  isOpen: boolean;
  onClose: () => void;
  benchmarkTarget: VoiceCloneStressBenchmarkTarget;
  onBenchmarkTargetChange: (target: VoiceCloneStressBenchmarkTarget) => void;
  config: VoiceCloneStressConfig;
  onConfigChange: (config: VoiceCloneStressConfig) => void;
  referenceAudio: File | null;
  onReferenceAudioSelect: (files: File[]) => void;
  targetAudio: File | null;
  onTargetAudioSelect: (files: File[]) => void;
  geminiText: string;
  onGeminiTextChange: (value: string) => void;
  geminiVoiceName: string;
  onGeminiVoiceNameChange: (value: string) => void;
  status: VoiceCloneStressStatusResponse | null;
  isStarting: boolean;
  isCancelling: boolean;
  errorMessage: string;
  validationMessage: string;
  deviceLabel: string;
  backendLabel: string;
  onStart: () => void;
  onCancel: () => void;
}

const VoiceCloneStressModal: React.FC<VoiceCloneStressModalProps> = ({
  isOpen,
  onClose,
  benchmarkTarget,
  onBenchmarkTargetChange,
  config,
  onConfigChange,
  referenceAudio,
  onReferenceAudioSelect,
  targetAudio,
  onTargetAudioSelect,
  geminiText,
  onGeminiTextChange,
  geminiVoiceName,
  onGeminiVoiceNameChange,
  status,
  isStarting,
  isCancelling,
  errorMessage,
  validationMessage,
  deviceLabel,
  backendLabel,
  onStart,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const referenceAudioInputRef = useRef<HTMLInputElement | null>(null);
  const targetAudioInputRef = useRef<HTMLInputElement | null>(null);
  const isCloseLocked = isStarting || isCancelling;

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const raf = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const focusableSelector = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ');
      const firstFocusable = dialog
        ? (Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).find((element) => element.offsetParent !== null) ||
            closeButtonRef.current ||
            dialog)
        : null;
      firstFocusable?.focus();
    });

    return () => {
      window.cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      const previous = previouslyFocusedElementRef.current;
      if (previous && typeof previous.focus === 'function' && previous.isConnected) {
        previous.focus();
      }
      previouslyFocusedElementRef.current = null;
    };
  }, [isOpen]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isCloseLocked) {
        return;
      }
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');
    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (element) => element.offsetParent !== null
    );
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (!(firstElement instanceof HTMLElement) || !(lastElement instanceof HTMLElement)) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const activeElement = document.activeElement as HTMLElement | null;
    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }
    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  if (!isOpen) return null;

  const statusToken = String(status?.status || '').trim().toLowerCase();
  const isActive = isVoiceCloneStressActiveStatus(statusToken);
  const isTerminal = isVoiceCloneStressTerminalStatus(statusToken);
  const stepResults = Array.isArray(status?.steps) ? status.steps : [];
  const progress = status?.progress && typeof status.progress === 'object'
    ? status.progress
    : null;
  const progressStepsCompleted = Number(progress?.stepsCompleted || progress?.currentStep || 0);
  const progressTotalSteps = Number(progress?.totalSteps || 0);
  const progressPercent = progressTotalSteps > 0
    ? Math.max(0, Math.min(100, (progressStepsCompleted / progressTotalSteps) * 100))
    : 0;
  const summary = status?.summary && typeof status.summary === 'object'
    ? (status.summary as Record<string, unknown>)
    : null;
  const preflight = status?.runtimePreflight && typeof status.runtimePreflight === 'object'
    ? (status.runtimePreflight as Record<string, unknown>)
    : null;
  const hasPreflight = Boolean(preflight);
  const preflightReady = Boolean(preflight?.ready);
  const preflightDetail = String(preflight?.detail || '').trim();

  const handleConcurrencyChange = (rawValue: string): void => {
    const parsed = Number(rawValue || 0);
    const safeConcurrency = Math.max(1, Math.floor(Number.isFinite(parsed) ? parsed : 0));
    onConfigChange({
      ...config,
      concurrency: safeConcurrency,
      ...deriveStressRpmFromConcurrency(safeConcurrency),
    });
  };

  const inputClassName =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 px-4 py-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (isCloseLocked) return;
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-clone-stress-modal-title"
        aria-describedby="voice-clone-stress-modal-description"
        tabIndex={-1}
        className="w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
              <Gauge size={18} />
            </div>
            <div>
              <h2 id="voice-clone-stress-modal-title" className="text-lg font-semibold">
                Voice Cloning Stress Test
              </h2>
              <p id="voice-clone-stress-modal-description" className="mt-1 max-w-2xl text-sm text-slate-500">
                Admin-only benchmark runner.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            aria-label="Close stress test modal"
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => {
              if (isCloseLocked) return;
              onClose();
            }}
            disabled={isCloseLocked}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5 px-6 py-5">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={16} />
                Admin-only
              </div>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                No billing. No artifacts.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Benchmark target</span>
                <select
                  className={inputClassName}
                  value={benchmarkTarget}
                  onChange={(event) => onBenchmarkTargetChange(event.target.value as VoiceCloneStressBenchmarkTarget)}
                >
                  <option value="VOICE_CLONE_L4_VC">Voice Clone</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Runtime device</span>
                <input className={inputClassName} value={deviceLabel} readOnly />
              </label>
              <label className="block sm:col-span-3">
                <span className="mb-1 block text-xs font-medium text-slate-600">Backend</span>
                <input className={inputClassName} value={backendLabel} readOnly />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Start RPM</span>
                <input
                  className={inputClassName}
                  min={1}
                  step={1}
                  type="number"
                  value={config.startRpm}
                  readOnly
                  title="Auto-calculated from concurrency."
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Step RPM</span>
                <input
                  className={inputClassName}
                  min={1}
                  step={1}
                  type="number"
                  value={config.stepRpm}
                  readOnly
                  title="Auto-calculated from concurrency."
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Max RPM</span>
                <input
                  className={inputClassName}
                  min={1}
                  step={1}
                  type="number"
                  value={config.maxRpm}
                  readOnly
                  title="Auto-calculated from concurrency."
                />
              </label>
            </div>
            <p className="text-[11px] text-slate-500">
              Start/Step/Max RPM are auto-calculated from concurrency.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Step duration (sec)</span>
                <input
                  className={inputClassName}
                  min={5}
                  step={1}
                  type="number"
                  value={config.stepDurationSec}
                  onChange={(event) => onConfigChange({ ...config, stepDurationSec: Number(event.target.value || 0) })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Concurrency</span>
                <input
                  className={inputClassName}
                  min={1}
                  step={1}
                  type="number"
                  value={config.concurrency}
                  onChange={(event) => handleConcurrencyChange(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Warmup requests</span>
                <input
                  className={inputClassName}
                  min={0}
                  step={1}
                  type="number"
                  value={config.warmupRequests}
                  onChange={(event) => onConfigChange({ ...config, warmupRequests: Number(event.target.value || 0) })}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Max failure rate</span>
                <input
                  className={inputClassName}
                  min={0}
                  max={1}
                  step={0.01}
                  type="number"
                  value={config.maxFailureRate}
                  onChange={(event) => onConfigChange({ ...config, maxFailureRate: Number(event.target.value || 0) })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Max p95 (ms)</span>
                <input
                  className={inputClassName}
                  min={500}
                  step={100}
                  type="number"
                  value={config.maxP95Ms}
                  onChange={(event) => onConfigChange({ ...config, maxP95Ms: Number(event.target.value || 0) })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Request timeout (sec)</span>
                <input
                  className={inputClassName}
                  min={1}
                  step={1}
                  type="number"
                  value={config.requestTimeoutSec}
                  onChange={(event) => onConfigChange({ ...config, requestTimeoutSec: Number(event.target.value || 0) })}
                />
              </label>
            </div>

            {normalizeVoiceCloneStressTarget(benchmarkTarget) === 'VOICE_CLONE_L4_VC' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    <span>Reference audio</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{referenceAudio?.name || 'No reference file selected.'}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => referenceAudioInputRef.current?.click()}
                      disabled={isCloseLocked}
                    >
                      {referenceAudio ? 'Change file' : 'Choose file'}
                    </button>
                    {referenceAudio ? (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => onReferenceAudioSelect([])}
                        disabled={isCloseLocked}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    <span>Target audio</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{targetAudio?.name || 'No target file selected.'}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => targetAudioInputRef.current?.click()}
                      disabled={isCloseLocked}
                    >
                      {targetAudio ? 'Change file' : 'Choose file'}
                    </button>
                    {targetAudio ? (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => onTargetAudioSelect([])}
                        disabled={isCloseLocked}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
                <input
                  ref={referenceAudioInputRef}
                  className="hidden"
                  type="file"
                  accept="audio/*"
                  onChange={(event) => {
                    onReferenceAudioSelect(Array.from(event.target.files || []));
                    event.currentTarget.value = '';
                  }}
                />
                <input
                  ref={targetAudioInputRef}
                  className="hidden"
                  type="file"
                  accept="audio/*"
                  onChange={(event) => {
                    onTargetAudioSelect(Array.from(event.target.files || []));
                    event.currentTarget.value = '';
                  }}
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Gemini prompt text</span>
                  <textarea
                    className={`${inputClassName} min-h-28`}
                    value={geminiText}
                    onChange={(event) => onGeminiTextChange(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Gemini voice name</span>
                  <input
                    className={inputClassName}
                    value={geminiVoiceName}
                    onChange={(event) => onGeminiVoiceNameChange(event.target.value)}
                  />
                </label>
              </div>
            )}

            {validationMessage ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
                {validationMessage}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
                {errorMessage}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={onClose}
                  disabled={isCloseLocked}
                >
                  Close
                </Button>
                {isActive ? (
                  <Button
                    variant="danger"
                    type="button"
                    onClick={onCancel}
                    disabled={!status?.jobId || isStarting || isCancelling}
                    isLoading={isCancelling}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  type="button"
                  icon={<Play size={14} />}
                  onClick={onStart}
                  disabled={isStarting || isCancelling || Boolean(validationMessage)}
                  isLoading={isStarting}
                >
                  Start stress test
                </Button>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-6 py-5 lg:border-l lg:border-t-0">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Run status</div>
                    <div className="mt-1 text-xs text-slate-500">{status?.status || 'idle'}</div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      isTerminal
                        ? 'bg-emerald-50 text-emerald-700'
                        : isActive
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isTerminal ? 'Terminal' : isActive ? 'Running' : 'Idle'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="font-medium text-slate-500">Runtime device</div>
                    <div className="mt-1 text-slate-900">{deviceLabel}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="font-medium text-slate-500">Runtime ready</div>
                    <div className="mt-1 text-slate-900">
                      {hasPreflight ? (preflightReady ? 'Ready' : 'Not ready') : 'Not checked'}
                    </div>
                  </div>
                </div>
                {preflightDetail ? <p className="mt-3 text-xs text-slate-500">{preflightDetail}</p> : null}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Live progress</span>
                  <span>
                    {progressStepsCompleted}/{progressTotalSteps || '--'} steps
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="mt-2 text-xs font-medium text-slate-700">
                  {progressPercent.toFixed(0)}%
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs font-medium text-slate-500">Max sustainable RPM</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {formatStressNumber(Number(summary?.maxSustainableRpm || 0))}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs font-medium text-slate-500">Success rate</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {stepResults.length > 0
                      ? formatStressPercent(Number(stepResults[stepResults.length - 1]?.successRate || 0))
                      : '0.0%'}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs font-medium text-slate-500">P95 latency</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {stepResults.length > 0 ? `${Math.round(stepResults[stepResults.length - 1]?.p95Ms || 0)} ms` : '0 ms'}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-xs font-medium text-slate-500">Stop reason</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{getStressStopReason(status)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">Step history</div>
                <div className="mt-3 space-y-3">
                  {stepResults.length === 0 ? (
                    <p className="text-xs text-slate-500">No completed steps yet.</p>
                  ) : (
                    stepResults.slice(-6).map((step) => (
                      <div
                        key={`${step.step}-${step.targetRpm}`}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-900">Step {step.step}</div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              step.pass ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {step.pass ? 'Pass' : 'Fail'}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600 sm:grid-cols-4">
                          <div>Target: {step.targetRpm} RPM</div>
                          <div>Achieved: {formatStressNumber(step.achievedRpm)}</div>
                          <div>Success: {formatStressPercent(step.successRate)}</div>
                          <div>P95: {Math.round(step.p95Ms)} ms</div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600 sm:grid-cols-4">
                          <div>Requests: {step.requestCount}</div>
                          <div>Errors: {step.errorCount}</div>
                          <div>Duration: {Math.round(step.durationMs)} ms</div>
                          <div>GPU s: {formatStressNumber(step.gpuSecondsTotal || 0, 3)}</div>
                        </div>
                        {step.errorBuckets && Object.keys(step.errorBuckets).length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {Object.entries(step.errorBuckets).map(([key, value]) => (
                              <span
                                key={key}
                                className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600"
                              >
                                {key}: {value}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <RefreshCw size={14} className={isActive ? 'animate-spin text-indigo-600' : 'text-slate-400'} />
                {isActive ? 'Polling status every 2 seconds.' : 'Status polling stops when the job is terminal or the modal closes.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const VoiceCloningTabContent: React.FC<VoiceCloningTabContentProps> = ({
  backendBaseUrl,
  selectedEngine,
  voiceLibraryVoices = [],
  voicePreviewState = null,
  onPreviewVoice,
  layout = 'stacked',
  denseTabs = false,
  showRail = true,
  diagnosticsExpanded,
  onDiagnosticsExpandedChange,
}) => {
  const { user, clonedVoices, stats, refreshEntitlements } = useUser();
  const isWorkspaceLayout = layout === 'workspace';
  const shouldShowWorkspaceRail = isWorkspaceLayout && showRail;
  const isAdminVoiceCloneUser = Boolean(user?.isAdmin || user?.adminActor);
  const isPaidVoiceClonePlan = PAID_VOICE_CLONE_PLANS.has(String(stats?.planName || '').trim());
  const vcSpendableBalance = Math.max(0, Number(stats?.wallet?.vcSpendableBalance || 0));
  const [activeToolTab, setActiveToolTab] = useState<VoiceUtilityTab>('clone');
  const [referenceAudio, setReferenceAudio] = useState<File | null>(null);
  const [targetAudio, setTargetAudio] = useState<File | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [voiceCloneTask, setVoiceCloneTask] = useState<VoiceCloneTaskState | null>(null);
  const [isVoiceCloneCancelling, setIsVoiceCloneCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<CloningResultState | null>(null);
  const [activeCloneJob, setActiveCloneJob] = useState<VoiceCloneJobRuntimeState | null>(null);
  const persistedReferenceAudioRef = useRef<PersistedVoiceCloneFileRef | null>(null);
  const persistedTargetAudioRef = useRef<PersistedVoiceCloneFileRef | null>(null);
  const [persistedDraftRevision, setPersistedDraftRevision] = useState(0);
  const [isCloneWorkspaceHydrated, setIsCloneWorkspaceHydrated] = useState(false);
  const [sourceMixAudio, setSourceMixAudio] = useState<File | null>(null);
  const [sourceMixDurationSec, setSourceMixDurationSec] = useState(0);
  const [sourceTrimStartInput, setSourceTrimStartInput] = useState('0');
  const [sourceTrimEndInput, setSourceTrimEndInput] = useState('');
  const [sourceTrimErrorMessage, setSourceTrimErrorMessage] = useState('');
  const [isTrimmingSource, setIsTrimmingSource] = useState(false);
  const [trimmedSourceMix, setTrimmedSourceMix] = useState<TrimmedSourceMixState | null>(null);
  const [isExtractingStems, setIsExtractingStems] = useState(false);
  const [stemErrorMessage, setStemErrorMessage] = useState('');
  const [stemResult, setStemResult] = useState<StemExtractionResultState | null>(null);
  const [trimmedStemResult, setTrimmedStemResult] = useState<TrimmedStemExtractionResultState | null>(null);
  const [stemTrimStartInput, setStemTrimStartInput] = useState('0');
  const [stemTrimEndInput, setStemTrimEndInput] = useState('');
  const [isTrimmingStems, setIsTrimmingStems] = useState(false);
  const [stemTrimErrorMessage, setStemTrimErrorMessage] = useState('');
  const [isStressModalOpen, setIsStressModalOpen] = useState(false);
  const [stressBenchmarkTarget, setStressBenchmarkTarget] = useState<VoiceCloneStressBenchmarkTarget>('VOICE_CLONE_L4_VC');
  const [stressConfig, setStressConfig] = useState<VoiceCloneStressConfig>(VOICE_CLONE_STRESS_DEFAULT_CONFIG);
  const [stressGeminiText, setStressGeminiText] = useState(VOICE_CLONE_STRESS_DEFAULT_GEMINI_TEXT);
  const [stressGeminiVoiceName, setStressGeminiVoiceName] = useState('Fenrir');
  const [stressStatus, setStressStatus] = useState<VoiceCloneStressStatusResponse | null>(null);
  const [stressErrorMessage, setStressErrorMessage] = useState('');
  const [isStressStarting, setIsStressStarting] = useState(false);
  const [isStressCancelling, setIsStressCancelling] = useState(false);
  const [openVoiceStatus, setOpenVoiceStatus] = useState<VoiceCloneBenchmarkStatusResponse | null>(null);
  const [isLoadingOpenVoiceStatus, setIsLoadingOpenVoiceStatus] = useState(false);
  const [openVoiceStatusError, setOpenVoiceStatusError] = useState('');
  const [openVoiceStatusRetryDelayMs, setOpenVoiceStatusRetryDelayMs] = useState(VOICE_CLONE_STATUS_RETRY_INTERVAL_MS);
  const [cloneConsentAccepted, setCloneConsentAccepted] = useState(false);
  const [cloneSafetyAccepted, setCloneSafetyAccepted] = useState(false);
  const [isCloneConsentPersisted, setIsCloneConsentPersisted] = useState(false);
  const [localRuntimeDiagnosticsExpanded, setLocalRuntimeDiagnosticsExpanded] = useState(false);
  const [voiceLibrarySearch, setVoiceLibrarySearch] = useState('');
  const voiceCloneTaskControllerRef = useRef<AbortController | null>(null);
  const openVoiceStatusLastRefreshAtRef = useRef(Date.now());
  const openVoiceStatusRequestInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const cloneWorkspaceHydratingRef = useRef(false);
  const cloneJobRecoveryInFlightRef = useRef(false);
  const cloneRecoveryRestartedRequestsRef = useRef<Set<string>>(new Set());
  const cloneSubmitLockRef = useRef(false);
  const handledTerminalCloneRequestRef = useRef('');
  const stemExtractionInFlightRef = useRef<Set<string>>(new Set());
  const stemExtractionRunIdRef = useRef(0);
  const cloneConsentUserKey = useMemo(
    () => resolveVoiceCloneConsentUserKey(user),
    [user]
  );
  const cloneWorkspaceScopeKey = useMemo(
    () => `${cloneConsentUserKey}::voice-clone`,
    [cloneConsentUserKey]
  );

  const showRuntimeDiagnostics = diagnosticsExpanded ?? localRuntimeDiagnosticsExpanded;
  const setRuntimeDiagnosticsExpanded = onDiagnosticsExpandedChange || setLocalRuntimeDiagnosticsExpanded;
  const showRuntimeDiagnosticsUi = false;
  const getVoiceCloneAccessBlockMessage = useCallback((): string => {
    if (isAdminVoiceCloneUser) return '';
    if (!isPaidVoiceClonePlan) {
      return 'Voice cloning and Demucs separation require an active paid plan.';
    }
    if (vcSpendableBalance <= 0) {
      return 'VC balance is required before running voice cloning or Demucs separation.';
    }
    return '';
  }, [isAdminVoiceCloneUser, isPaidVoiceClonePlan, vcSpendableBalance]);

  useEffect(() => {
    const cloneRecoveryRestartedRequests = cloneRecoveryRestartedRequestsRef;
    const stemExtractionInFlight = stemExtractionInFlightRef;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cloneSubmitLockRef.current = false;
      voiceCloneTaskControllerRef.current?.abort();
      voiceCloneTaskControllerRef.current = null;
      cloneRecoveryRestartedRequests.current.clear();
      stemExtractionInFlight.current.clear();
    };
  }, []);

  const referencePreviewUrl = useFilePreviewUrl(referenceAudio);
  const targetPreviewUrl = useFilePreviewUrl(targetAudio);
  const sourceMixPreviewUrl = useFilePreviewUrl(sourceMixAudio);

  const voiceUtilityTabs = useManagedTabs<VoiceUtilityTab>({
    items: VOICE_UTILITY_TAB_ITEMS,
    activeId: activeToolTab,
    onChange: setActiveToolTab,
    label: 'Voice tools',
    idBase: 'voice-tools',
  });

  const isVoiceCloneRuntimeReady = Boolean(openVoiceStatus?.ready);
  const isActiveClonePending = Boolean(activeCloneJob && !isVoiceCloneJobTerminalStatus(activeCloneJob.status));
  const isVoiceCloneActionBusy = Boolean(voiceCloneTask) || isCloning || isExtractingStems || isVoiceCloneCancelling || isActiveClonePending || cloneSubmitLockRef.current;
  const canStartCloning = useMemo(
    () => Boolean(
      referenceAudio
      && targetAudio
      && !isVoiceCloneActionBusy
      && isVoiceCloneRuntimeReady
      && cloneConsentAccepted
      && cloneSafetyAccepted
    ),
    [cloneConsentAccepted, cloneSafetyAccepted, isVoiceCloneRuntimeReady, isVoiceCloneActionBusy, referenceAudio, targetAudio]
  );

  const canExtractStems = useMemo(
    () => Boolean(sourceMixAudio && !isVoiceCloneActionBusy),
    [isVoiceCloneActionBusy, sourceMixAudio]
  );
  const openVoiceProviderStatus = useMemo(
    () => getVoiceCloneProviderDisplayStatus(openVoiceStatus),
    [openVoiceStatus]
  );
  const shouldPrepareVoiceLibrary = activeToolTab === 'library';
  const voiceLibraryCatalog = useMemo(() => {
    if (!shouldPrepareVoiceLibrary) return [];
    const primaryCatalog = Array.isArray(voiceLibraryVoices) && voiceLibraryVoices.length > 0
      ? voiceLibraryVoices
      : clonedVoices;
    const dedup = new Map<string, VoiceOption>();
    for (const voice of primaryCatalog || []) {
      const voiceId = String(voice?.id || '').trim();
      if (!voiceId || dedup.has(voiceId)) continue;
      dedup.set(voiceId, voice);
    }
    return Array.from(dedup.values()).sort((a, b) =>
      String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''), undefined, { sensitivity: 'base' })
    );
  }, [clonedVoices, shouldPrepareVoiceLibrary, voiceLibraryVoices]);
  const deferredVoiceLibrarySearch = useDeferredValue(voiceLibrarySearch);
  const normalizedVoiceLibrarySearch = useMemo(
    () => String(deferredVoiceLibrarySearch || '').trim().toLowerCase(),
    [deferredVoiceLibrarySearch]
  );
  const filteredVoiceLibraryCatalog = useMemo(() => {
    if (!shouldPrepareVoiceLibrary) return [];
    if (!normalizedVoiceLibrarySearch) return voiceLibraryCatalog;
    return voiceLibraryCatalog.filter((voice) => {
      const searchable = [
        resolvePublicVoiceLabel(voice.name, voice.geminiVoiceName, voice.id) || voice.name || voice.id || '',
        voice.id,
        voice.geminiVoiceName,
        voice.gender,
        voice.accent,
        voice.country,
        voice.ageGroup,
        voice.engine || selectedEngine || '',
        voice.accessTier || '',
        voice.isCloned ? 'cloned' : '',
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return searchable.includes(normalizedVoiceLibrarySearch);
    });
  }, [normalizedVoiceLibrarySearch, selectedEngine, shouldPrepareVoiceLibrary, voiceLibraryCatalog]);
  const maleVoiceLibraryCatalog = useMemo(
    () => filteredVoiceLibraryCatalog.filter((voice) => String(voice.gender || '').trim().toLowerCase() === 'male'),
    [filteredVoiceLibraryCatalog]
  );
  const femaleVoiceLibraryCatalog = useMemo(
    () => filteredVoiceLibraryCatalog.filter((voice) => {
      const normalizedGender = String(voice.gender || '').trim().toLowerCase();
      return normalizedGender === 'female';
    }),
    [filteredVoiceLibraryCatalog]
  );
  const voiceLibraryAuditSummary = useMemo(() => {
    let freeCount = 0;
    let proCount = 0;
    let clonedCount = 0;
    for (const voice of filteredVoiceLibraryCatalog) {
      const tier = String(voice.accessTier || '').trim().toLowerCase();
      if (tier === 'pro' || voice.isPlanRestricted) {
        proCount += 1;
      } else {
        freeCount += 1;
      }
      if (voice.isCloned) clonedCount += 1;
    }
    return {
      totalCount: voiceLibraryCatalog.length,
      filteredCount: filteredVoiceLibraryCatalog.length,
      freeCount,
      proCount,
      clonedCount,
    };
  }, [filteredVoiceLibraryCatalog, voiceLibraryCatalog.length]);
  const sourceTrimValidationMessage = useMemo(() => {
    if (!sourceMixAudio || sourceMixDurationSec <= 0) return '';
    return validateTrimRange(sourceTrimStartInput, sourceTrimEndInput, sourceMixDurationSec);
  }, [sourceMixAudio, sourceMixDurationSec, sourceTrimEndInput, sourceTrimStartInput]);
  const canApplySourceTrim = Boolean(
    sourceMixAudio
    && sourceMixDurationSec > 0
    && !isTrimmingSource
    && !isVoiceCloneActionBusy
    && !sourceTrimValidationMessage
  );

  const activeStemResult = trimmedStemResult || stemResult;
  const stemTrimValidationMessage = useMemo(() => {
    if (!stemResult) return '';
    return validateTrimRange(stemTrimStartInput, stemTrimEndInput, stemResult.durationSec);
  }, [stemResult, stemTrimEndInput, stemTrimStartInput]);
  const canApplyStemTrim = Boolean(
    stemResult && !isTrimmingStems && !isVoiceCloneActionBusy && !stemTrimValidationMessage
  );
  const stressValidationMessage = useMemo(
    () => getStressValidationMessage(
      stressBenchmarkTarget,
      stressConfig,
      referenceAudio,
      targetAudio,
      stressGeminiText,
      stressGeminiVoiceName
    ),
    [referenceAudio, stressBenchmarkTarget, stressConfig, stressGeminiText, stressGeminiVoiceName, targetAudio]
  );
  const stressDeviceLabel = useMemo(
    () => getStressRuntimeDeviceLabel(stressStatus, stressBenchmarkTarget),
    [stressBenchmarkTarget, stressStatus]
  );
  const stressBackendLabel = useMemo(() => {
    const directBaseUrl = String(backendBaseUrl || '').trim();
    return directBaseUrl || 'Default Next.js API (/api/v1)';
  }, [backendBaseUrl]);
  const stressStatusToken = String(stressStatus?.status || '').trim().toLowerCase();
  const isStressRunning = isVoiceCloneStressActiveStatus(stressStatusToken);
  const isStressTerminal = isVoiceCloneStressTerminalStatus(stressStatusToken);
  const canSeeStressControls = useMemo(() => canViewVoiceCloneStressControls(user), [user]);
  const refreshVoiceCloneStatus = useCallback(async (showLoading = true): Promise<void> => {
    if (openVoiceStatusRequestInFlightRef.current) {
      return;
    }
    openVoiceStatusLastRefreshAtRef.current = Date.now();
    openVoiceStatusRequestInFlightRef.current = true;
    if (showLoading) {
      setIsLoadingOpenVoiceStatus(true);
    }
    try {
      const status = await fetchVoiceCloneStatus(
        backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
      );
      if (!mountedRef.current) {
        return;
      }
      setOpenVoiceStatus(status);
      setOpenVoiceStatusError('');
      setOpenVoiceStatusRetryDelayMs(resolveVoiceCloneStatusRetryDelayMs(status));
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setOpenVoiceStatus(null);
      setOpenVoiceStatusError(getErrorMessage(error));
      setOpenVoiceStatusRetryDelayMs(resolveVoiceCloneStatusRetryDelayMs(null, error));
    } finally {
      openVoiceStatusRequestInFlightRef.current = false;
      if (showLoading) {
        if (mountedRef.current) {
          setIsLoadingOpenVoiceStatus(false);
        }
      }
    }
  }, [backendBaseUrl]);

  useEffect(() => {
    const isPersisted = hasPersistedVoiceCloneConsent(cloneConsentUserKey);
    setIsCloneConsentPersisted(isPersisted);
    setCloneConsentAccepted(isPersisted);
    setCloneSafetyAccepted(isPersisted);
  }, [cloneConsentUserKey]);

  useEffect(() => {
    if (isCloneConsentPersisted || !cloneConsentAccepted || !cloneSafetyAccepted) return;
    void persistVoiceCloneConsentAcceptance(cloneConsentUserKey);
    setIsCloneConsentPersisted(true);
  }, [cloneConsentUserKey, cloneConsentAccepted, cloneSafetyAccepted, isCloneConsentPersisted]);

  useEffect(() => {
    let cancelled = false;
    cloneWorkspaceHydratingRef.current = true;
    setIsCloneWorkspaceHydrated(false);

    const draft = readVoiceCloneWorkspaceDraft(cloneWorkspaceScopeKey);
    if (!draft) {
      setReferenceAudio(null);
      setTargetAudio(null);
      persistedReferenceAudioRef.current = null;
      persistedTargetAudioRef.current = null;
      setPersistedDraftRevision((value) => value + 1);
      setResult(null);
      setErrorMessage('');
      setActiveCloneJob(null);
      handledTerminalCloneRequestRef.current = '';
      cloneWorkspaceHydratingRef.current = false;
      setIsCloneWorkspaceHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    void Promise.all([
      readVoiceCloneWorkspaceFile(draft.referenceAudio || null),
      readVoiceCloneWorkspaceFile(draft.targetAudio || null),
    ]).then(([referenceFile, targetFile]) => {
      if (cancelled) return;
      setReferenceAudio(referenceFile);
      setTargetAudio(targetFile);
      persistedReferenceAudioRef.current = draft.referenceAudio || null;
      persistedTargetAudioRef.current = draft.targetAudio || null;
      setPersistedDraftRevision((value) => value + 1);
      setResult((draft.result as CloningResultState | null) || null);
      setErrorMessage(String(draft.errorMessage || '').trim());
      setActiveCloneJob(normalizeVoiceCloneJobRuntimeState(draft.activeJob || null));
      handledTerminalCloneRequestRef.current = '';
    }).catch(() => {
      if (cancelled) return;
      setReferenceAudio(null);
      setTargetAudio(null);
      persistedReferenceAudioRef.current = null;
      persistedTargetAudioRef.current = null;
      setPersistedDraftRevision((value) => value + 1);
      setResult(null);
      setErrorMessage('');
      setActiveCloneJob(null);
    }).finally(() => {
      if (cancelled) return;
      cloneWorkspaceHydratingRef.current = false;
      setIsCloneWorkspaceHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [cloneWorkspaceScopeKey]);

  useEffect(() => {
    if (!isCloneWorkspaceHydrated || cloneWorkspaceHydratingRef.current) return;
    let cancelled = false;
    if (!referenceAudio) {
      const previousReferenceAudioRef = persistedReferenceAudioRef.current;
      void deleteVoiceCloneWorkspaceFile(previousReferenceAudioRef).catch(() => {
        // Best effort cleanup only.
      });
      persistedReferenceAudioRef.current = null;
      setPersistedDraftRevision((value) => value + 1);
      return () => {
        cancelled = true;
      };
    }
    void storeVoiceCloneWorkspaceFile(cloneWorkspaceScopeKey, 'reference', referenceAudio)
      .then((fileRef) => {
        if (!cancelled) {
          persistedReferenceAudioRef.current = fileRef;
          setPersistedDraftRevision((value) => value + 1);
        }
      })
      .catch(() => {
        if (!cancelled) {
          persistedReferenceAudioRef.current = null;
          setPersistedDraftRevision((value) => value + 1);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cloneWorkspaceScopeKey, isCloneWorkspaceHydrated, referenceAudio]);

  useEffect(() => {
    if (!isCloneWorkspaceHydrated || cloneWorkspaceHydratingRef.current) return;
    let cancelled = false;
    if (!targetAudio) {
      const previousTargetAudioRef = persistedTargetAudioRef.current;
      void deleteVoiceCloneWorkspaceFile(previousTargetAudioRef).catch(() => {
        // Best effort cleanup only.
      });
      persistedTargetAudioRef.current = null;
      setPersistedDraftRevision((value) => value + 1);
      return () => {
        cancelled = true;
      };
    }
    void storeVoiceCloneWorkspaceFile(cloneWorkspaceScopeKey, 'target', targetAudio)
      .then((fileRef) => {
        if (!cancelled) {
          persistedTargetAudioRef.current = fileRef;
          setPersistedDraftRevision((value) => value + 1);
        }
      })
      .catch(() => {
        if (!cancelled) {
          persistedTargetAudioRef.current = null;
          setPersistedDraftRevision((value) => value + 1);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cloneWorkspaceScopeKey, isCloneWorkspaceHydrated, targetAudio]);

  useEffect(() => {
    if (!isCloneWorkspaceHydrated || cloneWorkspaceHydratingRef.current) return;
    writeVoiceCloneWorkspaceDraft(cloneWorkspaceScopeKey, {
      referenceAudio: persistedReferenceAudioRef.current,
      targetAudio: persistedTargetAudioRef.current,
      result: toPersistedCloningResult(result),
      activeJob: activeCloneJob ? {
        requestId: activeCloneJob.requestId,
        ...(activeCloneJob.jobId ? { jobId: activeCloneJob.jobId } : {}),
        kind: activeCloneJob.kind,
        status: activeCloneJob.status,
      } : null,
      errorMessage,
    });
  }, [
    activeCloneJob,
    cloneWorkspaceScopeKey,
    errorMessage,
    isCloneWorkspaceHydrated,
    persistedDraftRevision,
    result,
  ]);

  const clearResult = useCallback(() => {
    setErrorMessage('');
    setResult(null);
  }, []);

  const clearStemResult = useCallback(() => {
    setStemErrorMessage('');
    setStemResult(null);
    setTrimmedStemResult(null);
    setStemTrimStartInput('0');
    setStemTrimEndInput('');
    setStemTrimErrorMessage('');
  }, []);

  const clearVoiceCloneTask = useCallback(() => {
    voiceCloneTaskControllerRef.current = null;
    setVoiceCloneTask(null);
    setIsVoiceCloneCancelling(false);
  }, []);

  const updateVoiceCloneTask = useCallback((nextStage: Partial<VoiceCloneTaskState>): void => {
    if (!mountedRef.current) return;
    setVoiceCloneTask((current) => {
      if (!current) return current;
      return {
        ...current,
        ...nextStage,
        progress: nextStage.progress === undefined ? current.progress : clampProgress(nextStage.progress),
      };
    });
  }, []);

  const startVoiceCloneTask = useCallback((
    kind: VoiceCloneTaskKind,
    progress: number,
    stage: string,
    detail: string
  ): AbortController => {
    voiceCloneTaskControllerRef.current?.abort();
    const controller = new AbortController();
    voiceCloneTaskControllerRef.current = controller;
    setIsVoiceCloneCancelling(false);
    setVoiceCloneTask(buildVoiceCloneTaskState(kind, progress, stage, detail));
    return controller;
  }, []);

  const cancelVoiceCloneTask = useCallback(() => {
    if (isVoiceCloneCancelling) return;
    const controller = voiceCloneTaskControllerRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    const runtimeJob = activeCloneJob;
    if (!runtimeJob) {
      if (!controller || controller.signal.aborted) return;
      setIsVoiceCloneCancelling(true);
      updateVoiceCloneTask({
        stage: 'Cancelling request...',
        detail: 'Stopping the active root request and clearing pending output.',
        progress: 95,
      });
      return;
    }

    setIsVoiceCloneCancelling(true);
    setVoiceCloneTask(buildVoiceCloneTaskState(
      'clone',
      95,
      'Cancelling request...',
      'Requesting backend cancellation and preserving reconnect-safe state.'
    ));

    const finishLocalCancel = (message: string, options?: { clearActiveJob?: boolean }): void => {
      if (!mountedRef.current) return;
      handledTerminalCloneRequestRef.current = '';
      if (options?.clearActiveJob ?? true) {
        setActiveCloneJob(null);
      }
      setIsCloning(false);
      clearVoiceCloneTask();
      setErrorMessage(message);
    };

    void (async () => {
      try {
        let safeJobId = String(runtimeJob.jobId || '').trim();
        if (!safeJobId) {
          const byRequest = await fetchVoiceCloneJobStatusByRequest(
            runtimeJob.requestId,
            backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
          );
          safeJobId = String(byRequest.jobId || '').trim();
        }
        if (!safeJobId) {
          finishLocalCancel('Cloning cancelled.');
          return;
        }
        const cancelled = await cancelVoiceCloneJob(
          safeJobId,
          backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
        );
        if (!mountedRef.current) return;
        handledTerminalCloneRequestRef.current = '';
        setErrorMessage('');
        setIsCloning(false);
        clearVoiceCloneTask();
        const nextRuntimeJob = mergeVoiceCloneRuntimeJobState(cancelled, runtimeJob);
        if (!nextRuntimeJob) {
          finishLocalCancel('Cloning cancelled.');
          return;
        }
        setActiveCloneJob(nextRuntimeJob);
      } catch (error) {
        if (isAbortError(error) || isVoiceCloneJobNotFoundError(error)) {
          finishLocalCancel('Cloning cancelled.');
          return;
        }
        if (isRetryableVoiceCloneConnectionError(error)) {
          if (!mountedRef.current) return;
          const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
          setIsCloning(true);
          setErrorMessage('Connection interrupted while sending cancel. Keeping the request active until backend confirmation.');
          setVoiceCloneTask(buildVoiceCloneTaskFromRuntimeJob(runtimeJob, isOnline));
          return;
        }
        finishLocalCancel(getErrorMessage(error));
      } finally {
        if (!mountedRef.current) return;
        setIsVoiceCloneCancelling(false);
      }
    })();
  }, [activeCloneJob, backendBaseUrl, clearVoiceCloneTask, isVoiceCloneCancelling, updateVoiceCloneTask]);

  const finalizeCloneJobSuccess = useCallback(async (job: VoiceCloneJobRuntimeState): Promise<void> => {
    const response = job.result;
    if (!response) {
      throw new Error('Voice clone job completed without a result payload.');
    }

    const contentType = String(response.artifact?.contentType || targetAudio?.type || referenceAudio?.type || 'audio/wav').trim() || 'audio/wav';
    const resolvedUrl = await resolveVoiceClonePlayableAudioUrlWithFallback(response, contentType, {
      ...(backendBaseUrl ? { backendBaseUrl } : {}),
    });
    setResult({
      previewUrl: resolvedUrl,
      downloadUrl: resolvedUrl,
      fileName: targetAudio?.name || 'voice-clone.wav',
      response,
      cloneMode: 'modal_vc',
    });
    await refreshEntitlements().catch(() => undefined);

    setErrorMessage('');
    setIsCloning(false);
    clearVoiceCloneTask();
    setActiveCloneJob(null);
  }, [backendBaseUrl, clearVoiceCloneTask, referenceAudio, refreshEntitlements, targetAudio]);

  const submitCloneJob = useCallback(async (
    requestId: string,
    signal?: AbortSignal
  ): Promise<VoiceCloneJobStatusResponse> => {
    if (!referenceAudio || !targetAudio) {
      throw new Error('Upload both reference audio and target audio before cloning.');
    }

    const referenceAudioBase64 = await referenceAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer));
    const targetAudioFile = targetAudio;
    if (!targetAudioFile) {
      throw new Error('Upload both reference audio and target audio before cloning.');
    }
    const [sourceAudioBase64, durationSec] = await Promise.all([
      targetAudioFile.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer)),
      measureAudioDurationSec(targetAudioFile),
    ]);
    const requestOptions = backendBaseUrl
      ? { baseUrl: backendBaseUrl, ...(signal ? { signal } : {}) }
      : (signal ? { signal } : undefined);
    return await startVoiceCloneRenderJob(
      {
        durationSec,
        language: 'EN',
        text: '',
        sourceVoiceId: '',
        sourceVoiceName: 'Voice cloning tab',
        sourceVoiceEngine: '',
        referenceAudioBase64,
        referenceAudioName: referenceAudio.name || 'reference-audio.wav',
        referenceAudioUrl: '',
        sourceAudioBase64,
        sourceAudioName: targetAudioFile.name || 'target-audio.wav',
        extractSourceVocals: true,
        sourceSeparationModel: 'htdemucs_ft',
        sourceSeparationDevice: 'gpu_preferred',
        speed: 1,
        requestId,
        traceId: requestId,
        regionHint: '',
        regionSource: 'frontend',
        costMultiplier: 1,
      },
      requestOptions
    );
  }, [backendBaseUrl, referenceAudio, targetAudio]);

  useEffect(() => {
    if (!activeCloneJob) return;
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    setVoiceCloneTask(buildVoiceCloneTaskFromRuntimeJob(activeCloneJob, isOnline));
    setIsCloning(isVoiceCloneJobReconnectPendingStatus(activeCloneJob.status));
    if (isVoiceCloneJobReconnectPendingStatus(activeCloneJob.status)) {
      setErrorMessage((current) => (/connection interrupted/i.test(current) ? current : ''));
    }
  }, [activeCloneJob]);

  useEffect(() => {
    if (!activeCloneJob || !isVoiceCloneJobTerminalStatus(activeCloneJob.status)) return;
    if (handledTerminalCloneRequestRef.current === activeCloneJob.requestId) return;
    handledTerminalCloneRequestRef.current = activeCloneJob.requestId;
    cloneRecoveryRestartedRequestsRef.current.delete(String(activeCloneJob.requestId || '').trim());
    if (String(activeCloneJob.status || '').trim().toLowerCase() === 'completed') {
      void finalizeCloneJobSuccess(activeCloneJob).catch((error) => {
        if (!mountedRef.current) return;
        setIsCloning(false);
        clearVoiceCloneTask();
        setActiveCloneJob(null);
        setErrorMessage(getErrorMessage(error));
      });
      return;
    }
    setIsCloning(false);
    clearVoiceCloneTask();
    setActiveCloneJob(null);
    setErrorMessage(getVoiceCloneJobFailureMessage(activeCloneJob));
  }, [activeCloneJob, clearVoiceCloneTask, finalizeCloneJobSuccess]);

  useEffect(() => {
    if (!isCloneWorkspaceHydrated || !activeCloneJob || isVoiceCloneJobTerminalStatus(activeCloneJob.status)) {
      return undefined;
    }

    let cancelled = false;
    const syncJob = async (): Promise<void> => {
      if (cancelled || cloneJobRecoveryInFlightRef.current) return;
      const requestId = String(activeCloneJob.requestId || '').trim();
      if (!requestId) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setVoiceCloneTask(buildVoiceCloneTaskFromRuntimeJob(activeCloneJob, false));
        return;
      }
      cloneJobRecoveryInFlightRef.current = true;
      const controller = new AbortController();
      voiceCloneTaskControllerRef.current = controller;
      try {
        const nextJob = activeCloneJob.jobId
          ? await fetchVoiceCloneJobStatus(
              activeCloneJob.jobId,
              backendBaseUrl ? { baseUrl: backendBaseUrl, signal: controller.signal } : { signal: controller.signal }
            )
          : await fetchVoiceCloneJobStatusByRequest(
              requestId,
              backendBaseUrl ? { baseUrl: backendBaseUrl, signal: controller.signal } : { signal: controller.signal }
            );
        if (cancelled) return;
        setErrorMessage('');
        setActiveCloneJob((current) => mergeVoiceCloneRuntimeJobState(nextJob, current || activeCloneJob));
      } catch (error) {
        if (cancelled || isAbortError(error)) {
          return;
        }
        if (
        isVoiceCloneJobNotFoundError(error)
        && referenceAudio
        && targetAudio
      ) {
          try {
            if (String(activeCloneJob.jobId || '').trim()) {
              const byRequestJob = await fetchVoiceCloneJobStatusByRequest(
                requestId,
                backendBaseUrl ? { baseUrl: backendBaseUrl, signal: controller.signal } : { signal: controller.signal }
              );
              if (cancelled) return;
              setErrorMessage('');
              setActiveCloneJob((current) => mergeVoiceCloneRuntimeJobState(byRequestJob, current || activeCloneJob));
              return;
            }
          } catch (lookupError) {
            if (cancelled || isAbortError(lookupError)) {
              return;
            }
            if (!isVoiceCloneJobNotFoundError(lookupError)) {
              if (isRetryableVoiceCloneConnectionError(lookupError)) {
                setErrorMessage('Connection interrupted. Your cached clone request will retry automatically.');
                return;
              }
              setIsCloning(false);
              clearVoiceCloneTask();
              setActiveCloneJob(null);
              setErrorMessage(getErrorMessage(lookupError));
              return;
            }
          }
          if (cloneRecoveryRestartedRequestsRef.current.has(requestId)) {
            setErrorMessage('Clone recovery is in progress. Waiting for provider status without creating duplicate jobs.');
            return;
          }
          cloneRecoveryRestartedRequestsRef.current.add(requestId);
          try {
            const restartedJob = await submitCloneJob(requestId, controller.signal);
            if (cancelled) return;
            setErrorMessage('');
            setActiveCloneJob((current) => mergeVoiceCloneRuntimeJobState(restartedJob, current || activeCloneJob));
            return;
          } catch (restartError) {
            if (cancelled || isAbortError(restartError)) {
              return;
            }
            if (isRetryableVoiceCloneConnectionError(restartError)) {
              setErrorMessage('Connection interrupted. Your cached clone request will retry automatically.');
              return;
            }
            setIsCloning(false);
            clearVoiceCloneTask();
            setActiveCloneJob(null);
            setErrorMessage(getErrorMessage(restartError));
            return;
          }
        }
        if (isRetryableVoiceCloneConnectionError(error)) {
          setErrorMessage('Connection interrupted. Your cached clone request will retry automatically.');
          return;
        }
        setIsCloning(false);
        clearVoiceCloneTask();
        setActiveCloneJob(null);
        setErrorMessage(getErrorMessage(error));
      } finally {
        cloneJobRecoveryInFlightRef.current = false;
        if (voiceCloneTaskControllerRef.current === controller) {
          voiceCloneTaskControllerRef.current = null;
        }
      }
    };

    void syncJob();
    const timer = window.setInterval(() => {
      void syncJob();
    }, VOICE_CLONE_JOB_POLL_INTERVAL_MS);
    const handleOnline = () => {
      void syncJob();
    };
    window.addEventListener('online', handleOnline);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('online', handleOnline);
    };
  }, [
    activeCloneJob,
    backendBaseUrl,
    clearVoiceCloneTask,
    isCloneWorkspaceHydrated,
    referenceAudio,
    submitCloneJob,
    targetAudio,
  ]);

  const openStressModal = useCallback(() => {
    if (!canSeeStressControls) {
      setStressErrorMessage('Admin access is required to run stress tests.');
      return;
    }
    setStressErrorMessage('');
    setIsStressModalOpen(true);
  }, [canSeeStressControls]);

  const closeStressModal = useCallback(() => {
    setIsStressModalOpen(false);
    setIsStressStarting(false);
    setIsStressCancelling(false);
  }, []);

  const handleStressStart = useCallback(async () => {
    if (!canSeeStressControls) {
      setStressErrorMessage('Admin access is required to run stress tests.');
      return;
    }
    const validationMessage = getStressValidationMessage(
      stressBenchmarkTarget,
      stressConfig,
      referenceAudio,
      targetAudio,
      stressGeminiText,
      stressGeminiVoiceName
    );
    if (validationMessage) {
      setStressErrorMessage(validationMessage);
      return;
    }

    setIsStressStarting(true);
    setStressErrorMessage('');

    try {
      const payload: VoiceCloneStressStartRequest = {
        benchmarkTarget: stressBenchmarkTarget,
        config: stressConfig,
      };

      if (normalizeVoiceCloneStressTarget(stressBenchmarkTarget) === 'VOICE_CLONE_L4_VC') {
        if (!referenceAudio || !targetAudio) {
          throw new Error('Both reference and target audio are required for the Modal VC stress benchmark.');
        }
        const targetAudioFile = targetAudio;
        const [referenceAudioBase64, sourceAudioBase64] = await Promise.all([
          referenceAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer)),
          targetAudioFile.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer)),
        ]);
        payload.referenceAudioBase64 = referenceAudioBase64;
        payload.referenceAudioName = referenceAudio.name || 'reference.wav';
        payload.sourceAudioBase64 = sourceAudioBase64;
        payload.sourceAudioName = targetAudioFile.name || 'target.wav';
      } else {
        payload.text = String(stressGeminiText || '').trim() || VOICE_CLONE_STRESS_DEFAULT_GEMINI_TEXT;
        payload.voiceName = String(stressGeminiVoiceName || '').trim() || 'Fenrir';
      }

      const response = await startVoiceCloneStressTest(
        payload,
        backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
      );
      setStressStatus(response);
    } catch (error) {
      setStressErrorMessage(mapVoiceCloneStressError(error));
    } finally {
      setIsStressStarting(false);
    }
  }, [
    backendBaseUrl,
    canSeeStressControls,
    referenceAudio,
    stressBenchmarkTarget,
    stressConfig,
    stressGeminiText,
    stressGeminiVoiceName,
    targetAudio,
  ]);

  const handleStressCancel = useCallback(async () => {
    if (!canSeeStressControls) {
      setStressErrorMessage('Admin access is required to run stress tests.');
      return;
    }
    const stressJobId = String(stressStatus?.jobId || '').trim();
    if (!stressJobId) return;
    setIsStressCancelling(true);
    setStressErrorMessage('');
    try {
      const response = await cancelVoiceCloneStressTest(
        stressJobId,
        backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
      );
      setStressStatus(response);
    } catch (error) {
      setStressErrorMessage(mapVoiceCloneStressError(error));
    } finally {
      setIsStressCancelling(false);
    }
  }, [backendBaseUrl, canSeeStressControls, stressStatus?.jobId]);

  useEffect(() => {
    if (canSeeStressControls) return;
    setIsStressModalOpen(false);
  }, [canSeeStressControls]);

  useEffect(() => {
    return () => {
      if (!stemResult) return;
      if (stemResult.vocalsPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(stemResult.vocalsPreviewUrl);
      }
      if (stemResult.backgroundPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(stemResult.backgroundPreviewUrl);
      }
    };
  }, [stemResult]);

  useEffect(() => {
    return () => {
      if (!trimmedStemResult) return;
      if (trimmedStemResult.vocalsPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(trimmedStemResult.vocalsPreviewUrl);
      }
      if (trimmedStemResult.backgroundPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(trimmedStemResult.backgroundPreviewUrl);
      }
    };
  }, [trimmedStemResult]);

  useEffect(() => {
    return () => {
      if (!trimmedSourceMix) return;
      if (trimmedSourceMix.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(trimmedSourceMix.previewUrl);
      }
    };
  }, [trimmedSourceMix]);

  useEffect(() => {
    void refreshVoiceCloneStatus(true);
  }, [refreshVoiceCloneStatus]);

  useEffect(() => {
    if (isVoiceCloneRuntimeReady) {
      return undefined;
    }
    if (openVoiceStatusRetryDelayMs <= 0) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (openVoiceStatusRequestInFlightRef.current) return;
      if (Date.now() - openVoiceStatusLastRefreshAtRef.current < openVoiceStatusRetryDelayMs) return;
      void refreshVoiceCloneStatus(false);
    }, openVoiceStatusRetryDelayMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [isVoiceCloneRuntimeReady, openVoiceStatusRetryDelayMs, refreshVoiceCloneStatus]);

  useEffect(() => {
    if (isVoiceCloneRuntimeReady) {
      return undefined;
    }

    const refreshOnVisibilityOrFocus = (): void => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      const eventRefreshCooldownMs = Math.max(openVoiceStatusRetryDelayMs, VOICE_CLONE_STATUS_EVENT_REFRESH_COOLDOWN_MS);
      if (Date.now() - openVoiceStatusLastRefreshAtRef.current < eventRefreshCooldownMs) {
        return;
      }
      if (openVoiceStatusRequestInFlightRef.current) {
        return;
      }
      void refreshVoiceCloneStatus(false);
    };

    window.addEventListener('focus', refreshOnVisibilityOrFocus);
    window.addEventListener('online', refreshOnVisibilityOrFocus);
    document.addEventListener('visibilitychange', refreshOnVisibilityOrFocus);

    return () => {
      window.removeEventListener('focus', refreshOnVisibilityOrFocus);
      window.removeEventListener('online', refreshOnVisibilityOrFocus);
      document.removeEventListener('visibilitychange', refreshOnVisibilityOrFocus);
    };
  }, [isVoiceCloneRuntimeReady, openVoiceStatusRetryDelayMs, refreshVoiceCloneStatus]);

  useEffect(() => {
    const stressJobId = String(stressStatus?.jobId || '').trim();
    if (!shouldPollVoiceCloneStressStatus(isStressModalOpen, stressStatus) || !stressJobId) {
      return undefined;
    }

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const nextStatus = await fetchVoiceCloneStressTestStatus(
          stressJobId,
          backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
        );
        if (cancelled) return;
        setStressStatus(nextStatus);
        setStressErrorMessage('');
        if (isVoiceCloneStressTerminalStatus(String(nextStatus.status || '').trim().toLowerCase())) {
          window.clearInterval(timer);
        }
      } catch (error) {
        if (!cancelled) {
          setStressErrorMessage(mapVoiceCloneStressError(error));
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backendBaseUrl, isStressModalOpen, stressStatus, stressStatusToken]);

  useEffect(() => {
    let cancelled = false;
    if (!sourceMixAudio) {
      setSourceMixDurationSec(0);
      setSourceTrimStartInput('0');
      setSourceTrimEndInput('');
      setSourceTrimErrorMessage('');
      setTrimmedSourceMix(null);
      return () => {
        cancelled = true;
      };
    }

    setSourceTrimStartInput('0');
    setSourceTrimEndInput('');
    setSourceTrimErrorMessage('');
    setTrimmedSourceMix(null);
    void measureAudioDurationSecPrecise(sourceMixAudio)
      .then((duration) => {
        if (cancelled) return;
        const safeDuration = Math.max(0.01, Number(duration || 0));
        setSourceMixDurationSec(safeDuration);
        setSourceTrimEndInput(formatTrimSeconds(safeDuration));
      })
      .catch(() => {
        if (cancelled) return;
        setSourceMixDurationSec(0);
        setSourceTrimEndInput('');
      });

    return () => {
      cancelled = true;
    };
  }, [sourceMixAudio]);

  useEffect(() => {
    if (!stemResult) {
      setStemTrimStartInput('0');
      setStemTrimEndInput('');
      setTrimmedStemResult(null);
      return;
    }

    setStemTrimStartInput('0');
    setStemTrimEndInput(formatTrimSeconds(stemResult.durationSec));
    setTrimmedStemResult(null);
    setStemTrimErrorMessage('');
  }, [stemResult]);

  const handleReferenceChange = useCallback((files: File[]) => {
    if (isVoiceCloneActionBusy) return;
    setReferenceAudio(files[0] || null);
    clearResult();
  }, [clearResult, isVoiceCloneActionBusy]);

  const handleTargetChange = useCallback((files: File[]) => {
    if (isVoiceCloneActionBusy) return;
    setTargetAudio(files[0] || null);
    clearResult();
  }, [clearResult, isVoiceCloneActionBusy]);

  const handleSourceMixChange = useCallback((files: File[]) => {
    if (isVoiceCloneActionBusy) return;
    setSourceMixAudio(files[0] || null);
    setSourceTrimErrorMessage('');
    setTrimmedSourceMix(null);
    clearStemResult();
  }, [clearStemResult, isVoiceCloneActionBusy]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cloneSubmitLockRef.current) return;
    cloneSubmitLockRef.current = true;
    if (isVoiceCloneActionBusy) {
      cloneSubmitLockRef.current = false;
      return;
    }
    if (!isVoiceCloneRuntimeReady) {
      setErrorMessage('Voice Clone runtime is not ready. Wait for readiness, then retry.');
      cloneSubmitLockRef.current = false;
      return;
    }
    if (!referenceAudio || !targetAudio) {
      setErrorMessage('Upload both reference audio and target audio before cloning.');
      cloneSubmitLockRef.current = false;
      return;
    }
    if (!cloneConsentAccepted || !cloneSafetyAccepted) {
      setErrorMessage('Confirm consent and responsible-use attestations before cloning.');
      cloneSubmitLockRef.current = false;
      return;
    }
    const accessBlockMessage = getVoiceCloneAccessBlockMessage();
    if (accessBlockMessage) {
      setErrorMessage(accessBlockMessage);
      cloneSubmitLockRef.current = false;
      return;
    }

    const requestId = makeRequestId();
    handledTerminalCloneRequestRef.current = '';
    setIsCloning(true);
    setErrorMessage('');
    setResult(null);
    setActiveCloneJob({
      requestId,
      kind: 'voice_clone',
      status: 'starting',
    });
    const controller = startVoiceCloneTask(
      'clone',
      8,
      'Validating input',
      'Checking the root request, consent, and runtime readiness.'
    );
    const ensureTaskActive = (): void => {
      if (controller.signal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
    };

    try {
      ensureTaskActive();
      updateVoiceCloneTask({
        progress: 16,
        stage: 'Preparing reconnect-safe request',
        detail: 'Encoding the current inputs so the backend can restore the clone after refresh or connection loss.',
      });
      const job = await submitCloneJob(requestId, controller.signal);
      ensureTaskActive();
      setErrorMessage('');
      setActiveCloneJob(
        normalizeVoiceCloneJobRuntimeState(job) || {
          requestId,
          ...(String(job.jobId || '').trim() ? { jobId: String(job.jobId || '').trim() } : {}),
          kind: 'voice_clone',
          status: String(job.status || '').trim() || 'queued',
        }
      );
    } catch (error) {
      if (!mountedRef.current) return;
      if (isAbortError(error)) {
        setActiveCloneJob(null);
        setIsCloning(false);
        clearVoiceCloneTask();
        setErrorMessage('Cloning cancelled.');
        return;
      }
      if (isRetryableVoiceCloneConnectionError(error)) {
        setErrorMessage('Connection interrupted. Your cached clone request will retry automatically.');
        return;
      }
      setActiveCloneJob(null);
      setIsCloning(false);
      clearVoiceCloneTask();
      setErrorMessage(getErrorMessage(error));
    } finally {
      cloneSubmitLockRef.current = false;
    }
  }, [
    clearVoiceCloneTask,
    cloneConsentAccepted,
    cloneSafetyAccepted,
    getVoiceCloneAccessBlockMessage,
    isVoiceCloneRuntimeReady,
    isVoiceCloneActionBusy,
    referenceAudio,
    startVoiceCloneTask,
    submitCloneJob,
    targetAudio,
    updateVoiceCloneTask,
  ]);

  const handleApplySourceTrim = useCallback(async () => {
    if (isVoiceCloneActionBusy) return;
    if (!sourceMixAudio) {
      setSourceTrimErrorMessage('Upload source mix audio before applying trim.');
      return;
    }

    const validationMessage = validateTrimRange(
      sourceTrimStartInput,
      sourceTrimEndInput,
      sourceMixDurationSec
    );
    if (validationMessage) {
      setSourceTrimErrorMessage(validationMessage);
      return;
    }

    const startSec = Number(sourceTrimStartInput);
    const endSec = Number(sourceTrimEndInput);
    if (isFullDurationTrimRange(startSec, endSec, sourceMixDurationSec)) {
      setTrimmedSourceMix((previous) => {
        if (previous?.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(previous.previewUrl);
        }
        return null;
      });
      setSourceTrimErrorMessage('');
      return;
    }
    setIsTrimmingSource(true);
    setSourceTrimErrorMessage('');
    try {
      const trimmedBlob = await trimAudioFileToBlob(sourceMixAudio, startSec, endSec);
      const trimmedPreviewUrl = URL.createObjectURL(trimmedBlob);
      setTrimmedSourceMix((previous) => {
        if (previous?.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(previous.previewUrl);
        }
        return {
          previewUrl: trimmedPreviewUrl,
          startSec: Math.max(0, startSec),
          endSec: Math.max(startSec, endSec),
        };
      });
    } catch (error) {
      setSourceTrimErrorMessage(getErrorMessage(error));
    } finally {
      setIsTrimmingSource(false);
    }
  }, [isVoiceCloneActionBusy, sourceMixAudio, sourceMixDurationSec, sourceTrimEndInput, sourceTrimStartInput]);

  const handleExtractStems = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    let extractionFingerprint = '';
    let extractionRunId = 0;
    event.preventDefault();
    if (isVoiceCloneActionBusy) return;
    if (!sourceMixAudio) {
      setStemErrorMessage('Upload a source mix before extracting voice and background stems.');
      return;
    }
    if (sourceTrimValidationMessage) {
      setStemErrorMessage(sourceTrimValidationMessage);
      return;
    }

    try {
      const sourceTrimStartSec = Number(sourceTrimStartInput);
      const sourceTrimEndSec = Number(sourceTrimEndInput);
      const hasExplicitSourceTrim = sourceMixDurationSec > 0 && !isFullDurationTrimRange(
        sourceTrimStartSec,
        sourceTrimEndSec,
        sourceMixDurationSec
      );
      const matchesAppliedTrim = Boolean(
        trimmedSourceMix
        && Math.abs(trimmedSourceMix.startSec - sourceTrimStartSec) <= TRIM_DURATION_EPSILON
        && Math.abs(trimmedSourceMix.endSec - sourceTrimEndSec) <= TRIM_DURATION_EPSILON
      );
      if (hasExplicitSourceTrim && !matchesAppliedTrim) {
        setStemErrorMessage('Click "Apply source trim" before extraction to use this source trim range.');
        return;
      }
      const accessBlockMessage = getVoiceCloneAccessBlockMessage();
      if (accessBlockMessage) {
        setStemErrorMessage(accessBlockMessage);
        return;
      }

      if (sourceMixAudio.size > MAX_STEM_EXTRACTION_SOURCE_BYTES) {
        throw new Error(
          `Source upload is ${formatBytes(sourceMixAudio.size)}. Compress the source mix or choose a shorter clip so the compressed upload stays under ${formatBytes(MAX_STEM_EXTRACTION_SOURCE_BYTES)}.`
        );
      }
      const appliedTrimStart = hasExplicitSourceTrim && matchesAppliedTrim ? sourceTrimStartSec : 0;
      const appliedTrimEnd = hasExplicitSourceTrim && matchesAppliedTrim
        ? sourceTrimEndSec
        : Math.max(0, sourceMixDurationSec);
      extractionFingerprint = [
        sourceMixAudio.name,
        sourceMixAudio.size,
        sourceMixAudio.lastModified,
        appliedTrimStart.toFixed(3),
        appliedTrimEnd.toFixed(3),
      ].join(':');
      if (stemExtractionInFlightRef.current.has(extractionFingerprint)) {
        return;
      }
      stemExtractionInFlightRef.current.add(extractionFingerprint);
      extractionRunId = stemExtractionRunIdRef.current + 1;
      stemExtractionRunIdRef.current = extractionRunId;

      setIsExtractingStems(true);
      setStemErrorMessage('');
      setStemResult(null);
      const controller = startVoiceCloneTask(
        'separate',
        10,
        'Validating source mix',
        'Preparing the trimmed source mix and root extraction request.'
      );
      const ensureTaskActive = (): void => {
        if (controller.signal.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
      };

      const requestId = makeRequestId();
      updateVoiceCloneTask({
        progress: 24,
        stage: 'Encoding source mix',
        detail: 'Compressing the mix before sending it to Demucs.',
      });
      const trimRange = hasExplicitSourceTrim && matchesAppliedTrim
        ? {
            startSec: sourceTrimStartSec,
            endSec: sourceTrimEndSec,
          }
        : null;
      const stemRequest = await buildVoiceCloneStemSeparationRequest({
        sourceAudio: sourceMixAudio,
        requestId,
        sourceSeparationModel: 'htdemucs_ft',
        sourceSeparationDevice: 'gpu_preferred',
        trimRange,
      });
      ensureTaskActive();
      updateVoiceCloneTask({
        progress: 48,
        stage: 'Submitting root request',
        detail: 'Waiting for the backend to separate vocals and background.',
      });
      const response = await separateVoiceAndBackgroundWithDemucs(
        stemRequest,
        backendBaseUrl ? { baseUrl: backendBaseUrl, signal: controller.signal } : { signal: controller.signal }
      );
      ensureTaskActive();
      updateVoiceCloneTask({
        progress: 80,
        stage: 'Resolving output previews',
        detail: 'Preparing the vocals and background players.',
      });
      const [vocalsUrl, backgroundUrl] = await Promise.all([
        resolveVoiceClonePlayableAudioUrlWithFallback(
          response.vocalsArtifact?.downloadUrl
            ? { artifact: { downloadUrl: response.vocalsArtifact.downloadUrl } }
            : null,
          String(response.vocalsArtifact?.contentType || 'audio/wav').trim() || 'audio/wav',
          backendBaseUrl ? { backendBaseUrl, signal: controller.signal } : { signal: controller.signal }
        ),
        resolveVoiceClonePlayableAudioUrlWithFallback(
          response.backgroundArtifact?.downloadUrl
            ? { artifact: { downloadUrl: response.backgroundArtifact.downloadUrl } }
            : null,
          String(response.backgroundArtifact?.contentType || 'audio/wav').trim() || 'audio/wav',
          backendBaseUrl ? { backendBaseUrl, signal: controller.signal } : { signal: controller.signal }
        ),
      ]);
      ensureTaskActive();
      if (!vocalsUrl || !backgroundUrl) {
        throw new Error('Demucs separation completed but no download artifacts were returned.');
      }
      updateVoiceCloneTask({
        progress: 92,
        stage: 'Finalizing stems',
        detail: 'Measuring duration and preparing the output cards.',
      });
      const durationSecFromRuntime = Number(response.runtime?.sourceSeparation?.durationSec || 0);
      const fallbackDurationSec = (hasExplicitSourceTrim && matchesAppliedTrim)
        ? Math.max(0.01, sourceTrimEndSec - sourceTrimStartSec)
        : await measureAudioDurationSecPrecise(sourceMixAudio);
      ensureTaskActive();
      const durationSec = durationSecFromRuntime > 0
        ? durationSecFromRuntime
        : fallbackDurationSec;
      const consumedVcUnits = Math.max(
        0,
        Number(response.consumedVcUnits ?? response.vcBilling?.consumedUnits ?? 0)
      );
      const runtimeRateVcPerMin = Math.max(0.000001, Number(response.vcBilling?.rateVcUnitsPerMin || 1));
      const runtimeRateInrPerMin = Math.max(0, Number(response.vcBilling?.rateInrPerMin || 1));
      const inferredChargedInr = consumedVcUnits > 0
        ? (consumedVcUnits / runtimeRateVcPerMin) * runtimeRateInrPerMin
        : 0;
      const chargedInrFromResponse = Number(response.vcBilling?.chargedInr);
      const chargedInr = Math.max(
        0,
        Number.isFinite(chargedInrFromResponse) && chargedInrFromResponse > 0
          ? chargedInrFromResponse
          : inferredChargedInr
      );
      if (extractionRunId !== stemExtractionRunIdRef.current) {
        return;
      }
      const sourceBaseName = toStemFallbackBaseName(sourceMixAudio.name);
      setStemResult({
        vocalsPreviewUrl: vocalsUrl,
        vocalsDownloadUrl: vocalsUrl,
        vocalsFileName: deriveStemFileName(
          response.vocalsArtifact?.fileName,
          `${sourceBaseName}_vocals.wav`
        ),
        backgroundPreviewUrl: backgroundUrl,
        backgroundDownloadUrl: backgroundUrl,
        backgroundFileName: deriveStemFileName(
          response.backgroundArtifact?.fileName,
          `${sourceBaseName}_background.wav`
        ),
        durationSec,
        consumedVcUnits,
        chargedInr,
      });
      setTrimmedStemResult(null);
      void refreshEntitlements().catch(() => undefined);
    } catch (error) {
      if (!mountedRef.current) return;
      if (extractionRunId > 0 && extractionRunId !== stemExtractionRunIdRef.current) {
        return;
      }
      if (isAbortError(error)) {
        setStemErrorMessage('Stem extraction cancelled.');
      } else {
        setStemErrorMessage(getErrorMessage(error));
      }
    } finally {
      if (extractionFingerprint) {
        stemExtractionInFlightRef.current.delete(extractionFingerprint);
      }
      if (!mountedRef.current) return;
      if (extractionRunId === 0 || extractionRunId === stemExtractionRunIdRef.current) {
        setIsExtractingStems(false);
        clearVoiceCloneTask();
      }
    }
  }, [
    backendBaseUrl,
    clearVoiceCloneTask,
    getVoiceCloneAccessBlockMessage,
    isVoiceCloneActionBusy,
    refreshEntitlements,
    sourceMixAudio,
    sourceMixDurationSec,
    sourceTrimEndInput,
    sourceTrimStartInput,
    sourceTrimValidationMessage,
    startVoiceCloneTask,
    trimmedSourceMix,
    updateVoiceCloneTask,
  ]);

  const handleApplyStemTrim = useCallback(async () => {
    if (isVoiceCloneActionBusy) return;
    if (!stemResult) {
      setStemTrimErrorMessage('Extract stems before applying trim.');
      return;
    }

    const validationMessage = validateTrimRange(
      stemTrimStartInput,
      stemTrimEndInput,
      stemResult.durationSec
    );
    if (validationMessage) {
      setStemTrimErrorMessage(validationMessage);
      return;
    }

    const startSec = Number(stemTrimStartInput);
    const endSec = Number(stemTrimEndInput);

    setIsTrimmingStems(true);
    setStemTrimErrorMessage('');

    try {
      const [vocalsBlob, backgroundBlob] = await Promise.all([
        trimAudioUrlToBlob(stemResult.vocalsDownloadUrl, startSec, endSec),
        trimAudioUrlToBlob(stemResult.backgroundDownloadUrl, startSec, endSec),
      ]);
      const vocalsTrimmedUrl = URL.createObjectURL(vocalsBlob);
      const backgroundTrimmedUrl = URL.createObjectURL(backgroundBlob);
      const trimmedFileNameStart = Math.max(0, startSec);
      const trimmedFileNameEnd = Math.max(trimmedFileNameStart, endSec);

      setTrimmedStemResult({
        vocalsPreviewUrl: vocalsTrimmedUrl,
        vocalsDownloadUrl: vocalsTrimmedUrl,
        vocalsFileName: buildTrimmedStemFileName(
          stemResult.vocalsFileName,
          trimmedFileNameStart,
          trimmedFileNameEnd
        ),
        backgroundPreviewUrl: backgroundTrimmedUrl,
        backgroundDownloadUrl: backgroundTrimmedUrl,
        backgroundFileName: buildTrimmedStemFileName(
          stemResult.backgroundFileName,
          trimmedFileNameStart,
          trimmedFileNameEnd
        ),
        startSec: trimmedFileNameStart,
        endSec: trimmedFileNameEnd,
      });
    } catch (error) {
      setStemTrimErrorMessage(getErrorMessage(error));
    } finally {
      setIsTrimmingStems(false);
    }
  }, [isVoiceCloneActionBusy, stemResult, stemTrimEndInput, stemTrimStartInput]);

  const workspaceResultSummary = useMemo(() => {
    if (voiceCloneTask) {
      return {
        title: voiceCloneTask.title,
        detail: voiceCloneTask.detail,
        status: `${Math.round(voiceCloneTask.progress)}%`,
      };
    }

    if (activeToolTab === 'library') {
      if (voiceLibraryAuditSummary.totalCount <= 0) {
        return {
          title: 'Waiting for voice catalog',
          detail: 'Voice options will appear here after the current engine catalog loads.',
          status: String(selectedEngine || 'Library').trim() || 'Library',
        };
      }
      return {
        title: 'Voice library ready',
        detail: `${voiceLibraryAuditSummary.filteredCount} voices visible (${voiceLibraryAuditSummary.freeCount} free, ${voiceLibraryAuditSummary.proCount} pro, ${voiceLibraryAuditSummary.clonedCount} cloned).`,
        status: `${voiceLibraryAuditSummary.filteredCount}/${voiceLibraryAuditSummary.totalCount}`,
      };
    }

    if (activeToolTab === 'clone') {
      if (!result) {
        return {
          title: 'Waiting for source files',
          detail: 'Upload reference and target audio to create a converted preview.',
          status: openVoiceProviderStatus.readyLabel,
        };
      }
      return {
        title: 'Clone ready',
        detail: 'Converted audio is ready to preview and download.',
        status: String(result.response.status || 'Ready').trim() || 'Ready',
      };
    }

    if (!stemResult) {
      return {
        title: 'Waiting for source mix',
        detail: 'Upload a mixed track, optionally trim the range, then extract vocals and background.',
        status: 'Demucs',
      };
    }

    return {
      title: 'Extraction ready',
      detail: `Processed duration ${formatDuration(stemResult.durationSec)}.`,
      status: 'Ready',
    };
  }, [
    activeToolTab,
    openVoiceProviderStatus.readyLabel,
    result,
    selectedEngine,
    stemResult,
    voiceCloneTask,
    voiceLibraryAuditSummary,
  ]);

  const cloneTabStatusTone: VoiceUtilityTabStatusTone =
    (!isVoiceCloneRuntimeReady)
      ? 'down'
      : canStartCloning
        ? 'usable'
        : 'ready';

  const separateTabStatusTone: VoiceUtilityTabStatusTone =
    canExtractStems
      ? 'usable'
      : 'ready';

  return (
    <div
      className={`${isWorkspaceLayout ? `vf-voice-clone-layout ${shouldShowWorkspaceRail ? '' : 'vf-voice-clone-layout--single'}`.trim() : 'space-y-2.5 sm:space-y-3'} vf-voice-clone-shell`.trim()}
      data-voice-clone-layout={isWorkspaceLayout ? 'workspace' : 'stacked'}
    >
      <div className={isWorkspaceLayout ? 'vf-voice-clone-main space-y-3' : 'vf-voice-clone-main space-y-2.5 sm:space-y-3'}>
      <SectionCard className="p-2.5 sm:p-3.5">
        <div className="flex items-start gap-2 sm:gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-indigo-500 to-fuchsia-500 text-white shadow-[0_18px_40px_rgba(99,102,241,0.28)] ring-1 ring-white/10 sm:h-10 sm:w-10 sm:rounded-[1rem]">
            {activeToolTab === 'clone'
              ? <Mic2 size={17} />
              : activeToolTab === 'separate'
                ? <Music2 size={17} />
                : <LibraryBig size={17} />}
          </div>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-slate-900 sm:text-[15px]">
              {activeToolTab === 'clone'
                ? 'Voice Cloning'
                : activeToolTab === 'separate'
                  ? 'Extract Voice + BG Music'
                  : 'Voice Libraries'}
            </h2>
            {activeToolTab === 'separate' ? (
              <p className="mt-0.5 max-w-2xl text-[10px] leading-4 text-slate-600 sm:text-[11px] sm:leading-5">
                Upload one mixed track to split out a speech-focused voice stem and a background-music stem.
              </p>
            ) : activeToolTab === 'library' ? (
              <p className="mt-0.5 max-w-2xl text-[10px] leading-4 text-slate-600 sm:text-[11px] sm:leading-5">
                Audit every available voice option for the active engine, including tier and clone metadata.
              </p>
            ) : null}
          </div>
        </div>

        <div className={`rounded-xl border border-slate-200 bg-slate-50 p-0.5 sm:rounded-2xl ${denseTabs ? 'mt-1.5 sm:mt-2' : 'mt-2 sm:mt-2.5 sm:p-1'}`}>
          <div className={denseTabs ? 'vf-scrollbar-invisible flex flex-nowrap gap-1 overflow-x-auto pb-0.5' : 'grid grid-cols-3 gap-0.5 sm:gap-1'} {...voiceUtilityTabs.listProps}>
            <button
              type="button"
              {...voiceUtilityTabs.getTabProps('clone')}
              className={`${denseTabs ? 'shrink-0 min-w-[8.6rem] rounded-lg px-2 py-1.5' : 'rounded-lg px-2 py-1.5 sm:rounded-xl sm:px-3 sm:py-2'} text-left transition ${
                activeToolTab === 'clone'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <span className={`${denseTabs ? 'text-[11px]' : 'text-[12px] sm:text-sm'} inline-flex items-center gap-1.5 font-semibold`}>
                <span className={`h-1.5 w-1.5 rounded-full ${getVoiceUtilityTabDotClass(cloneTabStatusTone)}`} aria-hidden="true" />
                <span>Voice Cloning</span>
                <span className="sr-only">{getVoiceUtilityTabStatusLabel(cloneTabStatusTone)}</span>
              </span>
              <span className={`${denseTabs ? 'hidden' : 'mt-0.5 block text-[10px] text-slate-500 sm:text-[11px]'}`}>
                Reference + target conversion
              </span>
            </button>
            <button
              type="button"
              {...voiceUtilityTabs.getTabProps('separate')}
              className={`${denseTabs ? 'shrink-0 min-w-[8.6rem] rounded-lg px-2 py-1.5' : 'rounded-lg px-2 py-1.5 sm:rounded-xl sm:px-3 sm:py-2'} text-left transition ${
                activeToolTab === 'separate'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <span className={`${denseTabs ? 'text-[11px]' : 'text-[12px] sm:text-sm'} inline-flex items-center gap-1.5 font-semibold`}>
                <span className={`h-1.5 w-1.5 rounded-full ${getVoiceUtilityTabDotClass(separateTabStatusTone)}`} aria-hidden="true" />
                <span>Extract Voice + BG</span>
                <span className="sr-only">{getVoiceUtilityTabStatusLabel(separateTabStatusTone)}</span>
              </span>
              <span className={`${denseTabs ? 'hidden' : 'mt-0.5 block text-[10px] text-slate-500 sm:text-[11px]'}`}>
                Split vocals and background
              </span>
            </button>
            <button
              type="button"
              {...voiceUtilityTabs.getTabProps('library')}
              className={`${denseTabs ? 'shrink-0 min-w-[8.6rem] rounded-lg px-2 py-1.5' : 'rounded-lg px-2 py-1.5 sm:rounded-xl sm:px-3 sm:py-2'} text-left transition ${
                activeToolTab === 'library'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <span className={`${denseTabs ? 'text-[11px]' : 'text-[12px] sm:text-sm'} block font-semibold`}>Voice Libraries</span>
              <span className={`${denseTabs ? 'hidden' : 'mt-0.5 block text-[10px] text-slate-500 sm:text-[11px]'}`}>
                All voices
              </span>
            </button>
          </div>
        </div>

        {activeToolTab === 'clone' ? (
        <div
          className={`mt-2.5 space-y-2.5 sm:mt-3 sm:space-y-3 ${isWorkspaceLayout ? 'pb-28 sm:pb-32' : ''}`}
          {...voiceUtilityTabs.getPanelProps('clone')}
        >
          <div className="grid gap-1.5 sm:gap-2 lg:grid-cols-2">
              <UploadDropzone
                accept="audio/*"
                file={referenceAudio}
                label="Drop reference audio"
                hint="This voice will be used as the cloning reference."
              className="px-2 py-2 sm:px-3 sm:py-3"
              disabled={isVoiceCloneActionBusy}
              onFilesSelected={handleReferenceChange}
            />
            <UploadDropzone
              accept="audio/*"
              file={targetAudio}
              label="Drop target audio"
              hint="This clip will be converted to match the reference voice."
              className="px-2 py-2 sm:px-3 sm:py-3"
              disabled={isVoiceCloneActionBusy}
              onFilesSelected={handleTargetChange}
            />
          </div>

          <div className="grid gap-1.5 sm:gap-2 sm:grid-cols-2">
            <VoiceClonePreviewPlayer
              label="Reference audio"
              name={referenceAudio?.name || 'Not selected'}
              meta={formatFileSize(referenceAudio)}
              previewUrl={referencePreviewUrl}
              fallback="Upload a reference clip to preview it here."
              tone="source"
            />
            <VoiceClonePreviewPlayer
              label="Target audio"
              name={targetAudio?.name || 'Not selected'}
              meta={formatFileSize(targetAudio)}
              previewUrl={targetPreviewUrl}
              fallback="Upload a target clip to preview it here."
              tone="source"
            />
          </div>

          {showRuntimeDiagnosticsUi ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[10px] leading-4 text-slate-800 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-xs sm:leading-5">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setRuntimeDiagnosticsExpanded(!showRuntimeDiagnostics)}
              aria-expanded={showRuntimeDiagnostics}
            >
              <div>
                <div className="text-[9px] uppercase tracking-wide text-slate-500 sm:text-[10px]">Runtime diagnostics</div>
                <div className="mt-0.5 text-[12px] font-semibold text-slate-900 sm:text-[13px]">
                  {isLoadingOpenVoiceStatus ? 'Checking availability...' : openVoiceProviderStatus.readyLabel}
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 sm:text-[11px]">
                {showRuntimeDiagnostics ? 'Hide details' : 'Show details'}
                {showRuntimeDiagnostics ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>

            {showRuntimeDiagnostics ? (
              <div className="mt-2.5 space-y-2">
                <div className="grid gap-1.5 text-[10px] text-slate-700 sm:grid-cols-3 sm:text-[11px]">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 sm:text-[11px]">Provider</div>
                    <div className="mt-0.5 font-semibold text-slate-900">
                      {isLoadingOpenVoiceStatus ? 'Loading...' : openVoiceProviderStatus.activeProviderLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 sm:text-[11px]">Readiness</div>
                    <div className="mt-0.5 font-semibold text-slate-900">{openVoiceProviderStatus.readyLabel}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 sm:text-[11px]">Device</div>
                    <div className="mt-0.5 font-semibold text-slate-900">{openVoiceProviderStatus.device}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<RefreshCw size={14} className={isLoadingOpenVoiceStatus ? 'animate-spin' : ''} />}
                    disabled={isLoadingOpenVoiceStatus}
                    onClick={() => {
                      void refreshVoiceCloneStatus(true);
                    }}
                  >
                    {isLoadingOpenVoiceStatus ? 'Checking Availability...' : 'Check Availability'}
                  </Button>
                  {!isVoiceCloneRuntimeReady ? (
                    <span className="text-[10px] text-slate-500 sm:text-[11px]">
                      Availability checks auto-retry every {formatVoiceCloneStatusRetryDelayLabel(openVoiceStatusRetryDelayMs)} while the provider is not ready.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
          ) : null}

          {showRuntimeDiagnosticsUi && openVoiceStatusError ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[10px] leading-4 text-gray-700 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm sm:leading-5">
              {openVoiceStatusError}
            </div>
          ) : null}

          {!isCloneConsentPersisted ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[10px] leading-4 text-gray-800 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-xs sm:leading-5">
              <p className="font-semibold text-gray-900">Voice-cloning safety and consent</p>
              <p className="mt-1 leading-4 text-gray-700 sm:hidden">
                Confirm you own this voice and have permission to clone or convert it. Non-consensual use is prohibited.
              </p>
              <div className="hidden sm:block">
                <p className="mt-1 leading-6 text-gray-700">
                  You must have explicit consent and legal rights to clone or convert this voice. Impersonation, fraud, and non-consensual cloning are prohibited.
                </p>
                <p className="mt-1 leading-6 text-gray-700">
                  Uploaded references are used for processing and artifact generation. Delete generated artifacts from your runs/history when no longer needed.
                </p>
                <p className="mt-1 leading-6 text-gray-700">
                  If a misuse incident occurs, escalate through admin moderation and disable the offending voice immediately.
                </p>
              </div>
              <div className="mt-2 grid gap-1.5 sm:mt-3 sm:grid-cols-2 sm:gap-2">
                <label
                  className={`group relative flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition sm:min-h-11 sm:gap-3 sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm ${
                    cloneConsentAccepted
                      ? 'border-cyan-400/55 bg-cyan-500/10 text-slate-100 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]'
                      : 'border-white/10 bg-white/[0.03] text-slate-200 hover:border-cyan-400/35 hover:bg-white/[0.06]'
                  }`}
                >
                  <input
                    checked={cloneConsentAccepted}
                    onChange={(event) => setCloneConsentAccepted(event.target.checked)}
                    type="checkbox"
                    className="peer absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0"
                  />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition sm:h-6 sm:w-6 ${
                      cloneConsentAccepted
                        ? 'border-cyan-400 bg-cyan-400 text-slate-950 shadow-[0_0_0_1px_rgba(34,211,238,0.24)]'
                        : 'border-white/15 bg-slate-950/65 text-transparent group-hover:border-cyan-400/55'
                    }`}
                  >
                    <CheckCircle2 size={12} className={cloneConsentAccepted ? '' : 'opacity-0'} />
                  </span>
                  <span className="pointer-events-none relative z-10 pt-0.5 leading-4">I confirm I own this voice or have explicit permission to clone it.</span>
                </label>
                <label
                  className={`group relative flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition sm:min-h-11 sm:gap-3 sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm ${
                    cloneSafetyAccepted
                      ? 'border-cyan-400/55 bg-cyan-500/10 text-slate-100 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]'
                      : 'border-white/10 bg-white/[0.03] text-slate-200 hover:border-cyan-400/35 hover:bg-white/[0.06]'
                  }`}
                >
                  <input
                    checked={cloneSafetyAccepted}
                    onChange={(event) => setCloneSafetyAccepted(event.target.checked)}
                    type="checkbox"
                    className="peer absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0"
                  />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition sm:h-6 sm:w-6 ${
                      cloneSafetyAccepted
                        ? 'border-cyan-400 bg-cyan-400 text-slate-950 shadow-[0_0_0_1px_rgba(34,211,238,0.24)]'
                        : 'border-white/15 bg-slate-950/65 text-transparent group-hover:border-cyan-400/55'
                    }`}
                  >
                    <CheckCircle2 size={12} className={cloneSafetyAccepted ? '' : 'opacity-0'} />
                  </span>
                  <span className="pointer-events-none relative z-10 pt-0.5 leading-4">I will not use cloned output for impersonation, fraud, or harmful deception.</span>
                </label>
              </div>
            </div>
          ) : null}

          {voiceCloneTask ? (
            <VoiceCloneTaskProgressCard
              title={voiceCloneTask.title}
              stage={voiceCloneTask.stage}
              detail={voiceCloneTask.detail}
              progress={voiceCloneTask.progress}
              tone={voiceCloneTask.kind === 'clone' ? 'clone' : 'separate'}
              isCancelling={isVoiceCloneCancelling}
              onCancel={cancelVoiceCloneTask}
            />
          ) : null}

          <form className={`flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 sm:rounded-2xl sm:px-3.5 sm:py-3 sm:flex-row sm:items-center sm:justify-between ${isWorkspaceLayout ? 'vf-voice-clone-actionbar' : ''}`} onSubmit={handleSubmit}>
            <div className="text-[10px] leading-4 text-slate-500 sm:text-[11px] sm:leading-5">
              Modal VC requests are billed by the backend and require runtime readiness.
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {!isWorkspaceLayout && canSeeStressControls ? (
                <Button
                  type="button"
                  variant="secondary"
                  icon={<Gauge size={14} />}
                  onClick={openStressModal}
                >
                  Stress Test (Modal VC)
                </Button>
              ) : null}
              <Button
                className="sm:min-w-36"
                disabled={!canStartCloning}
                isLoading={isCloning}
                icon={!isCloning ? <Sparkles size={14} /> : undefined}
                type="submit"
                variant="primary"
              >
                Start Cloning
              </Button>
            </div>
          </form>

          {errorMessage ? (
            <div
              className={`rounded-lg px-2 py-1.5 text-[10px] sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm ${
                /cancelled|canceled/i.test(errorMessage)
                  ? 'border border-slate-200 bg-slate-50 text-slate-700'
                  : 'border border-rose-200 bg-rose-50 text-rose-800'
              }`}
              role={/cancelled|canceled/i.test(errorMessage) ? 'status' : 'alert'}
            >
              {errorMessage}
            </div>
          ) : null}
        </div>
        ) : null}

        {activeToolTab === 'separate' ? (
        <div className="mt-2.5 space-y-2.5 sm:mt-3 sm:space-y-3" {...voiceUtilityTabs.getPanelProps('separate')}>
          <UploadDropzone
            accept="audio/*"
            file={sourceMixAudio}
            label="Drop source mix audio"
            hint="Upload a single mixed track to split vocals and background."
            className="px-2 py-2 sm:px-3 sm:py-3"
            disabled={isVoiceCloneActionBusy}
            onFilesSelected={handleSourceMixChange}
          />

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 sm:rounded-2xl sm:px-4 sm:py-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-800 sm:text-sm">
              <FileAudio size={15} className="text-indigo-600" />
              <span>Source mix</span>
            </div>
            <VoiceClonePreviewPlayer
              label="Source mix"
              name={sourceMixAudio?.name || 'No file selected'}
              meta={sourceMixAudio ? `${formatFileSize(sourceMixAudio)} • ${sourceMixDurationSec > 0 ? formatDuration(sourceMixDurationSec) : '--:--'}` : 'No file selected'}
              previewUrl={sourceMixPreviewUrl}
              fallback="Upload a mixed clip to preview it here."
              tone="source"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 sm:rounded-2xl sm:px-4 sm:py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold text-slate-800 sm:text-sm">Trim source before extraction</div>
                <p className="mt-0.5 text-[10px] text-slate-500 sm:text-xs">
                  Set a source range, then Demucs will run only on that trimmed section.
                </p>
              </div>
              <div className="text-[10px] text-slate-500 sm:text-[11px]">
                Source duration: {sourceMixDurationSec > 0 ? formatDuration(sourceMixDurationSec) : '--:--'}
              </div>
            </div>

            <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium text-slate-600 sm:text-[11px]">Source trim start (seconds)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm"
                  disabled={!sourceMixAudio || isVoiceCloneActionBusy}
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={sourceTrimStartInput}
                  onChange={(event) => {
                    setSourceTrimStartInput(event.target.value);
                    setSourceTrimErrorMessage('');
                    setTrimmedSourceMix(null);
                  }}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium text-slate-600 sm:text-[11px]">Source trim end (seconds)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm"
                  disabled={!sourceMixAudio || isVoiceCloneActionBusy}
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={sourceTrimEndInput}
                  onChange={(event) => {
                    setSourceTrimEndInput(event.target.value);
                    setSourceTrimErrorMessage('');
                    setTrimmedSourceMix(null);
                  }}
                />
              </label>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={!canApplySourceTrim}
                  isLoading={isTrimmingSource}
                  type="button"
                  variant="secondary"
                  onClick={handleApplySourceTrim}
                >
                  Apply source trim
                </Button>
              </div>
            </div>

          {sourceTrimValidationMessage || sourceTrimErrorMessage ? (
              <div className="mt-2.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-800 sm:rounded-xl sm:text-sm" role="alert">
                {sourceTrimErrorMessage || sourceTrimValidationMessage}
              </div>
            ) : null}

            {trimmedSourceMix ? (
              <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-800 sm:rounded-xl sm:text-xs">
                Source trim applied locally: {formatTrimSeconds(trimmedSourceMix.startSec)}s - {formatTrimSeconds(trimmedSourceMix.endSec)}s. Extraction sends the compressed source mix plus this trim range.
              </div>
            ) : !sourceMixAudio ? (
              <p className="mt-2.5 text-[10px] text-slate-500 sm:text-xs">
                Upload a source mix to enable source trimming.
              </p>
            ) : (
              <p className="mt-2.5 text-[10px] text-slate-500 sm:text-xs">
                Leave start at 0 and end at full duration to process the full source mix.
              </p>
            )}

            {trimmedSourceMix ? (
              <div className="mt-2.5">
                <VoiceClonePreviewPlayer
                  label="Trimmed source"
                  name={sourceMixAudio?.name || 'Source mix'}
                  meta={`Trimmed ${formatTrimSeconds(trimmedSourceMix.startSec)}s - ${formatTrimSeconds(trimmedSourceMix.endSec)}s`}
                  previewUrl={trimmedSourceMix.previewUrl}
                  fallback="Trimmed source preview is not available."
                  tone="source"
                />
              </div>
            ) : null}
          </div>

          <form className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between" onSubmit={handleExtractStems}>
            <div className="text-[10px] leading-4 text-slate-500 sm:text-[11px] sm:leading-5">
              Demucs runs on the backend to generate downloadable vocals and background WAV stems.
            </div>
            <Button
              className="sm:min-w-40"
              disabled={!canExtractStems}
              isLoading={isExtractingStems}
              icon={!isExtractingStems ? <Music2 size={14} /> : undefined}
              type="submit"
              variant="primary"
            >
              Extract Voice + BG Music
            </Button>
          </form>

          {stemErrorMessage ? (
            <div
              className={`rounded-lg px-2 py-1.5 text-[10px] sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm ${
                /cancelled|canceled/i.test(stemErrorMessage)
                  ? 'border border-slate-200 bg-slate-50 text-slate-700'
                  : 'border border-rose-200 bg-rose-50 text-rose-800'
              }`}
              role={/cancelled|canceled/i.test(stemErrorMessage) ? 'status' : 'alert'}
            >
              {stemErrorMessage}
            </div>
          ) : null}
        </div>
        ) : null}

        {activeToolTab === 'library' ? (
        <div className="mt-2.5 space-y-2.5 sm:mt-3 sm:space-y-3" {...voiceUtilityTabs.getPanelProps('library')}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 sm:rounded-2xl sm:px-3.5 sm:py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-900 sm:text-[12px]">All Voices</div>
                <p className="mt-0.5 text-[10px] text-slate-600 sm:text-[11px]">
                  {voiceLibraryAuditSummary.filteredCount} visible of {voiceLibraryAuditSummary.totalCount} total for {String(selectedEngine || 'current engine')}.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700 sm:text-[10px]">{voiceLibraryAuditSummary.freeCount} free</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 sm:text-[10px]">{voiceLibraryAuditSummary.proCount} pro</span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-semibold text-indigo-700 sm:text-[10px]">{voiceLibraryAuditSummary.clonedCount} cloned</span>
              </div>
            </div>
          </div>

          <label className="relative block">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={voiceLibrarySearch}
              onChange={(event) => setVoiceLibrarySearch(event.target.value)}
              placeholder="Search voices by name, id, accent, country, gender..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-[11px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:rounded-xl sm:text-[12px]"
            />
          </label>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 sm:rounded-2xl sm:p-2">
            <div className="vf-scrollbar-invisible max-h-[58vh] overflow-x-hidden overflow-y-auto pr-0.5">
              {filteredVoiceLibraryCatalog.length <= 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-[11px] text-slate-500 sm:rounded-xl sm:text-[12px]">
                  No voices matched the current filter.
                </div>
              ) : (
                <div className="space-y-2.5 sm:space-y-3">
                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[11px] font-semibold text-slate-800 sm:text-[12px]">Male Voices</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600 sm:text-[10px]">{maleVoiceLibraryCatalog.length}</span>
                    </div>
                    {maleVoiceLibraryCatalog.length <= 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-[10px] text-slate-500 sm:text-[11px]">
                        No male voices matched the current filter.
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5 sm:gap-2 lg:grid-cols-6 xl:grid-cols-8">
                        {maleVoiceLibraryCatalog.map((voice) => {
                          const voiceTier = String(voice.accessTier || (voice.isPlanRestricted ? 'pro' : 'free')).trim().toLowerCase();
                          const voiceCountry = String(voice.country || voice.accent || 'Unknown').trim() || 'Unknown';
                          const voiceEngine = String(voice.engine || selectedEngine || 'Unknown').trim() || 'Unknown';
                          const displayName = String(resolvePublicVoiceLabel(voice.name, voice.geminiVoiceName, voice.id) || voice.name || voice.id || 'Voice').trim() || 'Voice';
                          const previewStatus = voicePreviewState?.id === voice.id ? voicePreviewState.status : 'idle';
                          return (
                            <article key={voice.id} className="min-h-[6.85rem] rounded-lg border border-slate-200 bg-white/95 p-1.5 shadow-sm sm:rounded-xl sm:p-2" style={VOICE_LIBRARY_CARD_RENDER_STYLE}>
                              <div className="flex items-start justify-between gap-1">
                                <p className="truncate text-[10px] font-semibold text-slate-900 sm:text-[11px]" title={displayName}>
                                  {displayName}
                                </p>
                                <span
                                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                                    voiceTier === 'pro'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-emerald-50 text-emerald-700'
                                  }`}
                                >
                                  {voiceTier.toUpperCase()}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-[9px] text-slate-500 sm:text-[10px]" title={String(voice.id || 'unknown-id')}>
                                {String(voice.id || 'unknown-id')}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600" title={voiceCountry}>{voiceCountry}</span>
                                {voice.isCloned ? <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700">Clone</span> : null}
                              </div>
                              <p className="mt-1 truncate text-[9px] text-slate-500" title={voiceEngine}>
                                {voiceEngine}
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!onPreviewVoice) return;
                                  void onPreviewVoice(String(voice.id || ''), displayName);
                                }}
                                disabled={!onPreviewVoice}
                                className={`mt-1 inline-flex w-full items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[9px] font-semibold transition sm:text-[10px] ${
                                  !onPreviewVoice
                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                    : previewStatus === 'playing'
                                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
                                }`}
                                aria-label={`Play preview for ${displayName}`}
                              >
                                {previewStatus === 'loading'
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : previewStatus === 'playing'
                                    ? <Pause size={11} />
                                    : <Play size={11} />}
                                <span>{previewStatus === 'playing' ? 'Pause' : 'Play'}</span>
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[11px] font-semibold text-slate-800 sm:text-[12px]">Female Voices</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600 sm:text-[10px]">{femaleVoiceLibraryCatalog.length}</span>
                    </div>
                    {femaleVoiceLibraryCatalog.length <= 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-[10px] text-slate-500 sm:text-[11px]">
                        No female voices matched the current filter.
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5 sm:gap-2 lg:grid-cols-6 xl:grid-cols-8">
                        {femaleVoiceLibraryCatalog.map((voice) => {
                          const voiceTier = String(voice.accessTier || (voice.isPlanRestricted ? 'pro' : 'free')).trim().toLowerCase();
                          const voiceCountry = String(voice.country || voice.accent || 'Unknown').trim() || 'Unknown';
                          const voiceEngine = String(voice.engine || selectedEngine || 'Unknown').trim() || 'Unknown';
                          const displayName = String(resolvePublicVoiceLabel(voice.name, voice.geminiVoiceName, voice.id) || voice.name || voice.id || 'Voice').trim() || 'Voice';
                          const previewStatus = voicePreviewState?.id === voice.id ? voicePreviewState.status : 'idle';
                          return (
                            <article key={voice.id} className="min-h-[6.85rem] rounded-lg border border-slate-200 bg-white/95 p-1.5 shadow-sm sm:rounded-xl sm:p-2" style={VOICE_LIBRARY_CARD_RENDER_STYLE}>
                              <div className="flex items-start justify-between gap-1">
                                <p className="truncate text-[10px] font-semibold text-slate-900 sm:text-[11px]" title={displayName}>
                                  {displayName}
                                </p>
                                <span
                                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                                    voiceTier === 'pro'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-emerald-50 text-emerald-700'
                                  }`}
                                >
                                  {voiceTier.toUpperCase()}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-[9px] text-slate-500 sm:text-[10px]" title={String(voice.id || 'unknown-id')}>
                                {String(voice.id || 'unknown-id')}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600" title={voiceCountry}>{voiceCountry}</span>
                                {voice.isCloned ? <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700">Clone</span> : null}
                              </div>
                              <p className="mt-1 truncate text-[9px] text-slate-500" title={voiceEngine}>
                                {voiceEngine}
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!onPreviewVoice) return;
                                  void onPreviewVoice(String(voice.id || ''), displayName);
                                }}
                                disabled={!onPreviewVoice}
                                className={`mt-1 inline-flex w-full items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[9px] font-semibold transition sm:text-[10px] ${
                                  !onPreviewVoice
                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                    : previewStatus === 'playing'
                                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
                                }`}
                                aria-label={`Play preview for ${displayName}`}
                              >
                                {previewStatus === 'loading'
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : previewStatus === 'playing'
                                    ? <Pause size={11} />
                                    : <Play size={11} />}
                                <span>{previewStatus === 'playing' ? 'Pause' : 'Play'}</span>
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
        ) : null}
      </SectionCard>

      {!isWorkspaceLayout && activeToolTab === 'clone' && result ? (
        <SectionCard className="p-3 sm:p-3.5">
          <div className="flex items-start justify-between gap-2.5 sm:gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900 sm:text-[15px]">Cloning result</h3>
              <p className="mt-0.5 text-[10px] leading-4 text-slate-600 sm:text-[11px] sm:leading-5">
                The converted audio is ready to preview and download.
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                VC used: {Math.max(0, Number(result.response.consumedVcUnits || result.response.vcBilling?.consumedUnits || 0)).toFixed(2)} units
              </p>
            </div>
            {result.response.status ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 sm:px-2.5 sm:py-1 sm:text-[11px]">
                {result.response.status}
              </span>
            ) : null}
          </div>

          <VoiceClonePreviewPlayer
            label="Output audio"
            name={result.fileName || 'Generated output'}
            meta={result.response.artifact?.downloadUrl
              ? 'Backend artifact URL available'
              : 'Inline audio data generated locally'}
            previewUrl={result.previewUrl}
            fallback="Output was generated, but no preview URL was returned by the backend."
            tone="output"
            downloadUrl={result.downloadUrl}
            downloadFileName={result.fileName}
            downloadLabel="Download"
          />
        </SectionCard>
      ) : null}

      {!isWorkspaceLayout && activeToolTab === 'separate' && stemResult ? (
        <SectionCard className="p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-2.5 sm:gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900 sm:text-[15px]">Extraction result</h3>
              <p className="mt-0.5 text-[10px] leading-4 text-slate-600 sm:text-[11px] sm:leading-5">
                Voice and background stems are ready to preview and download.
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                Processed duration: {formatDuration(stemResult.durationSec)}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                VC used: {Math.max(0, Number(stemResult.consumedVcUnits || 0)).toFixed(2)} units
                {Number(stemResult.chargedInr || 0) > 0
                  ? ` | Cost: Rs ${Math.max(0, Number(stemResult.chargedInr || 0)).toFixed(2)}`
                  : ''}
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 sm:px-2.5 sm:py-1 sm:text-[11px]">
              Ready
            </span>
          </div>

          <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 sm:rounded-2xl sm:px-4 sm:py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold text-slate-800 sm:text-sm">Trim both stems together</div>
                <p className="mt-0.5 text-[10px] text-slate-500 sm:text-xs">
                  Apply one trim range to the vocals and background outputs at the same time.
                </p>
              </div>
              <div className="text-[10px] text-slate-500 sm:text-[11px]">
                Duration: {formatDuration(stemResult.durationSec)}
              </div>
            </div>

            <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium text-slate-600 sm:text-[11px]">Trim start (seconds)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm"
                  disabled={isVoiceCloneActionBusy}
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={stemTrimStartInput}
                  onChange={(event) => setStemTrimStartInput(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium text-slate-600 sm:text-[11px]">Trim end (seconds)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm"
                  disabled={isVoiceCloneActionBusy}
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={stemTrimEndInput}
                  onChange={(event) => setStemTrimEndInput(event.target.value)}
                />
              </label>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={!canApplyStemTrim}
                  isLoading={isTrimmingStems}
                  type="button"
                  variant="primary"
                  onClick={handleApplyStemTrim}
                >
                  Apply trim
                </Button>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500 sm:text-[11px]">
              {trimmedStemResult ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 sm:px-2.5 sm:py-1">
                  Trim applied: {formatTrimSeconds(trimmedStemResult.startSec)}s - {formatTrimSeconds(trimmedStemResult.endSec)}s
                </span>
              ) : (
                <span>Trim will update both preview and download links once applied.</span>
              )}
            </div>

            {stemTrimValidationMessage || stemTrimErrorMessage ? (
              <div className="mt-2.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-800 sm:rounded-xl sm:text-sm" role="alert">
                {stemTrimErrorMessage || stemTrimValidationMessage}
              </div>
            ) : null}
          </div>

          <div className="mt-2.5 grid gap-2 sm:gap-2.5 lg:grid-cols-2">
            <VoiceClonePreviewPlayer
              label="Voice stem"
              name={activeStemResult?.vocalsFileName || stemResult.vocalsFileName}
              meta={formatDuration(stemResult.durationSec)}
              previewUrl={activeStemResult?.vocalsPreviewUrl || stemResult.vocalsPreviewUrl}
              fallback="Vocals are ready, but no preview URL was returned."
              tone="stem"
              downloadUrl={activeStemResult?.vocalsDownloadUrl || stemResult.vocalsDownloadUrl}
              downloadFileName={activeStemResult?.vocalsFileName || stemResult.vocalsFileName}
              downloadLabel="Download vocals"
            />
            <VoiceClonePreviewPlayer
              label="Background stem"
              name={activeStemResult?.backgroundFileName || stemResult.backgroundFileName}
              meta={formatDuration(stemResult.durationSec)}
              previewUrl={activeStemResult?.backgroundPreviewUrl || stemResult.backgroundPreviewUrl}
              fallback="Background is ready, but no preview URL was returned."
              tone="stem"
              downloadUrl={activeStemResult?.backgroundDownloadUrl || stemResult.backgroundDownloadUrl}
              downloadFileName={activeStemResult?.backgroundFileName || stemResult.backgroundFileName}
              downloadLabel="Download background"
            />
          </div>
        </SectionCard>
      ) : null}

      </div>

      {shouldShowWorkspaceRail ? (
        <aside className="vf-voice-clone-rail">
          <div className="vf-voice-clone-rail-card">
            <div className="vf-voice-clone-rail-head">
              <div>
                <p className="vf-voices-kicker">Session status</p>
                <h3 className="vf-voice-clone-rail-title">{workspaceResultSummary.title}</h3>
              </div>
              <span className="vf-voice-clone-status-chip">{workspaceResultSummary.status}</span>
            </div>
            <p className="vf-voice-clone-rail-copy">{workspaceResultSummary.detail}</p>
          </div>

          {activeToolTab === 'clone' ? (
            <>
              <div className="vf-voice-clone-rail-card">
                <div className="vf-voice-clone-rail-head">
                  <h3 className="vf-voice-clone-rail-title">Preview sources</h3>
                </div>
                <div className="vf-voice-clone-preview-stack">
                  <VoiceClonePreviewPlayer
                    label="Reference audio"
                    name={referenceAudio?.name || 'Not selected'}
                    meta={formatFileSize(referenceAudio)}
                    previewUrl={referencePreviewUrl}
                    fallback="Upload a reference clip to preview it here."
                    tone="source"
                  />
                  <VoiceClonePreviewPlayer
                    label="Target audio"
                    name={targetAudio?.name || 'Not selected'}
                    meta={formatFileSize(targetAudio)}
                    previewUrl={targetPreviewUrl}
                    fallback="Upload a target clip to preview it here."
                    tone="source"
                  />
                </div>
              </div>

              {result ? (
                <div className="vf-voice-clone-rail-card">
                  <div className="vf-voice-clone-rail-head">
                    <h3 className="vf-voice-clone-rail-title">Latest output</h3>
                    {result.response.status ? <span className="vf-voice-clone-status-chip">{result.response.status}</span> : null}
                  </div>
                  <VoiceClonePreviewPlayer
                    label="Output audio"
                    name={result.fileName || 'Generated output'}
                    meta={result.response.status ? `Status: ${String(result.response.status)}` : 'Rendered preview'}
                    previewUrl={result.previewUrl}
                    fallback="Output was generated, but no preview URL was returned by the backend."
                    tone="output"
                    downloadUrl={result.downloadUrl}
                    downloadFileName={result.fileName}
                    downloadLabel="Download output"
                  />
                </div>
              ) : null}
            </>
          ) : activeToolTab === 'separate' ? (
            <>
              <div className="vf-voice-clone-rail-card">
                <div className="vf-voice-clone-rail-head">
                  <h3 className="vf-voice-clone-rail-title">Source mix</h3>
                </div>
                <VoiceClonePreviewPlayer
                  label="Source mix"
                  name={sourceMixAudio?.name || 'No file selected'}
                  meta={sourceMixAudio ? `${formatFileSize(sourceMixAudio)} • ${sourceMixDurationSec > 0 ? formatDuration(sourceMixDurationSec) : '--:--'}` : 'No file selected'}
                  previewUrl={sourceMixPreviewUrl}
                  fallback="Upload a mixed track to preview it here."
                  tone="source"
                />
              </div>

              {stemResult ? (
                <div className="vf-voice-clone-rail-card">
                  <div className="vf-voice-clone-rail-head">
                    <h3 className="vf-voice-clone-rail-title">Stem outputs</h3>
                    <span className="vf-voice-clone-status-chip">Ready</span>
                  </div>
                  <div className="vf-voice-clone-preview-stack">
                    <VoiceClonePreviewPlayer
                      label="Vocals"
                      name={activeStemResult?.vocalsFileName || stemResult.vocalsFileName}
                      meta={formatDuration(stemResult.durationSec)}
                      previewUrl={activeStemResult?.vocalsPreviewUrl || stemResult.vocalsPreviewUrl}
                      fallback="Vocals are ready, but no preview URL was returned."
                      tone="stem"
                      downloadUrl={activeStemResult?.vocalsDownloadUrl || stemResult.vocalsDownloadUrl}
                      downloadFileName={activeStemResult?.vocalsFileName || stemResult.vocalsFileName}
                      downloadLabel="Download vocals"
                    />
                    <VoiceClonePreviewPlayer
                      label="Background"
                      name={activeStemResult?.backgroundFileName || stemResult.backgroundFileName}
                      meta={formatDuration(stemResult.durationSec)}
                      previewUrl={activeStemResult?.backgroundPreviewUrl || stemResult.backgroundPreviewUrl}
                      fallback="Background is ready, but no preview URL was returned."
                      tone="stem"
                      downloadUrl={activeStemResult?.backgroundDownloadUrl || stemResult.backgroundDownloadUrl}
                      downloadFileName={activeStemResult?.backgroundFileName || stemResult.backgroundFileName}
                      downloadLabel="Download background"
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="vf-voice-clone-rail-card">
              <div className="vf-voice-clone-rail-head">
                <h3 className="vf-voice-clone-rail-title">Library audit</h3>
                <span className="vf-voice-clone-status-chip">{voiceLibraryAuditSummary.filteredCount}</span>
              </div>
              <p className="vf-voice-clone-rail-copy">
                {voiceLibraryAuditSummary.filteredCount} voices visible from {voiceLibraryAuditSummary.totalCount} total
                ({voiceLibraryAuditSummary.freeCount} free, {voiceLibraryAuditSummary.proCount} pro, {voiceLibraryAuditSummary.clonedCount} cloned).
              </p>
            </div>
          )}

          {showRuntimeDiagnosticsUi ? (
            <div className="vf-voice-clone-rail-card">
              <button
                type="button"
                className="vf-voice-clone-rail-toggle"
                onClick={() => setRuntimeDiagnosticsExpanded(!showRuntimeDiagnostics)}
                aria-expanded={showRuntimeDiagnostics}
              >
                <div>
                  <p className="vf-voices-kicker">Diagnostics</p>
                  <h3 className="vf-voice-clone-rail-title">{isLoadingOpenVoiceStatus ? 'Checking availability...' : openVoiceProviderStatus.readyLabel}</h3>
                </div>
                {showRuntimeDiagnostics ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showRuntimeDiagnostics ? (
                <div className="vf-voice-clone-diagnostics">
                  <div className="vf-voice-clone-preview-card">
                    <div className="vf-voice-clone-preview-label">Provider</div>
                    <div className="vf-voice-clone-preview-name">{isLoadingOpenVoiceStatus ? 'Loading...' : openVoiceProviderStatus.activeProviderLabel}</div>
                  </div>
                  <div className="vf-voice-clone-preview-card">
                    <div className="vf-voice-clone-preview-label">Device</div>
                    <div className="vf-voice-clone-preview-name">{openVoiceProviderStatus.device}</div>
                  </div>
                  <div className="vf-voice-clone-inline-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      icon={<RefreshCw size={14} className={isLoadingOpenVoiceStatus ? 'animate-spin' : ''} />}
                      disabled={isLoadingOpenVoiceStatus}
                      onClick={() => {
                        void refreshVoiceCloneStatus(true);
                      }}
                    >
                      Check Availability
                    </Button>
                    {canSeeStressControls ? (
                      <Button type="button" variant="secondary" icon={<Gauge size={14} />} onClick={openStressModal}>
                        Stress Test
                      </Button>
                    ) : null}
                  </div>
                  {openVoiceStatusError ? <div className="vf-voice-clone-warning">{openVoiceStatusError}</div> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>
      ) : null}

      {canSeeStressControls ? (
        <VoiceCloneStressModal
          isOpen={isStressModalOpen}
          onClose={closeStressModal}
          benchmarkTarget={stressBenchmarkTarget}
          onBenchmarkTargetChange={setStressBenchmarkTarget}
          config={stressConfig}
          onConfigChange={setStressConfig}
          referenceAudio={referenceAudio}
          onReferenceAudioSelect={handleReferenceChange}
          targetAudio={targetAudio}
          onTargetAudioSelect={handleTargetChange}
          geminiText={stressGeminiText}
          onGeminiTextChange={setStressGeminiText}
          geminiVoiceName={stressGeminiVoiceName}
          onGeminiVoiceNameChange={setStressGeminiVoiceName}
          status={stressStatus}
          isStarting={isStressStarting}
          isCancelling={isStressCancelling}
          errorMessage={stressErrorMessage}
          validationMessage={stressValidationMessage}
          deviceLabel={stressDeviceLabel}
          backendLabel={stressBackendLabel}
          onStart={handleStressStart}
          onCancel={handleStressCancel}
        />
      ) : null}
    </div>
  );
};
