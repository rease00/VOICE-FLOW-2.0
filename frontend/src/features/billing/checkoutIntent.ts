import type { AuthRouteMode } from '../../app/navigation';
import { resolveSafeInternalNextPath } from '../../app/navigation';
import type { BillingPlanKey, TokenPackKey, VnTokenPackKey } from '../../../services/accountService';
import type { BillingVcPackCatalogKey } from './catalog';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { readStorageJson, removeStorageKey, writeStorageJson } from '../../shared/storage/localStore';

export const BILLING_CHECKOUT_INTENT_TTL_MS = 60 * 60 * 1000;
export const BILLING_CHECKOUT_RESUME_PATH = '/billing';

export type BillingCheckoutKind = 'subscription' | 'token-pack' | 'vc-token-pack' | 'vn-token-pack';

export type BillingCheckoutSelection =
  | {
      planKey: BillingPlanKey;
      couponCode?: string;
    }
  | {
      packKey: TokenPackKey;
    }
  | {
      vcPackKey: BillingVcPackCatalogKey;
    }
  | {
      vnPackKey: VnTokenPackKey;
    };

export interface BillingCheckoutIntent {
  kind: BillingCheckoutKind;
  selection: BillingCheckoutSelection;
  authMode: AuthRouteMode;
  resumePath: string;
  createdAt: number;
  expiresAt: number;
}

export interface BillingCheckoutIntentDraft {
  kind: BillingCheckoutKind;
  selection: BillingCheckoutSelection;
  authMode: AuthRouteMode;
  resumePath?: string | null;
  createdAt?: number;
  ttlMs?: number;
}

const VALID_BILLING_PLAN_KEYS = new Set<BillingPlanKey>(['launcher', 'starter', 'creator', 'pro', 'scale']);
const VALID_TOKEN_PACK_KEYS = new Set<TokenPackKey>(['micro', 'standard', 'mega', 'ultra']);
const VALID_VC_PACK_KEYS = new Set<BillingVcPackCatalogKey>(['starter', 'standard', 'growth', 'pro', 'scale']);
const VALID_VN_PACK_KEYS = new Set<VnTokenPackKey>(['vn_micro', 'vn_standard', 'vn_mega', 'vn_ultra']);

const isAuthRouteMode = (value: unknown): value is AuthRouteMode => value === 'login' || value === 'signup';

const normalizeNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSelection = (kind: BillingCheckoutKind, selection: BillingCheckoutSelection | null | undefined): BillingCheckoutSelection | null => {
  if (!selection || typeof selection !== 'object') return null;
  if (kind === 'subscription') {
    const planKey = String((selection as { planKey?: unknown }).planKey || '').trim() as BillingPlanKey;
    if (!VALID_BILLING_PLAN_KEYS.has(planKey)) return null;
    const couponCode = String((selection as { couponCode?: unknown }).couponCode || '').trim();
    return couponCode ? { planKey, couponCode } : { planKey };
  }

  const packKey = String((selection as { packKey?: unknown }).packKey || '').trim() as TokenPackKey;
  if (kind === 'token-pack') {
    if (!VALID_TOKEN_PACK_KEYS.has(packKey)) return null;
    return { packKey };
  }

  const vcPackKey = String((selection as { vcPackKey?: unknown }).vcPackKey || '').trim() as BillingVcPackCatalogKey;
  if (kind === 'vc-token-pack') {
    if (!VALID_VC_PACK_KEYS.has(vcPackKey)) return null;
    return { vcPackKey };
  }

  const vnPackKey = String((selection as { vnPackKey?: unknown }).vnPackKey || '').trim() as VnTokenPackKey;
  if (kind === 'vn-token-pack') {
    if (!VALID_VN_PACK_KEYS.has(vnPackKey)) return null;
    return { vnPackKey };
  }

  return null;
};

