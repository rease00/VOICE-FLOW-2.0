import type { BillingPlanKey, BillingVcPackKey, TokenPackKey, VnTokenPackKey } from '../../../services/accountService';

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
  benefitPercent?: number;
}

export interface BillingVcPackCatalogRow {
  key: BillingVcPackCatalogKey;
  label: string;
  vc: number;
  priceInr: number;
}

export interface BillingVnPackCatalogRow {
  key: VnTokenPackKey;
  label: string;
  vn: number;
  priceInr: number;
  benefitPercent?: number;
}

export type BillingVcPackCatalogKey = BillingVcPackKey;

export const BILLING_PLAN_ROWS: readonly BillingPlanCatalogRow[] = [
  { key: 'launcher', name: 'Launcher', firstCycleInr: 129, recurringInr: 129, vfCredits: 30000 },
  { key: 'starter', name: 'Starter', firstCycleInr: 450, recurringInr: 428, vfCredits: 65000 },
  { key: 'creator', name: 'Creator', firstCycleInr: 1499, recurringInr: 1424, vfCredits: 225000 },
  { key: 'pro', name: 'Pro', firstCycleInr: 2999, recurringInr: 2699, vfCredits: 500000 },
  { key: 'scale', name: 'Scale', firstCycleInr: 4500, recurringInr: 3825, vfCredits: 850000 },
] as const;

export const BILLING_TOKEN_PACK_ROWS: readonly BillingTokenPackCatalogRow[] = [
  { key: 'micro', label: 'Micro', vf: 50000, priceInr: 550, benefitPercent: 0 },
  { key: 'standard', label: 'Standard', vf: 150000, priceInr: 1450, benefitPercent: 12 },
  { key: 'mega', label: 'Mega', vf: 300000, priceInr: 2900, benefitPercent: 12 },
  { key: 'ultra', label: 'Ultra', vf: 600000, priceInr: 5200, benefitPercent: 21 },
] as const;

export const BILLING_VC_PACK_ROWS: readonly BillingVcPackCatalogRow[] = [
  { key: 'starter', label: 'Starter', vc: 55, priceInr: 110 },
  { key: 'standard', label: 'Standard', vc: 200, priceInr: 400 },
  { key: 'growth', label: 'Growth', vc: 500, priceInr: 1000 },
  { key: 'pro', label: 'Pro', vc: 1500, priceInr: 3000 },
  { key: 'scale', label: 'Scale', vc: 2600, priceInr: 5000 },
] as const;

export const BILLING_VN_PACK_ROWS: readonly BillingVnPackCatalogRow[] = [
  { key: 'vn_micro', label: 'Micro', vn: 500, priceInr: 50, benefitPercent: 0 },
  { key: 'vn_standard', label: 'Standard', vn: 2000, priceInr: 200, benefitPercent: 0 },
  { key: 'vn_mega', label: 'Mega', vn: 5000, priceInr: 500, benefitPercent: 0 },
  { key: 'vn_ultra', label: 'Ultra', vn: 15000, priceInr: 1500, benefitPercent: 0 },
] as const;

export const BILLING_PLAN_KEYS = BILLING_PLAN_ROWS.map((row) => row.key) as BillingPlanKey[];
export const BILLING_TOKEN_PACK_KEYS = BILLING_TOKEN_PACK_ROWS.map((row) => row.key) as TokenPackKey[];
export const BILLING_VC_PACK_KEYS = BILLING_VC_PACK_ROWS.map((row) => row.key) as BillingVcPackCatalogKey[];
export const BILLING_VN_PACK_KEYS = BILLING_VN_PACK_ROWS.map((row) => row.key) as VnTokenPackKey[];
