'use client';

import { authFetch } from './authHttpClient';
import { readJsonOrThrow } from '../src/shared/api/httpClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import type { VnTransaction } from '../types';

const toBaseUrl = (input?: string): string => resolveApiBaseUrl(input);

export const fetchVnTransactions = async (
  limit = 30,
  baseUrl?: string,
): Promise<VnTransaction[]> => {
  const payload = await readJsonOrThrow<{ transactions: VnTransaction[] }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/api/wallet/vn/transactions?limit=${Math.min(100, Math.max(1, limit))}`,
      { method: 'GET' },
      { requireAuth: true },
    ),
  );
  return payload?.transactions ?? [];
};

export const fetchVnBalance = async (
  baseUrl?: string,
): Promise<number> => {
  const payload = await readJsonOrThrow<{ vnBalance: number }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/api/wallet/vn/balance`,
      { method: 'GET' },
      { requireAuth: true },
    ),
  );
  return Math.max(0, Number(payload?.vnBalance || 0));
};
