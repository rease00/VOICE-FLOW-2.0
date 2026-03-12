import { resolvePublicVoiceLabel, resolvePublicVoiceName } from './voicePublicName';

const UNKNOWN_VOICE_LABEL = 'Unknown voice';
const LEGACY_HISTORY_VOICE_LABELS = new Set(['ai voice']);

export const resolveHistoryVoiceLabel = (input: { voiceName?: unknown; voiceId?: unknown }): string => {
  const rawVoiceName = String(input.voiceName || '').trim();
  if (rawVoiceName && !LEGACY_HISTORY_VOICE_LABELS.has(rawVoiceName.toLowerCase())) {
    return resolvePublicVoiceName(rawVoiceName) || rawVoiceName;
  }

  const rawVoiceId = String(input.voiceId || '').trim();
  if (rawVoiceId) {
    return String(resolvePublicVoiceLabel(rawVoiceId) || rawVoiceId).trim() || UNKNOWN_VOICE_LABEL;
  }

  return UNKNOWN_VOICE_LABEL;
};
