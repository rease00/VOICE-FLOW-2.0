interface WavParseResult {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcmData: Buffer;
}

interface SplitSegmentsResult {
  segments: Buffer[];
  usedFallback: boolean;
  silenceCutCount: number;
}

interface SplitSegmentsOptions {
  weights?: number[] | undefined;
  minSilenceMs?: number | undefined;
  silenceThreshold?: number | undefined;
}

const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = 2;
const DEFAULT_MIN_SILENCE_MS = 260;
const DEFAULT_SILENCE_THRESHOLD = 700;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const parseFmtChunk = (chunk: Buffer): { channels: number; sampleRate: number; bitsPerSample: number } | null => {
  if (chunk.length < 16) return null;
  const audioFormat = chunk.readUInt16LE(0);
  const channels = chunk.readUInt16LE(2);
  const sampleRate = chunk.readUInt32LE(4);
  const bitsPerSample = chunk.readUInt16LE(14);
  if (audioFormat !== 1) return null;
  if (channels <= 0 || sampleRate <= 0 || bitsPerSample !== 16) return null;
  return {
    channels,
    sampleRate,
    bitsPerSample,
  };
};

const fallbackStripWavHeader = (buffer: Buffer): Buffer => {
  for (let offset = 0; offset < Math.min(buffer.length - 8, 256); offset += 1) {
    if (
      buffer[offset] === 0x64
      && buffer[offset + 1] === 0x61
      && buffer[offset + 2] === 0x74
      && buffer[offset + 3] === 0x61
    ) {
      const dataSize = buffer.readUInt32LE(offset + 4);
      const start = offset + 8;
      const safeSize = Math.max(0, Math.min(dataSize, buffer.length - start));
      return buffer.subarray(start, start + safeSize);
    }
  }
  if (buffer.length <= 44) return Buffer.alloc(0);
  return buffer.subarray(44);
};

export const parseLinear16Wav = (buffer: Buffer): WavParseResult => {
  const safe = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (safe.length < 44 || safe.toString('ascii', 0, 4) !== 'RIFF' || safe.toString('ascii', 8, 12) !== 'WAVE') {
    return {
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      bitsPerSample: DEFAULT_BITS_PER_SAMPLE,
      pcmData: fallbackStripWavHeader(safe),
    };
  }

  let channels = DEFAULT_CHANNELS;
  let sampleRate = DEFAULT_SAMPLE_RATE;
  let bitsPerSample = DEFAULT_BITS_PER_SAMPLE;
  let dataChunk: Buffer | null = null;

  let cursor = 12;
  while (cursor + 8 <= safe.length) {
    const id = safe.toString('ascii', cursor, cursor + 4);
    const size = safe.readUInt32LE(cursor + 4);
    const chunkStart = cursor + 8;
    const chunkEnd = Math.min(safe.length, chunkStart + size);
    const chunk = safe.subarray(chunkStart, chunkEnd);

    if (id === 'fmt ') {
      const parsed = parseFmtChunk(chunk);
      if (parsed) {
        channels = parsed.channels;
        sampleRate = parsed.sampleRate;
        bitsPerSample = parsed.bitsPerSample;
      }
    } else if (id === 'data') {
      dataChunk = chunk;
      break;
    }

    cursor = chunkStart + size + (size % 2);
  }

  const pcmData = dataChunk || fallbackStripWavHeader(safe);
  return {
    sampleRate,
    channels,
    bitsPerSample,
    pcmData,
  };
};

