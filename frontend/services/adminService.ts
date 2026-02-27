import { authFetch } from './authHttpClient';
import { AccountEntitlements } from './accountService';
import { parseResponseError, readJsonOrThrow } from '../src/shared/api/httpClient';

const FALLBACK_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';

const toBaseUrl = (input?: string): string => {
  const raw = String(input || FALLBACK_MEDIA_BACKEND_URL).trim();
  return raw.replace(/\/+$/, '');
};

export interface AdminUserSummary {
  uid: string;
  email: string;
  displayName: string;
  disabled: boolean;
  admin: boolean;
  plan: 'Free' | 'Pro' | 'Plus';
  status: string;
  wallet: {
    paidVfBalance: number;
    vffBalance: number;
  };
  usage: {
    monthlyVfUsed: number;
    dailyGenerationUsed: number;
  };
}

export interface AdminCoupon {
  id: string;
  code: string;
  creditVf: number;
  active: boolean;
  maxRedemptions?: number;
  redeemedCount?: number;
  expiresAt?: string | null;
  note?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GeminiPoolStatusPayload {
  ok: boolean;
  backend?: {
    ok?: boolean;
    pool?: {
      keyCount?: number;
      healthyKeys?: number;
      unhealthyKeys?: number;
      atLimitKeys?: number;
    };
    source?: {
      configuredFilePath?: string;
      filePath?: string;
      fileExists?: boolean;
      fileKeyCount?: number;
      envPoolKeyCount?: number;
      singleKeyPresent?: boolean;
    };
    [key: string]: unknown;
  };
  runtime?: {
    ok?: boolean;
    configuredKeyFilePath?: string;
    keyFilePath?: string;
    pool?: {
      keyCount?: number;
      healthyKeys?: number;
      unhealthyKeys?: number;
      atLimitKeys?: number;
    };
    [key: string]: unknown;
  };
  runtimeReload?: Record<string, unknown>;
  detail?: string;
}

export interface DailyUsageResetSummary {
  ok: boolean;
  dryRun?: boolean;
  mode?: string;
  dayKey?: string;
  periodKey?: string;
  usersAffected?: number;
  docsCleared?: number;
  requestedBy?: string;
  ranAt?: string;
  reservedEventsToday?: number | null;
}

export interface DailyUsageResetStatusPayload {
  ok: boolean;
  status: 'never_run' | 'available';
  lastRun?: DailyUsageResetSummary;
}

export const fetchAdminUsers = async (
  baseUrl?: string,
  options?: { q?: string; limit?: number }
): Promise<AdminUserSummary[]> => {
  const query = new URLSearchParams();
  if (options?.q?.trim()) query.set('q', options.q.trim());
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const payload = await readJsonOrThrow<{ users?: AdminUserSummary[] }>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.users) ? (payload.users as AdminUserSummary[]) : [];
};

export const patchAdminUser = async (
  uid: string,
  patch: {
    plan?: 'Free' | 'Pro' | 'Plus' | string;
    paidVfDelta?: number;
    vffDelta?: number;
    disabled?: boolean;
  },
  baseUrl?: string
): Promise<AccountEntitlements> => {
  const payload = await readJsonOrThrow<{ entitlements: AccountEntitlements }>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload?.entitlements as AccountEntitlements;
};

export const resetAdminUserPassword = async (uid: string, newPassword: string, baseUrl?: string): Promise<void> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}/reset-password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    },
    { requireAuth: true }
  );
  if (!response.ok) throw await parseResponseError(response);
};

export const revokeAdminUserSessions = async (uid: string, baseUrl?: string): Promise<void> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}/revoke-sessions`,
    { method: 'POST' },
    { requireAuth: true }
  );
  if (!response.ok) throw await parseResponseError(response);
};

export const deleteAdminUser = async (uid: string, baseUrl?: string): Promise<void> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}`,
    { method: 'DELETE' },
    { requireAuth: true }
  );
  if (!response.ok) throw await parseResponseError(response);
};

export const createAdminCoupon = async (
  input: {
    code: string;
    creditVf: number;
    maxRedemptions?: number;
    expiresAt?: string;
    active?: boolean;
    note?: string;
  },
  baseUrl?: string
): Promise<AdminCoupon> => {
  const payload = await readJsonOrThrow<{ coupon: AdminCoupon }>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload?.coupon as AdminCoupon;
};

export const fetchAdminCoupons = async (baseUrl?: string, limit = 100): Promise<AdminCoupon[]> => {
  const payload = await readJsonOrThrow<{ coupons?: AdminCoupon[] }>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.coupons) ? (payload.coupons as AdminCoupon[]) : [];
};

export const patchAdminCoupon = async (
  couponId: string,
  patch: { active?: boolean; maxRedemptions?: number; expiresAt?: string; note?: string },
  baseUrl?: string
): Promise<AdminCoupon> => {
  const payload = await readJsonOrThrow<{ coupon: AdminCoupon }>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons/${encodeURIComponent(couponId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload?.coupon as AdminCoupon;
};

export const fetchGeminiPoolStatus = async (baseUrl?: string): Promise<GeminiPoolStatusPayload> => (
  readJsonOrThrow<GeminiPoolStatusPayload>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pool/status`,
    undefined,
    { requireAuth: true }
  ))
);

export const reloadGeminiPool = async (baseUrl?: string): Promise<GeminiPoolStatusPayload> => (
  readJsonOrThrow<GeminiPoolStatusPayload>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pool/reload`,
    { method: 'POST' },
    { requireAuth: true }
  ))
);

export const resetDailyUsageAll = async (baseUrl?: string, dryRun = false): Promise<DailyUsageResetSummary> => (
  readJsonOrThrow<DailyUsageResetSummary>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/usage/reset-daily-all${dryRun ? '?dryRun=1' : ''}`,
    { method: 'POST' },
    { requireAuth: true }
  ))
);

export const fetchDailyUsageResetStatus = async (baseUrl?: string): Promise<DailyUsageResetStatusPayload> => (
  readJsonOrThrow<DailyUsageResetStatusPayload>(await authFetch(
    `${toBaseUrl(baseUrl)}/admin/usage/reset-daily-all/status`,
    undefined,
    { requireAuth: true }
  ))
);
