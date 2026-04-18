import { describe, expect, it } from 'vitest';

import {
  checkStudioGenerationBudget,
  checkStudioQueueBudget,
} from '../src/app/workspace/studioGenerationBudget';

describe('studio generation budget', () => {
  it('blocks single generation when estimated VF exceeds spendable balance', () => {
    const result = checkStudioGenerationBudget({
      charCount: 400,
      vfRate: 0.5,
      spendableBalance: 150,
      hasUnlimitedAccess: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.estimatedCost).toBe(200);
    expect(result.shortfall).toBe(50);
  });

  it('sums only billable queue items and ignores running items that already have a job id', () => {
    const result = checkStudioQueueBudget({
      items: [
        {
          id: 'done',
          order: 0,
          label: 'Part 1',
          status: 'completed',
          sourceText: 'done',
          charCount: 120,
          audioCacheKey: 'cache-1',
          settingsSnapshot: {} as never,
          createdAt: Date.now(),
        },
        {
          id: 'running',
          order: 1,
          label: 'Part 2',
          status: 'running',
          sourceText: 'running',
          charCount: 180,
          audioCacheKey: '',
          settingsSnapshot: {} as never,
          createdAt: Date.now(),
          jobId: 'job-1',
        },
        {
          id: 'queued',
          order: 2,
          label: 'Part 3',
          status: 'queued',
          sourceText: 'queued',
          charCount: 200,
          audioCacheKey: '',
          settingsSnapshot: {} as never,
          createdAt: Date.now(),
        },
      ],
      vfRate: 0.5,
      spendableBalance: 50,
      hasUnlimitedAccess: false,
    });

    expect(result.itemCount).toBe(1);
    expect(result.estimatedCost).toBe(100);
    expect(result.shortfall).toBe(50);
    expect(result.allowed).toBe(false);
  });
});
