/**
 * Cloud TTS Service
 *
 * Server-side Google Cloud Text-to-Speech access for the Next.js backend.
 * - Uses file-based service account credentials by default.
 * - Supports Gemini TTS models for the reader's VECTOR and PRIME modes.
 */

import type { TextToSpeechClient } from '@google-cloud/text-to-speech';
import {
  resolveCloudTtsApiEndpoint,
  resolveCloudTtsCredentialPool,
  type GoogleServiceAccount,
} from '../src/server/googleCredentials';

export type TtsEngine = 'VECTOR' | 'PRIME';
export type CloudTtsOutputFormat = 'wav' | 'mp3' | 'ogg';

export interface CloudTtsSynthesizeParams {
  text: string;
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

const MAX_TEXT_LENGTH = 3000;
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_GEMINI_VOICE = 'Kore';

const GEMINI_ENGINE_MODELS: Record<'VECTOR' | 'PRIME', { primary: string; fallback: string }> = {
  VECTOR: {
    primary: 'gemini-2.5-flash-tts',
    fallback: 'gemini-2.5-flash-tts',
  },
  PRIME: {
    primary: 'gemini-2.5-flash-tts',
    fallback: 'gemini-2.5-flash-tts',
  },
};

const GEMINI_VOICE_NAMES = new Set([
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe',
  'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux',
  'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck', 'Pulcherrima',
  'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel',
  'Vindemiatrix', 'Zephyr', 'Zubenelgenubi',
]);

const clientCache = new Map<string, TextToSpeechClient>();

const sanitizeText = (text: string): string => (
  String(text || '')
    .replace(/["`${}]/g, '')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
);

const clamp = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
);

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

const synthesizeGemini = async (
  client: TextToSpeechClient,
  params: CloudTtsSynthesizeParams,
  model: string,
): Promise<Buffer> => {
  const text = sanitizeText(params.text);
  if (!text) {
    throw new Error('Text is empty after sanitization.');
  }

  const multiSpeaker = Array.isArray(params.multiSpeaker) && params.multiSpeaker.length > 0
    ? params.multiSpeaker.slice(0, 10)
    : undefined;

  const encoding = resolveAudioEncoding(params.outputFormat);
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: multiSpeaker
      ? {
          languageCode: params.language || DEFAULT_LANGUAGE,
          modelName: model,
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: multiSpeaker.map((speaker) => ({
              speakerAlias: String(speaker.speaker || '').replace(/\s+/g, ''),
              speakerId: normalizeGeminiVoice(speaker.voice),
            })),
          },
        }
      : {
          languageCode: params.language || DEFAULT_LANGUAGE,
          name: normalizeGeminiVoice(params.voice),
          modelName: model,
        },
    audioConfig: {
      audioEncoding: encoding.audioEncoding,
      sampleRateHertz: 24000,
      speakingRate: clamp(Number(params.speed ?? 1), 0.7, 1.3),
    },
  });

  if (!response.audioContent) {
    throw new Error('Cloud TTS returned no audio content.');
  }

  return Buffer.from(response.audioContent as Uint8Array);
};

const loadCredentialPool = (): GoogleServiceAccount[] => resolveCloudTtsCredentialPool();

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

    const modelsToTry = GEMINI_ENGINE_MODELS[resolvedEngine];
    for (const model of [modelsToTry.primary, modelsToTry.fallback]) {
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
  }

  throw new Error(
    `All Cloud TTS credentials were exhausted. Last error: ${lastError?.message || 'unknown'}`,
  );
};

export const isConfigured = (): boolean => loadCredentialPool().length > 0;

export { MAX_TEXT_LENGTH, normalizeTtsEngine };
