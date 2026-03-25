import { resolveApiBaseUrl } from '../src/shared/api/config';
import { extractAudioFromVideo as gatewayExtractAudioFromVideo } from '../src/shared/api/gatewayClient';

const resolveMediaBackendBaseUrl = (backendUrl?: string): string => resolveApiBaseUrl(backendUrl);

export const extractAudioFromVideo = async (videoFile: File, backendUrl?: string): Promise<Blob> => {
  const baseUrl = resolveMediaBackendBaseUrl(backendUrl);

  try {
    const audioBlob = await gatewayExtractAudioFromVideo(videoFile, {
      baseUrl,
    });
    if (!audioBlob.size) {
      throw new Error('Extracted audio is empty.');
    }
    return audioBlob;
  } catch (error: unknown) {
    const maybeHttp = error as { status?: number; detail?: string };
    if (maybeHttp?.status === 401 || maybeHttp?.status === 403) {
      throw new Error('Authentication failed while extracting audio. Sign in again and retry.');
    }
    if (maybeHttp?.status === 413) {
      throw new Error('Video file is too large. Maximum 500MB.');
    }
    if (maybeHttp?.status === 400) {
      const detail = String(maybeHttp?.detail || '').trim();
      throw new Error(`Invalid video format${detail ? `: ${detail}` : ''}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to extract audio from video: ${message}`);
  }
};
