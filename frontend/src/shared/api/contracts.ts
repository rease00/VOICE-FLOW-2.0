import type {
  GenerationSettings,
  RuntimeCapabilities,
} from '../../../types';

export interface EngineStatusItem {
  engine: GenerationSettings['engine'];
  state: 'online' | 'starting' | 'warming' | 'offline' | 'not_configured' | 'standby';
  detail: string;
  ready: boolean;
  healthUrl: string;
  runtimeUrl: string;
}

export interface TtsEngineStatusResponse {
  ok: boolean;
  requestedEngine?: string;
  engines: Partial<Record<GenerationSettings['engine'], EngineStatusItem>>;
  fetchedAt?: string;
  generatedAtMs?: number;
}

export interface RuntimeVoiceItem {
  voice_id: string;
  name: string;
  displayName?: string;
  display_name?: string;
  voice?: string;
  language?: string;
  accent?: string;
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
  state: 'online' | 'starting' | 'offline' | 'not_configured';
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

export interface TtsJobChunkResponse {
  index: number;
  dialogue_id?: number;
  turn_id?: number;
  chunk_id?: number;
  serial_index?: number;
  lane?: string;
  contentType?: string;
  durationMs?: number;
  textChars?: number;
  engine?: string;
  traceId?: string;
  speakerId?: string;
  turnIndex?: number;
  sessionEpoch?: number;
  resumeAttempt?: number;
  fallbackUsed?: boolean;
  downloadUrl?: string;
  audioBase64?: string;
}

export interface TtsJobStatusResponse {
  ok: boolean;
  accepted?: boolean;
  jobId: string;
  requestId?: string;
  traceId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  statusReason?: string;
  engine?: string;
  lane?: string;
  attempts?: number;
  maxAttempts?: number;
  createdAtMs?: number;
  updatedAtMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  deadlineAtMs?: number;
  queueAgeMs?: number;
  queueDepthAtRead?: number;
  engineConcurrencyAtRead?: number;
  lastClientSeenAtMs?: number;
  leaseExpiresAtMs?: number;
  disconnectGraceMs?: number;
  statusCode?: number;
  error?: string | Record<string, unknown>;
  queue?: Record<string, unknown>;
  reservedChars?: number;
  reservedVfCost?: number;
  processedChars?: number;
  billedChars?: number;
  billedVfCost?: number;
  refundedVfCost?: number;
  settlementKind?: 'pending' | 'none' | 'partial' | 'full' | string;
  terminalReason?: string;
  billing?: {
    reservedChars?: number;
    reservedVfCost?: number;
    processedChars?: number;
    billedChars?: number;
    billedVfCost?: number;
    refundedVfCost?: number;
    settlementKind?: 'pending' | 'none' | 'partial' | 'full' | string;
    terminalReason?: string;
    charsProcessed?: number;
    chunksGenerated?: number;
  };
  live?: {
    enabled?: boolean;
    mode?: string;
    playableChunks?: number;
    playableDurationMs?: number;
  };
  chunkCursor?: number;
  chunkCursorNext?: number;
  chunks?: TtsJobChunkResponse[];
  result?: {
    audioBase64?: string;
    mediaType?: string;
    headers?: Record<string, string>;
  };
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
  speakerCount?: number;
  speakers?: Array<{
    id?: string;
    label?: string;
    segmentCount?: number;
  }>;
  director?: {
    modelPreferred?: string;
    modelResolved?: string;
    sceneComplexity?: string;
    speakerCount?: number;
    speakerPolicy?: string;
    diarizationApplied?: boolean;
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
    voiceTransferMetrics?: Record<string, unknown> | null;
    videoSyncMetrics?: Record<string, unknown> | null;
    tokenUsage?: Record<string, unknown> | null;
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
}

export interface CreateDubbingJobV2Response {
  ok: boolean;
  job_id: string;
}
