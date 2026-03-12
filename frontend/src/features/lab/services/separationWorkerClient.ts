import type { LabCapabilityProfile } from '../../../../types';
import {
  type LabPcmData,
  type LabSeparationWorkerRequest,
  type LabSeparationWorkerResponse,
  type SeparationResponse,
} from '../workers/contracts';
import { WorkerBridge } from './workerBridge';

const createRequestId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

type SeparationTerminalResponse = Extract<LabSeparationWorkerResponse, { type: 'separated-stems' }>;

const bridge = new WorkerBridge<LabSeparationWorkerRequest, LabSeparationWorkerResponse, SeparationTerminalResponse>(
  () => new Worker(new URL('../workers/separation.worker.ts', import.meta.url), { type: 'module' })
);

export const runStemSeparationTask = async (
  audio: LabPcmData,
  capabilities: LabCapabilityProfile,
  options?: {
    signal?: AbortSignal;
    onProgress?: (payload: { progressPct: number; message: string; runtime?: string }) => void;
  }
): Promise<SeparationResponse> => {
  const workerOptions = {
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
  };
  const response = await bridge.run(
    {
      type: 'separate-stems',
      requestId: createRequestId('stem'),
      audio,
      capabilities,
    },
    workerOptions
  );
  if (response.type !== 'separated-stems') {
    throw new Error(`Unexpected separation worker response: ${response.type}`);
  }
  return response;
};

export const terminateSeparationWorker = (): void => {
  bridge.terminate();
};
