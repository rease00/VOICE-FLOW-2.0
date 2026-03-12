import { describe, expect, it } from 'vitest';
import type { AccountBillingSummary } from '../services/accountService';
import {
  ACCOUNT_DETAIL_LABELS,
  ACCOUNT_SUMMARY_LABELS,
  getBillingActionVisibility,
  hasSummaryDetailLabelOverlap,
} from '../components/account/accountCenterLayout';

type BillingVisibilityInput = Pick<AccountBillingSummary, 'plan' | 'billing' | 'subscription'>;

describe('accountCenterLayout', () => {
  it('shows only change plan for free plans', () => {
    const visibility = getBillingActionVisibility({
      plan: { key: 'free' },
      billing: { hasPortalAccess: true },
      subscription: { active: false, status: 'inactive', cancelAtPeriodEnd: false },
    } as BillingVisibilityInput);

    expect(visibility).toEqual({
      showChangePlan: true,
      showOpenBillingPortal: false,
      showCancelRecurring: false,
    });
  });

  it('shows change plan and billing portal for paid users with portal access', () => {
    const visibility = getBillingActionVisibility({
      plan: { key: 'pro' },
      billing: { hasPortalAccess: true },
      subscription: { active: false, status: 'incomplete', cancelAtPeriodEnd: false },
    } as BillingVisibilityInput);

    expect(visibility).toEqual({
      showChangePlan: true,
      showOpenBillingPortal: true,
      showCancelRecurring: false,
    });
  });

  it('includes cancel recurring only when subscription is cancelable', () => {
    const activeVisibility = getBillingActionVisibility({
      plan: { key: 'pro' },
      billing: { hasPortalAccess: true },
      subscription: { active: true, status: 'active', cancelAtPeriodEnd: false },
    } as BillingVisibilityInput);
    const cancelingVisibility = getBillingActionVisibility({
      plan: { key: 'pro' },
      billing: { hasPortalAccess: true },
      subscription: { active: true, status: 'active', cancelAtPeriodEnd: true },
    } as BillingVisibilityInput);

    expect(activeVisibility.showCancelRecurring).toBe(true);
    expect(cancelingVisibility.showCancelRecurring).toBe(false);
  });

  it('keeps summary labels distinct from account detail labels', () => {
    const summaryLabels = Object.values(ACCOUNT_SUMMARY_LABELS);
    const detailLabels = Object.values(ACCOUNT_DETAIL_LABELS);

    expect(hasSummaryDetailLabelOverlap(summaryLabels, detailLabels)).toBe(false);
  });
});
