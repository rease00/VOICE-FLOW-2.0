'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSmartPollingOptions<T> {
  /** Initial polling interval in milliseconds (default: 1000) */
  initialInterval?: number;
  /** Maximum polling interval in milliseconds (default: 30000) */
  maxInterval?: number;
  /** Time in milliseconds before backoff increases (default: 30000) */
  noProgressDurationMs?: number;
  /** Time in milliseconds before going to max interval (default: 60000) */
  idleDurationMs?: number;
  /** Callback to determine if currently generating (default: checks data.isGenerating) */
  isGenerating?: (data: T | null) => boolean;
  /** Callback to determine if progress has been made */
  hasProgress?: (prevData: T | null, nextData: T) => boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** Auto start polling on mount */
  autoStart?: boolean;
  /** Disable polling entirely */
  disabled?: boolean;
}

export interface UseSmartPollingResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  isPolling: boolean;
  currentInterval: number;
  lastUpdated: number | null;
  refetch: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

/**
 * Smart polling hook with exponential backoff
 * Automatically adjusts polling interval based on generation status and progress
 *
 * Interval progression:
 * - Start: 1s (initial)
 * - While generating: 2s (fast feedback)
 * - No progress 30s: 5s (reduce load)
 * - Idle 60s: 30s (minimal load)
 * - Reset to 1s on generation start
 */
export function useSmartPolling<T>(
  queryFn: () => Promise<T>,
  options: UseSmartPollingOptions<T> = {}
): UseSmartPollingResult<T> {
  const {
    initialInterval = 1000,
    maxInterval = 30000,
    noProgressDurationMs = 30000,
    idleDurationMs = 60000,
    isGenerating: isGeneratingFn,
    hasProgress,
    debug = false,
    autoStart = false,
    disabled = false,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [currentInterval, setCurrentInterval] = useState(initialInterval);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const intervalIdRef = useRef<number | null>(null);
  const lastProgressRef = useRef<number>(Date.now());
  const lastGeneratingStateRef = useRef<boolean>(false);
  const previousDataRef = useRef<T | null>(null);

  // Default isGenerating check
  const checkIsGenerating = useCallback(
    (value: T | null): boolean => {
      if (isGeneratingFn) return isGeneratingFn(value);
      return (value as any)?.isGenerating ?? false;
    },
    [isGeneratingFn]
  );

  // Default progress check
  const checkProgress = useCallback(
    (prevData: T | null, nextData: T): boolean => {
      if (hasProgress) return hasProgress(prevData, nextData);
      // Default: consider it progress if data changed
      return JSON.stringify(prevData) !== JSON.stringify(nextData);
    },
    [hasProgress]
  );

  // Calculate appropriate polling interval
  const calculateInterval = useCallback(
    (now: number, isGenerating: boolean): number => {
      // Reset to initial when generating starts
      if (isGenerating && !lastGeneratingStateRef.current) {
        if (debug) console.log('[useSmartPolling] Generation started, resetting to initial interval');
        lastProgressRef.current = now;
        return initialInterval;
      }

      // While generating, use fast interval
      if (isGenerating) {
        return Math.min(initialInterval * 2, maxInterval);
      }

      // Not generating - check idle progression
      const timeSinceLastProgress = now - lastProgressRef.current;
      const timeSinceLastUpdate = lastUpdated ? now - lastUpdated : 0;

      if (timeSinceLastProgress > idleDurationMs) {
        // Been idle for 60s+, use max interval
        return maxInterval;
      } else if (timeSinceLastProgress > noProgressDurationMs) {
        // No progress for 30s+, use medium interval
        return Math.min(5000, maxInterval);
      }

      // Recent progress, use initial interval
      return initialInterval;
    },
    [initialInterval, maxInterval, noProgressDurationMs, idleDurationMs, debug, lastUpdated]
  );

  // Fetch data and update state
  const fetchData = useCallback(async () => {
    if (loading || disabled) return;

    setLoading(true);
    setError(null);

    try {
      const result = await queryFn();
      const now = Date.now();

      // Check if progress was made
      if (checkProgress(previousDataRef.current, result)) {
        lastProgressRef.current = now;
        if (debug) console.log('[useSmartPolling] Progress detected, resetting idle timer');
      }

      previousDataRef.current = result;
      setData(result);
      setLastUpdated(now);

      // Update generating state and interval
      const generating = checkIsGenerating(result);
      lastGeneratingStateRef.current = generating;

      const nextInterval = calculateInterval(now, generating);
      if (nextInterval !== currentInterval) {
        setCurrentInterval(nextInterval);
        if (debug) console.log(`[useSmartPolling] Interval updated: ${currentInterval}ms → ${nextInterval}ms`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      if (debug) console.error('[useSmartPolling] Query error:', error);
    } finally {
      setLoading(false);
    }
  }, [queryFn, loading, disabled, checkProgress, checkIsGenerating, calculateInterval, currentInterval, debug]);

  // Polling loop
  useEffect(() => {
    if (!isPolling || disabled) return;

    // Initial fetch
    void fetchData();

    // Setup interval
    const startPollingInterval = () => {
      if (intervalIdRef.current !== null) {
        clearInterval(intervalIdRef.current);
      }

      intervalIdRef.current = window.setInterval(() => {
        void fetchData();
      }, currentInterval);
    };

    startPollingInterval();

    return () => {
      if (intervalIdRef.current !== null) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, [isPolling, disabled, currentInterval, fetchData]);

  // Start/stop controls
  const startPolling = useCallback(() => {
    if (debug) console.log('[useSmartPolling] Starting poll');
    setIsPolling(true);
  }, [debug]);

  const stopPolling = useCallback(() => {
    if (debug) console.log('[useSmartPolling] Stopping poll');
    setIsPolling(false);
    if (intervalIdRef.current !== null) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
  }, [debug]);

  // Manual refetch
  const refetch = useCallback(async () => {
    if (debug) console.log('[useSmartPolling] Manual refetch');
    await fetchData();
  }, [fetchData, debug]);

  // Auto-start if configured
  useEffect(() => {
    if (autoStart && !disabled) {
      startPolling();
    }
  }, [autoStart, disabled, startPolling]);

  return {
    data,
    loading,
    error,
    isPolling,
    currentInterval,
    lastUpdated,
    refetch,
    startPolling,
    stopPolling,
  };
}
