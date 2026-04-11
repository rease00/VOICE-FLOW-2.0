import { F5_VOICES, OPENAI_VOICES, VOICES } from '../../../constants';

const UNKNOWN_VOICE_LABEL = 'Unknown voice';
const LEGACY_HISTORY_VOICE_LABELS = new Set(['ai voice']);
const LEGACY_HISTORY_VOICE_ALIASES = new Map<string, string>([
  ['am_fenrir', 'Rian US'],
  ['af_heart', 'Lyra US'],
]);

const normalizeVoiceToken = (value: unknown): string => String(value || '').trim().toLowerCase();

const getMappedVoiceLabel = (value: unknown): string | null => {
  const token = normalizeVoiceToken(value);
  if (!token) return null;
  const legacyAlias = LEGACY_HISTORY_VOICE_ALIASES.get(token);
  if (legacyAlias) return legacyAlias;
  return HISTORY_VOICE_LABELS.get(token) || null;
};

const HISTORY_VOICE_LABELS = (() => {
  const out = new Map<string, string>();
  const voiceCatalog = [...VOICES, ...OPENAI_VOICES, ...F5_VOICES];
  for (const voice of voiceCatalog) {
    const label = String(voice.name || '').trim();
    if (!label) continue;
    const idToken = normalizeVoiceToken(voice.id);
    const runtimeToken = normalizeVoiceToken(voice.geminiVoiceName);
    if (idToken && !out.has(idToken)) out.set(idToken, label);
    if (runtimeToken && !out.has(runtimeToken)) out.set(runtimeToken, label);
  }
  return out;
})();

export const resolveHistoryVoiceLabel = (input: { voiceName?: unknown; voiceId?: unknown }): string => {
  const mappedFromVoiceId = getMappedVoiceLabel(input.voiceId);
  if (mappedFromVoiceId) {
    return mappedFromVoiceId;
  }

  const rawVoiceName = String(input.voiceName || '').trim();
  if (rawVoiceName) {
    const mappedFromVoiceName = getMappedVoiceLabel(rawVoiceName);
    if (mappedFromVoiceName) {
      return mappedFromVoiceName;
    }
    if (!LEGACY_HISTORY_VOICE_LABELS.has(rawVoiceName.toLowerCase())) {
      return rawVoiceName;
    }
  }

  const rawVoiceId = String(input.voiceId || '').trim();
  if (rawVoiceId) {
    return rawVoiceId;
  }

  return UNKNOWN_VOICE_LABEL;
};
