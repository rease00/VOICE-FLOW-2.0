import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileAudio,
  Gauge,
  Mic2,
  Music2,
  Play,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '../../../components/Button';
import { SectionCard } from '../../../components/SectionCard';
import { UploadDropzone } from '../../../components/ui/UploadDropzone';
import { VoiceClonePreviewPlayer } from './VoiceClonePreviewPlayer';
import { VoiceCloneTaskProgressCard } from './VoiceCloneTaskProgressCard';
import { useUser } from '../../../contexts/UserContext';
import { getEngineDisplayName } from '../../../services/engineDisplay';
import { getSharedAudioContext } from '../../../src/shared/audio/audioContext';
import { arrayBufferToBase64 } from '../../../src/shared/audio/base64';
import { audioBufferToWav } from '../../../src/shared/audio/wav';
import { hasActiveAdminActor } from '../../shared/auth/adminAccess';
import { useManagedTabs } from '../../../src/shared/ui/tabs';
import type { TtsEngineKey, UserProfile } from '../../../types';
import { buildDunoClonePreviewUrl } from './dunoPreview';
import { resolveVoiceClonePlayableAudioUrlWithFallback } from './audio';
import {
  cancelVoiceCloneStressTest,
  cloneVoiceWithDunoNative,
  cloneVoiceWithOpenVoice,
  type DunoNativeCloneResponse,
  fetchVoiceCloneStressTestStatus,
  fetchOpenVoiceCloneStatus,
  separateVoiceAndBackgroundWithDemucs,
  startVoiceCloneStressTest,
  type OpenVoiceCloneResponse,
  type VoiceCloneStressBenchmarkTarget,
  type VoiceCloneStressConfig,
  type VoiceCloneStressStartRequest,
  type VoiceCloneStressStatusResponse,
} from './api';
import {
  getOpenVoiceProviderDisplayStatus,
  type OpenVoiceBenchmarkStatusResponse,
} from './openvoiceTypes';
import {
  buildOpenVoiceStemSeparationRequest,
  getOpenVoiceStemExtractionMaxBytes,
  isFullDurationTrimRange,
} from './stemSeparation';

interface VoiceCloningTabContentProps {
  backendBaseUrl?: string | undefined;
  selectedEngine?: TtsEngineKey;
  layout?: 'stacked' | 'workspace';
  denseTabs?: boolean;
  showRail?: boolean;
  diagnosticsExpanded?: boolean;
  onDiagnosticsExpandedChange?: (expanded: boolean) => void;
}

type VoiceCloneResponse = OpenVoiceCloneResponse | DunoNativeCloneResponse;

interface CloningResultState {
  previewUrl: string;
  downloadUrl: string;
  fileName: string;
  response: VoiceCloneResponse;
  cloneMode: 'modal_vc' | 'duno_native';
}

interface StemExtractionResultState {
  vocalsPreviewUrl: string;
  vocalsDownloadUrl: string;
  vocalsFileName: string;
  backgroundPreviewUrl: string;
  backgroundDownloadUrl: string;
  backgroundFileName: string;
  durationSec: number;
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

type VoiceUtilityTab = 'clone' | 'separate';
type VoiceCloneTaskKind = 'clone' | 'separate';

interface VoiceCloneTaskState {
  kind: VoiceCloneTaskKind;
  title: string;
  stage: string;
  detail: string;
  progress: number;
}

const VOICE_UTILITY_TAB_ITEMS: Array<{ id: VoiceUtilityTab }> = [
  { id: 'clone' },
  { id: 'separate' },
];

const TRIM_DURATION_EPSILON = 0.001;
const MAX_STEM_EXTRACTION_SOURCE_BYTES = getOpenVoiceStemExtractionMaxBytes();
const OPENVOICE_STATUS_RETRY_INTERVAL_MS = 15_000;
const VOICE_CLONE_CONSENT_STORAGE_KEY = 'vf_voice_clone_consent_v1';

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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error || 'Unable to start voice cloning.');
};

const isDunoCloneResponse = (response: VoiceCloneResponse | null | undefined): response is DunoNativeCloneResponse => (
  String((response as { engine?: unknown } | null | undefined)?.engine || '').trim().toUpperCase() === 'DUNO'
);

