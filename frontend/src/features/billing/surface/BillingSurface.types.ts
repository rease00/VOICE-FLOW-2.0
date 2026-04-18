import type { TokenPackKey } from '../../../../services/accountService';
import type { AuthRouteMode } from '../../../app/navigation';
import type { BillingVcPackCatalogKey } from '../catalog';

export type BillingSurfaceMode = 'public' | 'app';
export type BillingSurfaceTab = 'plans' | 'token' | 'vc' | 'vn';

export interface BillingSurfaceWalletSummary {
  monthlyFree: number;
  paidBalance: number;
  spendableVf: number;
  hasUnlimitedAccess?: boolean;
}

export interface BillingSurfaceBanner {
  tone: 'success' | 'warning' | 'info';
  message: string;
}

export interface BillingSurfaceProps {
  mode: BillingSurfaceMode;
  returnPath: string;
  appBuyUrl?: string;
  homeUrl?: string;
  authMode?: AuthRouteMode;
  isAuthenticated?: boolean;
  billingCountry?: string | null;
  onBackToWorkspace?: () => void;
  onRefreshEntitlements?: () => Promise<void> | void;
  walletSummary?: BillingSurfaceWalletSummary | null;
  tokenPackDiscountPercent?: number;
  vcTokenPackDiscountPercent?: number;
  defaultTokenPackKey?: TokenPackKey;
  defaultVcPackKey?: BillingVcPackCatalogKey;
}
