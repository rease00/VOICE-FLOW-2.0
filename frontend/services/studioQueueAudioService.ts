import { audioBufferToWav, getAudioContext } from './geminiService';
import { mergeChunkBuffersWithCrossfade } from './ttsLongTextService';

export const mergeStudioQueueAudioBlobs = async (
  blobs: Blob[],
  crossfadeMs = 12
): Promise<Blob | null> => {
  const safeBlobs = blobs.filter((blob): blob is Blob => Boolean(blob));
  if (safeBlobs.length === 0) return null;

  const ctx = getAudioContext();
  const buffers: AudioBuffer[] = [];
  for (const blob of safeBlobs) {
    const arrayBuffer = await blob.arrayBuffer();
    if (arrayBuffer.byteLength < 100) continue;
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    buffers.push(decoded);
  }
  if (buffers.length === 0) return null;

  const merged = mergeChunkBuffersWithCrossfade(ctx, buffers, crossfadeMs);
  return audioBufferToWav(merged);
};

export const buildStudioQueueBlobUrl = (blob: Blob | null | undefined): string | null => {
  if (!blob) return null;
  return URL.createObjectURL(blob);
};
