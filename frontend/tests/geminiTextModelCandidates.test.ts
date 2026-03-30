import { describe, expect, it } from 'vitest';
import {
  resolveRuntimeTextModelCandidates,
  resolveTextModelCandidates,
  RUNTIME_TEXT_MODELS_FALLBACK,
  TEXT_MODELS_FALLBACK,
} from '../services/geminiService';

describe('gemini runtime text model candidates', () => {
  it('keeps the default backend-safe text fallback list intact', () => {
    expect(resolveRuntimeTextModelCandidates()).toEqual(RUNTIME_TEXT_MODELS_FALLBACK);
  });

  it('drops invalid model candidates and preserves only backend-safe entries', () => {
    expect(
      resolveRuntimeTextModelCandidates([
        'not-a-real-model',
        'gemini-2.5-flash',
        'models/gemini-2.5-pro',
        'gemini-3-flash-preview',
      ])
    ).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-3-flash-preview',
    ]);
  });

  it('omits the runtime override when every requested model is invalid', () => {
    expect(resolveRuntimeTextModelCandidates(['invalid-model', 'still-invalid'])).toBeUndefined();
  });

  it('keeps the broad assistant resolver behavior unchanged for non-runtime callers', () => {
    expect(resolveTextModelCandidates(['invalid-model', 'gemini-2.5-flash'])).toEqual([
      'invalid-model',
      'gemini-2.5-flash',
    ]);
  });
});
