import type { GenerationSettings } from '../types';
import {
  cancelTtsJob,
  fetchTtsJobChunkAudio,
  fetchTtsJobResult,
  getTtsJob,
} from '../src/shared/api/gatewayClient';
import { sleepMs } from './ttsLongTextService';

export const TTS_GATEWAY_JOB_PROGRESS_EVENT = 'voiceflow:tts-gateway-job-progress';
export const TTS_GATEWAY_AUDIO_CHUNK_EVENT = 'voiceflow:tts-gateway-audio-chunk';

export interface GatewayJobProgressPayload {
  jobId: string;
  status: string;
  engine?: string | undefined;
  queueAgeMs?: number | undefined;
  queueDepth?: number | undefined;
  stage?: string | undefined;
  progressPct?: number | undefined;
}

export interface GatewayAudioChunkPayload {
  jobId: string;
  index: number;
  engine?: string | undefined;
  contentType?: string | undefined;
  durationMs?: number | undefined;
  textChars?: number | undefined;
  traceId?: string | undefined;
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
  client?: {
    getJob?: typeof getTtsJob;
    cancelJob?: typeof cancelTtsJob;
    fetchChunkAudio?: typeof fetchTtsJobChunkAudio;
    fetchResult?: (
      jobId: string,
      options?: { baseUrl?: string }
    ) => Promise<{ audioBytes: ArrayBuffer; headers?: Record<string, string>; responseHeaders?: Record<string, string> }>;
  } | undefined;
}

const DEFAULT_TTS_GATEWAY_JOB_POLL_MS = 500;
const DEFAULT_TTS_GATEWAY_JOB_POLL_MAX_MS = 2500;
const DEFAULT_TTS_GATEWAY_JOB_TIMEOUT_MS = 180000;

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

export const extractGatewayJobId = (
  payload: unknown,
  headers?: Headers
): string => {
  const candidate = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  const fromPayload = String(
    candidate.jobId ||
    candidate.requestId ||
    candidate.id ||
    candidate.job_id ||
    ''
  ).trim();
  if (fromPayload) return fromPayload;
  return String(
    headers?.get('x-vf-job-id') ||
    headers?.get('x-vf-request-id') ||
    ''
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
    client,
  } = options;
  const getJobClient = client?.getJob || getTtsJob;
  const cancelJobClient = client?.cancelJob || cancelTtsJob;
  const fetchChunkAudioClient = client?.fetchChunkAudio || fetchTtsJobChunkAudio;
  const fetchResultClient = client?.fetchResult || fetchTtsJobResult;
  const startedAt = Date.now();
  let cancelled = false;
  let chunkCursor = 0;
  let chunkSupportEnabled = true;
  let chunkInlineAudioFallback = false;
  let chunkDownloadEnabled = true;
  let pollDelayMs = pollMs;
  let lastStatus = '';
  const emittedChunkKeys = new Set<string>();

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

    let payload;
    try {
      payload = await getJobClient(jobId, {
        includeResult: true,
        includeChunks: chunkSupportEnabled,
        chunkCursor,
        chunkLimit: 2,
        includeChunkAudio: chunkInlineAudioFallback,
        ...(baseUrl ? { baseUrl } : {}),
      });
    } catch (error: any) {
      const statusCode = Number(error?.status || error?.cause?.status || 0);
      if (chunkSupportEnabled && (statusCode === 400 || statusCode === 404 || statusCode === 422)) {
        chunkSupportEnabled = false;
        continue;
      }
      const message = String(error?.message || 'Unknown error');
      throw new Error(`${runtimeLabel} job polling failed: ${message}`);
    }

    const status = String(payload?.status || '').trim().toLowerCase();
    if (status && status !== lastStatus) {
      pollDelayMs = pollMs;
      lastStatus = status;
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
          const index = Number(rawChunk.index);
          if (!Number.isFinite(index) || index < 0) continue;
          const safeIndex = Math.round(index);
          const key = `${jobId}:${safeIndex}`;
          if (emittedChunkKeys.has(key)) continue;

          let audioBase64 = String(rawChunk.audioBase64 || '').trim();
          if (!audioBase64 && chunkDownloadEnabled) {
            try {
              const chunkBytes = await fetchChunkAudioClient(jobId, safeIndex, baseUrl);
              audioBase64 = await arrayBufferToBase64(chunkBytes);
            } catch {
              chunkDownloadEnabled = false;
              chunkInlineAudioFallback = true;
            }
          }
          if (!audioBase64) continue;

          emittedChunkKeys.add(key);
          emitGatewayAudioChunk({
            jobId,
            index: safeIndex,
            engine,
            contentType: String(rawChunk.contentType || 'audio/wav'),
            durationMs: Number(rawChunk.durationMs || 0),
            textChars: Number(rawChunk.textChars || 0),
            traceId: String(rawChunk.traceId || payload?.traceId || ''),
            audioBase64,
          });
          emittedInThisPoll += 1;
        }

        if (Number.isFinite(responseChunkCursorNext) && responseChunkCursorNext >= chunkCursor) {
          chunkCursor = Math.max(chunkCursor, Math.round(responseChunkCursorNext));
        } else if (chunks.length > 0) {
          const maxIndex = chunks.reduce((max, chunk) => {
            const nextIndex = Number(chunk?.index);
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
      const result = await fetchResultClient(jobId, baseUrl ? { baseUrl } : undefined);
      const responseHeaders = 'responseHeaders' in result
        ? result.responseHeaders
        : result.headers;
      return {
        audioBytes: result.audioBytes,
        responseHeaders: toResponseHeadersRecord(responseHeaders),
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
      pollDelayMs = pollMs;
    } else {
      pollDelayMs = Math.min(pollMaxMs, Math.max(pollMs, Math.round(pollDelayMs * 1.35)));
    }
    await sleepMs(pollDelayMs);
  }

  throw new Error(`${runtimeLabel} timed out while waiting for queued synthesis.`);
};
