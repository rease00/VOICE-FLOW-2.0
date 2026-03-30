import type { GenerationSettings } from '../types';
import {
  cancelTtsJob,
  fetchTtsJobChunkAudio,
  fetchTtsJobResult,
  getTtsJob,
} from '../src/shared/api/gatewayClient';
import type { TtsJobStatusResponse } from '../src/shared/api/contracts';
import { sleepMs } from './ttsLongTextService';

export const TTS_GATEWAY_JOB_PROGRESS_EVENT = 'voiceflow:tts-gateway-job-progress';
export const TTS_GATEWAY_AUDIO_CHUNK_EVENT = 'voiceflow:tts-gateway-audio-chunk';

export interface GatewayJobProgressPayload {
  jobId: string;
  requestId?: string | undefined;
  status: string;
  engine?: string | undefined;
  queueAgeMs?: number | undefined;
  queueDepth?: number | undefined;
  stage?: string | undefined;
  progressPct?: number | undefined;
}

export interface GatewayAudioChunkPayload {
  jobId: string;
  requestId?: string | undefined;
  index: number;
  engine?: string | undefined;
  contentType?: string | undefined;
  durationMs?: number | undefined;
  textChars?: number | undefined;
  traceId?: string | undefined;
  speakerId?: string | undefined;
  turnIndex?: number | undefined;
  sessionEpoch?: number | undefined;
  resumeAttempt?: number | undefined;
  fallbackUsed?: boolean | undefined;
  audioBase64: string;
}

interface PollTtsGatewayJobOptions {
  jobId: string;
  runtimeLabel: string;
  engine: GenerationSettings['engine'];
  baseUrl?: string | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  pollMs?: number | undefined;
  pollMaxMs?: number | undefined;
  client?: GatewayJobClient | undefined;
}

interface GatewayJobClient {
  getJob: (
    jobId: string,
    options?: {
      includeResult?: boolean;
      includeChunks?: boolean;
      chunkCursor?: number;
      chunkLimit?: number;
      includeChunkAudio?: boolean;
      baseUrl?: string;
    }
  ) => Promise<TtsJobStatusResponse>;
  cancelJob: (
    jobId: string,
    options?: { baseUrl?: string }
  ) => Promise<unknown>;
  fetchChunkAudio: (
    jobId: string,
    chunkIndex: number,
    baseUrl?: string
  ) => Promise<ArrayBuffer>;
  fetchResult: (
    jobId: string,
    options?: { baseUrl?: string }
  ) => Promise<{ audioBytes: ArrayBuffer; responseHeaders?: Record<string, string> }>;
}

const DEFAULT_TTS_GATEWAY_JOB_POLL_MS = 2000;
const DEFAULT_TTS_GATEWAY_JOB_POLL_MAX_MS = 12000;
const DEFAULT_TTS_GATEWAY_JOB_HIDDEN_POLL_MS = 5000;
const DEFAULT_TTS_GATEWAY_JOB_TIMEOUT_MS = 180000;
const TTS_GATEWAY_JOB_POLL_BACKOFF_FACTOR = 1.7;
const TTS_GATEWAY_CHUNK_FETCH_MAX_ATTEMPTS = 3;
const TTS_GATEWAY_CHUNK_FETCH_RETRY_BASE_MS = 220;
const TTS_GATEWAY_CHUNK_FETCH_RETRY_MAX_MS = 1400;

export const resolveTtsGatewayJobPollDelayMs = (input: {
  currentDelayMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  reset?: boolean;
}): number => {
  const baseDelayMs = Math.max(0, Math.floor(input.baseDelayMs ?? DEFAULT_TTS_GATEWAY_JOB_POLL_MS));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(input.maxDelayMs ?? DEFAULT_TTS_GATEWAY_JOB_POLL_MAX_MS));
  if (input.reset) return Math.min(baseDelayMs, maxDelayMs);
  const currentDelayMs = Math.max(0, Math.floor(input.currentDelayMs ?? baseDelayMs));
  return Math.min(maxDelayMs, Math.max(baseDelayMs, Math.round(currentDelayMs * TTS_GATEWAY_JOB_POLL_BACKOFF_FACTOR)));
};

const isGatewayPollHiddenTab = (): boolean => {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden';
};

