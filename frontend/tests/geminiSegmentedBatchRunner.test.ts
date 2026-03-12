import { describe, expect, it } from 'vitest';
import { runSegmentedBatchRunner } from '../services/geminiService';

describe('runSegmentedBatchRunner', () => {
  it('aborts during the final batch and never resolves with partial output', async () => {
    const controller = new AbortController();
    const processedSegments: number[] = [];

    const buildOutput = async (): Promise<string> => {
      await runSegmentedBatchRunner({
        segments: [0, 1, 2, 3],
        batchSize: 2,
        runSerially: true,
        signal: controller.signal,
        processSegment: async (segment) => {
          processedSegments.push(segment);
          if (segment === 2) {
            controller.abort();
          }
        },
      });
      return processedSegments.join(',');
    };

    await expect(buildOutput()).rejects.toMatchObject({ name: 'AbortError' });
    expect(processedSegments).toEqual([0, 1, 2]);
  });

  it('completes all segments when not aborted', async () => {
    const processedSegments: number[] = [];
    await runSegmentedBatchRunner({
      segments: [0, 1, 2],
      batchSize: 2,
      runSerially: false,
      processSegment: async (segment) => {
        processedSegments.push(segment);
      },
    });
    expect(processedSegments.sort((left, right) => left - right)).toEqual([0, 1, 2]);
  });
});
