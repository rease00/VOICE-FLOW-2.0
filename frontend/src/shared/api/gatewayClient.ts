import type { GenerationSettings } from '../../../types';
import { authFetch } from '../../../services/authHttpClient';
import type {
  EngineStatusItem,
  RuntimeLogTailResponse,
  TtsEngineCapabilitiesResponse,
  TtsEngineStatusResponse,
  TtsJobStatusResponse,
  TtsEngineSwitchResponse,
  TtsVoiceMappingCatalogResponse,
  TtsEngineVoicesResponse,
  VideoTranscriptionResponse,
  CreateDubbingJobV2Response,
  DubbingJobStatusResponse,
} from './contracts';
import { resolveApiBaseUrl, resolveApiUrl } from './config';
import { requestBlob, requestJson } from './httpClient';

export type RuntimeLogService = 'media-backend' | 'gemini-runtime';
const TTS_V2_SESSION_HEADER = 'x-vf-tts-session-key';
const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const TTS_V2_SESSION_REFRESH_SKEW_MS = 30_000;
const TTS_V2_SESSION_CACHE = new Map<string, { sessionKey: string; expiresAtMs: number }>();
const TTS_V2_SESSION_IN_FLIGHT = new Map<string, Promise<string>>();

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
  const inFlight = TTS_V2_SESSION_IN_FLIGHT.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
    const issued = await requestJson<TtsV2SessionIssueResponse>(
      '/tts/v2/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      { method: 'POST' },
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
}

interface RoutingRegionsSnapshotResponse {
  ok: boolean;
  fetchedAt?: string;
  selectedRegion?: string;
  selectedBaseUrl?: string;
  queueDepth?: number;
  oldestQueuedAgeMs?: number;
  regions?: RoutingBackendCandidate[];
  candidates?: RoutingBackendCandidate[];
}

export interface TtsEngineLatencyResponse extends EngineStatusItem {
  ok: boolean;
  engine: GenerationSettings['engine'];
  gcpPingMs: number;
  latencyMs: number;
}

export const fetchTtsEnginesStatus = async (
  engine?: GenerationSettings['engine'],
  baseUrl?: string,
  options?: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined }
): Promise<TtsEngineStatusResponse> => {
  const params = new URLSearchParams();
  if (engine) params.set('engine', engine);
  const path = `/tts/engines/status${params.toString() ? `?${params.toString()}` : ''}`;
  return fetchAuthJsonWithTimeout<TtsEngineStatusResponse>(path, {
    ...(baseUrl ? { baseUrl } : {}),
    ...(typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
};

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

export const fetchTtsEngineCapabilities = async (baseUrl?: string): Promise<TtsEngineCapabilitiesResponse> => {
  return requestJson<TtsEngineCapabilitiesResponse>(
    '/tts/engines/capabilities',
    undefined,
    { ...withBaseUrl(baseUrl), requireAuth: true }
  );
};

export const fetchTtsEngineLatency = async (
  engine: GenerationSettings['engine'],
  baseUrl?: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<TtsEngineLatencyResponse> => {
  const params = new URLSearchParams({ engine });
  const startedAtMs = Date.now();
  const healthUrl = resolveApiUrl('/health', baseUrl);
  const runtimeUrl = resolveApiBaseUrl(baseUrl);
  try {
    const status = await fetchAuthJsonWithTimeout<TtsEngineStatusResponse>(
      `/tts/engines/status?${params.toString()}`,
      {
        baseUrl,
        ...(typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
          ? { timeoutMs: options.timeoutMs }
          : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
      }
    );
    const engineItem = status.engines?.[engine];
    const latencyMs = Math.max(0, Date.now() - startedAtMs);
    if (!engineItem) {
      return {
        ok: false,
        engine,
        state: 'offline',
        detail: 'Runtime status unavailable.',
        ready: false,
        healthUrl,
        runtimeUrl,
        gcpPingMs: latencyMs,
        latencyMs,
      };
    }
    return {
      ok: true,
      ...engineItem,
      gcpPingMs: latencyMs,
      latencyMs,
    };
  } catch {
    const latencyMs = Math.max(0, Date.now() - startedAtMs);
    return {
      ok: false,
      engine,
      state: 'offline',
      detail: 'Runtime status unavailable.',
      ready: false,
      healthUrl,
      runtimeUrl,
      gcpPingMs: latencyMs,
      latencyMs,
    };
  }
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

export const muxDubbedVideo = async (
  videoFile: File,
  dubAudioFile: File,
  options?: {
    speechGain?: number;
    backgroundGain?: number;
    normalize?: boolean;
    backgroundAudio?: File;
    baseUrl?: string;
  }
): Promise<Blob> => {
  void videoFile;
  void dubAudioFile;
  void options;
  throw removedGatewayFeature('Video dubbing mux');
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
): Promise<TtsJobStatusResponse> => {
  const requestId = String(
    (payload as Record<string, unknown>).request_id ||
    (payload as Record<string, unknown>).requestId ||
    ''
  ).trim();
  const buildHeaders = (sessionKey: string): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [TTS_V2_SESSION_HEADER]: sessionKey,
    };
    if (requestId) {
      headers[IDEMPOTENCY_HEADER] = requestId;
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
        body: JSON.stringify(payload),
      },
      { ...withBaseUrl(options?.baseUrl), requireAuth: true }
    );
  };
  try {
    return await runCreate(false);
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
    if (!looksLikeExpiredSession) {
      throw error;
    }
    clearTtsV2SessionKeyCache(options?.baseUrl);
    return runCreate(true);
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

export const createDubbingJobV2 = async (
  sourceFile: File,
  options?: {
    targetLanguage?: string;
    mode?: 'strict_full';
    output?: 'audio' | 'video' | 'audio+video';
    advanced?: Record<string, unknown>;
    baseUrl?: string;
  }
): Promise<CreateDubbingJobV2Response> => {
  void sourceFile;
  void options;
  throw removedGatewayFeature('Dubbing jobs');
};

export const getDubbingJob = async (jobId: string, baseUrl?: string): Promise<DubbingJobStatusResponse> => {
  void jobId;
  void baseUrl;
  throw removedGatewayFeature('Dubbing jobs');
};

export const getDubbingJobWithOptions = async (
  jobId: string,
  options?: {
    includeChunks?: boolean;
    chunkCursor?: number;
    chunkLimit?: number;
    includeChunkAudio?: boolean;
    baseUrl?: string;
  }
): Promise<DubbingJobStatusResponse> => {
  void jobId;
  void options;
  throw removedGatewayFeature('Dubbing jobs');
};

export const cancelDubbingJob = async (jobId: string, baseUrl?: string): Promise<{ ok: boolean; job_id: string }> => {
  void jobId;
  void baseUrl;
  throw removedGatewayFeature('Dubbing jobs');
};

export const downloadDubbingReport = async (jobId: string, baseUrl?: string): Promise<Blob> => {
  void jobId;
  void baseUrl;
  throw removedGatewayFeature('Dubbing reports');
};

export const downloadDubbingResult = async (jobId: string, baseUrl?: string): Promise<Blob> => {
  void jobId;
  void baseUrl;
  throw removedGatewayFeature('Dubbing results');
};

export const downloadDubbingChunk = async (
  jobId: string,
  chunkIndex: number,
  baseUrl?: string
): Promise<Blob> => {
  void jobId;
  void chunkIndex;
  void baseUrl;
  throw removedGatewayFeature('Dubbing chunks');
};
