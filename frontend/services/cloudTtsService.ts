/**
 * Cloud TTS Service
 *
 * Server-side Google Cloud Text-to-Speech access for the Next.js backend.
 * - Uses file-based service account credentials by default.
 * - Supports synchronous Gemini TTS synthesis for Studio fallback paths.
 * - Supports bidirectional streaming synthesis for Studio single-voice paths.
 */

import type { TextToSpeechClient } from '@google-cloud/text-to-speech';

import {
  resolveCloudTtsApiEndpoint,
  resolveCloudTtsCredentialPool,
  type GoogleServiceAccount,
} from '../src/server/googleCredentials';
import {
  getModelPolicyForEngine,
} from '../src/server/tts/runtimePolicy';
import { normalizeTtsLanguageCode } from './synthesisContractService';

export type TtsEngine = 'VECTOR' | 'PRIME';
export type CloudTtsOutputFormat = 'wav' | 'mp3' | 'ogg';

export interface CloudTtsSynthesizeParams {
  text: string;
  requestId?: string | undefined;
  voice?: string | undefined;
  engine: TtsEngine;
  language?: string | undefined;
  speed?: number | undefined;
  pitch?: number | undefined;
  multiSpeaker?: Array<{ speaker: string; voice: string }> | undefined;
  outputFormat?: CloudTtsOutputFormat | undefined;
}

export interface CloudTtsSynthesizeResult {
  audioContent: Buffer;
  contentType: string;
  model: string;
  projectId: string;
  provider: 'gemini-tts';
}

export interface CloudTtsBidiInputChunk {
  index: number;
  text: string;
  charCount: number;
  byteCount: number;
}

export interface CloudTtsBidiChunk {
  index: number;
  pcmBuffer: Buffer;
  wavBuffer: Buffer;
}

export interface CloudTtsBidiStreamParams {
  text: string;
  requestId?: string | undefined;
  voice?: string | undefined;
  engine: TtsEngine;
  language?: string | undefined;
  speed?: number | undefined;
  prompt?: string | undefined;
  inputChunks?: CloudTtsBidiInputChunk[] | undefined;
  onChunk?: ((chunk: CloudTtsBidiChunk) => void | Promise<void>) | undefined;
}

export interface CloudTtsBidiStreamResult {
  pcmChunks: Buffer[];
  wavChunks: Buffer[];
  inputChunks: CloudTtsBidiInputChunk[];
  responseChunkCount: number;
  totalBytes: number;
  timeToFirstAudioMs: number;
  model: string;
  projectId: string;
  provider: 'gemini-tts';
}

export interface CloudTtsBidiSynthesizeResult extends CloudTtsBidiStreamResult {
  audioContent: Buffer;
  contentType: string;
}

const MAX_TEXT_LENGTH = 3000;
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_GEMINI_VOICE = 'Kore';
const DEFAULT_BIDI_PROMPT = 'Read the following in a clean, natural audiobook style with steady pacing.';
const PCM_SAMPLE_RATE_HZ = 24_000;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_CHANNEL_COUNT = 1;
const MULTI_SPEAKER_SYNC_REQUEST_CAP = 10;
// Keep bidi payloads comfortably below the documented Gemini TTS request byte limits.
const CLOUD_TTS_BIDI_TEXT_BYTE_CAP = 3_500;
const CLOUD_TTS_BIDI_CLIENT_POOL_SIZE = 10;

const GEMINI_VOICE_NAMES = new Set([
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe',
  'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux',
  'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck', 'Pulcherrima',
  'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel',
  'Vindemiatrix', 'Zephyr', 'Zubenelgenubi',
]);

const SENTENCE_PATTERN = /[^.!?\n\u0964\u0965]+[.!?\u0964\u0965]?/g;
const PHRASE_PATTERN = /[^,;:\n]+[,;:]?/g;

const clientCache = new Map<string, TextToSpeechClient>();
const bidiClientEntries: Array<Promise<{ client: TextToSpeechClient; account: GoogleServiceAccount }>> = [];
let bidiPoolIndex = 0;

const textEncoder = new TextEncoder();

