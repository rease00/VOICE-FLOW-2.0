import { authFetch } from './authHttpClient';
import { AccountEntitlements } from './accountService';

const FALLBACK_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';

const toBaseUrl = (input?: string): string => {
  const raw = String(input || FALLBACK_MEDIA_BACKEND_URL).trim();
  return raw.replace(/\/+$/, '');
};

const parseError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail.trim();
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
    return `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
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

export const fetchAdminUsers = async (
  baseUrl?: string,
  options?: { q?: string; limit?: number }
): Promise<AdminUserSummary[]> => {
  const query = new URLSearchParams();
  if (options?.q?.trim()) query.set('q', options.q.trim());
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  );
  if (!response.ok) throw new Error(await parseError(response));
  const payload = await response.json();
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
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  );
  if (!response.ok) throw new Error(await parseError(response));
  const payload = await response.json();
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
  if (!response.ok) throw new Error(await parseError(response));
};

export const revokeAdminUserSessions = async (uid: string, baseUrl?: string): Promise<void> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}/revoke-sessions`,
    { method: 'POST' },
    { requireAuth: true }
  );
  if (!response.ok) throw new Error(await parseError(response));
};

export const deleteAdminUser = async (uid: string, baseUrl?: string): Promise<void> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}`,
    { method: 'DELETE' },
    { requireAuth: true }
  );
  if (!response.ok) throw new Error(await parseError(response));
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
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  );
  if (!response.ok) throw new Error(await parseError(response));
  const payload = await response.json();
  return payload?.coupon as AdminCoupon;
};

export const fetchAdminCoupons = async (baseUrl?: string, limit = 100): Promise<AdminCoupon[]> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    { requireAuth: true }
  );
  if (!response.ok) throw new Error(await parseError(response));
  const payload = await response.json();
  return Array.isArray(payload?.coupons) ? (payload.coupons as AdminCoupon[]) : [];
};

export const patchAdminCoupon = async (
  couponId: string,
  patch: { active?: boolean; maxRedemptions?: number; expiresAt?: string; note?: string },
  baseUrl?: string
): Promise<AdminCoupon> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons/${encodeURIComponent(couponId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  );
  if (!response.ok) throw new Error(await parseError(response));
  const payload = await response.json();
  return payload?.coupon as AdminCoupon;
};
