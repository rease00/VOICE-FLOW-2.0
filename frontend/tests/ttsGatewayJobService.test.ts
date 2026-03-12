import { describe, expect, it, vi } from 'vitest';
import { pollTtsGatewayJobForAudio } from '../services/ttsGatewayJobService';

const toBuffer = (bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer;

describe('pollTtsGatewayJobForAudio', () => {
  it('polls status without inline result and fetches final payload exactly once', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, jobId: 'job-1', status: 'queued' })
      .mockResolvedValueOnce({ ok: true, jobId: 'job-1', status: 'running' })
      .mockResolvedValueOnce({ ok: true, jobId: 'job-1', status: 'completed' });
    const fetchResult = vi
      .fn()
      .mockResolvedValue({ audioBytes: toBuffer([1, 2, 3]), responseHeaders: { 'X-Trace-Id': 'trace_1' } });

    const result = await pollTtsGatewayJobForAudio({
      jobId: 'job-1',
      runtimeLabel: 'Gemini runtime',
      engine: 'GEM',
      pollMs: 0,
      pollMaxMs: 0,
      timeoutMs: 5_000,
      client: {
        getJob,
        fetchResult,
        fetchChunkAudio: vi.fn().mockResolvedValue(toBuffer([])),
        cancelJob: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    expect(new Uint8Array(result.audioBytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.responseHeaders).toEqual({ 'x-trace-id': 'trace_1' });
    expect(fetchResult).toHaveBeenCalledTimes(1);
    expect(getJob).toHaveBeenCalledTimes(3);
    expect(getJob.mock.calls.every(([, options]) => options?.includeResult === false)).toBe(true);
  });

  it('uses inline completed payload when already present and skips extra fetch', async () => {
    const inlineBytes = [9, 8, 7, 6];
    const getJob = vi.fn().mockResolvedValue({
      ok: true,
      jobId: 'job-inline',
      status: 'completed',
      result: {
        audioBase64: Buffer.from(inlineBytes).toString('base64'),
        headers: {
          'X-Direct': 'inline',
        },
      },
    });
    const fetchResult = vi.fn();

    const result = await pollTtsGatewayJobForAudio({
      jobId: 'job-inline',
      runtimeLabel: 'Gemini runtime',
      engine: 'GEM',
      pollMs: 0,
      pollMaxMs: 0,
      timeoutMs: 5_000,
      client: {
        getJob,
        fetchResult,
        fetchChunkAudio: vi.fn().mockResolvedValue(toBuffer([])),
        cancelJob: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    expect(new Uint8Array(result.audioBytes)).toEqual(new Uint8Array(inlineBytes));
    expect(result.responseHeaders).toEqual({ 'x-direct': 'inline' });
    expect(fetchResult).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(getJob.mock.calls[0]?.[1]?.includeResult).toBe(false);
  });
});