const resolveHiddenTabGatewayJobPollDelayMs = (input: {
  currentDelayMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): number => {
  const visibleDelayMs = resolveTtsGatewayJobPollDelayMs(input);
  const maxDelayMs = Math.max(0, Math.floor(input.maxDelayMs ?? DEFAULT_TTS_GATEWAY_JOB_POLL_MAX_MS));
  if (maxDelayMs <= 0) return visibleDelayMs;
  return Math.min(maxDelayMs, Math.max(DEFAULT_TTS_GATEWAY_JOB_HIDDEN_POLL_MS, visibleDelayMs));
};

const DEFAULT_GATEWAY_JOB_CLIENT: GatewayJobClient = {
  getJob: (jobId, options) => getTtsJob(jobId, options),
  cancelJob: (jobId, options) => cancelTtsJob(jobId, options),
  fetchChunkAudio: (jobId, chunkIndex, baseUrl) => fetchTtsJobChunkAudio(jobId, chunkIndex, baseUrl),
  fetchResult: async (jobId, options) => {
    const result = await fetchTtsJobResult(jobId, options);
    return {
      audioBytes: result.audioBytes,
      responseHeaders: result.headers,
    };
  },
};

const arrayBufferToBase64 = async (buffer: ArrayBuffer): Promise<string> => {
  if (buffer.byteLength === 0) return '';
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const segment = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...segment);
  }
  return btoa(binary);
};

const base64ToArrayBuffer = (value: string): ArrayBuffer => {
  const safe = String(value || '').trim();
  if (!safe) return new ArrayBuffer(0);
  const binary = atob(safe);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const toResponseHeadersRecord = (headers: Record<string, string> | undefined): Record<string, string> => {
  if (!headers || typeof headers !== 'object') return {};
  const record: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    const safeKey = String(key || '').trim().toLowerCase();
    if (!safeKey) return;
    record[safeKey] = String(value ?? '');
  });
  return record;
};

const resolveChunkFetchStatusCode = (error: unknown): number => {
  const source = (error && typeof error === 'object') ? error as Record<string, unknown> : {};
  const status = Number(source.status ?? (source.cause as Record<string, unknown> | undefined)?.status ?? 0);
  return Number.isFinite(status) ? Math.floor(status) : 0;
};

const isRetryableChunkFetchStatus = (statusCode: number): boolean => {
  if (statusCode === 404 || statusCode === 409) return true;
  return statusCode >= 500 && statusCode <= 599;
};

const fetchChunkAudioWithRetry = async (input: {
  jobId: string;
  chunkIndex: number;
  baseUrl?: string | undefined;
  signal?: AbortSignal | undefined;
  fetchChunkAudioClient: GatewayJobClient['fetchChunkAudio'];
}): Promise<ArrayBuffer | null> => {
  let attempt = 0;
  while (attempt < TTS_GATEWAY_CHUNK_FETCH_MAX_ATTEMPTS) {
    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await input.fetchChunkAudioClient(input.jobId, input.chunkIndex, input.baseUrl);
    } catch (error) {
      attempt += 1;
      const statusCode = resolveChunkFetchStatusCode(error);
      if (!isRetryableChunkFetchStatus(statusCode) || attempt >= TTS_GATEWAY_CHUNK_FETCH_MAX_ATTEMPTS) {
        return null;
      }
      const retryDelayMs = Math.min(
        TTS_GATEWAY_CHUNK_FETCH_RETRY_MAX_MS,
        Math.round(TTS_GATEWAY_CHUNK_FETCH_RETRY_BASE_MS * (2 ** (attempt - 1))),
      );
      await sleepMs(retryDelayMs);
    }
  }
  return null;
};

export const extractGatewayJobId = (
  payload: unknown,
  headers?: Headers
): string => {
  const candidate = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  const fromPayload = String(
    candidate.jobId ||
    candidate.id ||
    candidate.job_id ||
    ''
  ).trim();
  if (fromPayload) return fromPayload;
  return String(
    headers?.get('x-vf-job-id') || ''
  ).trim();
};

export const emitGatewayProgress = (detail: GatewayJobProgressPayload): void => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(TTS_GATEWAY_JOB_PROGRESS_EVENT, { detail }));
};

export const emitGatewayAudioChunk = (detail: GatewayAudioChunkPayload): void => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(TTS_GATEWAY_AUDIO_CHUNK_EVENT, { detail }));
};

