import type { VoiceCloneBenchmarkStatusResponse } from './openvoiceTypes';

export const VOICE_CLONE_STATUS_RETRY_INTERVAL_MS = 15_000;
export const VOICE_CLONE_STATUS_UNHEALTHY_RETRY_INTERVAL_MS = 5 * 60_000;

export const resolveVoiceCloneStatusRetryDelayMs = (
  status: VoiceCloneBenchmarkStatusResponse | null | undefined,
  error?: unknown
): number => {
  if (Boolean(status?.ready)) {
    return 0;
  }

  if (error !== undefined) {
    return VOICE_CLONE_STATUS_UNHEALTHY_RETRY_INTERVAL_MS;
  }

  return VOICE_CLONE_STATUS_RETRY_INTERVAL_MS;
};

export const formatVoiceCloneStatusRetryDelayLabel = (delayMs: number): string => {
  const safeDelayMs = Math.max(0, Math.round(Number(delayMs || 0)));
  if (safeDelayMs <= 0) {
    return 'now';
  }

  if (safeDelayMs >= 60_000) {
    const minutes = Math.max(1, Math.round(safeDelayMs / 60_000));
    return `${minutes}m`;
  }

  const seconds = Math.max(1, Math.round(safeDelayMs / 1000));
  return `${seconds}s`;
};
