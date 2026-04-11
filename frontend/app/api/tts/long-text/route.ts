/**
 * TTS Long-Text API Route — Multi-chunk concatenated synthesis
 *
 * POST /api/tts/long-text
 * Body: { text, voice?, engine, language?, speed?, prompt? }
 * Returns: audio/wav (concatenated LINEAR16 24kHz) or JSON with chunk info
 */

import { NextResponse } from 'next/server';
import { synthesize, isConfigured, MAX_TEXT_LENGTH, type TtsEngine } from '../../../../services/cloudTtsService';

export const runtime = 'nodejs';

const VALID_ENGINES: Set<string> = new Set(['VECTOR', 'PRIME']);

const sanitizeInput = (value: string): string =>
  String(value || '').replace(/["`${}]/g, '').trim();

// --------------- Text Chunking ---------------

const CHUNK_TARGET = 2400;

const SENTENCE_ENDINGS = /(?<=[.!?।॥\u3002\uff01\uff1f])\s+/;

const chunkText = (text: string): string[] => {
  if (text.length <= CHUNK_TARGET) return [text];

  const sentences = text.split(SENTENCE_ENDINGS).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > MAX_TEXT_LENGTH) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      const words = sentence.split(/\s+/);
      let part = '';
      for (const word of words) {
        if ((part + ' ' + word).trim().length > CHUNK_TARGET && part.trim()) {
          chunks.push(part.trim());
          part = word;
        } else {
          part = part ? part + ' ' + word : word;
        }
      }
      if (part.trim()) current = part.trim();
      continue;
    }

    if ((current + ' ' + sentence).trim().length > CHUNK_TARGET && current.trim()) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, MAX_TEXT_LENGTH)];
};

// --------------- WAV Concatenation ---------------

const WAV_HEADER_SIZE = 44;
const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

const buildWavHeader = (dataLength: number): Buffer => {
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const byteRate = SAMPLE_RATE * blockAlign;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
};

const stripWavHeader = (buf: Buffer): Buffer => {
  // Find 'data' subchunk
  for (let i = 0; i < Math.min(buf.length - 8, 200); i++) {
    if (
      buf[i] === 0x64 &&      // 'd'
      buf[i + 1] === 0x61 &&  // 'a'
      buf[i + 2] === 0x74 &&  // 't'
      buf[i + 3] === 0x61     // 'a'
    ) {
      const dataStart = i + 8; // skip 'data' + 4-byte size
      return buf.subarray(dataStart);
    }
  }
  // Fallback: skip standard 44-byte header
  return buf.subarray(WAV_HEADER_SIZE);
};

const concatenateWavBuffers = (buffers: Buffer[]): Buffer => {
  const pcmChunks = buffers.map(stripWavHeader);
  const totalPcmLength = pcmChunks.reduce((acc, b) => acc + b.length, 0);
  const header = buildWavHeader(totalPcmLength);
  return Buffer.concat([header, ...pcmChunks]);
};

// --------------- Route Handler ---------------

const MAX_TOTAL_TEXT = 50_000; // 50K chars max for long-text

export async function POST(request: Request) {
  try {
    if (!isConfigured()) {
      return NextResponse.json(
        { error: 'Cloud TTS service is not configured.' },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const rawText = sanitizeInput(body.text);
    if (!rawText) {
      return NextResponse.json({ error: 'text is required.' }, { status: 400 });
    }
    if (rawText.length > MAX_TOTAL_TEXT) {
      return NextResponse.json(
        { error: `text exceeds ${MAX_TOTAL_TEXT} character limit.` },
        { status: 400 },
      );
    }

    const engineRaw = String(body.engine || 'VECTOR').trim().toUpperCase();
    if (!VALID_ENGINES.has(engineRaw)) {
      return NextResponse.json(
        { error: 'Invalid engine. Use VECTOR or PRIME.' },
        { status: 400 },
      );
    }
    const engine = engineRaw as TtsEngine;

    const voice = body.voice ? sanitizeInput(body.voice) : undefined;
    const language = body.language ? sanitizeInput(body.language) : 'en-US';
    const speed = body.speed != null ? Number(body.speed) : 1.0;
    const prompt = body.prompt ? sanitizeInput(body.prompt).slice(0, 4000) : undefined;

    const chunks = chunkText(rawText);
    const audioBuffers: Buffer[] = [];
    let usedModel = '';

    for (const chunk of chunks) {
      if (!chunk) continue;
      const result = await synthesize({
        text: chunk,
        voice,
        engine,
        language,
        speed,
        prompt,
      });
      audioBuffers.push(result.audioContent);
      if (!usedModel) usedModel = result.model;
    }

    if (audioBuffers.length === 0) {
      return NextResponse.json({ error: 'No audio generated.' }, { status: 500 });
    }

    // Concatenate all WAV chunks into a single WAV
    const concatenated =
      audioBuffers.length === 1
        ? audioBuffers[0]!
        : concatenateWavBuffers(audioBuffers);

    return new Response(concatenated, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(concatenated.length),
        'X-TTS-Model': usedModel,
        'X-TTS-Chunks': String(audioBuffers.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/tts/long-text]', err);
    const message = err instanceof Error ? err.message : 'Long-text TTS failed.';
    const status = message.includes('exhausted') ? 429 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
