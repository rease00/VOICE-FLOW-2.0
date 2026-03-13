import { describe, expect, it } from 'vitest';

import { resolveKokoroStudioThreadBudget } from '../services/kokoroStudioWorkerPolicy';

describe('resolveKokoroStudioThreadBudget', () => {
  it('allocates 50% of available cores for valid hardware concurrency values', () => {
    expect(resolveKokoroStudioThreadBudget(4)).toBe(2);
    expect(resolveKokoroStudioThreadBudget(6)).toBe(3);
    expect(resolveKokoroStudioThreadBudget(8)).toBe(4);
  });

  it('falls back to one thread for invalid or missing hardware data', () => {
    expect(resolveKokoroStudioThreadBudget(undefined)).toBe(1);
    expect(resolveKokoroStudioThreadBudget(null)).toBe(1);
    expect(resolveKokoroStudioThreadBudget('')).toBe(1);
    expect(resolveKokoroStudioThreadBudget(0)).toBe(1);
  });
});
