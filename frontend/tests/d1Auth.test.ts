import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hashPasswordForStorage,
  hashSessionToken,
  normalizeAdminSeedEmails,
  verifyPasswordHash,
} from '../src/server/auth/d1Auth';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('D1 auth helpers', () => {
  it('normalizes and deduplicates admin seed emails from both env styles', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_LOGIN_EMAIL', 'Admin1@Example.com');
    vi.stubEnv('NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST', ' admin2@example.com , ADMIN1@example.com ');
    vi.stubEnv('VITE_ADMIN_LOGIN_EMAIL', 'admin3@example.com');
    vi.stubEnv('VITE_ADMIN_EMAIL_ALLOWLIST', 'admin4@example.com');

    expect(normalizeAdminSeedEmails()).toEqual([
      'admin1@example.com',
      'admin2@example.com',
      'admin3@example.com',
      'admin4@example.com',
    ]);
  });

  it('stores passwords as salted hashes and verifies them', () => {
    const stored = hashPasswordForStorage('same-password', '00112233445566778899aabbccddeeff');

    expect(stored).toMatch(/^pbkdf2-sha256\$/);
    expect(stored).not.toContain('same-password');
    expect(verifyPasswordHash('same-password', stored)).toBe(true);
    expect(verifyPasswordHash('different-password', stored)).toBe(false);
  });

  it('hashes session tokens before persistence', () => {
    const tokenHash = hashSessionToken('raw-session-token');

    expect(tokenHash).toMatch(/^sha256\$/);
    expect(tokenHash).not.toContain('raw-session-token');
  });
});
