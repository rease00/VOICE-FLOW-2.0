import { describe, expect, it } from 'vitest';
import { normalizeAllowedEngines, resolveEngineToken } from '../views/mainAppHelpers';

describe('mainAppHelpers engine token handling', () => {
  it('preserves legacy engine tokens instead of silently mapping them to PRIME', () => {
    expect(resolveEngineToken('prime_v2')).toBe('prime_v2');
    expect(resolveEngineToken('vector')).toBe('VECTOR');
  });

  it('only keeps canonical engines when normalizing allowed engine lists', () => {
    expect(normalizeAllowedEngines(['DUNO', 'legacy', 'prime_v2', 'VECTOR', 'PRIME'])).toEqual([
      'DUNO',
      'VECTOR',
      'PRIME',
    ]);
  });
});
