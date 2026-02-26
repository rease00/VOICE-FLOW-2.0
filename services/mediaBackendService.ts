import { GenerationSettings, RuntimeCapabilities } from '../types';

export interface MediaBackendHealth {
  ok: boolean;
  ffmpeg?: { available: boolean; path?: string | null; error?: string | null };
  rvc?: { available: boolean; currentModel?: string | null; modelsDir?: string; error?: string | null };
  whisper?: {
    loaded: boolean;
    model?: string;
    device?: string;
    compute?: string;
    error?: string | null;
    supportedLanguages?: string[];
  };
  sourceSeparation?: {
    enabled?: boolean;
    available?: boolean;
    model?: string;
    device?: string;
    cacheDir?: string;
    error?: string | null;
  };
}

export interface VideoTranscriptionResult {
  ok: boolean;
  language?: string;
  duration?: number;
  script: string;
  emotionCapture?: {
    enabled?: boolean;
    maxSegments?: number;
    minSegmentSeconds?: number;
  };
  segments: Array<{
    id: number;
    start: number;
    end: number;
    timestampStart?: string;
    timestampEnd?: string;
    text: string;
    speaker: string;
    emotion?: string;
    emotionSource?: string;
    emotionConfidence?: number | null;
  }>;
}

export interface TtsEngineSwitchResult {
  ok: boolean;
  engine: GenerationSettings['engine'];
  state: 'online' | 'starting';
  detail: string;
  healthUrl: string;
  gpuMode: boolean;
  commandOutput?: string;
}

export interface RuntimeLogTailResult {
  ok: boolean;
  service: string;
  exists: boolean;
  file: string;
  cursor: number;
  nextCursor: number;
  size: number;
  lines: string[];
  truncated: boolean;
  lastModified?: number;
}

export interface TtsEngineCapabilitiesResult {
  ok: boolean;
  engines: Partial<Record<GenerationSettings['engine'], RuntimeCapabilities>>;
  fetchedAt: string;
}

const FALLBACK_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';

const toBaseUrl = (input?: string): string => {
  const raw = (input || FALLBACK_MEDIA_BACKEND_URL).trim();
  return raw.replace(/\/+$/, '');
};

const parseError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.error || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

const fetchBackend = async (baseUrl: string, path: string, init?: RequestInit): Promise<Response> => {
  const normalizedBase = toBaseUrl(baseUrl);
  const targetUrl = `${normalizedBase}${path}`;
  try {
    return await fetch(targetUrl, init);
  } catch {
    throw new Error(`Media backend is unreachable at ${normalizedBase}.`);
  }
};

export const resolveMediaBackendUrl = (settings: Pick<GenerationSettings, 'mediaBackendUrl'>): string => {
  return toBaseUrl(settings.mediaBackendUrl);
};

export const checkMediaBackendHealth = async (baseUrl: string): Promise<MediaBackendHealth> => {
  const response = await fetchBackend(baseUrl, '/health');
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
};

export const listRvcModels = async (baseUrl: string): Promise<{ models: string[]; currentModel?: string }> => {
  const response = await fetchBackend(baseUrl, '/rvc/models');
  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const payload = await response.json();
  return {
    models: Array.isArray(payload?.models) ? payload.models : [],
    currentModel: typeof payload?.currentModel === 'string' ? payload.currentModel : undefined,
  };
};

