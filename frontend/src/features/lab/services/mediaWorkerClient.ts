import type { LabClip } from '../../../../types';
import {
  toRenderInstruction,
  type LabMediaWorkerRequest,
  type LabMediaWorkerResponse,
  type LabPcmData,
  type MediaEncodeWavResponse,
  type MediaRenderMixResponse,
  type MediaWaveformResponse,
} from '../workers/contracts';
import { WorkerBridge } from './workerBridge';

const createRequestId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

type MediaTerminalResponse = Extract<LabMediaWorkerResponse, { type: 'waveform' | 'rendered-mix' | 'wav-blob' }>;

const bridge = new WorkerBridge<LabMediaWorkerRequest, LabMediaWorkerResponse, MediaTerminalResponse>(
  () => new Worker(new URL('../workers/media.worker.ts', import.meta.url), { type: 'module' })
);

export const runWaveformTask = async (
  audio: LabPcmData,
  options?: {
    coarseBuckets?: number;
    detailBuckets?: number;
  }
): Promise<MediaWaveformResponse> => {
  const response = await bridge.run({
    type: 'generate-waveform',
    requestId: createRequestId('waveform'),
    audio,
    coarseBuckets: options?.coarseBuckets ?? 180,
    detailBuckets: options?.detailBuckets ?? 720,
  });
  if (response.type !== 'waveform') {
    throw new Error(`Unexpected waveform worker response: ${response.type}`);
  }
  return response;
};

export const runMixRenderTask = async (
  clips: LabClip[],
  audioByAssetId: Record<string, LabPcmData>,
  options?: {
    outputSampleRate?: number;
    normalizeMaster?: boolean;
    signal?: AbortSignal;
    onProgress?: (payload: { progressPct: number; message: string; runtime?: string }) => void;
  }
): Promise<MediaRenderMixResponse> => {
  const workerOptions = {
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
  };
  const response = await bridge.run(
    {
      type: 'render-mix',
      requestId: createRequestId('mix'),
      audioByAssetId,
      clips: clips.map(toRenderInstruction),
      outputSampleRate: options?.outputSampleRate ?? 44100,
      normalizeMaster: options?.normalizeMaster ?? true,
    },
    workerOptions
  );
  if (response.type !== 'rendered-mix') {
    throw new Error(`Unexpected mix worker response: ${response.type}`);
  }
  return response;
};

export const runEncodeWavTask = async (audio: LabPcmData): Promise<MediaEncodeWavResponse> => {
  const response = await bridge.run({
    type: 'encode-wav',
    requestId: createRequestId('wav'),
    audio,
  });
  if (response.type !== 'wav-blob') {
    throw new Error(`Unexpected wav worker response: ${response.type}`);
  }
  return response;
};

export const terminateMediaWorker = (): void => {
  bridge.terminate();
};
