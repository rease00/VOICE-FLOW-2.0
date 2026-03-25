import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROVIDER_UI_LABELS, joinUiFragments, sanitizeUiText } from './terminology';

describe('sanitizeUiText', () => {
  it('keeps assistant-provider copy neutral while productizing engine names', () => {
    expect(sanitizeUiText('Gemini failed; Kokoro offline.')).toBe('Primary AI failed; Basic offline.');
    expect(sanitizeUiText('NEURAL2 fallback engaged.')).toBe('Vector fallback engaged.');
    expect(sanitizeUiText('GEM ready.')).toBe('Prime ready.');
  });

  it('replaces runtime and slot-set phrases', () => {
    expect(sanitizeUiText('Gemini runtime slot set is empty.')).toBe('Prime Runtime slot set is empty.');
    expect(sanitizeUiText('Loading Gemini pool status...')).toBe('Loading Primary AI slot set status...');
    expect(sanitizeUiText('Kokoro Runtime ready')).toBe('Basic Runtime ready');
    expect(sanitizeUiText('Neural2 runtime online')).toBe('Vector Runtime online');
  });

  it('is case-insensitive for supported provider phrases', () => {
    expect(sanitizeUiText('GEMINI API KEY missing')).toBe('Primary AI API key missing');
    expect(sanitizeUiText('KOKORO RUNTIME')).toBe('Basic Runtime');
  });

  it('keeps unrelated text unchanged', () => {
    expect(sanitizeUiText('Runtime online.')).toBe('Runtime online.');
  });
});

describe('ASSISTANT_PROVIDER_UI_LABELS', () => {
  it('maps provider labels for UI', () => {
    expect(ASSISTANT_PROVIDER_UI_LABELS.GEMINI).toBe('Primary AI');
    expect(ASSISTANT_PROVIDER_UI_LABELS.PERPLEXITY).toBe('Perplexity');
    expect(ASSISTANT_PROVIDER_UI_LABELS.LOCAL).toBe('Local');
  });
});

describe('joinUiFragments', () => {
  it('joins truthy fragments with a normalized separator', () => {
    expect(joinUiFragments(['Ready', '', '32% complete'])).toBe('Ready | 32% complete');
    expect(joinUiFragments(['Gemini ready', null, 'Kokoro offline'])).toBe('Primary AI ready | Basic offline');
  });
});
