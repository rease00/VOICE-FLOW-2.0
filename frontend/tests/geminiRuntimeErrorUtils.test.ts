import { describe, expect, it } from 'vitest';
import {
  isGeminiCapacityPressureError,
  isGeminiRetryableTimeoutError,
  isKnownGeminiPoolMisconfigError,
  shouldFailFastOnGeminiRuntimeError,
} from '../services/geminiRuntimeErrorUtils';

describe('geminiRuntimeErrorUtils', () => {
  it('treats Gemini capacity-pressure runtime failures as fail-fast errors', () => {
    const message = 'Gemini runtime synthesis failed (503): Gemini TTS capacity is saturated. Retry after about 45s.';

    expect(isGeminiCapacityPressureError(message)).toBe(true);
    expect(shouldFailFastOnGeminiRuntimeError(message)).toBe(true);
  });

  it('treats Gemini pool misconfiguration as a fail-fast error', () => {
    const message = 'Gemini runtime key pool is empty. Configure GEMINI_API_KEYS_FILE (recommended), GEMINI_API_KEYS, or GEMINI_API_KEY.';

    expect(isKnownGeminiPoolMisconfigError(message)).toBe(true);
    expect(shouldFailFastOnGeminiRuntimeError(message)).toBe(true);
  });

  it('keeps generic transient failures retryable', () => {
    const message = 'Gemini runtime synthesis failed (503): upstream gateway error';

    expect(isGeminiCapacityPressureError(message)).toBe(false);
    expect(isGeminiRetryableTimeoutError(message)).toBe(false);
    expect(shouldFailFastOnGeminiRuntimeError(message)).toBe(false);
  });

  it('classifies upstream request timeout as retryable without making it fail-fast', () => {
    const message = 'Gemini runtime synthesis failed (504): {"detail":{"errorCode":"GEMINI_UPSTREAM_REQUEST_TIMEOUT","summary":"read timed out"}}';

    expect(isGeminiRetryableTimeoutError(message)).toBe(true);
    expect(isGeminiCapacityPressureError(message)).toBe(false);
    expect(shouldFailFastOnGeminiRuntimeError(message)).toBe(false);
  });
});
