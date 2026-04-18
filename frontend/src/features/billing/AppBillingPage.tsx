'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '../../../contexts/UserContext';
import { APP_ROUTE_PATHS } from '../../app/navigation';
import { BillingSurface } from './surface/BillingSurface';

export const BillingCenter: React.FC = () => {
  const router = useRouter();
  const { user, stats, hasUnlimitedAccess, refreshEntitlements } = useUser();

  const monthlyFree = Math.max(0, Number(stats.wallet?.monthlyFreeRemaining || 0));
  const paidBalance = Math.max(0, Number(stats.wallet?.paidVfBalance || 0));
  const spendableVf = Math.max(0, monthlyFree + paidBalance);
  const tokenPackDiscountPercent = Math.max(0, Number(stats.limits?.tokenPackDiscountPercent || 0));
  const vcTokenPackDiscountPercent = Math.max(0, Number(stats.limits?.vcTokenPackDiscountPercent || 0));

  const walletSummary = useMemo(
    () => ({
      monthlyFree,
      paidBalance,
      spendableVf,
      hasUnlimitedAccess,
    }),
    [hasUnlimitedAccess, monthlyFree, paidBalance, spendableVf]
  );

  return (
    <BillingSurface
      mode="app"
      returnPath={APP_ROUTE_PATHS.billing}
      appBuyUrl={APP_ROUTE_PATHS.billing}
      authMode="login"
      isAuthenticated={Boolean(String(user.uid || user.email || '').trim())}
      billingCountry={stats.billingCountry || null}
      onBackToWorkspace={() => router.push(APP_ROUTE_PATHS.main)}
      onRefreshEntitlements={refreshEntitlements}
      walletSummary={walletSummary}
      tokenPackDiscountPercent={tokenPackDiscountPercent}
      vcTokenPackDiscountPercent={vcTokenPackDiscountPercent}
    />
  );
};
