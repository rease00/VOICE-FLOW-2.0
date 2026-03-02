import type { GenerationSettings } from '../../../types';
import type {
  RuntimeLogTailResponse,
  TtsEngineCapabilitiesResponse,
  TtsEngineStatusResponse,
  TtsEngineSwitchResponse,
  TtsVoiceMappingCatalogResponse,
  TtsEngineVoicesResponse,
  VideoTranscriptionResponse,
} from './contracts';
import { requestBlob, requestJson } from './httpClient';

export type RuntimeLogService = 'media-backend' | 'gemini-runtime' | 'kokoro-runtime';

const withBaseUrl = (baseUrl?: string): { baseUrl?: string } => (baseUrl ? { baseUrl } : {});

export const fetchTtsEnginesStatus = async (
  engine?: GenerationSettings['engine'],
  baseUrl?: string
): Promise<TtsEngineStatusResponse> => {
  const params = new URLSearchParams();
  if (engine) params.set('engine', engine);
  const path = `/tts/engines/status${params.toString() ? `?${params.toString()}` : ''}`;
  return requestJson<TtsEngineStatusResponse>(path, undefined, withBaseUrl(baseUrl));
};

export const fetchTtsEngineVoices = async (
  engine: GenerationSettings['engine'],
  baseUrl?: string
): Promise<TtsEngineVoicesResponse> => {
  const params = new URLSearchParams({ engine });
  return requestJson<TtsEngineVoicesResponse>(`/tts/engines/voices?${params.toString()}`, undefined, withBaseUrl(baseUrl));
};

export const fetchTtsVoiceMappingCatalog = async (
  baseUrl?: string
): Promise<TtsVoiceMappingCatalogResponse> => {
  return requestJson<TtsVoiceMappingCatalogResponse>('/tts/voice-mapping/catalog', undefined, withBaseUrl(baseUrl));
};

export const switchTtsEngine = async (
  engine: GenerationSettings['engine'],
  options?: { gpu?: boolean; baseUrl?: string }
): Promise<TtsEngineSwitchResponse> => {
  return requestJson<TtsEngineSwitchResponse>(
    '/tts/engines/switch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, gpu: Boolean(options?.gpu) }),
    },
    withBaseUrl(options?.baseUrl)
  );
};

export const fetchTtsEngineCapabilities = async (baseUrl?: string): Promise<TtsEngineCapabilitiesResponse> => {
  return requestJson<TtsEngineCapabilitiesResponse>('/tts/engines/capabilities', undefined, withBaseUrl(baseUrl));
};

export const tailRuntimeLogs = async (
  service: RuntimeLogService,
  options?: { cursor?: number; maxBytes?: number; lineLimit?: number; baseUrl?: string }
): Promise<RuntimeLogTailResponse> => {
  const params = new URLSearchParams({ service });
  if (typeof options?.cursor === 'number' && Number.isFinite(options.cursor)) {
    params.set('cursor', String(Math.max(0, Math.floor(options.cursor))));
  }
  if (typeof options?.maxBytes === 'number' && Number.isFinite(options.maxBytes)) {
    params.set('max_bytes', String(Math.max(1024, Math.floor(options.maxBytes))));
  }
  if (typeof options?.lineLimit === 'number' && Number.isFinite(options.lineLimit)) {
    params.set('line_limit', String(Math.max(1, Math.floor(options.lineLimit))));
  }
  return requestJson<RuntimeLogTailResponse>(
    `/runtime/logs/tail?${params.toString()}`,
    undefined,
    withBaseUrl(options?.baseUrl)
  );
};

export const transcribeVideo = async (
  file: File,
  options?: {
    language?: string;
    task?: 'transcribe' | 'translate';
    includeEmotion?: boolean;
    returnWords?: boolean;
    speakerLabel?: string;
    baseUrl?: string;
  }
): Promise<VideoTranscriptionResponse> => {
  const form = new FormData();
  form.append('file', file);
  form.append('language', options?.language || 'auto');
  form.append('task', options?.task || 'transcribe');
  form.append('include_emotion', String(options?.includeEmotion ?? true));
  form.append('return_words', String(options?.returnWords ?? true));
  if (options?.speakerLabel) {
    form.append('speaker_label', options.speakerLabel);
  }
  return requestJson<VideoTranscriptionResponse>(
    '/video/transcribe',
    {
      method: 'POST',
      body: form,
    },
    withBaseUrl(options?.baseUrl)
  );
};

export const separateStem = async (
  file: File,
  options?: { stem?: 'speech' | 'background'; modelName?: string; baseUrl?: string }
): Promise<Blob> => {
  const form = new FormData();
  form.append('file', file);
  form.append('stem', options?.stem || 'speech');
  if (options?.modelName) {
    form.append('model_name', options.modelName);
  }
  return requestBlob(
    '/video/separate-stem',
    {
      method: 'POST',
      body: form,
    },
    withBaseUrl(options?.baseUrl)
  );
};

export const muxDubbedVideo = async (
  videoFile: File,
  dubAudioFile: File,
  options?: {
    speechGain?: number;
    backgroundGain?: number;
    normalize?: boolean;
    backgroundAudio?: File;
    baseUrl?: string;
  }
): Promise<Blob> => {
  const form = new FormData();
  form.append('video', videoFile);
  form.append('dub_audio', dubAudioFile);
  form.append('speech_gain', String(options?.speechGain ?? 1.0));
  form.append('background_gain', String(options?.backgroundGain ?? 0.3));
  form.append('normalize', String(options?.normalize ?? true));
  if (options?.backgroundAudio) {
    form.append('background_audio', options.backgroundAudio);
  }
  return requestBlob(
    '/video/mux-dub',
    {
      method: 'POST',
      body: form,
    },
    withBaseUrl(options?.baseUrl)
  );
};
