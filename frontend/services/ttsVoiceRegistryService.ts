import { VOICES } from '../constants';
import { ActiveTtsEngineKey, GenerationSettings, VoiceOption } from '../types';
import { getEngineDisplayName } from './engineDisplay';
import { fetchTtsEngineVoices } from '../src/shared/api/gatewayClient';

const normalizeActiveEngine = (engine: GenerationSettings['engine']): ActiveTtsEngineKey =>
  engine === 'PRIME' ? 'PRIME' : 'VECTOR';

export type RuntimeVoiceCatalogMap = Record<ActiveTtsEngineKey, VoiceOption[]>;

const EMPTY_CATALOG: RuntimeVoiceCatalogMap = {
  PRIME: [],
  VECTOR: [],
};

const FREE_TIER_ALLOWED_VOICE_IDS: Record<ActiveTtsEngineKey, string[]> = {
  PRIME: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  VECTOR: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
};

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
  const canonicalEngine = normalizeActiveEngine(engine);
  const allowlist = new Set((FREE_TIER_ALLOWED_VOICE_IDS[canonicalEngine] || []).map((token) => String(token || '').trim().toLowerCase()));
  const explicitTier = String(voice.accessTier || '').trim().toLowerCase();
  const accessTier: 'free' | 'pro' =
    explicitTier === 'free'
      ? 'free'
      : explicitTier === 'pro'
        ? 'pro'
        : (allowlist.has(String(voice.id || '').trim().toLowerCase()) ? 'free' : 'pro');
  return {
    ...voice,
    country: voice.country || inferCountryFromAccent(voice.accent),
    ageGroup: voice.ageGroup || 'Unknown',
    engine: canonicalEngine,
    accessTier,
    isPlanRestricted: typeof voice.isPlanRestricted === 'boolean' ? voice.isPlanRestricted : accessTier === 'pro',
  };
};

export const getStaticVoiceFallback = (engine: GenerationSettings['engine']): VoiceOption[] => {
  return VOICES.map((voice) => asEngineVoice(engine, voice));
};

const toVoiceOption = (
  engine: GenerationSettings['engine'],
  raw: any,
  index: number
): VoiceOption => {
  const canonicalEngine = normalizeActiveEngine(engine);
  const id = String(raw.voice_id || raw.id || raw.voiceId || raw.voice || `voice_${index}`).trim();
  const runtimeVoiceName = String(raw.voice || raw.runtimeVoice || raw.voiceName || raw.voice_id || raw.id || '').trim();
  const mappedDisplayName = String(
    raw.displayName
    || raw.display_name
    || raw.mapped_name
    || raw.name
    || raw.label
  ).trim();
  const name = String(
    mappedDisplayName
    || runtimeVoiceName
    || id
  ).trim();
  const accent = String(raw.accent || raw.language || 'Unknown').trim();
  const gender = normalizeGender(raw.gender);
  const ageGroup = String(normalizeAgeGroup(raw.age_group || raw.ageGroup || raw.age)).trim() || 'Unknown';
  const country = String(
    raw.country
    || raw.country_code
    || inferCountryFromAccent(accent)
  ).trim() || 'Unknown';
  const geminiVoiceName = String(raw.voice || raw.voice_id || raw.id || id).trim();
  const explicitTier = String(raw.access_tier || raw.accessTier || '').trim().toLowerCase();
  const allowlist = new Set((FREE_TIER_ALLOWED_VOICE_IDS[canonicalEngine] || []).map((token) => String(token || '').trim().toLowerCase()));
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
    engine: canonicalEngine,
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
  const canonicalEngine = normalizeActiveEngine(engine);
  const payload = await fetchTtsEngineVoices(canonicalEngine);
  const voices = Array.isArray(payload?.voices) ? payload.voices : [];
  return voices.map((voice, index: number) => toVoiceOption(canonicalEngine, voice, index));
};

export const fetchRuntimeVoiceRegistry = async (
  _runtimeUrls: Partial<Record<ActiveTtsEngineKey, string>>,
  _timeoutMs: number = 7000
): Promise<RuntimeVoiceCatalogMap> => {
  const entries: RuntimeVoiceCatalogMap = {
    ...EMPTY_CATALOG,
  };

  try {
    entries.PRIME = await fetchEngineRuntimeVoices('PRIME', '');
  } catch {
    entries.PRIME = getStaticVoiceFallback('PRIME');
  }

  try {
    entries.VECTOR = await fetchEngineRuntimeVoices('VECTOR', '');
  } catch {
    entries.VECTOR = entries.PRIME.map((voice) => ({ ...voice, engine: 'VECTOR' }));
  }

  return entries;
};
