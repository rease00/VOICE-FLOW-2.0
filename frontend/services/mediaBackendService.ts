import { GenerationSettings, RuntimeCapabilities } from '../types';
import type {
  RuntimeLogTailResponse,
  TtsEngineCapabilitiesResponse,
  TtsEngineSwitchResponse,
  VideoTranscriptionResponse,
} from '../src/shared/api/contracts';
import {
  fetchTtsEngineCapabilities as fetchGatewayTtsEngineCapabilities,
  muxDubbedVideo as gatewayMuxDubbedVideo,
  separateStem,
  switchTtsEngine,
  tailRuntimeLogs,
  transcribeVideo,
  type RuntimeLogService,
} from '../src/shared/api/gatewayClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import { requestBlob, requestJson } from '../src/shared/api/httpClient';

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

export type VideoTranscriptionResult = VideoTranscriptionResponse;
export type TtsEngineSwitchResult = TtsEngineSwitchResponse;
export type RuntimeLogTailResult = RuntimeLogTailResponse;
export type TtsEngineCapabilitiesResult = TtsEngineCapabilitiesResponse & {
  engines: Partial<Record<GenerationSettings['engine'], RuntimeCapabilities>>;
};

const toBaseUrl = (input?: string): string => resolveApiBaseUrl(input);

export const resolveMediaBackendUrl = (settings: Pick<GenerationSettings, 'mediaBackendUrl'>): string => {
  return toBaseUrl(settings.mediaBackendUrl);
};

export const checkMediaBackendHealth = async (baseUrl: string): Promise<MediaBackendHealth> => {
  return requestJson<MediaBackendHealth>('/health', undefined, { baseUrl: toBaseUrl(baseUrl) });
};

export const listRvcModels = async (baseUrl: string): Promise<{ models: string[]; currentModel?: string }> => {
  const payload = await requestJson<{ models?: string[]; currentModel?: string }>('/rvc/models', undefined, {
    baseUrl: toBaseUrl(baseUrl),
  });
  const response: { models: string[]; currentModel?: string } = {
    models: Array.isArray(payload?.models) ? payload.models : [],
  };
  if (typeof payload?.currentModel === 'string') {
    response.currentModel = payload.currentModel;
  }
  return response;
};

export const loadRvcModel = async (baseUrl: string, modelName: string): Promise<void> => {
  await requestJson<{ ok: boolean }>(
    '/rvc/load-model',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelName }),
    },
    { baseUrl: toBaseUrl(baseUrl) }
  );
};

export const convertRvcCover = async (
  baseUrl: string,
  sourceAudio: File,
  modelName: string,
  options?: {
    preset?: 'tts_realtime' | 'cover_hq';
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
  form.append('preset', options?.preset || 'tts_realtime');
  form.append('pitch_shift', String(Math.round(options?.pitchShift ?? 0)));
  form.append('index_rate', String(options?.indexRate ?? 0.5));
  form.append('filter_radius', String(options?.filterRadius ?? 3));
  form.append('rms_mix_rate', String(options?.rmsMixRate ?? 1.0));
  form.append('protect', String(options?.protect ?? 0.33));
  form.append('f0_method', options?.f0Method || 'rmvpe');

  return requestBlob(
    '/rvc/convert',
    {
      method: 'POST',
      body: form,
    },
    { baseUrl: toBaseUrl(baseUrl) }
  );
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
  const request = {
    baseUrl: toBaseUrl(baseUrl),
    returnWords: true,
    ...(options?.language ? { language: options.language } : {}),
    ...(options?.task ? { task: options.task } : {}),
    ...(typeof options?.captureEmotions === 'boolean' ? { includeEmotion: options.captureEmotions } : {}),
    ...(options?.speakerLabel ? { speakerLabel: options.speakerLabel } : {}),
  };
  return transcribeVideo(videoFile, request);
};

export const separateVideoStemWithBackend = async (
  baseUrl: string,
  sourceFile: File,
  options?: {
    stem?: 'speech' | 'background';
    modelName?: string;
  }
): Promise<Blob> => {
  const request = {
    baseUrl: toBaseUrl(baseUrl),
    ...(options?.stem ? { stem: options.stem } : {}),
    ...(options?.modelName ? { modelName: options.modelName } : {}),
  };
  return separateStem(sourceFile, request);
};

export const muxDubbedVideo = async (
  baseUrl: string,
  videoFile: File,
  dubAudioFile: File,
  options?: { speechGain?: number; backgroundGain?: number; normalize?: boolean; backgroundAudio?: File }
): Promise<Blob> => {
  const request = {
    baseUrl: toBaseUrl(baseUrl),
    ...(typeof options?.speechGain === 'number' ? { speechGain: options.speechGain } : {}),
    ...(typeof options?.backgroundGain === 'number' ? { backgroundGain: options.backgroundGain } : {}),
    ...(typeof options?.normalize === 'boolean' ? { normalize: options.normalize } : {}),
    ...(options?.backgroundAudio ? { backgroundAudio: options.backgroundAudio } : {}),
  };
  return gatewayMuxDubbedVideo(videoFile, dubAudioFile, request);
};

export const switchTtsEngineRuntime = async (
  baseUrl: string,
  engine: GenerationSettings['engine'],
  options?: { gpu?: boolean }
): Promise<TtsEngineSwitchResult> => {
  return switchTtsEngine(engine, {
    baseUrl: toBaseUrl(baseUrl),
    gpu: Boolean(options?.gpu),
  });
};

export const fetchTtsEngineCapabilities = async (
  baseUrl: string
): Promise<TtsEngineCapabilitiesResult> => {
  return fetchGatewayTtsEngineCapabilities(toBaseUrl(baseUrl));
};

export const tailRuntimeLog = async (
  baseUrl: string,
  service: RuntimeLogService,
  options?: { cursor?: number; maxBytes?: number; lineLimit?: number }
): Promise<RuntimeLogTailResult> => {
  const request = {
    baseUrl: toBaseUrl(baseUrl),
    ...(typeof options?.cursor === 'number' ? { cursor: options.cursor } : {}),
    ...(typeof options?.maxBytes === 'number' ? { maxBytes: options.maxBytes } : {}),
    ...(typeof options?.lineLimit === 'number' ? { lineLimit: options.lineLimit } : {}),
  };
  return tailRuntimeLogs(service, request);
};
