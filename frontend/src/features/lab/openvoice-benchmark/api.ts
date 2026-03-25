import type { ClonedVoice } from '../../../../types';

export interface OpenVoiceBenchmarkRequest {
  mode: 'tts' | 'vc' | 'tts_then_vc';
  runKind: 'warm' | 'cold';
  durationSec: number;
  language: string;
  text: string;
  referenceAudioBase64: string;
  referenceAudioName: string;
  sourceAudioBase64: string;
  sourceAudioName: string;
  speed: number;
  requestId: string;
  traceId: string;
  regionHint: string;
  regionSource: string;
  costMultiplier: number;
}

export interface OpenVoiceBenchmarkTimings {
  loadMs?: number;
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
}

export interface OpenVoiceCloneVoice extends ClonedVoice {
  originalSampleUrl: string;
}
