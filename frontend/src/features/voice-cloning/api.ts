import { HttpError, requestJson } from '../../shared/api/httpClient';
import type { ClonedVoice } from '../../../types';
import type {
  VoiceCloneBenchmarkArtifact,
  VoiceCloneBenchmarkRequest,
  VoiceCloneBenchmarkResponse,
  VoiceCloneBenchmarkRuntime,
  VoiceCloneBenchmarkTimings,
  VoiceCloneBenchmarkStatusResponse,
  VoiceCloneStressBenchmarkTarget,
  VoiceCloneStressConfig,
  VoiceCloneStressStartRequest,
  VoiceCloneStressStatusResponse,
  VoiceCloneStressStepResult,
  VoiceCloneStressSummary,
} from './openvoiceTypes';

const DEFAULT_VOICE_CLONE_PROXY_BASE_URL = '/api/backend';

export type VoiceCloneRenderRequest = Omit<VoiceCloneBenchmarkRequest, 'mode' | 'runKind'> & {
  mode?: 'vc';
  runKind?: 'warm';
};

export type OpenVoiceCloneRequest = VoiceCloneRenderRequest;

export interface VoiceCloneRenderResponse extends VoiceCloneBenchmarkResponse {
  clonedVoice?: ClonedVoice;
}

export type OpenVoiceCloneResponse = VoiceCloneRenderResponse;

export type VoiceCloneJobKind = 'voice_clone' | 'openvoice';

export interface VoiceCloneJobProgress {
  percent?: number;
  stage?: string;
  detail?: string;
}

export interface VoiceCloneJobError {
  status?: number;
  message?: string;
  detail?: string;
  retryable?: boolean;
}

export interface VoiceCloneJobStatusResponse {
  ok: boolean;
  jobId: string;
  requestId: string;
  kind: VoiceCloneJobKind | string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: VoiceCloneJobProgress;
  result?: VoiceCloneRenderResponse;
  error?: VoiceCloneJobError;
}

export interface VoiceCloneStemSeparationRequest {
  sourceAudioBase64: string;
  sourceAudioName: string;
  sourceSeparationModel?: string;
  sourceSeparationDevice?: string;
  sourceTrimStartSec?: number;
  sourceTrimEndSec?: number;
  requestId?: string;
  traceId?: string;
}

export type OpenVoiceStemSeparationRequest = VoiceCloneStemSeparationRequest;

export interface VoiceCloneStemSeparationResponse {
  ok?: boolean;
  status?: string;
  requestId?: string;
  traceId?: string;
  sourceAudioName?: string;
  timings?: VoiceCloneBenchmarkTimings;
  runtime?: VoiceCloneBenchmarkRuntime;
  vocalsArtifact?: VoiceCloneBenchmarkArtifact;
  backgroundArtifact?: VoiceCloneBenchmarkArtifact;
  consumedVcUnits?: number;
  vcBilling?: {
    enabled?: boolean;
    reservedUnits?: number;
    consumedUnits?: number;
    chargedInr?: number;
    durationSec?: number;
    billableDurationSec?: number;
    rateInrPerMin?: number;
    rateVcUnitsPerMin?: number;
    rule?: string;
    breakdown?: {
      vcFree?: number;
      vcGranted?: number;
      vcPaid?: number;
    };
    remaining?: {
      vcFreeBalance?: number;
      vcGrantedBalance?: number;
      vcPaidBalance?: number;
      vcSpendableBalance?: number;
    };
    adminBypass?: boolean;
    idempotentReuse?: boolean;
    stages?: Record<string, unknown>;
  };
  notes?: string[];
  message?: string;
}

export type OpenVoiceStemSeparationResponse = VoiceCloneStemSeparationResponse;

