export const TTS_VOICE_CONVERSION_FALLBACK_EVENT = 'voiceflow:tts-voice-conversion-fallback';

export interface TtsVoiceConversionFallbackDetail {
  voiceId: string;
  voiceName?: string;
  engine?: string;
  traceId?: string;
  error: string;
}
