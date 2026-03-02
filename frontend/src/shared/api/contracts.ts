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
  emotionCapture?: {
    enabled?: boolean;
    maxSegments?: number;
    minSegmentSeconds?: number;
  };
  segments: VideoTranscriptionSegment[];
}
