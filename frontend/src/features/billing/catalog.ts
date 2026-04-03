import type { BillingPlanKey, BillingVcPackKey, TokenPackKey } from '../../../services/accountService';

export interface BillingPlanCatalogRow {
  key: BillingPlanKey;
  name: string;
  firstCycleInr: number;
  recurringInr: number;
  vfCredits: number;
}

export interface BillingTokenPackCatalogRow {
  key: TokenPackKey;
  label: string;
  vf: number;
  priceInr: number;
}

export interface BillingVcPackCatalogRow {
  key: BillingVcPackKey;
  label: string;
  vc: number;
  priceInr: number;
}

export const BILLING_PLAN_ROWS: readonly BillingPlanCatalogRow[] = [
  { key: 'launcher', name: 'Launcher', firstCycleInr: 129, recurringInr: 129, vfCredits: 30000 },
  { key: 'starter', name: 'Starter', firstCycleInr: 450, recurringInr: 428, vfCredits: 65000 },
  { key: 'creator', name: 'Creator', firstCycleInr: 1499, recurringInr: 1424, vfCredits: 225000 },
  { key: 'pro', name: 'Pro', firstCycleInr: 2999, recurringInr: 2699, vfCredits: 500000 },
  { key: 'scale', name: 'Scale', firstCycleInr: 4500, recurringInr: 3825, vfCredits: 850000 },
] as const;

export const BILLING_TOKEN_PACK_ROWS: readonly BillingTokenPackCatalogRow[] = [
  { key: 'micro', label: 'Micro', vf: 50000, priceInr: 550 },
  { key: 'standard', label: 'Standard', vf: 150000, priceInr: 1450 },
  { key: 'mega', label: 'Mega', vf: 300000, priceInr: 2900 },
  { key: 'ultra', label: 'Ultra', vf: 600000, priceInr: 5200 },
] as const;

export const BILLING_VC_PACK_ROWS: readonly BillingVcPackCatalogRow[] = [
  { key: 'standard', label: 'Standard', vc: 750, priceInr: 699 },
] as const;

export const BILLING_PLAN_KEYS = BILLING_PLAN_ROWS.map((row) => row.key) as BillingPlanKey[];
export const BILLING_TOKEN_PACK_KEYS = BILLING_TOKEN_PACK_ROWS.map((row) => row.key) as TokenPackKey[];
export const BILLING_VC_PACK_KEYS = BILLING_VC_PACK_ROWS.map((row) => row.key) as BillingVcPackKey[];
