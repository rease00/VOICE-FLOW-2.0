import { getEngineDisplayName } from '../../../services/engineDisplay';
import type { GenerationSettings } from '../../../types';

export const PRIME_ACCESS_LOCK_MESSAGE = 'Prime is available on paid subscriptions or with paid token balance.';

export const normalizePlanToken = (planName: unknown): 'free' | 'launcher' | 'starter' | 'creator' | 'pro' | 'scale' => {
  const token = String(planName || '').trim().toLowerCase();
  if (token === 'launch' || token === 'launcher') return 'launcher';
  if (token === 'starter') return 'starter';
  if (token === 'creator') return 'creator';
  if (token === 'pro') return 'pro';
  if (token === 'scale' || token === 'plus' || token === 'pro_plus' || token === 'pro-plus') return 'scale';
  return 'free';
};

export const resolveTokenPackDiscountPercent = (
  planToken: ReturnType<typeof normalizePlanToken>,
  entitlementDiscount: number
): number => {
  if (Number.isFinite(entitlementDiscount) && entitlementDiscount > 0) {
    return Math.max(0, Math.round(entitlementDiscount));
  }
  if (planToken === 'launcher') return 0;
  if (planToken === 'starter') return 5;
  if (planToken === 'creator') return 5;
  if (planToken === 'pro') return 10;
  if (planToken === 'scale') return 15;
  return 0;
};

export const applyTokenPackDiscount = (baseAmountInr: number, discountPercent: number): number =>
  Math.max(1, Math.round(Math.max(0, Number(baseAmountInr || 0)) * (1 - (Math.max(0, Number(discountPercent || 0)) / 100))));

export const formatMobileAvailableCreditsPercent = (input: {
  hasUnlimitedAccess: boolean;
  monthlyFreeRemaining: number;
  monthlyFreeLimit: number;
  paidVfBalance?: number;
}): string => {
  if (input.hasUnlimitedAccess) return '100%';
  const freeRemaining = Math.max(0, Number(input.monthlyFreeRemaining || 0));
  const freeLimit = Math.max(0, Number(input.monthlyFreeLimit || 0));
  const paidBalance = Math.max(0, Number(input.paidVfBalance || 0));
  const available = Math.max(0, freeRemaining + paidBalance);
  const totalCapacity = Math.max(available, freeLimit + paidBalance);
  if (totalCapacity <= 0) return '0%';
  const percent = Math.max(0, Math.min(100, Math.round((available / totalCapacity) * 100)));
  return `${percent}%`;
};

const CANONICAL_ENGINE_TOKENS = new Set<GenerationSettings['engine']>(['VECTOR', 'PRIME']);
const LEGACY_ENGINE_TOKEN_MAP: Record<string, GenerationSettings['engine']> = {
  BASIC: 'VECTOR',
  GEMINI: 'PRIME',
  GEMINI_RUNTIME: 'PRIME',
  GEMINI_PRO: 'PRIME',
  GEMINI_V2: 'PRIME',
};

const normalizeEngineTokenKey = (value: unknown): string => (
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
);

export const resolveEngineToken = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const canonical = normalizeEngineTokenKey(raw);
  const legacy = LEGACY_ENGINE_TOKEN_MAP[canonical];
  if (legacy) return legacy;
  return CANONICAL_ENGINE_TOKENS.has(canonical as GenerationSettings['engine'])
    ? canonical
    : raw;
};

export const normalizeEngineToken = (
  value: unknown,
  fallback: GenerationSettings['engine'] = 'PRIME'
): GenerationSettings['engine'] => {
  const token = resolveEngineToken(value);
  if (token === 'VECTOR' || token === 'PRIME') return token;
  return fallback;
};

export const normalizeAllowedEngines = (value: unknown): GenerationSettings['engine'][] => {
  if (!Array.isArray(value)) return [];
  const out = new Set<GenerationSettings['engine']>();
  value.forEach((item) => {
    const normalized = resolveEngineToken(item);
    if (normalized === 'VECTOR' || normalized === 'PRIME') {
      out.add(normalized);
    }
  });
  return Array.from(out);
};

export const isPrimeAccessUnlocked = (input: {
  hasUnlimitedAccess?: boolean;
  isPaidBillingPlan?: boolean;
  paidVfBalance?: number;
}): boolean => (
  Boolean(input.hasUnlimitedAccess) ||
  Boolean(input.isPaidBillingPlan) ||
  Math.max(0, Number(input.paidVfBalance || 0)) > 0
);

export const resolvePrimeAllowedEngines = (input: {
  hasUnlimitedAccess?: boolean;
  isPaidBillingPlan?: boolean;
  paidVfBalance?: number;
}): GenerationSettings['engine'][] => (
  isPrimeAccessUnlocked(input) ? ['VECTOR', 'PRIME'] : ['VECTOR']
);

export interface EngineSelectorCopy {
  title: string;
  description: string;
}

export const getEngineSelectorCopy = (engine: GenerationSettings['engine']): EngineSelectorCopy =>
  ({
    title: getEngineDisplayName(engine),
    description: engine === 'VECTOR'
      ? 'Balanced quality with reliable performance.'
      : engine === 'PRIME'
        ? 'Premium synthesis for natural, polished output.'
        : 'Voice engine',
  } as EngineSelectorCopy);
