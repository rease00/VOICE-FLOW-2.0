import type { GenerationSettings } from '../../../types';
import { authFetch } from '../../../services/authHttpClient';
import type {
  RuntimeLogTailResponse,
  TtsEngineCapabilitiesResponse,
  TtsJobStatusResponse,
  TtsEngineSwitchResponse,
  TtsVoiceMappingCatalogResponse,
  TtsEngineVoicesResponse,
  VideoTranscriptionResponse,
} from './contracts';
import { resolveApiBaseUrl, resolveApiUrl } from './config';
import { requestBlob, requestJson } from './httpClient';

export type RuntimeLogService = 'media-backend' | 'gemini-runtime';
const TTS_V2_SESSION_HEADER = 'x-vf-tts-session-key';
const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const CLIENT_DEDUPE_HEADER = 'X-VF-Client-Request-Dedupe';
const TTS_V2_SESSION_REFRESH_SKEW_MS = 30_000;
const TTS_V2_SESSION_IDEMPOTENCY_WINDOW_MS = 5 * 60_000;
const TTS_V2_CREATE_RECENT_TTL_MS = 60_000;
const TTS_V2_AUTO_REQUEST_ID_TTL_MS = 24 * 60 * 60 * 1000;
const TTS_V2_AUTO_REQUEST_ID_STORAGE_PREFIX = 'vf:tts:auto-request-id:v1';
const TTS_V2_SESSION_CACHE = new Map<string, { sessionKey: string; expiresAtMs: number }>();
const TTS_V2_SESSION_IN_FLIGHT = new Map<string, Promise<string>>();
const TTS_V2_CREATE_IN_FLIGHT = new Map<string, Promise<TtsJobStatusResponse>>();
const TTS_V2_CREATE_RECENT = new Map<string, { response: TtsJobStatusResponse; expiresAtMs: number }>();
const TTS_V2_AUTO_REQUEST_IDS = new Map<string, { requestId: string; expiresAtMs: number }>();
const CREATE_TTS_JOB_IDEMPOTENCY_OMIT_FIELDS = new Set([
  'request_id',
  'requestId',
  'idempotency_key',
  'idempotencyKey',
]);

type CreateTtsJobDedupeKind = 'recent-cache-hit' | 'in-flight-dedupe' | 'auto-request-id-reuse';

interface CreateTtsJobClientDedupeMarker {
  kind: CreateTtsJobDedupeKind;
  requestId: string;
  baseUrl: string;
  payloadFingerprint: string;
}

type CreateTtsJobResponse = TtsJobStatusResponse & {
  clientDedupe?: CreateTtsJobClientDedupeMarker;
};

interface AutoRequestIdCacheEntry {
  requestId: string;
  expiresAtMs: number;
  payloadFingerprint: string;
}

const createAbortError = (): Error => {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
};

const withBaseUrl = (baseUrl?: string): { baseUrl?: string } => (baseUrl ? { baseUrl } : {});
const removedGatewayFeature = (feature: string): Error =>
  new Error(`${feature} endpoint was removed from this project.`);

const ttsV2SessionCacheKey = (baseUrl?: string): string => {
  return resolveApiBaseUrl(baseUrl) || 'default';
};

const createTtsV2SessionIdempotencyKey = (requestKey: string, nowMs: number): string => {
  return `vf:tts:session:${hashText(requestKey)}:${Math.floor(nowMs / TTS_V2_SESSION_IDEMPOTENCY_WINDOW_MS).toString(36)}`;
};

const createTtsV2SessionCancelIdempotencyKey = (cacheKey: string, sessionKey: string): string => {
  return `vf:tts:session-cancel:${hashText(`${cacheKey}:${sessionKey}`)}`;
};

const cloneTtsJobResponse = (response: TtsJobStatusResponse): TtsJobStatusResponse => {
  try {
    return JSON.parse(JSON.stringify(response)) as TtsJobStatusResponse;
  } catch {
    return response;
  }
};

const createClientDedupeMarker = (
  kind: CreateTtsJobDedupeKind,
  requestId: string,
  payloadFingerprint: string,
  baseUrl?: string
): CreateTtsJobClientDedupeMarker => ({
  kind,
  requestId,
  baseUrl: ttsV2SessionCacheKey(baseUrl),
  payloadFingerprint,
});

const cloneTtsJobResponseWithDedupe = (
  response: TtsJobStatusResponse,
  marker?: CreateTtsJobClientDedupeMarker
): CreateTtsJobResponse => {
  const cloned = cloneTtsJobResponse(response) as CreateTtsJobResponse;
  if (marker) {
    cloned.clientDedupe = marker;
  }
  return cloned;
};

