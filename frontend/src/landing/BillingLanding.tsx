'use client';

import React from 'react';
import { BillingSurface } from '../features/billing/surface/BillingSurface';

export const BillingLanding: React.FC = () => (
  <BillingSurface
    mode="public"
    returnPath="/billing"
    appBuyUrl="/app/buy"
    homeUrl="/"
    authMode="signup"
  />
);
