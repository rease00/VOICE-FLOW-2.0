/**
 * API Auth Middleware — Firebase Auth token verification + rate limiting
 *
 * Usage in API route:
 *   const auth = await requireAuth(request);
 *   if (auth.error) return auth.error;
 *   // auth.uid is the verified user ID
 */

import { NextResponse } from 'next/server';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../../server/firebaseAdmin';

/* ─── Token verification ─── */

interface AuthResult {
  uid: string;
  error?: never;
}

interface AuthError {
  uid?: never;
  error: NextResponse;
}

export async function requireAuth(request: Request): Promise<AuthResult | AuthError> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    return { error: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }) };
  }
}

/* ─── KYC requirement ─── */

export async function requireKyc(uid: string): Promise<NextResponse | null> {
  const db = getFirebaseAdminFirestore();
  const userDoc = await db.collection('users').doc(uid).get();
  const data = userDoc.data();
  if (data?.kycStatus !== 'verified') {
    return NextResponse.json(
      { error: 'KYC verification required for this action' },
      { status: 403 },
    );
  }
  return null;
}

/* ─── Rate limiting (in-memory, per-instance) ─── */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitRuntimeState {
  store: Map<string, RateLimitEntry>;
  cleanupInterval: ReturnType<typeof setInterval> | null;
}

const RATE_LIMIT_STATE_KEY = '__voiceFlowApiAuthRateLimitState__' as const;

type GlobalWithRateLimitState = typeof globalThis & {
  [RATE_LIMIT_STATE_KEY]?: RateLimitRuntimeState;
};

function getRateLimitRuntimeState(): RateLimitRuntimeState {
  const globalScope = globalThis as GlobalWithRateLimitState;
  const existingState = globalScope[RATE_LIMIT_STATE_KEY];
  if (existingState) return existingState;

  const createdState: RateLimitRuntimeState = {
    store: new Map<string, RateLimitEntry>(),
    cleanupInterval: null,
  };
  globalScope[RATE_LIMIT_STATE_KEY] = createdState;
  return createdState;
}

const rateLimitState = getRateLimitRuntimeState();
const rateLimitStore = rateLimitState.store;

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  purchases: { maxRequests: 100, windowMs: 86_400_000 } as RateLimitConfig,  // 100/day
  tts: { maxRequests: 30, windowMs: 60_000 } as RateLimitConfig,             // 30/min
  general: { maxRequests: 300, windowMs: 60_000 } as RateLimitConfig,        // 300/min
} as const;

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): NextResponse | null {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  if (entry.count >= config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      },
    );
  }

  entry.count++;
  return null;
}

/* ─── Input sanitization ─── */

export function sanitizePromptInput(value: string): string {
  return String(value || '')
    .replace(/["`${}]/g, '')
    .trim();
}

/* ─── Periodic cleanup for rate limit store ─── */

function cleanupExpiredRateLimitEntries() {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now >= entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

function ensureRateLimitCleanupInterval() {
  if (rateLimitState.cleanupInterval) return;

  rateLimitState.cleanupInterval = setInterval(() => {
    cleanupExpiredRateLimitEntries();
  }, 300_000); // Clean every 5 min

  // Avoid keeping Node.js processes alive solely for maintenance cleanup.
  const interval = rateLimitState.cleanupInterval as
    | (ReturnType<typeof setInterval> & { unref?: () => void })
    | null;
  interval?.unref?.();
}

if (typeof globalThis !== 'undefined') {
  ensureRateLimitCleanupInterval();
}
