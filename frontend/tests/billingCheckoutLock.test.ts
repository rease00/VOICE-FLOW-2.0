import { describe, expect, it } from 'vitest';

describe('billing checkout launch lock', () => {
  it('rejects plan checkout while launch billing lock is active', async () => {
    const { createPlanCheckoutSession } = await import('../src/server/billing/service');

    await expect(createPlanCheckoutSession({ uid: 'launch-lock-user' } as any, {
      plan: 'creator',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    })).rejects.toMatchObject({
      status: 403,
      message: 'Checkout is temporarily paused while V FLOW AI completes launch checks. Existing users can still access the studio, but billing changes stay locked until launch.',
    });
  });
});
