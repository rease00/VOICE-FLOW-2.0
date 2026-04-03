import { arrayBufferToBase64 } from '../../shared/audio/base64';
import type { VoiceCloneStemSeparationRequest } from './api';

const DEFAULT_VOICE_CLONE_MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export interface VoiceCloneSourceTrimRange {
  startSec: number;
  endSec: number;
}

export type OpenVoiceSourceTrimRange = VoiceCloneSourceTrimRange;

export interface BuildVoiceCloneStemSeparationRequestInput {
  sourceAudio: File;
  requestId: string;
  sourceSeparationModel?: string;
  sourceSeparationDevice?: string;
  trimRange?: VoiceCloneSourceTrimRange | null;
}

export type BuildOpenVoiceStemSeparationRequestInput = BuildVoiceCloneStemSeparationRequestInput;

export const getVoiceCloneStemExtractionMaxBytes = (): number => {
  const raw = String(
    process.env.NEXT_PUBLIC_VOICE_CLONE_MAX_AUDIO_BYTES
      || process.env.NEXT_PUBLIC_OPENVOICE_MAX_AUDIO_BYTES
      || process.env.VITE_VOICE_CLONE_MAX_AUDIO_BYTES
      || process.env.VITE_OPENVOICE_MAX_AUDIO_BYTES
      || ''
  ).trim();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_VOICE_CLONE_MAX_AUDIO_BYTES;
  }
  return Math.max(64_000, Math.floor(parsed));
};

export const getOpenVoiceStemExtractionMaxBytes = getVoiceCloneStemExtractionMaxBytes;

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

export const buildVoiceCloneStemSeparationRequest = async (
  input: BuildVoiceCloneStemSeparationRequestInput
): Promise<VoiceCloneStemSeparationRequest> => {
  const sourceAudioBase64 = await input.sourceAudio.arrayBuffer().then((buffer) => arrayBufferToBase64(buffer));
  const payload: VoiceCloneStemSeparationRequest = {
    sourceAudioBase64,
    sourceAudioName: input.sourceAudio.name || 'source-audio.wav',
    sourceSeparationModel: input.sourceSeparationModel || 'htdemucs_ft',
    sourceSeparationDevice: input.sourceSeparationDevice || 'gpu_preferred',
    requestId: input.requestId,
    traceId: input.requestId,
  };
  if (input.trimRange) {
    payload.sourceTrimStartSec = Number(input.trimRange.startSec);
    payload.sourceTrimEndSec = Number(input.trimRange.endSec);
  }
  return payload;
};

export const buildOpenVoiceStemSeparationRequest = buildVoiceCloneStemSeparationRequest;
