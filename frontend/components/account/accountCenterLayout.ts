import type { AccountBillingSummary } from '../../services/accountService';

export interface BillingActionVisibility {
  showChangePlan: boolean;
  showCancelRecurring: boolean;
  showResumeRecurring: boolean;
}

export const getBillingActionVisibility = (
  summary: Pick<AccountBillingSummary, 'plan' | 'billing' | 'subscription'>
): BillingActionVisibility => {
  const isPaidPlan = summary.plan.key !== 'free';
  const hasBillingManagement = Boolean(summary.billing.hasBillingManagement ?? summary.billing.hasPortalAccess);
  const subscriptionStatus = String(summary.subscription.status || '').trim().toLowerCase();
  const hasRecurringSubscription = Boolean(summary.subscription.active) || ['active', 'trialing', 'past_due'].includes(subscriptionStatus);
  const canCancelRecurring = hasRecurringSubscription && !summary.subscription.cancelAtPeriodEnd;
  const canResumeRecurring = hasRecurringSubscription && summary.subscription.cancelAtPeriodEnd;
  return {
    showChangePlan: true,
    showCancelRecurring: isPaidPlan && hasBillingManagement && canCancelRecurring,
    showResumeRecurring: isPaidPlan && hasBillingManagement && canResumeRecurring,
  };
};

export const ACCOUNT_SUMMARY_LABELS = {
  plan: 'Current plan',
  usage: 'Usage now',
  balance: 'Available now',
  ops: 'Queue health',
} as const;

export const ACCOUNT_DETAIL_LABELS = {
  displayName: 'Display name',
  email: 'Email',
  userId: 'User ID',
  accountStatus: 'Account status',
  authProviders: 'Auth providers',
  memberSince: 'Member since',
} as const;

const normalizeLabel = (value: string): string => String(value || '').trim().toLowerCase();

export const hasSummaryDetailLabelOverlap = (
  summaryLabels: readonly string[],
  detailLabels: readonly string[]
): boolean => {
  const detailSet = new Set(detailLabels.map(normalizeLabel));
  return summaryLabels.some((label) => detailSet.has(normalizeLabel(label)));
};
