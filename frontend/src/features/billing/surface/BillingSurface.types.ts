import type { TokenPackKey } from '../../../../services/accountService';
import type { AuthRouteMode } from '../../../app/navigation';

export type BillingSurfaceMode = 'public' | 'app';
export type BillingSurfaceTab = 'plans' | 'token' | 'coupon';

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
  onBackToWorkspace?: () => void;
  onRefreshEntitlements?: () => Promise<void> | void;
  walletSummary?: BillingSurfaceWalletSummary | null;
  defaultTokenPackKey?: TokenPackKey;
}
