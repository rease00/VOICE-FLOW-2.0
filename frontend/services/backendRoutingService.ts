import type { GenerationSettings } from '../types';
import { fetchRoutingBackendCandidates } from '../src/shared/api/gatewayClient';
import { resolveApiBaseUrl, sanitizeConfiguredApiBaseUrl } from '../src/shared/api/config';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson, writeStorageJson } from '../src/shared/storage/localStore';
import {
  clearGeminiRegionSelection,
  deriveGeminiRegionSelectionFromLocation,
  setGeminiRegionSelection,
} from './geminiRegionRouting';

const LOGIN_ROUTING_SESSION_FLAG = 'vf_backend_routing_login_once_v1';
const DEFAULT_PROBE_TIMEOUT_MS = 3500;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 2500;

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

const probeCandidateRtt = async (baseUrl: string, timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS): Promise<number> => {
  const safeBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!safeBase) return Number.POSITIVE_INFINITY;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
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
  } catch {
    return Number.POSITIVE_INFINITY;
  } finally {
    window.clearTimeout(timer);
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

export const applyNearestBackendRoutingOnLogin = async (): Promise<LoginRoutingResult> => {
  if (typeof window === 'undefined') {
    return { applied: false, reason: 'window_unavailable' };
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
    });
  } catch {
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
      const rttMs = await probeCandidateRtt(baseUrl);
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

  const regionSelection = deriveGeminiRegionSelectionFromLocation(selected.region || '', 'login_auto_nearest');
  setGeminiRegionSelection(regionSelection);
  const selectedRegion = String(selected.region || '').trim();
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

export const clearNearestBackendRoutingState = (): void => {
  try {
    sessionStorage.removeItem(LOGIN_ROUTING_SESSION_FLAG);
  } catch {
    // no-op
  }
  clearGeminiRegionSelection();
};
