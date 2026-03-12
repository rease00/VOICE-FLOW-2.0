import { describe, expect, it } from 'vitest';
import {
  getEngineCompactLabel,
  getEngineDisplayName,
  getEngineRuntimeLabel,
  getEngineRuntimeSubLabel,
  sanitizeTtsEngineText,
} from '../services/engineDisplay';

describe('engineDisplay', () => {
  it('maps all public engine names to the approved labels', () => {
    expect(getEngineDisplayName('KOKORO')).toBe('Basic');
    expect(getEngineDisplayName('NEURAL2')).toBe('Vector');
    expect(getEngineDisplayName('GEM')).toBe('Prime');
  });

  it('provides compact and runtime labels for chips and cards', () => {
    expect(getEngineCompactLabel('KOKORO')).toBe('Bas');
    expect(getEngineCompactLabel('NEURAL2')).toBe('Vec');
    expect(getEngineCompactLabel('GEM')).toBe('Pri');
    expect(getEngineRuntimeLabel('NEURAL2')).toBe('Vector Runtime');
    expect(getEngineRuntimeSubLabel('GEM')).toBe('Flagship voice engine');
  });

  it('sanitizes raw engine/runtime text into product labels', () => {
    expect(sanitizeTtsEngineText('Kokoro runtime offline')).toBe('Basic Runtime offline');
    expect(sanitizeTtsEngineText('NEURAL2 recovered')).toBe('Vector recovered');
    expect(sanitizeTtsEngineText('GEM ready')).toBe('Prime ready');
    expect(sanitizeTtsEngineText('Gemini TTS queued')).toBe('Prime voice queued');
  });
});
