import type { ClonedVoice } from '../../../types';

export interface OpenVoiceBenchmarkRequest {
  mode: 'tts' | 'vc' | 'tts_then_vc';
  runKind: 'warm' | 'cold';
  seedVcVersion?: 'v1' | 'v2';
  durationSec: number;
  language: string;
  text: string;
  sourceVoiceId: string;
  sourceVoiceName: string;
  sourceVoiceEngine: string;
  referenceAudioBase64: string;
  referenceAudioName: string;
  referenceAudioUrl: string;
  sourceAudioBase64: string;
  sourceAudioName: string;
  sourceTrimStartSec?: number;
  sourceTrimEndSec?: number;
  extractSourceVocals?: boolean;
  sourceSeparationModel?: string;
  sourceSeparationDevice?: string;
  speed: number;
  requestId: string;
  traceId: string;
  regionHint: string;
  regionSource: string;
  costMultiplier: number;
}

export interface OpenVoiceBenchmarkTimings {
  loadMs?: number;
  sourceSeparationMs?: number;
  ttsMs?: number;
  vcMs?: number;
  queueWaitMs?: number;
  firstAudioMs?: number;
  totalMs?: number;
  cpuSeconds?: number;
  gpuSeconds?: number;
}

export interface OpenVoiceBenchmarkCost {
  gpuRatePerSecondUsd?: number;
  cpuRatePerSecondUsd?: number;
  costMultiplier?: number;
  gpuCostUsd?: number;
  cpuCostUsd?: number;
  estimatedCostUsd?: number;
  estimatedOneHourUsd?: number;
  estimatedOneDayUsd?: number;
}

export interface OpenVoiceBenchmarkArtifact {
  artifactId?: string;
  fileName?: string;
  contentType?: string;
  downloadUrl?: string;
  sizeBytes?: number;
  durationSec?: number;
}

export interface OpenVoiceBenchmarkRuntime {
  device?: string;
  warmStartObserved?: boolean;
  referenceCacheEntries?: number;
  sourceCacheEntries?: number;
  loadedLanguages?: string[];
  vcProvider?: string;
  sourceSeparation?: {
    enabled?: boolean;
    model?: string;
    device?: string;
    pipeline?: string;
    cacheKey?: string;
    durationSec?: number;
    timeoutSec?: number;
  };
}

export interface OpenVoiceBenchmarkResponse {
  ok?: boolean;
  status?: string;
  mode?: 'tts' | 'vc' | 'tts_then_vc' | string;
  runKind?: 'warm' | 'cold' | string;
  seedVcVersion?: 'v1' | 'v2' | string;
  requestId?: string;
  traceId?: string;
  language?: string;
  textChars?: number;
  targetDurationSec?: number;
  timings?: OpenVoiceBenchmarkTimings;
  cost?: OpenVoiceBenchmarkCost;
  runtime?: OpenVoiceBenchmarkRuntime;
  artifact?: OpenVoiceBenchmarkArtifact;
  audioBase64?: string;
  notes?: string[];
  message?: string;
  sourceVoiceId?: string;
  sourceVoiceName?: string;
  sourceVoiceEngine?: string;
  referenceArtifactId?: string;
  referenceAudioUrl?: string;
  referenceAudioName?: string;
  consumedVcUnits?: number;
  vcBilling?: {
    enabled?: boolean;
    adminBypass?: boolean;
    reservedUnits?: number;
    consumedUnits?: number;
    chargedInr?: number;
    durationSec?: number;
    billableDurationSec?: number;
    textChars?: number;
    rateInrPerMin?: number;
    rateVcUnitsPerMin?: number;
    rule?: string;
    breakdown?: {
      vcFree?: number;
      vcGranted?: number;
      vcPaid?: number;
    };
    remaining?: {
      vcFreeBalance?: number;
      vcGrantedBalance?: number;
      vcPaidBalance?: number;
      vcSpendableBalance?: number;
    };
    idempotentReuse?: boolean;
    stages?: Record<string, unknown>;
  };
  clonedVoice?: ClonedVoice;
}

export interface OpenVoiceBenchmarkStatusResponse {
  ok: boolean;
  state?: string;
  detail?: string;
  device?: string;
  warm?: boolean;
  engine?: string;
  supportsVC?: boolean;
  ready?: boolean;
  health?: string;
  capabilities?: Record<string, unknown>;
  runtime?: {
    device?: string;
    vcProvider?: string;
  };
  provider?: string;
  providerLabel?: string;
  configured?: boolean;
  expectedGpuConcurrency?: number;
  runtimeGpuConcurrency?: number;
  concurrencyVerified?: boolean;
  activeProvider?: string;
  defaultProvider?: string;
  revision?: number | string;
  updatedAt?: string;
  updatedBy?: string;
  providerStatus?: OpenVoiceProviderRuntimeStatus & {
    key?: string;
    expectedGpuConcurrency?: number;
    runtimeGpuConcurrency?: number;
    concurrencyVerified?: boolean;
  };
}

export interface OpenVoiceProviderRuntimeStatus {
  configured?: boolean;
  ready?: boolean;
  detail?: string;
  device?: string;
  activeProvider?: string;
  defaultProvider?: string;
}

export interface OpenVoiceRuntimeProviderStatus {
  activeProvider?: string;
  defaultProvider?: string;
  revision?: number | string;
  updatedAt?: string;
  updatedBy?: string;
  providers?: Record<string, OpenVoiceProviderRuntimeStatus | undefined>;
}

