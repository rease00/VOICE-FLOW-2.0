const UNIVERSAL_TTS_REQUESTS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

const requestLog = new Map<string, number[]>();

const getNow = (): number => Date.now();

const pruneWindow = (timestamps: number[], now: number): number[] => (
  timestamps.filter((timestamp) => now - timestamp < WINDOW_MS)
);

const getUserKey = (uid: string): string => String(uid || '').trim();

export interface UniversalTtsRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export const consumeUniversalTtsRateLimit = (uid: string): UniversalTtsRateLimitResult => {
  const userKey = getUserKey(uid);
  if (!userKey) {
    return {
      allowed: false,
      limit: UNIVERSAL_TTS_REQUESTS_PER_MINUTE,
      remaining: 0,
      retryAfterSeconds: 60,
    };
  }

  const now = getNow();
  const timestamps = pruneWindow(requestLog.get(userKey) || [], now);
  if (timestamps.length >= UNIVERSAL_TTS_REQUESTS_PER_MINUTE) {
    requestLog.set(userKey, timestamps);
    const oldestActiveTimestamp = timestamps[0] || now;
    const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now - oldestActiveTimestamp)) / 1000));
    return {
      allowed: false,
      limit: UNIVERSAL_TTS_REQUESTS_PER_MINUTE,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  timestamps.push(now);
  requestLog.set(userKey, timestamps);
  return {
    allowed: true,
    limit: UNIVERSAL_TTS_REQUESTS_PER_MINUTE,
    remaining: Math.max(0, UNIVERSAL_TTS_REQUESTS_PER_MINUTE - timestamps.length),
    retryAfterSeconds: 0,
  };
};

export const buildUniversalTtsRateLimitResponse = (retryAfterSeconds: number): Response => (
  Response.json(
    {
      error: 'RATE_LIMITED',
      code: 'TTS_RPM_LIMIT',
      message: `TTS is limited to ${UNIVERSAL_TTS_REQUESTS_PER_MINUTE} requests per minute per user.`,
      limit: UNIVERSAL_TTS_REQUESTS_PER_MINUTE,
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'Cache-Control': 'no-store',
      },
    },
  )
);

export const resetUniversalTtsRateLimitState = (): void => {
  requestLog.clear();
};

export const universalTtsRateLimit = {
  limit: UNIVERSAL_TTS_REQUESTS_PER_MINUTE,
  windowMs: WINDOW_MS,
};
