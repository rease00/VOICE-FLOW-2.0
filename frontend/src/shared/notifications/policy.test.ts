import { describe, expect, it } from 'vitest';
import { resolveNotificationPolicy } from './policy';

describe('notification policy', () => {
  it('routes inbox-only operational info events to inbox', () => {
    const policy = resolveNotificationPolicy('runtime.online', {
      message: 'HD runtime is online.',
    });
    expect(policy.channel).toBe('inbox');
    expect(policy.severity).toBe('success');
  });

  it('routes generation failures to actionable toast', () => {
    const policy = resolveNotificationPolicy('generation.failed', {
      message: 'Generation failed.',
    });
    expect(policy.channel).toBe('toast');
    expect(policy.severity).toBe('error');
  });

  it('keeps generic success messages inbox-only by default', () => {
    const policy = resolveNotificationPolicy('custom.message', {
      severity: 'success',
      message: 'Character updated.',
    });
    expect(policy.channel).toBe('inbox');
  });

  it('allows requested custom info messages to surface as popups', () => {
    const policy = resolveNotificationPolicy('custom.message', {
      severity: 'info',
      message: 'Enter text first.',
      channel: 'toast',
    });
    expect(policy.channel).toBe('toast');
  });

  it('surfaces user-action success events as toast', () => {
    const policy = resolveNotificationPolicy('billing.coupon.success', {
      message: 'Coupon applied.',
    });
    expect(policy.channel).toBe('toast');
  });

  it('surfaces auth failures as toast', () => {
    const policy = resolveNotificationPolicy('auth.signin.failed', {
      message: 'Sign-in failed.',
    });
    expect(policy.channel).toBe('toast');
  });

  it('suppresses admin-only events for non-admin users', () => {
    const policy = resolveNotificationPolicy(
      'admin.pool.reload.failed',
      {
        message: 'Failed to reload primary AI pool.',
      },
      { isAdmin: false }
    );
    expect(policy.channel).toBe('silent');
  });

  it('shows admin-only events for admin users', () => {
    const policy = resolveNotificationPolicy(
      'admin.pool.reload.failed',
      {
        message: 'Failed to reload primary AI pool.',
      },
      { isAdmin: true }
    );
    expect(policy.channel).toBe('toast');
  });
});
