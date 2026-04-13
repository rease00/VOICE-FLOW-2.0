export type ActiveTtsEngineKey = 'PRIME' | 'VECTOR';

export interface EngineAutoSelectResult {
  engine: ActiveTtsEngineKey;
  reason: string;
}

const ENGINE_PREFERENCE_STORAGE_KEY = 'vf_engine_preference';

const detectScriptLanguage = (text: string): string => {
  const sample = text.slice(0, 500);
  const devanagari = /[\u0900-\u097F]/.test(sample);
  const cjk = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(sample);
  const arabic = /[\u0600-\u06FF]/.test(sample);
  const cyrillic = /[\u0400-\u04FF]/.test(sample);
  if (devanagari) return 'hi';
  if (cjk) return 'ja';
  if (arabic) return 'ar';
  if (cyrillic) return 'ru';
  return 'en';
};

const countSpeakers = (text: string): number => {
  const speakerPattern = /^[\s]*\[?([A-Z][A-Za-z\s]{1,30})\]?\s*:/gm;
  const speakers = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = speakerPattern.exec(text)) !== null) {
    if (match[1]) speakers.add(match[1].trim().toLowerCase());
  }
  return speakers.size;
};

export const resolveEngineAutoSelect = (
  text: string,
  _currentEngine?: ActiveTtsEngineKey
): EngineAutoSelectResult | null => {
  if (!text.trim()) return null;

  const charCount = text.length;
  const speakerCount = countSpeakers(text);
  const lang = detectScriptLanguage(text);

  if (speakerCount > 1 && charCount > 2000) {
    return {
      engine: 'PRIME',
      reason: `Multi-speaker script (${speakerCount} speakers) - PRIME recommended for best voice separation.`,
    };
  }

  if (lang !== 'en' && charCount > 1500) {
    return {
      engine: 'PRIME',
      reason: 'Non-English script detected - PRIME provides better language fidelity.',
    };
  }

  if (charCount > 5000) {
    return {
      engine: 'PRIME',
      reason: 'Long script - PRIME recommended for consistent quality over extended text.',
    };
  }

  if (speakerCount <= 1 && charCount < 1000) {
    return {
      engine: 'VECTOR',
      reason: 'Short single-speaker text - VECTOR is fast and efficient.',
    };
  }

  return null;
};

export const saveEnginePreference = (engine: ActiveTtsEngineKey, mode: 'single' | 'multi'): void => {
  try {
    localStorage.setItem(
      ENGINE_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ engine, mode, savedAt: Date.now() })
    );
  } catch {}
};

export const loadEnginePreference = (mode: 'single' | 'multi'): ActiveTtsEngineKey | null => {
  try {
    const raw = localStorage.getItem(ENGINE_PREFERENCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.mode === mode && (parsed?.engine === 'PRIME' || parsed?.engine === 'VECTOR')) {
      return parsed.engine;
    }
    return null;
  } catch {
    return null;
  }
};

export const autoSelectVoice = (
  text: string,
  settings: {
    language: string;
    voiceId?: string;
    speakerMapping?: Record<string, string>;
  },
  availableVoices: Array<{ id: string; name: string; language: string }>
): { voiceId: string; reason: string } => {
  const lang = settings.language.toLowerCase();
  const scriptLanguage = detectScriptLanguage(text) || lang;

  if (settings.voiceId) {
    return { voiceId: settings.voiceId, reason: 'User-selected voice' };
  }

  const voice = availableVoices.find((item) => item.language.toLowerCase() === scriptLanguage);
  if (voice) {
    return { voiceId: voice.id, reason: `Auto-assigned ${scriptLanguage} voice` };
  }

  const fallbackVoice = availableVoices[0];
  if (fallbackVoice) {
    return { voiceId: fallbackVoice.id, reason: 'Fallback voice' };
  }

  return { voiceId: 'v1', reason: 'Default voice' };
};