export const pollTtsGatewayJobForAudio = async (
  options: PollTtsGatewayJobOptions
): Promise<{ audioBytes: ArrayBuffer; responseHeaders: Record<string, string> }> => {
  const {
    jobId,
    runtimeLabel,
    engine,
    baseUrl,
    signal,
    timeoutMs = DEFAULT_TTS_GATEWAY_JOB_TIMEOUT_MS,
    pollMs = DEFAULT_TTS_GATEWAY_JOB_POLL_MS,
    pollMaxMs = DEFAULT_TTS_GATEWAY_JOB_POLL_MAX_MS,
    client = DEFAULT_GATEWAY_JOB_CLIENT,
  } = options;
  const getJobClient = client?.getJob || getTtsJob;
  const cancelJobClient = client?.cancelJob || cancelTtsJob;
  const fetchChunkAudioClient = client?.fetchChunkAudio || fetchTtsJobChunkAudio;
  const fetchResultClient = client?.fetchResult || fetchTtsJobResult;
  const startedAt = Date.now();
  let cancelled = false;
  let chunkCursor = 0;
  let chunkSupportEnabled = true;
  const chunkInlineAudioFallback = false;
  let pollDelayMs = resolveTtsGatewayJobPollDelayMs({ reset: true, baseDelayMs: pollMs, maxDelayMs: pollMaxMs });
  let lastStatus = '';
  const emittedChunkKeys = new Set<string>();
  const resetPollDelayMs = () => resolveTtsGatewayJobPollDelayMs({ reset: true, baseDelayMs: pollMs, maxDelayMs: pollMaxMs });

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      if (!cancelled) {
        cancelled = true;
        try {
          await cancelJobClient(jobId, baseUrl ? { baseUrl } : undefined);
        } catch {
          // Best-effort cancellation.
        }
      }
      throw new DOMException('Aborted', 'AbortError');
    }
    const hiddenTabPollDelayMs = isGatewayPollHiddenTab()
      ? resolveHiddenTabGatewayJobPollDelayMs({ currentDelayMs: pollDelayMs, baseDelayMs: pollMs, maxDelayMs: pollMaxMs })
      : pollDelayMs;

    let payload;
    try {
      payload = await getJobClient(jobId, {
        includeResult: false,
        includeChunks: chunkSupportEnabled,
        chunkCursor,
        chunkLimit: 2,
        includeChunkAudio: chunkInlineAudioFallback,
        ...(baseUrl ? { baseUrl } : {}),
      });
    } catch (error: any) {
      const statusCode = Number(error?.status || error?.cause?.status || 0);
      if (chunkSupportEnabled && (statusCode === 400 || statusCode === 422)) {
        chunkSupportEnabled = false;
        continue;
      }
      const message = String(error?.message || 'Unknown error');
      throw new Error(`${runtimeLabel} job polling failed: ${message}`);
    }

    const status = String(payload?.status || '').trim().toLowerCase();
    const requestId = String(payload?.requestId || '').trim();
    let progressObservedThisPoll = false;
    if (status && status !== lastStatus) {
      pollDelayMs = resetPollDelayMs();
      lastStatus = status;
      progressObservedThisPoll = true;
    }
    const queueAgeMs = Number(payload?.queueAgeMs || 0);
    const queueDepth = Number(payload?.queueDepthAtRead || 0);
    const elapsedMs = Math.max(1, Date.now() - startedAt);
    const softProgress = Math.max(
      6,
      Math.min(96, Math.round((elapsedMs / timeoutMs) * 100))
    );
    emitGatewayProgress({
      jobId,
      ...(requestId ? { requestId } : {}),
      status,
      engine,
      queueAgeMs: Number.isFinite(queueAgeMs) ? queueAgeMs : 0,
      queueDepth: Number.isFinite(queueDepth) ? queueDepth : 0,
      stage: status === 'running' ? 'Synthesizing audio...' : 'Queued for synthesis...',
      progressPct: softProgress,
    });

    let emittedInThisPoll = 0;
    if (chunkSupportEnabled) {
      const chunks = Array.isArray(payload?.chunks) ? payload.chunks : [];
      const responseChunkCursorNext = Number(payload?.chunkCursorNext);
      if (
        chunks.length === 0
        && payload
        && typeof payload === 'object'
        && !Object.prototype.hasOwnProperty.call(payload, 'chunks')
        && !Object.prototype.hasOwnProperty.call(payload, 'live')
      ) {
        chunkSupportEnabled = false;
      } else {
        for (const rawChunk of chunks) {
          if (!rawChunk || typeof rawChunk !== 'object') continue;
          const rawChunkAny = rawChunk as unknown as Record<string, unknown>;
          const index = Number(
            rawChunkAny.index ??
            rawChunkAny.serial_index ??
            rawChunkAny.serialIndex ??
            rawChunkAny.chunk_id ??
            rawChunkAny.chunkId
          );
          if (!Number.isFinite(index) || index < 0) continue;
          const safeIndex = Math.round(index);
          const key = `${jobId}:${safeIndex}`;
          if (emittedChunkKeys.has(key)) continue;

          let audioBase64 = String(rawChunk.audioBase64 || '').trim();
          if (!audioBase64) {
            const chunkBytes = await fetchChunkAudioWithRetry({
              jobId,
              chunkIndex: safeIndex,
              ...(baseUrl ? { baseUrl } : {}),
              signal,
              fetchChunkAudioClient,
            });
            if (chunkBytes) {
              audioBase64 = await arrayBufferToBase64(chunkBytes);
            }
          }
          if (!audioBase64) continue;

          emittedChunkKeys.add(key);
          emitGatewayAudioChunk({
            jobId,
            ...(requestId ? { requestId } : {}),
            index: safeIndex,
            engine,
            contentType: String(rawChunk.contentType || 'audio/wav'),
            durationMs: Number(rawChunk.durationMs || 0),
            textChars: Number(rawChunk.textChars || 0),
            traceId: String(rawChunk.traceId || payload?.traceId || ''),
            speakerId: String(rawChunk.speakerId || ''),
            turnIndex: Number(rawChunk.turnIndex || safeIndex),
            sessionEpoch: Number(rawChunk.sessionEpoch || 0),
            resumeAttempt: Number(rawChunk.resumeAttempt || 0),
            fallbackUsed: Boolean(rawChunk.fallbackUsed),
            audioBase64,
          });
          emittedInThisPoll += 1;
        }

        if (Number.isFinite(responseChunkCursorNext) && responseChunkCursorNext >= chunkCursor) {
          chunkCursor = Math.max(chunkCursor, Math.round(responseChunkCursorNext));
        } else if (chunks.length > 0) {
          const maxIndex = chunks.reduce((max, chunk) => {
            const chunkAny = (chunk && typeof chunk === 'object') ? (chunk as unknown as Record<string, unknown>) : {};
            const nextIndex = Number(
              chunkAny.index ??
              chunkAny.serial_index ??
              chunkAny.serialIndex ??
              chunkAny.chunk_id ??
              chunkAny.chunkId
            );
            if (!Number.isFinite(nextIndex)) return max;
            return Math.max(max, Math.round(nextIndex));
          }, -1);
          if (maxIndex >= 0) chunkCursor = Math.max(chunkCursor, maxIndex + 1);
        }
      }
    }

    if (status === 'completed') {
      emitGatewayProgress({
        jobId,
        status,
        engine,
        queueAgeMs: Number.isFinite(queueAgeMs) ? queueAgeMs : 0,
        queueDepth: Number.isFinite(queueDepth) ? queueDepth : 0,
        stage: 'Synthesis completed. Preparing playback...',
        progressPct: 98,
      });
      const inlineAudioBase64 = String(payload?.result?.audioBase64 || '').trim();
      if (inlineAudioBase64) {
        return {
          audioBytes: base64ToArrayBuffer(inlineAudioBase64),
          responseHeaders: toResponseHeadersRecord(
            payload?.result && typeof payload.result === 'object'
              ? payload.result.headers
              : undefined
          ),
        };
      }
      const result = await fetchResultClient(jobId, baseUrl ? { baseUrl } : undefined);
      return {
        audioBytes: result.audioBytes,
        responseHeaders: toResponseHeadersRecord(result.responseHeaders),
      };
    }

    if (status === 'failed') {
      const message = typeof payload?.error === 'string'
        ? payload.error
        : JSON.stringify(payload?.error || payload || {});
      throw new Error(`${runtimeLabel} failed: ${message}`);
    }

    if (status === 'cancelled') {
      throw new Error(`${runtimeLabel} was cancelled before completion.`);
    }

    if (emittedInThisPoll > 0) {
      progressObservedThisPoll = true;
    }

    if (progressObservedThisPoll) {
      pollDelayMs = resetPollDelayMs();
    } else {
      pollDelayMs = resolveTtsGatewayJobPollDelayMs({
        currentDelayMs: pollDelayMs,
        baseDelayMs: pollMs,
        maxDelayMs: pollMaxMs,
      });
    }
    await sleepMs(hiddenTabPollDelayMs);
  }

  if (!cancelled) {
    cancelled = true;
    try {
      await cancelJobClient(jobId, baseUrl ? { baseUrl } : undefined);
    } catch {
      // Best-effort cancellation on timeout.
    }
  }
  throw new Error(`${runtimeLabel} timed out while waiting for queued synthesis.`);
};
