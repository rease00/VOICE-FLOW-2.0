import { describe, expect, it } from 'vitest';

import {
  normalizeSynthesisRequest,
  normalizeTtsLanguageCode,
} from '../services/synthesisContractService';

describe('normalizeTtsLanguageCode', () => {
  it('upgrades short English and Hindi tags to provider-safe defaults', () => {
    expect(normalizeTtsLanguageCode('en')).toBe('en-US');
    expect(normalizeTtsLanguageCode('hi')).toBe('hi-IN');
    expect(normalizeTtsLanguageCode('hi-latn')).toBe('hi-IN');
  });

  it('preserves explicit region tags with canonical casing', () => {
    expect(normalizeTtsLanguageCode('en-gb')).toBe('en-GB');
    expect(normalizeTtsLanguageCode('pt_br')).toBe('pt-BR');
  });
});

describe('normalizeSynthesisRequest', () => {
  it('emits provider-safe language tags for queued TTS jobs', () => {
    const normalized = normalizeSynthesisRequest({
      engine: 'VECTOR',
      text: 'Hello world',
      voiceId: 'Algieba',
      language: 'en',
      speed: 1,
    });

    expect(normalized.language).toBe('en-US');
    expect(normalized.voice_id).toBe('Algieba');
  });
});
