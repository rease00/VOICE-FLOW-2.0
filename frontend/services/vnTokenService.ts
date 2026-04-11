'use client';

import { authFetch } from './authHttpClient';
import { readJsonOrThrow } from '../src/shared/api/httpClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import type { ChapterUnlockStatus, VnTransaction } from '../types';

const toBaseUrl = (input?: string): string => resolveApiBaseUrl(input);

// ─── Chapter unlock ─────────────────────────────────────────────────

export const unlockChapter = async (
  bookId: string,
  chapterId: string,
  baseUrl?: string
): Promise<{ unlockStatus: ChapterUnlockStatus; vnBalance: number }> => {
  const payload = await readJsonOrThrow<{
    unlockStatus: ChapterUnlockStatus;
    vnBalance: number;
  }>(
    await authFetch(`${toBaseUrl(baseUrl)}/api/books/${encodeURIComponent(bookId)}/chapters/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId }),
    }, { requireAuth: true })
  );
  return payload;
};

export const unlockFullNovel = async (
  bookId: string,
  baseUrl?: string
): Promise<{ vnBalance: number }> => {
  const payload = await readJsonOrThrow<{ vnBalance: number }>(
    await authFetch(`${toBaseUrl(baseUrl)}/api/books/${encodeURIComponent(bookId)}/unlock-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { requireAuth: true })
  );
  return payload;
};

export const checkChapterUnlockStatus = async (
  bookId: string,
  chapterId: string,
  baseUrl?: string
): Promise<ChapterUnlockStatus> => {
  const payload = await readJsonOrThrow<ChapterUnlockStatus>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/api/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}/status`,
      { method: 'GET' },
      { requireAuth: true }
    )
  );
  return payload;
};

// ─── Daily free unlock ──────────────────────────────────────────────

export const claimDailyFreeUnlock = async (
  bookId: string,
  chapterId: string,
  baseUrl?: string
): Promise<{ unlockStatus: ChapterUnlockStatus; dailyFreeUsed: boolean }> => {
  const payload = await readJsonOrThrow<{
    unlockStatus: ChapterUnlockStatus;
    dailyFreeUsed: boolean;
  }>(
    await authFetch(`${toBaseUrl(baseUrl)}/api/books/${encodeURIComponent(bookId)}/chapters/daily-free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId }),
    }, { requireAuth: true })
  );
  return payload;
};

// ─── Transaction history ────────────────────────────────────────────

export const fetchVnTransactions = async (
  limit = 30,
  baseUrl?: string
): Promise<VnTransaction[]> => {
  const payload = await readJsonOrThrow<{ transactions: VnTransaction[] }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/api/wallet/vn/transactions?limit=${Math.min(100, Math.max(1, limit))}`,
      { method: 'GET' },
      { requireAuth: true }
    )
  );
  return payload?.transactions ?? [];
};

// ─── VN Balance ─────────────────────────────────────────────────────

export const fetchVnBalance = async (
  baseUrl?: string
): Promise<number> => {
  const payload = await readJsonOrThrow<{ vnBalance: number }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/api/wallet/vn/balance`,
      { method: 'GET' },
      { requireAuth: true }
    )
  );
  return Math.max(0, Number(payload?.vnBalance || 0));
};
