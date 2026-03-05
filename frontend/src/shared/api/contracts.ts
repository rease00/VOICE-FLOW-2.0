import type { GenerationSettings, RuntimeCapabilities } from '../../../types';

export interface EngineStatusItem {
  engine: GenerationSettings['engine'];
  state: 'online' | 'starting' | 'offline';
  detail: string;
  ready: boolean;
  healthUrl: string;
  runtimeUrl: string;
}

export interface TtsEngineStatusResponse {
  ok: boolean;
  engines: Partial<Record<GenerationSettings['engine'], EngineStatusItem>>;
  fetchedAt: string;
}

export interface RuntimeVoiceItem {
  voice_id: string;
  name: string;
  voice?: string;
  language?: string;
  gender?: string;
  source?: string;
  profile_id?: string;
  mapped_name?: string;
  country?: string;
  age_group?: string;
  style_tag?: string;
  is_downloaded?: boolean;
  reference_exists?: boolean;
  reference_path?: string;
  preview_url?: string;
  access_tier?: 'free' | 'pro';
  is_plan_restricted?: boolean;
}

export interface TtsEngineVoicesResponse {
  ok: boolean;
  engine: GenerationSettings['engine'];
  voices: RuntimeVoiceItem[];
  fetchedAt: string;
}

export interface TtsVoiceMappingCatalogResponse {
  ok: boolean;
  version?: {
    profileBank?: string;
    voiceMap?: string;
  };
  profiles: Array<Record<string, unknown>>;
  engines: Record<string, unknown>;
  fetchedAt: string;
}

export interface RuntimeLogTailResponse {
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

export interface TtsEngineSwitchResponse {
  ok: boolean;
  engine: GenerationSettings['engine'];
  state: 'online' | 'starting';
  detail: string;
  healthUrl: string;
  gpuMode: boolean;
  commandOutput?: string;
}

export interface TtsEngineCapabilitiesResponse {
  ok: boolean;
  engines: Partial<Record<GenerationSettings['engine'], RuntimeCapabilities>>;
  fetchedAt: string;
}

export interface VideoTranscriptionSegment {
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
}

export interface VideoTranscriptionResponse {
  ok: boolean;
  language?: string;
  script: string;
  durationSec?: number;
  director?: {
    modelPreferred?: string;
    modelResolved?: string;
    sceneComplexity?: string;
    segments?: Array<{
      index: number;
      speaker: string;
      text: string;
      start_ms: number;
      end_ms: number;
      affective_tags?: string[];
    }>;
  };
  emotionCapture?: {
    enabled?: boolean;
    maxSegments?: number;
    minSegmentSeconds?: number;
  };
  segments: VideoTranscriptionSegment[];
}

export interface DubbingJobStatusResponse {
  ok: boolean;
  job: {
    id?: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancelling';
    progress?: number;
    stage?: string;
    error?: string;
    errorCode?: string | null;
    pipelineVersion?: 'v1' | 'v2' | '2026.1' | string;
    stageTimeline?: Array<{
      stage: string;
      status: string;
      startMs?: number | null;
      endMs?: number | null;
      durationMs?: number | null;
    }>;
    outputFiles?: Record<string, unknown>;
    reportPath?: string | null;
    resultPath?: string | null;
    directorJson?: Record<string, unknown> | null;
    isochronyStats?: Record<string, unknown> | null;
    llvcMetrics?: Record<string, unknown> | null;
    lipsyncMetrics?: Record<string, unknown> | null;
    assets?: Record<string, unknown> | null;
    thinkingPolicy?: Record<string, unknown> | null;
    processingProfile?: 'cpu_quality' | 'cpu_balanced' | 'cpu_fast' | string;
    clipWindow?: { start_ms: number; end_ms: number } | null;
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
}

export interface CreateDubbingJobV2Response {
  ok: boolean;
  job_id: string;
}
