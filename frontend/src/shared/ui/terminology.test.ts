import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROVIDER_UI_LABELS, sanitizeUiText } from './terminology';

describe('sanitizeUiText', () => {
  it('replaces direct provider names', () => {
    expect(sanitizeUiText('Gemini failed; Kokoro offline.')).toBe('Primary AI failed; Basic offline.');
  });

  it('replaces runtime and key pool phrases', () => {
    expect(sanitizeUiText('Gemini runtime key pool is empty.')).toBe('Cloud runtime key pool is empty.');
    expect(sanitizeUiText('Loading Gemini pool status...')).toBe('Loading Primary AI pool status...');
    expect(sanitizeUiText('Kokoro Runtime ready')).toBe('Basic runtime ready');
  });

  it('is case-insensitive', () => {
    expect(sanitizeUiText('GEMINI API KEY missing')).toBe('Primary AI API key missing');
    expect(sanitizeUiText('KOKORO RUNTIME')).toBe('Basic runtime');
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
