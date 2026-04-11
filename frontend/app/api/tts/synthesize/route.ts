/**
 * TTS Synthesize API Route — Single chunk synthesis
 *
 * POST /api/tts/synthesize
 * Body: { text, voice?, engine, language?, speed?, multiSpeaker?, prompt? }
 * Returns: audio/wav (LINEAR16 24kHz) or audio/mpeg based on Accept header
 */

import { NextResponse } from 'next/server';
import { synthesize, isConfigured, MAX_TEXT_LENGTH, type TtsEngine } from '../../../../services/cloudTtsService';

export const runtime = 'nodejs';

const VALID_ENGINES: Set<string> = new Set(['VECTOR', 'PRIME']);

const sanitizeInput = (value: string): string =>
  String(value || '').replace(/["`${}]/g, '').trim();

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

    const text = sanitizeInput(body.text);
    if (!text) {
      return NextResponse.json({ error: 'text is required.' }, { status: 400 });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `text exceeds ${MAX_TEXT_LENGTH} character limit.` },
        { status: 400 },
      );
    }

    const engineRaw = String(body.engine || 'VECTOR').trim().toUpperCase();
    if (!VALID_ENGINES.has(engineRaw)) {
      return NextResponse.json(
        { error: `Invalid engine. Use VECTOR or PRIME.` },
        { status: 400 },
      );
    }
    const engine = engineRaw as TtsEngine;

    const voice = body.voice ? sanitizeInput(body.voice) : undefined;
    const language = body.language ? sanitizeInput(body.language) : 'en-US';
    const speed = body.speed != null ? Number(body.speed) : 1.0;
    const prompt = body.prompt ? sanitizeInput(body.prompt).slice(0, 4000) : undefined;

    const multiSpeaker = Array.isArray(body.multiSpeaker)
      ? body.multiSpeaker
        .slice(0, 10)
        .filter(
          (s: unknown): s is { speaker: string; voice: string } =>
            typeof s === 'object' &&
            s !== null &&
            typeof (s as Record<string, unknown>).speaker === 'string' &&
            typeof (s as Record<string, unknown>).voice === 'string',
        )
        .map((s: { speaker: string; voice: string }) => ({
          speaker: sanitizeInput(s.speaker),
          voice: sanitizeInput(s.voice),
        }))
      : undefined;

    const result = await synthesize({
      text,
      voice,
      engine,
      language,
      speed,
      multiSpeaker,
      prompt,
    });

    return new Response(result.audioContent, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.audioContent.length),
        'X-TTS-Model': result.model,
        'X-TTS-Project': result.projectId,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/tts/synthesize]', err);
    const message = err instanceof Error ? err.message : 'TTS synthesis failed.';
    const status = message.includes('exhausted') ? 429 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
