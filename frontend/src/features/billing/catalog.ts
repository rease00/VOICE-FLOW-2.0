import type { BillingPlanKey, TokenPackKey } from '../../../services/accountService';

export interface BillingPlanCatalogRow {
  key: BillingPlanKey;
  name: string;
  priceInr: number;
  vfCredits: number;
}

export interface BillingTokenPackCatalogRow {
  key: TokenPackKey;
  label: string;
  vf: number;
  priceInr: number;
}

export const BILLING_PLAN_ROWS: readonly BillingPlanCatalogRow[] = [
  { key: 'launcher', name: 'Launcher', priceInr: 129, vfCredits: 30000 },
  { key: 'starter', name: 'Starter', priceInr: 450, vfCredits: 65000 },
  { key: 'creator', name: 'Creator', priceInr: 1499, vfCredits: 225000 },
  { key: 'pro', name: 'Pro', priceInr: 2999, vfCredits: 500000 },
  { key: 'scale', name: 'Scale', priceInr: 4500, vfCredits: 850000 },
] as const;

export const BILLING_TOKEN_PACK_ROWS: readonly BillingTokenPackCatalogRow[] = [
  { key: 'micro', label: 'Micro', vf: 50000, priceInr: 550 },
  { key: 'standard', label: 'Standard', vf: 150000, priceInr: 1450 },
  { key: 'mega', label: 'Mega', vf: 300000, priceInr: 2900 },
  { key: 'ultra', label: 'Ultra', vf: 600000, priceInr: 5200 },
] as const;

export const BILLING_PLAN_KEYS = BILLING_PLAN_ROWS.map((row) => row.key) as BillingPlanKey[];
export const BILLING_TOKEN_PACK_KEYS = BILLING_TOKEN_PACK_ROWS.map((row) => row.key) as TokenPackKey[];