export const fetchVoiceCloneStatus = async (
  options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<VoiceCloneBenchmarkStatusResponse> => requestVoiceCloneJson<VoiceCloneBenchmarkStatusResponse>(
  '/voice-clone/status',
  undefined,
  options
);

export const fetchOpenVoiceCloneStatus = fetchVoiceCloneStatus;

export const renderVoiceClone = async (
  payload: VoiceCloneRenderRequest,
  options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<VoiceCloneRenderResponse> => requestVoiceCloneJson<VoiceCloneRenderResponse>(
  '/voice-clone/render',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      mode: 'vc',
      runKind: 'warm',
    }),
    ...(options?.signal ? { signal: options.signal } : {}),
  },
  {
    requireAuth: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export const cloneVoiceWithOpenVoice = renderVoiceClone;

export const startVoiceCloneRenderJob = async (
  payload: VoiceCloneRenderRequest,
  options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<VoiceCloneJobStatusResponse> => requestVoiceCloneJson<VoiceCloneJobStatusResponse>(
  '/voice-clone/jobs/render',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      mode: 'vc',
      runKind: 'warm',
    }),
    ...(options?.signal ? { signal: options.signal } : {}),
  },
  {
    requireAuth: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export const startOpenVoiceCloneJob = startVoiceCloneRenderJob;

export const separateVoiceAndBackgroundWithDemucs = async (
  payload: VoiceCloneStemSeparationRequest,
  options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<VoiceCloneStemSeparationResponse> => requestVoiceCloneJson<VoiceCloneStemSeparationResponse>(
  '/voice-clone/separate',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    ...(options?.signal ? { signal: options.signal } : {}),
  },
  {
    requireAuth: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export const separateOpenVoiceAndBackgroundWithDemucs = separateVoiceAndBackgroundWithDemucs;

export const fetchVoiceCloneJobStatus = async (
  jobId: string,
  options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<VoiceCloneJobStatusResponse> => requestVoiceCloneJson<VoiceCloneJobStatusResponse>(
  `/voice-clone/jobs/${encodeURIComponent(String(jobId || '').trim())}`,
  options?.signal ? { signal: options.signal } : undefined,
  {
    requireAuth: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export const fetchVoiceCloneJobStatusByRequest = async (
  requestId: string,
  options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<VoiceCloneJobStatusResponse> => requestVoiceCloneJson<VoiceCloneJobStatusResponse>(
  `/voice-clone/jobs/by-request/${encodeURIComponent(String(requestId || '').trim())}`,
  options?.signal ? { signal: options.signal } : undefined,
  {
    requireAuth: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export const cancelVoiceCloneJob = async (
  jobId: string,
  options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<VoiceCloneJobStatusResponse> => requestVoiceCloneJson<VoiceCloneJobStatusResponse>(
  `/voice-clone/jobs/${encodeURIComponent(String(jobId || '').trim())}/cancel`,
  {
    method: 'POST',
    ...(options?.signal ? { signal: options.signal } : {}),
  },
  {
    requireAuth: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export type {
  VoiceCloneStressBenchmarkTarget,
  VoiceCloneStressConfig,
  VoiceCloneStressStartRequest,
  VoiceCloneStressStatusResponse,
  VoiceCloneStressStepResult,
  VoiceCloneStressSummary,
};

interface VoiceCloneStressRequestOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

interface VoiceCloneStressRequestAttempt {
  path: string;
  options: VoiceCloneStressRequestOptions | undefined;
}

const getStressRequestErrorStatus = (error: unknown): number => {
  if (!error || typeof error !== 'object') return 0;
  if (!('status' in error)) return 0;
  return Number((error as { status?: unknown }).status) || 0;
};

const trimTrailingSlash = (value: string): string => String(value || '').replace(/\/+$/, '');

const stripV1Suffix = (value: string): string => {
  const token = trimTrailingSlash(value);
  return token.replace(/\/v1$/i, '');
};

const isLocalAbsoluteVoiceCloneBaseUrl = (value: string): boolean => {
  const token = String(value || '').trim();
  if (!/^https?:\/\//i.test(token)) return false;
  try {
    const parsed = new URL(token);
    const hostname = String(parsed.hostname || '').trim().toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};

const isVoiceCloneRetryableError = (error: unknown): boolean => {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  if (status === 404) {
    return true;
  }

  const message = String((error as { message?: unknown })?.message || error || '').trim().toLowerCase();
  if (!message) return false;
  return [
    'failed to fetch',
    'fetch failed',
    'networkerror',
    'network error',
    'load failed',
    'econnrefused',
    'err_connection_refused',
  ].some((token) => message.includes(token));
};

const buildVoiceCloneRequestBaseUrls = (baseUrl?: string): string[] => {
  const directBaseUrl = String(baseUrl || '').trim();
  const attempts: string[] = [];
  const pushAttempt = (candidate: string) => {
    const normalized = String(candidate || '').trim();
    if (!normalized) return;
    if (attempts.includes(normalized)) return;
    attempts.push(normalized);
  };
  const shouldPreferProxy = isLocalAbsoluteVoiceCloneBaseUrl(directBaseUrl);
  if (shouldPreferProxy) {
    pushAttempt(DEFAULT_VOICE_CLONE_PROXY_BASE_URL);
  }
  if (directBaseUrl) {
    pushAttempt(directBaseUrl);
  }
  if (directBaseUrl !== DEFAULT_VOICE_CLONE_PROXY_BASE_URL) {
    pushAttempt(DEFAULT_VOICE_CLONE_PROXY_BASE_URL);
  }
  return attempts;
};

const extractVoiceCloneIdempotencyKey = (init?: RequestInit): string => {
  const body = init?.body;
  if (typeof body !== 'string' || !body.trim()) {
    return '';
  }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return String(
      parsed.idempotencyKey ||
      parsed.idempotency_key ||
      parsed.requestId ||
      parsed.request_id ||
      ''
    ).trim();
  } catch {
    return '';
  }
};

const withIdempotencyHeader = (init: RequestInit | undefined, idempotencyKey: string): RequestInit | undefined => {
  if (!idempotencyKey) {
    return init;
  }
  const headers = new Headers(init?.headers || {});
  if (!headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', idempotencyKey);
  }
  return {
    ...(init || {}),
    headers,
  };
};

const requestVoiceCloneJson = async <T>(
  path: string,
  init?: RequestInit,
  options?: { baseUrl?: string; timeoutMs?: number; requireAuth?: boolean; signal?: AbortSignal }
): Promise<T> => {
  const baseUrls = buildVoiceCloneRequestBaseUrls(options?.baseUrl);
  const idempotencyKey = extractVoiceCloneIdempotencyKey(init);
  const baseInit = withIdempotencyHeader(init, idempotencyKey);
  const requestMethod = String(init?.method || 'GET').trim().toUpperCase();
  const isCancelRoute = /\/cancel$/i.test(String(path || '').trim());
  const canRetryAcrossBaseUrls = requestMethod !== 'POST' || isCancelRoute;
  let lastError: unknown = null;

  for (const [index, baseUrl] of baseUrls.entries()) {
    try {
      const requestInit = options?.signal
        ? { ...baseInit, signal: options.signal }
        : baseInit;
      return await requestJson<T>(path, requestInit, {
        requireAuth: true,
        baseUrl,
        ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
      });
    } catch (error) {
      lastError = error;
      if (index >= baseUrls.length - 1 || !isVoiceCloneRetryableError(error) || !canRetryAcrossBaseUrls) {
        throw error;
      }
    }
  }

  throw (lastError instanceof Error ? lastError : new Error('Voice clone request failed.'));
};

const buildStressRequestAttempts = (
  path: string,
  options?: VoiceCloneStressRequestOptions,
  method?: string
): VoiceCloneStressRequestAttempt[] => {
  const requestMethod = String(method || 'GET').trim().toUpperCase();
  const timeoutOnlyOptions = Number.isFinite(options?.timeoutMs)
    ? { timeoutMs: Number(options?.timeoutMs) }
    : undefined;
  const attempts: VoiceCloneStressRequestAttempt[] = [
    { path, options },
  ];
  const baseUrl = String(options?.baseUrl || '').trim();
  if (!baseUrl) {
    attempts.push({ path: `/v1${path}`, options });
  } else {
    const normalizedBase = trimTrailingSlash(baseUrl);
    if (/\/v1$/i.test(normalizedBase)) {
      attempts.push({
        path,
        options: {
          ...options,
          baseUrl: stripV1Suffix(normalizedBase),
        },
      });
    } else {
      attempts.push({ path: `/v1${path}`, options });
      if (requestMethod !== 'POST') {
        // Last-resort: try the default API base (proxy/env default) when a custom backend URL misses admin routes.
        attempts.push({ path, options: timeoutOnlyOptions });
        attempts.push({ path: `/v1${path}`, options: timeoutOnlyOptions });
      }
    }
  }

  const deduped = new Map<string, VoiceCloneStressRequestAttempt>();
  for (const attempt of attempts) {
    const key = `${attempt.path}@@${String(attempt.options?.baseUrl || '').trim()}`;
    if (!deduped.has(key)) {
      deduped.set(key, attempt);
    }
  }
  return Array.from(deduped.values());
};

const requestVoiceCloneStressJson = async <T>(
  path: string,
  init?: RequestInit,
  options?: VoiceCloneStressRequestOptions
): Promise<T> => {
  const requestMethod = String(init?.method || 'GET').trim().toUpperCase();
  const attempts = buildStressRequestAttempts(path, options, requestMethod);
  let lastError: unknown = null;
  for (const [index, attempt] of attempts.entries()) {
    try {
      return await requestJson<T>(attempt.path, init, {
        requireAuth: true,
        ...(attempt.options?.baseUrl ? { baseUrl: attempt.options.baseUrl } : {}),
        ...(Number.isFinite(attempt.options?.timeoutMs) ? { timeoutMs: Number(attempt.options?.timeoutMs) } : {}),
      });
    } catch (error) {
      const status = getStressRequestErrorStatus(error);
      lastError = error;
      if (status !== 404 || index >= attempts.length - 1) {
        throw error;
      }
    }
  }

  if (getStressRequestErrorStatus(lastError) === 404) {
    const attemptLabels = attempts.map((attempt) => {
      const base = String(attempt.options?.baseUrl || '').trim() || 'default';
      return `${base}${attempt.path}`;
    }).join(' | ');
    throw new HttpError(404, 'Not Found', `Stress endpoint not found for attempts: ${attemptLabels}`);
  }

  throw (lastError instanceof Error ? lastError : new Error('Voice clone stress request failed.'));
};

export const startVoiceCloneStressTest = async (
  payload: VoiceCloneStressStartRequest,
  options?: VoiceCloneStressRequestOptions
): Promise<VoiceCloneStressStatusResponse> => requestVoiceCloneStressJson<VoiceCloneStressStatusResponse>(
  '/admin/voice-clone/stress/start',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  },
  options
);

export const fetchVoiceCloneStressTestStatus = async (
  jobId: string,
  options?: VoiceCloneStressRequestOptions
): Promise<VoiceCloneStressStatusResponse> => requestVoiceCloneStressJson<VoiceCloneStressStatusResponse>(
  `/admin/voice-clone/stress/${encodeURIComponent(String(jobId || '').trim())}`,
  undefined,
  options
);

export const cancelVoiceCloneStressTest = async (
  jobId: string,
  options?: VoiceCloneStressRequestOptions
): Promise<VoiceCloneStressStatusResponse> => requestVoiceCloneStressJson<VoiceCloneStressStatusResponse>(
  `/admin/voice-clone/stress/${encodeURIComponent(String(jobId || '').trim())}/cancel`,
  {
    method: 'POST',
  },
  options
);