const sanitizeText = (text: string): string => (
  String(text || '')
    .replace(/["`${}]/g, '')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
);

const sanitizeBidiText = (text: string): string => (
  String(text || '')
    .replace(/\r/g, '\n')
    .replace(/["`${}]/g, '')
    .trim()
);

const clamp = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
);

const getByteLength = (value: string): number => textEncoder.encode(String(value || '')).length;

const resolveAudioEncoding = (format?: CloudTtsOutputFormat): {
  audioEncoding: 'LINEAR16' | 'MP3' | 'OGG_OPUS';
  contentType: string;
} => {
  const normalized = String(format || 'wav').trim().toLowerCase();
  if (normalized === 'mp3') {
    return { audioEncoding: 'MP3', contentType: 'audio/mpeg' };
  }
  if (normalized === 'ogg') {
    return { audioEncoding: 'OGG_OPUS', contentType: 'audio/ogg' };
  }
  return { audioEncoding: 'LINEAR16', contentType: 'audio/wav' };
};

const normalizeTtsEngine = (rawValue: string): TtsEngine => {
  const token = String(rawValue || '').trim().toLowerCase();
  if (token === 'prime') {
    return 'PRIME';
  }
  return 'VECTOR';
};

const normalizeGeminiVoice = (voiceName?: string): string => {
  const raw = String(voiceName || '').trim();
  if (!raw) return DEFAULT_GEMINI_VOICE;
  const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return GEMINI_VOICE_NAMES.has(normalized) ? normalized : DEFAULT_GEMINI_VOICE;
};

const getClientCacheKey = (account: GoogleServiceAccount): string => (
  `${account.projectId}:${account.clientEmail}:${resolveCloudTtsApiEndpoint()}`
);

const buildClient = async (account: GoogleServiceAccount): Promise<TextToSpeechClient> => {
  const cacheKey = getClientCacheKey(account);
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
  const client = new TextToSpeechClient({
    projectId: account.projectId,
    apiEndpoint: resolveCloudTtsApiEndpoint(),
    credentials: {
      client_email: account.clientEmail,
      private_key: account.privateKey,
    },
  });
  clientCache.set(cacheKey, client);
  return client;
};

const buildClientEntry = async (
  account: GoogleServiceAccount
): Promise<{ client: TextToSpeechClient; account: GoogleServiceAccount }> => ({
  client: await buildClient(account),
  account,
});

const getBidiClientPool = (): Array<Promise<{ client: TextToSpeechClient; account: GoogleServiceAccount }>> => {
  if (bidiClientEntries.length > 0) return bidiClientEntries;
  const credentials = resolveCloudTtsCredentialPool();
  if (credentials.length === 0) {
    throw new Error('No Google Cloud TTS credentials configured.');
  }
  for (let index = 0; index < CLOUD_TTS_BIDI_CLIENT_POOL_SIZE; index += 1) {
    bidiClientEntries.push(buildClientEntry(credentials[index % credentials.length]!));
  }
  return bidiClientEntries;
};

const getBidiClientEntry = async (): Promise<{ client: TextToSpeechClient; account: GoogleServiceAccount }> => {
  const pool = getBidiClientPool();
  const entryPromise = pool[bidiPoolIndex % pool.length]!;
  bidiPoolIndex = (bidiPoolIndex + 1) % pool.length;
  return entryPromise;
};

const isQuotaError = (err: unknown): boolean => {
  const message = String((err as Error)?.message || err).toLowerCase();
  return (
    message.includes('429')
    || message.includes('quota')
    || message.includes('resource_exhausted')
    || message.includes('rate limit')
    || message.includes('too many requests')
  );
};

const isModelUnavailableError = (err: unknown): boolean => {
  const message = String((err as Error)?.message || err).toLowerCase();
  return (
    message.includes('not found')
    || message.includes('not supported')
    || message.includes('unavailable')
    || message.includes('deprecated')
  );
};

const buildLinear16WavHeader = (dataLength: number): Buffer => {
  const header = Buffer.alloc(44);
  const blockAlign = PCM_CHANNEL_COUNT * PCM_BYTES_PER_SAMPLE;
  const byteRate = PCM_SAMPLE_RATE_HZ * blockAlign;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(PCM_CHANNEL_COUNT, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE_HZ, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
};

export const buildLinear16WavBuffer = (pcmBuffer: Buffer): Buffer => {
  const safe = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer || []);
  return Buffer.concat([buildLinear16WavHeader(safe.length), safe]);
};

export const aggregateLinear16PcmToWav = (pcmChunks: Buffer[]): Buffer => {
  const safeChunks = pcmChunks.filter((chunk) => Buffer.isBuffer(chunk) && chunk.length > 0);
  const pcm = Buffer.concat(safeChunks);
  return buildLinear16WavBuffer(pcm);
};

const splitWithPattern = (text: string, pattern: RegExp): string[] => {
  const matches = String(text || '').match(pattern);
  if (!matches || matches.length === 0) {
    const trimmed = String(text || '').trim();
    return trimmed ? [trimmed] : [];
  }
  return matches.map((item) => item.trim()).filter(Boolean);
};

const splitWordByByteLimit = (word: string, maxBytes: number): string[] => {
  const safeWord = String(word || '').trim();
  if (!safeWord) return [];
  if (getByteLength(safeWord) <= maxBytes) return [safeWord];

  const units = Array.from(safeWord);
  const output: string[] = [];
  let current = '';

  for (const unit of units) {
    const candidate = `${current}${unit}`;
    if (current && getByteLength(candidate) > maxBytes) {
      output.push(current);
      current = unit;
      continue;
    }
    current = candidate;
  }

  if (current) output.push(current);
  return output;
};

const splitOversizedByWords = (text: string, maxBytes: number): string[] => {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const output: string[] = [];
  let current = '';

  for (const word of words) {
    const safeWord = word.trim();
    if (!safeWord) continue;

    if (getByteLength(safeWord) > maxBytes) {
      if (current) {
        output.push(current);
        current = '';
      }
      output.push(...splitWordByByteLimit(safeWord, maxBytes));
      continue;
    }

    const candidate = current ? `${current} ${safeWord}` : safeWord;
    if (current && getByteLength(candidate) > maxBytes) {
      output.push(current);
      current = safeWord;
      continue;
    }
    current = candidate;
  }

  if (current) output.push(current);
  return output;
};

export const buildBidirectionalTextChunks = (
  text: string,
  options?: {
    maxBytesPerChunk?: number | undefined;
  }
): CloudTtsBidiInputChunk[] => {
  const maxBytesPerChunk = Math.max(256, Math.floor(Number(options?.maxBytesPerChunk || CLOUD_TTS_BIDI_TEXT_BYTE_CAP)));
  const normalized = sanitizeBidiText(text);
  if (!normalized) return [];

  const sentenceUnits = splitWithPattern(normalized, SENTENCE_PATTERN);
  const granularUnits: string[] = [];

  for (const sentence of sentenceUnits) {
    if (getByteLength(sentence) <= maxBytesPerChunk) {
      granularUnits.push(sentence);
      continue;
    }

    const phraseUnits = splitWithPattern(sentence, PHRASE_PATTERN);
    for (const phrase of phraseUnits) {
      if (getByteLength(phrase) <= maxBytesPerChunk) {
        granularUnits.push(phrase);
      } else {
        granularUnits.push(...splitOversizedByWords(phrase, maxBytesPerChunk));
      }
    }
  }

  const chunks: CloudTtsBidiInputChunk[] = [];
  let current = '';

  const flushCurrent = () => {
    const safe = current.trim();
    if (!safe) return;
    chunks.push({
      index: chunks.length,
      text: safe,
      charCount: safe.length,
      byteCount: getByteLength(safe),
    });
    current = '';
  };

  for (const unit of granularUnits) {
    const safeUnit = unit.trim();
    if (!safeUnit) continue;
    const candidate = current ? `${current} ${safeUnit}` : safeUnit;
    if (current && getByteLength(candidate) > maxBytesPerChunk) {
      flushCurrent();
      current = safeUnit;
      continue;
    }
    current = candidate;
  }

  flushCurrent();
  return chunks;
};

const synthesizeGemini = async (
  client: TextToSpeechClient,
  params: CloudTtsSynthesizeParams,
  model: string,
): Promise<Buffer> => {
  const text = sanitizeText(params.text);
  if (!text) {
    throw new Error('Text is empty after sanitization.');
  }
  const languageCode = normalizeTtsLanguageCode(params.language || DEFAULT_LANGUAGE);

  const multiSpeaker = Array.isArray(params.multiSpeaker) && params.multiSpeaker.length > 0
    // Legacy sync payload cap only. This is not a bidi capability.
    ? params.multiSpeaker.slice(0, MULTI_SPEAKER_SYNC_REQUEST_CAP)
    : undefined;

  const encoding = resolveAudioEncoding(params.outputFormat);
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: multiSpeaker
      ? {
          languageCode,
          modelName: model,
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: multiSpeaker.map((speaker) => ({
              speakerAlias: String(speaker.speaker || '').replace(/\s+/g, ''),
              speakerId: normalizeGeminiVoice(speaker.voice),
            })),
          },
        }
      : {
          languageCode,
          name: normalizeGeminiVoice(params.voice),
          modelName: model,
        },
    audioConfig: {
      audioEncoding: encoding.audioEncoding,
      sampleRateHertz: PCM_SAMPLE_RATE_HZ,
      speakingRate: clamp(Number(params.speed ?? 1), 0.7, 1.3),
    },
  });

  if (!response.audioContent) {
    throw new Error('Cloud TTS returned no audio content.');
  }

  return Buffer.from(response.audioContent as Uint8Array);
};

