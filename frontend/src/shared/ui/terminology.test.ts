import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROVIDER_UI_LABELS, joinUiFragments, sanitizeUiText } from './terminology';

describe('sanitizeUiText', () => {
  it('keeps assistant-provider copy neutral while productizing engine names', () => {
    expect(sanitizeUiText('Gemini failed; DUNO offline.')).toBe('Primary AI failed; DUNO offline.');
    expect(sanitizeUiText('VECTOR fallback engaged.')).toBe('VECTOR fallback engaged.');
    expect(sanitizeUiText('PRIME ready.')).toBe('PRIME ready.');
  });

  it('replaces runtime and slot-set phrases', () => {
    expect(sanitizeUiText('Gemini runtime slot set is empty.')).toBe('Primary AI runtime slot set is empty.');
    expect(sanitizeUiText('Loading Gemini pool status...')).toBe('Loading Primary AI slot set status...');
    expect(sanitizeUiText('DUNO Runtime ready')).toBe('DUNO Runtime ready');
    expect(sanitizeUiText('VECTOR runtime online')).toBe('VECTOR Runtime online');
  });

  it('is case-insensitive for supported provider phrases', () => {
    expect(sanitizeUiText('GEMINI API KEY missing')).toBe('Primary AI API key missing');
    expect(sanitizeUiText('DUNO RUNTIME')).toBe('DUNO Runtime');
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
    expect(joinUiFragments(['Gemini ready', null, 'DUNO offline'])).toBe('Primary AI ready | DUNO offline');
  });
});