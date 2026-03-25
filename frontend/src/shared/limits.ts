export const DEFAULT_DAILY_GENERATION_LIMIT = 50;
export const UNLIMITED_DAILY_GENERATION_LIMIT = 0;

const normalizeNonNegativeInteger = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(parsed));
};

export const normalizeDailyGenerationLimit = (value: unknown, fallback = DEFAULT_DAILY_GENERATION_LIMIT): number => (
  normalizeNonNegativeInteger(value, fallback)
);

export const formatDailyGenerationLimitLabel = (limit: number): string => {
  const normalized = normalizeNonNegativeInteger(limit, DEFAULT_DAILY_GENERATION_LIMIT);
  return normalized <= 0 ? 'Unlimited generations/day' : `${normalized.toLocaleString()} generations/day`;
};

export const formatDailyGenerationUsageLabel = (used: number, limit: number): string => {
  const normalizedUsed = normalizeNonNegativeInteger(used, 0);
  const normalizedLimit = normalizeNonNegativeInteger(limit, DEFAULT_DAILY_GENERATION_LIMIT);
  if (normalizedLimit <= 0) {
    return `${normalizedUsed.toLocaleString()} used today`;
  }
  const remaining = Math.max(0, normalizedLimit - normalizedUsed);
  return `${normalizedUsed.toLocaleString()} used, ${remaining.toLocaleString()} remaining`;
};
