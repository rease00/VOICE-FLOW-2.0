import { describe, expect, it } from 'vitest';

import {
  STUDIO_MUSIC_GAIN_DEFAULT,
  STUDIO_SPEECH_GAIN_DEFAULT,
  STUDIO_SPEECH_GAIN_MIN,
  resolveStudioMusicGain,
  resolveStudioSpeechGain,
} from '../services/studioMixService';

describe('studio mix gain guards', () => {
  it('prevents zero-gain speech renders from saved settings', () => {
    expect(resolveStudioSpeechGain(0)).toBe(STUDIO_SPEECH_GAIN_MIN);
    expect(resolveStudioSpeechGain(-1)).toBe(STUDIO_SPEECH_GAIN_MIN);
  });

  it('falls back to defaults for invalid gain inputs', () => {
    expect(resolveStudioSpeechGain(undefined)).toBe(STUDIO_SPEECH_GAIN_DEFAULT);
    expect(resolveStudioSpeechGain(Number.NaN)).toBe(STUDIO_SPEECH_GAIN_DEFAULT);
    expect(resolveStudioMusicGain(Number.NaN)).toBe(STUDIO_MUSIC_GAIN_DEFAULT);
  });

  it('still allows explicit zero music volume', () => {
    expect(resolveStudioMusicGain(0)).toBe(0);
    expect(resolveStudioMusicGain(2)).toBe(1);
  });
});
