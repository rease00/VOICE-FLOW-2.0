'use client';

import { BillingSurface } from './surface/BillingSurface';

const BILLING_PATH = '/billing';

export function PublicBillingPage() {
  return (
    <div className="vf-billing-shell" data-billing-mode="public" data-vf-brand-theme="aurora">
      <BillingSurface
        mode="public"
        returnPath={BILLING_PATH}
        appBuyUrl={BILLING_PATH}
        homeUrl="/landing"
      />
    </div>
  );
}
