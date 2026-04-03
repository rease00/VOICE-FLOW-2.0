import { describe, expect, it } from 'vitest';
import { findFirstRecoverableStudioQueueItem, hasRecoverableSingleInflightGenerationState } from '../src/app/workspace/MainApp';

describe('MainApp queue resume helper', () => {
  it('selects the earliest cancelled item when resuming a queue with no active work', () => {
    const candidate = findFirstRecoverableStudioQueueItem([
      { id: 'queued-1', order: 1, status: 'queued' },
      { id: 'cancelled-1', order: 2, status: 'cancelled' },
      { id: 'failed-1', order: 3, status: 'failed' },
    ] as any);

    expect(candidate?.id).toBe('cancelled-1');
    expect(candidate?.status).toBe('cancelled');
  });

  it('still finds a cancelled item when it is the only recoverable entry', () => {
    const candidate = findFirstRecoverableStudioQueueItem([
      { id: 'done-1', order: 1, status: 'completed' },
      { id: 'cancelled-1', order: 2, status: 'cancelled' },
    ] as any);

    expect(candidate?.id).toBe('cancelled-1');
  });

  it('treats requestId-only inflight state as recoverable', () => {
    expect(hasRecoverableSingleInflightGenerationState({ requestId: 'req-1', jobId: '' } as any)).toBe(true);
    expect(hasRecoverableSingleInflightGenerationState({ requestId: '', jobId: 'job-1' } as any)).toBe(true);
    expect(hasRecoverableSingleInflightGenerationState({ requestId: '', jobId: '' } as any)).toBe(false);
  });
});
