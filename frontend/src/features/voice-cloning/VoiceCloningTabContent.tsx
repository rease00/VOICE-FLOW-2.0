import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
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
import { useUser } from '../../../contexts/UserContext';
import { getSharedAudioContext } from '../../../src/shared/audio/audioContext';
import { arrayBufferToBase64 } from '../../../src/shared/audio/base64';
import { audioBufferToWav } from '../../../src/shared/audio/wav';
import { hasActiveAdminActor } from '../../shared/auth/adminAccess';
import { useManagedTabs } from '../../../src/shared/ui/tabs';
import type { UserProfile } from '../../../types';
import { resolveVoiceClonePlayableAudioUrlWithFallback } from './audio';
import {
  cancelVoiceCloneStressTest,
  cloneVoiceWithOpenVoice,
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
  backendBaseUrl?: string;
}

interface CloningResultState {
  previewUrl: string;
  downloadUrl: string;
  fileName: string;
  response: OpenVoiceCloneResponse;
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

const VOICE_UTILITY_TAB_ITEMS: Array<{ id: VoiceUtilityTab }> = [
  { id: 'clone' },
  { id: 'separate' },
];

const TRIM_DURATION_EPSILON = 0.001;
const MAX_STEM_EXTRACTION_SOURCE_BYTES = getOpenVoiceStemExtractionMaxBytes();

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error || 'Unable to start voice cloning.');
};

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
    ? 'L4 (configured target)'
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
    if (!referenceAudio) return 'Reference audio is required for the OpenVoice L4 VC benchmark.';
    if (!targetAudio) return 'Target audio is required for the OpenVoice L4 VC benchmark.';
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
                  <option value="OPENVOICE_L4_VC">OpenVoice L4 VC</option>
                  <option value="GEMINI_FLASH_TTS">Gemini Flash TTS</option>
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
}) => {
  const { user } = useUser();
  const [activeToolTab, setActiveToolTab] = useState<VoiceUtilityTab>('clone');
  const [referenceAudio, setReferenceAudio] = useState<File | null>(null);
  const [targetAudio, setTargetAudio] = useState<File | null>(null);
  const [isCloning, setIsCloning] = useState(false);
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

  const canStartCloning = useMemo(
    () => Boolean(referenceAudio && targetAudio && !isCloning),
    [isCloning, referenceAudio, targetAudio]
  );

  const canExtractStems = useMemo(
    () => Boolean(sourceMixAudio && !isExtractingStems),
    [isExtractingStems, sourceMixAudio]
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
    && !sourceTrimValidationMessage
  );

  const activeStemResult = trimmedStemResult || stemResult;
  const stemTrimValidationMessage = useMemo(() => {
    if (!stemResult) return '';
    return validateTrimRange(stemTrimStartInput, stemTrimEndInput, stemResult.durationSec);
  }, [stemResult, stemTrimEndInput, stemTrimStartInput]);
  const canApplyStemTrim = Boolean(
    stemResult && !isTrimmingStems && !stemTrimValidationMessage
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
          throw new Error('Both reference and target audio are required for the OpenVoice stress benchmark.');
        }
        const [referenceAudioBase64, sourceAudioBase64] = await Promise.all([
          referenceAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer)),
          targetAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer)),
        ]);
        payload.referenceAudioBase64 = referenceAudioBase64;
        payload.referenceAudioName = referenceAudio.name || 'reference.wav';
        payload.sourceAudioBase64 = sourceAudioBase64;
        payload.sourceAudioName = targetAudio.name || 'target.wav';
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
    let cancelled = false;
    setIsLoadingOpenVoiceStatus(true);
    setOpenVoiceStatusError('');
    void fetchOpenVoiceCloneStatus(
      backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
    )
      .then((status) => {
        if (!cancelled) {
          setOpenVoiceStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setOpenVoiceStatusError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingOpenVoiceStatus(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [backendBaseUrl]);

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
    if (isCloning) return;
    setReferenceAudio(files[0] || null);
    clearResult();
  }, [clearResult, isCloning]);

  const handleTargetChange = useCallback((files: File[]) => {
    if (isCloning) return;
    setTargetAudio(files[0] || null);
    clearResult();
  }, [clearResult, isCloning]);

  const handleSourceMixChange = useCallback((files: File[]) => {
    setSourceMixAudio(files[0] || null);
    setSourceTrimErrorMessage('');
    setTrimmedSourceMix(null);
    clearStemResult();
  }, [clearStemResult]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCloning) return;
    if (!referenceAudio || !targetAudio) {
      setErrorMessage('Upload both reference audio and target audio before cloning.');
      return;
    }

    setIsCloning(true);
    setErrorMessage('');
    setResult(null);

    try {
      const [referenceAudioBase64, sourceAudioBase64, durationSec] = await Promise.all([
        referenceAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer)),
        targetAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer)),
        measureAudioDurationSec(targetAudio),
      ]);
      const requestId = makeRequestId();
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
          sourceAudioName: targetAudio.name || 'target-audio.wav',
          extractSourceVocals: true,
          sourceSeparationModel: 'mdx_extra_q',
          sourceSeparationDevice: 'cpu_only',
          speed: 1,
          requestId,
          traceId: requestId,
          regionHint: '',
          regionSource: 'frontend',
          costMultiplier: 1,
        },
        backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
      );
      const contentType = String(response.artifact?.contentType || targetAudio.type || referenceAudio.type || 'audio/wav').trim() || 'audio/wav';
      const resolvedUrl = await resolveVoiceClonePlayableAudioUrlWithFallback(response, contentType);

      setResult({
        previewUrl: resolvedUrl,
        downloadUrl: resolvedUrl,
        fileName: targetAudio.name || 'voice-clone.wav',
        response,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsCloning(false);
    }
  }, [backendBaseUrl, isCloning, referenceAudio, targetAudio]);

  const handleApplySourceTrim = useCallback(async () => {
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
  }, [sourceMixAudio, sourceMixDurationSec, sourceTrimEndInput, sourceTrimStartInput]);

  const handleExtractStems = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sourceMixAudio) {
      setStemErrorMessage('Upload a source mix before extracting voice and background stems.');
      return;
    }
    if (sourceTrimValidationMessage) {
      setStemErrorMessage(sourceTrimValidationMessage);
      return;
    }

    setIsExtractingStems(true);
    setStemErrorMessage('');
    setStemResult(null);
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

      const requestId = makeRequestId();
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
      const response = await separateVoiceAndBackgroundWithDemucs(
        stemRequest,
        backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
      );
      const vocalsUrl = String(response.vocalsArtifact?.downloadUrl || '').trim();
      const backgroundUrl = String(response.backgroundArtifact?.downloadUrl || '').trim();
      if (!vocalsUrl || !backgroundUrl) {
        throw new Error('Demucs separation completed but no download artifacts were returned.');
      }
      const durationSecFromRuntime = Number(response.runtime?.sourceSeparation?.durationSec || 0);
      const fallbackDurationSec = (hasExplicitSourceTrim && matchesAppliedTrim)
        ? Math.max(0.01, sourceTrimEndSec - sourceTrimStartSec)
        : await measureAudioDurationSecPrecise(sourceMixAudio);
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
      setStemErrorMessage(getErrorMessage(error));
    } finally {
      setIsExtractingStems(false);
    }
  }, [
    backendBaseUrl,
    sourceMixAudio,
    sourceMixDurationSec,
    sourceTrimEndInput,
    sourceTrimStartInput,
    sourceTrimValidationMessage,
    trimmedSourceMix,
  ]);

  const handleApplyStemTrim = useCallback(async () => {
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
  }, [stemResult, stemTrimEndInput, stemTrimStartInput]);

  return (
    <div className="space-y-4">
      <SectionCard className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
            {activeToolTab === 'clone' ? <Mic2 size={18} /> : <Music2 size={18} />}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">
              {activeToolTab === 'clone' ? 'Voice Cloning' : 'Extract Voice + BG Music'}
            </h2>
            {activeToolTab === 'separate' ? (
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Upload one mixed track to split out a speech-focused voice stem and a background-music stem.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-1">
          <div className="grid grid-cols-2 gap-1" {...voiceUtilityTabs.listProps}>
            <button
              type="button"
              {...voiceUtilityTabs.getTabProps('clone')}
              className={`rounded-xl px-3 py-2 text-left transition ${
                activeToolTab === 'clone'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <span className="block text-sm font-semibold">Voice Cloning</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Reference + target conversion
              </span>
            </button>
            <button
              type="button"
              {...voiceUtilityTabs.getTabProps('separate')}
              className={`rounded-xl px-3 py-2 text-left transition ${
                activeToolTab === 'separate'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <span className="block text-sm font-semibold">Extract Voice + BG</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Split vocals and background
              </span>
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-4" {...voiceUtilityTabs.getPanelProps('clone')}>
          <div className="grid gap-4 lg:grid-cols-2">
            <UploadDropzone
              accept="audio/*"
              file={referenceAudio}
              label="Drop reference audio"
              hint="This voice will be used as the cloning reference."
              disabled={isCloning}
              onFilesSelected={handleReferenceChange}
            />
            <UploadDropzone
              accept="audio/*"
              file={targetAudio}
              label="Drop target audio"
              hint="This clip will be converted to match the reference voice."
              disabled={isCloning}
              onFilesSelected={handleTargetChange}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FileAudio size={16} className="text-indigo-600" />
                <span>Reference audio</span>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                <span className="font-medium text-slate-700">{referenceAudio?.name || 'Not selected'}</span>
                <span className="mx-2 text-slate-400">-</span>
                <span>{formatFileSize(referenceAudio)}</span>
              </div>
              {referencePreviewUrl ? (
                <audio className="mt-3 w-full" controls preload="metadata" src={referencePreviewUrl} />
              ) : (
                <p className="mt-2 text-xs text-slate-500">Upload a reference clip to preview it here.</p>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FileAudio size={16} className="text-indigo-600" />
                <span>Target audio</span>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                <span className="font-medium text-slate-700">{targetAudio?.name || 'Not selected'}</span>
                <span className="mx-2 text-slate-400">-</span>
                <span>{formatFileSize(targetAudio)}</span>
              </div>
              {targetPreviewUrl ? (
                <audio className="mt-3 w-full" controls preload="metadata" src={targetPreviewUrl} />
              ) : (
                <p className="mt-2 text-xs text-slate-500">Upload a target clip to preview it here.</p>
              )}
            </div>
          </div>

          <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 sm:grid-cols-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Provider</div>
              <div className="mt-1 font-semibold text-slate-900">
                {isLoadingOpenVoiceStatus ? 'Loading...' : openVoiceProviderStatus.activeProviderLabel}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Readiness</div>
              <div className="mt-1 font-semibold text-slate-900">{openVoiceProviderStatus.readyLabel}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Device</div>
              <div className="mt-1 font-semibold text-slate-900">{openVoiceProviderStatus.device}</div>
            </div>
          </div>

          {openVoiceStatusError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              {openVoiceStatusError}
            </div>
          ) : null}

          <form className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between" onSubmit={handleSubmit}>
            <div className="text-xs text-slate-500">
              VC requests are billed by the backend.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canSeeStressControls ? (
                <Button
                  type="button"
                  variant="secondary"
                  icon={<Gauge size={14} />}
                  onClick={openStressModal}
                >
                  Stress Test (L4 + Gemini Flash)
                </Button>
              ) : null}
              <Button
                className="sm:min-w-44"
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
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="mt-4 space-y-4" {...voiceUtilityTabs.getPanelProps('separate')}>
          <UploadDropzone
            accept="audio/*"
            file={sourceMixAudio}
            label="Drop source mix audio"
            hint="Upload a single mixed track to split vocals and background."
            onFilesSelected={handleSourceMixChange}
          />

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FileAudio size={16} className="text-indigo-600" />
              <span>Source mix</span>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {sourceMixAudio ? (
                <>
                  <span className="font-medium text-slate-700">{sourceMixAudio.name}</span>
                  <span className="mx-2 text-slate-400">-</span>
                  <span>{formatFileSize(sourceMixAudio)}</span>
                </>
              ) : (
                <span className="font-medium text-slate-600">No file selected</span>
              )}
            </div>
            {sourceMixPreviewUrl ? (
              <audio className="mt-3 w-full" controls preload="metadata" src={sourceMixPreviewUrl} />
            ) : (
              <p className="mt-2 text-xs text-slate-500">Upload a mixed clip to preview it here.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Trim source before extraction</div>
                <p className="mt-1 text-xs text-slate-500">
                  Set a source range, then Demucs will run only on that trimmed section.
                </p>
              </div>
              <div className="text-xs text-slate-500">
                Source duration: {sourceMixDurationSec > 0 ? formatDuration(sourceMixDurationSec) : '--:--'}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Source trim start (seconds)</span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  disabled={!sourceMixAudio}
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
                <span className="mb-1 block text-xs font-medium text-slate-600">Source trim end (seconds)</span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  disabled={!sourceMixAudio}
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
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
                {sourceTrimErrorMessage || sourceTrimValidationMessage}
              </div>
            ) : null}

            {trimmedSourceMix ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Source trim applied locally: {formatTrimSeconds(trimmedSourceMix.startSec)}s - {formatTrimSeconds(trimmedSourceMix.endSec)}s. Extraction sends the compressed source mix plus this trim range.
              </div>
            ) : !sourceMixAudio ? (
              <p className="mt-3 text-xs text-slate-500">
                Upload a source mix to enable source trimming.
              </p>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Leave start at 0 and end at full duration to process the full source mix.
              </p>
            )}

            {trimmedSourceMix ? (
              <audio className="mt-3 w-full" controls preload="metadata" src={trimmedSourceMix.previewUrl} />
            ) : null}
          </div>

          <form className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" onSubmit={handleExtractStems}>
            <div className="text-xs text-slate-500">
              Demucs runs on the backend to generate downloadable vocals and background WAV stems.
            </div>
            <Button
              className="sm:min-w-56"
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
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
              {stemErrorMessage}
            </div>
          ) : null}
        </div>
      </SectionCard>

      {activeToolTab === 'clone' && result ? (
        <SectionCard className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Cloning result</h3>
              <p className="mt-1 text-sm text-slate-600">
                The converted audio is ready to preview and download.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                VC used: {Math.max(0, Number(result.response.consumedVcUnits || result.response.vcBilling?.consumedUnits || 0)).toFixed(0)} units
              </p>
            </div>
            {result.response.status ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {result.response.status}
              </span>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FileAudio size={16} className="text-indigo-600" />
              <span>Output audio</span>
            </div>
            {result.previewUrl ? (
              <audio className="mt-3 w-full" controls preload="metadata" src={result.previewUrl} />
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Output was generated, but no preview URL was returned by the backend.
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              {result.response.artifact?.downloadUrl ? 'Backend artifact URL available. Preview/download use inline audio.' : 'Inline audio data generated locally for preview.'}
            </div>
            <a
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              download={result.fileName}
              href={result.downloadUrl}
            >
              <Download size={14} />
              Download
            </a>
          </div>
        </SectionCard>
      ) : null}

      {activeToolTab === 'separate' && stemResult ? (
        <SectionCard className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Extraction result</h3>
              <p className="mt-1 text-sm text-slate-600">
                Voice and background stems are ready to preview and download.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Processed duration: {formatDuration(stemResult.durationSec)}
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Ready
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Trim both stems together</div>
                <p className="mt-1 text-xs text-slate-500">
                  Apply one trim range to the vocals and background outputs at the same time.
                </p>
              </div>
              <div className="text-xs text-slate-500">
                Duration: {formatDuration(stemResult.durationSec)}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Trim start (seconds)</span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={stemTrimStartInput}
                  onChange={(event) => setStemTrimStartInput(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Trim end (seconds)</span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
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

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {trimmedStemResult ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
                  Trim applied: {formatTrimSeconds(trimmedStemResult.startSec)}s - {formatTrimSeconds(trimmedStemResult.endSec)}s
                </span>
              ) : (
                <span>Trim will update both preview and download links once applied.</span>
              )}
            </div>

            {stemTrimValidationMessage || stemTrimErrorMessage ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
                {stemTrimErrorMessage || stemTrimValidationMessage}
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FileAudio size={16} className="text-indigo-600" />
                <span>Voice stem (vocals)</span>
              </div>
              <audio className="mt-3 w-full" controls preload="metadata" src={activeStemResult?.vocalsPreviewUrl || stemResult.vocalsPreviewUrl} />
              <a
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                download={activeStemResult?.vocalsFileName || stemResult.vocalsFileName}
                href={activeStemResult?.vocalsDownloadUrl || stemResult.vocalsDownloadUrl}
              >
                <Download size={14} />
                Download vocals
              </a>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FileAudio size={16} className="text-indigo-600" />
                <span>Background stem (music/bed)</span>
              </div>
              <audio className="mt-3 w-full" controls preload="metadata" src={activeStemResult?.backgroundPreviewUrl || stemResult.backgroundPreviewUrl} />
              <a
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                download={activeStemResult?.backgroundFileName || stemResult.backgroundFileName}
                href={activeStemResult?.backgroundDownloadUrl || stemResult.backgroundDownloadUrl}
              >
                <Download size={14} />
                Download background
              </a>
            </div>
          </div>
        </SectionCard>
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
