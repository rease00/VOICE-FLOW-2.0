import { KOKORO_VOICES, VOICES } from '../constants';
import { GenerationSettings, VoiceOption } from '../types';

export type RuntimeVoiceCatalogMap = Record<GenerationSettings['engine'], VoiceOption[]>;

const EMPTY_CATALOG: RuntimeVoiceCatalogMap = {
  GEM: [],
  KOKORO: [],
};

const normalizeUrl = (url?: string): string => (url || '').trim().replace(/\/+$/, '');

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

const fetchJson = async (url: string, timeoutMs: number): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${response.status}: ${detail}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
};

const asEngineVoice = (engine: GenerationSettings['engine'], voice: VoiceOption): VoiceOption => ({
  ...voice,
  country: voice.country || inferCountryFromAccent(voice.accent),
  ageGroup: voice.ageGroup || 'Unknown',
  engine,
});

export const getStaticVoiceFallback = (engine: GenerationSettings['engine']): VoiceOption[] => {
  if (engine === 'GEM') return VOICES.map((voice) => asEngineVoice('GEM', voice));
  return KOKORO_VOICES.map((voice) => asEngineVoice('KOKORO', voice));
};

const toVoiceOption = (
  engine: GenerationSettings['engine'],
  raw: Record<string, any>,
  index: number
): VoiceOption => {
  const id = String(raw.voice_id || raw.id || raw.voiceId || raw.voice || `voice_${index}`).trim();
  const name = String(raw.name || raw.voice || raw.label || id).trim();
  const accent = String(raw.accent || raw.language || 'Unknown').trim();
  const gender = normalizeGender(raw.gender);
  const ageGroup = normalizeAgeGroup(raw.age_group || raw.ageGroup || raw.age);
  const country = String(raw.country || raw.country_code || inferCountryFromAccent(accent)).trim() || 'Unknown';
  const geminiVoiceName = String(raw.voice || raw.voice_id || raw.id || id).trim();

  return {
    id,
    name,
    gender,
    accent,
    geminiVoiceName,
    country,
    ageGroup,
    engine,
    source: typeof raw.source === 'string' ? raw.source : undefined,
    isDownloaded: typeof raw.is_downloaded === 'boolean' ? raw.is_downloaded : undefined,
  };
};

export const fetchEngineRuntimeVoices = async (
  engine: GenerationSettings['engine'],
  runtimeUrl: string,
  timeoutMs: number = 7000
): Promise<VoiceOption[]> => {
  if (engine === 'GEM') {
    return getStaticVoiceFallback('GEM');
  }

  const baseUrl = normalizeUrl(runtimeUrl);
  if (!baseUrl) return [];

  const payload = await fetchJson(`${baseUrl}/v1/voices`, timeoutMs);
  const voices = Array.isArray(payload?.voices) ? payload.voices : [];
  return voices.map((voice: Record<string, any>, index: number) => toVoiceOption(engine, voice, index));
};

export const fetchRuntimeVoiceRegistry = async (
  runtimeUrls: Partial<Record<GenerationSettings['engine'], string>>,
  timeoutMs: number = 7000
): Promise<RuntimeVoiceCatalogMap> => {
  const entries: RuntimeVoiceCatalogMap = {
    ...EMPTY_CATALOG,
    GEM: getStaticVoiceFallback('GEM'),
  };

  const engines: GenerationSettings['engine'][] = ['KOKORO'];
  await Promise.all(
    engines.map(async (engine) => {
      const url = runtimeUrls[engine];
      if (!url) return;
      try {
        entries[engine] = await fetchEngineRuntimeVoices(engine, url, timeoutMs);
      } catch {
        entries[engine] = [];
      }
    })
  );

  return entries;
};
