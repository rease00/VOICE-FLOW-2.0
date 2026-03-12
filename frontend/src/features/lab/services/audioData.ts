import { getAudioContext } from '../../../../services/geminiService';
import type { LabPcmData } from '../workers/contracts';

const cloneChannelData = (channel: Float32Array): Float32Array => {
  const copy = new Float32Array(channel.length);
  copy.set(channel);
  return copy;
};

export const audioBufferToPcmData = (buffer: AudioBuffer): LabPcmData => ({
  sampleRate: buffer.sampleRate,
  length: buffer.length,
  durationMs: Math.round(buffer.duration * 1000),
  channels: Array.from({ length: buffer.numberOfChannels }, (_, index) => cloneChannelData(buffer.getChannelData(index))),
});

export const decodeAudioBlobToPcmData = async (blob: Blob): Promise<LabPcmData> => {
  const ctx = getAudioContext();
  const data = await blob.arrayBuffer();
  const decoded = await ctx.decodeAudioData(data.slice(0));
  return audioBufferToPcmData(decoded);
};

export const decodeAudioFileToPcmData = async (file: File): Promise<LabPcmData> => {
  return decodeAudioBlobToPcmData(file);
};

export const readVideoMetadata = async (file: File): Promise<{ durationMs: number; posterBlob: Blob | null }> => {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = url;

      const cleanup = () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      };

      video.onloadedmetadata = () => {
        const durationMs = Math.max(0, Math.round((video.duration || 0) * 1000));
        const safeSeek = Math.min(Math.max(video.duration * 0.15, 0.05), Math.max(video.duration - 0.05, 0));
        video.currentTime = Number.isFinite(safeSeek) ? safeSeek : 0;

        video.onseeked = () => {
          const width = Math.max(1, video.videoWidth || 1280);
          const height = Math.max(1, video.videoHeight || 720);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            cleanup();
            resolve({ durationMs, posterBlob: null });
            return;
          }
          ctx.drawImage(video, 0, 0, width, height);
          canvas.toBlob((posterBlob) => {
            cleanup();
            resolve({ durationMs, posterBlob: posterBlob || null });
          }, 'image/jpeg', 0.82);
        };
      };

      video.onerror = () => {
        cleanup();
        reject(new Error('Unable to read video metadata in this browser.'));
      };
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};
