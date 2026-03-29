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
    expect(getEngineDisplayName('DUNO')).toBe('DUNO');
    expect(getEngineDisplayName('VECTOR')).toBe('VECTOR');
    expect(getEngineDisplayName('PRIME')).toBe('PRIME');
  });

  it('uses canonical labels in compact and runtime helpers', () => {
    expect(getEngineCompactLabel('DUNO')).toBe('DUNO');
    expect(getEngineCompactLabel('VECTOR')).toBe('VECTOR');
    expect(getEngineCompactLabel('PRIME')).toBe('PRIME');
    expect(getEngineRuntimeLabel('DUNO')).toBe('DUNO Runtime');
    expect(getEngineRuntimeLabel('VECTOR')).toBe('VECTOR Runtime');
    expect(getEngineRuntimeLabel('PRIME')).toBe('PRIME Runtime');
    expect(getEngineRuntimeSubLabel('DUNO')).toBe('DUNO voice engine');
    expect(getEngineRuntimeSubLabel('PRIME')).toBe('PRIME voice engine');
  });

  it('sanitizes engine text into canonical labels', () => {
    expect(sanitizeTtsEngineText('DUNO runtime offline')).toBe('DUNO Runtime offline');
    expect(sanitizeTtsEngineText('VECTOR recovered')).toBe('VECTOR recovered');
    expect(sanitizeTtsEngineText('PRIME ready')).toBe('PRIME ready');
    expect(sanitizeTtsEngineText('Gemini TTS queued')).toBe('Gemini TTS queued');
  });
});
