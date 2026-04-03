import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAdminProvisioningHint } from '../src/shared/auth/adminProvisioning';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('admin provisioning hints', () => {
  it('surfaces a seed hint for an unseeded allowlisted admin login', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_LOGIN_EMAIL', 'admin1@v-flow-ai.local');

    const hint = resolveAdminProvisioningHint('admin1@v-flow-ai.local', 'auth/user-not-found');

    expect(hint).toContain('Firebase admin seed step');
  });

  it('does not hint for wrong-password failures', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_LOGIN_EMAIL', 'admin1@v-flow-ai.local');

    const hint = resolveAdminProvisioningHint('admin1@v-flow-ai.local', 'auth/wrong-password');

    expect(hint).toBeNull();
  });

  it('ignores non-admin emails', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_LOGIN_EMAIL', 'admin1@v-flow-ai.local');

    const hint = resolveAdminProvisioningHint('user@example.com', 'auth/user-not-found');

    expect(hint).toBeNull();
  });

  it('accepts the browser-safe admin allowlist envs', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST', 'admin2@v-flow-ai.local');

    const hint = resolveAdminProvisioningHint('admin2@v-flow-ai.local', 'auth/user-not-found');

    expect(hint).toContain('Firebase admin seed step');
  });
});
