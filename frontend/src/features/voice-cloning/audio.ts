import { buildBase64DataUrl, fetchUrlToBase64 } from '../../shared/audio/base64';

export interface VoiceClonePlayableAudioSource {
  audioBase64?: string;
  artifact?: {
    downloadUrl?: string;
  } | null;
  clonedVoice?: {
    previewUrl?: string;
  } | null;
  contentType?: string;
}

export const resolveVoiceClonePlayableAudioUrl = (
  source: VoiceClonePlayableAudioSource | null | undefined,
  contentType: string = 'audio/wav'
): string => {
  const safeSource = source || {};
  const inlineBase64 = String(safeSource.audioBase64 || '').trim();
  if (inlineBase64) {
    return buildBase64DataUrl(inlineBase64, contentType);
  }
  return '';
};

export const resolveVoiceClonePlayableAudioUrlWithFallback = async (
  source: VoiceClonePlayableAudioSource | null | undefined,
  contentType: string = 'audio/wav'
): Promise<string> => {
  const inlineUrl = resolveVoiceClonePlayableAudioUrl(source, contentType);
  if (inlineUrl) {
    return inlineUrl;
  }

  const safeSource = source || {};
  const fallbackUrl = String(
    safeSource.clonedVoice?.previewUrl || safeSource.artifact?.downloadUrl || ''
  ).trim();
  if (!fallbackUrl) {
    return '';
  }

  const audioBase64 = await fetchUrlToBase64(fallbackUrl);
  return audioBase64 ? buildBase64DataUrl(audioBase64, contentType) : '';
};
