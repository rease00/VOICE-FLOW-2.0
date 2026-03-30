'use client';

import React from 'react';
import { BillingSurface } from './surface/BillingSurface';

export const PublicBillingPage: React.FC = () => (
  <div className="vf-billing-shell" data-billing-mode="public" data-vf-brand-theme="aurora">
    <BillingSurface
      mode="public"
      returnPath="/billing"
      appBuyUrl="/app/buy"
      homeUrl="/app"
      authMode="signup"
    />
  </div>
);
