import { requestJson } from '../src/shared/api/httpClient';
import { activateTtsEngine } from '../src/shared/api/gatewayClient';
import { resolveApiBaseUrl, resolveApiUrl } from '../src/shared/api/config';
import { API_ROUTE_FAMILIES } from '../src/shared/api/routes';

const resolveStudioApiBaseUrl = (baseUrl?: string): string => (
  resolveApiBaseUrl(baseUrl || API_ROUTE_FAMILIES.studio)
);

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
    { baseUrl: resolveStudioApiBaseUrl(baseUrl) }
  );
};

export const switchTtsEngineRuntime = async (
  baseUrl: string | undefined,
  engine: 'PRIME' | 'VECTOR'
): Promise<{ state: string; detail: string; healthUrl?: string }> => {
  const response = await activateTtsEngine(engine, { baseUrl: resolveStudioApiBaseUrl(baseUrl) });
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
  const response = await fetch(resolveApiUrl('/health', resolveStudioApiBaseUrl(baseUrl)), {
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