export const loadRvcModel = async (baseUrl: string, modelName: string): Promise<void> => {
  const response = await fetchBackend(baseUrl, '/rvc/load-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelName }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
};

export const convertRvcCover = async (
  baseUrl: string,
  sourceAudio: File,
  modelName: string,
  options?: {
    pitchShift?: number;
    indexRate?: number;
    filterRadius?: number;
    rmsMixRate?: number;
    protect?: number;
    f0Method?: 'rmvpe' | 'harvest' | 'crepe' | 'pm';
  }
): Promise<Blob> => {
  const form = new FormData();
  form.append('file', sourceAudio);
  form.append('model_name', modelName);
  form.append('pitch_shift', String(Math.round(options?.pitchShift ?? 0)));
  form.append('index_rate', String(options?.indexRate ?? 0.5));
  form.append('filter_radius', String(options?.filterRadius ?? 3));
  form.append('rms_mix_rate', String(options?.rmsMixRate ?? 1.0));
  form.append('protect', String(options?.protect ?? 0.33));
  form.append('f0_method', options?.f0Method || 'rmvpe');

  const response = await fetchBackend(baseUrl, '/rvc/convert', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.blob();
};

export const transcribeVideoWithBackend = async (
  baseUrl: string,
  videoFile: File,
  options?: {
    language?: string;
    task?: 'transcribe' | 'translate';
    captureEmotions?: boolean;
    speakerLabel?: string;
  }
): Promise<VideoTranscriptionResult> => {
  const form = new FormData();
  form.append('file', videoFile);
  form.append('language', options?.language || 'auto');
  form.append('task', options?.task || 'transcribe');
  form.append('capture_emotions', String(options?.captureEmotions ?? true));
  if (options?.speakerLabel) {
    form.append('speaker_label', options.speakerLabel);
  }

  const response = await fetchBackend(baseUrl, '/video/transcribe', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
};

export const separateVideoStemWithBackend = async (
  baseUrl: string,
  sourceFile: File,
  options?: {
    stem?: 'speech' | 'background';
    modelName?: string;
  }
): Promise<Blob> => {
  const form = new FormData();
  form.append('file', sourceFile);
  form.append('stem', options?.stem || 'speech');
  if (options?.modelName) {
    form.append('model_name', options.modelName);
  }

  const response = await fetchBackend(baseUrl, '/video/separate-stem', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.blob();
};

export const muxDubbedVideo = async (
  baseUrl: string,
  videoFile: File,
  dubAudioFile: File,
  options?: { speechGain?: number; backgroundGain?: number; mixWithVideoAudio?: boolean }
): Promise<Blob> => {
  const form = new FormData();
  form.append('video', videoFile);
  form.append('dub_audio', dubAudioFile);
  form.append('speech_gain', String(options?.speechGain ?? 1.0));
  form.append('background_gain', String(options?.backgroundGain ?? 0.30));
  form.append('mix_with_video_audio', String(options?.mixWithVideoAudio ?? true));

  const response = await fetchBackend(baseUrl, '/video/mux-dub', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.blob();
};

export const switchTtsEngineRuntime = async (
  baseUrl: string,
  engine: GenerationSettings['engine'],
  options?: { gpu?: boolean }
): Promise<TtsEngineSwitchResult> => {
  const response = await fetchBackend(baseUrl, '/tts/engines/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      engine,
      gpu: Boolean(options?.gpu),
    }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
};

export const fetchTtsEngineCapabilities = async (
  baseUrl: string
): Promise<TtsEngineCapabilitiesResult> => {
  const response = await fetchBackend(baseUrl, '/tts/engines/capabilities');
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
};

export const tailRuntimeLog = async (
  baseUrl: string,
  service: 'media-backend' | 'gemini-runtime' | 'kokoro-runtime',
  options?: { cursor?: number; maxBytes?: number; lineLimit?: number }
): Promise<RuntimeLogTailResult> => {
  const params = new URLSearchParams();
  params.set('service', service);
  if (typeof options?.cursor === 'number' && Number.isFinite(options.cursor)) {
    params.set('cursor', String(Math.max(0, Math.floor(options.cursor))));
  }
  if (typeof options?.maxBytes === 'number' && Number.isFinite(options.maxBytes)) {
    params.set('max_bytes', String(Math.max(1024, Math.floor(options.maxBytes))));
  }
  if (typeof options?.lineLimit === 'number' && Number.isFinite(options.lineLimit)) {
    params.set('line_limit', String(Math.max(1, Math.floor(options.lineLimit))));
  }

  const response = await fetchBackend(baseUrl, `/runtime/logs/tail?${params.toString()}`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
};
