import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const requestJsonMock = vi.hoisted(() => vi.fn());
const authFetchMock = vi.hoisted(() => vi.fn());
const readJsonOrThrowMock = vi.hoisted(() => vi.fn());
const primeLoginRoutingAfterAccountBootstrapMock = vi.hoisted(() => vi.fn());

vi.mock('../services/authHttpClient', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

vi.mock('../src/shared/api/httpClient', () => ({
  parseResponseError: vi.fn(),
  readJsonOrThrow: (...args: unknown[]) => readJsonOrThrowMock(...args),
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
}));

vi.mock('../services/backendRoutingService', () => ({
  primeLoginRoutingAfterAccountBootstrap: (...args: unknown[]) => primeLoginRoutingAfterAccountBootstrapMock(...args),
}));

describe('billing checkout idempotency headers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T12:34:56.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a stable Idempotency-Key for repeated plan checkout attempts', async () => {
    requestJsonMock
      .mockResolvedValueOnce({ ok: true, provider: 'razorpay', kind: 'checkout', sessionId: 'session-1' })
      .mockResolvedValueOnce({ ok: true, provider: 'razorpay', kind: 'checkout', sessionId: 'session-1' });

    const { createCheckoutSession } = await import('../services/accountService');

    await createCheckoutSession('pro', 'https://backend.example.test', { couponCode: 'SAVE10' });
    await createCheckoutSession('pro', 'https://backend.example.test', { couponCode: 'SAVE10' });

    expect(requestJsonMock).toHaveBeenCalledTimes(2);
    expect(requestJsonMock.mock.calls[0]?.[0]).toBe('/billing/checkout-session');
    expect(requestJsonMock.mock.calls[0]?.[2]).toMatchObject({
      baseUrl: 'https://backend.example.test',
      requireAuth: true,
    });
    const firstInit = requestJsonMock.mock.calls[0]?.[1] as RequestInit;
    const secondInit = requestJsonMock.mock.calls[1]?.[1] as RequestInit;
    const firstHeaders = new Headers(firstInit?.headers);
    const secondHeaders = new Headers(secondInit?.headers);

    expect(firstHeaders.get('Idempotency-Key')).toBe(secondHeaders.get('Idempotency-Key'));
    expect(firstHeaders.get('Idempotency-Key')).toContain('checkout');
    expect(firstHeaders.get('Idempotency-Key')).toContain('pro');
    expect(firstHeaders.get('Idempotency-Key')).toContain('save10');
  });

  it('adds Idempotency-Key headers to token-pack checkout intents', async () => {
    requestJsonMock
      .mockResolvedValueOnce({ ok: true, provider: 'razorpay', kind: 'checkout', sessionId: 'token-session-1' })
      .mockResolvedValueOnce({ ok: true, provider: 'razorpay', kind: 'checkout', sessionId: 'vc-session-1' });

    const { createTokenPackCheckoutSession, startVcTokenPackCheckout } = await import('../services/accountService');

    await createTokenPackCheckoutSession('standard', 'https://backend.example.test');
    await startVcTokenPackCheckout('scale', 'https://backend.example.test');

    expect(requestJsonMock).toHaveBeenCalledTimes(2);
    expect(requestJsonMock.mock.calls[0]?.[0]).toBe('/billing/token-pack/checkout-session');
    expect(requestJsonMock.mock.calls[0]?.[2]).toMatchObject({
      baseUrl: 'https://backend.example.test',
      requireAuth: true,
    });
    expect(requestJsonMock.mock.calls[1]?.[0]).toBe('/billing/vc-token-pack/checkout-session');
    expect(requestJsonMock.mock.calls[1]?.[2]).toMatchObject({
      baseUrl: 'https://backend.example.test',
      requireAuth: true,
    });

    const tokenPackHeaders = new Headers((requestJsonMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers);
    const vcPackHeaders = new Headers((requestJsonMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers);

    expect(tokenPackHeaders.get('Idempotency-Key')).toContain('token-pack');
    expect(tokenPackHeaders.get('Idempotency-Key')).toContain('standard');
    expect(vcPackHeaders.get('Idempotency-Key')).toContain('vc-token-pack');
    expect(vcPackHeaders.get('Idempotency-Key')).toContain('scale');
  });

  it('expands the VC pack union for billing checkout helpers', async () => {
    requestJsonMock.mockResolvedValueOnce({
      ok: true,
      provider: 'razorpay',
      kind: 'checkout',
      sessionId: 'vc-session-scale',
      packKey: 'scale',
      packVc: 2600,
      standardAmountInr: 5000,
      finalAmountInr: 4750,
      discountPercent: 5,
    });

    const { startVcTokenPackCheckout } = await import('../services/accountService');
    const launch = await startVcTokenPackCheckout('scale', 'https://backend.example.test');

    expect(launch.packKey).toBe('scale');
    expect(launch.packVc).toBe(2600);
    expect(launch.standardAmountInr).toBe(5000);
    expect(launch.finalAmountInr).toBe(4750);
    expect(launch.discountPercent).toBe(5);
  });

  it('creates a billing portal session for self-serve billing management', async () => {
    authFetchMock.mockResolvedValueOnce({ ok: true });
    readJsonOrThrowMock.mockResolvedValueOnce({
      ok: true,
      provider: 'razorpay',
      url: 'https://billing.example.test/manage',
    });

    const { createBillingPortalSession } = await import('../services/accountService');

    const session = await createBillingPortalSession('https://backend.example.test', {
      returnUrl: 'https://app.example.test/account',
    });

    expect(authFetchMock).toHaveBeenCalledWith(
      'https://backend.example.test/billing/portal-session',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
      expect.objectContaining({ requireAuth: true })
    );
    const requestInit = authFetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(requestInit.body || '')).toContain('https://app.example.test/account');
    expect(session.provider).toBe('razorpay');
    expect(session.url).toBe('https://billing.example.test/manage');
  });

  it('primes backend routing after bootstrapping an account profile', async () => {
    authFetchMock.mockResolvedValueOnce({ ok: true });
    readJsonOrThrowMock.mockResolvedValueOnce({
      profile: {
        uid: 'uid-1',
        userId: 'user-1',
      },
    });
    primeLoginRoutingAfterAccountBootstrapMock.mockResolvedValue({
      applied: true,
      reason: 'switched',
      baseUrl: 'https://backend.example.test',
    });

    const { bootstrapAccountProfile } = await import('../services/accountService');
    const profile = await bootstrapAccountProfile('https://backend.example.test');

    expect(profile.userId).toBe('user-1');
    expect(primeLoginRoutingAfterAccountBootstrapMock).toHaveBeenCalledWith({
      baseUrl: 'https://backend.example.test',
    });
  });
});
