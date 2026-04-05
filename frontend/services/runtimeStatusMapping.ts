export type EngineRuntimeUiState =
  | 'checking'
  | 'starting'
  | 'warming'
  | 'online'
  | 'offline'
  | 'not_configured'
  | 'standby';

export interface EngineRuntimeMetadata {
  provider?: string;
  lane?: string;
  selectedRegion?: string;
  modelId?: string;
  runtimeUrl?: string;
  healthUrl?: string;
  cloudTtsLocation?: string;
  vertexLocation?: string;
  regionHint?: string;
  regionSource?: string;
}

export interface EngineRuntimeUiStatus extends EngineRuntimeMetadata {
  state: EngineRuntimeUiState;
  detail: string;
}

export const TTS_RUNTIME_STATUS_EVENT = 'voiceflow:tts-runtime-status';

const RUNTIME_PROVIDER_LABELS: Record<string, string> = {
  'cloud-text-to-speech': 'Cloud TTS',
  'cloud_tts': 'Cloud TTS',
  'gemini-api': 'Gemini API',
  'gemini_api': 'Gemini API',
  'vertex-ai': 'Vertex AI',
  'vertex': 'Vertex AI',
  'browser-webgpu': 'Browser WebGPU',
  'local-webgpu': 'Browser WebGPU',
  'webgpu': 'Browser WebGPU',
};

const RUNTIME_LANE_LABELS: Record<string, string> = {
  vector: 'VECTOR',
  vec: 'VECTOR',
  prime: 'PRIME',
  PRIME: 'PRIME',
  gemini: 'PRIME',
};

const GCP_REGION_LABELS: Record<string, string> = {
  asia: 'Asia',
  'asia-south1': 'Mumbai',
  'asia-south2': 'Delhi',
  'asia-southeast1': 'Singapore',
  'asia-east1': 'Taipei',
  'asia-northeast1': 'Tokyo',
  eu: 'EU',
  europe: 'Europe',
  'europe-west1': 'Belgium',
  'europe-west4': 'Netherlands',
  'europe-west2': 'London',
  'europe-west3': 'Frankfurt',
  'europe-central2': 'Poland',
  'europe-north1': 'Finland',
  'europe-southwest1': 'Madrid',
  us: 'US',
  'us-central1': 'Iowa',
  'us-east1': 'South Carolina',
  'us-east4': 'Northern Virginia',
  'us-east5': 'Columbus',
  'us-south1': 'Dallas',
  'us-west1': 'Oregon',
  'us-west4': 'Las Vegas',
  'northamerica-northeast1': 'Montreal',
  global: 'Global',
};

const ENGINE_RUNTIME_STATE_SET: ReadonlySet<EngineRuntimeUiState> = new Set([
  'checking',
  'starting',
  'warming',
  'online',
  'offline',
  'not_configured',
  'standby',
]);

const normalizeRuntimeToken = (value: unknown): string => String(value || '').trim();

const normalizeRuntimeMetadataLabel = (field: keyof EngineRuntimeMetadata, value: unknown): string => {
  const token = normalizeRuntimeToken(value);
  if (!token) return '';
  if (field === 'provider') {
    return RUNTIME_PROVIDER_LABELS[token.toLowerCase()] || token;
  }
  if (field === 'lane') {
    return RUNTIME_LANE_LABELS[token.toLowerCase()] || token;
  }
  return token;
};

const formatRuntimeLocationLabel = (value: unknown): string => {
  const token = normalizeRuntimeToken(value).replace(/_/g, '-');
  if (!token) return '';
  const lower = token.toLowerCase();
  return GCP_REGION_LABELS[lower] || token;
};

export const formatRuntimeServerLabel = (status: Partial<EngineRuntimeMetadata> | null | undefined): string => {
  if (!status || typeof status !== 'object') return '';
  const locationLabel = (
    formatRuntimeLocationLabel(status.selectedRegion) ||
    formatRuntimeLocationLabel(status.cloudTtsLocation) ||
    formatRuntimeLocationLabel(status.vertexLocation) ||
    formatRuntimeLocationLabel(status.regionHint)
  );
  if (locationLabel) return locationLabel;
  const token = normalizeRuntimeToken(status.runtimeUrl || status.healthUrl);
  if (!token) return '';
  try {
    return new URL(token).host || token;
  } catch {
    return token.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || token;
  }
};

const readRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const buildUiStatus = (
  state: EngineRuntimeUiState,
  detail: string,
  metadataSource: Record<string, unknown> | null
): EngineRuntimeUiStatus => ({
  state,
  detail,
  provider: normalizeRuntimeMetadataLabel('provider', metadataSource?.provider),
  lane: normalizeRuntimeMetadataLabel('lane', metadataSource?.lane),
  selectedRegion: normalizeRuntimeMetadataLabel('selectedRegion', metadataSource?.selectedRegion),
  modelId: normalizeRuntimeMetadataLabel('modelId', metadataSource?.modelId),
  runtimeUrl: normalizeRuntimeMetadataLabel('runtimeUrl', metadataSource?.runtimeUrl),
  healthUrl: normalizeRuntimeMetadataLabel('healthUrl', metadataSource?.healthUrl),
  cloudTtsLocation: normalizeRuntimeMetadataLabel('cloudTtsLocation', metadataSource?.cloudTtsLocation),
  vertexLocation: normalizeRuntimeMetadataLabel('vertexLocation', metadataSource?.vertexLocation),
  regionHint: normalizeRuntimeMetadataLabel('regionHint', metadataSource?.regionHint),
  regionSource: normalizeRuntimeMetadataLabel('regionSource', metadataSource?.regionSource),
});

export const formatRuntimeMetadataSummary = (status: Partial<EngineRuntimeMetadata> | null | undefined): string => {
  if (!status || typeof status !== 'object') return '';
  const provider = normalizeRuntimeMetadataLabel('provider', status.provider);
  const lane = normalizeRuntimeMetadataLabel('lane', status.lane);
  const server = formatRuntimeServerLabel(status) || normalizeRuntimeMetadataLabel('selectedRegion', status.selectedRegion);
  const modelId = normalizeRuntimeMetadataLabel('modelId', status.modelId);
  return [provider, lane, server, modelId].filter(Boolean).join(' / ');
};

export const normalizeEngineRuntimeStateToken = (
  rawState: unknown,
  fallback: EngineRuntimeUiState = 'offline'
): EngineRuntimeUiState => {
  const token = String(rawState || '').trim().toLowerCase() as EngineRuntimeUiState;
  return ENGINE_RUNTIME_STATE_SET.has(token) ? token : fallback;
};

export const mapGatewayEngineRuntimeToUiStatus = (engineItem: unknown): EngineRuntimeUiStatus => {
  if (!engineItem || typeof engineItem !== 'object') {
    return buildUiStatus('offline', 'Gateway did not return runtime status.', null);
  }

  const candidate = engineItem as Record<string, unknown> & {
    ready?: unknown;
    capabilities?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    provider?: unknown;
    lane?: unknown;
    selectedRegion?: unknown;
    modelId?: unknown;
    runtimeUrl?: unknown;
    healthUrl?: unknown;
  };
  const capabilities = readRecord(candidate.capabilities);
  const capabilityMetadata = readRecord(capabilities?.metadata);
  const metadata = readRecord(candidate.metadata);
  const metadataSource = capabilityMetadata || metadata || capabilities || candidate;
  const stateToken = normalizeEngineRuntimeStateToken(candidate.state, 'offline');
  const runtimeReady = typeof candidate.ready === 'boolean' ? candidate.ready : stateToken === 'online';
  const detail = String(candidate.detail || 'Runtime status updated.') || 'Runtime status updated.';
  const standbyHint = Boolean(capabilityMetadata?.standby || metadata?.standby);

  if (stateToken === 'not_configured') {
    return buildUiStatus('not_configured', detail, metadataSource);
  }
  if (stateToken === 'warming') {
    if (standbyHint) {
      return buildUiStatus('standby', detail, metadataSource);
    }
    return buildUiStatus('starting', detail, metadataSource);
  }
  if (stateToken === 'starting' || (stateToken === 'online' && !runtimeReady)) {
    return buildUiStatus('starting', detail, metadataSource);
  }
  if (stateToken === 'online') {
    return buildUiStatus('online', detail, metadataSource);
  }
  if (stateToken === 'standby' || (stateToken === 'offline' && standbyHint)) {
    return buildUiStatus('standby', detail, metadataSource);
  }
  return buildUiStatus('offline', detail, metadataSource);
};

