export interface SafeMediaVolumeErrorInfo {
  attemptedVolume: number;
  appliedFallback: number;
  context: string | null;
}

interface SafeMediaVolumeOptions {
  fallback?: number;
  context?: string;
  onError?: (error: unknown, info: SafeMediaVolumeErrorInfo) => void;
}

const clampUnitRange = (value: number): number => Math.max(0, Math.min(1, value));

export const normalizeMediaVolume = (value: unknown, fallback = 1): number => {
  const safeFallback = Number.isFinite(Number(fallback)) ? clampUnitRange(Number(fallback)) : 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return safeFallback;
  return clampUnitRange(parsed);
};

export const applySafeMediaVolume = (
  element: HTMLMediaElement | null | undefined,
  value: unknown,
  options?: SafeMediaVolumeOptions
): number => {
  const fallback = normalizeMediaVolume(options?.fallback ?? 1, 1);
  const nextVolume = normalizeMediaVolume(value, fallback);
  if (!element) return nextVolume;
  try {
    element.volume = nextVolume;
    return nextVolume;
  } catch (error) {
    try {
      element.volume = fallback;
    } catch {
      // If both assignments fail we still report the original setter error.
    }
    options?.onError?.(error, {
      attemptedVolume: nextVolume,
      appliedFallback: fallback,
      context: options?.context ? String(options.context) : null,
    });
    return fallback;
  }
};
