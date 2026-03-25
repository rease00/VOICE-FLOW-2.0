import { F5_VOICES, KOKORO_VOICES, OPENAI_VOICES, VOICES } from '../../../constants';

const UNKNOWN_VOICE_LABEL = 'Unknown voice';
const LEGACY_HISTORY_VOICE_LABELS = new Set(['ai voice']);

const normalizeVoiceToken = (value: unknown): string => String(value || '').trim().toLowerCase();

const HISTORY_VOICE_LABELS = (() => {
  const out = new Map<string, string>();
  const voiceCatalog = [...VOICES, ...KOKORO_VOICES, ...OPENAI_VOICES, ...F5_VOICES];
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
  const rawVoiceName = String(input.voiceName || '').trim();
  if (rawVoiceName && !LEGACY_HISTORY_VOICE_LABELS.has(rawVoiceName.toLowerCase())) {
    return rawVoiceName;
  }

  const rawVoiceId = String(input.voiceId || '').trim();
  if (rawVoiceId) {
    const mappedLabel = HISTORY_VOICE_LABELS.get(normalizeVoiceToken(rawVoiceId));
    return String(mappedLabel || rawVoiceId).trim() || UNKNOWN_VOICE_LABEL;
  }

  return UNKNOWN_VOICE_LABEL;
};
