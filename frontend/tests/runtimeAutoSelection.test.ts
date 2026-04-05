import { describe, expect, it } from 'vitest';
import {
  pickLowestLatencyRuntimeEngine,
  pickLowestLatencyServerRuntimeEngine,
} from '../src/shared/runtime/runtimeAutoSelection';

describe('runtimeAutoSelection', () => {
  it('prefers the lowest-latency active engine from the supported set', () => {
    const selected = pickLowestLatencyServerRuntimeEngine({
      VECTOR: { state: 'online', latencyMs: 20 },
      PRIME: { state: 'online', latencyMs: 25 },
    });

    expect(selected).toBe('VECTOR');
  });

  it('still respects the lowest latency ordering across all engines', () => {
    const selected = pickLowestLatencyRuntimeEngine({
      VECTOR: { state: 'online', latencyMs: 8 },
      PRIME: { state: 'online', latencyMs: 13 },
    });

    expect(selected).toBe('VECTOR');
  });

  it('does not treat standby runtimes as online candidates', () => {
    const selected = pickLowestLatencyRuntimeEngine({
      VECTOR: { state: 'online', latencyMs: 12 },
      PRIME: { state: 'online', latencyMs: 25 },
    });

    expect(selected).toBe('VECTOR');
  });
});