const buildWavHeader = (
  dataLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer => {
  const header = Buffer.alloc(44);
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * bytesPerFrame;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(bytesPerFrame, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
};

export const buildLinear16WavFromPcm = (
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer => {
  const safe = Buffer.isBuffer(pcmData) ? pcmData : Buffer.from(pcmData || []);
  return Buffer.concat([
    buildWavHeader(safe.length, sampleRate, channels, bitsPerSample),
    safe,
  ]);
};

export const buildSilencePcm = (
  durationMs: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer => {
  const safeDurationMs = Math.max(0, Math.floor(Number(durationMs || 0)));
  if (safeDurationMs <= 0) return Buffer.alloc(0);
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const frames = Math.floor((sampleRate * safeDurationMs) / 1000);
  return Buffer.alloc(Math.max(0, frames * bytesPerFrame));
};

const detectSilenceCutFrames = (
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  minSilenceMs: number,
  silenceThreshold: number,
): number[] => {
  const bytesPerFrame = channels * BYTES_PER_SAMPLE;
  if (bytesPerFrame <= 0) return [];

  const totalFrames = Math.floor(pcmData.length / bytesPerFrame);
  if (totalFrames <= 0) return [];

  const minSilenceFrames = Math.max(1, Math.floor((sampleRate * minSilenceMs) / 1000));
  const threshold = Math.max(0, Math.floor(silenceThreshold));
  const cutFrames: number[] = [];

  let runStart = -1;
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const sample = pcmData.readInt16LE(frameIndex * bytesPerFrame);
    const isSilent = Math.abs(sample) <= threshold;

    if (isSilent) {
      if (runStart < 0) runStart = frameIndex;
      continue;
    }

    if (runStart >= 0) {
      const runLength = frameIndex - runStart;
      if (runLength >= minSilenceFrames) {
        cutFrames.push(runStart + Math.floor(runLength / 2));
      }
      runStart = -1;
    }
  }

  if (runStart >= 0) {
    const runLength = totalFrames - runStart;
    if (runLength >= minSilenceFrames) {
      cutFrames.push(runStart + Math.floor(runLength / 2));
    }
  }

  return cutFrames;
};

const pickCutFrames = (silenceCuts: number[], expectedSegments: number): number[] => {
  const targetCutCount = Math.max(0, expectedSegments - 1);
  if (targetCutCount <= 0) return [];
  if (silenceCuts.length < targetCutCount) return [];

  const picks: number[] = [];
  for (let index = 1; index <= targetCutCount; index += 1) {
    const relative = (index * silenceCuts.length) / expectedSegments;
    const safeIndex = clamp(Math.floor(relative), 0, silenceCuts.length - 1);
    const candidate = silenceCuts[safeIndex]!;
    if (picks.length === 0 || candidate > picks[picks.length - 1]!) {
      picks.push(candidate);
      continue;
    }

    let forward = safeIndex + 1;
    while (forward < silenceCuts.length && silenceCuts[forward]! <= picks[picks.length - 1]!) {
      forward += 1;
    }
    if (forward < silenceCuts.length) {
      picks.push(silenceCuts[forward]!);
      continue;
    }

    return [];
  }

  return picks;
};

const splitFramesByCuts = (
  pcmData: Buffer,
  channels: number,
  cutFrames: number[],
): Buffer[] => {
  const bytesPerFrame = channels * BYTES_PER_SAMPLE;
  const totalFrames = Math.floor(pcmData.length / bytesPerFrame);
  const sortedCuts = [...cutFrames].sort((a, b) => a - b).filter((frame) => frame > 0 && frame < totalFrames);

  const segments: Buffer[] = [];
  let startFrame = 0;
  for (const cutFrame of sortedCuts) {
    const start = startFrame * bytesPerFrame;
    const end = cutFrame * bytesPerFrame;
    segments.push(pcmData.subarray(start, end));
    startFrame = cutFrame;
  }

  segments.push(pcmData.subarray(startFrame * bytesPerFrame));
  return segments;
};

const splitFramesByWeights = (
  pcmData: Buffer,
  channels: number,
  expectedSegments: number,
  weights?: number[] | undefined,
): Buffer[] => {
  const bytesPerFrame = channels * BYTES_PER_SAMPLE;
  const totalFrames = Math.floor(pcmData.length / bytesPerFrame);
  const safeExpected = Math.max(1, expectedSegments);

  const safeWeights = Array.from({ length: safeExpected }, (_, index) => {
    const weight = Number(weights?.[index] || 0);
    return Number.isFinite(weight) && weight > 0 ? weight : 1;
  });

  const totalWeight = safeWeights.reduce((sum, value) => sum + value, 0);
  const segments: Buffer[] = [];
  let startFrame = 0;
  let consumedWeight = 0;

  for (let index = 0; index < safeExpected; index += 1) {
    const isLast = index === safeExpected - 1;
    consumedWeight += safeWeights[index]!;

    const targetFrame = isLast
      ? totalFrames
      : Math.floor((consumedWeight / totalWeight) * totalFrames);

    const boundedTarget = clamp(targetFrame, startFrame, totalFrames);
    const start = startFrame * bytesPerFrame;
    const end = boundedTarget * bytesPerFrame;
    segments.push(pcmData.subarray(start, end));
    startFrame = boundedTarget;
  }

  return segments;
};

export const splitWavIntoLinePcmSegments = (
  wavBuffer: Buffer,
  expectedSegments: number,
  options?: SplitSegmentsOptions,
): SplitSegmentsResult & WavParseResult => {
  const parsed = parseLinear16Wav(wavBuffer);
  const safeExpected = Math.max(1, Math.floor(Number(expectedSegments || 1)));

  if (parsed.bitsPerSample !== 16 || parsed.channels <= 0 || parsed.sampleRate <= 0) {
    const fallbackSegments = splitFramesByWeights(
      parsed.pcmData,
      DEFAULT_CHANNELS,
      safeExpected,
      options?.weights,
    );
    return {
      ...parsed,
      channels: DEFAULT_CHANNELS,
      bitsPerSample: DEFAULT_BITS_PER_SAMPLE,
      sampleRate: DEFAULT_SAMPLE_RATE,
      segments: fallbackSegments,
      usedFallback: true,
      silenceCutCount: 0,
    };
  }

  const minSilenceMs = Math.max(40, Math.floor(Number(options?.minSilenceMs || DEFAULT_MIN_SILENCE_MS)));
  const silenceThreshold = Math.max(100, Math.floor(Number(options?.silenceThreshold || DEFAULT_SILENCE_THRESHOLD)));

  const silenceCuts = detectSilenceCutFrames(
    parsed.pcmData,
    parsed.sampleRate,
    parsed.channels,
    minSilenceMs,
    silenceThreshold,
  );
  const pickedCuts = pickCutFrames(silenceCuts, safeExpected);

  if (pickedCuts.length === safeExpected - 1) {
    return {
      ...parsed,
      segments: splitFramesByCuts(parsed.pcmData, parsed.channels, pickedCuts),
      usedFallback: false,
      silenceCutCount: silenceCuts.length,
    };
  }

  return {
    ...parsed,
    segments: splitFramesByWeights(parsed.pcmData, parsed.channels, safeExpected, options?.weights),
    usedFallback: true,
    silenceCutCount: silenceCuts.length,
  };
};
