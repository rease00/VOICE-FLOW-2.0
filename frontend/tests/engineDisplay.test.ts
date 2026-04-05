import { describe, expect, it } from 'vitest';
import {
  getEngineCompactLabel,
  getEngineDisplayName,
  getEngineRuntimeLabel,
  getEngineRuntimeSubLabel,
  sanitizeTtsEngineText,
} from '../services/engineDisplay';

describe('engineDisplay', () => {
  it('maps all public engine names to canonical labels', () => {
    expect(getEngineDisplayName('VECTOR')).toBe('Vector');
    expect(getEngineDisplayName('PRIME')).toBe('Prime');
  });

  it('uses canonical labels in compact and runtime helpers', () => {
    expect(getEngineCompactLabel('VECTOR')).toBe('Vector');
    expect(getEngineCompactLabel('PRIME')).toBe('Prime');
    expect(getEngineRuntimeLabel('VECTOR')).toBe('Vector Runtime');
    expect(getEngineRuntimeLabel('PRIME')).toBe('Prime Runtime');
    expect(getEngineRuntimeSubLabel('VECTOR')).toBe('Vector voice engine');
    expect(getEngineRuntimeSubLabel('PRIME')).toBe('Prime voice engine');
  });

  it('sanitizes engine text into canonical labels', () => {
    expect(sanitizeTtsEngineText('Vector runtime offline')).toBe('Vector Runtime offline');
    expect(sanitizeTtsEngineText('VECTOR recovered')).toBe('Vector recovered');
    expect(sanitizeTtsEngineText('PRIME ready')).toBe('Prime ready');
    expect(sanitizeTtsEngineText('Gemini TTS queued')).toBe('Gemini TTS queued');
  });
});
