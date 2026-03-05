import { GenerationSettings, RuntimeCapabilities } from '../types';
import type {
  RuntimeLogTailResponse,
  TtsEngineCapabilitiesResponse,
  TtsEngineSwitchResponse,
  VideoTranscriptionResponse,
} from '../src/shared/api/contracts';
import {
  cancelDubbingJob as gatewayCancelDubbingJob,
  createDubbingJobV2 as gatewayCreateDubbingJobV2,
  downloadDubbingChunk as gatewayDownloadDubbingChunk,
  downloadDubbingReport as gatewayDownloadDubbingReport,
  downloadDubbingResult as gatewayDownloadDubbingResult,
  extractAudioFromVideo as gatewayExtractAudioFromVideo,
  fetchTtsEngineCapabilities as fetchGatewayTtsEngineCapabilities,
  getDubbingJob as gatewayGetDubbingJob,
  getDubbingJobWithOptions as gatewayGetDubbingJobWithOptions,
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
  llvc?: { available: boolean; currentModel?: string | null; modelsDir?: string; error?: string | null };
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
    dereverbModel?: string;
    dereverbReady?: boolean;
    error?: string | null;
  };
  lipsync?: {
    runtime?: string;
    assetPath?: string;
    assetReady?: boolean;
    lpipsAssetPath?: string;
    lpipsReady?: boolean;
    ready?: boolean;
  };
}

export type VideoTranscriptionResult = VideoTranscriptionResponse;
export type TtsEngineSwitchResult = TtsEngineSwitchResponse;
export type RuntimeLogTailResult = RuntimeLogTailResponse;
export type TtsEngineCapabilitiesResult = TtsEngineCapabilitiesResponse & {
  engines: Partial<Record<GenerationSettings['engine'], RuntimeCapabilities>>;
};
export type DubbingJobCreateResult = { ok: boolean; job_id: string };
export type DubbingJobStatusResult = {
  ok: boolean;
  job: {
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancelling';
    stage?: string;
    progress?: number;
    error?: string;
    reportPath?: string | null;
    resultPath?: string | null;
    stageTimeline?: Array<{ stage: string; status: string; startMs?: number | null; endMs?: number | null; durationMs?: number | null }>;
    directorJson?: Record<string, unknown> | null;
    isochronyStats?: Record<string, unknown> | null;
    llvcMetrics?: Record<string, unknown> | null;
    lipsyncMetrics?: Record<string, unknown> | null;
    assets?: Record<string, unknown> | null;
    thinkingPolicy?: Record<string, unknown> | null;
    live?: {
      enabled?: boolean;
      mode?: string;
      playableChunks?: number;
      playableDurationMs?: number;
      chunkCursorNext?: number;
    };
    chunks?: Array<{
      index: number;
      contentType?: string;
      durationMs?: number;
      speakerId?: string;
      engine?: string;
      voiceId?: string;
      textChars?: number;
      downloadUrl?: string;
      audioBase64?: string;
    }>;
    chunkCursorNext?: number;
    speakerStats?: {
      detectedSpeakers?: number;
      mappedSpeakers?: number;
      fallbackBindings?: Array<Record<string, unknown>>;
      driftAlerts?: Array<Record<string, unknown>>;
    };
    qosState?: {
      selectedProfile?: string;
      downgraded?: boolean;
      reason?: string;
      gpuUsed?: boolean;
    };
    [key: string]: unknown;
  };
};

const toBaseUrl = (input?: string): string => resolveApiBaseUrl(input);

export const resolveMediaBackendUrl = (settings: Pick<GenerationSettings, 'mediaBackendUrl'>): string => {
  return toBaseUrl(settings.mediaBackendUrl);
};

export const checkMediaBackendHealth = async (baseUrl: string): Promise<MediaBackendHealth> => {
  return requestJson<MediaBackendHealth>('/health', undefined, { baseUrl: toBaseUrl(baseUrl) });
};

export const listLlvcModels = async (baseUrl: string): Promise<{ models: string[]; currentModel?: string }> => {
  const payload = await requestJson<{ models?: string[]; currentModel?: string }>('/llvc/models', undefined, {
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

export const loadLlvcModel = async (baseUrl: string, modelName: string): Promise<void> => {
  await requestJson<{ ok: boolean }>(
    '/llvc/load-model',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelName }),
    },
    { baseUrl: toBaseUrl(baseUrl) }
  );
};

