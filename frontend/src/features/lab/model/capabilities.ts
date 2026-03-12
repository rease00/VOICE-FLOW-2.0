import type { LabCapabilityProfile, LabCapabilityTier } from '../../../../types';

interface NavigatorLike {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  gpu?: unknown;
}

interface WindowLike {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  OffscreenCanvas?: typeof OffscreenCanvas;
  indexedDB?: IDBFactory;
  isSecureContext?: boolean;
}

export interface LabCapabilityInput {
  navigatorLike?: NavigatorLike | null;
  windowLike?: WindowLike | null;
  workerSupported?: boolean;
  ffmpegSupported?: boolean;
  runtimeMetrics?: {
    hydrationMs?: number;
    waveformRenderMs?: number;
    previewRenderMs?: number;
  };
}

const DEFAULT_MAX_DURATION_MS_BY_TIER: Record<LabCapabilityTier, number> = {
  low: 6 * 60 * 1000,
  standard: 18 * 60 * 1000,
  high: 45 * 60 * 1000,
};

const RUNTIME_GUARDRAILS = {
  hydrationMs: 1800,
  waveformRenderMs: 1200,
  previewRenderMs: 2200,
} as const;

const resolveTier = (deviceMemory: number, hardwareConcurrency: number, webGpuSupported: boolean): LabCapabilityTier => {
  if (webGpuSupported && deviceMemory >= 8 && hardwareConcurrency >= 8) return 'high';
  if (deviceMemory >= 4 && hardwareConcurrency >= 4) return 'standard';
  return 'low';
};

const resolveRuntimePenalty = (runtimeMetrics?: LabCapabilityInput['runtimeMetrics']): number => {
  if (!runtimeMetrics) return 0;
  let penalty = 0;
  if (Number(runtimeMetrics.hydrationMs || 0) >= RUNTIME_GUARDRAILS.hydrationMs) penalty += 1;
  if (Number(runtimeMetrics.waveformRenderMs || 0) >= RUNTIME_GUARDRAILS.waveformRenderMs) penalty += 1;
  if (Number(runtimeMetrics.previewRenderMs || 0) >= RUNTIME_GUARDRAILS.previewRenderMs) penalty += 1;
  return penalty;
};

const applyRuntimePenalty = (tier: LabCapabilityTier, penalty: number): LabCapabilityTier => {
  if (penalty <= 0) return tier;
  if (tier === 'high') return penalty >= 2 ? 'low' : 'standard';
  if (tier === 'standard') return penalty >= 1 ? 'low' : 'standard';
  return 'low';
};

const resolveWorkerThreadCap = (tier: LabCapabilityTier): number => {
  if (tier === 'high') return 4;
  if (tier === 'standard') return 2;
  return 1;
};

export const getLabCapabilityProfile = (input?: LabCapabilityInput): LabCapabilityProfile => {
  const navLike = (input?.navigatorLike ?? (typeof navigator !== 'undefined' ? navigator : null)) as NavigatorLike | null;
  const winLike = (input?.windowLike ?? (typeof window !== 'undefined' ? window : null)) as WindowLike | null;

  const workersSupported = input?.workerSupported ?? typeof Worker !== 'undefined';
  const webAudioSupported = Boolean(winLike && (winLike.AudioContext || winLike.webkitAudioContext));
  const indexedDbSupported = Boolean(winLike?.indexedDB);
  const webGpuSupported = Boolean(navLike?.gpu);
  const offscreenCanvasSupported = Boolean(winLike?.OffscreenCanvas);
  const ffmpegSupported = input?.ffmpegSupported ?? workersSupported;
  const deviceMemory = Number(navLike?.deviceMemory || 4);
  const hardwareConcurrency = Number(navLike?.hardwareConcurrency || 4);
  const secureContext =
    winLike
      ? winLike.isSecureContext !== false
      : typeof window !== 'undefined'
        ? window.isSecureContext !== false
        : false;
  const detectedTier = resolveTier(deviceMemory, hardwareConcurrency, webGpuSupported);
  const runtimePenalty = resolveRuntimePenalty(input?.runtimeMetrics);
  const tier = applyRuntimePenalty(detectedTier, runtimePenalty);
  const workerThreadCap = resolveWorkerThreadCap(tier);
  const degraded = runtimePenalty > 0 && tier !== detectedTier;
  const autoPreviewEnabled = workersSupported && webAudioSupported && tier !== 'low' && runtimePenalty === 0;
  const heavyToolsEnabled = workersSupported && webAudioSupported && ffmpegSupported && tier !== 'low' && runtimePenalty <= 1;
  const sourceSeparationEnabled = heavyToolsEnabled;
  const audioEditingEnabled = webAudioSupported;
  const videoImportEnabled = ffmpegSupported && workersSupported && tier !== 'low';
  const browserKokoroEligible = Boolean(
    secureContext
    && deviceMemory >= 8
    && hardwareConcurrency >= 6
  );

  const tierLabel =
    degraded
      ? 'Runtime guardrails downgraded Lab on this device. Preview and heavy tools stay conservative until performance improves.'
      : tier === 'high'
        ? 'High-end device detected. WebGPU acceleration is available for faster Lab processing.'
        : tier === 'standard'
          ? 'Standard device detected. Full audio editing is enabled with one heavy task at a time.'
          : 'Conservative mode enabled. Lab keeps only lightweight editing tools active to avoid freezing.';

  const runtimeGuardrails = {
    ...(typeof input?.runtimeMetrics?.hydrationMs === 'number' ? { hydrationMs: input.runtimeMetrics.hydrationMs } : {}),
    ...(typeof input?.runtimeMetrics?.waveformRenderMs === 'number' ? { waveformRenderMs: input.runtimeMetrics.waveformRenderMs } : {}),
    ...(typeof input?.runtimeMetrics?.previewRenderMs === 'number' ? { previewRenderMs: input.runtimeMetrics.previewRenderMs } : {}),
    degraded,
  };

  return {
    tier,
    deviceTier: detectedTier,
    workersSupported,
    webAudioSupported,
    indexedDbSupported,
    webGpuSupported,
    offscreenCanvasSupported,
    ffmpegSupported,
    sourceSeparationEnabled,
    audioEditingEnabled,
    videoImportEnabled,
    maxRecommendedDurationMs: Math.round(DEFAULT_MAX_DURATION_MS_BY_TIER[tier] * (degraded ? 0.72 : 1)),
    autoPreviewEnabled,
    heavyToolsEnabled,
    workerThreadCap,
    browserKokoroEligible,
    waveformDetail: tier === 'high' && !degraded ? 'full' : 'reduced',
    runtimeGuardrails,
    detail: tierLabel,
  };
};
