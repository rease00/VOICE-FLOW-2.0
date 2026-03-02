import { KOKORO_VOICES, VOICES } from '../constants';
import { GenerationSettings, VoiceOption } from '../types';
import { fetchTtsEngineVoices } from '../src/shared/api/gatewayClient';

export type RuntimeVoiceCatalogMap = Record<GenerationSettings['engine'], VoiceOption[]>;

const EMPTY_CATALOG: RuntimeVoiceCatalogMap = {
  GEM: [],
  KOKORO: [],
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
  if (lower.includes('adult')) return 'Adult';
  if (lower.includes('child')) return 'Child';
  if (lower.includes('elder')) return 'Elderly';
  return value;
};

const asEngineVoice = (engine: GenerationSettings['engine'], voice: VoiceOption): VoiceOption => {
  const out: VoiceOption = {
    ...voice,
    country: voice.country || inferCountryFromAccent(voice.accent),
    ageGroup: voice.ageGroup || 'Unknown',
    engine,
  };
  return out;
};

export const getStaticVoiceFallback = (engine: GenerationSettings['engine']): VoiceOption[] => {
  if (engine === 'GEM') return VOICES.map((voice) => asEngineVoice('GEM', voice));
  return KOKORO_VOICES.map((voice) => asEngineVoice('KOKORO', voice));
};

const toVoiceOption = (
  engine: GenerationSettings['engine'],
  raw: any,
  index: number
): VoiceOption => {
  const id = String(raw.voice_id || raw.id || raw.voiceId || raw.voice || `voice_${index}`).trim();
  const name = String(raw.mapped_name || raw.name || raw.voice || raw.label || id).trim();
  const accent = String(raw.accent || raw.language || 'Unknown').trim();
  const gender = normalizeGender(raw.gender);
  const ageGroup = normalizeAgeGroup(raw.age_group || raw.ageGroup || raw.age);
  const country = String(raw.country || raw.country_code || inferCountryFromAccent(accent)).trim() || 'Unknown';
  const geminiVoiceName = String(raw.voice || raw.voice_id || raw.id || id).trim();

  const output: VoiceOption = {
    id,
    name,
    gender,
    accent,
    geminiVoiceName,
    country,
    ageGroup,
    engine,
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
  };

  try {
    entries.GEM = await fetchEngineRuntimeVoices('GEM', '');
  } catch {
    entries.GEM = getStaticVoiceFallback('GEM');
  }

  try {
    entries.KOKORO = await fetchEngineRuntimeVoices('KOKORO', '');
  } catch {
    entries.KOKORO = [];
  }

  return entries;
};
