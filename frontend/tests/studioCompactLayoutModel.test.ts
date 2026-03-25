import { describe, expect, it } from 'vitest';
import {
  STUDIO_RAIL_TAB_ITEMS,
  getStudioCreditsActionState,
  resolveSidebarMode,
  resolveStudioRailTab,
} from '../src/features/studio/model/layout';

describe('studio compact layout model', () => {
  it('defaults sidebar mode to expanded when value is empty or unknown', () => {
    expect(resolveSidebarMode(undefined)).toBe('expanded');
    expect(resolveSidebarMode('')).toBe('expanded');
    expect(resolveSidebarMode('something-else')).toBe('expanded');
  });

  it('restores compact sidebar mode when explicitly saved', () => {
    expect(resolveSidebarMode('compact')).toBe('compact');
    expect(resolveSidebarMode('COMPACT')).toBe('compact');
  });

  it('restores expanded sidebar mode when explicitly saved', () => {
    expect(resolveSidebarMode('expanded')).toBe('expanded');
    expect(resolveSidebarMode('EXPANDED')).toBe('expanded');
  });

  it('keeps studio rail tab order and default tab contract', () => {
    expect(STUDIO_RAIL_TAB_ITEMS.map((item) => item.id)).toEqual(['voice', 'mix', 'cast', 'queue']);
    expect(resolveStudioRailTab(undefined)).toBe('voice');
    expect(resolveStudioRailTab('queue')).toBe('queue');
    expect(resolveStudioRailTab('live')).toBe('voice');
  });

  it('computes credits action states for ad claim, token buy, and coupon redeem', () => {
    expect(getStudioCreditsActionState({
      isBuyingTokenPack: false,
      isRedeemingCoupon: false,
      couponCode: 'VF10',
    })).toEqual({
      buyTokenPackDisabled: false,
      redeemCouponDisabled: false,
    });

    expect(getStudioCreditsActionState({
      isBuyingTokenPack: true,
      isRedeemingCoupon: true,
      couponCode: '   ',
    })).toEqual({
      buyTokenPackDisabled: true,
      redeemCouponDisabled: true,
    });
  });
});
