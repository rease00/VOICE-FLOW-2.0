import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildEmailVerificationActionSettings,
  buildUnverifiedEmailSignInResult,
  shouldAllowFirestoreAdminRoleFallback,
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
    vi.stubEnv('NEXT_PUBLIC_AUTH_EMAIL_VERIFY_CONTINUE_URL', configuredUrl);
    const settings = buildEmailVerificationActionSettings();
    expect(settings?.url).toBe(configuredUrl);
    expect(settings?.handleCodeInApp).toBe(false);
  });

  it('requires explicit continue URL configuration in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_AUTH_EMAIL_VERIFY_CONTINUE_URL', '');
    const settings = buildEmailVerificationActionSettings();
    expect(settings).toBeUndefined();
  });

  it('rejects insecure http continue URLs in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_AUTH_EMAIL_VERIFY_CONTINUE_URL', 'http://app.voiceflow.example/auth/complete');
    const settings = buildEmailVerificationActionSettings();
    expect(settings).toBeUndefined();
  });

  it('falls back to current host login route in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_AUTH_EMAIL_VERIFY_CONTINUE_URL', '');
    const settings = buildEmailVerificationActionSettings();
    expect(settings?.url).toContain('/app/login');
    expect(settings?.url.startsWith('http://') || settings?.url.startsWith('https://')).toBe(true);
  });

  it('disables Firestore admin-role fallback in production unless explicitly enabled', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_ALLOW_FIRESTORE_ADMIN_ROLE', '');
    expect(shouldAllowFirestoreAdminRoleFallback()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ALLOW_FIRESTORE_ADMIN_ROLE', 'true');
    expect(shouldAllowFirestoreAdminRoleFallback()).toBe(true);
  });

  it('enables Firestore admin-role fallback in non-production unless explicitly disabled', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_ALLOW_FIRESTORE_ADMIN_ROLE', '');
    expect(shouldAllowFirestoreAdminRoleFallback()).toBe(true);

    vi.stubEnv('NEXT_PUBLIC_ALLOW_FIRESTORE_ADMIN_ROLE', 'false');
    expect(shouldAllowFirestoreAdminRoleFallback()).toBe(false);
  });
});
