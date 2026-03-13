export const KOKORO_STUDIO_THREAD_SHARE = 0.5;

export const resolveKokoroStudioThreadBudget = (
  hardwareConcurrency: unknown,
  share: number = KOKORO_STUDIO_THREAD_SHARE,
): number => {
  const numericCores = Number(hardwareConcurrency);
  if (!Number.isFinite(numericCores) || numericCores <= 0) return 1;

  const safeShare = Number.isFinite(share) && share > 0 ? share : KOKORO_STUDIO_THREAD_SHARE;
  return Math.max(1, Math.floor(numericCores * safeShare));
};
