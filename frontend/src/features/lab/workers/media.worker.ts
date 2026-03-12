/// <reference lib="webworker" />

import type {
  LabMediaWorkerRequest,
  LabMediaWorkerResponse,
  LabPcmData,
  LabWorkerProgressPayload,
} from './contracts';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const EMPTY_CHANNEL = new Float32Array(1);

const post = (payload: LabMediaWorkerResponse): void => {
  workerScope.postMessage(payload);
};

const toProgress = (
  requestId: string,
  payload: LabWorkerProgressPayload
): void => {
  post({ type: 'progress', requestId, payload });
};

const maxAbs = (channels: Float32Array[]): number => {
  let peak = 0;
  channels.forEach((channel) => {
    for (let index = 0; index < channel.length; index += 1) {
      const value = Math.abs(channel[index] ?? 0);
      if (value > peak) peak = value;
    }
  });
  return peak;
};

const normalizeChannels = (channels: Float32Array[], ceiling = 0.95): void => {
  const peak = maxAbs(channels);
  if (peak <= 0) return;
  const gain = Math.min(4, ceiling / peak);
  channels.forEach((channel) => {
    for (let index = 0; index < channel.length; index += 1) {
      const current = channel[index] ?? 0;
      channel[index] = Math.max(-1, Math.min(1, current * gain));
    }
  });
};

const applyDenoise = (channel: Float32Array, amount: number): void => {
  if (amount <= 0) return;
  const threshold = 0.003 + (0.03 * Math.min(1, amount));
  for (let index = 0; index < channel.length; index += 1) {
    const current = channel[index] ?? 0;
    channel[index] = Math.abs(current) < threshold ? 0 : current;
  }
};

const applyWarmEq = (channel: Float32Array): void => {
  let previous = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const current = channel[index] ?? 0;
    previous = (previous * 0.86) + (current * 0.14);
    channel[index] = (current * 0.72) + (previous * 0.28);
  }
};

const applyPresenceEq = (channel: Float32Array): void => {
  let previous = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const current = channel[index] ?? 0;
    const high = current - previous;
    channel[index] = current + (high * 0.22);
    previous = current;
  }
};

const applyBroadcastEq = (channel: Float32Array): void => {
  applyWarmEq(channel);
  applyPresenceEq(channel);
};

const applyEq = (channel: Float32Array, eqPreset: 'flat' | 'warm' | 'presence' | 'broadcast'): void => {
  if (eqPreset === 'warm') {
    applyWarmEq(channel);
    return;
  }
  if (eqPreset === 'presence') {
    applyPresenceEq(channel);
    return;
  }
  if (eqPreset === 'broadcast') {
    applyBroadcastEq(channel);
  }
};

const applyFade = (channel: Float32Array, sampleRate: number, fadeInMs: number, fadeOutMs: number): void => {
  const fadeInSamples = Math.min(channel.length, Math.max(0, Math.round((fadeInMs / 1000) * sampleRate)));
  const fadeOutSamples = Math.min(channel.length, Math.max(0, Math.round((fadeOutMs / 1000) * sampleRate)));

  for (let index = 0; index < fadeInSamples; index += 1) {
    const gain = fadeInSamples <= 1 ? 1 : index / (fadeInSamples - 1);
    channel[index] = (channel[index] ?? 0) * gain;
  }

  for (let index = 0; index < fadeOutSamples; index += 1) {
    const gain = fadeOutSamples <= 1 ? 0 : 1 - (index / fadeOutSamples);
    const targetIndex = channel.length - 1 - index;
    if (targetIndex < 0) break;
    channel[targetIndex] = (channel[targetIndex] ?? 0) * gain;
  }
};

const sampleAt = (channel: Float32Array, index: number): number => {
  if (index <= 0) return channel[0] ?? 0;
  if (index >= channel.length - 1) return channel[channel.length - 1] ?? 0;
  const leftIndex = Math.floor(index);
  const rightIndex = Math.min(channel.length - 1, leftIndex + 1);
  const fraction = index - leftIndex;
  const left = channel[leftIndex] ?? 0;
  const right = channel[rightIndex] ?? 0;
  return left + ((right - left) * fraction);
};

const renderClip = (
  audio: LabPcmData,
  clip: Extract<LabMediaWorkerRequest, { type: 'render-mix' }>['clips'][number],
  outputSampleRate: number
): Float32Array[] => {
  const sourceDurationMs = Math.max(50, clip.trimEndMs - clip.trimStartMs);
  const rateFactor = Math.max(0.25, clip.playbackRate || 1) * Math.pow(2, (clip.pitchSemitones || 0) / 12);
  const outputLength = Math.max(1, Math.ceil(((sourceDurationMs / 1000) / rateFactor) * outputSampleRate));
  const channelCount = Math.max(1, audio.channels.length);
  const rendered = Array.from({ length: channelCount }, () => new Float32Array(outputLength));
  const startSample = Math.max(0, Math.floor((clip.trimStartMs / 1000) * audio.sampleRate));
  const endSample = Math.min(audio.length, Math.ceil((clip.trimEndMs / 1000) * audio.sampleRate));
  const inputSpanSamples = Math.max(1, endSample - startSample);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const source = audio.channels[Math.min(channelIndex, audio.channels.length - 1)] ?? audio.channels[0] ?? EMPTY_CHANNEL;
    const target = rendered[channelIndex];
    if (!target) continue;
    for (let sampleIndex = 0; sampleIndex < outputLength; sampleIndex += 1) {
      const progress = sampleIndex / Math.max(1, outputLength - 1);
      const sourceIndex = startSample + (progress * inputSpanSamples);
      target[sampleIndex] = sampleAt(source, sourceIndex);
    }
    applyDenoise(target, clip.denoiseAmount);
    applyEq(target, clip.eqPreset);
    if (clip.normalize) {
      normalizeChannels([target]);
    }
    applyFade(target, outputSampleRate, clip.fadeInMs, clip.fadeOutMs);
    const gain = clip.muted ? 0 : Math.max(0, Math.min(4, clip.gain));
    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      target[sampleIndex] = (target[sampleIndex] ?? 0) * gain;
    }
  }

  return rendered;
};

