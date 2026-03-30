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
const LOGIN_TTS_SESSION_BOOTSTRAP_FLAG = 'vf_tts_v2_login_season_pin_once_v1';
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
  const timer = window.setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      window.clearTimeout(timer);
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
    window.clearTimeout(timer);
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

export interface LoginSeasonPinBootstrapResult extends LoginRoutingResult {
  sessionKey?: string;
  sessionIssued?: boolean;
  sessionReason?: string;
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
  markSessionRouted();

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

  const candidatePool = reachable;

  const probes = await Promise.all(
    candidatePool.map(async (candidate) => {
      const baseUrl = String(candidate.baseUrl || '').trim();
      const rttMs = await probeCandidateRtt(baseUrl, DEFAULT_PROBE_TIMEOUT_MS, options?.signal);
      return {
        baseUrl,
        region: String(candidate.region || '').trim(),
        supportsTts: Boolean(candidate.capabilities?.supportsTts),
        rttMs,
      };
    })
  );

  const viable = probes.filter((entry) => Number.isFinite(entry.rttMs));
  if (!viable.length) {
    return { applied: false, reason: 'all_candidate_probes_failed' };
  }

  const preferred = viable.filter((entry) => Boolean(entry.supportsTts));
  const selectionPool = preferred.length > 0 ? preferred : viable;
  selectionPool.sort((a, b) => a.rttMs - b.rttMs || a.baseUrl.localeCompare(b.baseUrl));
  const selected = selectionPool[0];
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
  if (regionHint) routingDetail.regionHint = regionHint;
  if (regionSource) routingDetail.regionSource = regionSource;

  const currentBase = readCurrentBackendUrl();
  const nextBase = persistBackendUrl(selected.baseUrl);
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

const hasSessionTtsBootstrapRun = (): boolean => {
  try {
    return sessionStorage.getItem(LOGIN_TTS_SESSION_BOOTSTRAP_FLAG) === '1';
  } catch {
    return false;
  }
};

const markSessionTtsBootstrapRun = (): void => {
  try {
    sessionStorage.setItem(LOGIN_TTS_SESSION_BOOTSTRAP_FLAG, '1');
  } catch {
    // no-op
  }
};

export const bootstrapLoginSeasonPinning = async (options?: { signal?: AbortSignal }): Promise<LoginSeasonPinBootstrapResult> => {
  if (typeof window === 'undefined') {
    return { applied: false, reason: 'window_unavailable', sessionIssued: false, sessionReason: 'window_unavailable' };
  }
  if (options?.signal?.aborted) {
    throw createAbortError();
  }
  if (hasSessionTtsBootstrapRun()) {
    return { applied: false, reason: 'already_ran', sessionIssued: false, sessionReason: 'already_ran' };
  }
  markSessionTtsBootstrapRun();

  const routingResult = await applyNearestBackendRoutingOnLogin(
    options?.signal ? { signal: options.signal } : undefined
  );
  const baseUrl = String(routingResult.baseUrl || readCurrentBackendUrl()).trim();
  const persistedRegionSelection = resolveGeminiRegionSelection();
  const regionHint = String(routingResult.regionHint || persistedRegionSelection.regionHint || '').trim();
  const regionSource = String(routingResult.regionSource || persistedRegionSelection.regionSource || '').trim();

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
      ...routingResult,
      sessionKey,
      sessionIssued: true,
    };
  } catch {
    if (options?.signal?.aborted) {
      throw createAbortError();
    }
    return {
      ...routingResult,
      sessionIssued: false,
      sessionReason: 'session_issue_failed',
    };
  }
};

export const clearNearestBackendRoutingState = (): void => {
  try {
    sessionStorage.removeItem(LOGIN_ROUTING_SESSION_FLAG);
    sessionStorage.removeItem(LOGIN_TTS_SESSION_BOOTSTRAP_FLAG);
  } catch {
    // no-op
  }
  clearGeminiRegionSelection();
};
