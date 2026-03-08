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
import { requestBlob, requestJson } from './httpClient';

export type RuntimeLogService = 'media-backend' | 'gemini-runtime' | 'kokoro-runtime' | 'voice-transfer-runtime';

const withBaseUrl = (baseUrl?: string): { baseUrl?: string } => (baseUrl ? { baseUrl } : {});

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

export const extractAudioFromVideo = async (
  file: File,
  options?: { baseUrl?: string }
): Promise<Blob> => {
  const form = new FormData();
  form.append('file', file);
  return requestBlob(
    '/audio/extract-from-video',
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
  const form = new FormData();
  form.append('source_file', sourceFile);
  form.append('target_language', options?.targetLanguage || 'auto');
  form.append('mode', options?.mode || 'strict_full');
  form.append('output', options?.output || 'audio+video');
  form.append('advanced', JSON.stringify(options?.advanced || {}));
  return requestJson<CreateDubbingJobV2Response>(
    '/dubbing/jobs/v2',
    {
      method: 'POST',
      body: form,
    },
    withBaseUrl(options?.baseUrl)
  );
};

export const getDubbingJob = async (jobId: string, baseUrl?: string): Promise<DubbingJobStatusResponse> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  return requestJson<DubbingJobStatusResponse>(
    `/dubbing/jobs/${safeJobId}`,
    undefined,
    withBaseUrl(baseUrl)
  );
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
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  const searchParams = new URLSearchParams();
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
    ? `/dubbing/jobs/${safeJobId}?${searchParams.toString()}`
    : `/dubbing/jobs/${safeJobId}`;
  return requestJson<DubbingJobStatusResponse>(
    path,
    undefined,
    withBaseUrl(options?.baseUrl)
  );
};

export const cancelDubbingJob = async (jobId: string, baseUrl?: string): Promise<{ ok: boolean; job_id: string }> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  return requestJson<{ ok: boolean; job_id: string }>(
    `/dubbing/jobs/${safeJobId}/cancel`,
    { method: 'POST' },
    withBaseUrl(baseUrl)
  );
};

export const downloadDubbingReport = async (jobId: string, baseUrl?: string): Promise<Blob> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  return requestBlob(`/dubbing/jobs/${safeJobId}/report`, undefined, withBaseUrl(baseUrl));
};

export const downloadDubbingResult = async (jobId: string, baseUrl?: string): Promise<Blob> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  return requestBlob(`/dubbing/jobs/${safeJobId}/result`, undefined, withBaseUrl(baseUrl));
};

export const downloadDubbingChunk = async (
  jobId: string,
  chunkIndex: number,
  baseUrl?: string
): Promise<Blob> => {
  const safeJobId = encodeURIComponent(String(jobId || '').trim());
  const safeChunkIndex = Math.max(0, Math.floor(Number(chunkIndex || 0)));
  return requestBlob(
    `/dubbing/jobs/${safeJobId}/chunks/${safeChunkIndex}`,
    undefined,
    withBaseUrl(baseUrl)
  );
};
