import { requestJson } from '../../shared/api/httpClient';
import type { ClonedVoice } from '../../../types';
import type {
  OpenVoiceBenchmarkRequest,
  OpenVoiceBenchmarkResponse,
  OpenVoiceBenchmarkStatusResponse,
} from './openvoiceTypes';

export type OpenVoiceCloneRequest = Omit<OpenVoiceBenchmarkRequest, 'mode' | 'runKind'> & {
  mode?: 'vc';
  runKind?: 'warm';
};

export interface OpenVoiceCloneResponse extends OpenVoiceBenchmarkResponse {
  clonedVoice?: ClonedVoice;
}

export const fetchOpenVoiceCloneStatus = async (
  options?: { baseUrl?: string; timeoutMs?: number }
): Promise<OpenVoiceBenchmarkStatusResponse> => requestJson<OpenVoiceBenchmarkStatusResponse>(
  '/voice-clone/openvoice/status',
  undefined,
  {
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);

export const cloneVoiceWithOpenVoice = async (
  payload: OpenVoiceCloneRequest,
  options?: { baseUrl?: string; timeoutMs?: number }
): Promise<OpenVoiceCloneResponse> => requestJson<OpenVoiceCloneResponse>(
  '/voice-clone/openvoice',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      mode: 'vc',
      runKind: 'warm',
    }),
  },
  {
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  }
);