const loadCredentialPool = (): GoogleServiceAccount[] => resolveCloudTtsCredentialPool();

export const streamBidirectionalSynthesize = async (
  params: CloudTtsBidiStreamParams,
): Promise<CloudTtsBidiStreamResult> => {
  if (Array.isArray((params as CloudTtsSynthesizeParams).multiSpeaker) && (params as CloudTtsSynthesizeParams).multiSpeaker!.length > 0) {
    throw new Error('Bidirectional Cloud TTS does not support multi-speaker Studio requests.');
  }

  const inputChunks = Array.isArray(params.inputChunks) && params.inputChunks.length > 0
    ? params.inputChunks
    : buildBidirectionalTextChunks(params.text);
  if (inputChunks.length <= 0) {
    throw new Error('Bidirectional Cloud TTS requires at least one non-empty input chunk.');
  }

  const resolvedEngine = normalizeTtsEngine(params.engine);
  const model = getModelPolicyForEngine(resolvedEngine).primary;
  const languageCode = normalizeTtsLanguageCode(params.language || DEFAULT_LANGUAGE);
  const prompt = String(params.prompt || DEFAULT_BIDI_PROMPT).trim() || DEFAULT_BIDI_PROMPT;
  const { client, account } = await getBidiClientEntry();

  const startedAt = Date.now();
  let firstChunkAt = 0;
  let responseChunkCount = 0;
  let totalBytes = 0;
  const pcmChunks: Buffer[] = [];
  const wavChunks: Buffer[] = [];

  const stream = (client as any).streamingSynthesize();
  const completion = new Promise<void>((resolve, reject) => {
    stream.on('data', async (response: { audioContent?: Uint8Array | Buffer | null }) => {
      const audioContent = response?.audioContent;
      const pcmBuffer = Buffer.isBuffer(audioContent)
        ? audioContent
        : Buffer.from(audioContent || []);
      if (pcmBuffer.length <= 0) return;
      if (firstChunkAt === 0) {
        firstChunkAt = Date.now();
      }
      const wavBuffer = buildLinear16WavBuffer(pcmBuffer);
      const chunk: CloudTtsBidiChunk = {
        index: responseChunkCount,
        pcmBuffer,
        wavBuffer,
      };
      responseChunkCount += 1;
      totalBytes += pcmBuffer.length;
      pcmChunks.push(pcmBuffer);
      wavChunks.push(wavBuffer);
      if (params.onChunk) {
        await params.onChunk(chunk);
      }
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  stream.write({
    streamingConfig: {
      voice: {
        languageCode,
        name: normalizeGeminiVoice(params.voice),
        modelName: model,
      },
      streamingAudioConfig: {
        audioEncoding: 'PCM',
        sampleRateHertz: PCM_SAMPLE_RATE_HZ,
        speakingRate: clamp(Number(params.speed ?? 1), 0.7, 1.3),
      },
    },
  });

  for (let index = 0; index < inputChunks.length; index += 1) {
    const chunk = inputChunks[index];
    if (!chunk) continue;
    stream.write({
      input: {
        text: chunk.text,
        prompt: index === 0 ? prompt : undefined,
      },
    });
  }
  stream.end();

  await completion;

  if (totalBytes <= 0) {
    throw new Error('Bidirectional Cloud TTS returned no audio.');
  }

  return {
    pcmChunks,
    wavChunks,
    inputChunks,
    responseChunkCount,
    totalBytes,
    timeToFirstAudioMs: firstChunkAt > 0 ? Math.max(0, firstChunkAt - startedAt) : -1,
    model,
    projectId: account.projectId,
    provider: 'gemini-tts',
  };
};

export const synthesizeBidirectionalToWav = async (
  params: CloudTtsBidiStreamParams,
): Promise<CloudTtsBidiSynthesizeResult> => {
  const streamed = await streamBidirectionalSynthesize(params);
  return {
    ...streamed,
    audioContent: aggregateLinear16PcmToWav(streamed.pcmChunks),
    contentType: 'audio/wav',
  };
};

export const synthesize = async (
  params: CloudTtsSynthesizeParams,
): Promise<CloudTtsSynthesizeResult> => {
  const pool = loadCredentialPool();
  if (pool.length === 0) {
    throw new Error('No Google Cloud TTS credentials configured.');
  }

  const resolvedEngine = normalizeTtsEngine(params.engine);
  const encoding = resolveAudioEncoding(params.outputFormat);
  let lastError: Error | null = null;

  for (const account of pool) {
    const client = await buildClient(account);

    const model = getModelPolicyForEngine(resolvedEngine).primary;
    try {
      const audioContent = await synthesizeGemini(client, params, model);
      return {
        audioContent,
        contentType: encoding.contentType,
        model,
        projectId: account.projectId,
        provider: 'gemini-tts',
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (isModelUnavailableError(error)) {
        continue;
      }
      if (isQuotaError(error)) {
        break;
      }
    }
  }

  throw new Error(
    `All Cloud TTS credentials were exhausted. Last error: ${lastError?.message || 'unknown'}`,
  );
};

export const isConfigured = (): boolean => loadCredentialPool().length > 0;

export {
  CLOUD_TTS_BIDI_TEXT_BYTE_CAP,
  DEFAULT_BIDI_PROMPT,
  MAX_TEXT_LENGTH,
  normalizeTtsEngine,
};
