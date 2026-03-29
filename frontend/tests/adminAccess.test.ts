import { describe, expect, it } from 'vitest';

import { hasActiveAdminActor, hasAdminConsoleAccess } from '../src/shared/auth/adminAccess';

describe('admin access hardening', () => {
  it('rejects disabled admin actors', () => {
    expect(
      hasActiveAdminActor({
        role: 'super_admin',
        status: 'disabled',
        permissions: ['billing.read'],
      })
    ).toBe(false);
    expect(
      hasAdminConsoleAccess({
        isAdmin: true,
        adminActor: {
          role: 'super_admin',
          status: 'disabled',
          permissions: ['billing.read'],
        },
      })
    ).toBe(false);
  });

  it('rejects admin actors without permissions', () => {
    expect(
      hasActiveAdminActor({
        role: 'super_admin',
        status: 'active',
        permissions: [],
      })
    ).toBe(false);
    expect(
      hasAdminConsoleAccess({
        isAdmin: true,
        adminActor: {
          role: 'super_admin',
          status: 'active',
          permissions: [],
        },
      })
    ).toBe(false);
  });

  it('allows admin console access only when the actor is active and permissioned', () => {
    const actor = {
      role: 'super_admin',
      status: 'active',
      permissions: ['billing.read', 'alerts.read'],
    };

    expect(hasActiveAdminActor(actor)).toBe(true);
    expect(
      hasAdminConsoleAccess({
        isAdmin: false,
        adminActor: actor,
      })
    ).toBe(true);
  });

  it('does not grant admin console access from isAdmin alone', () => {
    expect(
      hasAdminConsoleAccess({
        isAdmin: true,
        adminActor: null,
      })
    ).toBe(false);
  });
});
