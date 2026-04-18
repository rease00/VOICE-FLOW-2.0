import { synthesize, type TtsEngine } from '../../../services/cloudTtsService';
import { normalizeSpeakerMapKey, parseScriptToSegments } from '../../../services/speakerScriptService';
import {
  buildLinear16WavFromPcm,
  buildSilencePcm,
  splitWavIntoLinePcmSegments,
} from './speakerIsolationPcm';

interface SpeakerConfig {
  speaker: string;
  voice: string;
}

interface SpeakerIsolationSynthesizeRequest {
  text: string;
  requestId?: string | undefined;
  language?: string | undefined;
  voice?: string | undefined;
  engine: TtsEngine;
  speed?: number | undefined;
  pitch?: number | undefined;
  speakerConfigs: SpeakerConfig[];
}

interface SpeakerLine {
  timelineIndex: number;
  speaker: string;
  text: string;
}

interface PauseEvent {
  timelineIndex: number;
  durationMs: number;
}

interface SynthesisDiagnostics {
  providerCalls: number;
  providerRetries: number;
  segmentFallbacks: number;
  silenceCutCount: number;
}

export interface SpeakerIsolationSynthesizeResult {
  audioContent: Buffer;
  contentType: 'audio/wav';
  lineCount: number;
  speakerCount: number;
  diagnostics: SynthesisDiagnostics;
}

const DEFAULT_VOICE = 'Kore';
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_BITS_PER_SAMPLE = 16;
const DEFAULT_INTERNAL_CALL_GAP_MS = 6_100;
const DEFAULT_LINE_GAP_MS = 170;
const MAX_RETRY_ATTEMPTS = 3;

const getInternalCallGapMs = (): number => {
  const raw = Number.parseInt(String(process.env.VF_SPEAKER_ISOLATION_MIN_CALL_GAP_MS || ''), 10);
  if (!Number.isFinite(raw) || raw < 0) {
    return DEFAULT_INTERNAL_CALL_GAP_MS;
  }
  return raw;
};

const wait = async (ms: number): Promise<void> => {
  const safeMs = Math.max(0, Math.floor(Number(ms || 0)));
  if (safeMs <= 0) return;
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(() => resolve(), safeMs);
  });
};

const normalizeSpeaker = (value: string): string => String(value || '').trim();

const isPauseSegment = (segment: {
  speaker: string;
  text: string;
  pauseMs?: number | undefined;
}): boolean => {
  if (Number(segment.pauseMs || 0) > 0) return true;
  return normalizeSpeaker(segment.speaker).toLowerCase() === '__pause__';
};

const normalizeVoiceMap = (speakerConfigs: SpeakerConfig[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const item of speakerConfigs) {
    const speakerKey = normalizeSpeakerMapKey(item.speaker);
    const voice = String(item.voice || '').trim();
    if (!speakerKey || !voice) continue;
    if (!map.has(speakerKey)) {
      map.set(speakerKey, voice);
    }
  }
  return map;
};

const resolveSpeakerVoice = (
  speaker: string,
  voiceMap: Map<string, string>,
  fallbackVoice: string,
): string => {
  const normalizedSpeaker = normalizeSpeakerMapKey(speaker);
  const direct = voiceMap.get(normalizedSpeaker);
  if (direct) return direct;

  const fallback = voiceMap.values().next().value;
  if (typeof fallback === 'string' && fallback.trim()) return fallback;
  return String(fallbackVoice || DEFAULT_VOICE).trim() || DEFAULT_VOICE;
};

const buildTimeline = (text: string): {
  lines: SpeakerLine[];
  pauses: PauseEvent[];
  eventOrder: Array<{ kind: 'line'; timelineIndex: number } | { kind: 'pause'; timelineIndex: number }>;
} => {
  const parsed = parseScriptToSegments(text);
  const lines: SpeakerLine[] = [];
  const pauses: PauseEvent[] = [];
  const eventOrder: Array<{ kind: 'line'; timelineIndex: number } | { kind: 'pause'; timelineIndex: number }> = [];

  for (const segment of parsed) {
    if (isPauseSegment(segment)) {
      const durationMs = Math.max(0, Math.floor(Number(segment.pauseMs || 0)));
      if (durationMs <= 0) continue;
      const timelineIndex = eventOrder.length;
      pauses.push({ timelineIndex, durationMs });
      eventOrder.push({ kind: 'pause', timelineIndex });
      continue;
    }

    const textValue = String(segment.text || '').trim();
    if (!textValue) continue;

    const speaker = normalizeSpeaker(segment.speaker) || 'Narrator';
    const timelineIndex = eventOrder.length;
    lines.push({
      timelineIndex,
      speaker,
      text: textValue,
    });
    eventOrder.push({ kind: 'line', timelineIndex });
  }

  return {
    lines,
    pauses,
    eventOrder,
  };
};

const isQuotaOrTransientError = (error: unknown): boolean => {
  const message = String((error as Error)?.message || error || '').toLowerCase();
  return (
    message.includes('resource_exhausted')
    || message.includes('quota')
    || message.includes('rate limit')
    || message.includes('too many requests')
    || message.includes('429')
    || message.includes('503')
    || message.includes('500')
    || message.includes('unavailable')
    || message.includes('deadline exceeded')
    || message.includes('timeout')
  );
};

