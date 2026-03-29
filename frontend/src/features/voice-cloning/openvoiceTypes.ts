import type { ClonedVoice } from '../../../types';

export interface OpenVoiceBenchmarkRequest {
  mode: 'tts' | 'vc' | 'tts_then_vc';
  runKind: 'warm' | 'cold';
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
    reservedUnits?: number;
    consumedUnits?: number;
    durationSec?: number;
    textChars?: number;
    charsPerUnit?: number;
    rule?: string;
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
  activeProvider?: string;
  defaultProvider?: string;
  revision?: number | string;
  updatedAt?: string;
  updatedBy?: string;
  provider?: OpenVoiceRuntimeProviderStatus;
}

export interface OpenVoiceProviderRuntimeStatus {
  configured?: boolean;
  ready?: boolean;
  detail?: string;
  device?: string;
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

export type VoiceCloneStressBenchmarkTarget = 'OPENVOICE_L4_VC' | 'GEMINI_FLASH_TTS';

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
  if (token === 'cloud_run') return 'Cloud Run';
  if (token === 'modal') return 'Modal';
  return token.replaceAll('_', ' ');
};

export const getOpenVoiceProviderDisplayStatus = (
  status: OpenVoiceBenchmarkStatusResponse | null | undefined
): {
  activeProvider: string;
  activeProviderLabel: string;
  readyLabel: string;
  detail: string;
  device: string;
} => {
  const providerPayload = status?.provider && typeof status.provider === 'object' ? status.provider : null;
  const activeProvider = String(
    providerPayload?.activeProvider ||
      status?.activeProvider ||
      status?.runtime?.vcProvider ||
      ''
  ).trim();
  const providers = providerPayload?.providers || {};
  const activeProviderInfo = (
    activeProvider && typeof providers === 'object'
      ? providers[activeProvider]
      : null
  ) || null;
  const ready = Boolean(
    activeProviderInfo?.ready ??
      status?.ready ??
      status?.supportsVC ??
      false
  );
  const detail = String(
    activeProviderInfo?.detail ||
      providerPayload?.updatedBy ||
      status?.detail ||
      status?.state ||
      (ready ? 'Ready' : 'Not ready') ||
      ''
  ).trim();
  const device = String(
    activeProviderInfo?.device ||
      status?.runtime?.device ||
      status?.device ||
      ''
  ).trim();

  return {
    activeProvider: activeProvider || 'unknown',
    activeProviderLabel: prettyProviderLabel(activeProvider),
    readyLabel: ready ? 'Ready' : 'Not ready',
    detail: detail || 'No runtime details available.',
    device: device || 'Not available',
  };
};
