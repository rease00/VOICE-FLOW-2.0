import { DUNO_VOICES, VOICES, EMOTIONS } from '../constants';
import type { DubbingClip, GenerationSettings, VoiceOption } from '../types';
import { getDefaultApiBaseUrl, sanitizeConfiguredApiBaseUrl } from '../src/shared/api/config';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageString } from '../src/shared/storage/localStore';
import { WorkspaceTab as Tab } from '../src/features/workspace/model/tabs';
import type { TokenPackKey } from '../services/accountService';

export const STUDIO_SPEECH_GAIN_DEFAULT = 1.0;
export const STUDIO_SPEECH_GAIN_MIN = 0.05;
export const STUDIO_SPEECH_GAIN_MAX = 1.5;
const STUDIO_MUSIC_GAIN_DEFAULT = 0.3;
const STUDIO_MUSIC_GAIN_MIN = 0;
const STUDIO_MUSIC_GAIN_MAX = 1;

const clampFiniteNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

export const resolveStudioSpeechGain = (value: unknown): number => (
  clampFiniteNumber(value, STUDIO_SPEECH_GAIN_MIN, STUDIO_SPEECH_GAIN_MAX, STUDIO_SPEECH_GAIN_DEFAULT)
);

export const resolveStudioMusicGain = (value: unknown): number => (
  clampFiniteNumber(value, STUDIO_MUSIC_GAIN_MIN, STUDIO_MUSIC_GAIN_MAX, STUDIO_MUSIC_GAIN_DEFAULT)
);

export const SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT = 8;

export const appendRollingSample = <T,>(
  samples: readonly T[],
  sample: T,
  limit: number = SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT
): T[] => {
  const normalizedLimit = Math.max(1, Math.floor(Number(limit || 0)));
  const next = [...samples, sample];
  if (next.length <= normalizedLimit) return next;
  return next.slice(next.length - normalizedLimit);
};

export const shouldRefreshSelectedEngineTelemetry = (
  telemetry: { kind?: string; measuredAtMs?: number } | null | undefined,
  nowMs: number = Date.now(),
  staleAfterMs: number = 5000
): boolean => {
  const kind = String(telemetry?.kind || '').trim().toLowerCase();
  if (!kind) return true;
  if (kind === 'pending') return true;
  if (kind !== 'error') return false;

  const measuredAtMs = Number(telemetry?.measuredAtMs || 0);
  if (!Number.isFinite(measuredAtMs) || measuredAtMs <= 0) return true;

  const safeStaleAfterMs = Math.max(0, Math.floor(Number(staleAfterMs) || 0));
  return (nowMs - measuredAtMs) >= safeStaleAfterMs;
};

export interface RuntimeLatencyCandidate {
  state?: string | undefined;
  latencyMs?: number | null | undefined;
}

const normalizeLatency = (value: unknown): number | null => {
  const latency = Number(value);
  if (!Number.isFinite(latency) || latency < 0) return null;
  return Math.floor(latency);
};

export const pickLowestLatencyRuntimeEngine = (
  candidates: Partial<Record<GenerationSettings['engine'], RuntimeLatencyCandidate | null | undefined>>,
  engineOrder: readonly GenerationSettings['engine'][] = ['DUNO', 'VECTOR', 'PRIME']
): GenerationSettings['engine'] | null => {
  let selectedEngine: GenerationSettings['engine'] | null = null;
  let selectedLatencyMs = Number.POSITIVE_INFINITY;
  let selectedOrder = Number.POSITIVE_INFINITY;

  engineOrder.forEach((engine, order) => {
    const candidate = candidates[engine];
    if (!candidate) return;
    const state = String(candidate.state || '').trim().toLowerCase();
    if (state !== 'online') return;
    const latencyMs = normalizeLatency(candidate.latencyMs);
    if (latencyMs === null) return;

    if (
      selectedEngine === null
      || latencyMs < selectedLatencyMs
      || (latencyMs === selectedLatencyMs && order < selectedOrder)
    ) {
      selectedEngine = engine;
      selectedLatencyMs = latencyMs;
      selectedOrder = order;
    }
  });

  return selectedEngine;
};

const normalizeEmotionKey = (value: string): string => (
  String(value || '')
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}"']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
);

const EMOTION_CANONICAL_BY_KEY = new Map<string, string>();
for (const emotion of EMOTIONS) {
  const key = normalizeEmotionKey(emotion);
  if (key && !EMOTION_CANONICAL_BY_KEY.has(key)) {
    EMOTION_CANONICAL_BY_KEY.set(key, emotion);
  }
}

