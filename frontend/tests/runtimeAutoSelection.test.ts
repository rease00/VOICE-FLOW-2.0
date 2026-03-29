import { describe, expect, it } from 'vitest';
import {
  pickLowestLatencyRuntimeEngine,
  pickLowestLatencyServerRuntimeEngine,
} from '../src/shared/runtime/runtimeAutoSelection';

describe('runtimeAutoSelection', () => {
  it('allows Basic/DUNO to participate in server runtime auto-selection', () => {
    const selected = pickLowestLatencyServerRuntimeEngine({
      DUNO: { state: 'online', latencyMs: 12 },
      VECTOR: { state: 'online', latencyMs: 20 },
      PRIME: { state: 'online', latencyMs: 25 },
    });

    expect(selected).toBe('DUNO');
  });

  it('still respects the lowest latency ordering across all engines', () => {
    const selected = pickLowestLatencyRuntimeEngine({
      DUNO: { state: 'online', latencyMs: 15 },
      VECTOR: { state: 'online', latencyMs: 8 },
      PRIME: { state: 'online', latencyMs: 13 },
    });

    expect(selected).toBe('VECTOR');
  });

  it('does not treat standby runtimes as online candidates', () => {
    const selected = pickLowestLatencyRuntimeEngine({
      DUNO: { state: 'standby', latencyMs: 0 },
      VECTOR: { state: 'online', latencyMs: 12 },
      PRIME: { state: 'online', latencyMs: 25 },
    });

    expect(selected).toBe('VECTOR');
  });
});

