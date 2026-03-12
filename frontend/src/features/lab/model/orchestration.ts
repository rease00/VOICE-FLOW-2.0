import type {
  LabCapabilityProfile,
  LabRuntimeDefaults,
  LabRuntimeState,
  LabBackendHardwareDefault,
  LabEffectiveBrowserMode,
  LabPreviewQualityLevel,
} from '../../../../types';

export const DEFAULT_LAB_RUNTIME_DEFAULTS: LabRuntimeDefaults = {
  browserAccelerationDefault: 'webgpu_preferred',
  backendHardwareDefault: 'gpu_preferred',
  separatorBackendDefault: 'gpu_preferred',
  labPerformanceMode: 'conservative',
  exportStrategyDefault: 'browser_first',
  allowUserOverride: false,
};

interface ResolveLabRuntimeStateInput {
  capabilities: LabCapabilityProfile;
  defaults: LabRuntimeDefaults;
  timelineDurationMs: number;
  backendQueueActive?: boolean;
}

interface ResolveLabExportExecutionInput {
  capabilities: LabCapabilityProfile;
  defaults: LabRuntimeDefaults;
  runtimeState: LabRuntimeState;
  timelineDurationMs: number;
  visualClipCount: number;
}

const resolvePreviewQuality = (
  capabilities: LabCapabilityProfile,
  defaults: LabRuntimeDefaults,
  timelineDurationMs: number
): LabPreviewQualityLevel => {
  if (capabilities.tier === 'high' && !capabilities.runtimeGuardrails.degraded && defaults.labPerformanceMode === 'balanced') {
    return 'high';
  }
  if (capabilities.tier === 'low' || capabilities.runtimeGuardrails.degraded || timelineDurationMs > capabilities.maxRecommendedDurationMs) {
    return 'low';
  }
  return 'medium';
};

const resolveBrowserMode = (
  capabilities: LabCapabilityProfile,
  defaults: LabRuntimeDefaults
): LabEffectiveBrowserMode => {
  if (defaults.browserAccelerationDefault === 'cpu_only') return 'cpu_fallback';
  return capabilities.webGpuSupported ? 'webgpu_active' : 'cpu_fallback';
};

const resolveBackendMode = (defaults: LabRuntimeDefaults): LabBackendHardwareDefault => (
  defaults.backendHardwareDefault === 'cpu_only' ? 'cpu_only' : 'gpu_preferred'
);

export const resolveLabRuntimeState = ({
  capabilities,
  defaults,
  timelineDurationMs,
  backendQueueActive = false,
}: ResolveLabRuntimeStateInput): LabRuntimeState => {
  const effectiveBrowserMode = resolveBrowserMode(capabilities, defaults);
  const effectiveBackendMode = resolveBackendMode(defaults);
  const previewQualityLevel = resolvePreviewQuality(capabilities, defaults, timelineDurationMs);
  let degradedReason: LabRuntimeState['degradedReason'] = 'none';
  if (backendQueueActive) degradedReason = 'backend_queue';
  else if (timelineDurationMs > capabilities.maxRecommendedDurationMs) degradedReason = 'long_timeline';
  else if (capabilities.runtimeGuardrails.degraded) degradedReason = 'runtime_guardrails';
  else if (capabilities.tier === 'low') degradedReason = 'weak_device';
  else if (defaults.labPerformanceMode === 'conservative') degradedReason = 'conservative_policy';

  const autoPreviewAllowed = (
    capabilities.autoPreviewEnabled
    && timelineDurationMs <= capabilities.maxRecommendedDurationMs
    && previewQualityLevel !== 'low'
    && !backendQueueActive
  );

  let runtimeBadge: LabRuntimeState['runtimeBadge'] = 'WebGPU active';
  let runtimeBadgeState: LabRuntimeState['runtimeBadgeState'] = 'accelerated';
  if (backendQueueActive) {
    runtimeBadge = 'Queued on backend';
    runtimeBadgeState = 'queued';
  } else if (effectiveBrowserMode === 'cpu_fallback') {
    runtimeBadge = 'CPU fallback active';
    runtimeBadgeState = 'fallback';
  } else if (degradedReason === 'conservative_policy') {
    runtimeBadge = 'Conservative mode';
    runtimeBadgeState = 'conservative';
  } else if (degradedReason !== 'none' || previewQualityLevel === 'low') {
    runtimeBadge = 'Performance reduced';
    runtimeBadgeState = 'fallback';
  }

  return {
    deviceTier: capabilities.deviceTier || capabilities.tier,
    effectiveBrowserMode,
    effectiveBackendMode,
    degradedReason,
    previewQualityLevel,
    autoPreviewAllowed,
    heavyToolsEnabled: capabilities.heavyToolsEnabled && defaults.labPerformanceMode === 'balanced'
      ? capabilities.heavyToolsEnabled
      : capabilities.heavyToolsEnabled && capabilities.tier !== 'low',
    runtimeBadge,
    runtimeBadgeState,
  };
};

export const resolveLabExportExecutionMode = ({
  capabilities,
  defaults,
  runtimeState,
  timelineDurationMs,
  visualClipCount,
}: ResolveLabExportExecutionInput): 'browser_local' | 'backend_queue' => {
  if (defaults.exportStrategyDefault !== 'browser_first') {
    return 'backend_queue';
  }
  const safeLocalDurationMs = Math.min(capabilities.maxRecommendedDurationMs, 120_000);
  if (timelineDurationMs > safeLocalDurationMs) {
    return 'backend_queue';
  }
  if (visualClipCount > (runtimeState.previewQualityLevel === 'high' ? 10 : 6)) {
    return 'backend_queue';
  }
  if (runtimeState.effectiveBrowserMode === 'cpu_fallback' && capabilities.tier === 'low') {
    return 'backend_queue';
  }
  return 'browser_local';
};
