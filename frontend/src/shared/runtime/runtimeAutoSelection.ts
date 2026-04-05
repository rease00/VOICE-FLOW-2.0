import type { GenerationSettings } from '../../../types';

export interface RuntimeLatencyCandidate {
  state?: string | undefined;
  latencyMs?: number | null | undefined;
}

const normalizeLatency = (value: unknown): number | null => {
  const latency = Number(value);
  if (!Number.isFinite(latency) || latency < 0) return null;
  return Math.floor(latency);
};

export const pickLowestLatencyRuntimeEngine = (
  candidates: Partial<Record<GenerationSettings['engine'], RuntimeLatencyCandidate | null | undefined>>,
  engineOrder: readonly GenerationSettings['engine'][] = ['VECTOR', 'PRIME']
): GenerationSettings['engine'] | null => {
  let selectedEngine: GenerationSettings['engine'] | null = null;
  let selectedLatencyMs = Number.POSITIVE_INFINITY;
  let selectedOrder = Number.POSITIVE_INFINITY;

  engineOrder.forEach((engine, order) => {
    const candidate = candidates[engine];
    if (!candidate) return;
    const state = String(candidate.state || '').trim().toLowerCase();
    if (state !== 'online') return;
    const latencyMs = normalizeLatency(candidate.latencyMs);
    if (latencyMs === null) return;

    if (
      selectedEngine === null
      || latencyMs < selectedLatencyMs
      || (latencyMs === selectedLatencyMs && order < selectedOrder)
    ) {
      selectedEngine = engine;
      selectedLatencyMs = latencyMs;
      selectedOrder = order;
    }
  });

  return selectedEngine;
};

export const pickLowestLatencyServerRuntimeEngine = (
  candidates: Partial<Record<GenerationSettings['engine'], RuntimeLatencyCandidate | null | undefined>>,
  engineOrder: readonly GenerationSettings['engine'][] = ['VECTOR', 'PRIME']
): GenerationSettings['engine'] | null => {
  return pickLowestLatencyRuntimeEngine(candidates, engineOrder);
};
