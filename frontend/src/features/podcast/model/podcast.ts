export type PodcastMode = 'live' | 'standard';

export interface PodcastCastMember {
  id: string;
  name: string;
  role: string;
  voice: string;
  persona: string;
}

export interface PodcastOrchestrationState {
  mode?: string;
  status?: string;
  topic?: string;
  targetDurationSec?: number;
  speakerCount?: number;
  activeSpeakerId?: string;
  activeSpeakerName?: string;
  turnIndex?: number;
  elapsedMs?: number;
  sessionEpoch?: number;
  resumeCount?: number;
  fallbackCount?: number;
  chunkGapCount?: number;
  chunkCount?: number;
  playableDurationMs?: number;
  updatedAtMs?: number;
}

export interface PodcastArtifactLink {
  downloadUrl?: string;
  path?: string;
  url?: string;
  ready?: boolean;
  stemKind?: string;
  contentType?: string;
}

export interface PodcastArtifacts {
  audio?: PodcastArtifactLink;
  transcriptJson?: PodcastArtifactLink;
  transcriptTxt?: PodcastArtifactLink;
  summaryJson?: PodcastArtifactLink;
}

export interface PodcastChunk {
  jobId: string;
  index: number;
  engine: string;
  contentType: string;
  durationMs: number;
  textChars: number;
  traceId: string;
  speakerId?: string;
  turnIndex?: number;
  sessionEpoch?: number;
  resumeAttempt?: number;
  fallbackUsed?: boolean;
  audioBase64: string;
}

export interface LivePodcastJobRequest {
  topic: string;
  durationSec: number;
  speakerCount: 2 | 3 | 4;
  cast: PodcastCastMember[];
  pacingStyle: string;
  language?: string;
  seedScript?: string;
  directorModel?: string;
  limits?: {
    sessionMaxSec?: number;
    connectionMaxSec?: number;
    perTurnTimeoutSec?: number;
  };
  recovery?: {
    strategy?: string;
    maxResumeAttempts?: number;
    fallbackMode?: string;
  };
  output?: {
    autoSave?: boolean;
    audioFormat?: string;
    includeTranscript?: boolean;
  };
}

export interface StandardPodcastJobRequest {
  engine?: 'GEM' | 'NEURAL2';
  topic: string;
  durationSec: number;
  speakerCount: 2 | 3 | 4 | 5 | 6;
  cast: PodcastCastMember[];
  pacingStyle: string;
  seedScript?: string;
  language?: string;
  directorModel?: string;
  autoSave?: boolean;
  includeTranscript?: boolean;
  audioFormat?: 'wav';
  scriptWindowChars?: number;
}

export const PODCAST_BILLING_RATE = 1.5;
export const PODCAST_STANDARD_SCRIPT_WINDOW_CHARS = 3000;

export const PODCAST_TAB_ITEMS = [
  { id: 'live', label: 'Podcast Live', badge: 'Experimental' },
  { id: 'standard', label: 'Podcast Standard' },
] as const;

export const PODCAST_DEFAULT_TOPIC = 'The future of AI-native voice production on VoiceFlow';
export const PODCAST_DEFAULT_LIVE_PACING = 'fast-paced debate';
export const PODCAST_DEFAULT_STANDARD_PACING = 'conversational deep dive';

export const PODCAST_LIVE_DURATION_OPTIONS = [
  { value: 180, label: '3 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 900, label: '15 min' },
  { value: 1200, label: '20 min' },
  { value: 1800, label: '30 min' },
] as const;

export const PODCAST_STANDARD_DURATION_OPTIONS = [
  { value: 600, label: '10 min' },
  { value: 1200, label: '20 min' },
  { value: 1800, label: '30 min' },
  { value: 2700, label: '45 min' },
  { value: 3600, label: '60 min' },
] as const;

export const PODCAST_DEFAULT_CAST: PodcastCastMember[] = [
  {
    id: 'host',
    name: 'HOST',
    role: 'witty host',
    voice: 'Puck',
    persona: 'Witty host who keeps momentum high and delivers sharp transitions.',
  },
  {
    id: 'expert',
    name: 'EXPERT',
    role: 'skeptical expert',
    voice: 'Charon',
    persona: 'Skeptical expert who pressure-tests claims and asks hard follow-ups.',
  },
  {
    id: 'guest',
    name: 'GUEST',
    role: 'energetic guest',
    voice: 'Kore',
    persona: 'Energetic guest who adds momentum, surprises, and audience-friendly examples.',
  },
  {
    id: 'challenger',
    name: 'CHALLENGER',
    role: 'fact checker',
    voice: 'Fenrir',
    persona: 'Grounded checker who keeps discussion concrete with concise evidence.',
  },
  {
    id: 'synthesizer',
    name: 'SYNTHESIZER',
    role: 'systems synthesizer',
    voice: 'Aoede',
    persona: 'Connects threads and simplifies complex tradeoffs.',
  },
  {
    id: 'closer',
    name: 'CLOSER',
    role: 'wrap specialist',
    voice: 'Callirrhoe',
    persona: 'Delivers concise recaps and clear action summaries.',
  },
] as const;

export const PODCAST_CAST_FALLBACK: PodcastCastMember = {
  id: 'speaker_1',
  name: 'VOICE 1',
  role: 'panelist',
  voice: 'Zephyr',
  persona: 'Balanced discussion voice.',
};

export const clampPodcastSpeakerCount = (mode: PodcastMode, value: number): number => {
  const safe = Math.floor(Number(value || 0));
  if (mode === 'live') return Math.max(2, Math.min(4, safe || 4));
  return Math.max(2, Math.min(6, safe || 4));
};

export const clampPodcastDurationSec = (mode: PodcastMode, value: number): number => {
  const safe = Math.floor(Number(value || 0));
  if (mode === 'live') return Math.max(60, Math.min(1800, safe || 180));
  return Math.max(60, Math.min(3600, safe || 1800));
};

export const estimatePodcastChars = (mode: PodcastMode, durationSec: number): number => {
  const safeDuration = clampPodcastDurationSec(mode, durationSec);
  const projected = Math.max(120, Math.round(safeDuration * 12));
  if (mode === 'standard') return Math.max(PODCAST_STANDARD_SCRIPT_WINDOW_CHARS, projected);
  return projected;
};

export const estimatePodcastVf = (mode: PodcastMode, durationSec: number): number => (
  estimatePodcastChars(mode, durationSec) * PODCAST_BILLING_RATE
);

export const normalizePodcastCastRow = (entry: PodcastCastMember, index: number): PodcastCastMember => {
  const fallback = PODCAST_DEFAULT_CAST[index] ?? PODCAST_CAST_FALLBACK;
  return {
    id: String(entry.id || fallback.id).trim() || fallback.id,
    name: String(entry.name || fallback.name).trim() || fallback.name,
    role: String(entry.role || fallback.role).trim() || fallback.role,
    voice: String(entry.voice || fallback.voice).trim() || fallback.voice,
    persona: String(entry.persona || fallback.persona).trim() || fallback.persona,
  };
};
