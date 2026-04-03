import type { GenerationSettings } from '../types';
import { fetchRoutingBackendCandidates, issueTtsV2SessionKey } from '../src/shared/api/gatewayClient';
import { resolveApiBaseUrl, sanitizeConfiguredApiBaseUrl } from '../src/shared/api/config';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson, writeStorageJson } from '../src/shared/storage/localStore';
import {
  clearGeminiRegionSelection,
  deriveGeminiRegionSelectionFromLocation,
  resolveGeminiRegionSelection,
  setGeminiRegionSelection,
} from './geminiRegionRouting';

const LOGIN_ROUTING_SESSION_FLAG = 'vf_backend_routing_login_once_v1';
const DEFAULT_PROBE_TIMEOUT_MS = 3500;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 2500;

const createAbortError = (): Error => {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
};

export const BACKEND_ROUTING_APPLIED_EVENT = 'vf:backend-routing-applied';

type SettingsShape = Partial<GenerationSettings> & Record<string, unknown>;

const readSettings = (): SettingsShape => {
  const parsed = readStorageJson<SettingsShape>(STORAGE_KEYS.settings);
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const readCurrentBackendUrl = (): string => {
  const settings = readSettings();
  return resolveApiBaseUrl(String(settings.mediaBackendUrl || '').trim());
};

const markSessionRouted = (): void => {
  try {
    sessionStorage.setItem(LOGIN_ROUTING_SESSION_FLAG, '1');
  } catch {
    // no-op
  }
};

const hasSessionRoutingRun = (): boolean => {
  try {
    return sessionStorage.getItem(LOGIN_ROUTING_SESSION_FLAG) === '1';
  } catch {
    return false;
  }
};

const probeCandidateRtt = async (
  baseUrl: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<number> => {
  const safeBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!safeBase) return Number.POSITIVE_INFINITY;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      globalThis.clearTimeout(timer);
      throw createAbortError();
    }
    signal.addEventListener('abort', forwardAbort, { once: true });
  }
  const startedAt = performance.now();
  try {
    const response = await fetch(`${safeBase}/health`, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) return Number.POSITIVE_INFINITY;
    return Math.max(0, performance.now() - startedAt);
  } catch (error: unknown) {
    if (signal?.aborted || controller.signal.aborted) {
      throw error instanceof Error && error.name === 'AbortError' ? error : createAbortError();
    }
    return Number.POSITIVE_INFINITY;
  } finally {
    globalThis.clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', forwardAbort);
    }
  }
};

const persistBackendUrl = (baseUrl: string): string => {
  const current = readSettings();
  const sanitized = sanitizeConfiguredApiBaseUrl(baseUrl, resolveApiBaseUrl(String(current.mediaBackendUrl || '')));
  const nextSettings: SettingsShape = {
    ...current,
    mediaBackendUrl: sanitized.value,
  };
  writeStorageJson(STORAGE_KEYS.settings, nextSettings);
  return sanitized.value;
};

interface LoginRoutingResult {
  applied: boolean;
  reason: string;
  baseUrl?: string;
  rttMs?: number;
  selectedRegion?: string;
  regionHint?: string;
  regionSource?: string;
}

export interface LoginTtsSessionPrimeResult {
  primed: boolean;
  reason: string;
  sessionKey?: string;
}

