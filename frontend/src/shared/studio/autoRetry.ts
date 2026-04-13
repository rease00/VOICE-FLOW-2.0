const TRANSIENT_ERROR_PATTERNS = [
  /network/i,
  /fetch failed/i,
  /failed to fetch/i,
  /econnrefused/i,
  /timeout/i,
  /timed? ?out/i,
  /503/i,
  /502/i,
  /429/i,
  /too many requests/i,
  /service unavailable/i,
  /bad gateway/i,
  /rate limit/i,
  /quota.*exceeded/i,
  /resource exhausted/i,
  /aborted/i,
  /AbortError/i,
];

const PERMANENT_ERROR_PATTERNS = [
  /400/i,
  /401/i,
  /403/i,
  /unauthorized/i,
  /forbidden/i,
  /invalid.*request/i,
  /bad request/i,
];

export const classifyGenerationError = (error: unknown): 'transient' | 'permanent' | 'unknown' => {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return 'unknown';

  for (const pattern of PERMANENT_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'permanent';
  }

  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(message)) return 'transient';
  }

  return 'unknown';
};

export const AUTO_RETRY_DELAYS_MS = [2000, 4000, 8000];
export const MAX_AUTO_RETRIES = 3;

export interface AutoRetryOptions {
  maxRetries?: number;
  delays?: number[];
  onRetry?: (attempt: number, maxRetries: number) => void;
}

export const withAutoRetry = async <T>(
  fn: () => Promise<T>,
  options?: AutoRetryOptions
): Promise<T> => {
  const maxRetries = options?.maxRetries ?? MAX_AUTO_RETRIES;
  const delays = options?.delays ?? AUTO_RETRY_DELAYS_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (attempt >= maxRetries) break;

      const classification = classifyGenerationError(error);
      if (classification === 'permanent') throw error;

      if (classification === 'transient' || classification === 'unknown') {
        const delay = delays[Math.min(attempt, delays.length - 1)] || 8000;
        options?.onRetry?.(attempt + 1, maxRetries);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
};
