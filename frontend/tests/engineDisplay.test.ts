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
    expect(getEngineDisplayName('DUNO')).toBe('Duno');
    expect(getEngineDisplayName('VECTOR')).toBe('Vector');
    expect(getEngineDisplayName('PRIME')).toBe('Prime');
  });

  it('uses canonical labels in compact and runtime helpers', () => {
    expect(getEngineCompactLabel('DUNO')).toBe('Duno');
    expect(getEngineCompactLabel('VECTOR')).toBe('Vector');
    expect(getEngineCompactLabel('PRIME')).toBe('Prime');
    expect(getEngineRuntimeLabel('DUNO')).toBe('Duno Runtime');
    expect(getEngineRuntimeLabel('VECTOR')).toBe('Vector Runtime');
    expect(getEngineRuntimeLabel('PRIME')).toBe('Prime Runtime');
    expect(getEngineRuntimeSubLabel('DUNO')).toBe('Duno voice engine');
    expect(getEngineRuntimeSubLabel('PRIME')).toBe('Prime voice engine');
  });

  it('sanitizes engine text into canonical labels', () => {
    expect(sanitizeTtsEngineText('DUNO runtime offline')).toBe('Duno Runtime offline');
    expect(sanitizeTtsEngineText('VECTOR recovered')).toBe('Vector recovered');
    expect(sanitizeTtsEngineText('PRIME ready')).toBe('Prime ready');
    expect(sanitizeTtsEngineText('Gemini TTS queued')).toBe('Gemini TTS queued');
  });
});
