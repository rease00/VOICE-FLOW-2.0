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

  it('forces non-generation success events to inbox', () => {
    const policy = resolveNotificationPolicy('billing.coupon.success', {
      message: 'Coupon applied.',
    });
    expect(policy.channel).toBe('inbox');
  });

  it('forces non-generation error events to inbox', () => {
    const policy = resolveNotificationPolicy('auth.signin.failed', {
      message: 'Sign-in failed.',
    });
    expect(policy.channel).toBe('inbox');
  });
});
