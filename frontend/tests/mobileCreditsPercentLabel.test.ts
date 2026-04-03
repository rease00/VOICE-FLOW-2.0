import { describe, expect, it } from 'vitest';

import { formatMobileAvailableCreditsPercent } from '../src/app/workspace/mainAppHelpers';

describe('mobile credits percent label', () => {
  it('returns 100% for unlimited access', () => {
    expect(
      formatMobileAvailableCreditsPercent({
        hasUnlimitedAccess: true,
        monthlyFreeRemaining: 0,
        monthlyFreeLimit: 0,
      })
    ).toBe('100%');
  });

  it('returns 100% when credits are available but monthly limit is zero', () => {
    expect(
      formatMobileAvailableCreditsPercent({
        hasUnlimitedAccess: false,
        monthlyFreeRemaining: 500,
        monthlyFreeLimit: 0,
      })
    ).toBe('100%');
  });

  it('returns 0% when no free or paid credits are available', () => {
    expect(
      formatMobileAvailableCreditsPercent({
        hasUnlimitedAccess: false,
        monthlyFreeRemaining: 0,
        monthlyFreeLimit: 0,
        paidVfBalance: 0,
      })
    ).toBe('0%');
  });

  it('formats remaining monthly free credits as a percentage', () => {
    expect(
      formatMobileAvailableCreditsPercent({
        hasUnlimitedAccess: false,
        monthlyFreeRemaining: 250,
        monthlyFreeLimit: 1000,
      })
    ).toBe('25%');
  });

  it('clamps the computed percentage between 0% and 100%', () => {
    expect(
      formatMobileAvailableCreditsPercent({
        hasUnlimitedAccess: false,
        monthlyFreeRemaining: 2400,
        monthlyFreeLimit: 1000,
      })
    ).toBe('100%');
    expect(
      formatMobileAvailableCreditsPercent({
        hasUnlimitedAccess: false,
        monthlyFreeRemaining: -200,
        monthlyFreeLimit: 1000,
      })
    ).toBe('0%');
  });
});
