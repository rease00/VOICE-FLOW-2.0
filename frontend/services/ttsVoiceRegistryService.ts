import { KOKORO_VOICES, VOICES } from '../constants';
import { GenerationSettings, VoiceOption } from '../types';
import { fetchTtsEngineVoices } from '../src/shared/api/gatewayClient';

export type RuntimeVoiceCatalogMap = Record<GenerationSettings['engine'], VoiceOption[]>;

const EMPTY_CATALOG: RuntimeVoiceCatalogMap = {
  GEM: [],
  NEURAL2: [],
  KOKORO: [],
};

const FREE_TIER_ALLOWED_VOICE_IDS: Record<GenerationSettings['engine'], string[]> = {
  GEM: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  NEURAL2: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  KOKORO: [
    'af_heart',
    'af_bella',
    'af_nova',
    'af_sarah',
    'am_fenrir',
    'am_michael',
    'am_onyx',
    'am_echo',
    'bf_emma',
    'bf_isabella',
    'bm_george',
    'bm_fable',
    'hf_alpha',
    'hf_beta',
    'hm_omega',
    'hm_psi',
  ],
};

const KOKORO_VOICE_INDEX = new Map(
  KOKORO_VOICES.map((voice) => [String(voice.id || '').trim().toLowerCase(), voice] as const)
);

const inferCountryFromAccent = (accent?: string): string => {
  const value = String(accent || '').toLowerCase();
  if (!value) return 'Unknown';
  if (value.includes('india')) return 'India';
  if (value.includes('united states') || value.includes('american')) return 'United States';
  if (
    value.includes('england') ||
    value.includes('british') ||
    value.includes('scottish') ||
    value.includes('northern irish') ||
    value.includes('united kingdom')
  ) {
    return 'United Kingdom';
  }
  if (value.includes('canadian') || value.includes('canada')) return 'Canada';
  if (value.includes('australian') || value.includes('australia')) return 'Australia';
  if (value.includes('irish') || value.includes('ireland')) return 'Ireland';
  return 'Unknown';
};

const normalizeGender = (raw: unknown): VoiceOption['gender'] => {
  const value = String(raw || '').toLowerCase();
  if (value.includes('female')) return 'Female';
  if (value.includes('male')) return 'Male';
  return 'Unknown';
};

const normalizeAgeGroup = (raw: unknown): string => {
  const value = String(raw || '').trim();
  if (!value) return 'Unknown';
  const lower = value.toLowerCase();
  if (lower.includes('young')) return 'Young Adult';
  if (
    lower.includes('child') ||
    lower.includes('kid') ||
    lower.includes('boy') ||
    lower.includes('girl') ||
    lower.includes('teen')
  ) {
    return 'Child';
  }
  if (
    lower.includes('elder') ||
    lower.includes('old') ||
    lower.includes('senior') ||
    lower.includes('aged') ||
    lower.includes('grand')
  ) {
    return 'Elderly';
  }
  if (lower.includes('adult')) return 'Adult';
  return value;
};

const asEngineVoice = (engine: GenerationSettings['engine'], voice: VoiceOption): VoiceOption => {
  const allowlist = new Set((FREE_TIER_ALLOWED_VOICE_IDS[engine] || []).map((token) => String(token || '').trim().toLowerCase()));
  const explicitTier = String(voice.accessTier || '').trim().toLowerCase();
  const accessTier: 'free' | 'pro' =
    explicitTier === 'free'
      ? 'free'
      : explicitTier === 'pro'
        ? 'pro'
        : (allowlist.has(String(voice.id || '').trim().toLowerCase()) ? 'free' : 'pro');
  const out: VoiceOption = {
    ...voice,
    country: voice.country || inferCountryFromAccent(voice.accent),
    ageGroup: voice.ageGroup || 'Unknown',
    engine,
    accessTier,
    isPlanRestricted: typeof voice.isPlanRestricted === 'boolean' ? voice.isPlanRestricted : accessTier === 'pro',
  };
  return out;
};

