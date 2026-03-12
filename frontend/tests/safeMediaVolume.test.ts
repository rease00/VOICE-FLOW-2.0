import { describe, expect, it, vi } from 'vitest';

import { applySafeMediaVolume, normalizeMediaVolume } from '../src/shared/media/safeMediaVolume';

describe('safe media volume helpers', () => {
  it('normalizes NaN, Infinity, and out-of-range values', () => {
    expect(normalizeMediaVolume(Number.NaN, 0.25)).toBe(0.25);
    expect(normalizeMediaVolume(Number.POSITIVE_INFINITY, 0.5)).toBe(0.5);
    expect(normalizeMediaVolume(-2, 0.5)).toBe(0);
    expect(normalizeMediaVolume(4.2, 0.5)).toBe(1);
  });

  it('assigns clamped volume when media element is writable', () => {
    const media = { volume: 0 } as HTMLMediaElement;
    const applied = applySafeMediaVolume(media, 1.6, { fallback: 0.3 });
    expect(applied).toBe(1);
    expect(media.volume).toBe(1);
  });

  it('falls back safely and reports when setter throws', () => {
    let writes: number[] = [];
    let failFirstWrite = true;
    const media = {} as HTMLMediaElement;
    Object.defineProperty(media, 'volume', {
      configurable: true,
      enumerable: true,
      get() {
        return writes[writes.length - 1] ?? 0;
      },
      set(value: number) {
        if (failFirstWrite) {
          failFirstWrite = false;
          throw new TypeError('volume setter failed');
        }
        writes.push(Number(value));
      },
    });

    const onError = vi.fn();
    const applied = applySafeMediaVolume(media, 1.2, { fallback: 0.2, context: 'unit_test', onError });

    expect(applied).toBe(0.2);
    expect(writes).toEqual([0.2]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toMatchObject({
      attemptedVolume: 1,
      appliedFallback: 0.2,
      context: 'unit_test',
    });
  });
});
