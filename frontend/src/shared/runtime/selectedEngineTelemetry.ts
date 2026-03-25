export const SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT = 8;

export const appendRollingSample = <T,>(
  samples: readonly T[],
  sample: T,
  limit: number = SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT
): T[] => {
  const normalizedLimit = Math.max(1, Math.floor(Number(limit || 0)));
  const next = [...samples, sample];
  if (next.length <= normalizedLimit) return next;
  return next.slice(next.length - normalizedLimit);
};

export interface SelectedEngineTelemetryProbeState {
  kind?: string;
  measuredAtMs?: number;
}

const SELECTED_ENGINE_TELEMETRY_ERROR_REFRESH_STALE_MS = 5000;

export const shouldRefreshSelectedEngineTelemetry = (
  telemetry: SelectedEngineTelemetryProbeState | null | undefined,
  nowMs: number = Date.now(),
  staleAfterMs: number = SELECTED_ENGINE_TELEMETRY_ERROR_REFRESH_STALE_MS
): boolean => {
  const kind = String(telemetry?.kind || '').trim().toLowerCase();
  if (!kind) return true;
  if (kind === 'pending') return true;
  if (kind !== 'error') return false;

  const measuredAtMs = Number(telemetry?.measuredAtMs || 0);
  if (!Number.isFinite(measuredAtMs) || measuredAtMs <= 0) return true;

  const safeStaleAfterMs = Math.max(0, Math.floor(Number(staleAfterMs) || 0));
  return (nowMs - measuredAtMs) >= safeStaleAfterMs;
};
