export const STUDIO_SPEECH_GAIN_DEFAULT = 1.0;
export const STUDIO_SPEECH_GAIN_MIN = 0.05;
export const STUDIO_SPEECH_GAIN_MAX = 1.5;
export const STUDIO_MUSIC_GAIN_DEFAULT = 0.3;
export const STUDIO_MUSIC_GAIN_MIN = 0;
export const STUDIO_MUSIC_GAIN_MAX = 1;

const clampFiniteNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

export const resolveStudioSpeechGain = (value: unknown): number => (
  clampFiniteNumber(value, STUDIO_SPEECH_GAIN_MIN, STUDIO_SPEECH_GAIN_MAX, STUDIO_SPEECH_GAIN_DEFAULT)
);

export const resolveStudioMusicGain = (value: unknown): number => (
  clampFiniteNumber(value, STUDIO_MUSIC_GAIN_MIN, STUDIO_MUSIC_GAIN_MAX, STUDIO_MUSIC_GAIN_DEFAULT)
);
