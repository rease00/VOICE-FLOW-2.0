import { sanitizeUiText } from '../ui/terminology';
import type { EngineRuntimeUiStatus } from '../../../services/runtimeStatusMapping';

const cleanRuntimeField = (value: unknown): string => String(value || '').trim();
const pickRuntimeField = (snapshotValue: unknown, baseValue: unknown): string =>
  cleanRuntimeField(snapshotValue) || cleanRuntimeField(baseValue);

const normalizeEngineRuntimeStateToken = (
  rawState: unknown,
  fallback: EngineRuntimeUiStatus['state'] = 'offline'
): EngineRuntimeUiStatus['state'] => {
  const token = String(rawState || '').trim().toLowerCase() as EngineRuntimeUiStatus['state'];
  return new Set<EngineRuntimeUiStatus['state']>([
    'checking',
    'starting',
    'warming',
    'online',
    'offline',
    'not_configured',
    'standby',
  ]).has(token) ? token : fallback;
};

export const hydrateRuntimeStatusSnapshot = (
  current: EngineRuntimeUiStatus | undefined,
  snapshotRow: Partial<EngineRuntimeUiStatus> | null | undefined
): EngineRuntimeUiStatus => {
  const base = current ?? { state: 'offline', detail: 'Runtime status unavailable.' };
  const state = normalizeEngineRuntimeStateToken(snapshotRow?.state, base.state);
  const detail = sanitizeUiText(
    pickRuntimeField(snapshotRow?.detail, base.detail) || 'Runtime status unavailable.'
  ) || 'Runtime status unavailable.';
  return {
    ...base,
    state,
    detail,
    provider: pickRuntimeField(snapshotRow?.provider, base.provider),
    lane: pickRuntimeField(snapshotRow?.lane, base.lane),
    selectedRegion: pickRuntimeField(snapshotRow?.selectedRegion, base.selectedRegion),
    modelId: pickRuntimeField(snapshotRow?.modelId, base.modelId),
    runtimeUrl: pickRuntimeField(snapshotRow?.runtimeUrl, base.runtimeUrl),
    healthUrl: pickRuntimeField(snapshotRow?.healthUrl, base.healthUrl),
    cloudTtsLocation: pickRuntimeField(snapshotRow?.cloudTtsLocation, base.cloudTtsLocation),
    vertexLocation: pickRuntimeField(snapshotRow?.vertexLocation, base.vertexLocation),
    regionHint: pickRuntimeField(snapshotRow?.regionHint, base.regionHint),
    regionSource: pickRuntimeField(snapshotRow?.regionSource, base.regionSource),
  };
};