export const getStaticVoiceFallback = (engine: GenerationSettings['engine']): VoiceOption[] => {
  if (engine === 'GEM' || engine === 'NEURAL2') {
    return VOICES.map((voice) => asEngineVoice(engine, voice));
  }
  return KOKORO_VOICES.map((voice) => asEngineVoice('KOKORO', voice));
};

const toVoiceOption = (
  engine: GenerationSettings['engine'],
  raw: any,
  index: number
): VoiceOption => {
  const id = String(raw.voice_id || raw.id || raw.voiceId || raw.voice || `voice_${index}`).trim();
  const kokoroCanonical = engine === 'KOKORO' ? KOKORO_VOICE_INDEX.get(id.toLowerCase()) : undefined;
  const name = String(
    kokoroCanonical?.name
    || raw.mapped_name
    || raw.name
    || raw.voice
    || raw.label
    || id
  ).trim();
  const accent = String(kokoroCanonical?.accent || raw.accent || raw.language || 'Unknown').trim();
  const gender = kokoroCanonical?.gender || normalizeGender(raw.gender);
  const ageGroup = String(kokoroCanonical?.ageGroup || normalizeAgeGroup(raw.age_group || raw.ageGroup || raw.age)).trim() || 'Unknown';
  const country = String(
    kokoroCanonical?.country
    || raw.country
    || raw.country_code
    || inferCountryFromAccent(accent)
  ).trim() || 'Unknown';
  const geminiVoiceName = String(kokoroCanonical?.geminiVoiceName || raw.voice || raw.voice_id || raw.id || id).trim();
  const explicitTier = String(raw.access_tier || raw.accessTier || '').trim().toLowerCase();
  const allowlist = new Set((FREE_TIER_ALLOWED_VOICE_IDS[engine] || []).map((token) => String(token || '').trim().toLowerCase()));
  const accessTier: 'free' | 'pro' =
    explicitTier === 'free'
      ? 'free'
      : explicitTier === 'pro'
        ? 'pro'
        : (allowlist.has(id.toLowerCase()) ? 'free' : 'pro');

  const output: VoiceOption = {
    id,
    name,
    gender,
    accent,
    geminiVoiceName,
    country,
    ageGroup,
    engine,
    accessTier,
    isPlanRestricted: typeof raw.is_plan_restricted === 'boolean' ? raw.is_plan_restricted : accessTier === 'pro',
  };
  if (typeof raw.source === 'string') {
    output.source = raw.source;
  }
  if (typeof raw.is_downloaded === 'boolean') {
    output.isDownloaded = raw.is_downloaded;
  } else if (typeof raw.reference_exists === 'boolean') {
    output.isDownloaded = raw.reference_exists;
  }
  if (typeof raw.preview_url === 'string' && raw.preview_url.trim()) {
    output.previewUrl = raw.preview_url.trim();
  }
  if (!output.source && typeof raw.reference_path === 'string' && raw.reference_path.trim()) {
    output.source = raw.reference_path.trim();
  }
  return output;
};

export const fetchEngineRuntimeVoices = async (
  engine: GenerationSettings['engine'],
  _runtimeUrl: string,
  _timeoutMs: number = 7000
): Promise<VoiceOption[]> => {
  const payload = await fetchTtsEngineVoices(engine);
  const voices = Array.isArray(payload?.voices) ? payload.voices : [];
  return voices.map((voice, index: number) => toVoiceOption(engine, voice, index));
};

export const fetchRuntimeVoiceRegistry = async (
  _runtimeUrls: Partial<Record<GenerationSettings['engine'], string>>,
  _timeoutMs: number = 7000
): Promise<RuntimeVoiceCatalogMap> => {
  const entries: RuntimeVoiceCatalogMap = {
    ...EMPTY_CATALOG,
    GEM: [],
    NEURAL2: [],
  };

  try {
    entries.GEM = await fetchEngineRuntimeVoices('GEM', '');
  } catch {
    entries.GEM = getStaticVoiceFallback('GEM');
  }
  entries.NEURAL2 = entries.GEM.map((voice) => ({ ...voice, engine: 'NEURAL2' }));

  try {
    entries.KOKORO = await fetchEngineRuntimeVoices('KOKORO', '');
  } catch {
    entries.KOKORO = [];
  }

  return entries;
};
