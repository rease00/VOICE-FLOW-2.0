import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock('../services/authHttpClient', () => ({
  authFetch: vi.fn(),
}));

vi.mock('../src/shared/api/httpClient', () => ({
  parseResponseError: vi.fn(),
  readJsonOrThrow: vi.fn(),
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
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
    await startVcTokenPackCheckout('gold', 'https://backend.example.test');

    expect(requestJsonMock).toHaveBeenCalledTimes(2);

    const tokenPackHeaders = new Headers((requestJsonMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers);
    const vcPackHeaders = new Headers((requestJsonMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers);

    expect(tokenPackHeaders.get('Idempotency-Key')).toContain('token-pack');
    expect(tokenPackHeaders.get('Idempotency-Key')).toContain('standard');
    expect(vcPackHeaders.get('Idempotency-Key')).toContain('vc-token-pack');
    expect(vcPackHeaders.get('Idempotency-Key')).toContain('gold');
  });
});
