import { describe, expect, it, vi } from 'vitest';

import { WorkerBridge } from '../src/features/lab/services/workerBridge';

type TestRequest = {
  requestId: string;
  value?: number;
};

type TestResponse =
  | {
      type: 'progress';
      requestId: string;
      payload: {
        progressPct: number;
        message: string;
        runtime?: string;
      };
    }
  | {
      type: 'done';
      requestId: string;
      value: number;
    }
  | {
      type: 'error';
      requestId: string;
      error: string;
    };

class MockWorker {
  onmessage: ((event: MessageEvent<TestResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

describe('WorkerBridge', () => {
  it('streams progress and resolves terminal responses', async () => {
    const worker = new MockWorker();
    const bridge = new WorkerBridge<TestRequest, TestResponse, Extract<TestResponse, { type: 'done' }>>(
      () => worker as unknown as Worker
    );
    const onProgress = vi.fn();

    const promise = bridge.run(
      { requestId: 'job_1', value: 7 },
      { onProgress }
    );

    worker.onmessage?.({
      data: {
        type: 'progress',
        requestId: 'job_1',
        payload: {
          progressPct: 50,
          message: 'Halfway there',
        },
      },
    } as MessageEvent<TestResponse>);

    worker.onmessage?.({
      data: {
        type: 'done',
        requestId: 'job_1',
        value: 14,
      },
    } as MessageEvent<TestResponse>);

    await expect(promise).resolves.toEqual({
      type: 'done',
      requestId: 'job_1',
      value: 14,
    });
    expect(onProgress).toHaveBeenCalledWith({
      progressPct: 50,
      message: 'Halfway there',
    });
  });

  it('rejects worker error responses', async () => {
    const worker = new MockWorker();
    const bridge = new WorkerBridge<TestRequest, TestResponse, Extract<TestResponse, { type: 'done' }>>(
      () => worker as unknown as Worker
    );

    const promise = bridge.run({ requestId: 'job_2' });
    worker.onmessage?.({
      data: {
        type: 'error',
        requestId: 'job_2',
        error: 'worker exploded',
      },
    } as MessageEvent<TestResponse>);

    await expect(promise).rejects.toThrow('worker exploded');
  });

  it('rejects aborted tasks and removes the listener cleanly', async () => {
    const worker = new MockWorker();
    const bridge = new WorkerBridge<TestRequest, TestResponse, Extract<TestResponse, { type: 'done' }>>(
      () => worker as unknown as Worker
    );
    const controller = new AbortController();

    const promise = bridge.run({ requestId: 'job_3' }, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
