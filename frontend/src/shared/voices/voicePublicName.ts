import { F5_VOICES, DUNO_VOICES, LEGACY_DUNO_VOICE_LABELS, OPENAI_VOICES, VOICES } from '../../../constants';

const normalizeVoiceToken = (value: unknown): string =>
  String(value || '').trim().toLowerCase();

const PUBLIC_VOICE_NAME_MAP = (() => {
  const out = new Map<string, string>();
  const voiceCatalog = [...VOICES, ...DUNO_VOICES, ...OPENAI_VOICES, ...F5_VOICES];
  for (const voice of voiceCatalog) {
    const label = String(voice.name || '').trim();
    if (!label) continue;
    const tokens = [voice.id, voice.geminiVoiceName, voice.name];
    for (const token of tokens) {
      const normalized = normalizeVoiceToken(token);
      if (!normalized || out.has(normalized)) continue;
      out.set(normalized, label);
    }
  }
  for (const [token, label] of Object.entries(LEGACY_DUNO_VOICE_LABELS)) {
    const normalized = normalizeVoiceToken(token);
    if (!normalized || out.has(normalized)) continue;
    out.set(normalized, label);
  }
  return out;
})();

export const resolvePublicVoiceName = (candidate: unknown): string | null => {
  const normalized = normalizeVoiceToken(candidate);
  if (!normalized) return null;
  return PUBLIC_VOICE_NAME_MAP.get(normalized) || null;
};

export const resolvePublicVoiceLabel = (...candidates: unknown[]): string | null => {
  for (const candidate of candidates) {
    const mapped = resolvePublicVoiceName(candidate);
    if (mapped) return mapped;
  }
  for (const candidate of candidates) {
    const safe = String(candidate || '').trim();
    if (safe) return safe;
  }
  return null;
};