const mixSession = (
  request: Extract<LabMediaWorkerRequest, { type: 'render-mix' }>
): LabPcmData => {
  const { clips, audioByAssetId, outputSampleRate, normalizeMaster } = request;
  const activeClips = clips.filter((clip) => !clip.muted);
  const soloEnabled = activeClips.some((clip) => clip.solo);
  const queue = soloEnabled ? activeClips.filter((clip) => clip.solo) : activeClips;
  const channelCount = Math.max(
    1,
    ...queue.map((clip) => Math.max(1, audioByAssetId[clip.assetId]?.channels.length || 1))
  );
  const outputLength = queue.reduce((max, clip) => {
    const audio = audioByAssetId[clip.assetId];
    if (!audio) return max;
    const renderedLength = renderClip(audio, clip, outputSampleRate)[0]?.length || 0;
    const endSample = Math.max(0, Math.round((clip.startMs / 1000) * outputSampleRate)) + renderedLength;
    return Math.max(max, endSample);
  }, 1);

  const mixedChannels = Array.from({ length: channelCount }, () => new Float32Array(outputLength));

  queue.forEach((clip, index) => {
    const audio = audioByAssetId[clip.assetId];
    if (!audio) return;
    const rendered = renderClip(audio, clip, outputSampleRate);
    const startOffset = Math.max(0, Math.round((clip.startMs / 1000) * outputSampleRate));
    rendered.forEach((channel, channelIndex) => {
      const target = mixedChannels[Math.min(channelIndex, mixedChannels.length - 1)];
      if (!target) return;
      for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
        const targetIndex = startOffset + sampleIndex;
        if (targetIndex >= target.length) break;
        target[targetIndex] = (target[targetIndex] ?? 0) + (channel[sampleIndex] ?? 0);
      }
    });
    toProgress(request.requestId, {
      kind: 'mix',
      progressPct: Math.round(((index + 1) / Math.max(1, queue.length)) * 100),
      message: `Rendering mix clip ${index + 1}/${queue.length}`,
    });
  });

  if (normalizeMaster) {
    normalizeChannels(mixedChannels, 0.94);
  }

  return {
    sampleRate: outputSampleRate,
    length: mixedChannels[0]?.length || 0,
    durationMs: Math.round(((mixedChannels[0]?.length || 0) / outputSampleRate) * 1000),
    channels: mixedChannels,
  };
};

const toPeaks = (channel: Float32Array, buckets: number): number[] => {
  const safeBuckets = Math.max(1, buckets);
  const size = Math.max(1, Math.floor(channel.length / safeBuckets));
  return Array.from({ length: safeBuckets }, (_, bucketIndex) => {
    const start = bucketIndex * size;
    const end = Math.min(channel.length, start + size);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
    return Math.min(1, peak);
  });
};

const encodeWavBlob = (audio: LabPcmData): Blob => {
  const channelCount = Math.max(1, audio.channels.length);
  const length = Math.max(1, audio.length);
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = audio.sampleRate * blockAlign;
  const dataLength = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    Array.from(value).forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channel = audio.channels[Math.min(channelIndex, audio.channels.length - 1)] ?? audio.channels[0] ?? EMPTY_CHANNEL;
      const sample = Math.max(-1, Math.min(1, channel[sampleIndex] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

workerScope.onmessage = async (event: MessageEvent<LabMediaWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'generate-waveform') {
      const primaryChannel = request.audio.channels[0] ?? EMPTY_CHANNEL;
      post({
        type: 'waveform',
        requestId: request.requestId,
        coarse: toPeaks(primaryChannel, request.coarseBuckets),
        detail: toPeaks(primaryChannel, request.detailBuckets),
        durationMs: request.audio.durationMs,
        sampleRate: request.audio.sampleRate,
        channels: request.audio.channels.length,
      });
      return;
    }

    if (request.type === 'render-mix') {
      const mixed = mixSession(request);
      post({ type: 'rendered-mix', requestId: request.requestId, audio: mixed });
      return;
    }

    if (request.type === 'encode-wav') {
      const blob = encodeWavBlob(request.audio);
      post({ type: 'wav-blob', requestId: request.requestId, blob });
    }
  } catch (error) {
    post({
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
