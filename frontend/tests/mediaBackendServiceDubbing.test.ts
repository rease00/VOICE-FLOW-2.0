import { describe, expect, it, vi } from 'vitest';

const mockCreateDubbingJobV2 = vi.fn(async () => ({ ok: true, job_id: 'job_123' }));
const mockGetDubbingJob = vi.fn(async () => ({ ok: true, job: { status: 'running', stage: 'speaker_segmentation', progress: 28 } }));
const mockGetDubbingJobWithOptions = vi.fn(async () => ({ ok: true, job: { status: 'running', stage: 'tts', progress: 66, chunks: [] } }));
const mockCancelDubbingJob = vi.fn(async () => ({ ok: true, job_id: 'job_123' }));
const mockDownloadChunk = vi.fn(async () => new Blob(['00'], { type: 'audio/wav' }));
const mockDownloadReport = vi.fn(async () => new Blob(['{}'], { type: 'application/json' }));
const mockDownloadResult = vi.fn(async () => new Blob(['00'], { type: 'video/mp4' }));

vi.mock('../src/shared/api/gatewayClient', () => ({
  createDubbingJobV2: (...args: unknown[]) => mockCreateDubbingJobV2(...args),
  getDubbingJob: (...args: unknown[]) => mockGetDubbingJob(...args),
  getDubbingJobWithOptions: (...args: unknown[]) => mockGetDubbingJobWithOptions(...args),
  cancelDubbingJob: (...args: unknown[]) => mockCancelDubbingJob(...args),
  downloadDubbingChunk: (...args: unknown[]) => mockDownloadChunk(...args),
  downloadDubbingReport: (...args: unknown[]) => mockDownloadReport(...args),
  downloadDubbingResult: (...args: unknown[]) => mockDownloadResult(...args),
  transcribeVideo: vi.fn(),
  separateStem: vi.fn(),
  switchTtsEngine: vi.fn(),
  tailRuntimeLogs: vi.fn(),
  fetchTtsEngineCapabilities: vi.fn(),
  muxDubbedVideo: vi.fn(),
}));

vi.mock('../src/shared/api/config', () => ({
  resolveApiBaseUrl: (input?: string) => (input || 'http://127.0.0.1:7800').replace(/\/+$/, ''),
}));

vi.mock('../src/shared/api/httpClient', () => ({
  requestJson: vi.fn(),
  requestBlob: vi.fn(),
}));

import {
  cancelDubbingJob,
  createDubbingJobV2,
  downloadDubbingChunk,
  downloadDubbingReport,
  downloadDubbingResult,
  getDubbingJob,
} from '../services/mediaBackendService';

describe('mediaBackendService dubbing v2 wrappers', () => {
  it('submits v2 job payload through gateway', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const result = await createDubbingJobV2('http://127.0.0.1:7800', file, {
      targetLanguage: 'hi',
      mode: 'strict_full',
      output: 'audio+video',
      advanced: { tts_route: 'auto' },
    });

    expect(result.ok).toBe(true);
    expect(result.job_id).toBe('job_123');
    expect(mockCreateDubbingJobV2).toHaveBeenCalledTimes(1);
    const [passedFile, options] = mockCreateDubbingJobV2.mock.calls[0] as [File, Record<string, unknown>];
    expect(passedFile.name).toBe('clip.mp4');
    expect(options.baseUrl).toBe('http://127.0.0.1:7800');
    expect(options.targetLanguage).toBe('hi');
    expect((options.advanced as Record<string, unknown>).tts_route).toBe('auto');
  });

  it('polls, cancels, and downloads job artifacts via gateway', async () => {
    const status = await getDubbingJob('http://127.0.0.1:7800/', 'job_123');
    const statusWithChunks = await getDubbingJob('http://127.0.0.1:7800/', 'job_123', {
      includeChunks: true,
      chunkCursor: 0,
      chunkLimit: 4,
      includeChunkAudio: false,
    });
    const cancel = await cancelDubbingJob('http://127.0.0.1:7800/', 'job_123');
    const chunk = await downloadDubbingChunk('http://127.0.0.1:7800/', 'job_123', 0);
    const report = await downloadDubbingReport('http://127.0.0.1:7800/', 'job_123');
    const result = await downloadDubbingResult('http://127.0.0.1:7800/', 'job_123');

    expect(status.ok).toBe(true);
    expect(statusWithChunks.ok).toBe(true);
    expect(cancel.ok).toBe(true);
    expect(chunk.type).toBe('audio/wav');
    expect(report.type).toBe('application/json');
    expect(result.type).toBe('video/mp4');
    expect(mockGetDubbingJob).toHaveBeenCalledWith('job_123', 'http://127.0.0.1:7800');
    expect(mockGetDubbingJobWithOptions).toHaveBeenCalledWith('job_123', {
      includeChunks: true,
      chunkCursor: 0,
      chunkLimit: 4,
      includeChunkAudio: false,
      baseUrl: 'http://127.0.0.1:7800',
    });
    expect(mockCancelDubbingJob).toHaveBeenCalledWith('job_123', 'http://127.0.0.1:7800');
    expect(mockDownloadChunk).toHaveBeenCalledWith('job_123', 0, 'http://127.0.0.1:7800');
    expect(mockDownloadReport).toHaveBeenCalledWith('job_123', 'http://127.0.0.1:7800');
    expect(mockDownloadResult).toHaveBeenCalledWith('job_123', 'http://127.0.0.1:7800');
  });
});
