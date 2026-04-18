import type { TextToSpeechClient } from '@google-cloud/text-to-speech';

import { resolveCloudTtsApiEndpoint, resolveCloudTtsCredentialPool, type GoogleServiceAccount } from '../googleCredentials.ts';
import type { AudioNovelSpeakerRun } from './contracts.ts';

const CLIENT_POOL_SIZE = 10;
const SILENCE = Buffer.alloc(480);
const AUDIO_NOVEL_BIDI_PROMPT = 'Read the following in a clean, natural audiobook style with steady pacing.';

type AudioNovelEncoding = 'LINEAR16' | 'MP3';

const clientPromises: Array<Promise<TextToSpeechClient>> = [];
let poolIndex = 0;

const expectedLinear16Bytes = (charCount: number): number => {
  return Math.floor((charCount / 5 / 150) * 24_000 * 2);
};

const buildClient = async (account: GoogleServiceAccount): Promise<TextToSpeechClient> => {
  const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
  return new TextToSpeechClient({
    projectId: account.projectId,
    apiEndpoint: resolveCloudTtsApiEndpoint(),
    credentials: {
      client_email: account.clientEmail,
      private_key: account.privateKey,
    },
  });
};

const getClientPool = (): Array<Promise<TextToSpeechClient>> => {
  if (clientPromises.length > 0) return clientPromises;
  const credentials = resolveCloudTtsCredentialPool();
  if (credentials.length === 0) {
    throw new Error('No Google Cloud TTS credentials configured.');
  }
  for (let index = 0; index < CLIENT_POOL_SIZE; index += 1) {
    clientPromises.push(buildClient(credentials[index % credentials.length]!));
  }
  return clientPromises;
};

const getClient = async (): Promise<TextToSpeechClient> => {
  const pool = getClientPool();
  const clientPromise = pool[poolIndex % pool.length]!;
  poolIndex = (poolIndex + 1) % pool.length;
  return clientPromise;
};

const validateAudio = (
  buffer: Buffer,
  charCount: number,
  encoding: AudioNovelEncoding,
): 'valid' | 'truncated' | 'invalid' => {
  if (buffer.length < 500) return 'invalid';
  if (encoding === 'MP3') {
    return buffer.length >= 900 ? 'valid' : 'invalid';
  }
  const expectedBytes = expectedLinear16Bytes(charCount);
  if (expectedBytes > 0 && buffer.length < expectedBytes * 0.5) {
    return 'truncated';
  }
  return 'valid';
};

const wait = async (ms: number): Promise<void> => {
  if (ms <= 0) return;
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
};

export const synthesizeAudioNovelRun = async (
  run: AudioNovelSpeakerRun,
  encoding: AudioNovelEncoding,
  maxRetries: number,
): Promise<Buffer> => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const client = await getClient();
      const [response] = await client.synthesizeSpeech({
        input: { text: run.mergedText },
        voice: {
          languageCode: 'en-IN',
          name: 'gemini-2.5-flash-tts',
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: run.voice,
            },
          },
        } as never,
        audioConfig: {
          audioEncoding: encoding,
          sampleRateHertz: 24_000,
        },
      } as never);

      const audioContent = response.audioContent;
      const buffer = Buffer.isBuffer(audioContent)
        ? audioContent
        : Buffer.from((audioContent as Uint8Array | undefined) || []);
      const status = validateAudio(buffer, run.charCount, encoding);
      if (status === 'truncated' && attempt < maxRetries - 1) {
        continue;
      }
      if (status === 'invalid') {
        return encoding === 'LINEAR16' ? SILENCE : Buffer.alloc(0);
      }
      return buffer;
    } catch (error) {
      const message = String((error as Error)?.message || error || '');
      const code = Number((error as { code?: number })?.code || 0);
      const isRateLimited = code === 429 || message.includes('RESOURCE_EXHAUSTED');
      const isTransient = isRateLimited || message.includes('finishReason: OTHER') || code >= 500;
      if (isTransient && attempt < maxRetries - 1) {
        await wait(Math.pow(2, attempt) * (isRateLimited ? 10_000 : 2_000));
        continue;
      }
      return encoding === 'LINEAR16' ? SILENCE : Buffer.alloc(0);
    }
  }

  return encoding === 'LINEAR16' ? SILENCE : Buffer.alloc(0);
};

export const getAudioNovelSilenceBuffer = (): Buffer => SILENCE;

export const streamAudioNovelBidi = async (
  runs: AudioNovelSpeakerRun[],
  onChunk: (buffer: Buffer) => void,
): Promise<{ responseChunkCount: number; totalBytes: number }> => {
  const safeRuns = runs.filter((run) => run.mergedText.trim().length > 0);
  if (safeRuns.length === 0) {
    throw new Error('No runs available for bidi streaming.');
  }

  const voice = safeRuns[0]?.voice || 'Kore';
  const client = await getClient();
  const stream = client.streamingSynthesize();

  let responseChunkCount = 0;
  let totalBytes = 0;

  const completion = new Promise<void>((resolve, reject) => {
    stream.on('data', (response) => {
      const audioContent = response?.audioContent;
      const buffer = Buffer.isBuffer(audioContent)
        ? audioContent
        : Buffer.from(audioContent || []);
      if (buffer.length <= 0) return;
      responseChunkCount += 1;
      totalBytes += buffer.length;
      onChunk(buffer);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  stream.write({
    streamingConfig: {
      voice: {
        languageCode: 'en-IN',
        name: voice,
        modelName: 'gemini-2.5-flash-tts',
      },
      streamingAudioConfig: {
        audioEncoding: 'PCM',
        sampleRateHertz: 24_000,
      },
    },
  });

  for (let index = 0; index < safeRuns.length; index += 1) {
    const run = safeRuns[index];
    if (!run) continue;
    stream.write({
      input: {
        text: run.mergedText,
        prompt: index === 0 ? AUDIO_NOVEL_BIDI_PROMPT : undefined,
      },
    });
  }
  stream.end();

  await completion;

  if (totalBytes <= 0) {
    throw new Error('Bidi streaming returned no audio.');
  }

  return { responseChunkCount, totalBytes };
};
