/**
 * TTS Stream API Route — SSE streaming for long text
 *
 * POST /api/tts/stream
 * Body: { text, voice?, engine, language?, speed?, prompt? }
 * Returns: SSE stream with base64 audio chunks
 *
 * Events:
 *   data: { type: 'chunk', index, total, audioBase64, model }
 *   data: { type: 'done', totalChunks }
 *   data: { type: 'error', message }
 */

import { NextResponse } from 'next/server';
import { synthesize, isConfigured, MAX_TEXT_LENGTH, type TtsEngine } from '../../../../services/cloudTtsService';

export const runtime = 'nodejs';

const VALID_ENGINES: Set<string> = new Set(['VECTOR', 'PRIME']);

const sanitizeInput = (value: string): string =>
  String(value || '').replace(/["`${}]/g, '').trim();

// --------------- Text Chunking ---------------
// Sentence-aware chunking: target ~2400 chars per chunk, hard cap at 3000

const CHUNK_TARGET = 2400;
const CHUNK_HARD_CAP = MAX_TEXT_LENGTH;

const SENTENCE_ENDINGS = /(?<=[.!?।॥\u3002\uff01\uff1f])\s+/;

const chunkText = (text: string): string[] => {
  if (text.length <= CHUNK_TARGET) return [text];

  const sentences = text.split(SENTENCE_ENDINGS).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > CHUNK_HARD_CAP) {
      // Force-split oversized sentences at word boundaries
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
  return chunks.length > 0 ? chunks : [text.slice(0, CHUNK_HARD_CAP)];
};

// --------------- SSE Helpers ---------------

const encodeSSE = (data: Record<string, unknown>): Uint8Array => {
  const encoder = new TextEncoder();
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
};

// --------------- Route Handler ---------------

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

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            if (!chunkText) continue;

            try {
              const result = await synthesize({
                text: chunkText,
                voice,
                engine,
                language,
                speed,
                prompt,
              });

              const audioBase64 = result.audioContent.toString('base64');
              controller.enqueue(
                encodeSSE({
                  type: 'chunk',
                  index: i,
                  total: chunks.length,
                  audioBase64,
                  model: result.model,
                  charCount: chunkText.length,
                }),
              );
            } catch (chunkErr) {
              const msg =
                chunkErr instanceof Error ? chunkErr.message : 'Chunk synthesis failed.';
              controller.enqueue(
                encodeSSE({ type: 'error', message: msg, chunkIndex: i }),
              );
              // Continue to next chunk on error
            }
          }

          controller.enqueue(
            encodeSSE({ type: 'done', totalChunks: chunks.length }),
          );
          controller.close();
        } catch (streamErr) {
          const msg =
            streamErr instanceof Error ? streamErr.message : 'Stream failed.';
          try {
            controller.enqueue(encodeSSE({ type: 'error', message: msg }));
            controller.close();
          } catch {
            // Controller already closed
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[api/tts/stream]', err);
    const message = err instanceof Error ? err.message : 'TTS stream failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