export const mapVoiceCloneStressError = (error: unknown): string => {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  const detail =
    typeof error === 'object' && error !== null && 'detail' in error
      ? String((error as { detail?: unknown }).detail || '').trim()
      : '';

  if (status === 401) {
    return detail || 'Authentication is required to run admin stress tests.';
  }
  if (status === 403) {
    return detail || 'You do not have permission to run admin stress tests.';
  }
  if (status === 429) {
    return detail || 'Stress test requests are rate-limited. Please wait and retry.';
  }
  if (status === 404) {
    const normalizedDetail = detail.toLowerCase();
    if (!detail || normalizedDetail === 'not found' || normalizedDetail === '404 not found') {
      return 'Stress endpoint is unavailable on the connected backend. Restart/update backend and retry.';
    }
    return detail;
  }
  if (status >= 500) {
    return detail || 'Stress test service is temporarily unavailable. Please retry shortly.';
  }
  return detail || getErrorMessage(error);
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
  'VoiceFlow stress test benchmark sample for Gemini Flash throughput.';

const STRESS_RPM_INCREMENT = 5;
const VOICE_CLONE_STRESS_DEFAULT_CONCURRENCY = 2;

const roundStressRpm = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return STRESS_RPM_INCREMENT;
  return Math.max(STRESS_RPM_INCREMENT, Math.round(value / STRESS_RPM_INCREMENT) * STRESS_RPM_INCREMENT);
};

export const deriveStressRpmFromConcurrency = (
  concurrency: number
): Pick<VoiceCloneStressConfig, 'startRpm' | 'stepRpm' | 'maxRpm'> => {
  const safeConcurrency = Math.min(128, Math.max(1, Math.floor(Number(concurrency) || 0)));
  const startRpm = roundStressRpm(safeConcurrency * 10);
  const stepRpm = roundStressRpm(Math.max(STRESS_RPM_INCREMENT, safeConcurrency * 5));
  const maxRpm = roundStressRpm(Math.max(safeConcurrency * 20, startRpm + stepRpm));
  return { startRpm, stepRpm, maxRpm };
};

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

export const isVoiceCloneStressTerminalStatus = (status: string): boolean => {
  const token = String(status || '').trim().toLowerCase();
  return token === 'completed' || token === 'failed' || token === 'cancelled';
};

export const isVoiceCloneStressActiveStatus = (status: string): boolean => {
  const token = String(status || '').trim().toLowerCase();
  return token === 'queued' || token === 'running';
};

const formatStressPercent = (value: number): string => {
  if (!Number.isFinite(value)) return '0.0%';
  return `${(value * 100).toFixed(1)}%`;
};

const formatStressNumber = (value: number, digits = 1): string => {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(digits);
};

export const getStressRuntimeDeviceLabel = (
  status: VoiceCloneStressStatusResponse | null,
  benchmarkTarget: VoiceCloneStressBenchmarkTarget
): string => {
  const runtimeDevices = Array.isArray(status?.runtimeDeviceSamples)
    ? status.runtimeDeviceSamples.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (runtimeDevices.length > 0) {
    return runtimeDevices.join(', ');
  }

  const preflight = status?.runtimePreflight && typeof status.runtimePreflight === 'object'
    ? (status.runtimePreflight as Record<string, unknown>)
    : null;
  const preflightDevice = String(preflight?.device || '').trim();
  if (preflightDevice) {
    return preflightDevice;
  }

  return benchmarkTarget === 'OPENVOICE_L4_VC'
    ? 'Modal VC (configured target)'
    : 'Gemini Flash (configured target)';
};

