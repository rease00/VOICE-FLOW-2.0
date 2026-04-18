#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { TextToSpeechClient } from '@google-cloud/text-to-speech';

import { resolveCloudTtsApiEndpoint, resolveCloudTtsCredentialPool } from '../src/server/googleCredentials.ts';
import { applyRuntimeEnv } from './load-runtime-env.mjs';

const frontendRoot = path.resolve(import.meta.dirname, '..');
applyRuntimeEnv(frontendRoot);

const credentialsPool = resolveCloudTtsCredentialPool();
if (credentialsPool.length === 0) {
  throw new Error('No Google Cloud TTS credentials configured for bidi streaming test.');
}

const account = credentialsPool[0];
const apiEndpoint = resolveCloudTtsApiEndpoint();
const modelName = String(process.env.VF_BIDI_TEST_MODEL || 'gemini-2.5-flash-tts').trim() || 'gemini-2.5-flash-tts';
const voiceName = String(process.env.VF_BIDI_TEST_VOICE || 'Kore').trim() || 'Kore';
const languageCode = String(process.env.VF_BIDI_TEST_LANGUAGE || 'en-US').trim() || 'en-US';
const prompt = String(
  process.env.VF_BIDI_TEST_PROMPT
  || 'Read the following in a clean, natural audiobook style with steady pacing.',
).trim();
const outputDir = path.resolve(frontendRoot, '.artifacts');
const outputPath = path.join(outputDir, 'cloud-tts-bidi-smoke.wav');

const textChunks = [
  'This is a bidirectional streaming smoke test for V FLOW AI.',
  'We are measuring how quickly the first audio bytes arrive from Google Cloud Text-to-Speech.',
  'If this sounds smooth and starts fast, the streaming path is healthy.',
];

const buildClient = () => new TextToSpeechClient({
  projectId: account.projectId,
  apiEndpoint,
  credentials: {
    client_email: account.clientEmail,
    private_key: account.privateKey,
  },
});

const buildWavHeader = (dataLength) => {
  const header = Buffer.alloc(44);
  const blockAlign = 2;
  const byteRate = 24000 * blockAlign;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
};

const run = async () => {
  await fs.mkdir(outputDir, { recursive: true });

  const client = buildClient();
  const startedAt = performance.now();
  let firstChunkAt = 0;
  let chunkCount = 0;
  let totalBytes = 0;
  const audioChunks = [];

  const stream = client.streamingSynthesize();
  const completion = new Promise((resolve, reject) => {
    stream.on('data', (response) => {
      const audioContent = response?.audioContent;
      const buffer = Buffer.isBuffer(audioContent)
        ? audioContent
        : Buffer.from(audioContent || []);
      if (buffer.length === 0) return;
      if (firstChunkAt === 0) {
        firstChunkAt = performance.now();
      }
      chunkCount += 1;
      totalBytes += buffer.length;
      audioChunks.push(buffer);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  stream.write({
    streamingConfig: {
      voice: {
        languageCode,
        name: voiceName,
        modelName,
      },
      streamingAudioConfig: {
        audioEncoding: 'PCM',
        sampleRateHertz: 24000,
      },
    },
  });

  for (let index = 0; index < textChunks.length; index += 1) {
    stream.write({
      input: {
        text: textChunks[index],
        prompt: index === 0 ? prompt : undefined,
      },
    });
  }
  stream.end();

  await completion;
  await client.close();

  const pcm = Buffer.concat(audioChunks);
  if (pcm.length === 0) {
    throw new Error('Bidi streaming returned no audio bytes.');
  }

  const wav = Buffer.concat([buildWavHeader(pcm.length), pcm]);
  await fs.writeFile(outputPath, wav);

  const finishedAt = performance.now();
  const timeToFirstAudioMs = firstChunkAt > 0 ? Math.round(firstChunkAt - startedAt) : -1;
  const totalTimeMs = Math.round(finishedAt - startedAt);
  const audioDurationSeconds = Number((pcm.length / 2 / 24000).toFixed(2));

  console.log(JSON.stringify({
    ok: true,
    apiEndpoint,
    projectId: account.projectId,
    credentialSource: account.source,
    modelName,
    voiceName,
    languageCode,
    prompt,
    textChunkCount: textChunks.length,
    responseChunkCount: chunkCount,
    totalBytes,
    timeToFirstAudioMs,
    totalTimeMs,
    audioDurationSeconds,
    outputPath,
  }, null, 2));
};

run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    apiEndpoint,
    projectId: account?.projectId,
    credentialSource: account?.source,
    modelName,
    voiceName,
    languageCode,
  }, null, 2));
  process.exitCode = 1;
});
