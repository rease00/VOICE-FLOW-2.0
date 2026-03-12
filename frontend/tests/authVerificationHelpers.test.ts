import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildEmailVerificationActionSettings,
  buildUnverifiedEmailSignInResult,
} from '../contexts/UserContext';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('auth verification helpers', () => {
  it('returns an explicit unverified-email sign-in result shape', () => {
    const result = buildUnverifiedEmailSignInResult();
    expect(result.ok).toBe(false);
    expect(result.requiresEmailVerification).toBe(true);
    expect(result.canResendVerification).toBe(true);
    expect(String(result.error || '').toLowerCase()).toContain('verify');
  });

  it('respects configured continue URL for Firebase email verification', () => {
    const configuredUrl = 'https://app.voiceflow.example/auth/complete?vf-screen=login';
    vi.stubEnv('VITE_AUTH_EMAIL_VERIFY_CONTINUE_URL', configuredUrl);
    const settings = buildEmailVerificationActionSettings();
    expect(settings?.url).toBe(configuredUrl);
    expect(settings?.handleCodeInApp).toBe(false);
  });
});
