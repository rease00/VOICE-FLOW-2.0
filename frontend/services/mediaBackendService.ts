import { authFetch } from './authHttpClient';
import { requestJson } from '../src/shared/api/httpClient';
import { activateTtsEngine } from '../src/shared/api/gatewayClient';
import { resolveApiBaseUrl, resolveApiUrl } from '../src/shared/api/config';

const REMOVED_MEDIA_BACKEND_MESSAGE = 'This media backend workflow is not available in the Next.js app build.';

const removedMediaBackendFeature = (feature: string): Error =>
  new Error(`${feature} is not available. ${REMOVED_MEDIA_BACKEND_MESSAGE}`);

export const fetchTtsEngineStatus = async (
  baseUrl?: string,
  options?: { engine?: string; forceRefresh?: boolean }
): Promise<{ engines: Record<string, unknown> }> => {
  const params = new URLSearchParams();
  params.set('engine', String(options?.engine || 'all').trim() || 'all');
  if (options?.forceRefresh) {
    params.set('force_refresh', '1');
  }
  return requestJson<{ engines: Record<string, unknown> }>(
    `/tts/engines/status?${params.toString()}`,
    undefined,
    { baseUrl: resolveApiBaseUrl(baseUrl) }
  );
};

export const switchTtsEngineRuntime = async (
  baseUrl: string | undefined,
  engine: 'PRIME' | 'VECTOR'
): Promise<{ state: string; detail: string; healthUrl?: string }> => {
  const response = await activateTtsEngine(engine, { baseUrl: resolveApiBaseUrl(baseUrl) });
  return {
    state: String(response?.state || 'starting').trim() || 'starting',
    detail: String(response?.detail || 'Runtime starting in background.').trim() || 'Runtime starting in background.',
    ...(response?.healthUrl ? { healthUrl: String(response.healthUrl).trim() } : {}),
  };
};

export const checkMediaBackendHealth = async (
  baseUrl?: string,
  _options?: { forceRefresh?: boolean }
): Promise<{
  ok: boolean;
  ffmpeg?: { available: boolean };
  whisper?: { loaded: boolean; error: string | null; supportedLanguages: string[] };
}> => {
  const response = await fetch(resolveApiUrl('/health', baseUrl), {
    method: 'GET',
    cache: 'no-store',
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });

  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const detail = String(payload?.detail || payload?.error || response.statusText || 'Backend health check failed.').trim();
    throw new Error(detail || 'Backend health check failed.');
  }

  return {
    ok: Boolean(payload?.ok ?? true),
    ffmpeg: {
      available: Boolean(payload?.ffmpeg?.available ?? true),
    },
    whisper: {
      loaded: Boolean(payload?.whisper?.loaded),
      error: payload?.whisper?.error ? String(payload.whisper.error) : null,
      supportedLanguages: Array.isArray(payload?.whisper?.supportedLanguages)
        ? payload.whisper.supportedLanguages.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
        : [],
    },
  };
};

export const cancelDubbingJob = async (baseUrl: string | undefined, jobId: string): Promise<void> => {
  const safeBaseUrl = resolveApiBaseUrl(baseUrl);
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const response = await authFetch(
    `${safeBaseUrl}/dubbing/jobs/${encodeURIComponent(safeJobId)}/cancel`,
    { method: 'POST' },
    { requireAuth: true }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to cancel dubbing job (${response.status}).`);
  }
};

export const transcribeVideoWithBackend = async (
  _baseUrl?: string,
  _file?: Blob | File,
  _options?: Record<string, unknown>
): Promise<{
  script: string;
  segments?: Array<{ speaker?: string }>;
  emotionCapture?: { enabled?: boolean };
}> => {
  throw removedMediaBackendFeature('Transcription');
};

export const createDubbingJobV2 = async (
  _baseUrl?: string,
  _file?: Blob | File,
  _options?: Record<string, unknown>
): Promise<{ job_id?: string }> => {
  throw removedMediaBackendFeature('Video dubbing');
};

export const getDubbingJob = async (
  _baseUrl?: string,
  _jobId?: string,
  _options?: Record<string, unknown>
): Promise<{ job?: Record<string, unknown> }> => {
  throw removedMediaBackendFeature('Video dubbing');
};

export const downloadDubbingChunk = async (
  _baseUrl?: string,
  _jobId?: string,
  _chunkIndex?: number
): Promise<Blob> => {
  throw removedMediaBackendFeature('Video dubbing');
};

export const downloadDubbingResult = async (
  _baseUrl?: string,
  _jobId?: string
): Promise<Blob> => {
  throw removedMediaBackendFeature('Video dubbing');
};

export const downloadDubbingReport = async (
  _baseUrl?: string,
  _jobId?: string
): Promise<Blob> => {
  throw removedMediaBackendFeature('Video dubbing');
};
