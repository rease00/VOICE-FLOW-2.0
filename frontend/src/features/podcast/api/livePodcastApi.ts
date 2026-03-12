import type { TtsJobStatusResponse } from '../../../shared/api/contracts';
import { requestBlob, requestJson } from '../../../shared/api/httpClient';
import type { LivePodcastJobRequest } from '../model/liveNative';

const withBaseUrl = (baseUrl?: string): { baseUrl?: string } => (baseUrl ? { baseUrl } : {});

export const createLivePodcastJob = async (
  payload: LivePodcastJobRequest,
  options?: { baseUrl?: string }
): Promise<TtsJobStatusResponse> => {
  return requestJson<TtsJobStatusResponse>(
    '/podcast/live/jobs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const getLivePodcastJob = async (
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
    ? `/podcast/live/jobs/${safeJobId}?${searchParams.toString()}`
    : `/podcast/live/jobs/${safeJobId}`;
  return requestJson<TtsJobStatusResponse>(
    path,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const cancelLivePodcastJob = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<TtsJobStatusResponse> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  return requestJson<TtsJobStatusResponse>(
    `/podcast/live/jobs/${safeJobId}`,
    { method: 'DELETE' },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const fetchLivePodcastChunkAudio = async (
  jobId: string,
  chunkIndex: number,
  baseUrl?: string
): Promise<ArrayBuffer> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  const safeChunkIndex = Math.max(0, Math.floor(Number(chunkIndex || 0)));
  const blob = await requestBlob(
    `/podcast/live/jobs/${safeJobId}/chunks/${safeChunkIndex}`,
    undefined,
    { ...withBaseUrl(baseUrl), requireAuth: true }
  );
  return blob.arrayBuffer();
};

export const fetchLivePodcastAudio = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<{ audioBytes: ArrayBuffer; responseHeaders: Record<string, string> }> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  const blob = await requestBlob(
    `/podcast/live/jobs/${safeJobId}/audio`,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
  return {
    audioBytes: await blob.arrayBuffer(),
    responseHeaders: {},
  };
};
