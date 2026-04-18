import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveUiV2,
  resolveSurface,
  uidBucket,
  readCachedFlag,
  writeCachedFlag,
  DEFAULT_UI_V2_FLAG,
  type UiV2Flag,
} from '../src/features/feature-flags/uiV2';

/* ── helpers ─────────────────────────────────── */

function flag(overrides: Partial<UiV2Flag> = {}): UiV2Flag {
  return {
    ...DEFAULT_UI_V2_FLAG,
    enabled: true,
    rolloutPct: 100,
    surfaces: { studio: true, reader: true },
    ...overrides,
  };
}

/* ── uidBucket ───────────────────────────────── */

describe('uidBucket', () => {
  it('returns a value between 0 and 99', () => {
    for (const uid of ['alice', 'bob', 'uid_12345', 'x'.repeat(200)]) {
      const b = uidBucket(uid);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is deterministic for the same uid', () => {
    expect(uidBucket('test-user')).toBe(uidBucket('test-user'));
  });

  it('distributes different uids across buckets', () => {
    const buckets = new Set<number>();
    for (let i = 0; i < 500; i++) {
      buckets.add(uidBucket(`user-${i}`));
    }
    // With 500 random-ish uids we should hit at least 50 distinct buckets
    expect(buckets.size).toBeGreaterThan(50);
  });
});

/* ── resolveUiV2 ─────────────────────────────── */

describe('resolveUiV2', () => {
  it('returns false when flag is disabled regardless of uid', () => {
    expect(resolveUiV2('alice', flag({ enabled: false }))).toBe(false);
  });

  it('returns false when uid is null or undefined', () => {
    expect(resolveUiV2(null, flag())).toBe(false);
    expect(resolveUiV2(undefined, flag())).toBe(false);
  });

  it('blocks a uid explicitly listed in blockedUids', () => {
    expect(resolveUiV2('alice', flag({ blockedUids: ['alice'] }))).toBe(false);
  });

  it('blocked takes priority over allowed', () => {
    expect(
      resolveUiV2('alice', flag({ allowedUids: ['alice'], blockedUids: ['alice'] })),
    ).toBe(false);
  });

  it('allows a uid explicitly listed in allowedUids', () => {
    expect(
      resolveUiV2('alice', flag({ allowedUids: ['alice'], rolloutPct: 0 })),
    ).toBe(true);
  });

  it('allows a uid whose bucket is below rolloutPct', () => {
    const bucket = uidBucket('test-uid');
    expect(resolveUiV2('test-uid', flag({ rolloutPct: bucket + 1 }))).toBe(true);
  });

  it('rejects a uid whose bucket is at or above rolloutPct', () => {
    const bucket = uidBucket('test-uid');
    // rolloutPct 0 always rejects (bucket >= 0)
    expect(resolveUiV2('test-uid', flag({ rolloutPct: 0 }))).toBe(false);
  });

  it('defaults to false when flag matches DEFAULT_UI_V2_FLAG', () => {
    expect(resolveUiV2('any-uid', DEFAULT_UI_V2_FLAG)).toBe(false);
  });
});

/* ── resolveSurface ──────────────────────────── */

describe('resolveSurface', () => {
  it('returns true when master + surface are both enabled and uid qualifies', () => {
    expect(resolveSurface('alice', flag(), 'studio')).toBe(true);
    expect(resolveSurface('alice', flag(), 'reader')).toBe(true);
  });

  it('returns false when surface is disabled even if master is on', () => {
    expect(
      resolveSurface('alice', flag({ surfaces: { studio: false, reader: true } }), 'studio'),
    ).toBe(false);
  });

  it('returns false when master resolveUiV2 fails', () => {
    expect(resolveSurface(null, flag(), 'studio')).toBe(false);
    expect(resolveSurface('alice', flag({ enabled: false }), 'reader')).toBe(false);
  });
});

/* ── localStorage cache ──────────────────────── */

describe('readCachedFlag / writeCachedFlag', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => { storage[k] = v; },
        removeItem: (k: string) => { delete storage[k]; },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when nothing is cached', () => {
    expect(readCachedFlag()).toBeNull();
  });

  it('round-trips a flag through write → read', () => {
    const f = flag();
    writeCachedFlag(f);
    const result = readCachedFlag();
    expect(result).toEqual(f);
  });

  it('returns null when cache is expired (>5 min)', () => {
    const f = flag();
    writeCachedFlag(f);
    // Manually tamper with the stored timestamp
    const raw = JSON.parse(storage['vf:flag:ui_v2']);
    raw.t = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    storage['vf:flag:ui_v2'] = JSON.stringify(raw);

    expect(readCachedFlag()).toBeNull();
  });

  it('returns null when localStorage has garbage', () => {
    storage['vf:flag:ui_v2'] = '{{not json';
    expect(readCachedFlag()).toBeNull();
  });

  it('returns null when window is undefined (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(readCachedFlag()).toBeNull();
  });
});