const EMOTION_ALIASES: Record<string, string> = {
  'heroic veera': 'Heroic',
  'sorrowful karuna': 'Sad',
  'terrified bhayanaka': 'Fearful',
  'disgusted bibhatsa': 'Disgusted',
  'wonderstruck adbhuta': 'Surprised',
  'peaceful shanta': 'Calm',
  'amused hasya': 'Playful',
  'furious raudra': 'Furious',
  'romantic shringara': 'Romantic',
  'devotional bhakti': 'Devotional',
  stern: 'Serious',
  melodramatic: 'Cinematic Narration',
  sleepy: 'Relaxed',
  smiling: 'Cheerful',
  joking: 'Playful',
  amused: 'Playful',
  concerned: 'Empathetic',
  concern: 'Empathetic',
  whisper: 'Whispering',
  shout: 'Shouting',
  yell: 'Shouting',
  scream: 'Screaming',
  cry: 'Crying',
  laugh: 'Laughing',
  sad: 'Sad',
  angry: 'Angry',
  fear: 'Fearful',
  calm: 'Calm',
  happy: 'Happy',
  surpris: 'Surprised',
  worried: 'Anxious',
  panic: 'Anxious',
  shocked: 'Shocked',
};

export const normalizeEmotionTag = (value: string): string | undefined => {
  const key = normalizeEmotionKey(value);
  if (!key) return undefined;
  if (EMOTION_CANONICAL_BY_KEY.has(key)) return EMOTION_CANONICAL_BY_KEY.get(key);
  if (Object.prototype.hasOwnProperty.call(EMOTION_ALIASES, key)) return EMOTION_ALIASES[key];
  for (const [token, emotion] of Object.entries(EMOTION_ALIASES)) {
    if (key.includes(token)) return emotion;
  }
  return undefined;
};

const MAINAPP_SPEAKER_NAME_PATTERN_V2 = String.raw`[\p{L}\p{N}][\p{L}\p{M}\p{N}\s.'\u2019_-]{0,58}?`;
const MAINAPP_SPEAKER_LINE_REGEX_V2 = new RegExp(
  String.raw`^\s*(?:\[(.+?)\]|\((.+?)\)|(${MAINAPP_SPEAKER_NAME_PATTERN_V2}))(?:\s*[\(\[]([^\)\]]{1,120})[\)\]])?\s*[:\uFF1A]\s*(.*)$`,
  'u'
);

