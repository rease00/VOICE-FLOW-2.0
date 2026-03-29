import { HttpError, requestJson } from '../../shared/api/httpClient';
import type { ClonedVoice } from '../../../types';
import type {
  OpenVoiceBenchmarkArtifact,
  OpenVoiceBenchmarkRequest,
  OpenVoiceBenchmarkResponse,
  OpenVoiceBenchmarkRuntime,
  OpenVoiceBenchmarkTimings,
  OpenVoiceBenchmarkStatusResponse,
  VoiceCloneStressBenchmarkTarget,
  VoiceCloneStressConfig,
  VoiceCloneStressStartRequest,
  VoiceCloneStressStatusResponse,
  VoiceCloneStressStepResult,
  VoiceCloneStressSummary,
} from './openvoiceTypes';

export type OpenVoiceCloneRequest = Omit<OpenVoiceBenchmarkRequest, 'mode' | 'runKind'> & {
  mode?: 'vc';
  runKind?: 'warm';
};

export interface OpenVoiceCloneResponse extends OpenVoiceBenchmarkResponse {
  clonedVoice?: ClonedVoice;
}

export interface OpenVoiceStemSeparationRequest {
  sourceAudioBase64: string;
  sourceAudioName: string;
  sourceSeparationModel?: string;
  sourceSeparationDevice?: string;
  sourceTrimStartSec?: number;
  sourceTrimEndSec?: number;
  requestId?: string;
  traceId?: string;
}

export interface OpenVoiceStemSeparationResponse {
  ok?: boolean;
  status?: string;
  requestId?: string;
  traceId?: string;
  sourceAudioName?: string;
  timings?: OpenVoiceBenchmarkTimings;
  runtime?: OpenVoiceBenchmarkRuntime;
  vocalsArtifact?: OpenVoiceBenchmarkArtifact;
  backgroundArtifact?: OpenVoiceBenchmarkArtifact;
  notes?: string[];
  message?: string;
}

export const fetchOpenVoiceCloneStatus = async (
  options?: { baseUrl?: string; timeoutMs?: number }
): Promise<OpenVoiceBenchmarkStatusResponse> => requestJson<OpenVoiceBenchmarkStatusResponse>(
  '/voice-clone/openvoice/status',
  undefined,
  {
    requireAuth: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export const cloneVoiceWithOpenVoice = async (
  payload: OpenVoiceCloneRequest,
  options?: { baseUrl?: string; timeoutMs?: number }
): Promise<OpenVoiceCloneResponse> => requestJson<OpenVoiceCloneResponse>(
  '/voice-clone/openvoice',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      mode: 'vc',
      runKind: 'warm',
    }),
  },
  {
    requireAuth: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export const separateVoiceAndBackgroundWithDemucs = async (
  payload: OpenVoiceStemSeparationRequest,
  options?: { baseUrl?: string; timeoutMs?: number }
): Promise<OpenVoiceStemSeparationResponse> => requestJson<OpenVoiceStemSeparationResponse>(
  '/voice-clone/openvoice/separate',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

const buildStressRequestAttempts = (
  path: string,
  options?: VoiceCloneStressRequestOptions
): VoiceCloneStressRequestAttempt[] => {
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
    }

    // Last-resort: try the default API base (proxy/env default) when a custom backend URL misses admin routes.
    attempts.push({ path, options: timeoutOnlyOptions });
    attempts.push({ path: `/v1${path}`, options: timeoutOnlyOptions });
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
  const attempts = buildStressRequestAttempts(path, options);
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
