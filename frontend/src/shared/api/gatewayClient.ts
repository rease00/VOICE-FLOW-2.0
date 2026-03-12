import type { GenerationSettings } from '../../../types';
import type {
  RuntimeLogTailResponse,
  TtsEngineCapabilitiesResponse,
  TtsEngineStatusResponse,
  TtsJobStatusResponse,
  TtsEngineSwitchResponse,
  TtsVoiceMappingCatalogResponse,
  TtsEngineVoicesResponse,
  VideoTranscriptionResponse,
  CreateDubbingJobV2Response,
  DubbingJobStatusResponse,
} from './contracts';
import { requestBlob, requestJson, requestPublicJson } from './httpClient';

export type RuntimeLogService = 'media-backend' | 'gemini-runtime' | 'kokoro-runtime';

const withBaseUrl = (baseUrl?: string): { baseUrl?: string } => (baseUrl ? { baseUrl } : {});
const removedGatewayFeature = (feature: string): Error =>
  new Error(`${feature} endpoint was removed from this project.`);

const decodeBase64ToArrayBuffer = (value: string): ArrayBuffer => {
  const safe = String(value || '').trim();
  if (!safe) return new ArrayBuffer(0);
  const binary = atob(safe);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

export const fetchTtsEnginesStatus = async (
  engine?: GenerationSettings['engine'],
  baseUrl?: string
): Promise<TtsEngineStatusResponse> => {
  const params = new URLSearchParams();
  if (engine) params.set('engine', engine);
  const path = `/tts/engines/status${params.toString() ? `?${params.toString()}` : ''}`;
  return requestPublicJson<TtsEngineStatusResponse>(path, undefined, withBaseUrl(baseUrl));
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
  return requestPublicJson<TtsEngineCapabilitiesResponse>('/tts/engines/capabilities', undefined, withBaseUrl(baseUrl));
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
  void file;
  void options;
  throw removedGatewayFeature('Video transcription');
};

export const extractAudioFromVideo = async (
  file: File,
  options?: { baseUrl?: string }
): Promise<Blob> => {
  void file;
  void options;
  throw removedGatewayFeature('Audio extraction');
};

export const separateStem = async (
  file: File,
  options?: { stem?: 'speech' | 'background'; modelName?: string; baseUrl?: string }
): Promise<Blob> => {
  void file;
  void options;
  throw removedGatewayFeature('Stem separation');
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
  void videoFile;
  void dubAudioFile;
  void options;
  throw removedGatewayFeature('Video dubbing mux');
};

export const fetchTtsJobChunkAudio = async (
  jobId: string,
  chunkIndex: number,
  baseUrl?: string
): Promise<ArrayBuffer> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  const safeChunkIndex = Math.max(0, Math.floor(Number(chunkIndex || 0)));
  const blob = await requestBlob(
    `/tts/jobs/${safeJobId}/chunks/${safeChunkIndex}`,
    undefined,
    withBaseUrl(baseUrl)
  );
  return blob.arrayBuffer();
};

export const createTtsJob = async (
  payload: Record<string, unknown>,
  options?: { baseUrl?: string }
): Promise<TtsJobStatusResponse> => {
  return requestJson<TtsJobStatusResponse>(
    '/tts/jobs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const getTtsJob = async (
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
    ? `/tts/jobs/${safeJobId}?${searchParams.toString()}`
    : `/tts/jobs/${safeJobId}`;
  return requestJson<TtsJobStatusResponse>(
    path,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const cancelTtsJob = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<TtsJobStatusResponse> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  return requestJson<TtsJobStatusResponse>(
    `/tts/jobs/${safeJobId}`,
    { method: 'DELETE' },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const fetchTtsJobResult = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<{ audioBytes: ArrayBuffer; mediaType: string; headers: Record<string, string> }> => {
  const response = await getTtsJob(jobId, {
    includeResult: true,
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
  const audioBase64 = String(response.result?.audioBase64 || '').trim();
  if (!audioBase64) {
    throw new Error('TTS job result is missing audio payload.');
  }
  return {
    audioBytes: decodeBase64ToArrayBuffer(audioBase64),
    mediaType: String(response.result?.mediaType || 'audio/wav'),
    headers: response.result?.headers || {},
  };
};

export const createDubbingJobV2 = async (
  sourceFile: File,
  options?: {
    targetLanguage?: string;
    mode?: 'strict_full';
    output?: 'audio' | 'video' | 'audio+video';
    advanced?: Record<string, unknown>;
    baseUrl?: string;
  }
): Promise<CreateDubbingJobV2Response> => {
  void sourceFile;
  void options;
  throw removedGatewayFeature('Dubbing jobs');
};

export const getDubbingJob = async (jobId: string, baseUrl?: string): Promise<DubbingJobStatusResponse> => {
  void jobId;
  void baseUrl;
  throw removedGatewayFeature('Dubbing jobs');
};

export const getDubbingJobWithOptions = async (
  jobId: string,
  options?: {
    includeChunks?: boolean;
    chunkCursor?: number;
    chunkLimit?: number;
    includeChunkAudio?: boolean;
    baseUrl?: string;
  }
): Promise<DubbingJobStatusResponse> => {
  void jobId;
  void options;
  throw removedGatewayFeature('Dubbing jobs');
};

export const cancelDubbingJob = async (jobId: string, baseUrl?: string): Promise<{ ok: boolean; job_id: string }> => {
  void jobId;
  void baseUrl;
  throw removedGatewayFeature('Dubbing jobs');
};

export const downloadDubbingReport = async (jobId: string, baseUrl?: string): Promise<Blob> => {
  void jobId;
  void baseUrl;
  throw removedGatewayFeature('Dubbing reports');
};

export const downloadDubbingResult = async (jobId: string, baseUrl?: string): Promise<Blob> => {
  void jobId;
  void baseUrl;
  throw removedGatewayFeature('Dubbing results');
};

export const downloadDubbingChunk = async (
  jobId: string,
  chunkIndex: number,
  baseUrl?: string
): Promise<Blob> => {
  void jobId;
  void chunkIndex;
  void baseUrl;
  throw removedGatewayFeature('Dubbing chunks');
};
