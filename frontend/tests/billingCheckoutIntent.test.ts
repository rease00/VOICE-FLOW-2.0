import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BILLING_CHECKOUT_INTENT_TTL_MS,
  clearBillingCheckoutIntent,
  consumeBillingCheckoutIntent,
  createBillingCheckoutIntent,
  readBillingCheckoutIntent,
  writeBillingCheckoutIntent,
} from '../src/features/billing/checkoutIntent';
import { STORAGE_KEYS } from '../src/shared/storage/keys';

const createStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    store,
  };
};

describe('billingCheckoutIntent', () => {
  const originalLocalStorage = globalThis.localStorage;
  const storage = createStorageMock();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
    clearBillingCheckoutIntent();
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('creates, writes, and reads a normalized subscription intent', () => {
    const createdAt = 1_000_000;
    const intent = createBillingCheckoutIntent(
      {
        kind: 'subscription',
        selection: { planKey: 'creator', couponCode: 'WELCOME' },
        authMode: 'signup',
        resumePath: '/billing?resumeCheckout=1',
        createdAt,
      },
      createdAt
    );

    expect(intent).toEqual({
      kind: 'subscription',
      selection: { planKey: 'creator', couponCode: 'WELCOME' },
      authMode: 'signup',
      resumePath: '/billing?resumeCheckout=1',
      createdAt,
      expiresAt: createdAt + BILLING_CHECKOUT_INTENT_TTL_MS,
    });

    const written = writeBillingCheckoutIntent(
      {
        kind: 'subscription',
        selection: { planKey: 'creator', couponCode: 'WELCOME' },
        authMode: 'signup',
        resumePath: '/billing?resumeCheckout=1',
        createdAt,
      },
      createdAt
    );

    expect(written).toEqual(intent);
    expect(readBillingCheckoutIntent(createdAt)).toEqual(intent);
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.checkoutIntent, JSON.stringify(intent));
  });

  it('consumes an intent once and clears storage', () => {
    const createdAt = 2_000_000;
    const intent = writeBillingCheckoutIntent(
      {
        kind: 'token-pack',
        selection: { packKey: 'standard' },
        authMode: 'login',
        resumePath: '/app/billing',
        createdAt,
      },
      createdAt
    );

    expect(intent).not.toBeNull();
    expect(consumeBillingCheckoutIntent(createdAt)).toEqual(intent);
    expect(readBillingCheckoutIntent(createdAt)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEYS.checkoutIntent);
  });

  it('supports VC pack intents', () => {
    const createdAt = 2_500_000;
    const intent = createBillingCheckoutIntent(
      {
        kind: 'vc-token-pack',
        selection: { vcPackKey: 'standard' },
        authMode: 'login',
        resumePath: '/billing?tab=vc-packs',
        createdAt,
      },
      createdAt
    );

    expect(intent).toEqual({
      kind: 'vc-token-pack',
      selection: { vcPackKey: 'standard' },
      authMode: 'login',
      resumePath: '/billing?tab=vc-packs',
      createdAt,
      expiresAt: createdAt + BILLING_CHECKOUT_INTENT_TTL_MS,
    });
  });

  it('expires stale intents and clears them from storage', () => {
    const createdAt = 3_000_000;
    writeBillingCheckoutIntent(
      {
        kind: 'subscription',
        selection: { planKey: 'starter' },
        authMode: 'login',
        resumePath: '/billing',
        createdAt,
        ttlMs: 1_000,
      },
      createdAt
    );

    expect(readBillingCheckoutIntent(createdAt + 5_000)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEYS.checkoutIntent);
  });

  it('falls back to the safe billing resume path when an unsafe next path is supplied', () => {
    const intent = createBillingCheckoutIntent({
      kind: 'subscription',
      selection: { planKey: 'creator' },
      authMode: 'login',
      resumePath: 'https://evil.example/phish',
    });

    expect(intent?.resumePath).toBe('/billing');
  });
});
