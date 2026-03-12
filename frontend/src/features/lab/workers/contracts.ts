import type {
  LabCapabilityProfile,
  LabClip,
  LabEqPreset,
  LabJobKind,
} from '../../../../types';

export interface LabPcmData {
  sampleRate: number;
  length: number;
  durationMs: number;
  channels: Float32Array[];
}

export interface LabClipRenderInstruction {
  clipId: string;
  assetId: string;
  startMs: number;
  trimStartMs: number;
  trimEndMs: number;
  gain: number;
  muted: boolean;
  solo: boolean;
  playbackRate: number;
  pitchSemitones: number;
  fadeInMs: number;
  fadeOutMs: number;
  normalize: boolean;
  denoiseAmount: number;
  eqPreset: LabEqPreset;
}

export interface LabWorkerProgressPayload {
  kind: LabJobKind;
  progressPct: number;
  message: string;
  runtime?: string;
}

export interface MediaWaveformRequest {
  type: 'generate-waveform';
  requestId: string;
  audio: LabPcmData;
  coarseBuckets: number;
  detailBuckets: number;
}

export interface MediaRenderMixRequest {
  type: 'render-mix';
  requestId: string;
  audioByAssetId: Record<string, LabPcmData>;
  clips: LabClipRenderInstruction[];
  outputSampleRate: number;
  normalizeMaster: boolean;
}

export interface MediaEncodeWavRequest {
  type: 'encode-wav';
  requestId: string;
  audio: LabPcmData;
}

export type LabMediaWorkerRequest =
  | MediaWaveformRequest
  | MediaRenderMixRequest
  | MediaEncodeWavRequest;

export interface MediaWaveformResponse {
  type: 'waveform';
  requestId: string;
  coarse: number[];
  detail: number[];
  durationMs: number;
  sampleRate: number;
  channels: number;
}

export interface MediaRenderMixResponse {
  type: 'rendered-mix';
  requestId: string;
  audio: LabPcmData;
}

export interface MediaEncodeWavResponse {
  type: 'wav-blob';
  requestId: string;
  blob: Blob;
}

export interface LabWorkerProgressResponse {
  type: 'progress';
  requestId: string;
  payload: LabWorkerProgressPayload;
}

export interface LabWorkerErrorResponse {
  type: 'error';
  requestId: string;
  error: string;
}

export type LabMediaWorkerResponse =
  | MediaWaveformResponse
  | MediaRenderMixResponse
  | MediaEncodeWavResponse
  | LabWorkerProgressResponse
  | LabWorkerErrorResponse;

export interface SeparationRequest {
  type: 'separate-stems';
  requestId: string;
  audio: LabPcmData;
  capabilities: LabCapabilityProfile;
}

export interface SeparationResponse {
  type: 'separated-stems';
  requestId: string;
  runtime: string;
  voice: LabPcmData;
  background: LabPcmData;
}

export type LabSeparationWorkerRequest = SeparationRequest;
export type LabSeparationWorkerResponse =
  | SeparationResponse
  | LabWorkerProgressResponse
  | LabWorkerErrorResponse;

export const toRenderInstruction = (clip: LabClip): LabClipRenderInstruction => ({
  clipId: clip.id,
  assetId: clip.assetId,
  startMs: clip.startMs,
  trimStartMs: clip.trimStartMs,
  trimEndMs: clip.trimEndMs,
  gain: clip.gain,
  muted: clip.muted,
  solo: clip.solo,
  playbackRate: clip.playbackRate,
  pitchSemitones: clip.pitchSemitones,
  fadeInMs: clip.fadeInMs,
  fadeOutMs: clip.fadeOutMs,
  normalize: clip.normalize,
  denoiseAmount: clip.denoiseAmount,
  eqPreset: clip.eqPreset,
});
