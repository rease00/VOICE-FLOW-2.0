import { readEnvValue } from '../src/shared/runtime/env';

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
  if (typeof navigator === 'undefined') return false;
  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  if (!gpu) return false;
  return true;
};

export const assertBrowserKokoroExecutionSupported = (): void => {
  if (typeof window === 'undefined') {
    throw new Error('Browser Kokoro execution requires a browser environment.');
  }
  if (typeof fetch !== 'function') {
    throw new Error('Browser Kokoro execution requires fetch support.');
  }
  if (typeof WebAssembly === 'undefined') {
    throw new Error('Browser Kokoro execution requires WebAssembly support.');
  }
  if (window.isSecureContext === false) {
    throw new Error('Browser Kokoro execution requires a secure context.');
  }
  const gpu = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { gpu?: unknown }).gpu;
  if (!gpu) {
    throw new Error('Browser Kokoro execution requires WebGPU support.');
  }
  const envOverride = parseBooleanFlag(
    readEnvValue(process.env.NEXT_PUBLIC_ENABLE_BROWSER_KOKORO, process.env.VITE_ENABLE_BROWSER_KOKORO)
  );
  if (envOverride === false) {
    throw new Error('Browser Kokoro execution is disabled by configuration.');
  }
};

export const isBrowserKokoroExecutionEnabled = (): boolean => {
  const envOverride = parseBooleanFlag(
    readEnvValue(process.env.NEXT_PUBLIC_ENABLE_BROWSER_KOKORO, process.env.VITE_ENABLE_BROWSER_KOKORO)
  );
  if (envOverride === false) return false;
  if (!hasBrowserKokoroRuntimeSupport()) return false;
  return envOverride ?? true;
};

export const shouldUseBrowserKokoroExecution = (
  engine: string,
  context: 'studio' | 'preview' | 'dubbing' | undefined,
): boolean => {
  if (!isBrowserKokoroExecutionEnabled()) return false;
  const normalizedEngine = String(engine || '').trim().toUpperCase();
  if (normalizedEngine !== 'KOKORO') return false;
  void context;
  return true;
};
