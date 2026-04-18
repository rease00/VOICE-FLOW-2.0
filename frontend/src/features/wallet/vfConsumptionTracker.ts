'use client';

import { useCallback, useEffect, useRef } from 'react';

const VF_SESSION_TOAST_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const TOAST_DURATION_MS = 3000;

interface VfConsumptionTrackerOptions {
  vfUsedThisSession: number;
  vfBalance: number;
  isPlaying: boolean;
  onToast?: (message: string) => void;
}

/**
 * Tracks VF consumption during active TTS playback.
 * Shows a non-blocking toast every 15 minutes with session usage + remaining balance.
 */
export function useVfConsumptionTracker({
  vfUsedThisSession,
  vfBalance,
  isPlaying,
  onToast,
}: VfConsumptionTrackerOptions): void {
  const lastToastRef = useRef<number>(0);
  const onToastRef = useRef(onToast);

  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastToastRef.current >= VF_SESSION_TOAST_INTERVAL_MS && vfUsedThisSession > 0) {
        lastToastRef.current = now;
        const message = `Used ${formatNumber(vfUsedThisSession)} VF this session | Balance: ${formatNumber(vfBalance)} VF`;
        onToastRef.current?.(message);
      }
    }, 60_000); // Check every minute

    return () => clearInterval(interval);
  }, [isPlaying, vfUsedThisSession, vfBalance]);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.max(0, n));
}

/**
 * Estimates VF cost for a text before TTS generation.
 */
export function estimateVfCost(
  charCount: number,
  vfRate: number,
  isCached: boolean
): number {
  const baseCost = charCount * vfRate;
  return isCached ? Math.ceil(baseCost * 0.5) : baseCost;
}

/**
 * Checks if user has sufficient VF balance for TTS generation.
 */
export function checkVfSufficiency(
  charCount: number,
  vfRate: number,
  vfBalance: number,
  isCached: boolean
): { sufficient: boolean; estimatedCost: number; deficit: number } {
  const estimatedCost = estimateVfCost(charCount, vfRate, isCached);
  const deficit = Math.max(0, estimatedCost - vfBalance);
  return {
    sufficient: deficit === 0,
    estimatedCost,
    deficit,
  };
}