export interface OpenVoiceCloneVoice extends ClonedVoice {
  originalSampleUrl: string;
}

export type VoiceCloneBenchmarkRequest = OpenVoiceBenchmarkRequest;
export type VoiceCloneBenchmarkTimings = OpenVoiceBenchmarkTimings;
export type VoiceCloneBenchmarkCost = OpenVoiceBenchmarkCost;
export type VoiceCloneBenchmarkArtifact = OpenVoiceBenchmarkArtifact;
export type VoiceCloneBenchmarkRuntime = OpenVoiceBenchmarkRuntime;
export type VoiceCloneBenchmarkResponse = OpenVoiceBenchmarkResponse;
export type VoiceCloneBenchmarkStatusResponse = OpenVoiceBenchmarkStatusResponse;
export type VoiceCloneProviderRuntimeStatus = OpenVoiceProviderRuntimeStatus;
export type VoiceCloneRuntimeProviderStatus = OpenVoiceRuntimeProviderStatus;
export type VoiceCloneCloneVoice = OpenVoiceCloneVoice;

export type VoiceCloneStressBenchmarkTarget =
  | 'VOICE_CLONE_L4_VC'
  | 'OPENVOICE_L4_VC'
  | 'GEMINI_FLASH_TTS';

export interface VoiceCloneStressConfig {
  startRpm: number;
  stepRpm: number;
  maxRpm: number;
  stepDurationSec: number;
  concurrency: number;
  maxFailureRate: number;
  maxP95Ms: number;
  warmupRequests: number;
  requestTimeoutSec: number;
}

export interface VoiceCloneStressStartRequest {
  benchmarkTarget: VoiceCloneStressBenchmarkTarget;
  config: VoiceCloneStressConfig;
  referenceAudioBase64?: string;
  referenceAudioName?: string;
  sourceAudioBase64?: string;
  sourceAudioName?: string;
  text?: string;
  voiceName?: string;
}

export interface VoiceCloneStressStepResult {
  step: number;
  targetRpm: number;
  achievedRpm: number;
  successRate: number;
  p95Ms: number;
  requestCount: number;
  successCount: number;
  errorCount: number;
  errorBuckets?: Record<string, number>;
  gpuSecondsTotal?: number;
  durationMs: number;
  pass: boolean;
}

export interface VoiceCloneStressSummary {
  maxSustainableRpm: number;
  lastPassingStepIndex: number;
  totalRequests: number;
  totalSuccess: number;
  totalFailure: number;
  stopReason: string;
  startedAtMs: number;
  finishedAtMs: number;
}

export interface VoiceCloneStressStatusResponse {
  ok: boolean;
  jobId: string;
  benchmarkTarget: VoiceCloneStressBenchmarkTarget | string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  config?: Partial<VoiceCloneStressConfig>;
  progress?: {
    currentStep?: number;
    stepsCompleted?: number;
    totalSteps?: number;
  };
  runtimePreflight?: Record<string, unknown>;
  runtimeDeviceSamples?: string[];
  steps?: VoiceCloneStressStepResult[];
  summary?: Partial<VoiceCloneStressSummary>;
}

const prettyProviderLabel = (value: string): string => {
  const token = String(value || '').trim();
  if (!token) return 'Unknown';
  if (token === 'modal') return 'Modal';
  return token.replaceAll('_', ' ');
};

export const getVoiceCloneProviderDisplayStatus = (
  status: OpenVoiceBenchmarkStatusResponse | null | undefined
): {
  activeProvider: string;
  activeProviderLabel: string;
  readyLabel: string;
  detail: string;
  device: string;
  expectedGpuConcurrency: number;
  runtimeGpuConcurrency: number;
  concurrencyVerified: boolean;
} => {
  const providerPayload = status?.providerStatus && typeof status.providerStatus === 'object' ? status.providerStatus : null;
  const activeProvider = String(
    providerPayload?.key ||
      status?.provider ||
      status?.providerLabel ||
      status?.activeProvider ||
      status?.runtime?.vcProvider ||
      ''
  ).trim();
  const ready = Boolean(
    providerPayload?.ready ??
      status?.ready ??
      status?.supportsVC ??
      false
  );
  const detail = String(
    providerPayload?.detail ||
      status?.detail ||
      status?.state ||
      (ready ? 'Ready' : 'Not ready') ||
      ''
  ).trim();
  const device = String(
    providerPayload?.device ||
      status?.runtime?.device ||
      status?.device ||
      ''
  ).trim();
  const expectedGpuConcurrency = Math.max(
    0,
    Number(
      providerPayload?.expectedGpuConcurrency ??
      status?.expectedGpuConcurrency ??
      0
    ) || 0
  );
  const runtimeGpuConcurrency = Math.max(
    0,
    Number(
      providerPayload?.runtimeGpuConcurrency ??
      status?.runtimeGpuConcurrency ??
      0
    ) || 0
  );
  const concurrencyVerified = Boolean(
    providerPayload?.concurrencyVerified ??
    status?.concurrencyVerified ??
    false
  );

  return {
    activeProvider: activeProvider || 'unknown',
    activeProviderLabel: prettyProviderLabel(activeProvider),
    readyLabel: ready ? 'Ready' : 'Not ready',
    detail: detail || 'No runtime details available.',
    device: device || 'Not available',
    expectedGpuConcurrency,
    runtimeGpuConcurrency,
    concurrencyVerified,
  };
};

export const getOpenVoiceProviderDisplayStatus = getVoiceCloneProviderDisplayStatus;
