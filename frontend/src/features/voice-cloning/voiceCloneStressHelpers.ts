import type { UserProfile } from '../../../types';
import { hasActiveAdminActor } from '../../shared/auth/adminAccess';
import type {
  VoiceCloneStressBenchmarkTarget,
  VoiceCloneStressConfig,
  VoiceCloneStressStatusResponse,
} from './api';

const STRESS_RPM_INCREMENT = 5;

export const normalizeVoiceCloneStressTarget = (target: VoiceCloneStressBenchmarkTarget | string): VoiceCloneStressBenchmarkTarget | string => {
  const token = String(target || '').trim().toUpperCase();
  if (token === 'OPENVOICE_L4_VC') return 'VOICE_CLONE_L4_VC';
  if (token === 'VOICE_CLONE_L4_VC') return 'VOICE_CLONE_L4_VC';
  if (token === 'GEMINI_FLASH_TTS') return 'GEMINI_FLASH_TTS';
  return target;
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error || 'Unable to start voice cloning.');
};

const roundStressRpm = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return STRESS_RPM_INCREMENT;
  return Math.max(STRESS_RPM_INCREMENT, Math.round(value / STRESS_RPM_INCREMENT) * STRESS_RPM_INCREMENT);
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

export const deriveStressRpmFromConcurrency = (
  concurrency: number
): Pick<VoiceCloneStressConfig, 'startRpm' | 'stepRpm' | 'maxRpm'> => {
  const safeConcurrency = Math.min(128, Math.max(1, Math.floor(Number(concurrency) || 0)));
  const startRpm = roundStressRpm(safeConcurrency * 10);
  const stepRpm = roundStressRpm(Math.max(STRESS_RPM_INCREMENT, safeConcurrency * 5));
  const maxRpm = roundStressRpm(Math.max(safeConcurrency * 20, startRpm + stepRpm));
  return { startRpm, stepRpm, maxRpm };
};

export const isVoiceCloneStressTerminalStatus = (status: string): boolean => {
  const token = String(status || '').trim().toLowerCase();
  return token === 'completed' || token === 'failed' || token === 'cancelled';
};

export const isVoiceCloneStressActiveStatus = (status: string): boolean => {
  const token = String(status || '').trim().toLowerCase();
  return token === 'queued' || token === 'running';
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

  const target = normalizeVoiceCloneStressTarget(benchmarkTarget);
  return target === 'VOICE_CLONE_L4_VC'
    ? 'Seed VC (configured target)'
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

  const target = normalizeVoiceCloneStressTarget(benchmarkTarget);
  if (target === 'VOICE_CLONE_L4_VC') {
    if (!referenceAudio) return 'Reference audio is required for the Seed VC benchmark.';
    if (!targetAudio) return 'Target audio is required for the Seed VC benchmark.';
    return '';
  }

  if (!String(geminiText || '').trim()) return 'Gemini Flash benchmark text is required.';
  if (!String(geminiVoiceName || '').trim()) return 'Gemini Flash benchmark voice name is required.';
  return '';
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