const synthesizeWithRetry = async (
  params: {
    text: string;
    requestId?: string | undefined;
    language?: string | undefined;
    voice: string;
    engine: TtsEngine;
    speed?: number | undefined;
    pitch?: number | undefined;
  },
  diagnostics: SynthesisDiagnostics,
): Promise<Buffer> => {
  const callGapMs = getInternalCallGapMs();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    diagnostics.providerCalls += 1;
    try {
      const result = await synthesize({
        text: params.text,
        requestId: params.requestId,
        language: params.language,
        voice: params.voice,
        engine: params.engine,
        speed: params.speed,
        pitch: params.pitch,
        outputFormat: 'wav',
      });
      return result.audioContent;
    } catch (error) {
      const safeError = error instanceof Error ? error : new Error(String(error));
      lastError = safeError;
      if (!isQuotaOrTransientError(safeError) || attempt >= MAX_RETRY_ATTEMPTS) {
        break;
      }
      diagnostics.providerRetries += 1;
      await wait(callGapMs * attempt);
    }
  }

  throw new Error(`Speaker-isolation synthesis failed: ${lastError?.message || 'unknown'}`);
};

export const synthesizeSpeakerIsolationWav = async (
  request: SpeakerIsolationSynthesizeRequest,
): Promise<SpeakerIsolationSynthesizeResult> => {
  const callGapMs = getInternalCallGapMs();
  const timeline = buildTimeline(request.text);
  if (timeline.lines.length <= 0) {
    throw new Error('Speaker-isolation requires at least one dialogue line.');
  }

  const voiceMap = normalizeVoiceMap(request.speakerConfigs);
  const speakerBuckets = new Map<string, { speaker: string; voice: string; lines: SpeakerLine[] }>();

  for (const line of timeline.lines) {
    const key = normalizeSpeakerMapKey(line.speaker) || line.speaker.toLowerCase();
    const existing = speakerBuckets.get(key);
    if (existing) {
      existing.lines.push(line);
      continue;
    }
    speakerBuckets.set(key, {
      speaker: line.speaker,
      voice: resolveSpeakerVoice(line.speaker, voiceMap, request.voice || DEFAULT_VOICE),
      lines: [line],
    });
  }

  const diagnostics: SynthesisDiagnostics = {
    providerCalls: 0,
    providerRetries: 0,
    segmentFallbacks: 0,
    silenceCutCount: 0,
  };

  let sampleRate = DEFAULT_SAMPLE_RATE;
  let channels = DEFAULT_CHANNELS;
  let bitsPerSample = DEFAULT_BITS_PER_SAMPLE;
  let lastCallStartedAt = 0;

  const lineAudioMap = new Map<number, Buffer>();

  for (const bucket of speakerBuckets.values()) {
    const now = Date.now();
    if (lastCallStartedAt > 0) {
      const elapsed = now - lastCallStartedAt;
      if (elapsed < callGapMs) {
        await wait(callGapMs - elapsed);
      }
    }

    lastCallStartedAt = Date.now();

    const mergedText = bucket.lines.map((line) => line.text).join('\n\n');
    const audioBuffer = await synthesizeWithRetry({
      text: mergedText,
      requestId: request.requestId ? `${request.requestId}:speaker:${normalizeSpeakerMapKey(bucket.speaker)}` : undefined,
      language: request.language,
      voice: bucket.voice,
      engine: request.engine,
      speed: request.speed,
      pitch: request.pitch,
    }, diagnostics);

    const split = splitWavIntoLinePcmSegments(audioBuffer, bucket.lines.length, {
      weights: bucket.lines.map((line) => Math.max(1, line.text.length)),
    });

    if (split.usedFallback) {
      diagnostics.segmentFallbacks += 1;
    }
    diagnostics.silenceCutCount += split.silenceCutCount;

    if (split.sampleRate > 0) sampleRate = split.sampleRate;
    if (split.channels > 0) channels = split.channels;
    if (split.bitsPerSample > 0) bitsPerSample = split.bitsPerSample;

    for (let index = 0; index < bucket.lines.length; index += 1) {
      const line = bucket.lines[index]!;
      const segment = split.segments[index] || Buffer.alloc(0);
      lineAudioMap.set(line.timelineIndex, segment);
    }
  }

  const pauseMap = new Map<number, number>();
  for (const pause of timeline.pauses) {
    pauseMap.set(pause.timelineIndex, pause.durationMs);
  }

  const stitchedPcmSegments: Buffer[] = [];
  for (let eventIndex = 0; eventIndex < timeline.eventOrder.length; eventIndex += 1) {
    const event = timeline.eventOrder[eventIndex]!;

    if (event.kind === 'pause') {
      const durationMs = pauseMap.get(event.timelineIndex) || 0;
      if (durationMs > 0) {
        stitchedPcmSegments.push(buildSilencePcm(durationMs, sampleRate, channels, bitsPerSample));
      }
      continue;
    }

    const linePcm = lineAudioMap.get(event.timelineIndex);
    if (linePcm && linePcm.length > 0) {
      stitchedPcmSegments.push(linePcm);
    }

    const hasNext = eventIndex < timeline.eventOrder.length - 1;
    if (hasNext) {
      stitchedPcmSegments.push(buildSilencePcm(DEFAULT_LINE_GAP_MS, sampleRate, channels, bitsPerSample));
    }
  }

  const finalPcm = Buffer.concat(stitchedPcmSegments.filter((chunk) => Buffer.isBuffer(chunk) && chunk.length > 0));
  const audioContent = buildLinear16WavFromPcm(finalPcm, sampleRate, channels, bitsPerSample);

  return {
    audioContent,
    contentType: 'audio/wav',
    lineCount: timeline.lines.length,
    speakerCount: speakerBuckets.size,
    diagnostics,
  };
};