export const applyNearestBackendRoutingOnLogin = async (options?: { signal?: AbortSignal }): Promise<LoginRoutingResult> => {
  if (typeof window === 'undefined') {
    return { applied: false, reason: 'window_unavailable' };
  }
  if (options?.signal?.aborted) {
    throw createAbortError();
  }
  if (hasSessionRoutingRun()) {
    return { applied: false, reason: 'already_ran' };
  }

  const discoveryBase = readCurrentBackendUrl();
  let payload;
  try {
    payload = await fetchRoutingBackendCandidates({
      baseUrl: discoveryBase,
      timeoutMs: DEFAULT_DISCOVERY_TIMEOUT_MS,
      force: true,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  } catch {
    if (options?.signal?.aborted) {
      throw createAbortError();
    }
    return { applied: false, reason: 'discovery_failed' };
  }

  const rawCandidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  if (!rawCandidates.length) {
    return { applied: false, reason: 'no_candidates' };
  }

  const reachable = rawCandidates.filter((candidate) => {
    const base = String(candidate?.baseUrl || '').trim();
    return Boolean(base) && Boolean(candidate?.probeOk);
  });
  if (!reachable.length) {
    return { applied: false, reason: 'no_reachable_candidates' };
  }

  const selectedRegionFromPayload = String(payload?.selectedRegion || '').trim().toLowerCase();
  const selectedBaseUrlFromPayload = String(payload?.selectedBaseUrl || '').trim();
  const normalizedBaseUrls = new Set(reachable.map((candidate) => resolveApiBaseUrl(String(candidate.baseUrl || '').trim())));
  const sharesBaseUrl = normalizedBaseUrls.size <= 1;

  const selectionPool = sharesBaseUrl
    ? reachable.map((candidate) => ({
        baseUrl: resolveApiBaseUrl(String(candidate.baseUrl || '').trim()),
        region: String(candidate.region || '').trim().toLowerCase(),
        supportsTts: Boolean(candidate.capabilities?.supportsTts ?? true),
        healthy: Boolean(candidate.healthy ?? candidate.probeOk ?? true),
        queueDepth: Number.isFinite(Number(candidate.queueDepth)) ? Math.max(0, Math.floor(Number(candidate.queueDepth))) : 0,
        oldestQueuedAgeMs: Number.isFinite(Number(candidate.oldestQueuedAgeMs))
          ? Math.max(0, Math.floor(Number(candidate.oldestQueuedAgeMs)))
          : 0,
        rttMs: 0,
      }))
    : await Promise.all(
        reachable.map(async (candidate) => {
          const baseUrl = String(candidate.baseUrl || '').trim();
          const rttMs = await probeCandidateRtt(baseUrl, DEFAULT_PROBE_TIMEOUT_MS, options?.signal);
          return {
            baseUrl,
            region: String(candidate.region || '').trim().toLowerCase(),
            supportsTts: Boolean(candidate.capabilities?.supportsTts ?? true),
            healthy: Boolean(candidate.healthy ?? candidate.probeOk ?? true),
            queueDepth: Number.isFinite(Number(candidate.queueDepth)) ? Math.max(0, Math.floor(Number(candidate.queueDepth))) : 0,
            oldestQueuedAgeMs: Number.isFinite(Number(candidate.oldestQueuedAgeMs))
              ? Math.max(0, Math.floor(Number(candidate.oldestQueuedAgeMs)))
              : 0,
            rttMs,
          };
        })
      );

  const viable = selectionPool.filter((entry) => (
    Boolean(entry.supportsTts)
    && Boolean(entry.healthy)
    && Number.isFinite(Number(entry.rttMs))
  ));
  if (!viable.length) {
    return { applied: false, reason: 'all_candidate_probes_failed' };
  }

  viable.sort((a, b) => {
    const aQueue = Number.isFinite(Number(a.queueDepth)) ? Number(a.queueDepth) : Number.POSITIVE_INFINITY;
    const bQueue = Number.isFinite(Number(b.queueDepth)) ? Number(b.queueDepth) : Number.POSITIVE_INFINITY;
    if (aQueue !== bQueue) return aQueue - bQueue;
    const aOldest = Number.isFinite(Number(a.oldestQueuedAgeMs)) ? Number(a.oldestQueuedAgeMs) : Number.POSITIVE_INFINITY;
    const bOldest = Number.isFinite(Number(b.oldestQueuedAgeMs)) ? Number(b.oldestQueuedAgeMs) : Number.POSITIVE_INFINITY;
    if (aOldest !== bOldest) return aOldest - bOldest;
    const aSelected = selectedRegionFromPayload && a.region === selectedRegionFromPayload ? 0 : 1;
    const bSelected = selectedRegionFromPayload && b.region === selectedRegionFromPayload ? 0 : 1;
    if (aSelected !== bSelected) return aSelected - bSelected;
    const aRtt = Number.isFinite(Number(a.rttMs)) ? Number(a.rttMs) : Number.POSITIVE_INFINITY;
    const bRtt = Number.isFinite(Number(b.rttMs)) ? Number(b.rttMs) : Number.POSITIVE_INFINITY;
    if (aRtt !== bRtt) return aRtt - bRtt;
    if (a.baseUrl !== b.baseUrl) return a.baseUrl.localeCompare(b.baseUrl);
    return a.region.localeCompare(b.region);
  });
  const selected = viable[0];
  if (!selected) {
    return { applied: false, reason: 'selection_failed' };
  }

  const selectedRegion = String(selected.region || '').trim();
  const canPersistNearestRegionHint = Boolean(selectedRegion) && reachable.length > 1;
  const regionSelection = canPersistNearestRegionHint
    ? deriveGeminiRegionSelectionFromLocation(selectedRegion, 'login_auto_nearest')
    : { regionHint: '', regionSource: '' };
  if (canPersistNearestRegionHint) {
    setGeminiRegionSelection(regionSelection);
  } else {
    clearGeminiRegionSelection();
  }
  const regionHint = String(regionSelection.regionHint || '').trim();
  const regionSource = String(regionSelection.regionSource || '').trim();
  const routingDetail: Record<string, string> = {};
  if (selectedRegion) routingDetail.selectedRegion = selectedRegion;
  if (selectedBaseUrlFromPayload) routingDetail.selectedBaseUrl = selectedBaseUrlFromPayload;
  if (regionHint) routingDetail.regionHint = regionHint;
  if (regionSource) routingDetail.regionSource = regionSource;

  const currentBase = readCurrentBackendUrl();
  const nextBase = persistBackendUrl(selected.baseUrl);
  markSessionRouted();
  if (resolveApiBaseUrl(currentBase) === resolveApiBaseUrl(nextBase)) {
    return {
      applied: false,
      reason: 'already_selected',
      baseUrl: nextBase,
      rttMs: Math.round(selected.rttMs),
      ...routingDetail,
    };
  }

  window.dispatchEvent(
    new CustomEvent(BACKEND_ROUTING_APPLIED_EVENT, {
      detail: {
        baseUrl: nextBase,
        rttMs: Math.round(selected.rttMs),
        source: 'login_auto_nearest',
        ...routingDetail,
      },
    })
  );
  return {
    applied: true,
    reason: 'switched',
    baseUrl: nextBase,
    rttMs: Math.round(selected.rttMs),
    ...routingDetail,
  };
};

export const primeLoginTtsSessionKey = async (options?: {
  baseUrl?: string;
  regionHint?: string;
  regionSource?: string;
  signal?: AbortSignal;
}): Promise<LoginTtsSessionPrimeResult> => {
  if (typeof window === 'undefined') {
    return { primed: false, reason: 'window_unavailable' };
  }
  if (options?.signal?.aborted) {
    return { primed: false, reason: 'aborted' };
  }

  const baseUrl = String(options?.baseUrl || readCurrentBackendUrl()).trim();
  const persistedRegionSelection = resolveGeminiRegionSelection();
  const regionHint = String(options?.regionHint || persistedRegionSelection.regionHint || '').trim();
  const regionSource = String(options?.regionSource || persistedRegionSelection.regionSource || '').trim();

  try {
    const sessionKey = await issueTtsV2SessionKey({
      baseUrl,
      force: true,
      ...(regionHint ? { regionHint } : {}),
      ...(regionSource ? { regionSource } : {}),
      probeAllSlotRegions: true,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return {
      primed: true,
      reason: 'primed',
      sessionKey,
    };
  } catch {
    if (options?.signal?.aborted) {
      return { primed: false, reason: 'aborted' };
    }
    return {
      primed: false,
      reason: 'session_issue_failed',
    };
  }
};

export const primeLoginRoutingAfterAccountBootstrap = async (options?: {
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<LoginRoutingResult> => {
  const routingOptions: { signal?: AbortSignal } = {};
  if (options?.signal) {
    routingOptions.signal = options.signal;
  }
  const routingResult = await applyNearestBackendRoutingOnLogin(routingOptions);
  const primeOptions: { baseUrl?: string; regionHint?: string; regionSource?: string; signal?: AbortSignal } = {};
  const nextBaseUrl = routingResult.baseUrl || String(options?.baseUrl || '').trim();
  if (nextBaseUrl) {
    primeOptions.baseUrl = nextBaseUrl;
  }
  if (routingResult.regionHint) {
    primeOptions.regionHint = routingResult.regionHint;
  }
  if (routingResult.regionSource) {
    primeOptions.regionSource = routingResult.regionSource;
  }
  if (options?.signal) {
    primeOptions.signal = options.signal;
  }
  void primeLoginTtsSessionKey(primeOptions).catch(() => undefined);
  return routingResult;
};

export const clearNearestBackendRoutingState = (): void => {
  try {
    sessionStorage.removeItem(LOGIN_ROUTING_SESSION_FLAG);
  } catch {
    // no-op
  }
  clearGeminiRegionSelection();
};
