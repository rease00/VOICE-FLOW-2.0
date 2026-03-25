export type SidebarMode = 'compact' | 'expanded';
export type StudioRailTab = 'voice' | 'mix' | 'cast' | 'queue';

export interface StudioRailTabItem {
  id: StudioRailTab;
  label: string;
}

export const STUDIO_RAIL_TAB_ITEMS: readonly StudioRailTabItem[] = [
  { id: 'voice', label: 'Voice' },
  { id: 'mix', label: 'Mix' },
  { id: 'cast', label: 'Cast' },
  { id: 'queue', label: 'Queue' },
] as const;

export const resolveSidebarMode = (value: unknown): SidebarMode => {
  const token = String(value || '').trim().toLowerCase();
  return token === 'compact' ? 'compact' : 'expanded';
};

export const resolveStudioRailTab = (value: unknown): StudioRailTab => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'mix') return 'mix';
  if (token === 'cast') return 'cast';
  if (token === 'queue') return 'queue';
  return 'voice';
};

export interface StudioCreditsActionStateInput {
  isAuthenticated?: boolean;
  isBuyingTokenPack: boolean;
  isRedeemingCoupon: boolean;
  couponCode: string;
}

export interface StudioCreditsActionState {
  buyTokenPackDisabled: boolean;
  redeemCouponDisabled: boolean;
}

export const getStudioCreditsActionState = (
  input: StudioCreditsActionStateInput
): StudioCreditsActionState => ({
  buyTokenPackDisabled: input.isBuyingTokenPack,
  redeemCouponDisabled: input.isRedeemingCoupon || !String(input.couponCode || '').trim(),
});