export const convertLlvcCover = async (
  baseUrl: string,
  sourceAudio: File,
  modelName: string,
  options?: {
    preset?: 'tts_realtime' | 'cover_hq' | 'llvc_hq_cpu';
    pitchShift?: number;
    indexRate?: number;
    filterRadius?: number;
    rmsMixRate?: number;
    protect?: number;
    f0Method?: 'rmvpe' | 'harvest' | 'crepe' | 'pm';
    separateStem?: boolean;
  }
): Promise<Blob> => {
  const form = new FormData();
  // Backend accepts audio/video source and normalizes it to WAV before LLVC conversion.
  form.append('file', sourceAudio);
  form.append('model_name', modelName);
  form.append('preset', options?.preset || 'llvc_hq_cpu');
  form.append('pitch_shift', String(Math.round(options?.pitchShift ?? 0)));
  form.append('index_rate', String(options?.indexRate ?? 0.5));
  form.append('filter_radius', String(options?.filterRadius ?? 3));
  form.append('rms_mix_rate', String(options?.rmsMixRate ?? 1.0));
  form.append('protect', String(options?.protect ?? 0.33));
  form.append('f0_method', options?.f0Method || 'rmvpe');
  form.append('separate_stem', String(options?.separateStem ?? true));

  return requestBlob(
    '/llvc/convert',
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

export const extractAudioFromVideoWithBackend = async (
  baseUrl: string,
  sourceFile: File
): Promise<Blob> => {
  return gatewayExtractAudioFromVideo(sourceFile, {
    baseUrl: toBaseUrl(baseUrl),
  });
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

export const createDubbingJobV2 = async (
  baseUrl: string,
  sourceFile: File,
  options?: {
    targetLanguage?: string;
    mode?: 'strict_full';
    output?: 'audio' | 'video' | 'audio+video';
    advanced?: Record<string, unknown>;
  }
): Promise<DubbingJobCreateResult> => {
  return gatewayCreateDubbingJobV2(sourceFile, {
    baseUrl: toBaseUrl(baseUrl),
    targetLanguage: options?.targetLanguage || 'auto',
    mode: options?.mode || 'strict_full',
    output: options?.output || 'audio+video',
    advanced: options?.advanced || {},
  });
};

export const getDubbingJob = async (
  baseUrl: string,
  jobId: string,
  options?: {
    includeChunks?: boolean;
    chunkCursor?: number;
    chunkLimit?: number;
    includeChunkAudio?: boolean;
  }
): Promise<DubbingJobStatusResult> => {
  const hasAdvancedOptions = Boolean(
    options
    && (
      options.includeChunks
      || typeof options.chunkCursor === 'number'
      || typeof options.chunkLimit === 'number'
      || typeof options.includeChunkAudio === 'boolean'
    )
  );
  if (hasAdvancedOptions) {
    return gatewayGetDubbingJobWithOptions(jobId, {
      ...(options || {}),
      baseUrl: toBaseUrl(baseUrl),
    }) as Promise<DubbingJobStatusResult>;
  }
  return gatewayGetDubbingJob(jobId, toBaseUrl(baseUrl)) as Promise<DubbingJobStatusResult>;
};

export const cancelDubbingJob = async (baseUrl: string, jobId: string): Promise<{ ok: boolean; job_id: string }> => {
  return gatewayCancelDubbingJob(jobId, toBaseUrl(baseUrl));
};

export const downloadDubbingReport = async (baseUrl: string, jobId: string): Promise<Blob> => {
  return gatewayDownloadDubbingReport(jobId, toBaseUrl(baseUrl));
};

export const downloadDubbingResult = async (baseUrl: string, jobId: string): Promise<Blob> => {
  return gatewayDownloadDubbingResult(jobId, toBaseUrl(baseUrl));
};

export const downloadDubbingChunk = async (baseUrl: string, jobId: string, chunkIndex: number): Promise<Blob> => {
  return gatewayDownloadDubbingChunk(jobId, chunkIndex, toBaseUrl(baseUrl));
};