const MAINAPP_SFX_REGEX = /^(?:\[|\()(?:SFX|sfx|Sound|SOUND|Music|MUSIC)\b/i;
const MAINAPP_SPEAKER_LINE_REGEX = MAINAPP_SPEAKER_LINE_REGEX_V2;

export const normalizeSpeakerName = (raw: string): string => (
  String(raw || '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/[\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

export const normalizeSpeakerMapKey = (raw: string): string => (
  normalizeSpeakerName(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
);

export const resolveSpeakerMappedVoiceId = (
  speakerMapping: Record<string, string> | undefined,
  speaker: string
): string => {
  if (!speakerMapping || typeof speakerMapping !== 'object') return '';
  const rawSpeaker = String(speaker || '').trim();
  if (!rawSpeaker) return '';
  if (speakerMapping[rawSpeaker]) return String(speakerMapping[rawSpeaker] || '').trim();
  const normalizedTarget = normalizeSpeakerMapKey(rawSpeaker);
  if (!normalizedTarget) return '';
  for (const key of Object.keys(speakerMapping)) {
    if (normalizeSpeakerMapKey(key) === normalizedTarget) {
      return String(speakerMapping[key] || '').trim();
    }
  }
  return '';
};

export const normalizeSpeakerHeaderScript = (text: string): string => (
  String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => {
      const match = String(line || '').match(MAINAPP_SPEAKER_LINE_REGEX);
      if (!match) return line;
      const speaker = normalizeSpeakerName(match[1] || match[2] || match[3] || '');
      const dialogue = String(match[4] || '').trim();
      if (!speaker) return line;
      return dialogue ? `[${speaker}]: ${dialogue}` : `[${speaker}]:`;
    })
    .join('\n')
);

export const parseMultiSpeakerScript = (text: string): { isMultiSpeaker: boolean; speakersList: string[]; crewTagsList: string[] } => {
  const speakers = new Map<string, string>();
  const crewTags: string[] = [];
  for (const rawLine of String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed || MAINAPP_SFX_REGEX.test(trimmed)) continue;
    const match = trimmed.match(MAINAPP_SPEAKER_LINE_REGEX);
    if (!match) continue;
    const speaker = normalizeSpeakerName(match[1] || match[2] || match[3] || '');
    if (!speaker) continue;
    const key = speaker.toLowerCase();
    if (!speakers.has(key)) speakers.set(key, speaker);
  }
  return {
    isMultiSpeaker: speakers.size > 0,
    speakersList: Array.from(speakers.values()),
    crewTagsList: crewTags,
  };
};

export const injectDirectorTagsPreservingFormat = (sourceText: string, directedText: string): { text: string; patchedLineCount: number } => ({
  text: String(directedText || sourceText || ''),
  patchedLineCount: 0,
});

export const getStaticVoiceFallback = (engine: GenerationSettings['engine']): VoiceOption[] => (
  engine === 'DUNO' ? DUNO_VOICES : VOICES
);

export const resolveMediaBackendUrl = (settings: Pick<GenerationSettings, 'mediaBackendUrl'>): string => (
  sanitizeConfiguredApiBaseUrl(settings.mediaBackendUrl, getDefaultApiBaseUrl()).value
);

export const COUNTRY_TAG_BY_NAME: Record<string, string> = {
  'united states': 'US',
  'united kingdom': 'UK',
  india: 'IN',
  canada: 'CA',
  australia: 'AU',
  japan: 'JP',
  brazil: 'BR',
  spain: 'ES',
  ireland: 'IE',
  france: 'FR',
  germany: 'DE',
  russia: 'RU',
  'united arab emirates': 'UAE',
};

export const TOKEN_PACK_MATRIX: Record<TokenPackKey, { label: string; vf: number; baseInr: number }> = {
  micro: { label: 'Micro', vf: 50000, baseInr: 550 },
  standard: { label: 'Standard', vf: 150000, baseInr: 1450 },
  mega: { label: 'Mega', vf: 300000, baseInr: 2900 },
  ultra: { label: 'Ultra', vf: 600000, baseInr: 5200 },
};

export const WORKSPACE_TAB_DETAILS: Record<Tab, string> = {
  [Tab.STUDIO]: 'Script, cast, and render audio',
  [Tab.READER]: 'Narration workspace for novels and comics',
  [Tab.VOICE_CLONING]: 'Upload reference and target audio for VC',
  [Tab.CHARACTERS]: 'Voice roster and cast management',
  [Tab.NOVEL]: 'Long-form drafting and chapter flow',
  [Tab.HISTORY]: 'Recent generations and exports',
  [Tab.ADMIN]: 'Operational controls and audits',
};

export const formatInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

export type AdminOpsTab = 'usage' | 'tokens' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics' | 'accounting';

export const resolveWorkspaceTabFromUrl = (): Tab | null => {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const token = String(url.searchParams.get('vf-tab') || '').trim().toUpperCase();
  if (Object.values(Tab).includes(token as Tab)) return token as Tab;
  const pathname = String(url.pathname || '').trim().toLowerCase();
  if (pathname === '/reader' || pathname.startsWith('/reader/')) return Tab.READER;
  return null;
};

export const resolveWorkspaceTabFromStorage = (): Tab | null => {
  const persisted = String(readStorageString(STORAGE_KEYS.workspaceActiveTab) || '').trim().toUpperCase();
  return Object.values(Tab).includes(persisted as Tab) ? (persisted as Tab) : null;
};

export const resolveInitialWorkspaceTab = (): Tab => {
  const fromUrl = resolveWorkspaceTabFromUrl();
  if (fromUrl) return fromUrl;
  return resolveWorkspaceTabFromStorage() || Tab.STUDIO;
};

export const resolveInitialStudioDraftText = (hardCap: number): string => (
  String(readStorageString(STORAGE_KEYS.studioDraftText) || '').slice(0, Math.max(0, Math.floor(Number(hardCap || 0))))
);

export const resolveAdminOpsTabFromUrl = (): AdminOpsTab => {
  if (typeof window === 'undefined') return 'usage';
  const token = String(new URLSearchParams(window.location.search).get('vf-admin-tab') || '').trim().toLowerCase();
  return ['usage', 'tokens', 'guardian', 'alerts', 'scheduler', 'audit', 'analytics', 'accounting'].includes(token)
    ? (token as AdminOpsTab)
    : 'usage';
};

export const normalizePlanToken = (planName: unknown): 'free' | 'launcher' | 'starter' | 'creator' | 'pro' | 'scale' => {
  const token = String(planName || '').trim().toLowerCase();
  if (token === 'launch' || token === 'launcher') return 'launcher';
  if (token === 'starter') return 'starter';
  if (token === 'creator') return 'creator';
  if (token === 'pro') return 'pro';
  if (token === 'scale' || token === 'plus' || token === 'pro_plus' || token === 'pro-plus') return 'scale';
  return 'free';
};

export const resolveTokenPackDiscountPercent = (
  planToken: ReturnType<typeof normalizePlanToken>,
  entitlementDiscount: number
): number => {
  if (Number.isFinite(entitlementDiscount) && entitlementDiscount > 0) {
    return Math.max(0, Math.round(entitlementDiscount));
  }
  if (planToken === 'launcher') return 0;
  if (planToken === 'starter') return 5;
  if (planToken === 'creator') return 5;
  if (planToken === 'pro') return 10;
  if (planToken === 'scale') return 15;
  return 0;
};

export const applyTokenPackDiscount = (baseAmountInr: number, discountPercent: number): number =>
  Math.max(1, Math.round(Math.max(0, Number(baseAmountInr || 0)) * (1 - (Math.max(0, Number(discountPercent || 0)) / 100))));

const CANONICAL_ENGINE_TOKENS = new Set<GenerationSettings['engine']>(['DUNO', 'VECTOR', 'PRIME']);

const normalizeEngineTokenKey = (value: unknown): string => (
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
);

export const resolveEngineToken = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const canonical = normalizeEngineTokenKey(raw);
  return CANONICAL_ENGINE_TOKENS.has(canonical as GenerationSettings['engine'])
    ? canonical
    : raw;
};

export const normalizeEngineToken = (
  value: unknown,
  fallback: GenerationSettings['engine'] = 'PRIME'
): GenerationSettings['engine'] => {
  const token = resolveEngineToken(value);
  if (token === 'DUNO' || token === 'VECTOR' || token === 'PRIME') return token;
  return fallback;
};

export const normalizeAllowedEngines = (value: unknown): GenerationSettings['engine'][] => {
  if (!Array.isArray(value)) return [];
  const out = new Set<GenerationSettings['engine']>();
  value.forEach((item) => {
    const normalized = resolveEngineToken(item);
    if (normalized === 'DUNO' || normalized === 'VECTOR' || normalized === 'PRIME') {
      out.add(normalized);
    }
  });
  return Array.from(out);
};

const cleanDubbingLine = (line: string): string => (
  String(line || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([,:;!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
);

export const runDubbingEditorTool = (
  script: string,
  mode: 'clean' | 'speakerize' | 'dedupe' | 'compact'
): string => {
  const lines = String(script || '')
    .split(/\r?\n/)
    .map((line) => cleanDubbingLine(line));

  if (mode === 'clean') {
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (mode === 'speakerize') {
    return normalizeSpeakerHeaderScript(
      lines
        .map((line) => {
          if (!line) return '';
          if (/^(?:\[[^\]\n]+\]|\([^)]*\))(?:\s+[\(\[][^\)\]]*[\)\]])?\s*:\s+/i.test(line)) {
            return line;
          }
          if (/^[^:\[\(]{1,40}(?:\s+[\(\[][^\)\]]*[\)\]])?\s*:\s+/i.test(line)) {
            const match = line.match(/^([^:\[\(]{1,40}?)(?:\s+[\(\[]([^\)\]]*)[\)\]])?\s*:\s*(.+)$/);
            if (!match) return line;
            const speaker = String(match[1] || '').trim();
            const tagBlock = String(match[2] || '').trim();
            const dialogue = String(match[3] || '').trim();
            return tagBlock
              ? `[${speaker}] (${tagBlock}): ${dialogue}`
              : `[${speaker}]: ${dialogue}`;
          }
          if (/^(?:\([^)]*\)|\[[^\]]*\])\s+/.test(line)) {
            return line.replace(/^((?:\([^)]*\)|\[[^\]]*\])\s+)/, '$1[Speaker 1]: ');
          }
          return `[Speaker 1]: ${line}`;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }

  if (mode === 'dedupe') {
    const deduped: string[] = [];
    for (const line of lines) {
      if (!line) {
        if (deduped.length > 0 && deduped[deduped.length - 1] !== '') deduped.push('');
        continue;
      }
      if (deduped.length > 0 && deduped[deduped.length - 1] === line) continue;
      deduped.push(line);
    }
    return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return lines.filter(Boolean).join('\n').trim();
};

const buildDubbingClipId = (): string => `dub_clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createDubbingClip = (file: File, objectUrl: string, durationMs: number = 0): DubbingClip => ({
  id: buildDubbingClipId(),
  file,
  objectUrl,
  durationMs: Math.max(0, Math.round(durationMs || 0)),
  trimInMs: 0,
  trimOutMs: Math.max(240, Math.round(durationMs || 0)),
  layer: 'V1',
  script: '',
  status: 'idle',
  jobId: '',
  resultUrl: null,
  reportUrl: null,
  error: '',
});

