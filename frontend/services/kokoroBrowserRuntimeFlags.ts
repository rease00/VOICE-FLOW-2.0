const parseBooleanFlag = (value: unknown): boolean | undefined => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
};

const hasBrowserKokoroRuntimeSupport = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (typeof fetch !== 'function') return false;
  if (typeof WebAssembly === 'undefined') return false;
  if (window.isSecureContext === false) return false;
  return true;
};

const hasEligibleBrowserComputeBudget = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0);
  const hardwareConcurrency = Number(navigator.hardwareConcurrency || 0);
  return deviceMemory >= 8 && hardwareConcurrency >= 6;
};

export const isBrowserKokoroExecutionEnabled = (): boolean => {
  const envOverride = parseBooleanFlag(import.meta.env.VITE_ENABLE_BROWSER_KOKORO);
  if (envOverride === false) return false;
  if (!hasBrowserKokoroRuntimeSupport()) return false;
  if (!hasEligibleBrowserComputeBudget()) return false;
  return envOverride ?? true;
};

export const shouldUseBrowserKokoroExecution = (
  engine: string,
  context: 'studio' | 'preview' | 'dubbing' | undefined,
): boolean => {
  if (!isBrowserKokoroExecutionEnabled()) return false;
  const normalizedEngine = String(engine || '').trim().toUpperCase();
  if (normalizedEngine !== 'KOKORO') return false;
  return context === 'studio' || context === 'preview';
};
