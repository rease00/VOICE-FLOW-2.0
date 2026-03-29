import { arrayBufferToBase64 } from '../../shared/audio/base64';
import type { OpenVoiceStemSeparationRequest } from './api';

const DEFAULT_OPENVOICE_MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export interface OpenVoiceSourceTrimRange {
  startSec: number;
  endSec: number;
}

export interface BuildOpenVoiceStemSeparationRequestInput {
  sourceAudio: File;
  requestId: string;
  sourceSeparationModel?: string;
  sourceSeparationDevice?: string;
  trimRange?: OpenVoiceSourceTrimRange | null;
}

export const getOpenVoiceStemExtractionMaxBytes = (): number => {
  const raw = String(
    process.env.NEXT_PUBLIC_OPENVOICE_MAX_AUDIO_BYTES
      || process.env.VITE_OPENVOICE_MAX_AUDIO_BYTES
      || ''
  ).trim();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OPENVOICE_MAX_AUDIO_BYTES;
  }
  return Math.max(64_000, Math.floor(parsed));
};

export const isFullDurationTrimRange = (
  startSec: number,
  endSec: number,
  maxDurationSec: number
): boolean => (
  Number.isFinite(startSec)
  && Number.isFinite(endSec)
  && Number.isFinite(maxDurationSec)
  && maxDurationSec > 0
  && startSec <= 0.05
  && endSec >= (maxDurationSec - 0.05)
);

export const buildOpenVoiceStemSeparationRequest = async (
  input: BuildOpenVoiceStemSeparationRequestInput
): Promise<OpenVoiceStemSeparationRequest> => {
  const sourceAudioBase64 = await input.sourceAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer));
  const payload: OpenVoiceStemSeparationRequest = {
    sourceAudioBase64,
    sourceAudioName: input.sourceAudio.name || 'source-audio.wav',
    sourceSeparationModel: input.sourceSeparationModel || 'htdemucs_ft',
    sourceSeparationDevice: input.sourceSeparationDevice || 'cpu_only',
    requestId: input.requestId,
    traceId: input.requestId,
  };
  if (input.trimRange) {
    payload.sourceTrimStartSec = Number(input.trimRange.startSec);
    payload.sourceTrimEndSec = Number(input.trimRange.endSec);
  }
  return payload;
};
