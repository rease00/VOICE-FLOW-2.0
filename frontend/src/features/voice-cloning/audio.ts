import { buildBase64DataUrl, fetchUrlToBase64 } from '../../shared/audio/base64';
import { resolveApiUrl } from '../../shared/api/config';

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

export interface VoiceClonePlayableAudioOptions {
  backendBaseUrl?: string;
  signal?: AbortSignal;
}

export const resolveVoiceCloneBackendAudioUrl = (
  url: string,
  backendBaseUrl?: string
): string => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^(?:blob:|data:)/i.test(raw)) {
    return raw;
  }
  return resolveApiUrl(raw, backendBaseUrl);
};

const buildVoiceCloneBackendAudioUrlCandidates = (
  url: string,
  backendBaseUrl?: string
): string[] => {
  const raw = String(url || '').trim();
  if (!raw) return [];
  if (/^(?:blob:|data:)/i.test(raw)) {
    return [raw];
  }

  const candidates = new Set<string>();
  candidates.add(resolveApiUrl(raw, backendBaseUrl));
  candidates.add(resolveApiUrl(raw, '/api/v1'));
  return Array.from(candidates);
};

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
  contentType: string = 'audio/wav',
  options?: VoiceClonePlayableAudioOptions
): Promise<string> => {
  const inlineUrl = resolveVoiceClonePlayableAudioUrl(source, contentType);
  if (inlineUrl) {
    return inlineUrl;
  }

  const safeSource = source || {};
  const fallbackCandidates = buildVoiceCloneBackendAudioUrlCandidates(
    safeSource.clonedVoice?.previewUrl || safeSource.artifact?.downloadUrl || '',
    options?.backendBaseUrl
  );
  if (fallbackCandidates.length === 0) {
    return '';
  }

  for (const fallbackUrl of fallbackCandidates) {
    if (/^(?:blob:|data:)/i.test(fallbackUrl)) {
      return fallbackUrl;
    }
    try {
      const audioBase64 = await fetchUrlToBase64(fallbackUrl, options?.signal ? { signal: options.signal } : undefined);
      return audioBase64 ? buildBase64DataUrl(audioBase64, contentType) : fallbackUrl;
    } catch (error) {
      const name = String((error as { name?: unknown } | null | undefined)?.name || '').trim().toLowerCase();
      if (name === 'aborterror') {
        throw error;
      }
      // Try the next resolved backend path before falling back to a raw URL.
    }
  }

  return fallbackCandidates[0] || '';
};