const normalizeIntent = (value: unknown, now = Date.now()): BillingCheckoutIntent | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<BillingCheckoutIntent> & {
    kind?: unknown;
    selection?: BillingCheckoutSelection | null;
    authMode?: unknown;
    resumePath?: unknown;
    createdAt?: unknown;
    expiresAt?: unknown;
  };
  const kind = raw.kind === 'subscription' || raw.kind === 'token-pack' || raw.kind === 'vc-token-pack' || raw.kind === 'vn-token-pack' ? raw.kind : null;
  if (!kind) return null;
  const authMode = isAuthRouteMode(raw.authMode) ? raw.authMode : null;
  if (!authMode) return null;
  const selection = normalizeSelection(kind, raw.selection);
  if (!selection) return null;
  const createdAt = normalizeNumber(raw.createdAt, now);
  const ttlMs = Math.max(1, normalizeNumber(Number(raw.expiresAt) - createdAt, BILLING_CHECKOUT_INTENT_TTL_MS));
  const expiresAt = normalizeNumber(raw.expiresAt, createdAt + ttlMs);
  const resumePath = resolveSafeInternalNextPath(raw.resumePath as string | null | undefined, BILLING_CHECKOUT_RESUME_PATH);
  if (!resumePath) return null;
  return {
    kind,
    selection,
    authMode,
    resumePath,
    createdAt,
    expiresAt,
  };
};

export const isBillingCheckoutIntentExpired = (intent: BillingCheckoutIntent, now = Date.now()): boolean => {
  return normalizeNumber(intent?.expiresAt, 0) <= normalizeNumber(now, Date.now());
};

export const createBillingCheckoutIntent = (
  draft: BillingCheckoutIntentDraft,
  now = Date.now()
): BillingCheckoutIntent | null => {
  const kind = draft.kind === 'subscription' || draft.kind === 'token-pack' || draft.kind === 'vc-token-pack' || draft.kind === 'vn-token-pack' ? draft.kind : null;
  if (!kind) return null;
  const authMode = isAuthRouteMode(draft.authMode) ? draft.authMode : null;
  if (!authMode) return null;
  const selection = normalizeSelection(kind, draft.selection);
  if (!selection) return null;
  const createdAt = normalizeNumber(draft.createdAt, now);
  const ttlMs = Math.max(1, normalizeNumber(draft.ttlMs, BILLING_CHECKOUT_INTENT_TTL_MS));
  const expiresAt = createdAt + ttlMs;
  const resumePath = resolveSafeInternalNextPath(draft.resumePath, BILLING_CHECKOUT_RESUME_PATH);
  if (!resumePath) return null;
  return {
    kind,
    selection,
    authMode,
    resumePath,
    createdAt,
    expiresAt,
  };
};

export const readBillingCheckoutIntent = (now = Date.now()): BillingCheckoutIntent | null => {
  const stored = readStorageJson<unknown>(STORAGE_KEYS.checkoutIntent);
  const intent = normalizeIntent(stored, now);
  if (!intent) {
    removeStorageKey(STORAGE_KEYS.checkoutIntent);
    return null;
  }
  if (isBillingCheckoutIntentExpired(intent, now)) {
    removeStorageKey(STORAGE_KEYS.checkoutIntent);
    return null;
  }
  return intent;
};

export const writeBillingCheckoutIntent = (draft: BillingCheckoutIntentDraft, now = Date.now()): BillingCheckoutIntent | null => {
  const intent = createBillingCheckoutIntent(draft, now);
  if (!intent) return null;
  writeStorageJson(STORAGE_KEYS.checkoutIntent, intent);
  return intent;
};

export const consumeBillingCheckoutIntent = (now = Date.now()): BillingCheckoutIntent | null => {
  const intent = readBillingCheckoutIntent(now);
  if (!intent) return null;
  removeStorageKey(STORAGE_KEYS.checkoutIntent);
  return intent;
};

export const clearBillingCheckoutIntent = (): void => {
  removeStorageKey(STORAGE_KEYS.checkoutIntent);
};
