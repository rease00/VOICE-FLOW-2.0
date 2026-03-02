import { GenerationSettings, UserStats, UserWalletStats, VfEngineUsage, VfUsageStats, VfUsageWindow } from '../types';

export const VF_UNIT = 'VF' as const;
export const VF_ENGINE_RATES: Record<GenerationSettings['engine'], number> = {
  KOKORO: 1,
  NEURAL2: 1.2,
  GEM: 1.5,
};

const sanitizeEngineRate = (value: unknown, fallback: number): number => {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : fallback;
};

const sanitizeRateMap = (value: any): Record<GenerationSettings['engine'], number> => ({
  GEM: sanitizeEngineRate(value?.GEM, VF_ENGINE_RATES.GEM),
  NEURAL2: sanitizeEngineRate(value?.NEURAL2, VF_ENGINE_RATES.NEURAL2),
  KOKORO: sanitizeEngineRate(value?.KOKORO, VF_ENGINE_RATES.KOKORO),
});

const createEngineUsage = (): VfEngineUsage => ({ chars: 0, vf: 0 });

const createWindow = (key: string): VfUsageWindow => ({
  key,
  totalChars: 0,
  totalVf: 0,
  byEngine: {
    GEM: createEngineUsage(),
    NEURAL2: createEngineUsage(),
    KOKORO: createEngineUsage(),
  },
});

export const getLocalDayKey = (date = new Date()): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const getLocalMonthKey = (date = new Date()): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

export const createEmptyVfUsageStats = (): VfUsageStats => ({
  unit: VF_UNIT,
  rates: { ...VF_ENGINE_RATES },
  daily: createWindow(getLocalDayKey()),
  monthly: createWindow(getLocalMonthKey()),
  lifetime: createWindow('lifetime'),
  lastRecordedAt: undefined,
});

export const createEmptyWalletStats = (): UserWalletStats => ({
  monthlyFreeRemaining: 0,
  monthlyFreeLimit: 0,
  vffBalance: 0,
  paidVfBalance: 0,
  spendableNowByEngine: {
    GEM: 0,
    NEURAL2: 0,
    KOKORO: 0,
  },
  adClaimsToday: 0,
  adClaimsDailyLimit: 3,
  vffMonthKey: undefined,
});

const sanitizeEngineUsage = (value: any): VfEngineUsage => ({
  chars: Number.isFinite(value?.chars) ? Math.max(0, Math.floor(value.chars)) : 0,
  vf: Number.isFinite(value?.vf) ? Math.max(0, Number(value.vf)) : 0,
});

const sanitizeWindow = (value: any, key: string): VfUsageWindow => ({
  key: typeof value?.key === 'string' && value.key.trim() ? value.key : key,
  totalChars: Number.isFinite(value?.totalChars) ? Math.max(0, Math.floor(value.totalChars)) : 0,
  totalVf: Number.isFinite(value?.totalVf) ? Math.max(0, Number(value.totalVf)) : 0,
  byEngine: {
    GEM: sanitizeEngineUsage(value?.byEngine?.GEM),
    NEURAL2: sanitizeEngineUsage(value?.byEngine?.NEURAL2),
    KOKORO: sanitizeEngineUsage(value?.byEngine?.KOKORO),
  },
});

export const ensureVfUsageStats = (value: unknown): VfUsageStats => {
  const fallback = createEmptyVfUsageStats();
  const raw = (value && typeof value === 'object') ? value as any : {};
  const dailyKey = getLocalDayKey();
  const monthlyKey = getLocalMonthKey();

  const daily = sanitizeWindow(raw.daily, dailyKey);
  const monthly = sanitizeWindow(raw.monthly, monthlyKey);
  const lifetime = sanitizeWindow(raw.lifetime, 'lifetime');

  return {
    unit: VF_UNIT,
    rates: sanitizeRateMap(raw.rates),
    daily: daily.key === dailyKey ? daily : createWindow(dailyKey),
    monthly: monthly.key === monthlyKey ? monthly : createWindow(monthlyKey),
    lifetime,
    lastRecordedAt: Number.isFinite(raw.lastRecordedAt) ? Number(raw.lastRecordedAt) : fallback.lastRecordedAt,
  };
};

const applyWindowDelta = (
  window: VfUsageWindow,
  engine: GenerationSettings['engine'],
  chars: number,
  vf: number
): VfUsageWindow => {
  const engineUsage = window.byEngine[engine] || createEngineUsage();
  return {
    ...window,
    totalChars: window.totalChars + chars,
    totalVf: window.totalVf + vf,
    byEngine: {
      ...window.byEngine,
      [engine]: {
        chars: engineUsage.chars + chars,
        vf: engineUsage.vf + vf,
      },
    },
  };
};

const normalizeCharCount = (charCount: number): number => {
  if (!Number.isFinite(charCount)) return 0;
  return Math.max(0, Math.floor(charCount));
};

export const recordUsageOnStats = (
  stats: UserStats,
  engine: GenerationSettings['engine'],
  charCount: number,
  now = new Date()
): UserStats => {
  const chars = normalizeCharCount(charCount);
  if (chars <= 0) return stats;

  const usage = ensureVfUsageStats(stats.vfUsage);
  const dayKey = getLocalDayKey(now);
  const monthKey = getLocalMonthKey(now);
  const rate = Number.isFinite(usage.rates?.[engine]) ? usage.rates[engine] : VF_ENGINE_RATES[engine] || 0;
  const vf = chars * rate;

  const dayWindow = usage.daily.key === dayKey ? usage.daily : createWindow(dayKey);
  const monthWindow = usage.monthly.key === monthKey ? usage.monthly : createWindow(monthKey);

  return {
    ...stats,
    vfUsage: {
      ...usage,
      daily: applyWindowDelta(dayWindow, engine, chars, vf),
      monthly: applyWindowDelta(monthWindow, engine, chars, vf),
      lifetime: applyWindowDelta(usage.lifetime, engine, chars, vf),
      lastRecordedAt: now.getTime(),
    },
  };
};

export const ensureStatsUsageWindows = (stats: UserStats, now = new Date()): UserStats => {
  const usage = ensureVfUsageStats(stats.vfUsage);
  const dayKey = getLocalDayKey(now);
  const monthKey = getLocalMonthKey(now);
  const daily = usage.daily.key === dayKey ? usage.daily : createWindow(dayKey);
  const monthly = usage.monthly.key === monthKey ? usage.monthly : createWindow(monthKey);
  if (daily === usage.daily && monthly === usage.monthly) {
    return { ...stats, vfUsage: usage };
  }
  return {
    ...stats,
    vfUsage: {
      ...usage,
      daily,
      monthly,
    },
  };
};