const getPersistentStorage = (): Storage | null => {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
};

const hashText = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const createAutoRequestIdStorageKey = (payloadFingerprint: string): string => {
  return `${TTS_V2_AUTO_REQUEST_ID_STORAGE_PREFIX}:${hashText(payloadFingerprint)}`;
};

const createClientRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `vf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const readAutoRequestIdCacheEntry = (
  payloadFingerprint: string,
  nowMs: number
): AutoRequestIdCacheEntry | null => {
  const storage = getPersistentStorage();
  if (!storage) return null;
  const storageKey = createAutoRequestIdStorageKey(payloadFingerprint);
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutoRequestIdCacheEntry>;
    const requestId = String(parsed.requestId || '').trim();
    const expiresAtMs = Math.max(0, Math.floor(Number(parsed.expiresAtMs || 0)));
    const storedFingerprint = String(parsed.payloadFingerprint || '').trim();
    if (!requestId || storedFingerprint !== payloadFingerprint || expiresAtMs <= nowMs) {
      storage.removeItem(storageKey);
      return null;
    }
    return {
      requestId,
      expiresAtMs,
      payloadFingerprint: storedFingerprint,
    };
  } catch {
    try {
      storage.removeItem(storageKey);
    } catch {
      // Ignore storage errors in non-browser environments.
    }
    return null;
  }
};

const writeAutoRequestIdCacheEntry = (entry: AutoRequestIdCacheEntry): void => {
  const storage = getPersistentStorage();
  if (!storage) return;
  const storageKey = createAutoRequestIdStorageKey(entry.payloadFingerprint);
  try {
    storage.setItem(storageKey, JSON.stringify({
      requestId: entry.requestId,
      expiresAtMs: entry.expiresAtMs,
      payloadFingerprint: entry.payloadFingerprint,
    }));
  } catch {
    // Ignore storage quota and privacy-mode failures.
  }
};

const pruneCreateTtsJobDedupeState = (nowMs: number): void => {
  for (const [key, value] of TTS_V2_CREATE_RECENT.entries()) {
    if (Number(value?.expiresAtMs || 0) <= nowMs) {
      TTS_V2_CREATE_RECENT.delete(key);
    }
  }
  for (const [key, value] of TTS_V2_AUTO_REQUEST_IDS.entries()) {
    if (Number(value?.expiresAtMs || 0) <= nowMs) {
      TTS_V2_AUTO_REQUEST_IDS.delete(key);
    }
  }
};

const canonicalizeCreateTtsPayloadValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeCreateTtsPayloadValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = Object.keys(source).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    if (CREATE_TTS_JOB_IDEMPOTENCY_OMIT_FIELDS.has(key)) continue;
    const candidate = source[key];
    if (typeof candidate === 'undefined') continue;
    out[key] = canonicalizeCreateTtsPayloadValue(candidate);
  }
  return out;
};

const createTtsJobPayloadFingerprint = (payload: Record<string, unknown>, baseUrl?: string): string => {
  const scope = ttsV2SessionCacheKey(baseUrl);
  const canonical = canonicalizeCreateTtsPayloadValue(payload);
  return `${scope}:${JSON.stringify(canonical)}`;
};

export const clearTtsV2SessionKeyCache = (baseUrl?: string): void => {
  const cacheKey = ttsV2SessionCacheKey(baseUrl);
  TTS_V2_SESSION_CACHE.delete(cacheKey);
  for (const requestKey of Array.from(TTS_V2_SESSION_IN_FLIGHT.keys())) {
    if (requestKey === cacheKey || requestKey.startsWith(`${cacheKey}:`)) {
      TTS_V2_SESSION_IN_FLIGHT.delete(requestKey);
    }
  }
};

interface TtsV2SessionIssueResponse {
  ok?: boolean;
  sessionKey?: string;
  expiresAtMs?: number;
  ttlSeconds?: number;
}

interface TtsV2SessionCancelResponse {
  ok?: boolean;
  sessionKey?: string;
  cancelledCount?: number;
  jobs?: Array<Record<string, unknown>>;
}

export const issueTtsV2SessionKey = async (options?: {
  baseUrl?: string;
  force?: boolean;
  regionHint?: string;
  regionSource?: string;
  probeAllSlotRegions?: boolean;
  signal?: AbortSignal;
}): Promise<string> => {
  const cacheKey = ttsV2SessionCacheKey(options?.baseUrl);
  const now = Date.now();
  if (!options?.force) {
    const cached = TTS_V2_SESSION_CACHE.get(cacheKey);
    if (cached && cached.expiresAtMs > (now + TTS_V2_SESSION_REFRESH_SKEW_MS)) {
      return cached.sessionKey;
    }
  }
  const requestBody = {
    ...(String(options?.regionHint || '').trim() ? { regionHint: String(options?.regionHint || '').trim() } : {}),
    ...(String(options?.regionSource || '').trim() ? { regionSource: String(options?.regionSource || '').trim() } : {}),
    probeAllSlotRegions: options?.probeAllSlotRegions === true,
  };
  const requestKey = `${cacheKey}:${JSON.stringify(requestBody)}`;
  const idempotencyKey = createTtsV2SessionIdempotencyKey(requestKey, now);
  const inFlight = TTS_V2_SESSION_IN_FLIGHT.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
    const issued = await requestJson<TtsV2SessionIssueResponse>(
      '/tts/v2/sessions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(requestBody),
        ...(options?.signal ? { signal: options.signal } : {}),
      },
      { ...withBaseUrl(options?.baseUrl), requireAuth: true }
    );
    const sessionKey = String(issued?.sessionKey || '').trim();
    if (!sessionKey) {
      throw new Error('Gateway did not return a valid TTS session key.');
    }
    const ttlSeconds = Math.max(60, Math.floor(Number(issued?.ttlSeconds || 1800)));
    const expiresAtMsRaw = Math.floor(Number(issued?.expiresAtMs || 0));
    const expiresAtMs = expiresAtMsRaw > now ? expiresAtMsRaw : (now + (ttlSeconds * 1000));
    TTS_V2_SESSION_CACHE.set(cacheKey, { sessionKey, expiresAtMs });
    return sessionKey;
  })();

  TTS_V2_SESSION_IN_FLIGHT.set(requestKey, pending);
  try {
    return await pending;
  } finally {
    if (TTS_V2_SESSION_IN_FLIGHT.get(requestKey) === pending) {
      TTS_V2_SESSION_IN_FLIGHT.delete(requestKey);
    }
  }
};

export const cancelTtsSession = async (options?: {
  baseUrl?: string;
  sessionKey?: string;
}): Promise<TtsV2SessionCancelResponse> => {
  const cacheKey = ttsV2SessionCacheKey(options?.baseUrl);
  const sessionKey = String(options?.sessionKey || TTS_V2_SESSION_CACHE.get(cacheKey)?.sessionKey || '').trim();
  if (!sessionKey) {
    return { ok: false };
  }

  try {
    return await requestJson<TtsV2SessionCancelResponse>(
      `/tts/v2/sessions/${encodeURIComponent(sessionKey)}/cancel`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': createTtsV2SessionCancelIdempotencyKey(cacheKey, sessionKey),
        },
      },
      { ...withBaseUrl(options?.baseUrl), requireAuth: true }
    );
  } finally {
    clearTtsV2SessionKeyCache(options?.baseUrl);
  }
};

const fetchPublicJsonWithTimeout = async <T>(
  pathOrUrl: string,
  options?: { baseUrl?: string | undefined; timeoutMs?: number | undefined; signal?: AbortSignal | undefined }
): Promise<T> => {
  const timeoutMs = Number(options?.timeoutMs || 0);
  const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const externalSignal = options?.signal;
  if (externalSignal?.aborted) {
    throw createAbortError();
  }
  const controller = hasTimeout || externalSignal ? new AbortController() : null;
  let timedOut = false;
  const timer = controller && hasTimeout
    ? globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(500, Math.floor(timeoutMs)))
    : null;
  const forwardAbort = () => controller?.abort();
  if (externalSignal && controller) {
    externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  try {
    const requestInit: RequestInit = {
      method: 'GET',
      cache: 'no-store',
      headers: { 'ngrok-skip-browser-warning': 'true' },
    };
    if (controller) {
      requestInit.signal = controller.signal;
    } else if (externalSignal) {
      requestInit.signal = externalSignal;
    }
    const response = await fetch(resolveApiUrl(pathOrUrl, options?.baseUrl), requestInit);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return await response.json() as T;
  } catch (error: unknown) {
    if (externalSignal?.aborted) {
      throw createAbortError();
    }
    if (timedOut) {
      throw new Error(`Request timed out after ${Math.max(1, Math.round(timeoutMs / 1000))}s.`);
    }
    throw error;
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
    if (externalSignal && controller) {
      externalSignal.removeEventListener('abort', forwardAbort);
    }
  }
};

const fetchAuthJsonWithTimeout = async <T>(
  pathOrUrl: string,
  options?: { baseUrl?: string | undefined; timeoutMs?: number | undefined; signal?: AbortSignal | undefined }
): Promise<T> => {
  const timeoutMs = Number(options?.timeoutMs || 0);
  const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const externalSignal = options?.signal;
  if (externalSignal?.aborted) {
    throw createAbortError();
  }
  const controller = hasTimeout || externalSignal ? new AbortController() : null;
  let timedOut = false;
  const timer = controller && hasTimeout
    ? globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(500, Math.floor(timeoutMs)))
    : null;
  const forwardAbort = () => controller?.abort();
  if (externalSignal && controller) {
    externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  try {
    const requestInit: RequestInit = {
      method: 'GET',
      cache: 'no-store',
      headers: { 'ngrok-skip-browser-warning': 'true' },
    };
    if (controller) {
      requestInit.signal = controller.signal;
    } else if (externalSignal) {
      requestInit.signal = externalSignal;
    }
    return await requestJson<T>(
      pathOrUrl,
      requestInit,
      {
        ...withBaseUrl(options?.baseUrl),
        requireAuth: true,
      }
    );
  } catch (error: unknown) {
    if (externalSignal?.aborted) {
      throw createAbortError();
    }
    if (timedOut) {
      throw new Error(`Request timed out after ${Math.max(1, Math.round(timeoutMs / 1000))}s.`);
    }
    throw error;
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
    if (externalSignal && controller) {
      externalSignal.removeEventListener('abort', forwardAbort);
    }
  }
};

const decodeBase64ToArrayBuffer = (value: string): ArrayBuffer => {
  const safe = String(value || '').trim();
  if (!safe) return new ArrayBuffer(0);
  const binary = atob(safe);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

export interface RoutingBackendCandidate {
  baseUrl: string;
  probeOk: boolean;
  region?: string;
  healthy?: boolean;
  queueDepth?: number;
  oldestQueuedAgeMs?: number;
  capabilities?: {
    supportsTts?: boolean;
    supportsQueueDrain?: boolean;
    supportsDuplicateSuppression?: boolean;
    supportsBillingIdempotency?: boolean;
    supportsScaleToZero?: boolean;
  };
  healthUrl?: string;
  runtimeUrl?: string;
  latencyMs?: number | null;
}

export interface RoutingBackendCandidatesResponse {
  ok: boolean;
  candidates: RoutingBackendCandidate[];
  fetchedAt: string;
  selectedRegion?: string;
  selectedBaseUrl?: string;
  queueDepth?: number;
  oldestQueuedAgeMs?: number;
  controlPlaneRegion?: string;
  routingMode?: {
    primary?: string;
    client?: string;
  };
}

interface RoutingRegionsSnapshotResponse {
  ok: boolean;
  fetchedAt?: string;
  selectedRegion?: string;
  selectedBaseUrl?: string;
  queueDepth?: number;
  oldestQueuedAgeMs?: number;
  controlPlaneRegion?: string;
  routingMode?: {
    primary?: string;
    client?: string;
  };
  regions?: RoutingBackendCandidate[];
  candidates?: RoutingBackendCandidate[];
}

export const fetchRoutingBackendCandidates = async (options?: {
  baseUrl?: string;
  timeoutMs?: number;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<RoutingBackendCandidatesResponse> => {
  const baseUrl = resolveApiBaseUrl(options?.baseUrl);
  void options?.force;
  if (!baseUrl) {
    return {
      ok: false,
      candidates: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    const routingSnapshot = await fetchPublicJsonWithTimeout<RoutingRegionsSnapshotResponse>('/routing/regions', {
      baseUrl,
      ...(typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    const snapshotCandidates = Array.isArray(routingSnapshot?.candidates) && routingSnapshot.candidates.length > 0
      ? routingSnapshot.candidates
      : Array.isArray(routingSnapshot?.regions)
        ? routingSnapshot.regions
        : [];
    const candidates = snapshotCandidates
      .map((candidate) => {
        const candidateBaseUrl = resolveApiBaseUrl(String(candidate?.baseUrl || baseUrl).trim());
        const healthy = Boolean(candidate?.healthy ?? candidate?.probeOk ?? true);
        const queueDepth = Number.isFinite(Number(candidate?.queueDepth))
          ? Math.max(0, Math.floor(Number(candidate?.queueDepth)))
          : 0;
        const oldestQueuedAgeMs = Number.isFinite(Number(candidate?.oldestQueuedAgeMs))
          ? Math.max(0, Math.floor(Number(candidate?.oldestQueuedAgeMs)))
          : 0;
        const region = String(candidate?.region || '').trim();
        const healthUrl = String(candidateBaseUrl ? `${candidateBaseUrl.replace(/\/+$/, '')}/health` : candidate?.healthUrl || '').trim();
        const runtimeUrl = String(candidateBaseUrl || candidate?.runtimeUrl || '').trim();
        const normalizedCandidate: RoutingBackendCandidate = {
          baseUrl: candidateBaseUrl,
          probeOk: Boolean(candidate?.probeOk ?? healthy),
          healthy,
          ...(region ? { region } : {}),
          queueDepth,
          oldestQueuedAgeMs,
          capabilities: {
            supportsTts: true,
            supportsQueueDrain: true,
            supportsDuplicateSuppression: true,
            supportsBillingIdempotency: true,
            supportsScaleToZero: true,
            ...(candidate?.capabilities || {}),
          },
          ...(Number.isFinite(Number(candidate?.latencyMs))
            ? { latencyMs: Number(candidate?.latencyMs) }
            : { latencyMs: null }),
          ...(healthUrl ? { healthUrl } : {}),
          ...(runtimeUrl ? { runtimeUrl } : {}),
        };
        return normalizedCandidate;
      })
      .filter((candidate) => Boolean(candidate.baseUrl));
    const nowIso = new Date().toISOString();
    return {
      ok: Boolean(routingSnapshot?.ok ?? candidates.length > 0),
      candidates: candidates.length > 0
        ? candidates
        : [{
            baseUrl,
            probeOk: true,
            healthy: true,
            region: String(routingSnapshot?.selectedRegion || '').trim(),
            capabilities: {
              supportsTts: true,
              supportsQueueDrain: true,
              supportsDuplicateSuppression: true,
              supportsBillingIdempotency: true,
              supportsScaleToZero: true,
            },
            healthUrl: `${baseUrl.replace(/\/+$/, '')}/health`,
            runtimeUrl: baseUrl,
            latencyMs: null,
            queueDepth: Number.isFinite(Number(routingSnapshot?.queueDepth))
              ? Math.max(0, Math.floor(Number(routingSnapshot?.queueDepth)))
              : 0,
            oldestQueuedAgeMs: Number.isFinite(Number(routingSnapshot?.oldestQueuedAgeMs))
              ? Math.max(0, Math.floor(Number(routingSnapshot?.oldestQueuedAgeMs)))
              : 0,
          }],
      selectedRegion: String(routingSnapshot?.selectedRegion || candidates.find((candidate) => candidate.region)?.region || '').trim(),
      selectedBaseUrl: String(routingSnapshot?.selectedBaseUrl || baseUrl).trim(),
      queueDepth: Number.isFinite(Number(routingSnapshot?.queueDepth))
        ? Math.max(0, Math.floor(Number(routingSnapshot?.queueDepth)))
        : 0,
      oldestQueuedAgeMs: Number.isFinite(Number(routingSnapshot?.oldestQueuedAgeMs))
        ? Math.max(0, Math.floor(Number(routingSnapshot?.oldestQueuedAgeMs)))
        : 0,
      controlPlaneRegion: String(routingSnapshot?.controlPlaneRegion || '').trim(),
      ...(routingSnapshot?.routingMode && typeof routingSnapshot.routingMode === 'object'
        ? {
            routingMode: {
              primary: String(routingSnapshot.routingMode.primary || '').trim(),
              client: String(routingSnapshot.routingMode.client || '').trim(),
            },
          }
        : {}),
      fetchedAt: String(routingSnapshot?.fetchedAt || nowIso),
    };
  } catch {
    const startedAtMs = Date.now();
    const healthUrl = resolveApiUrl('/health', baseUrl);
    try {
      const healthSnapshot = await fetchPublicJsonWithTimeout<Record<string, unknown>>('/health', {
        baseUrl,
        ...(typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
          ? { timeoutMs: options.timeoutMs }
          : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      const region = String(
        healthSnapshot?.selectedRegion ||
        healthSnapshot?.region ||
        healthSnapshot?.regionHint ||
        ''
      ).trim();
      return {
        ok: true,
        candidates: [{
          baseUrl,
          probeOk: true,
          healthy: true,
          region,
          capabilities: {
            supportsTts: true,
            supportsQueueDrain: true,
            supportsDuplicateSuppression: true,
            supportsBillingIdempotency: true,
            supportsScaleToZero: true,
          },
          healthUrl,
          runtimeUrl: baseUrl,
          latencyMs: Math.max(0, Date.now() - startedAtMs),
          queueDepth: 0,
          oldestQueuedAgeMs: 0,
        }],
        selectedRegion: region,
        selectedBaseUrl: baseUrl,
        queueDepth: 0,
        oldestQueuedAgeMs: 0,
        controlPlaneRegion: '',
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return {
        ok: false,
        candidates: [{
          baseUrl,
          probeOk: false,
          healthy: false,
          region: '',
          capabilities: {
            supportsTts: false,
            supportsQueueDrain: false,
            supportsDuplicateSuppression: false,
            supportsBillingIdempotency: false,
            supportsScaleToZero: false,
          },
          healthUrl,
          runtimeUrl: baseUrl,
          latencyMs: null,
          queueDepth: 0,
          oldestQueuedAgeMs: 0,
        }],
        selectedBaseUrl: baseUrl,
        queueDepth: 0,
        oldestQueuedAgeMs: 0,
        controlPlaneRegion: '',
        fetchedAt: new Date().toISOString(),
      };
    }
  }
};

export const fetchTtsEngineVoices = async (
  engine: GenerationSettings['engine'],
  baseUrl?: string
): Promise<TtsEngineVoicesResponse> => {
  const params = new URLSearchParams({ engine });
  return requestJson<TtsEngineVoicesResponse>(`/tts/engines/voices?${params.toString()}`, undefined, withBaseUrl(baseUrl));
};

export const fetchTtsVoiceMappingCatalog = async (
  baseUrl?: string
): Promise<TtsVoiceMappingCatalogResponse> => {
  return requestJson<TtsVoiceMappingCatalogResponse>('/tts/voice-mapping/catalog', undefined, withBaseUrl(baseUrl));
};

export const switchTtsEngine = async (
  engine: GenerationSettings['engine'],
  options?: { gpu?: boolean; baseUrl?: string; adminUnlockToken?: string }
): Promise<TtsEngineSwitchResponse> => {
  const unlockToken = String(options?.adminUnlockToken || '').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (unlockToken) {
    headers['X-Admin-Unlock'] = `Bearer ${unlockToken}`;
  }
  return requestJson<TtsEngineSwitchResponse>(
    '/tts/engines/switch',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ engine, gpu: Boolean(options?.gpu) }),
    },
    withBaseUrl(options?.baseUrl)
  );
};

export const activateTtsEngine = async (
  engine: GenerationSettings['engine'],
  options?: { baseUrl?: string }
): Promise<TtsEngineSwitchResponse> => {
  const requestId = createClientRequestId();
  return requestJson<TtsEngineSwitchResponse>(
    '/tts/engines/activate',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [IDEMPOTENCY_HEADER]: requestId,
      },
      body: JSON.stringify({ engine }),
    },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const fetchTtsEngineCapabilities = async (baseUrl?: string): Promise<TtsEngineCapabilitiesResponse> => {
  return requestJson<TtsEngineCapabilitiesResponse>(
    '/tts/engines/capabilities',
    undefined,
    { ...withBaseUrl(baseUrl), requireAuth: true }
  );
};

export const tailRuntimeLogs = async (
  service: RuntimeLogService,
  options?: { cursor?: number; maxBytes?: number; lineLimit?: number; baseUrl?: string }
): Promise<RuntimeLogTailResponse> => {
  const params = new URLSearchParams({ service });
  if (typeof options?.cursor === 'number' && Number.isFinite(options.cursor)) {
    params.set('cursor', String(Math.max(0, Math.floor(options.cursor))));
  }
  if (typeof options?.maxBytes === 'number' && Number.isFinite(options.maxBytes)) {
    params.set('max_bytes', String(Math.max(1024, Math.floor(options.maxBytes))));
  }
  if (typeof options?.lineLimit === 'number' && Number.isFinite(options.lineLimit)) {
    params.set('line_limit', String(Math.max(1, Math.floor(options.lineLimit))));
  }
  return requestJson<RuntimeLogTailResponse>(
    `/runtime/logs/tail?${params.toString()}`,
    undefined,
    withBaseUrl(options?.baseUrl)
  );
};

export const transcribeVideo = async (
  file: File,
  options?: {
    language?: string;
    task?: 'transcribe' | 'translate';
    includeEmotion?: boolean;
    returnWords?: boolean;
    speakerLabel?: string;
    baseUrl?: string;
  }
): Promise<VideoTranscriptionResponse> => {
  void file;
  void options;
  throw removedGatewayFeature('Video transcription');
};

export const extractAudioFromVideo = async (
  file: File,
  options?: { baseUrl?: string }
): Promise<Blob> => {
  void file;
  void options;
  throw removedGatewayFeature('Audio extraction');
};

export const separateStem = async (
  file: File,
  options?: { stem?: 'speech' | 'background'; modelName?: string; baseUrl?: string }
): Promise<Blob> => {
  void file;
  void options;
  throw removedGatewayFeature('Stem separation');
};

export const fetchTtsJobChunkAudio = async (
  jobId: string,
  chunkIndex: number,
  baseUrl?: string
): Promise<ArrayBuffer> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  const safeChunkIndex = Math.max(0, Math.floor(Number(chunkIndex || 0)));
  const blob = await requestBlob(
    `/tts/v2/jobs/${safeJobId}/chunks/${safeChunkIndex}/audio`,
    undefined,
    withBaseUrl(baseUrl)
  );
  return blob.arrayBuffer();
};

export const createTtsJob = async (
  payload: Record<string, unknown>,
  options?: { baseUrl?: string }
): Promise<CreateTtsJobResponse> => {
  const safePayload: Record<string, unknown> = { ...payload };
  // Backend schema is strict (extra=forbid), so normalize aliases up-front.
  delete safePayload.requestId;
  delete safePayload.idempotencyKey;
  delete safePayload.idempotency_key;
  const text = String(safePayload.text || '').trim();
  if (text.length > 10_000) {
    throw new Error('text exceeds 10k character queue limit');
  }
  const nowMs = Date.now();
  pruneCreateTtsJobDedupeState(nowMs);
  const baseCacheKey = ttsV2SessionCacheKey(options?.baseUrl);
  const payloadFingerprint = createTtsJobPayloadFingerprint(safePayload, options?.baseUrl);
  let requestId = String(safePayload.request_id || safePayload.requestId || '').trim();
  let requestIdSource: 'caller-provided' | 'generated' | 'cached-auto-request-id' = 'caller-provided';
  if (!requestId) {
    const cachedRequestId = TTS_V2_AUTO_REQUEST_IDS.get(payloadFingerprint);
    if (cachedRequestId && cachedRequestId.expiresAtMs > nowMs) {
      requestId = cachedRequestId.requestId;
      requestIdSource = 'cached-auto-request-id';
    } else {
      const persisted = readAutoRequestIdCacheEntry(payloadFingerprint, nowMs);
      if (persisted) {
        requestId = persisted.requestId;
        requestIdSource = 'cached-auto-request-id';
        TTS_V2_AUTO_REQUEST_IDS.set(payloadFingerprint, {
          requestId,
          expiresAtMs: persisted.expiresAtMs,
        });
      } else {
        requestId = crypto.randomUUID();
        requestIdSource = 'generated';
        const expiresAtMs = nowMs + TTS_V2_AUTO_REQUEST_ID_TTL_MS;
        TTS_V2_AUTO_REQUEST_IDS.set(payloadFingerprint, {
          requestId,
          expiresAtMs,
        });
        writeAutoRequestIdCacheEntry({
          requestId,
          expiresAtMs,
          payloadFingerprint,
        });
      }
    }
    safePayload.request_id = requestId;
  }
  safePayload.request_id = requestId;
  const dedupeKey = `${baseCacheKey}:${requestId}`;
  const recent = TTS_V2_CREATE_RECENT.get(dedupeKey);
  if (recent && recent.expiresAtMs > nowMs) {
    return cloneTtsJobResponseWithDedupe(
      recent.response,
      createClientDedupeMarker('recent-cache-hit', requestId, payloadFingerprint, options?.baseUrl)
    );
  }
  const inFlight = TTS_V2_CREATE_IN_FLIGHT.get(dedupeKey);
  if (inFlight) {
    return inFlight.then((response) =>
      cloneTtsJobResponseWithDedupe(
        response,
        createClientDedupeMarker('in-flight-dedupe', requestId, payloadFingerprint, options?.baseUrl)
      )
    );
  }
  const buildHeaders = (sessionKey: string): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [TTS_V2_SESSION_HEADER]: sessionKey,
    };
    if (requestId) {
      headers[IDEMPOTENCY_HEADER] = requestId;
    }
    if (requestIdSource === 'cached-auto-request-id') {
      headers[CLIENT_DEDUPE_HEADER] = 'auto-request-id-reuse';
    }
    return headers;
  };
  const runCreate = async (forceSession: boolean): Promise<TtsJobStatusResponse> => {
    const sessionKey = await issueTtsV2SessionKey({
      ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(forceSession ? { force: true } : {}),
    });
    return requestJson<TtsJobStatusResponse>(
      '/tts/v2/jobs',
      {
        method: 'POST',
        headers: buildHeaders(sessionKey),
        body: JSON.stringify(safePayload),
      },
      { ...withBaseUrl(options?.baseUrl), requireAuth: true }
    );
  };
  const pending = (async (): Promise<CreateTtsJobResponse> => {
    try {
      const created = await runCreate(false);
      const marker = requestIdSource === 'cached-auto-request-id'
        ? createClientDedupeMarker('auto-request-id-reuse', requestId, payloadFingerprint, options?.baseUrl)
        : undefined;
      return marker
        ? cloneTtsJobResponseWithDedupe(created, marker)
        : cloneTtsJobResponseWithDedupe(created);
    } catch (error: unknown) {
      const detail = String((error as { message?: string; detail?: string })?.detail || (error as { message?: string })?.message || '').trim().toLowerCase();
      const status = Number((error as { status?: number })?.status || 0);
      const looksLikeExpiredSession =
        (status === 401 || status === 403)
        && (
          detail.includes('invalid or expired tts session key')
          || detail.includes('tts session key')
          || detail.includes('session key')
        );
      const looksLikeAuthBootstrapRace =
        (status === 401 || status === 403)
        && (
          detail.includes('missing bearer token')
          || detail.includes('unauthorized')
          || detail.includes('auth token')
        );
      if (!looksLikeExpiredSession && !looksLikeAuthBootstrapRace) {
        throw error;
      }
      clearTtsV2SessionKeyCache(options?.baseUrl);
      if (looksLikeAuthBootstrapRace) {
        await new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, 250);
        });
      }
      const retried = await runCreate(true);
      const marker = requestIdSource === 'cached-auto-request-id'
        ? createClientDedupeMarker('auto-request-id-reuse', requestId, payloadFingerprint, options?.baseUrl)
        : undefined;
      return marker
        ? cloneTtsJobResponseWithDedupe(retried, marker)
        : cloneTtsJobResponseWithDedupe(retried);
    }
  })();
  TTS_V2_CREATE_IN_FLIGHT.set(dedupeKey, pending as Promise<TtsJobStatusResponse>);
  try {
    const created = await pending;
    const cachedResponse = cloneTtsJobResponse(created) as CreateTtsJobResponse;
    delete cachedResponse.clientDedupe;
    TTS_V2_CREATE_RECENT.set(dedupeKey, {
      response: cachedResponse,
      expiresAtMs: Date.now() + TTS_V2_CREATE_RECENT_TTL_MS,
    });
    return created;
  } finally {
    if (TTS_V2_CREATE_IN_FLIGHT.get(dedupeKey) === pending) {
      TTS_V2_CREATE_IN_FLIGHT.delete(dedupeKey);
    }
  }
};

export const getTtsJob = async (
  jobId: string,
  options?: {
    includeResult?: boolean;
    includeChunks?: boolean;
    chunkCursor?: number;
    chunkLimit?: number;
    includeChunkAudio?: boolean;
    baseUrl?: string;
  }
): Promise<TtsJobStatusResponse> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  const searchParams = new URLSearchParams();
  if (options?.includeResult) searchParams.set('includeResult', '1');
  if (options?.includeChunks) searchParams.set('includeChunks', '1');
  if (typeof options?.chunkCursor === 'number' && Number.isFinite(options.chunkCursor)) {
    searchParams.set('chunkCursor', String(Math.max(0, Math.floor(options.chunkCursor))));
  }
  if (typeof options?.chunkLimit === 'number' && Number.isFinite(options.chunkLimit)) {
    searchParams.set('chunkLimit', String(Math.max(1, Math.floor(options.chunkLimit))));
  }
  if (typeof options?.includeChunkAudio === 'boolean') {
    searchParams.set('includeChunkAudio', options.includeChunkAudio ? '1' : '0');
  }
  const path = searchParams.toString()
    ? `/tts/v2/jobs/${safeJobId}?${searchParams.toString()}`
    : `/tts/v2/jobs/${safeJobId}`;
  return requestJson<TtsJobStatusResponse>(
    path,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const cancelTtsJob = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<TtsJobStatusResponse> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  return requestJson<TtsJobStatusResponse>(
    `/tts/v2/jobs/${safeJobId}/cancel`,
    { method: 'POST' },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const fetchTtsJobResult = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<{ audioBytes: ArrayBuffer; mediaType: string; headers: Record<string, string> }> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  const response = await authFetch(
    resolveApiUrl(`/tts/v2/jobs/${safeJobId}/result/audio`, options?.baseUrl),
    undefined,
    { requireAuth: true }
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  const blob = await response.blob();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    const safeKey = String(key || '').trim().toLowerCase();
    if (!safeKey) return;
    headers[safeKey] = String(value || '');
  });
  return {
    audioBytes: await blob.arrayBuffer(),
    mediaType: String(blob.type || 'audio/wav'),
    headers,
  };
};
