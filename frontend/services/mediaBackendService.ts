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
import { requestBlob, requestJson, requestPublicJson } from '../src/shared/api/httpClient';
import { getAdminUnlockToken } from './adminService';

export interface MediaBackendHealth {
  ok: boolean;
  ffmpeg?: { available: boolean; path?: string | null; error?: string | null };
  voiceTransfer?: {
    available: boolean;
    currentModel?: string | null;
    modelsDir?: string;
    error?: string | null;
    backendMode?: string | null;
  };
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
    voiceTransferMetrics?: Record<string, unknown> | null;
    videoSyncMetrics?: Record<string, unknown> | null;
    tokenUsage?: Record<string, unknown> | null;
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
      timelineStartMs?: number;
      timelineEndMs?: number;
      previewKind?: string;
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
    languageStats?: {
      mixedSourceDetected?: boolean;
      dominantSourceLanguage?: string;
      segmentLanguageCounts?: Record<string, number>;
      targetLanguageApplied?: string;
      unsupportedSegments?: Array<Record<string, unknown>> | number;
    };
    policyEnforcement?: {
      requestedTtsRoute?: string;
      appliedTtsRoute?: string;
      pinnedDirectorModel?: string;
      pinnedTtsModel?: string;
      strictNoFallback?: boolean;
    };
    [key: string]: unknown;
  };
};

const toBaseUrl = (input?: string): string => resolveApiBaseUrl(input);
const removedFeatureError = (feature: string): Error =>
  new Error(`${feature} was removed from this project.`);

export const resolveMediaBackendUrl = (settings: Pick<GenerationSettings, 'mediaBackendUrl'>): string => {
  return toBaseUrl(settings.mediaBackendUrl);
};

export const checkMediaBackendHealth = async (
  baseUrl: string,
  options?: { forceRefresh?: boolean }
): Promise<MediaBackendHealth> => {
  const cacheBust = options?.forceRefresh ? `?t=${Date.now().toString(36)}` : '';
  return requestPublicJson<MediaBackendHealth>(`/health${cacheBust}`, undefined, { baseUrl: toBaseUrl(baseUrl) });
};

export const listVoiceTransferModels = async (baseUrl: string): Promise<{ models: string[]; currentModel?: string }> => {
  void baseUrl;
  throw removedFeatureError('Voice transfer models');
};

export const loadVoiceTransferModel = async (baseUrl: string, modelName: string): Promise<void> => {
  void baseUrl;
  void modelName;
  throw removedFeatureError('Voice transfer model loading');
};

export const convertVoiceTransferCover = async (
  baseUrl: string,
  sourceAudio: File,
  modelName: string,
  options?: {
    preset?: 'tts_realtime';
    pitchShift?: number;
    indexRate?: number;
    filterRadius?: number;
    rmsMixRate?: number;
    protect?: number;
    f0Method?: 'rmvpe' | 'harvest' | 'crepe' | 'pm';
    separateStem?: boolean;
  }
): Promise<Blob> => {
  void baseUrl;
  void sourceAudio;
  void modelName;
  void options;
  throw removedFeatureError('Voice transfer conversion');
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
  void baseUrl;
  void videoFile;
  void options;
  throw removedFeatureError('Video transcription');
};

export const extractAudioFromVideoWithBackend = async (
  baseUrl: string,
  sourceFile: File
): Promise<Blob> => {
  void baseUrl;
  void sourceFile;
  throw removedFeatureError('Extract audio from video');
};

export const separateVideoStemWithBackend = async (
  baseUrl: string,
  sourceFile: File,
  options?: {
    stem?: 'speech' | 'background';
    modelName?: string;
  }
): Promise<Blob> => {
  void baseUrl;
  void sourceFile;
  void options;
  throw removedFeatureError('Video stem separation');
};

export const muxDubbedVideo = async (
  baseUrl: string,
  videoFile: File,
  dubAudioFile: File,
  options?: { speechGain?: number; backgroundGain?: number; normalize?: boolean; backgroundAudio?: File }
): Promise<Blob> => {
  void baseUrl;
  void videoFile;
  void dubAudioFile;
  void options;
  throw removedFeatureError('Video dubbing mux');
};

export const switchTtsEngineRuntime = async (
  baseUrl: string,
  engine: GenerationSettings['engine'],
  options?: { gpu?: boolean }
): Promise<TtsEngineSwitchResult> => {
  const unlockToken = getAdminUnlockToken();
  return switchTtsEngine(engine, {
    baseUrl: toBaseUrl(baseUrl),
    gpu: Boolean(options?.gpu),
    ...(unlockToken ? { adminUnlockToken: unlockToken } : {}),
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
  void baseUrl;
  void sourceFile;
  void options;
  throw removedFeatureError('Dubbing jobs');
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
  void baseUrl;
  void jobId;
  void options;
  throw removedFeatureError('Dubbing jobs');
};

export const cancelDubbingJob = async (baseUrl: string, jobId: string): Promise<{ ok: boolean; job_id: string }> => {
  void baseUrl;
  void jobId;
  throw removedFeatureError('Dubbing jobs');
};

export const downloadDubbingReport = async (baseUrl: string, jobId: string): Promise<Blob> => {
  void baseUrl;
  void jobId;
  throw removedFeatureError('Dubbing reports');
};

export const downloadDubbingResult = async (baseUrl: string, jobId: string): Promise<Blob> => {
  void baseUrl;
  void jobId;
  throw removedFeatureError('Dubbing results');
};

export const downloadDubbingChunk = async (baseUrl: string, jobId: string, chunkIndex: number): Promise<Blob> => {
  void baseUrl;
  void jobId;
  void chunkIndex;
  throw removedFeatureError('Dubbing chunks');
};