export const getStressValidationMessage = (
  benchmarkTarget: VoiceCloneStressBenchmarkTarget,
  config: VoiceCloneStressConfig,
  referenceAudio: File | null,
  targetAudio: File | null,
  geminiText: string,
  geminiVoiceName: string
): string => {
  if (config.startRpm < 1) return 'Start RPM must be at least 1.';
  if (config.stepRpm < 1) return 'Step RPM must be at least 1.';
  if (config.maxRpm < config.startRpm) return 'Max RPM must be greater than or equal to start RPM.';
  if (config.stepDurationSec < 5) return 'Step duration must be at least 5 seconds.';
  if (config.concurrency < 1) return 'Concurrency must be at least 1.';
  if (config.maxFailureRate < 0 || config.maxFailureRate > 1) return 'Max failure rate must be between 0 and 1.';
  if (config.maxP95Ms < 500) return 'Max p95 latency must be at least 500 ms.';
  if (config.warmupRequests < 0) return 'Warmup requests cannot be negative.';
  if (config.requestTimeoutSec < 1) return 'Request timeout must be at least 1 second.';

  if (benchmarkTarget === 'OPENVOICE_L4_VC') {
    if (!referenceAudio) return 'Reference audio is required for the Modal VC benchmark.';
    if (!targetAudio) return 'Target audio is required for the Modal VC benchmark.';
    return '';
  }

  if (!String(geminiText || '').trim()) return 'Gemini Flash benchmark text is required.';
  if (!String(geminiVoiceName || '').trim()) return 'Gemini Flash benchmark voice name is required.';
  return '';
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

export const shouldPollVoiceCloneStressStatus = (
  isModalOpen: boolean,
  status: VoiceCloneStressStatusResponse | null
): boolean => {
  if (!isModalOpen) return false;
  const jobId = String(status?.jobId || '').trim();
  if (!jobId) return false;
  return isVoiceCloneStressActiveStatus(String(status?.status || '').trim().toLowerCase());
};

export const canViewVoiceCloneStressControls = (
  user: Pick<UserProfile, 'isAdmin' | 'adminActor'> | null | undefined
): boolean => Boolean(user?.isAdmin) || hasActiveAdminActor(user?.adminActor || null);

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
                  <option value="OPENVOICE_L4_VC">Modal VC</option>
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

            {benchmarkTarget === 'OPENVOICE_L4_VC' ? (
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
  layout = 'stacked',
  denseTabs = false,
  showRail = true,
  diagnosticsExpanded,
  onDiagnosticsExpandedChange,
}) => {
  const { user, addClonedVoice } = useUser();
  const isDunoCloneMode = String(selectedEngine || '').trim().toUpperCase() === 'DUNO';
  const dunoLabel = getEngineDisplayName('DUNO');
  const isWorkspaceLayout = layout === 'workspace';
  const shouldShowWorkspaceRail = isWorkspaceLayout && showRail;
  const [activeToolTab, setActiveToolTab] = useState<VoiceUtilityTab>('clone');
  const [referenceAudio, setReferenceAudio] = useState<File | null>(null);
  const [targetAudio, setTargetAudio] = useState<File | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [voiceCloneTask, setVoiceCloneTask] = useState<VoiceCloneTaskState | null>(null);
  const [isVoiceCloneCancelling, setIsVoiceCloneCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<CloningResultState | null>(null);
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
  const [stressBenchmarkTarget, setStressBenchmarkTarget] = useState<VoiceCloneStressBenchmarkTarget>('OPENVOICE_L4_VC');
  const [stressConfig, setStressConfig] = useState<VoiceCloneStressConfig>(VOICE_CLONE_STRESS_DEFAULT_CONFIG);
  const [stressGeminiText, setStressGeminiText] = useState(VOICE_CLONE_STRESS_DEFAULT_GEMINI_TEXT);
  const [stressGeminiVoiceName, setStressGeminiVoiceName] = useState('Fenrir');
  const [stressStatus, setStressStatus] = useState<VoiceCloneStressStatusResponse | null>(null);
  const [stressErrorMessage, setStressErrorMessage] = useState('');
  const [isStressStarting, setIsStressStarting] = useState(false);
  const [isStressCancelling, setIsStressCancelling] = useState(false);
  const [openVoiceStatus, setOpenVoiceStatus] = useState<OpenVoiceBenchmarkStatusResponse | null>(null);
  const [isLoadingOpenVoiceStatus, setIsLoadingOpenVoiceStatus] = useState(false);
  const [openVoiceStatusError, setOpenVoiceStatusError] = useState('');
  const [cloneConsentAccepted, setCloneConsentAccepted] = useState(false);
  const [cloneSafetyAccepted, setCloneSafetyAccepted] = useState(false);
  const [isCloneConsentPersisted, setIsCloneConsentPersisted] = useState(false);
  const [localRuntimeDiagnosticsExpanded, setLocalRuntimeDiagnosticsExpanded] = useState(false);
  const voiceCloneTaskControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const cloneConsentUserKey = useMemo(
    () => resolveVoiceCloneConsentUserKey(user),
    [user]
  );

  const showRuntimeDiagnostics = diagnosticsExpanded ?? localRuntimeDiagnosticsExpanded;
  const setRuntimeDiagnosticsExpanded = onDiagnosticsExpandedChange || setLocalRuntimeDiagnosticsExpanded;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      voiceCloneTaskControllerRef.current?.abort();
      voiceCloneTaskControllerRef.current = null;
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

  const isOpenVoiceRuntimeReady = Boolean(openVoiceStatus?.ready);
  const isVoiceCloneActionBusy = Boolean(voiceCloneTask) || isCloning || isExtractingStems || isVoiceCloneCancelling;
  const canStartCloning = useMemo(
    () => Boolean(
      referenceAudio
      && !isVoiceCloneActionBusy
      && (isDunoCloneMode || targetAudio)
      && (isDunoCloneMode || isOpenVoiceRuntimeReady)
      && cloneConsentAccepted
      && cloneSafetyAccepted
    ),
    [cloneConsentAccepted, cloneSafetyAccepted, isDunoCloneMode, isOpenVoiceRuntimeReady, isVoiceCloneActionBusy, referenceAudio, targetAudio]
  );

  const canExtractStems = useMemo(
    () => Boolean(sourceMixAudio && !isVoiceCloneActionBusy),
    [isVoiceCloneActionBusy, sourceMixAudio]
  );
  const openVoiceProviderStatus = useMemo(
    () => getOpenVoiceProviderDisplayStatus(openVoiceStatus),
    [openVoiceStatus]
  );
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
    return directBaseUrl || 'Default API proxy (/api/backend)';
  }, [backendBaseUrl]);
  const stressStatusToken = String(stressStatus?.status || '').trim().toLowerCase();
  const isStressRunning = isVoiceCloneStressActiveStatus(stressStatusToken);
  const isStressTerminal = isVoiceCloneStressTerminalStatus(stressStatusToken);
  const canSeeStressControls = useMemo(() => canViewVoiceCloneStressControls(user), [user]);
  const refreshOpenVoiceStatus = useCallback(async (showLoading = true): Promise<void> => {
    if (showLoading) {
      setIsLoadingOpenVoiceStatus(true);
    }
    try {
      const status = await fetchOpenVoiceCloneStatus(
        backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
      );
      setOpenVoiceStatus(status);
      setOpenVoiceStatusError('');
    } catch (error) {
      setOpenVoiceStatus(null);
      setOpenVoiceStatusError(getErrorMessage(error));
    } finally {
      if (showLoading) {
        setIsLoadingOpenVoiceStatus(false);
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
    const controller = voiceCloneTaskControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    setIsVoiceCloneCancelling(true);
    updateVoiceCloneTask({
      stage: 'Cancelling request...',
      detail: 'Stopping the active root request and clearing pending output.',
      progress: 95,
    });
    controller.abort();
  }, [updateVoiceCloneTask]);

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

      if (stressBenchmarkTarget === 'OPENVOICE_L4_VC') {
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
    if (isDunoCloneMode) {
      setOpenVoiceStatus(null);
      setOpenVoiceStatusError('');
      return;
    }
    void refreshOpenVoiceStatus(true);
  }, [isDunoCloneMode, refreshOpenVoiceStatus]);

  useEffect(() => {
    if (isDunoCloneMode) {
      return undefined;
    }
    if (isOpenVoiceRuntimeReady) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refreshOpenVoiceStatus(false);
    }, OPENVOICE_STATUS_RETRY_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [isDunoCloneMode, isOpenVoiceRuntimeReady, refreshOpenVoiceStatus]);

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
    if (isVoiceCloneActionBusy) return;
    if (!isDunoCloneMode && !isOpenVoiceRuntimeReady) {
      setErrorMessage('Modal VC runtime is not ready. Wait for readiness, then retry.');
      return;
    }
    if (!referenceAudio || (!isDunoCloneMode && !targetAudio)) {
      setErrorMessage(
        isDunoCloneMode
          ? `Upload a reference audio clip before creating a ${dunoLabel} clone.`
          : 'Upload both reference audio and target audio before cloning.'
      );
      return;
    }
    if (!cloneConsentAccepted || !cloneSafetyAccepted) {
      setErrorMessage('Confirm consent and responsible-use attestations before cloning.');
      return;
    }

    setIsCloning(true);
    setErrorMessage('');
    setResult(null);
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
        progress: 18,
        stage: 'Encoding reference audio',
        detail: 'Packing the consented reference clip for the root request.',
      });
      const referenceAudioBase64 = await referenceAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer));
      ensureTaskActive();
      const referenceAudioType = String(referenceAudio.type || 'audio/wav').trim() || 'audio/wav';
      const referenceDataUrl = `data:${referenceAudioType};base64,${referenceAudioBase64}`;
      const requestId = makeRequestId();

      if (isDunoCloneMode) {
        updateVoiceCloneTask({
          progress: 40,
          stage: 'Submitting root request',
          detail: 'Sending the reference sample to the DUNO runtime.',
        });
        const response = await cloneVoiceWithDunoNative(
          {
            referenceAudioBase64,
            referenceAudioName: referenceAudio.name || 'reference-audio.wav',
            sourceVoiceEngine: 'DUNO',
            speaker: 'Voice cloning workspace',
            requestId,
            traceId: requestId,
          },
          backendBaseUrl ? { baseUrl: backendBaseUrl, signal: controller.signal } : { signal: controller.signal }
        );
        ensureTaskActive();
        updateVoiceCloneTask({
          progress: 82,
          stage: 'Preparing preview',
          detail: 'Rendering the cloned voice preview for the output player.',
        });

        const clonedVoice = response.clonedVoice
          ? {
              ...response.clonedVoice,
              originalSampleUrl: String(response.clonedVoice.originalSampleUrl || referenceDataUrl).trim() || referenceDataUrl,
              referenceAudioUrl: String(response.clonedVoice.referenceAudioUrl || referenceDataUrl).trim() || referenceDataUrl,
              referenceAudioName: String(response.clonedVoice.referenceAudioName || referenceAudio.name || 'reference-audio.wav').trim() || 'reference-audio.wav',
              sourceVoiceEngine: String(response.clonedVoice.sourceVoiceEngine || 'DUNO').trim() || 'DUNO',
            }
          : null;
        if (clonedVoice) {
          if (!String(clonedVoice.previewUrl || '').trim()) {
            const clonedVoiceId = String(clonedVoice.geminiVoiceName || response.voiceId || clonedVoice.id || '').trim();
            const clonedVoiceName = String(clonedVoice.name || clonedVoice.sourceVoiceName || clonedVoiceId || 'DUNO Clone').trim() || 'DUNO Clone';
            clonedVoice.previewUrl = await buildDunoClonePreviewUrl({
              backendBaseUrl,
              voiceId: clonedVoiceId || String(response.voiceId || clonedVoice.id || '').trim(),
              voiceName: clonedVoiceName,
              voiceModel: String(response.model || '').trim(),
              signal: controller.signal,
            });
          }
          ensureTaskActive();
          addClonedVoice(clonedVoice);
        }
        ensureTaskActive();
        const previewUrl = String(clonedVoice?.previewUrl || '').trim();
        setResult({
          previewUrl,
          downloadUrl: previewUrl,
          fileName: toAudioFileName(String(clonedVoice?.name || clonedVoice?.sourceVoiceName || 'DUNO Clone').trim() || 'DUNO Clone', 'duno-clone'),
          response: clonedVoice ? { ...response, clonedVoice } : response,
          cloneMode: 'duno_native',
        });
        return;
      }

      const targetAudioFile = targetAudio;
      if (!targetAudioFile) {
        setErrorMessage('Upload both reference audio and target audio before cloning.');
        return;
      }
      updateVoiceCloneTask({
        progress: 28,
        stage: 'Encoding target audio',
        detail: 'Compressing the conversion source clip.',
      });
      const [sourceAudioBase64, durationSec] = await Promise.all([
        targetAudioFile.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer)),
        measureAudioDurationSec(targetAudioFile),
      ]);
      ensureTaskActive();
      updateVoiceCloneTask({
        progress: 48,
        stage: 'Submitting root request',
        detail: 'Waiting for the OpenVoice runtime to render the output.',
      });
      const response = await cloneVoiceWithOpenVoice(
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
          sourceSeparationDevice: 'cpu_only',
          speed: 1,
          requestId,
          traceId: requestId,
          regionHint: '',
          regionSource: 'frontend',
          costMultiplier: 1,
        },
        backendBaseUrl ? { baseUrl: backendBaseUrl, signal: controller.signal } : { signal: controller.signal }
      );
      ensureTaskActive();
      updateVoiceCloneTask({
        progress: 84,
        stage: 'Resolving output preview',
        detail: 'Preparing the generated audio URL for the output player.',
      });
      const contentType = String(response.artifact?.contentType || targetAudioFile.type || referenceAudio.type || 'audio/wav').trim() || 'audio/wav';
      const resolvedUrl = await resolveVoiceClonePlayableAudioUrlWithFallback(response, contentType, {
        ...(backendBaseUrl ? { backendBaseUrl } : {}),
        signal: controller.signal,
      });
      ensureTaskActive();

      setResult({
        previewUrl: resolvedUrl,
        downloadUrl: resolvedUrl,
        fileName: targetAudioFile.name || 'voice-clone.wav',
        response,
        cloneMode: 'modal_vc',
      });
    } catch (error) {
      if (!mountedRef.current) return;
      if (isAbortError(error)) {
        setErrorMessage('Cloning cancelled.');
      } else {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      if (!mountedRef.current) return;
      setIsCloning(false);
      clearVoiceCloneTask();
    }
  }, [
    addClonedVoice,
    backendBaseUrl,
    clearVoiceCloneTask,
    cloneConsentAccepted,
    cloneSafetyAccepted,
    isDunoCloneMode,
    isOpenVoiceRuntimeReady,
    isVoiceCloneActionBusy,
    referenceAudio,
    startVoiceCloneTask,
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

      if (sourceMixAudio.size > MAX_STEM_EXTRACTION_SOURCE_BYTES) {
        throw new Error(
          `Source upload is ${formatBytes(sourceMixAudio.size)}. Compress the source mix or choose a shorter clip so the compressed upload stays under ${formatBytes(MAX_STEM_EXTRACTION_SOURCE_BYTES)}.`
        );
      }

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
      const stemRequest = await buildOpenVoiceStemSeparationRequest({
        sourceAudio: sourceMixAudio,
        requestId,
        sourceSeparationModel: 'htdemucs_ft',
        sourceSeparationDevice: 'cpu_only',
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
      });
      setTrimmedStemResult(null);
    } catch (error) {
      if (!mountedRef.current) return;
      if (isAbortError(error)) {
        setStemErrorMessage('Stem extraction cancelled.');
      } else {
        setStemErrorMessage(getErrorMessage(error));
      }
    } finally {
      if (!mountedRef.current) return;
      setIsExtractingStems(false);
      clearVoiceCloneTask();
    }
  }, [
    backendBaseUrl,
    clearVoiceCloneTask,
    isVoiceCloneActionBusy,
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

    if (activeToolTab === 'clone') {
      if (!result) {
        return {
          title: isDunoCloneMode ? 'Waiting for reference audio' : 'Waiting for source files',
        detail: isDunoCloneMode
            ? `Upload a reference clip and confirm consent to create a reusable ${dunoLabel} clone.`
            : 'Upload reference and target audio to create a converted preview.',
          status: isDunoCloneMode ? `${dunoLabel} native` : openVoiceProviderStatus.readyLabel,
        };
      }
      return {
        title: 'Clone ready',
        detail: isDunoCloneResponse(result.response)
          ? `The reusable ${dunoLabel} voice is ready for this session.`
          : 'Converted audio is ready to preview and download.',
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
  }, [activeToolTab, isDunoCloneMode, openVoiceProviderStatus.readyLabel, result, stemResult, voiceCloneTask]);

  return (
    <div
      className={`${isWorkspaceLayout ? `vf-voice-clone-layout ${shouldShowWorkspaceRail ? '' : 'vf-voice-clone-layout--single'}`.trim() : 'space-y-2.5 sm:space-y-3'} vf-voice-clone-shell`.trim()}
      data-voice-clone-layout={isWorkspaceLayout ? 'workspace' : 'stacked'}
    >
      <div className={isWorkspaceLayout ? 'vf-voice-clone-main space-y-3' : 'vf-voice-clone-main space-y-2.5 sm:space-y-3'}>
      <SectionCard className="p-2.5 sm:p-3.5">
        <div className="flex items-start gap-2 sm:gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-indigo-500 to-fuchsia-500 text-white shadow-[0_18px_40px_rgba(99,102,241,0.28)] ring-1 ring-white/10 sm:h-10 sm:w-10 sm:rounded-[1rem]">
            {activeToolTab === 'clone' ? <Mic2 size={17} /> : <Music2 size={17} />}
          </div>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-slate-900 sm:text-[15px]">
              {activeToolTab === 'clone' ? 'Voice Cloning' : 'Extract Voice + BG Music'}
            </h2>
            {activeToolTab === 'separate' ? (
              <p className="mt-0.5 max-w-2xl text-[10px] leading-4 text-slate-600 sm:text-[11px] sm:leading-5">
                Upload one mixed track to split out a speech-focused voice stem and a background-music stem.
              </p>
            ) : null}
          </div>
        </div>

        <div className={`rounded-xl border border-slate-200 bg-slate-50 p-0.5 sm:rounded-2xl ${denseTabs ? 'mt-1.5 sm:mt-2' : 'mt-2 sm:mt-2.5 sm:p-1'}`}>
          <div className={denseTabs ? 'vf-scrollbar-invisible flex flex-nowrap gap-1 overflow-x-auto pb-0.5' : 'grid grid-cols-2 gap-0.5 sm:gap-1'} {...voiceUtilityTabs.listProps}>
            <button
              type="button"
              {...voiceUtilityTabs.getTabProps('clone')}
              className={`${denseTabs ? 'shrink-0 min-w-[8.6rem] rounded-lg px-2 py-1.5' : 'rounded-lg px-2 py-1.5 sm:rounded-xl sm:px-3 sm:py-2'} text-left transition ${
                activeToolTab === 'clone'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <span className={`${denseTabs ? 'text-[11px]' : 'text-[12px] sm:text-sm'} block font-semibold`}>Voice Cloning</span>
              <span className={`${denseTabs ? 'hidden' : 'mt-0.5 block text-[10px] text-slate-500 sm:text-[11px]'}`}>
                {isDunoCloneMode ? `Reusable ${dunoLabel} native clones` : 'Reference + target conversion'}
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
              <span className={`${denseTabs ? 'text-[11px]' : 'text-[12px] sm:text-sm'} block font-semibold`}>Extract Voice + BG</span>
              <span className={`${denseTabs ? 'hidden' : 'mt-0.5 block text-[10px] text-slate-500 sm:text-[11px]'}`}>
                Split vocals and background
              </span>
            </button>
          </div>
        </div>

        <div
          className={`mt-2.5 space-y-2.5 sm:mt-3 sm:space-y-3 ${isWorkspaceLayout ? 'pb-28 sm:pb-32' : ''}`}
          {...voiceUtilityTabs.getPanelProps('clone')}
        >
          <div className={`grid gap-1.5 sm:gap-2 ${isDunoCloneMode ? '' : 'lg:grid-cols-2'}`}>
              <UploadDropzone
                accept="audio/*"
                file={referenceAudio}
              label="Drop reference audio"
              hint={isDunoCloneMode
                ? `This sample creates a reusable ${dunoLabel} voice clone.`
                : 'This voice will be used as the cloning reference.'}
              className="px-2 py-2 sm:px-3 sm:py-3"
              disabled={isVoiceCloneActionBusy}
              onFilesSelected={handleReferenceChange}
            />
            {!isDunoCloneMode ? (
              <UploadDropzone
                accept="audio/*"
                file={targetAudio}
                label="Drop target audio"
                hint="This clip will be converted to match the reference voice."
                className="px-2 py-2 sm:px-3 sm:py-3"
                disabled={isVoiceCloneActionBusy}
                onFilesSelected={handleTargetChange}
              />
            ) : null}
          </div>

          <div className={`grid gap-1.5 sm:gap-2 ${isDunoCloneMode ? '' : 'sm:grid-cols-2'}`}>
            <VoiceClonePreviewPlayer
              label="Reference audio"
              name={referenceAudio?.name || 'Not selected'}
              meta={formatFileSize(referenceAudio)}
              previewUrl={referencePreviewUrl}
              fallback="Upload a reference clip to preview it here."
              tone="source"
            />
            {!isDunoCloneMode ? (
              <VoiceClonePreviewPlayer
                label="Target audio"
                name={targetAudio?.name || 'Not selected'}
                meta={formatFileSize(targetAudio)}
                previewUrl={targetPreviewUrl}
                fallback="Upload a target clip to preview it here."
                tone="source"
              />
            ) : null}
          </div>

          {!isDunoCloneMode ? (
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
                      void refreshOpenVoiceStatus(true);
                    }}
                  >
                    {isLoadingOpenVoiceStatus ? 'Checking Availability...' : 'Check Availability'}
                  </Button>
                  {!isOpenVoiceRuntimeReady ? (
                    <span className="text-[10px] text-slate-500 sm:text-[11px]">
                      Availability checks auto-retry every {Math.round(OPENVOICE_STATUS_RETRY_INTERVAL_MS / 1000)}s while the provider is not ready.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
          ) : null}

          {!isDunoCloneMode && openVoiceStatusError ? (
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
              {isDunoCloneMode
                ? `${dunoLabel} native cloning creates a reusable voice for ${dunoLabel} synthesis in this session.`
                : 'Modal VC requests are billed by the backend and require runtime readiness.'}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {!isWorkspaceLayout && !isDunoCloneMode && canSeeStressControls ? (
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
                {isDunoCloneMode ? `Create ${dunoLabel} Clone` : 'Start Cloning'}
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
      </SectionCard>

      {!isWorkspaceLayout && activeToolTab === 'clone' && result ? (
        <SectionCard className="p-3 sm:p-3.5">
          <div className="flex items-start justify-between gap-2.5 sm:gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900 sm:text-[15px]">Cloning result</h3>
              <p className="mt-0.5 text-[10px] leading-4 text-slate-600 sm:text-[11px] sm:leading-5">
                {isDunoCloneResponse(result.response)
                  ? `The ${dunoLabel} clone is ready and available for ${dunoLabel} synthesis in this session.`
                  : 'The converted audio is ready to preview and download.'}
              </p>
              {!isDunoCloneResponse(result.response) ? (
                <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                  VC used: {Math.max(0, Number(result.response.consumedVcUnits || result.response.vcBilling?.consumedUnits || 0)).toFixed(0)} units
                </p>
              ) : null}
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
            meta={isDunoCloneResponse(result.response)
              ? `${dunoLabel} voice id: ${String(result.response.voiceId || '').trim() || 'unavailable'}`
              : (result.response.artifact?.downloadUrl
                  ? 'Backend artifact URL available'
                  : 'Inline audio data generated locally')}
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
                  {!isDunoCloneMode ? (
                    <VoiceClonePreviewPlayer
                      label="Target audio"
                      name={targetAudio?.name || 'Not selected'}
                      meta={formatFileSize(targetAudio)}
                      previewUrl={targetPreviewUrl}
                      fallback="Upload a target clip to preview it here."
                      tone="source"
                    />
                  ) : null}
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
          ) : (
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
          )}

          {!isDunoCloneMode ? (
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
                        void refreshOpenVoiceStatus(true);
                      }}
                    >
                      Check Availability
                    </Button>
                    {!isDunoCloneMode && canSeeStressControls ? (
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
